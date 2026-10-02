"""Measure a song for a film: tempo, the first downbeat, per-bar energy, the chord-cycle period,
clean edit seams, and a key estimate. numpy + imageio-ffmpeg only.

Usage: $PY beats.py <song.mp3> [--beats-per-bar 4]

Method: a spectral-flux onset envelope, autocorrelation for the tempo (octave prior around 120 BPM),
then a least-squares grid fit on local onset peaks. Onset times are corrected for the STFT's latency
by running the same pipeline on synthetic kicks at known times, a downbeat is picked by harmonic change
plus low-band energy, and seams A→B are scored by chroma similarity between the natural continuation
(A+1) and B.
"""
import argparse
import subprocess

import imageio_ffmpeg
import numpy as np

SR, HOP, NFFT = 22050, 128, 2048
FPS = SR / HOP
NAMES = 'C C# D D# E F F# G G# A A# B'.split()


def load(path):
    raw = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "quiet", "-i", path, "-ac", "1", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def stft_mag(x):
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * win, axis=1))


def onset_env(mag, lo=0, hi=SR / 2):
    f = np.fft.rfftfreq(NFFT, 1 / SR)
    L = np.log1p(100 * mag[:, (f >= lo) & (f < hi)])
    flux = np.r_[0, np.maximum(0, np.diff(L, axis=0)).sum(1)]
    k = int(0.5 * FPS)
    e = np.maximum(0, flux - np.convolve(flux, np.ones(k) / k, mode="same"))
    return e / (e.std() + 1e-9)


