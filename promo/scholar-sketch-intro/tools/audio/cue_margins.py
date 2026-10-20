#!/usr/bin/env python3
"""Per-cue in-band margins of a mix_audio.py result (measurement only, no listening).

For every cue in evidence/audio-mix.json, compares the SFX stem with the ducked music stem (both as they sit
in the raw mix, before loudnorm; mono = (L+R)/2) over the cue's audible moment:
  window      onset cues: 50 ms from landmark − 2 ms; sweeps (page-turn / paper-slide / brush): ±80 ms around the
              measured peak (the review's windows, scratchpad review1/rhythm/scripts/audio4.py); paper-drag (onset-
              aligned friction): its first 150 ms
  domBandDb   SFX − music energy in the 1/3 octave around the SFX's dominant FFT bin (the review's "bandSNR")
  bestBandDb  the largest SFX − music difference over 1/3-octave bands 200 Hz–8 kHz in which the SFX carries
              real energy (≥ its strongest band − 15 dB): the band the cue is heard in
  contactDb   the contact / transient layer: SFX vs music level in 2–5 kHz over the 6 ms around the SFX's own 2–5 kHz
              peak (first 30 ms). The Hann windows above start 2 ms before the landmark, so they all but hide an onset
              transient (−36 dB taper at 2 ms); this one does not
  broadDb     SFX − music, all bands; peakDb: SFX peak − ducked-music peak over the same window
  pianoOnsetsMs  score note attacks (assets/audio/score.py --onsets) within ±60 ms of the landmark
Typing cues also list every keystroke (from tools/audio/make_film_sfx.py key schedules) with its own margins
(same 50 ms window from each key − 2 ms; it may include the next key, which is the burst as heard).

Usage: .venv-audio/bin/python tools/audio/cue_margins.py [--out evidence/audio-cue-margins.json] [--stems DIR]
"""
import argparse
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

PROJECT = Path(__file__).resolve().parents[2]
SWEEPS = {'page-turn', 'paper-slide', 'brush'}
TARGET_DB = 10.0


