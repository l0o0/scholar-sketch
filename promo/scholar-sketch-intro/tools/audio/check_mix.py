#!/usr/bin/env python3
"""Check a mix_audio.py result by measurement (no listening): for every cue, the SFX stem's peak vs the
ducked music's peak around its audible landmark (both as they sit in the raw mix, before loudnorm), timing
error from evidence/audio-mix.json, master loudness, and an envelope timeline PNG with the cue marks.

Usage: .venv-audio/bin/python tools/audio/check_mix.py [--png evidence/audio/mix-timeline.png]
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf

PROJECT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('plan_cues', Path(__file__).with_name('plan_cues.py'))
plan_cues = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_cues)


def db(v):
    return round(20 * math.log10(v), 1) if v > 0 else -120.0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--png', type=Path)
    a = p.parse_args()
    rep = json.loads((PROJECT / 'evidence/audio-mix.json').read_text())
    plan = json.loads((PROJECT / 'plan.json').read_text())
    sfx, sr = sf.read(PROJECT / 'assets/sfx-stem.wav', always_2d=True)
    mus, _ = sf.read(PROJECT / 'assets/music-ducked.wav', always_2d=True)
    master, _ = sf.read(PROJECT / 'assets/master.wav', always_2d=True)
    se, me = np.abs(sfx).max(1), np.abs(mus).max(1)
    rows = []
    for cue, tm in zip(rep['cues'], rep['timing']):
        dur = sf.info(PROJECT / cue['file']).duration
        lm = tm['audibleLandmark']
        mark = next(sp[3] for sp in plan_cues.SPEC if sp[0] == cue['actionId'] and f'assets/sfx/{sp[1]}.wav' == cue['file'])
        lo, hi = plan_cues.sfx_window(mark, cue.get('kind'), lm, dur - cue.get('syncOffset', 0))
        i, j = int(lo * sr), int(hi * sr)
        s_pk, m_pk = float(se[i:j].max()), float(me[i:j].max())
        rows.append({'actionId': cue['actionId'], 'file': Path(cue['file']).name, 'landmark': round(lm, 3),
                     'errorFrames': tm['errorFrames'], 'sfxPeakDbfs': db(s_pk), 'duckedMusicPeakDbfs': db(m_pk),
                     'sfxOverMusicDb': round(db(s_pk) - db(m_pk), 1)})
    n = len(master)
    tail = master[int((plan['duration'] - 0.1) * sr):]
    out = {'normalization': rep['normalization']['normalization_type'],
           'masterOut': {k: rep['normalization']['output'][k] for k in ['output_i', 'output_tp', 'output_lra']},
           'maxAbsErrorFrames': max(abs(r['errorFrames']) for r in rows),
           'cuesBelowDuckedMusic': [r['actionId'] for r in rows if r['sfxOverMusicDb'] < -0.05],
           'masterLast100msPeakDbfs': db(float(np.abs(tail).max())), 'masterDuration': round(n / sr, 3), 'cues': rows}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    if a.png:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        hop = int(0.01 * sr)
        t = np.arange(0, n - hop, hop) / sr

        def env(x):
            e = np.abs(x).max(1)
            return np.array([20 * math.log10(max(1e-6, e[k:k + hop].max())) for k in range(0, n - hop, hop)])
        fig, ax = plt.subplots(figsize=(18, 4.2), dpi=100)
        ax.plot(t, env(mus), color='#9aa1a0', lw=0.7, label='music (ducked, ×0.65)')
        ax.plot(t, env(sfx), color='#2563eb', lw=0.7, label='SFX stem')
        for s in plan['shots']:
            ax.axvline(s['start'], color='#c9cfcc', lw=0.8)
            ax.text(s['start'] + 0.1, -8, s['id'], fontsize=7, color='#596066', rotation=90, va='top')
        for r in rows:
            ax.plot([r['landmark']], [r['sfxPeakDbfs']], marker='v', color='#c2413a', ms=4)
        ax.set_ylim(-60, 0)
        ax.set_xlim(0, plan['duration'])
        ax.set_xlabel('film seconds')
        ax.set_ylabel('peak dBFS (10 ms)')
        ax.legend(loc='lower left', fontsize=8)
        ax.set_title('Raw mix before loudnorm: ducked music vs SFX (red marks = cue landmarks)')
        fig.tight_layout()
        fig.savefig(a.png)


if __name__ == '__main__':
    main()
