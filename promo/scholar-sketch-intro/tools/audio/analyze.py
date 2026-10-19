#!/usr/bin/env python3
"""Measure a mix by eye (we cannot listen): per-second K-weighted loudness (BS.1770, 1 s blocks),
per-second sample peak, top peaks, spectral band balance, optional spectrum/loudness PNGs.

Usage: .venv-audio/bin/python tools/audio/analyze.py assets/music.wav [--json out.json]
         [--spectrum evidence/audio/music-spectrum.png] [--loudness-png evidence/audio/music-loudness.png]
         [--marks plan.json]   (draw shot boundaries on the loudness chart)
"""
import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

# ITU-R BS.1770 K-weighting at 48 kHz.
KS_B, KS_A = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
KH_B, KH_A = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 20000)]


def db(x):
    return round(10 * math.log10(x), 1) if x > 0 else None


def analyze(path, marks=None):
    x, sr = sf.read(path, always_2d=True)
    assert sr == 48000, 'expects 48 kHz'
    k = lfilter(KH_B, KH_A, lfilter(KS_B, KS_A, x, axis=0), axis=0)
    secs = int(math.ceil(len(x) / sr))
    rows = []
    for s in range(secs):
        seg = k[s * sr:(s + 1) * sr]
        raw = x[s * sr:(s + 1) * sr]
        ms = float((seg ** 2).mean(0).sum()) if len(seg) else 0
        lufs = -0.691 + 10 * math.log10(ms) if ms > 0 else None
        pk = float(np.abs(raw).max()) if len(raw) else 0
        rows.append({'sec': s, 'lufs1s': round(lufs, 1) if lufs is not None else None,
                     'peakDbfs': round(20 * math.log10(pk), 1) if pk > 0 else None})
    # gated integrated loudness (400 ms blocks, 75 % overlap)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    ls = []
    for i in range(0, len(k) - blk, hop):
        ms = float((k[i:i + blk] ** 2).mean(0).sum())
        if ms > 0:
            ls.append(-0.691 + 10 * math.log10(ms))
    ls = np.array(ls)
    abs_g = ls[ls > -70]
    rel = -0.691 + 10 * math.log10(np.mean(10 ** ((abs_g + 0.691) / 10))) - 10
    gated = abs_g[abs_g > rel]
    integ = -0.691 + 10 * math.log10(np.mean(10 ** ((gated + 0.691) / 10)))
    # spectral band balance (energy share), whole file
    mono = x.mean(1)
    spec = np.abs(np.fft.rfft(mono)) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1 / sr)
    tot = spec[(freqs >= 20)].sum()
    bands = {f'{lo}-{hi}': round(100 * float(spec[(freqs >= lo) & (freqs < hi)].sum() / tot), 1) for lo, hi in BANDS}
    env = np.abs(x).max(1)
    order = np.argsort(env)[::-1]
    top, used = [], []
    for i in order:
        t = i / sr
        if all(abs(t - u) > 0.25 for u in used):
            used.append(t)
            top.append({'t': round(t, 3), 'dbfs': round(20 * math.log10(env[i]), 1)})
        if len(top) == 8:
            break
    return {'file': str(path), 'duration': round(len(x) / sr, 3), 'integratedLufs': round(float(integ), 2),
            'samplePeakDbfs': round(20 * math.log10(float(env.max())), 2), 'bandEnergyPercent': bands,
            'lowEndBelow120HzPercent': round(bands['20-60'] + bands['60-120'], 1),
            'topPeaks': top, 'perSecond': rows}


def spectrum_png(path, out):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-lavfi',
                    'showspectrumpic=s=1600x500:scale=log:fscale=log:legend=1', str(out)], check=True)