def load_mod(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def edb(x):
    return 10 * math.log10(float(x) + 1e-20)


def bands_third_octave(lo=200.0, hi=8000.0):
    out, c = [], 1000.0 * 2 ** (round(3 * math.log2(lo / 1000.0)) / 3)
    while c <= hi * 1.01:
        out.append((c / 2 ** (1 / 6), c, c * 2 ** (1 / 6)))
        c *= 2 ** (1 / 3)
    return out


BANDS = bands_third_octave()


def margins(S, M, sr, a, b):
    s, m = S[a:b], M[a:b]
    n = len(s)
    w = np.hanning(n)
    Xs = np.abs(np.fft.rfft(s * w)) ** 2
    Xm = np.abs(np.fft.rfft(m * w)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    dom = float(f[np.argmax(Xs)])
    sel = (f >= dom / 2 ** (1 / 3)) & (f <= dom * 2 ** (1 / 3))
    rows = []
    for lo, c, hi in BANDS:
        k = (f >= lo) & (f < hi)
        rows.append((c, edb(Xs[k].sum()), edb(Xm[k].sum())))
    smax = max(r[1] for r in rows)
    best = max((r for r in rows if r[1] >= smax - 15), key=lambda r: r[1] - r[2])
    return {'domHz': round(dom), 'domBandDb': round(edb(Xs[sel].sum()) - edb(Xm[sel].sum()), 1),
            'bestBandHz': round(best[0]), 'bestBandDb': round(best[1] - best[2], 1),
            'broadDb': round(edb(Xs.sum()) - edb(Xm.sum()), 1),
            'peakDb': round(20 * math.log10((np.abs(s).max() + 1e-12) / (np.abs(m).max() + 1e-12)), 1)}


def contact_db(Sb, Mb, sr, L):
    i = int((L - 0.002) * sr)
    k = i + int(np.argmax(np.abs(Sb[i:i + int(0.03 * sr)])))
    w = int(0.006 * sr)
    a = max(i, k - w // 2)
    return round(edb((Sb[a:a + w] ** 2).mean()) - edb((Mb[a:a + w] ** 2).mean()), 1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--out', type=Path)
    p.add_argument('--stems', type=Path, default=PROJECT / 'assets', help='dir with sfx-stem.wav and music-ducked.wav')
    p.add_argument('--report', type=Path, default=PROJECT / 'evidence/audio-mix.json')
    p.add_argument('--onsets-json', type=Path, help='a JSON list of music onset times (default: score.py --onsets)')
    a = p.parse_args()
    rep = json.loads(a.report.read_text())
    S, sr = sf.read(a.stems / 'sfx-stem.wav', always_2d=True)
    M, _ = sf.read(a.stems / 'music-ducked.wav', always_2d=True)
    S, M = S.mean(1), M.mean(1)
    from scipy.signal import butter, sosfiltfilt
    sos = butter(4, [2000, 5000], 'band', fs=sr, output='sos')
    Sb, Mb = sosfiltfilt(sos, S), sosfiltfilt(sos, M)
    py = str(PROJECT / '.venv-audio/bin/python') if (PROJECT / '.venv-audio/bin/python').exists() else sys.executable
    if a.onsets_json:
        onsets = json.loads(a.onsets_json.read_text())
    else:
        onsets = json.loads(subprocess.run([py, str(PROJECT / 'assets/audio/score.py'), '--onsets'], capture_output=True, text=True,
                                           check=True).stdout)['piano']
    onsets = np.array(onsets)
    sfxmod = load_mod('make_film_sfx', PROJECT / 'tools/audio/make_film_sfx.py')
    rows = []
    for cue, tm in zip(rep['cues'], rep['timing']):
        name = Path(cue['file']).stem
        L = tm['audibleLandmark']
        if name in SWEEPS:
            i, j = int((L - 0.08) * sr), int((L + 0.08) * sr)
        elif name == 'paper-drag':
            i, j = int((L - 0.002) * sr), int((L + 0.15) * sr)
        else:
            i = int((L - 0.002) * sr)
            j = i + int(0.05 * sr)
        r = {'actionId': cue['actionId'], 'file': name, 'landmark': round(L, 3), 'errorFrames': tm['errorFrames'],
             'gain': cue.get('gain'), **margins(S, M, sr, i, j), 'contactDb': contact_db(Sb, Mb, sr, L),
             'pianoOnsetsMs': [round(float(x - L) * 1000) for x in onsets if abs(x - L) <= 0.06]}
        keys = getattr(sfxmod, 'key_schedule', lambda n: None)(name)
        if keys:
            start = cue['at']
            kr = []
            for k_at, _lvl in keys:
                t = start + k_at
                ki = int((t - 0.002) * sr)
                m = margins(S, M, sr, ki, ki + int(0.05 * sr))     # the same 50 ms window as the cue's
                kr.append({'t': round(t, 3), 'domBandDb': m['domBandDb'], 'bestBandDb': m['bestBandDb'], 'broadDb': m['broadDb']})
            r['keys'] = kr
            r['keysMinDomBandDb'] = min(k['domBandDb'] for k in kr)
            r['keysMedianDomBandDb'] = float(np.median([k['domBandDb'] for k in kr]))
        r['meetsTarget'] = r['domBandDb'] >= TARGET_DB
        rows.append(r)
    doc = {'method': 'tools/audio/cue_margins.py on assets/sfx-stem.wav vs assets/music-ducked.wav (raw mix, before loudnorm); '
                     'see the script docstring for the windows and bands. Measurement only, not listened to.',
           'targetDb': TARGET_DB, 'target': 'domBandDb (the review\'s in-band margin) >= targetDb for every cue',
           'cuesBelowTarget': [r['actionId'] for r in rows if not r['meetsTarget']],
           'cuesBestBandBelowTarget': [r['actionId'] for r in rows if r['bestBandDb'] < TARGET_DB],
           'cuesWithPianoOnsetWithin13ms': [r['actionId'] for r in rows if any(abs(x) <= 13 for x in r['pianoOnsetsMs'])],
           'cues': rows}
    if a.out:
        a.out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    for r in rows:
        print(f"{r['actionId']:16s} {r['landmark']:7.3f} {r['file']:14s} dom {r['domHz']:5d} {r['domBandDb']:6.1f}  best {r['bestBandHz']:5d} "
              f"{r['bestBandDb']:6.1f}  contact {r['contactDb']:6.1f}  broad {r['broadDb']:6.1f}  pk {r['peakDb']:5.1f}  piano {r['pianoOnsetsMs']}"
              + (f"  keys min/median {r['keysMinDomBandDb']}/{r['keysMedianDomBandDb']}" if 'keys' in r else ''))
    print('below target (domBand):', doc['cuesBelowTarget'])
    print('best band below target:', doc['cuesBestBandBelowTarget'])
    print('piano onset within 13 ms:', doc['cuesWithPianoOnsetWithin13ms'])


if __name__ == '__main__':
    main()
