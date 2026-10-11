"""Silhouette -> ink-particle disintegration renderer.
usage: python3 render.py <scratch_dir> [preview]
"""
import sys, os, glob, subprocess, numpy as np, cv2

S = sys.argv[1]
PREVIEW = len(sys.argv) > 2
rng = np.random.default_rng(7)

W, H = 1920, 1080            # world == source-frame resolution
SS = 1 if PREVIEW else 2     # supersampling for the ink layer
OW, OH = W * SS, H * SS
FPS = 30
SRC_FPS = 60
DUR = float(os.environ.get("DUR", 10.6))
NF = int(DUR * FPS)

# ---------------------------------------------------------------- masks
mfiles = sorted(glob.glob(f"{S}/masks/m*.png"))
raw = [cv2.imread(f, 0).astype(np.float32) / 255 for f in mfiles]
k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
k_dil = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
masks = []
for m in raw:
    b = cv2.morphologyEx((m > 0.5).astype(np.uint8), cv2.MORPH_OPEN, k_open)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b)
    keep = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    keep = cv2.dilate(keep, k_dil).astype(np.float32)
    masks.append(m * keep)
masks = np.stack(masks)
# light temporal smoothing (60 fps source, so a 3-tap is safe)
masks = np.concatenate([masks[:1], masks, masks[-1:]])
masks = 0.25 * masks[:-2] + 0.5 * masks[1:-1] + 0.25 * masks[2:]
NSRC = len(masks)

# ---------------------------------------------------------------- speed ramp
# src_local(t): 1x until 1.0s, eases down to 0.45x by 1.5s, holds (slow-mo arm raise)
ts = np.linspace(0, DUR, NF + 1)
def speed(t):
    if t < 1.0: return 1.0
    if t < 1.5:
        u = (t - 1.0) / 0.5; u = u * u * (3 - 2 * u)
        return 1.0 + (0.45 - 1.0) * u
    return 0.45
src_t = np.zeros_like(ts); src_t[0] = 0.1
for i in range(1, len(ts)):
    src_t[i] = src_t[i - 1] + speed(ts[i - 1]) / FPS
src_last = (NSRC - 1) / SRC_FPS

def mask_at(t_out):
    i = min(int(round(t_out * FPS)), NF)
    s = min(src_t[i], src_last) * SRC_FPS
    return masks[min(int(round(s)), NSRC - 1)]

# burst begins once arms are fully open (source local ~2.15s)
T0 = float(ts[np.searchsorted(src_t, 2.15)])
print(f"T0={T0:.2f}s  src ends at t={ts[np.searchsorted(src_t, src_last)]:.2f}s", flush=True)

