"""Score + SFX for BURN FOR YOU (120 bpm, F minor). writes raw 48k stereo wav (master afterwards)."""
import sys, numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
SR = 48000; DUR = 22.0; N = int(SR * DUR)
r = np.random.default_rng(4)
mix = np.zeros((2, N)); drums = np.zeros((2, N)); verb_send = np.zeros((2, N))
T_WALK, T_STAND, T_TAKE1, T_TAKE2, T_MAIN, T0, T_CONV0, T_LAND, T_OUT = 2.0, 5.0, 6.0, 8.0, 10.0, 13.0, 18.3, 20.0, 21.4
ACC1, ACC2 = 6.62, 8.70

def filt(x, f, kind, order=2): return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)
def place(buf, t, sig, gain=1.0, pan=0.0):
    i = int(t * SR); e = min(N, i + len(sig))
    if e <= i or i < 0: return
    buf[0, i:e] += sig[:e - i] * gain * np.sqrt(0.5 * (1 - pan)) * 1.414
    buf[1, i:e] += sig[:e - i] * gain * np.sqrt(0.5 * (1 + pan)) * 1.414
def tt(d): return np.arange(int(d * SR)) / SR

def kick(d=0.45, f0=160, f1=45):
    x = tt(d); f = f1 + (f0 - f1) * np.exp(-x * 30)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 7)
    s[:200] += r.standard_normal(200) * np.linspace(1, 0, 200) * 0.5
    return np.tanh(s * 2.2)
def clap(d=0.35):
    x = tt(d); n = filt(r.standard_normal(len(x)), [900, 6000], 'bandpass')
    env = np.exp(-x * 22)
    for o in (0.009, 0.018): env += np.exp(-np.clip(x - o, 0, None) * 60) * (x > o) * 0.6
    return n * env * 1.4 + np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30) * 0.5
def hat(d=0.06, open_=False):
    x = tt(0.25 if open_ else d); n = filt(r.standard_normal(len(x)), 7000, 'highpass')
    return n * np.exp(-x * (12 if open_ else 70)) * 0.45
def b808(note_hz, d, glide_from=None):
    x = tt(d); f = np.full(len(x), note_hz)
    if glide_from: f = note_hz + (glide_from - note_hz) * np.exp(-x * 9)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    s = np.tanh(s * 2.8) * 0.8                          # harmonics so it reads on phones
    return s * np.minimum(1, x / 0.004) * np.exp(-x * 0.9) * (1 - np.clip((x - d + 0.03) / 0.03, 0, 1))
def braam(hz, d=2.4):
    x = tt(d); s = np.zeros(len(x))
    for det in (-0.6, 0, 0.7):
        for h in (1, 2):
            s += (2 * ((x * hz * h * (1 + det / 100)) % 1) - 1) / h
    cut = 200 + 1800 * np.exp(-x * 3)
    out = np.zeros_like(s); y = 0.0
    a = 1 - np.exp(-2 * np.pi * cut / SR)              # time-varying one-pole lowpass (x2)
    for _ in range(2):
        out = np.empty_like(s); y = 0.0
        for i in range(0, len(s), 64):
            seg = s[i:i + 64]; ai = a[i]
            for j in range(len(seg)):
                y += ai * (seg[j] - y); out[i + j] = y
        s = out
    return np.tanh(s * 1.5) * np.minimum(1, x / 0.01) * np.exp(-x * 1.4)
def boom(d=3.0):
    x = tt(d); f = 28 + 60 * np.exp(-x * 4)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 1.1)
    n = filt(r.standard_normal(len(x)), 2500, 'lowpass') * np.exp(-x * 9) * 0.7
    return np.tanh((s + n) * 1.8)
def crash(d=2.5):
    x = tt(d); return filt(r.standard_normal(len(x)), 3000, 'highpass') * np.exp(-x * 2.2) * 0.5
def whoosh(d=0.6, rev=True):
    x = tt(d); n = r.standard_normal(len(x)); env = (x / d) ** 3 if rev else np.exp(-x * 8)
    lo = filt(n, [400, 4000], 'bandpass') * env
    return lo
