import sys, numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
SR = 48000; DUR = 10.6; T0 = 3.03
t = np.arange(int(SR * DUR)) / SR
r = np.random.default_rng(1)
def env(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'bandpass', fs=SR, output='sos'), x)
def lp(x, f): return sosfilt(butter(2, f, 'lowpass', fs=SR, output='sos'), x)
L = np.zeros_like(t); Rr = np.zeros_like(t)
# drone: detuned fifths, slow beating
dr = sum(np.sin(2*np.pi*f*t + p) * a for f, p, a in [(55, 0, 1), (55.4, 1, .8), (82.4, 2, .5), (110.2, .3, .25), (164.8, 1.2, .12)])
dr *= (0.15 + 0.25 * env(0, 2.5, t) + 0.25 * env(2.8, 3.2, t)) * (1 - env(8.2, 10.5, t))
L += dr * 0.22; Rr += dr * 0.22
# riser: noise band sweeping up under the slow-mo arm raise
n = r.standard_normal(len(t))
sweep = np.zeros_like(t)
seg = (t > 1.0) & (t < T0 + 0.05)
for lo, hi in [(300, 900), (900, 2500), (2500, 7000)]:
    sweep += bp(n, lo, hi) * env(lo / 1500 + 0.8, T0 - 0.1, t)
sweep *= env(1.0, T0, t) ** 2 * seg
tone = np.sin(2*np.pi*np.cumsum(220 + 440 * env(1.2, T0, t)) / SR) * env(1.2, T0, t) ** 3 * seg * 0.15
L += (sweep * 0.12 + tone); Rr += (sweep * 0.12 + tone)
# hit: sub drop + transient
k = t >= T0; tk = t[k] - T0
sub = np.sin(2*np.pi*np.cumsum(70 * np.exp(-tk * 3) + 32) / SR) * np.exp(-tk * 1.6)
trans = lp(r.standard_normal(k.sum()), 3500) * np.exp(-tk * 18)
L[k] += sub * 0.9 + trans * 0.35; Rr[k] += sub * 0.9 + trans * 0.35
# ash: granular crackle + wind, spreading outward in stereo
grains = np.zeros((2, len(t)))
gstart = int(T0 * SR); gend = int(9.5 * SR)
times = np.sort(r.uniform(gstart, gend, 9000).astype(int))
for g in times:
    tg = g / SR
    dens = env(T0, T0 + 0.6, tg) * (1 - env(5.0, 9.5, tg))
    if r.random() > dens: continue
    ln = r.integers(60, 500)
    gr = r.standard_normal(ln) * np.hanning(ln) * r.uniform(.1, .5)
    spread = min(1, (tg - T0) / 3)
    pan = 0.5 + (r.random() - .5) * spread
    e = min(g + ln, len(t)); grains[0, g:e] += gr[:e-g] * np.sqrt(1 - pan); grains[1, g:e] += gr[:e-g] * np.sqrt(pan)
grains = np.stack([bp(grains[0], 1500, 9000), bp(grains[1], 1500, 9000)])
wind = np.stack([bp(r.standard_normal(len(t)), 200, 1400), bp(r.standard_normal(len(t)), 200, 1400)])
wenv = env(T0 - 0.2, T0 + 1.0, t) * (1 - env(6.5, 10.4, t)) * (0.6 + 0.4 * np.sin(2*np.pi*0.3*t))
L += grains[0] * 0.5 + wind[0] * wenv * 0.08; Rr += grains[1] * 0.5 + wind[1] * wenv * 0.08
# reverb: decaying-noise IR, different per side for width
def ir(seed):
    rr = np.random.default_rng(seed); x = np.arange(int(SR * 2.4)) / SR
    return lp(rr.standard_normal(len(x)), 6000) * np.exp(-x * 2.6)
wetL = fftconvolve(L, ir(5))[:len(t)]; wetR = fftconvolve(Rr, ir(6))[:len(t)]
wetL /= np.abs(wetL).max(); wetR /= np.abs(wetR).max()
mx = max(np.abs(L).max(), np.abs(Rr).max())
L = L / mx * 0.8 + wetL * 0.22; Rr = Rr / mx * 0.8 + wetR * 0.22
st = np.stack([L, Rr], 1)
st *= env(0, 0.3, t)[:, None] * (1 - env(DUR - 0.5, DUR, t))[:, None]
st = np.tanh(st * 1.3) / np.tanh(1.3)          # soft-clip glue
st = st / np.abs(st).max() * 0.89               # ~ -1 dBFS peak
wavfile.write(sys.argv[1], SR, (st * 32767).astype(np.int16))