def ltas_png(path, out):
    """Long-term average spectrum (Welch, 16384-point) with a pink (−3 dB/oct) reference through 500 Hz:
    a low end that rises well above the pink line would read as heavy."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from scipy.signal import welch
    x, sr = sf.read(path, always_2d=True)
    f, pxx = welch(x.mean(1), fs=sr, nperseg=16384)
    keep = (f >= 20) & (f <= 20000)
    f, pxx = f[keep], pxx[keep]
    # 1/3-octave smoothing (power average) so harmonics do not hide the overall tilt
    sm = np.array([pxx[(f >= fc / 2 ** (1 / 6)) & (f < fc * 2 ** (1 / 6))].mean() for fc in f])
    raw, pxx = 10 * np.log10(pxx + 1e-20), 10 * np.log10(sm + 1e-20)
    ref = pxx[np.argmin(abs(f - 500))] - 10 * np.log10(f / 500)
    fig, ax = plt.subplots(figsize=(10, 4), dpi=100)
    ax.semilogx(f, raw, color='#c9cfcc', lw=0.6, label='long-term average spectrum (raw)')
    ax.semilogx(f, pxx, color='#1a2527', lw=1.4, label='1/3-octave smoothed')
    ax.semilogx(f, ref, color='#718b7a', lw=1, ls='--', label='pink reference (−3 dB/oct) through 500 Hz')
    for edge in (60, 120, 250):
        ax.axvline(edge, color='#c9cfcc', lw=0.8)
    ax.set_xlim(20, 20000)
    ax.set_ylim(pxx.max() - 90, pxx.max() + 6)
    ax.set_xlabel('Hz')
    ax.set_ylabel('dB')
    ax.legend(fontsize=8)
    ax.set_title(Path(path).name + ' — long-term spectrum')
    fig.tight_layout()
    fig.savefig(out)


def loudness_png(rep, out, plan=None):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    rows = rep['perSecond']
    xs = [r['sec'] + 0.5 for r in rows]
    fig, ax = plt.subplots(figsize=(16, 4), dpi=100)
    ax.step(xs, [r['lufs1s'] if r['lufs1s'] is not None else -70 for r in rows], where='mid', label='1 s K-weighted loudness (LUFS)', color='#1a2527')
    ax.step(xs, [r['peakDbfs'] if r['peakDbfs'] is not None else -70 for r in rows], where='mid', label='1 s sample peak (dBFS)', color='#718b7a')
    ax.axhline(rep['integratedLufs'], color='#2563eb', lw=0.8, ls='--', label=f"integrated {rep['integratedLufs']} LUFS")
    if plan:
        for s in plan['shots']:
            ax.axvline(s['start'], color='#c9cfcc', lw=0.8)
            ax.text(s['start'] + 0.1, -12, s['id'], fontsize=7, color='#596066', rotation=90, va='bottom')
    ax.set_ylim(-60, 0)
    ax.set_xlim(0, rep['duration'])
    ax.set_xlabel('film seconds')
    ax.legend(loc='lower left', fontsize=8)
    ax.set_title(Path(rep['file']).name)
    fig.tight_layout()
    fig.savefig(out)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('file', type=Path)
    p.add_argument('--json', type=Path)
    p.add_argument('--spectrum', type=Path)
    p.add_argument('--loudness-png', type=Path)
    p.add_argument('--marks', type=Path)
    p.add_argument('--ltas', type=Path)
    p.add_argument('--brief', action='store_true')
    a = p.parse_args()
    rep = analyze(a.file)
    if a.json:
        a.json.write_text(json.dumps(rep, ensure_ascii=False, indent=2) + '\n')
    if a.spectrum:
        spectrum_png(a.file, a.spectrum)
    if a.ltas:
        ltas_png(a.file, a.ltas)
    if a.loudness_png:
        loudness_png(rep, a.loudness_png, json.loads(a.marks.read_text()) if a.marks else None)
    if a.brief:
        print(json.dumps({k: v for k, v in rep.items() if k != 'perSecond'}, ensure_ascii=False))
        print(' '.join(f"{r['sec']}:{r['lufs1s']}/{r['peakDbfs']}" for r in rep['perSecond']))
    else:
        print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
