"""Builds <film>/audio.wav: the music edit from music.json plus UI sounds from events.json.

Usage: $PY audio.py <film-dir>

music.json:
  song         path to the track, relative to the film dir
  bar0, bar    measured first downbeat and bar length in seconds (from beats.py)
  edit         [[fromBar, toBar], ...] song bar ranges, 1-based and inclusive, played in order;
               the last range may run past the song end, and it is padded to `length`
  length       film length in seconds
  seam_ms      equal-power crossfade at each seam, starting on the previous range's natural continuation
  ui_db_under  UI sounds sit this many dB under the track RMS (default 18)
  end_fade     seconds of fade at the very end (lets the last hit ring out)
  chime_hz     [f1, f2] the chime's two notes in Hz (default F#5, B5); pick notes in the song's key

events.json (written by `render.mjs --events` from window.SOUND_EVENTS): [{"t", "kind", "gainDb"?}]
  kinds: tap, soft, tick, pop, chime. Each snaps to the strongest music onset within 40 ms.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

SR = 48000
rng = np.random.default_rng(11)


def load(path):
    raw = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "quiet", "-i", str(path), "-ac", "2",
                          "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def build_music(song, cfg):
    bar0, bar, length = cfg["bar0"], cfg["bar"], cfg["length"]
    at = lambda k: int(round((bar0 + (k - 1) * bar) * SR))
    out = np.zeros((int(length * SR), 2))
    s = int(cfg.get("seam_ms", 30) / 1000 * SR)
    ramp = np.linspace(0, 1, s)[:, None]
    pos = 0
    edit = cfg["edit"]
    for i, (a, b) in enumerate(edit):
        n = len(out) - pos if i == len(edit) - 1 else int(round((b - a + 1) * bar * SR))
        seg = song[at(a):at(a) + n].copy()
        if len(seg) < n:
            seg = np.vstack([seg, np.zeros((n - len(seg), 2))])
        if i > 0 and s:
            cont = song[at(edit[i - 1][1] + 1):at(edit[i - 1][1] + 1) + s]
            if len(cont) == s:
                seg[:s] = cont * np.cos(ramp * np.pi / 2) + seg[:s] * np.sin(ramp * np.pi / 2)
        out[pos:pos + n] = seg[:len(out) - pos]
        pos += n
        if pos >= len(out):
            break
    fade = int(cfg.get("end_fade", 1.2) * SR)
    if fade:
        out[-fade:] *= np.cos(np.linspace(0, 1, fade) * np.pi / 2)[:, None] ** 2
    head = int(0.012 * SR)
    out[:head] *= np.linspace(0, 1, head)[:, None]
    return out


def onset_env(mono, hop=240):
    frames = mono[: len(mono) // hop * hop].reshape(-1, hop)
    e = np.log(np.sqrt((frames ** 2).mean(1)) + 1e-6)
    return np.r_[0, np.maximum(0, np.diff(e))], hop


def snap(t, env, hop, win=0.040):
    c, w = int(t * SR / hop), int(win * SR / hop)
    lo, hi = max(0, c - w), min(len(env), c + w + 1)
    return (lo + int(np.argmax(env[lo:hi]))) * hop / SR if hi > lo else t


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.clip(t / max(attack, 1e-5), 0, 1) * np.exp(-t / decay)


def sine(freq, n):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(freq(t)) / SR) if callable(freq) else np.sin(2 * np.pi * freq * t)


def bandnoise(n, lo, hi):
    spec = np.fft.rfft(rng.normal(0, 1, n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(spec, n)
    return y / (np.abs(y).max() + 1e-9)


def s_tap(soft=False):
    n = int(0.09 * SR)
    body = sine(lambda t: 170 + 90 * np.exp(-t / 0.012), n) * env(n, 0.0006, 0.022)
    tock = sine(1150, n) * env(n, 0.0004, 0.009) * 0.45
    click = bandnoise(n, 2200, 7000) * env(n, 0.0002, 0.0025) * (0.0 if soft else 0.35)
    return body + tock * (0.55 if soft else 1.0) + click


def s_tick():
    n = int(0.03 * SR)
    return sine(3600, n) * env(n, 0.0002, 0.0018) + bandnoise(n, 3000, 9000) * env(n, 0.0001, 0.0009) * 0.4


def s_pop():
    n = int(0.12 * SR)
    return sine(lambda t: 520 + 380 * np.exp(-t / 0.02), n) * env(n, 0.001, 0.04) * 0.8


def s_chime(f1=739.99, f2=987.77):
    """Two bell notes an eighth note apart at 120 BPM (0.25 s). Default F#5 → B5."""
    n = int(1.4 * SR)
    bell = lambda f0: (sine(f0, n) * env(n, 0.003, 0.55) + sine(f0 * 2.0, n) * env(n, 0.002, 0.25) * 0.28
                       + sine(f0 * 2.76, n) * env(n, 0.001, 0.12) * 0.12)
    out = np.zeros(n + int(0.26 * SR))
    out[:n] += bell(f1)
    out[int(0.25 * SR):int(0.25 * SR) + n] += bell(f2) * 0.9
    return out


SYNTH = {"tap": s_tap, "soft": lambda: s_tap(True), "tick": s_tick, "pop": s_pop, "chime": s_chime}


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


def main():
    film = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    cfg = json.loads((film / "music.json").read_text())
    if "chime_hz" in cfg:
        SYNTH["chime"] = lambda: s_chime(*cfg["chime_hz"])
    music = build_music(load(film / cfg["song"]), cfg)
    onsets, hop = onset_env(music.mean(1))
    track_rms = rms(music[: max(1, len(music) - int(4 * SR))])
    ev_path = film / "events.json"
    events = json.loads(ev_path.read_text()) if ev_path.exists() else []
    ui = np.zeros(len(music))
    under = cfg.get("ui_db_under", 18)
    for ev in events:
        x = SYNTH[ev["kind"]]()
        x = x * (track_rms * 10 ** (-(under + ev.get("gainDb", 0)) / 20) / rms(x[: int(0.05 * SR)]))
        peak = int(np.argmax(np.abs(x[: int(0.05 * SR)])))
        start = int(round(snap(ev["t"], onsets, hop) * SR)) - peak
        end = min(len(ui), start + len(x))
        if end > max(0, start):
            ui[max(0, start):end] += x[max(0, -start):end - start]
    mix = music + ui[:, None]
    mix *= 10 ** (-1 / 20) / np.abs(mix).max()
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
    with wave.open(str(film / "audio.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(f"audio.wav: {len(mix) / SR:.2f}s, {len(events)} UI sounds, track RMS {20 * np.log10(track_rms):.1f} dBFS")


if __name__ == "__main__":
    main()
