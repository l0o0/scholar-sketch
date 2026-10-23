#!/usr/bin/env python3
"""Build audio.cues for every soundRequired action (plus the optional entry-items pops) from measurements.

1. Landmarks: the skill's scripts/sfx_landmarks.py on each file (onset for clicks/keys/pops/drops/ticks and
   the paper drag, peak for page-turn / paper-slide / brush). syncOffset = landmark, at = actionTime − syncOffset (ms).
2. Gains: the music is ducked with mix_audio.py's own envelope (its duck_windows, deepest wins, 5 ms
   frames) × plan music gain; the SFX's window peak over that ducked music + a per-role margin, minus the
   file's measured peak and minus the −3 dB that mix_audio.py's mono→stereo upmix costs a mono file,
   gives the gain, rounded up, clamped to (0.25, 4]. A cue that cannot reach the music at gain 4 gets a
   slightly deeper duck (+0.5 dB steps, ≤ +2.5 dB over its preset). Every cue reports its margin.
3. Typing bursts and the paper drag hold their duck for the file's own length (the files follow the picture's
   input schedule / drag length, tools/audio/make_film_sfx.py), so the duck follows a rebuilt file.
4. In-band: the review (2026-10-19) asks for ≥ 10 dB in the SFX's own band. For every cue the SFX (at gain 1,
   placed as mix_audio.py's adelay places it) and the ducked music are compared over the review's window (50 ms
   from landmark − 2 ms; ±80 ms around the peak of page-turn / paper-slide / brush; the first 150 ms of
   paper-drag), Hann, in the ±1/3-octave band around the SFX's dominant bin; the gain is raised (≤ +6 dB over
   the peak rule, ≤ 4) until that margin is ≥ 10.5 dB; if the cap stops a click / toggle / pop, its duck
   deepens instead (a typing burst keeps its duck: 1.4 s of deeper ducking would pump).
   tools/audio/cue_margins.py measures the same thing on the actual mix.
Usage: .venv-audio/bin/python tools/audio/plan_cues.py [--out evidence/audio-cues.proposed.json] [--apply plan.json]
       (--apply writes the cues into that plan's audio.cues — only in a scratch copy of the project)
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf

PROJECT = Path(__file__).resolve().parents[2]
SKILL = Path('/root/.claude/skills/guizang-product-video-skill')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


landmarks = load('sfx_landmarks', SKILL / 'scripts/sfx_landmarks.py').landmarks
MIX = load('mix_audio', SKILL / 'scripts/mix_audio.py')
DUCK_PRESETS = MIX.DUCK_PRESETS
IN_BAND_DB = 10.0           # the review's target
IN_BAND_SAFETY = 0.5
IN_BAND_MAX_BOOST_DB = 6.0  # over the peak rule's gain

# actionId, file, kind (mix_audio DUCK_PRESETS name), landmark, margin over ducked music (dB), duck override, why
SPEC = [
    ('brand-fold', 'logo-fold', 'click', 'onset', -3, None, 'logo corner folds in: 75 ms paper flick, 2–6 kHz, above the score\'s F4 (DIRECTION #1 1.20 轻纸声)'),
    ('entry-click', 'click', 'click', 'onset', 1, None, 'cursor clicks the toolbar button'),
    ('entry-items', 'pop-pair', 'pop', 'onset', 0, None, 'optional, not soundRequired: the two menu rows appear 4.40 / 4.60 (DIRECTION #2 两声极轻 pop)'),
    ('drop-grab', 'paper-slide', 'sweep', 'peak', 0, {'hold': 0.35}, 'drag start: the paper row is picked up and slides'),
    ('drop-release', 'soft-drop', 'pop', 'onset', 5, {'db': 6, 'hold': 0.25}, 'release: the literature card lands (轻落声; the first product result, so a confirmation-depth duck): knock + 2–5 kHz contact, no piano attack under it'),
    ('drop-select', 'click', 'click', 'onset', 1, None, 'select the literature card'),
    ('ann-details', 'click', 'click', 'onset', 1, None, 'click 详细属性'),
    ('ann-open', 'click-alt', 'click-alt', 'onset', 1, None, 'click 查看批注 (the annotation dialog opens)'),
    ('ann-tick-1', 'toggle', 'toggle', 'onset', 1, None, 'tick the first highlight'),
    ('ann-tick-2', 'toggle', 'toggle', 'onset', 1, None, 'tick the second highlight'),
    ('ann-add', 'click-drop', 'click', 'onset', 1, None, 'click 添加所选批注 + the quote cards land: both appear on the same frame, so one landing'),
    ('cards-context', 'click-alt', 'click-alt', 'onset', 1, None, 'right-click the quote card (context menu)'),
    ('cards-new-claim', 'click-drop', 'click', 'onset', 1, None, 'click 从这条批注新建观点 + the new claim card lands (DIRECTION #5 click + 轻落)'),
    ('cards-type', 'typing-claim', 'typing', 'onset', 0, {'db': 3.5}, 'real typing in the new claim card (13 characters, 21.50–22.50)'),
    ('cards-commit', 'click', 'click', 'onset', 1, None, 'click empty canvas: the claim is committed and its source footer shows'),
    ('paint-select', 'click', 'click', 'onset', 1, None, 'select the green source card'),
    ('paint-arm', 'click-alt', 'click-alt', 'onset', 1, None, 'click 格式刷'),
    ('paint-apply', 'brush', 'sweep', 'peak', 1, None, 'brush lands on the target card (short brush, after the music\'s stop beat)'),
    ('align-grab', 'paper-drag', 'sweep', 'onset', 0, {'db': 3}, 'grab the reading-note card: friction while it follows the pointer, ends at the snap'),
    ('align-snap', 'snap-tick', 'click', 'onset', 6, {'db': 4.5}, 'the card jumps into alignment and the guide appears: light high tick, clearly over the music'),
    ('write-turn', 'page-turn', 'sweep', 'peak', 2, {'db': 3, 'hold': 0.75, 'release': 0.35}, 'page turn 1: crest at the turn start, fold rustle, settle at 32.70'),
    ('write-type', 'typing-long', 'typing', 'onset', 0, {'db': 3.5}, 'real typing of the to-do line on its input schedule (src/notes/time.js TODO_UNITS): keys 33.50–33.87, pinyin bursts ending on each commit 34.00–34.80, Enter 34.90'),
    ('links-type', 'typing-short', 'typing', 'onset', 0, {'db': 3.5}, 'typing the [[ query on its input schedule (src/notes/time.js LINK_UNITS)'),
    ('links-popup', 'pop', 'pop', 'onset', 1, None, 'the [[ picker pops up (short pop, 0.13 s)'),
    ('links-filter', 'click', 'click', 'onset', 1, None, 'click 常规条目'),
    ('links-insert', 'click-alt', 'click-alt', 'onset', 1, None, 'click the paper, link inserted'),
    ('files-turn', 'page-turn', 'sweep', 'peak', 2, {'db': 3, 'hold': 0.75, 'release': 0.35}, 'page turn 2 (dark → light): crest at the turn start, settle at 50.20'),
    ('files-lift', 'pop', 'pop', 'onset', 0, None, 'the two attachment rows lift (极轻 pop)'),
]


def duck_envelope(plan, cues, n, sr):
    """The mixer's own music gain curve: mix_audio.duck_windows + its linear attack/hold/release, deepest wins,
    evaluated per 240-sample frame exactly as its asetnsamples=240 + volume eval=frame does."""
    windows = MIX.duck_windows(plan['audio'], cues, plan['duration'])
    frames = np.arange(0, n, 240)
    t = frames / sr
    g = np.ones_like(t)
    for w in windows:
        a, b, c, d = w['start'], w['attackEnd'], w['holdEnd'], w['end']
        lo = 10 ** (-w['db'] / 20)
        e = np.ones_like(t)
        e = np.where((t >= a) & (t < b), 1 - (1 - lo) * (t - a) / max(b - a, 1e-9), e)
        e = np.where((t >= b) & (t < c), lo, e)
        e = np.where((t >= c) & (t < d), lo + (1 - lo) * (t - c) / max(d - c, 1e-9), e)
        g = np.minimum(g, e)
    return np.repeat(g, 240)[:n]


def band_window(name, lm):
    """The review's measuring window (scratchpad review1/rhythm/scripts/audio4.py), as tools/audio/cue_margins.py."""
    if name in ('page-turn', 'paper-slide', 'brush'):
        return lm - 0.08, lm + 0.08
    if name == 'paper-drag':
        return lm - 0.002, lm + 0.15
    return lm - 0.002, lm - 0.002 + 0.05