def step(d=0.3):
    x = tt(d); s = np.sin(2 * np.pi * (60 + 40 * np.exp(-x * 40)) * x) * np.exp(-x * 18)
    g = filt(r.standard_normal(len(x)), [150, 2200], 'bandpass') * np.exp(-x * 35) * 0.6
    return s + g

F1, Ab1, Db1, Eb1, C2 = 43.65, 51.91, 34.65, 38.89, 65.41
# ---- title slams
for t0, hz in [(0.0, F1 * 2), (0.5, Ab1 * 2), (1.0, F1)]:
    place(mix, t0, braam(hz, 2.0 if t0 < 1 else 2.6), 0.75 if t0 < 1 else 1.0)
    place(drums, t0, boom(1.6 if t0 < 1 else 2.8), 0.8 if t0 < 1 else 1.0)
    place(drums, t0, clap(), 0.35)
place(mix, 1.4, whoosh(0.6), 0.25)
place(drums, 1.9, crash(1.5), 0.25)
# ---- walk: footsteps on every beat, ticking hats, dark pad
for i, t0 in enumerate(np.arange(T_WALK, T_STAND - 0.01, 0.5)):
    vol = 1.0 - 0.45 * i / 6
    place(drums, t0, step(), 0.9 * vol, pan=(-0.25 if i % 2 else 0.25) * vol)
for t0 in np.arange(T_WALK, T_TAKE1, 0.25):
    place(drums, t0, hat(), 0.35 if (t0 * 4) % 2 else 0.5, pan=0.3)
x = np.arange(N) / SR
pad = np.zeros(N)
for hz in (174.6, 207.7, 261.6, 87.3):
    for det in (-0.4, 0.4):
        pad += np.sin(2 * np.pi * hz * (1 + det / 100) * x + r.uniform(0, 6))
