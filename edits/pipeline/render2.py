"""BURN FOR YOU - multi-shot silhouette edit with ink/ember disintegration.
usage: python3 render2.py <scratch_dir> [preview]   env: T_START, T_END (seconds, for test renders)
"""
import sys, os, subprocess, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

S = sys.argv[1]
PREVIEW = len(sys.argv) > 2
rng = np.random.default_rng(7)
W, H = 1920, 1080
SS = 1 if PREVIEW else 2
OW, OH = W * SS, H * SS
FPS, SRC_FPS = 30, 60
DUR = 22.0
NF = int(DUR * FPS)
FONT = f"{S}/fonts/Anton-Regular.ttf"

RED = np.array([0.86, 0.07, 0.05], np.float32)
EMBER = np.array([1.0, 0.36, 0.06], np.float32)

def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)
def pulse(dt, k=9.0):
    return 0.0 if dt < 0 else float(np.exp(-dt * k))

# ---------------------------------------------------------------- timeline (seconds)
T_WALK, T_STAND, T_TAKE1, T_TAKE2, T_MAIN = 2.0, 5.0, 6.0, 8.0, 10.0
T0 = 13.0                      # the drop: body breaks
T_CONV0, T_LAND = 18.3, 20.0   # ash pulls into the title
T_OUT = 21.4
ACC1, ACC2 = 6.62, 8.70        # arms fully open in take 1 / take 2 (punch accents)
CUTS = [T_WALK, T_TAKE1, T_TAKE2, T_MAIN]

# main take speed ramp: 1x from src 17.0 until 10.8s, then slow-mo landing src 19.05 exactly on T0
def main_src(t, s):
    if t <= 10.8: return 17.0 + (t - 10.0)
    r = 0.3
    if t <= 10.8 + r:
        u = t - 10.8; return 17.8 + u + (s - 1) * u * u / (2 * r)
    return 17.8 + r + (s - 1) * r / 2 + (t - 10.8 - r) * s
lo, hi = 0.1, 1.0
for _ in range(60):
    mid = (lo + hi) / 2
    if main_src(T0, mid) < 19.05: lo = mid
    else: hi = mid
SLOW = (lo + hi) / 2
print(f"slow-mo factor {SLOW:.3f}", flush=True)

def src_time(t):
    if t < T_WALK: return None
    if t < T_STAND: return 0.3 + (t - T_WALK)
    if t < T_TAKE1: return 3.3 + (t - T_STAND)
    if t < T_TAKE2: return 4.4 + (t - T_TAKE1)
    if t < T_MAIN: return 8.9 + (t - T_TAKE2)
    return main_src(t, SLOW)

# ---------------------------------------------------------------- masks
MDIR = f"{S}/masks_all"
NSRC = len([f for f in os.listdir(MDIR) if f.endswith(".png")])
k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
k_dil = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
_cache = {}
def load_mask(i):
    i = int(np.clip(i, 0, NSRC - 1))
    if i not in _cache:
        fx_path = f"{S}/masks_fix/m{i:05d}.png"
        m = cv2.imread(fx_path if os.path.exists(fx_path) else f"{MDIR}/m{i:05d}.png", 0).astype(np.float32) / 255
        b = cv2.morphologyEx((m > 0.5).astype(np.uint8), cv2.MORPH_OPEN, k_open)
        n, lab, st, _ = cv2.connectedComponentsWithStats(b)
        if n > 1:
            keep = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
            m = m * cv2.dilate(keep, k_dil).astype(np.float32)
        if len(_cache) > 12: _cache.pop(next(iter(_cache)))
        _cache[i] = m
    return _cache[i]
def mask_src(s):
    i = int(round(s * SRC_FPS))
    return 0.25 * load_mask(i - 1) + 0.5 * load_mask(i) + 0.25 * load_mask(i + 1)

def centre_x(s):
    ys, xs = np.nonzero(mask_src(s) > 0.5); return float(xs.mean())
CX_WALK, CX_T1, CX_T2, CX_MAIN = centre_x(2.0), centre_x(4.4), centre_x(8.9), centre_x(17.0)
ref = mask_src(19.05)
ys_, xs_ = np.nonzero(ref > 0.5)
CX, CY = float(xs_.mean()), float(np.percentile(ys_, 35))
BOT = 1076.0