def dom_band_db(s, m, sr):
    n = len(s)
    w = np.hanning(n)
    xs = np.abs(np.fft.rfft(s * w)) ** 2
    xm = np.abs(np.fft.rfft(m * w)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    dom = f[np.argmax(xs)]
    sel = (f >= dom / 2 ** (1 / 3)) & (f <= dom * 2 ** (1 / 3))
    return 10 * math.log10(xs[sel].sum() + 1e-20) - 10 * math.log10(xm[sel].sum() + 1e-20)


def sfx_window(mark, kind, lm, dur_after):
    """Where the SFX has to be heard over the ducked music."""
    if kind == 'typing':                      # a burst of keys: the music under the whole burst
        return lm, lm + dur_after
    if mark == 'onset':                       # clicks, pops, ticks, drops: the transient and its ring
        return lm, lm + min(0.12, dur_after)
    return lm - 0.03, lm + 0.06               # page-turn / paper-slide / brush: around the measured peak


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--plan', type=Path, default=PROJECT / 'plan.json')
    p.add_argument('--out', type=Path, default=PROJECT / 'evidence/audio-cues.proposed.json')
    p.add_argument('--apply', type=Path, help='write the cues into this plan.json (scratch copy only)')
    a = p.parse_args()
    plan = json.loads(a.plan.read_text())
    fps = plan['fps']
    act = {x['id']: s['start'] + x['at'] for s in plan['shots'] for x in s.get('actions', [])}
    required = [x['id'] for s in plan['shots'] for x in s.get('actions', []) if x.get('soundRequired')]
    music_cfg = plan['audio']['music']
    music, sr = sf.read(PROJECT / music_cfg['file'], always_2d=True)
    menv = np.abs(music).max(1) * music_cfg.get('gain', 1)
    mmono = music.mean(1) * music_cfg.get('gain', 1)
    info = []
    for aid, name, kind, mark, margin, duck, why in SPEC:
        f = PROJECT / 'assets/sfx' / f'{name}.wav'
        lm = landmarks(f)
        off = lm['onset'] if mark == 'onset' else lm['peak']
        duck = dict(duck or {})
        if kind == 'typing' or name == 'paper-drag':       # hold the duck for the burst / the drag itself
            duck.setdefault('hold', round(max(0.2, lm['duration'] - off - (0.1 if kind == 'typing' else 0.15)), 2))
        mono = sf.info(f).channels == 1
        x, _ = sf.read(f, always_2d=True)
        info.append(dict(aid=aid, name=name, kind=kind, mark=mark, margin=margin, duck=duck, why=why, lm=lm,
                         off=off, upmix=-3.01 if mono else 0.0, preset=DUCK_PRESETS.get(kind, (4, .18, .30)),
                         samples=x.mean(1) * (10 ** (-3.01 / 20) if mono else 1.0)))
    for _round in range(8):                    # deepen a cue's duck (≤ +2.5 dB) only if gain 4 cannot reach the music
        cues = []
        for c in info:
            cue = {'actionId': c['aid'], 'file': f"assets/sfx/{c['name']}.wav", 'kind': c['kind'], 'gain': 1.0,
                   'syncOffset': round(c['off'], 3), 'at': round(act[c['aid']] - c['off'], 3), 'role': 'sfx'}
            if c['duck']:
                cue['duck'] = c['duck']
            cues.append(cue)
        g = duck_envelope(plan, cues, len(menv), sr)
        ducked = menv * g
        mducked = mmono * g
        again = False
        rows = []
        for c, cue in zip(info, cues):
            t_action = act[c['aid']]
            lo, hi = sfx_window(c['mark'], c['kind'], t_action, c['lm']['duration'] - c['off'])
            local = float(ducked[int(lo * sr):int(hi * sr)].max())
            local_db = 20 * math.log10(local)
            need = 10 ** ((local_db + c['margin'] - c['lm']['peakDbfs'] - c['upmix']) / 20)
            # in-band: the SFX at gain 1 where mix_audio.py's adelay puts it, vs the ducked music, in the review's window
            landmark = cue['at'] + cue['syncOffset']
            blo, bhi = band_window(c['name'], landmark)
            i0, n = int(blo * sr), int(bhi * sr) - int(blo * sr)
            start = round(round(cue['at'] * 1000) / 1000 * sr)
            seg = np.zeros(n)
            a0 = max(0, i0 - start)
            piece = c['samples'][a0:a0 + n - max(0, start - i0)]
            seg[max(0, start - i0):max(0, start - i0) + len(piece)] = piece
            band1 = dom_band_db(seg, mducked[i0:i0 + n], sr)
            need_band = 10 ** ((IN_BAND_DB + IN_BAND_SAFETY - band1) / 20)
            # the boost cap is set against the music at the SPEC's own duck: a deeper duck (below) then buys margin
            cap = c.setdefault('cap', min(4.0, need * 10 ** (IN_BAND_MAX_BOOST_DB / 20)))
            if (need > 4 or (need_band > cap and c['kind'] != 'typing')) and c['duck'].get('db', c['preset'][0]) < c['preset'][0] + 2.5:
                c['duck']['db'] = round(c['duck'].get('db', c['preset'][0]) + 0.5, 2)
                again = True
            gain = min(4.0, max(0.25, math.ceil(max(need, min(need_band, cap)) * 100) / 100))   # round up: never below the target
            cue['gain'] = gain
            band_db = band1 + 20 * math.log10(gain)
            out_db = c['lm']['peakDbfs'] + 20 * math.log10(gain) + c['upmix']
            err = round((cue['at'] + cue['syncOffset'] - t_action) * fps, 3)
            assert abs(err) <= 2, (c['aid'], err)
            rows.append({'actionId': c['aid'], 'actionTime': round(t_action, 3), 'file': cue['file'], 'landmark': c['mark'],
                         'syncOffset': cue['syncOffset'], 'at': cue['at'], 'errorFrames': err,
                         'filePeakDbfs': c['lm']['peakDbfs'], 'monoUpmixDb': c['upmix'], 'gain': gain,
                         'sfxPeakInMixDbfs': round(out_db, 1), 'duckDb': c['duck'].get('db', c['preset'][0]),
                         'window': [round(lo, 3), round(hi, 3)], 'duckedMusicPeakDbfs': round(local_db, 1),
                         'marginDb': round(out_db - local_db, 1), 'meetsDuckedMusic': out_db >= local_db - 0.05,
                         'inBandDbEstimate': round(band_db, 1), 'inBandBoostDb': round(20 * math.log10(gain / max(need, 0.25)), 1)
                         if gain > need else 0.0, 'meetsInBand': band_db >= IN_BAND_DB,
                         'gainClamped': need > 4, 'soundRequired': c['aid'] in required, 'why': c['why']})
        if not again:
            break
    missing = sorted(set(required) - {c['actionId'] for c in cues})
    if missing:
        raise SystemExit(f'missing cues for {missing}')
    doc = {'note': 'Proposed audio.cues for plan.json (builders do not edit plan.json; the director merges). '
                   'at = actionTime − syncOffset; syncOffset = measured onset (clicks/keys/pops/drops/ticks) or peak '
                   '(page-turn, paper-slide, brush) from scripts/sfx_landmarks.py. Gains come from measured peaks so '
                   'each SFX peak (incl. mix_audio.py\'s −3 dB mono→stereo upmix for mono WAVs) is ≥ the '
                   'music peak in its window after the mixer\'s own ducking envelope (music gain '
                   f"{music_cfg.get('gain', 1)}), raised where needed (≤ +6 dB) so the SFX is ≥ {IN_BAND_DB:g} dB over the ducked "
                   'music in its own band (the review\'s in-band margin; tools/audio/cue_margins.py measures the mix).',
           'generatedBy': 'tools/audio/plan_cues.py', 'musicFile': music_cfg['file'], 'musicGain': music_cfg.get('gain', 1),
           'requiredActions': len(required), 'cueCount': len(cues), 'cues': cues, 'measurements': rows}
    a.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    if a.apply:
        target = json.loads(a.apply.read_text())
        target['audio']['cues'] = cues
        a.apply.write_text(json.dumps(target, ensure_ascii=False, indent=2) + '\n')
    for r in rows:
        print(f"{r['actionId']:16s} {r['actionTime']:7.3f}  {Path(r['file']).stem:15s} at {r['at']:7.3f} off {r['syncOffset']:.3f}  "
              f"gain {r['gain']:4.2f}  duck {r['duckDb']:3.1f}  sfx {r['sfxPeakInMixDbfs']:6.1f}  music↓ {r['duckedMusicPeakDbfs']:6.1f}  "
              f"margin {r['marginDb']:5.1f}  in-band {r['inBandDbEstimate']:5.1f}{'  CLAMPED' if r['gainClamped'] else ''}"
              f"{'' if r['meetsDuckedMusic'] else '  BELOW'}{'' if r['meetsInBand'] else '  IN-BAND<10'}")


if __name__ == '__main__':
    main()