def latency():
    """Detected-minus-true onset offset of this pipeline, from synthetic kicks."""
    rng = np.random.default_rng(0)
    true = np.arange(1.0, 20.0, 0.5) + rng.uniform(0, 0.003, 38)
    x = np.zeros(int(21 * SR), np.float32)
    tt = np.arange(int(0.15 * SR)) / SR
    kick = (np.sin(2 * np.pi * (55 + 120 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 18)).astype(np.float32)
    for t in true:
        i = int(t * SR); x[i:i + len(kick)] += kick
    x += rng.normal(0, 0.002, len(x)).astype(np.float32)
    env = onset_env(stft_mag(x))
    det = [(int(t * FPS) - 40 + int(np.argmax(env[int(t * FPS) - 40:int(t * FPS) + 40]))) / FPS for t in true]
    return float(np.mean(np.array(det) - true))


def tempo(env, lo=60, hi=200):
    e = env - env.mean()
    ac = np.fft.irfft(np.abs(np.fft.rfft(e, 2 * len(e))) ** 2)[: len(e)]
    ac /= ac[0]
    bpm = 60 * FPS / np.maximum(np.arange(len(ac)), 1)
    prior = np.exp(-0.5 * (np.log2(bpm / 120) / 0.9) ** 2)
    lag = int(np.argmax(np.where((bpm >= lo) & (bpm <= hi), ac * prior, -np.inf)))
    a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
    return 60 * FPS / (lag + 0.5 * (a - c) / (a - 2 * b + c))


def grid_fit(env, bpm0):
    t_end = len(env) / FPS
    best = None
    for bpm in np.arange(bpm0 - 1.5, bpm0 + 1.5, 0.005):
        P = 60 / bpm
        for ph in np.linspace(0, P, 64, endpoint=False):
            g = np.clip(np.round(np.arange(ph, t_end, P) * FPS).astype(int), 0, len(env) - 1)
            s = env[g].mean()
            if best is None or s > best[0]:
                best = (s, bpm, ph)
    _, bpm, ph = best
    P, w = 60 / bpm, int(0.04 * FPS)
    xs, ys, ws = [], [], []
    for i, b in enumerate(np.arange(ph, t_end, P)):
        c = int(round(b * FPS)); lo, hi = max(0, c - w), min(len(env), c + w + 1)
        j = lo + int(np.argmax(env[lo:hi]))
        if env[j] > 1.0:
            xs.append(i); ys.append(j / FPS); ws.append(env[j])
    xs, ys, ws = map(np.array, (xs, ys, ws))
    A = np.stack([xs, np.ones_like(xs)], 1) * np.sqrt(ws)[:, None]
    (Pf, t0), *_ = np.linalg.lstsq(A, ys * np.sqrt(ws), rcond=None)
    resid = np.median(np.abs(ys - (xs * Pf + t0))) * 1000
    return 60 / Pf, t0 % Pf, Pf, resid, len(xs)


def chroma_frames(mag):
    f = np.fft.rfftfreq(NFFT, 1 / SR); band = (f > 60) & (f < 4000)
    pc = np.round(12 * np.log2(f[band] / 261.63)).astype(int) % 12
    ch = np.stack([(mag[:, band][:, pc == k] ** 2).sum(1) for k in range(12)], 1)   # power: magnitude sums flatten chroma
    return ch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--beats-per-bar", type=int, default=4)
    args = ap.parse_args()
    x = load(args.song)
    mag = stft_mag(x)
    env, low = onset_env(mag), onset_env(mag, 30, 150)
    lat = latency()
    bpm, t0_raw, P, resid, n = grid_fit(env, tempo(env))
    bpb = args.beats_per_bar
    ch = chroma_frames(mag)
    # downbeat: harmonic change + kick at each beat phase
    beats = np.round((t0_raw + P * np.arange(int((len(x) / SR - t0_raw) / P))) * FPS).astype(int)
    beats = beats[beats < len(ch) - 1]
    seg = [ch[a:b].mean(0) / (ch[a:b].sum() + 1e-9) for a, b in zip(beats[:-1], beats[1:])]
    nov = np.r_[0, [np.abs(seg[i] - seg[i - 1]).sum() for i in range(1, len(seg))]]
    kick = np.array([low[max(0, i - 3):i + 4].max() for i in beats[:-1]])
    nov, kick = nov / (nov.std() + 1e-9), kick / (kick.std() + 1e-9)
    scores = [float(nov[p::bpb].mean() + 0.5 * kick[p::bpb].mean()) for p in range(bpb)]
    phase = int(np.argmax(scores))
    bar0 = t0_raw + phase * P - lat
    BAR = bpb * P
    nbars = int((len(x) / SR - bar0) / BAR) + 1
    print(f"tempo      {bpm:.3f} BPM  (grid residual {resid:.1f} ms over {n} beats; STFT latency {lat * 1000:+.1f} ms removed)")
    print(f"downbeat   bar0 = {bar0:.4f} s   bar = {BAR:.5f} s   (phase votes {[round(s, 2) for s in scores]})")
    # per-bar features
    feats = {}
    for k in range(1, nbars + 1):
        a, b = bar0 + (k - 1) * BAR, bar0 + k * BAR
        ia, ib = int((a - (-lat)) * FPS), int((b - (-lat)) * FPS)
        if ib >= len(ch) or ia < 0:
            continue
        c = ch[ia:ib].sum(0); c /= np.linalg.norm(c) + 1e-9
        rms = float(np.sqrt(np.mean(x[int(a * SR):int(b * SR)] ** 2)))
        feats[k] = (c, rms)
    ks = sorted(feats)
    print("\nbar  start(s)  rms   (a drop in rms marks a breakdown; a jump marks a drop/section start)")
    for k in ks:
        print(f"{k:3d}  {bar0 + (k - 1) * BAR:8.3f}  {feats[k][1]:.3f}")
    sims = {}
    for d in range(1, 9):                       # skip distances with no bar pairs (short songs)
        pairs = [feats[k][0] @ feats[k + d][0] for k in ks if k + d in feats]
        if pairs:
            sims[d] = float(np.mean(pairs))
    period = max((4, 8, 2, 1), key=lambda d: (round(sims.get(d, 0), 2), -d))
    print("\nchord-cycle similarity by bar distance:", "  ".join(f"d={d}:{v:.2f}" for d, v in sims.items()))
    print(f"→ cycle period ≈ {period} bars: seams must keep (bar mod {period})")
    cands = []
    for A in ks:
        for B in ks:
            if B > A + 1 and A + 1 in feats and (A + 1 - B) % period == 0:
                cands.append((float(feats[A + 1][0] @ feats[B][0]), A, B))
    cands.sort(reverse=True)
    print("\nbest seams (after bar A, jump to bar B; chroma similarity of A+1 vs B; rms of A+1 → B):")
    for s, A, B in cands[:20]:
        print(f"  {A:3d} -> {B:3d}   {s:.3f}   rms {feats[A + 1][1]:.2f} → {feats[B][1]:.2f}")
    tot = sum(feats[k][0] ** 2 for k in ks)
    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    key = max([(np.corrcoef(np.roll(maj, k), tot)[0, 1], NAMES[k] + ' major') for k in range(12)]
              + [(np.corrcoef(np.roll(mnr, k), tot)[0, 1], NAMES[k] + ' minor') for k in range(12)])
    print(f"\nkey estimate: {key[1]} (r={key[0]:.2f}) — pick chime notes from it")
    print(f'\nmusic.json: "bar0": {bar0:.4f}, "bar": {BAR:.5f}')


if __name__ == "__main__":
    main()