# ---------------------------------------------------------------- camera
def cam(t):
    """returns z, pivot_x(world), dx, dy (output px @1x), rot(deg), depth-blur(px @1x)"""
    dx = dy = rot = blur = 0.0
    if t < T_STAND:                               # walk away from the lens
        u = smooth(T_WALK, T_STAND, t) * 0.35 + 0.65 * np.clip((t - T_WALK) / (T_STAND - T_WALK), 0, 1)
        Sd = 1.0 / (1 / 2.7 + (1 - 1 / 2.7) * u)          # perspective: size ~ 1/distance
        z = 1.10 * Sd; px = CX_WALK
        ph = np.pi * (t - T_WALK) / 0.5                     # one step per beat (120 bpm)
        stepamp = 1 - smooth(T_STAND - 0.35, T_STAND, t)
        dy = abs(np.sin(ph)) * 16 * Sd * stepamp
        dx = np.sin(ph) * 9 * Sd * stepamp
        rot = np.sin(ph) * 1.1 * stepamp
        blur = 10 * np.clip((Sd - 1) / 1.7, 0, 1) ** 1.5
    elif t < T_TAKE1:
        z = 1.10 + 0.03 * (t - T_STAND); px = CX_WALK
    elif t < T_TAKE2:
        z = 1.18 + 0.03 * (t - T_TAKE1) + 0.08 * pulse(t - ACC1, 6); px = CX_T1
    elif t < T_MAIN:
        z = 1.27 + 0.03 * (t - T_TAKE2) + 0.09 * pulse(t - ACC2, 6); px = CX_T2; rot = -1.6
    else:
        e = smooth(T_MAIN, 17.5, t)
        z = 1.14 + 0.20 * e; px = CX_MAIN + (CX - CX_MAIN) * smooth(T_MAIN, T0, t)
    # shakes: drop, cuts, landing
    sh = 9 * pulse(t - T0, 3.5) + 3 * sum(pulse(t - c, 12) for c in CUTS[1:]) + 6 * pulse(t - T_LAND, 5)
    sh += 2.5 * pulse(t - ACC1, 10) + 2.5 * pulse(t - ACC2, 10)
    dx += sh * np.sin(t * 91.0); dy += sh * np.cos(t * 77.0)
    return z, px, dx, dy, rot, blur

def cam_matrix(t, ss=SS, still=False):
    z, px, dx, dy, rot, _ = cam(t)
    if still: dx = dy = 0.0
    a = np.deg2rad(rot); c, s = np.cos(a) * z * ss, np.sin(a) * z * ss
    Qx, Qy = (W / 2 + dx) * ss, (H + dy) * ss
    return np.array([[c, -s, Qx - (c * px - s * BOT)], [s, c, Qy - (s * px + c * BOT)]], np.float32)