pad = filt(pad, 1200, 'lowpass')
def env(a, b, t): u = np.clip((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)
padenv = (0.15 + 0.35 * env(T_WALK, T_STAND, x)) * (1 - env(T_MAIN + 2.4, T0 - 0.25, x)) \
         + 0.45 * env(T0, T0 + 1, x) * (1 - env(T_CONV0, T_CONV0 + 0.8, x)) + 0.5 * env(T_LAND, T_LAND + 0.2, x) * (1 - env(T_OUT, DUR, x))
mix[0] += pad * padenv * 0.10; mix[1] += pad * padenv * 0.10
# ---- groove 5..10
def groove(start, end, halftime=False):
    bar = 2.0
    for b0 in np.arange(start, end - 0.01, bar):
        kicks = [0, 0.75, 1.25] if not halftime else [0, 0.75, 1.5]
        claps = [0.5, 1.5] if not halftime else [1.0]
        for k in kicks:
            if b0 + k < end: place(drums, b0 + k, kick(), 0.95)
        for c in claps:
            if b0 + c < end: place(drums, b0 + c, clap(), 0.75); place(verb_send, b0 + c, clap(), 0.3)
        hs = 0.25 if not halftime else 0.125
        for h in np.arange(0, bar, hs):
            if b0 + h < end:
                roll = halftime and (h > 1.5) and r.random() < 0.6
                place(drums, b0 + h, hat(), 0.4 + 0.15 * ((h / hs) % 2 == 0), pan=0.35)
                if roll: place(drums, b0 + h + hs / 2, hat(), 0.3, pan=0.35)
groove(T_STAND, T_MAIN)
for t0, hz, d, gl in [(5.0, F1, 0.7, None), (5.75, F1, 0.45, None), (6.25, Ab1, 0.7, None), (7.0, F1, 0.7, None),
                      (7.75, Eb1, 0.45, None), (8.25, Db1, 0.7, F1), (9.0, F1, 0.7, None), (9.75, C2, 0.25, None)]:
    place(mix, t0, b808(hz, d, gl), 0.95)
for c in (T_TAKE1, T_TAKE2, T_MAIN):
    place(mix, c - 0.5, whoosh(0.5), 0.35); place(drums, c, crash(1.6), 0.3)
for a in (ACC1, ACC2):
    place(drums, a, boom(1.2), 0.55); place(mix, a - 0.35, whoosh(0.35), 0.3)
# ---- build 10..13: snare roll accelerating, riser, filtered drop-out, silence gap
t0 = T_MAIN + 0.5; step_ = 0.5
while t0 < T0 - 0.26:
    v = 0.25 + 0.6 * (t0 - T_MAIN) / 3
    place(drums, t0, clap(0.2), v)
    if t0 > 11.5: step_ = 0.125 if t0 < 12.3 else 0.0625
    elif t0 > 11.0: step_ = 0.25
    t0 += step_
rx = np.arange(int((T0 - 0.25 - T_MAIN) * SR)) / SR
riser = filt(r.standard_normal(len(rx)), [500, 9000], 'bandpass') * (rx / rx[-1]) ** 2.5
tone = np.sin(2 * np.pi * np.cumsum(110 + 770 * (rx / rx[-1]) ** 2) / SR) * (rx / rx[-1]) ** 3
place(mix, T_MAIN, riser * 0.35 + tone * 0.18)
place(mix, T0 - 0.25, np.zeros(1))
# ---- DROP
place(drums, T0, boom(3.5), 1.3); place(mix, T0, braam(F1, 3.0), 1.0); place(drums, T0, crash(3.0), 0.45)
place(verb_send, T0, boom(1.0), 0.5)
groove(T0 + 0.0, T_CONV0, halftime=True)
for t0, hz, d, gl in [(13.0, F1, 1.2, F1 * 2), (13.75, F1, 0.6, None), (14.5, Ab1, 0.5, None), (15.0, F1, 1.2, None),
                      (15.75, Eb1, 0.6, None), (16.5, Db1, 0.5, Eb1), (17.0, F1, 1.0, None), (17.75, C2, 0.5, F1)]:
    place(mix, t0, b808(hz, d, gl), 1.0)
# ash grains spreading in stereo
for g in np.sort(r.uniform(T0, T_CONV0 + 0.5, 7000)):
    dens = (1 - env(T0 + 2, T_CONV0 + 0.5, g)) * 0.9 + 0.1
    if r.random() > dens: continue
    ln = int(r.integers(60, 400)); gr = r.standard_normal(ln) * np.hanning(ln) * r.uniform(.05, .3)
    place(mix, g, filt(gr, 2500, 'highpass') if ln > 30 else gr, 0.5, pan=float(np.clip((r.random() - .5) * 2 * min(1, (g - T0) / 2), -1, 1)))
# ---- converge: everything pulls back (reverse swell) -> LAND
sw = boom(1.7)[::-1] * 0.5 + crash(1.7)[::-1] * 0.8 + braam(F1 * 2, 1.7)[::-1] * 0.6
place(mix, T_LAND - 1.7, sw, 0.9)
place(drums, T_LAND, boom(3.0), 1.4); place(mix, T_LAND, braam(F1, 2.8), 1.1); place(drums, T_LAND, crash(2.5), 0.5)
place(mix, T_LAND, b808(F1, 1.8, F1 * 2), 1.0)
place(verb_send, T_LAND, braam(F1, 1.0), 0.4)

# ---- bus: reverb, glue
def ir(seed, d=2.6):
    rr = np.random.default_rng(seed); q = np.arange(int(SR * d)) / SR
    return filt(rr.standard_normal(len(q)), 5000, 'lowpass') * np.exp(-q * 2.4)
send = mix * 0.35 + verb_send
wet = np.stack([fftconvolve(send[0], ir(5))[:N], fftconvolve(send[1], ir(6))[:N]])
wet /= np.abs(wet).max() + 1e-9
out = mix + drums + wet * 0.35
out = filt(out, 25, 'highpass')
# pre-drop silence gap (sells the drop)
gap = 1 - env(T0 - 0.3, T0 - 0.24, x) * (1 - env(T0 - 0.01, T0, x))
out *= gap
out /= np.abs(out).max()
out = np.tanh(out * 2.0) / np.tanh(2.0)              # saturation glue
out *= (1 - env(T_OUT + 0.2, DUR, x))
wavfile.write(sys.argv[1], SR, (out.T * 0.9 * 32767).astype(np.int16))
print("ok")