# ---------------------------------------------------------------- noise helpers
def fbm(w, h, octaves, seed, base=4):
    r = np.random.default_rng(seed); out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        gx = base * 2 ** o; gy = max(2, int(gx * h / w))
        g = r.standard_normal((gy + 3, gx + 3)).astype(np.float32)
        up = cv2.resize(g, (w + w * 3 // gx, h + h * 3 // gy), interpolation=cv2.INTER_CUBIC)[:h, :w]
        out += amp * up; tot += amp; amp *= 0.55
    return out / tot

ref = mask_at(T0)
ys, xs = np.nonzero(ref > 0.5)
CX, CY = float(xs.mean()), float(np.percentile(ys, 35))
print(f"body centre {CX:.0f},{CY:.0f}", flush=True)

# release time field: edges / fingertips go first, eats inward to the chest
inside = (ref > 0.5).astype(np.uint8)
dt = cv2.distanceTransform(inside, cv2.DIST_L2, 5); dt /= dt.max()
nz = fbm(W, H, 5, 11, base=6); nz = (nz - nz.min()) / (nz.max() - nz.min())
horiz = np.abs(np.arange(W, dtype=np.float32) - CX)[None, :] / (W * 0.4)
R = T0 + 1.55 * dt ** 0.6 + 0.75 * nz - 0.35 * np.clip(horiz, 0, 1)
R = R.astype(np.float32)

# ridged "crack" texture that glows inside the body just before it breaks
ridge = 1 - np.abs(fbm(W, H, 5, 23, base=10)) * 6.0
ridge = np.clip(ridge, 0, 1) ** 6

# voronoi mesh: particles are seeded mostly along cell walls -> dotted ink web
def voronoi_web(cell, seed, width):
    r = np.random.default_rng(seed)
    npts = int(W * H / cell ** 2)
    img = np.ones((H, W), np.uint8)
    img[r.integers(0, H, npts), r.integers(0, W, npts)] = 0
    _, lab = cv2.distanceTransformWithLabels(img, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
    e = np.zeros((H, W), np.uint8)
    e[:, 1:] |= (lab[:, 1:] != lab[:, :-1]); e[1:, :] |= (lab[1:, :] != lab[:-1, :])
    d = cv2.distanceTransform(1 - e, cv2.DIST_L2, 3)
    return np.exp(-d / width)
WEB = np.maximum(voronoi_web(46, 5, 1.1), 0.7 * voronoi_web(17, 6, 0.8))
WEB = np.clip(WEB * (0.6 + 0.8 * (fbm(W, H, 3, 31, base=8) * 0.5 + 0.5)), 0, 1).astype(np.float32)

# curl-noise flow: time-varying potential, velocity at 1/4 res
QW, QH = W // 4, H // 4
def curl(seed):
    p = fbm(QW, QH, 4, seed, base=3) * 1.0 + fbm(QW, QH, 3, seed + 1, base=14) * 0.6
    gy, gx = np.gradient(p)
    return gy, -gx
fa = curl(101); fb = curl(202)
s_ = np.std(np.concatenate([fa[0].ravel(), fa[1].ravel()]))
fa = [c / s_ for c in fa]; fb = [c / s_ for c in fb]

def sample(field, x, y):
    fx = np.clip(x / 4, 0, QW - 1.001); fy = np.clip(y / 4, 0, QH - 1.001)
    x0 = fx.astype(np.int32); y0 = fy.astype(np.int32); dx = fx - x0; dy = fy - y0
    return (field[y0, x0] * (1 - dx) * (1 - dy) + field[y0, x0 + 1] * dx * (1 - dy)
            + field[y0 + 1, x0] * (1 - dx) * dy + field[y0 + 1, x0 + 1] * dx * dy)

# ---------------------------------------------------------------- particles
cap = 900_000
P = dict(x=np.zeros(cap, np.float32), y=np.zeros(cap, np.float32), vx=np.zeros(cap, np.float32),
         vy=np.zeros(cap, np.float32), born=np.zeros(cap, np.float32), life=np.zeros(cap, np.float32),
         w=np.zeros(cap, np.float32), k=np.zeros(cap, np.float32))
n = 0

def spawn(sel_y, sel_x, t):
    global n
    reps = 4
    yy = np.repeat(sel_y, reps).astype(np.float32) + rng.random(len(sel_y) * reps, dtype=np.float32)
    xx = np.repeat(sel_x, reps).astype(np.float32) + rng.random(len(sel_x) * reps, dtype=np.float32)
    keep = rng.random(len(xx)) < 0.035 + 0.965 * np.repeat(WEB[sel_y, sel_x], reps)
    xx, yy = xx[keep], yy[keep]; m = len(xx)
    if n + m > cap: m = cap - n; xx, yy = xx[:m], yy[:m]
    sl = slice(n, n + m)
    ox = xx - CX; oy = yy - CY
    d = np.sqrt(ox * ox + oy * oy) + 1
    ang = rng.uniform(0, 2 * np.pi, m).astype(np.float32)
    kick = rng.uniform(5, 40, m).astype(np.float32)
    P["x"][sl] = xx; P["y"][sl] = yy
    P["vx"][sl] = np.cos(ang) * kick + ox * 0.08
    P["vy"][sl] = np.sin(ang) * kick * 0.6 - 8
    P["born"][sl] = t
    P["life"][sl] = rng.uniform(4.5, 9.0, m)
    P["w"][sl] = rng.uniform(0.35, 1.0, m) * (0.7 + 0.6 * np.repeat(WEB[sel_y, sel_x], 4)[keep][:m])
    P["k"][sl] = rng.uniform(0.5, 1.4, m)   # how strongly it follows the flow
    n += m

# ---------------------------------------------------------------- camera
def camera(t):
    u = np.clip(t / DUR, 0, 1); e = u * u * (3 - 2 * u)
    z = 1.14 + 0.13 * e
    sh = 0.0
    if t > T0:
        a = np.exp(-(t - T0) * 5.0) * 7.0
        sh = a
    jx = sh * np.sin(t * 91.0); jy = sh * np.cos(t * 77.0)
    # output centre (OW/2, OH*0.46) <- world (CX, CY+40)
    M = np.array([[z * SS, 0, OW / 2 - z * SS * CX + jx * SS],
                  [0, z * SS, OH * 0.40 - z * SS * (CY - 30) + jy * SS]], np.float32)
    return M

# background: paper white with soft grey top/bottom bands like the reference
yy_ = np.linspace(0, 1, H, dtype=np.float32)[:, None]
band = 0.80 + 0.20 * np.clip(np.minimum(yy_ / 0.16, (1 - yy_) / 0.22), 0, 1) ** 0.8
BG = np.repeat(band, W, axis=1)
xx_ = np.linspace(-1, 1, W, dtype=np.float32)[None, :]
BG *= 1 - 0.06 * (xx_ ** 2)

def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)

# ---------------------------------------------------------------- render loop
out = f"{S}/out_preview.mp4" if PREVIEW else f"{S}/video_noaudio.mov"
enc = (["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"] if PREVIEW
       else ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"])
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", *enc, out], stdin=subprocess.PIPE)
dtf = 1.0 / FPS
SUB = 4
grain_r = np.random.default_rng(3)
MAXF = int(os.environ.get('MAXF', NF))
for fi in range(MAXF):
    t = fi / FPS
    m = mask_at(t)
    # spawn the pixels whose release time just passed
    if t >= T0 - dtf:
        sel = (m > 0.5) & (R >= t - dtf) & (R < t)
        if t + dtf >= DUR - 5.5:  # safety: anything left releases before footage runs out
            pass
        sy, sx = np.nonzero(sel)
        if len(sy): spawn(sy, sx, t)
    solid = m * (R > t) if t >= T0 - dtf else m
    # after the footage ends nothing of the body remains
    # ---- sim step with sub-steps, accumulating streaks
    M = camera(t)
    acc = np.zeros(OW * OH, np.float32)
    if n:
        x = P["x"][:n]; y = P["y"][:n]; vx = P["vx"][:n]; vy = P["vy"][:n]
        age = t - P["born"][:n]
        alive = age < P["life"][:n]
        ph = t * 0.35
        ca, sa = np.cos(ph), np.sin(ph)
        alpha = P["w"][:n] * smooth(0, 0.15, age) * (1 - smooth(0.55, 1.0, age / P["life"][:n]))
        # ink is denser while young, gets lighter/finer as it spreads
        alpha *= 0.6 + 0.6 * np.exp(-age * 0.8)
        idx = np.nonzero(alive & (alpha > 0.01))[0]
        for s in range(SUB):
            h = dtf / SUB
            xi = x[idx]; yi = y[idx]
            fx = (sample(fa[0], xi, yi) * ca + sample(fb[0], xi, yi) * sa)
            fy = (sample(fa[1], xi, yi) * ca + sample(fb[1], xi, yi) * sa)
            kk = P["k"][idx]
            spd = 42.0 * kk
            # smooth sideways expansion (no seam at the spine) + gentle lift
            ag = t - P["born"][idx]
            tx = fx * spd + (xi - CX) * (0.06 + 0.08 * np.minimum(ag, 4.0))
            ty = fy * spd * 0.7 + (yi - CY) * 0.03 - 6.0
            relax = 1 - np.exp(-1.2 * h)
            vx[idx] += (tx - vx[idx]) * relax
            vy[idx] += (ty - vy[idx]) * relax
            x[idx] += vx[idx] * h; y[idx] += vy[idx] * h
            # project to output space & splat (bilinear)
            ox = M[0, 0] * x[idx] + M[0, 2]; oy = M[1, 1] * y[idx] + M[1, 2]
            ok = (ox >= 0) & (ox < OW - 1) & (oy >= 0) & (oy < OH - 1)
            ox, oy, a = ox[ok], oy[ok], alpha[idx][ok] / SUB
            x0 = ox.astype(np.int32); y0 = oy.astype(np.int32); dx = ox - x0; dy = oy - y0
            b = y0 * OW + x0
            acc += np.bincount(b, a * (1 - dx) * (1 - dy), OW * OH)
            acc += np.bincount(b + 1, a * dx * (1 - dy), OW * OH)
            acc += np.bincount(b + OW, a * (1 - dx) * dy, OW * OH)
            acc += np.bincount(b + OW + 1, a * dx * dy, OW * OH)
    D = acc.reshape(OH, OW)
    ink = 1 - np.exp(-(2.2 * (3.2 if SS > 1 else 1.0)) * D)
    if n:
        soft = cv2.GaussianBlur(D, (0, 0), 2.5 * SS)
        smoke = 1 - np.exp(-(0.6 * 1.6 / SS ** 2) * soft)
        # horizontal motion-smear (depth-of-field feel) only on the outer clouds
        smear = cv2.blur(D, (int(45 * SS), 1))
        sm = (1 - np.exp(-(0.5 / SS ** 2) * smear)) * smooth(0.18, 0.48, np.abs(np.linspace(-0.5, 0.5, OW))[None, :])
        ink = 1 - (1 - ink) * (1 - 0.3 * smoke) * (1 - 0.75 * sm)
    # ---- silhouette in output space
    sol = cv2.warpAffine(solid.astype(np.float32), M, (OW, OH), flags=cv2.INTER_LINEAR)
    sol = smooth(0.3, 0.7, sol)
    glow = cv2.warpAffine((ridge * smooth(-0.55, 0.0, t - R) * (R > t)).astype(np.float32), M, (OW, OH))
    bg = cv2.warpAffine(BG, M, (OW, OH), borderMode=cv2.BORDER_REPLICATE)
    # end grade: paper goes misty grey as the dust settles, like the reference tail
    fog = smooth(DUR - 2.2, DUR - 0.2, t)
    bg = bg * (1 - 0.22 * fog)
    img = bg * (1 - ink * 0.97)
    body = 0.02 + 0.55 * glow
    img = img * (1 - sol) + body * sol
    if SS > 1:
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    # fades & grain
    img = img * smooth(0, 0.25, t) + (1 - smooth(0, 0.25, t))       # in from white
    img = img * (1 - smooth(DUR - 0.35, DUR, t)) + 0.80 * smooth(DUR - 0.35, DUR, t)
    img += grain_r.normal(0, 0.012, img.shape).astype(np.float32)
    ff.stdin.write((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
    if fi % 30 == 0: print(f"frame {fi}/{NF} particles={n}", flush=True)
ff.stdin.close(); ff.wait()
print("done", out)