# ---------------------------------------------------------------- noise / fields
def fbm(w, h, octaves, seed, base=4):
    r = np.random.default_rng(seed); out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        gx = base * 2 ** o; gy = max(2, int(gx * h / w))
        g = r.standard_normal((gy + 3, gx + 3)).astype(np.float32)
        up = cv2.resize(g, (w + w * 3 // gx, h + h * 3 // gy), interpolation=cv2.INTER_CUBIC)[:h, :w]
        out += amp * up; tot += amp; amp *= 0.55
    return out / tot

inside = (ref > 0.5).astype(np.uint8)
dtf_ = cv2.distanceTransform(inside, cv2.DIST_L2, 5); dtf_ /= dtf_.max()
nz = fbm(W, H, 5, 11, base=6); nz = (nz - nz.min()) / (nz.max() - nz.min())
horiz = np.abs(np.arange(W, dtype=np.float32) - CX)[None, :] / (W * 0.4)
R = (T0 + 1.25 * dtf_ ** 0.6 + 0.55 * nz - 0.3 * np.clip(horiz, 0, 1)).astype(np.float32)
ridge = np.clip(1 - np.abs(fbm(W, H, 5, 23, base=10)) * 6.0, 0, 1) ** 6

def voronoi_web(cell, seed, width):
    r = np.random.default_rng(seed)
    img = np.ones((H, W), np.uint8)
    npts = int(W * H / cell ** 2)
    img[r.integers(0, H, npts), r.integers(0, W, npts)] = 0
    _, lab = cv2.distanceTransformWithLabels(img, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
    e = np.zeros((H, W), np.uint8)
    e[:, 1:] |= (lab[:, 1:] != lab[:, :-1]); e[1:, :] |= (lab[1:, :] != lab[:-1, :])
    return np.exp(-cv2.distanceTransform(1 - e, cv2.DIST_L2, 3) / width)
WEB = np.maximum(voronoi_web(46, 5, 1.1), 0.7 * voronoi_web(17, 6, 0.8))
WEB = np.clip(WEB * (0.6 + 0.8 * (fbm(W, H, 3, 31, base=8) * 0.5 + 0.5)), 0, 1).astype(np.float32)

QW, QH = W // 4, H // 4
def curl(seed):
    p = fbm(QW, QH, 4, seed, base=3) + fbm(QW, QH, 3, seed + 1, base=14) * 0.6
    gy, gx = np.gradient(p); return gy, -gx
fa, fb = curl(101), curl(202)
s_ = np.std(np.concatenate([fa[0].ravel(), fa[1].ravel()]))
fa = [c / s_ for c in fa]; fb = [c / s_ for c in fb]
def sample(field, x, y):
    fx = np.clip(x / 4, 0, QW - 1.001); fy = np.clip(y / 4, 0, QH - 1.001)
    x0 = fx.astype(np.int32); y0 = fy.astype(np.int32); dx = fx - x0; dy = fy - y0
    return (field[y0, x0] * (1 - dx) * (1 - dy) + field[y0, x0 + 1] * dx * (1 - dy)
            + field[y0 + 1, x0] * (1 - dx) * dy + field[y0 + 1, x0 + 1] * dx * dy)

# ---------------------------------------------------------------- text
def text_layer(words, height, w=W, h=H, cy=0.5, gap=0.035):
    """words: list of (text, is_red). returns black-ink mask, red mask (float, w x h)."""
    f = ImageFont.truetype(FONT, int(height))
    widths = [f.getbbox(t)[2] - f.getbbox(t)[0] for t, _ in words]
    total = sum(widths) + gap * w * (len(words) - 1)
    x = (w - total) / 2
    k = Image.new("L", (w, h)); r = Image.new("L", (w, h))
    for (t, red), ww in zip(words, widths):
        bb = f.getbbox(t)
        ImageDraw.Draw(r if red else k).text((x - bb[0], h * cy - (bb[1] + bb[3]) / 2), t, font=f, fill=255)
        x += ww + gap * w
    return np.asarray(k, np.float32) / 255, np.asarray(r, np.float32) / 255

# end title targets (world space, via inverse of the locked camera at landing)
TK, TR = text_layer([("BURN", True), ("FOR", False), ("YOU", False)], 300, cy=0.47)
Minv = cv2.invertAffineTransform(cam_matrix(T_LAND, ss=1, still=True))
TKw = cv2.warpAffine(TK, Minv, (W, H)); TRw = cv2.warpAffine(TR, Minv, (W, H))
tw = np.maximum(TKw, TRw).ravel()
tidx = np.nonzero(tw > 0.3)[0]
tprob = tw[tidx] / tw[tidx].sum()
tred = (TRw.ravel() > TKw.ravel()).astype(np.float32)

# ---------------------------------------------------------------- particles
cap = 1_300_000
P = {k: np.zeros(cap, np.float32) for k in ["x", "y", "vx", "vy", "born", "life", "w", "k", "red", "tx", "ty", "tred", "delay", "txt"]}
n = 0
last_spawn_t = -1e9

def spawn(sel_y, sel_x, t):
    global n
    reps = 5
    web = np.repeat(WEB[sel_y, sel_x], reps)
    yy = np.repeat(sel_y, reps).astype(np.float32) + rng.random(len(web), dtype=np.float32)
    xx = np.repeat(sel_x, reps).astype(np.float32) + rng.random(len(web), dtype=np.float32)
    keep = rng.random(len(xx)) < 0.05 + 0.95 * web
    xx, yy, web = xx[keep], yy[keep], web[keep]; m = len(xx)
    if n + m > cap: m = cap - n; xx, yy, web = xx[:m], yy[:m], web[:m]
    sl = slice(n, n + m)
    ox, oy = xx - CX, yy - CY
    shock = 1.7 * np.exp(-(t - T0) * 2.5) + 0.08          # shockwave on the drop
    ang = rng.uniform(0, 2 * np.pi, m).astype(np.float32)
    kick = rng.uniform(5, 50, m).astype(np.float32) * (1 + 2.5 * np.exp(-(t - T0) * 2.5))
    P["x"][sl] = xx; P["y"][sl] = yy
    P["vx"][sl] = np.cos(ang) * kick + ox * shock
    P["vy"][sl] = np.sin(ang) * kick * 0.6 + oy * shock * 0.6 - 10
    P["born"][sl] = t
    P["life"][sl] = rng.uniform(6.0, 11.0, m)
    P["w"][sl] = rng.uniform(0.4, 1.0, m) * (0.7 + 0.6 * web)
    P["k"][sl] = rng.uniform(0.5, 1.4, m)
    P["red"][sl] = (rng.random(m) < 0.035).astype(np.float32)
    n += m

def assign_targets():
    pick = tidx[rng.choice(len(tidx), n, p=tprob)]
    P["tx"][:n] = (pick % W).astype(np.float32) + rng.random(n, dtype=np.float32)
    P["ty"][:n] = (pick // W).astype(np.float32) + rng.random(n, dtype=np.float32)
    P["tred"][:n] = tred[pick]
    P["txt"][:n] = (rng.random(n) < min(1.0, 2.3 * len(tidx) / max(n, 1))).astype(np.float32)
    P["delay"][:n] = 0.55 * (P["tx"][:n] - P["tx"][:n].min()) / np.ptp(P["tx"][:n]) + rng.uniform(0, 0.25, n)
targets_done = False

# ---------------------------------------------------------------- static layers
yy_ = np.linspace(0, 1, OH, dtype=np.float32)[:, None]
band = 0.80 + 0.20 * np.clip(np.minimum(yy_ / 0.16, (1 - yy_) / 0.22), 0, 1) ** 0.8
xx_ = np.linspace(-1, 1, OW, dtype=np.float32)[None, :]
BG = (band * (1 - 0.07 * xx_ ** 2)).astype(np.float32)
EDGE = smooth(0.18, 0.48, np.abs(np.linspace(-0.5, 0.5, OW, dtype=np.float32)))[None, :]

def chroma(img, px):
    px = int(round(px))
    if px == 0: return img
    out = img.copy()
    out[:, :, 0] = np.roll(img[:, :, 0], px, axis=1); out[:, :, 2] = np.roll(img[:, :, 2], -px, axis=1)
    return out

# ---------------------------------------------------------------- title card
TITLE = [("LET", 0.0, False, 330), ("IT", 0.5, False, 330), ("BURN", 1.0, True, 470)]
title_masks = {w: text_layer([(w, red)], hgt) for w, _, red, hgt in TITLE}
tnoise = fbm(W, H, 4, 77, base=10); tnoise = (tnoise - tnoise.min()) / np.ptp(tnoise)
def title_frame(t):
    img = np.zeros((H, W, 3), np.float32)
    word, t0, red, _ = [x for x in TITLE if x[1] <= t][-1]
    k, r = title_masks[word]
    m = r if red else k
    dt = t - t0
    acc = np.zeros((H, W), np.float32)
    for sub in range(3):                                   # motion-blurred slam
        sc = 1 + 1.1 * np.exp(-(dt + sub / 90) * 16)
        M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, sc)
        acc += cv2.warpAffine(m, M, (W, H)) / 3
    acc *= smooth(0, 0.04, dt)
    if word == "BURN":                                     # burns away into the white flash
        acc *= (tnoise > smooth(1.55, 1.95, t) * 1.05)
        rim = ((tnoise < smooth(1.55, 1.95, t) * 1.05 + 0.06) & (acc > 0)).astype(np.float32)
        col = RED * (1 - rim[..., None]) + EMBER * 1.3 * rim[..., None]
        glow = cv2.GaussianBlur(acc, (0, 0), 25)
        img += acc[..., None] * col + glow[..., None] * RED * 0.8
    else:
        img += acc[..., None]
    img = chroma(img, 14 * np.exp(-dt * 10))
    img = img + smooth(1.85, 2.0, t)                       # white flash into the walk
    sh = 12 * np.exp(-dt * 10)
    M = np.float32([[1, 0, sh * np.sin(t * 91)], [0, 1, sh * np.cos(t * 77)]])
    return cv2.warpAffine(img, M, (W, H))

# ---------------------------------------------------------------- main loop
T_START = float(os.environ.get("T_START", 0)); T_END = float(os.environ.get("T_END", DUR))
out = f"{S}/v2_preview.mp4" if PREVIEW else f"{S}/v2_master.mov"
out = os.environ.get("OUT", out)
enc = (["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"] if PREVIEW
       else ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"])
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", *enc, out], stdin=subprocess.PIPE)
dt = 1.0 / FPS
SUB = 4
grain_r = np.random.default_rng(3)
for fi in range(NF):
    t = fi / FPS
    if t < T_START - 0.001 and t < T0 - 0.2:
        continue                                           # skip pre-drop frames in test renders
    if t > T_END: break
    write = t >= T_START - 0.001
    if t < T_WALK:
        img = title_frame(t)
    else:
        st = src_time(t)
        m = mask_src(st) if st is not None else np.zeros((H, W), np.float32)
        if t >= T0 - dt and t < 15.6:
            sel = (m > 0.5) & (R < t) & (R >= last_spawn_t)
            sy, sx = np.nonzero(sel)
            if len(sy): spawn(sy, sx, t)
            last_spawn_t = t
        solid = m * (R > t) if t >= T0 - dt else m
        if t >= 15.6: solid = solid * 0
        if t >= T_CONV0 and not targets_done:
            assign_targets(); targets_done = True
        M = cam_matrix(t, still=(t >= T_CONV0))
        accK = np.zeros(OW * OH, np.float32); accR = np.zeros(OW * OH, np.float32)
        if n:
            x = P["x"][:n]; y = P["y"][:n]; vx = P["vx"][:n]; vy = P["vy"][:n]
            age = t - P["born"][:n]
            alpha = P["w"][:n] * smooth(0, 0.12, age) * (1 - smooth(0.55, 1.0, age / P["life"][:n]))
            alpha *= 0.95 + 0.6 * np.exp(-age * 0.6)
            if targets_done:
                u = np.clip((t - T_CONV0 - P["delay"][:n]) / 0.95, 0, 1)
                e = np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2).astype(np.float32)
                txt = P["txt"][:n]
                alpha = alpha * (1 - e) + e * txt * (0.55 + 0.45 * P["w"][:n])
                red = P["red"][:n] * (1 - e) + e * P["tred"][:n]
            else:
                e = None; red = P["red"][:n]
            idx = np.nonzero(alpha > 0.01)[0]
            ph = t * 0.35; ca, sa = np.cos(ph), np.sin(ph)
            for s in range(SUB):
                h = dt / SUB
                xi = x[idx]; yi = y[idx]
                fx = sample(fa[0], xi, yi) * ca + sample(fb[0], xi, yi) * sa
                fy = sample(fa[1], xi, yi) * ca + sample(fb[1], xi, yi) * sa
                spd = 46.0 * P["k"][idx]
                ag = t - P["born"][idx]
                tx = fx * spd + (xi - CX) * (0.07 + 0.08 * np.minimum(ag, 4.0))
                ty = fy * spd * 0.7 + (yi - CY) * 0.03 - 7.0
                relax = 1 - np.exp(-1.3 * h)
                vx[idx] += (tx - vx[idx]) * relax; vy[idx] += (ty - vy[idx]) * relax
                x[idx] += vx[idx] * h; y[idx] += vy[idx] * h
                px_, py_ = x[idx], y[idx]
                if e is not None:
                    ei = e[idx]
                    jig = 0.6 * np.sin(t * 7 + idx * 0.37).astype(np.float32)
                    # curved path: swirl sideways mid-flight
                    sw = np.sin(np.pi * ei) * 60 * np.sign(np.sin(idx * 1.7)).astype(np.float32)
                    px_ = px_ * (1 - ei) + (P["tx"][idx] + jig) * ei
                    py_ = py_ * (1 - ei) + (P["ty"][idx] + jig) * ei + sw
                ox = M[0, 0] * px_ + M[0, 1] * py_ + M[0, 2]; oy = M[1, 0] * px_ + M[1, 1] * py_ + M[1, 2]
                ok = (ox >= 0) & (ox < OW - 1) & (oy >= 0) & (oy < OH - 1)
                ox, oy = ox[ok], oy[ok]; a = alpha[idx][ok] / SUB; rr = red[idx][ok]
                x0 = ox.astype(np.int32); y0 = oy.astype(np.int32); fx_ = ox - x0; fy_ = oy - y0
                b = y0 * OW + x0
                bb = np.concatenate([b, b + 1, b + OW, b + OW + 1])
                ww = np.concatenate([(1 - fx_) * (1 - fy_), fx_ * (1 - fy_), (1 - fx_) * fy_, fx_ * fy_]) * np.tile(a, 4)
                rw = np.tile(rr, 4)
                accK += np.bincount(bb, ww * (1 - rw), OW * OH)
                accR += np.bincount(bb, ww * rw, OW * OH)
        K = accK.reshape(OH, OW); Rd = accR.reshape(OH, OW)
        kk = 2.2 * (3.6 if SS > 1 else 1.3)
        img = np.repeat(BG[..., None], 3, axis=2)
        if n:
            D = K + Rd
            soft = cv2.GaussianBlur(D, (0, 0), 2.5 * SS)
            smear = cv2.blur(D, (int(45 * SS), 1))
            inkK = 1 - np.exp(-kk * K)
            inkK = 1 - (1 - inkK) * (1 - 0.3 * (1 - np.exp(-(1.0 / SS ** 2) * soft))) \
                             * (1 - 0.75 * (1 - np.exp(-(0.5 / SS ** 2) * smear)) * EDGE)
            img *= (1 - 0.975 * inkK)[..., None]
            inkR = 1 - np.exp(-kk * 2.0 * Rd)
            img = img * (1 - inkR[..., None]) + RED * inkR[..., None]
            g = 0.6 * (1 - np.exp(-(1.4 / SS ** 2) * cv2.GaussianBlur(Rd, (0, 0), 7 * SS)))
            img *= (1 - g[..., None] * (1 - np.array([1.0, 0.45, 0.4], np.float32)))
        # silhouette
        z, _, _, _, _, blur = cam(t)
        sol = cv2.warpAffine(solid.astype(np.float32), M, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        if blur > 0.3: sol = cv2.GaussianBlur(sol, (0, 0), blur * SS)
        sol = smooth(0.3, 0.7, sol) if blur <= 0.3 else smooth(0.15, 0.85, sol)
        glow = cv2.warpAffine((ridge * smooth(-0.6, 0.0, t - R) * (R > t)).astype(np.float32), M, (OW, OH)) if t > T0 - 0.8 else None
        body = np.full((OH, OW, 3), 0.015, np.float32)
        if glow is not None:
            body += glow[..., None] * EMBER * 1.4
        img = img * (1 - sol[..., None]) + body * sol[..., None]
        # solid end title firms up after landing, then everything fades to black
        if t >= T_LAND - 0.2:
            a = smooth(T_LAND - 0.2, T_LAND + 0.4, t) * 0.85
            tk = cv2.resize(TK, (OW, OH)); tr = cv2.resize(TR, (OW, OH))
            img = img * (1 - a * tk[..., None]) + 0.02 * a * tk[..., None]
            img = img * (1 - a * tr[..., None]) + RED * a * tr[..., None]
            gl = cv2.GaussianBlur(tr, (0, 0), 30 * SS) * pulse(t - T_LAND, 1.5)
            img *= (1 - 0.8 * gl[..., None] * (1 - np.array([1.0, 0.45, 0.4], np.float32)))
        if SS > 1:
            img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        # impact frames on the drop: 2 inverted frames, then RGB split decaying
        if T0 <= t < T0 + 2 * dt + 1e-6:
            img = 1 - img; img[..., 0] = np.minimum(1, img[..., 0] * 1.0 + 0.1)
        ca_ = 18 * pulse(t - T0, 6) + 6 * sum(pulse(t - c, 14) for c in CUTS[1:]) + 8 * pulse(t - T_LAND, 7)
        img = chroma(img, ca_)
        # one-frame white flash on the cuts
        for c in CUTS[1:]:
            if c <= t < c + dt: img = img * 0.35 + 0.65
        img = img * (1 - smooth(T_WALK, T_WALK + 0.15, t) * 0 + 0) + (1 - smooth(T_WALK, T_WALK + 0.2, t)) * (1 - img)
        img *= 1 - smooth(T_OUT, DUR - 0.15, t)
    img = img + grain_r.normal(0, 0.014, (H, W, 1)).astype(np.float32)
    if write:
        ff.stdin.write((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
    if fi % 30 == 0: print(f"t={t:.1f} particles={n}", flush=True)
ff.stdin.close(); ff.wait()
print("done", out)
