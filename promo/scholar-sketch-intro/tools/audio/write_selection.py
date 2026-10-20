#!/usr/bin/env python3
"""Write evidence/audio-selection.json: where the music and every SFX came from, with measurements.

Usage: .venv-audio/bin/python tools/audio/write_selection.py
(reads assets/music.wav, assets/sfx/*.wav, evidence/audio-cues.proposed.json; runs score.py --describe; when
evidence/audio-mix.json was mixed from the current plan.json it also folds in the mix measurements:
evidence/audio-mix-check.json (check_mix.py), evidence/audio-cue-margins.json (cue_margins.py), master loudness,
and the #11 dark / #13 end chord loudness and low-end figures the review asked about)
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
SKILL = Path('/root/.claude/skills/guizang-product-video-skill')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def read_json(rel):
    p = PROJECT / rel
    return json.loads(p.read_text()) if p.exists() else None


# the skill's make_sfx.py recipes, re-synthesized sample-exactly by make_film_sfx.py, + a 2–4 kHz contact layer
DERIVED_FROM_SKILL = {'click', 'click-alt', 'toggle', 'pop'}
ROLE = {
    'click': 'UI click / select', 'click-alt': 'second click timbre (opening, context menu, arming, inserting)',
    'toggle': 'tick a highlight checkbox', 'pop': 'popup appears / attachment rows lift (very light, 0.13 s)',
    'paper-slide': 'drag start: a paper row is picked up and slides (drop-grab)',
    'paper-drag': 'the reading-note card follows the pointer from align-grab until it snaps (align-grab)',
    'soft-drop': 'a card lands (knock + 2–5 kHz contact)',
    'click-drop': 'click + the card(s) land, one event (ann-add, cards-new-claim)',
    'brush': 'format painter applies', 'page-turn': 'the two folded-corner page turns',
    'snap-tick': 'alignment snap', 'logo-fold': 'the logo corner folds in: 75 ms paper flick',
    'typing-claim': 'product typing in the claim card (13 keys at 12/s)',
    'typing-long': 'product typing of the to-do line, on src/notes/time.js TODO_UNITS',
    'typing-short': 'product typing of the [[ query, on src/notes/time.js LINK_UNITS',
    'pop-pair': 'two menu rows appear (optional cue)',
}

# what the review (2026-10-19, rhythm + technical lenses) measured on the first draft, for before/after
REVIEW_BEFORE = {
    'drop-release': {'domBandDb': 3.5, 'gain': 0.69}, 'brand-fold': {'domBandDb': 15.3, 'domHz': 280},
    'ann-tick-1': {'domBandDb': 6.8}, 'cards-context': {'domBandDb': 7.5}, 'cards-new-claim': {'domBandDb': 7.2},
    'cards-commit': {'domBandDb': 10.6}, 'links-popup': {'domBandDb': 8.5}, 'links-insert': {'domBandDb': 10.7},
    'align-snap': {'domBandDb': 1.9, 'sfxPeakVsDuckedMusicDb': -3.2}, 'write-type': {'domBandDb': 8.8},
    'links-type': {'domBandDb': 4.1}, 'cards-type': {'domBandDb': -1.8},
}


def chord_figures(path, plan):
    an = load('analyze', PROJECT / 'tools/audio/analyze.py')
    act = {a['id']: s['start'] + a['at'] for s in plan['shots'] for a in s.get('actions', [])}
    m = an.momentary(path)

    def peak(a, b):
        v, t = max((v, t) for t, v in m if a <= t <= b)
        return {'lufsM': round(v, 1), 't': round(t, 2)}

    def low(a, b):
        v, t = min((v, t) for t, v in m if a <= t <= b)
        return {'lufsM': round(v, 1), 't': round(t, 2)}
    dark, files, end = act['dark-switch'], act['files-turn'], act['end-chord']
    before_end, at_end = low(end - 0.6, end), peak(end, end + 1.4)
    return {'file': str(Path(path).relative_to(PROJECT)),
            'loudestMomentary': peak(0, plan['duration']),
            'darkChordPeak': peak(dark, files), 'darkLowBelow120HzPercentPer0.25s': an.low_share(path, dark + 0.083, dark + 1.583),
            'endChordQuietBefore': before_end, 'endChordPeak': at_end, 'endStepLU': round(at_end['lufsM'] - before_end['lufsM'], 1),
            'endLowBelow120HzPercentPer0.25s': an.low_share(path, end + 0.083, end + 1.583)}


def main():
    py = sys.executable
    plan = json.loads((PROJECT / 'plan.json').read_text())
    desc = json.loads(subprocess.run([py, str(PROJECT / 'assets/audio/score.py'), '--describe'], capture_output=True,
                                     text=True, check=True).stdout)
    analyze = load('analyze', PROJECT / 'tools/audio/analyze.py').analyze
    music = analyze(PROJECT / 'assets/music.wav')
    lmk = load('sfx_landmarks', SKILL / 'scripts/sfx_landmarks.py').landmarks
    proposed = json.loads((PROJECT / 'evidence/audio-cues.proposed.json').read_text())
    cues = proposed['cues']
    used = {}
    for c in cues:
        used.setdefault(Path(c['file']).stem, []).append(c['actionId'])
    sfx = []
    for f in sorted((PROJECT / 'assets/sfx').glob('*.wav')):
        name = f.stem
        lm = lmk(f)
        row = {'file': f.name, 'path': f'assets/sfx/{f.name}', 'role': ROLE.get(name, ''), 'usedBy': used.get(name, []),
               'sha256': sha(f), 'durationSec': lm['duration'], 'onsetSec': lm['onset'], 'peakSec': lm['peak'],
               'peakDbfs': lm['peakDbfs']}
        if name in DERIVED_FROM_SKILL:
            row.update(source='generated in this project: tools/audio/make_film_sfx.py re-synthesizes the skill\'s scripts/make_sfx.py '
                              f'"{name}" recipe (checked sample-exact against the skill\'s assets/audio/sfx/{name}.wav) and adds a '
                              '10–14 ms 2–4 kHz band-passed noise contact at the onset' + (' (pop: trimmed to 0.13 s)' if name == 'pop' else ''),
                       license='derived from the skill\'s original procedural audio: GNU AGPL-3.0, © 2026 op7418 (skill README)')
        else:
            row.update(source='generated in this project: tools/audio/make_film_sfx.py (procedural, fixed seed, no samples)',
                       license='this video project\'s own asset' + (
                           '; re-synthesizes the skill\'s make_sfx.py click/typing/pop recipe (AGPL-3.0), treat as AGPL-3.0 derived'
                           if name in {'click-drop', 'typing-long', 'typing-short', 'typing-claim', 'pop-pair'} else ''))
        sfx.append(row)
    unused_bundled = [
        {'file': 'typing.wav', 'reason': 'bundled typing.wav peaks at −26.4 dBFS (−29.4 after mix_audio.py\'s mono→stereo) and its six key '
                                         'times are not the picture\'s; the typing files are generated on the picture\'s own input schedules.'},
        {'file': 'click.wav, click-alt.wav, toggle.wav, pop.wav', 'reason': 'used in the first draft as unchanged copies; replaced by the same '
         'recipes + a 2–4 kHz contact layer, because 90–99 % of their energy sat in the felt piano\'s 250–1000 Hz band (review 2026-10-19).'}]
    doc = {
        'music': {
            'source': 'code-original', 'script': 'assets/audio/score.py', 'output': 'assets/music.wav',
            'sha256': sha(PROJECT / 'assets/music.wav'), 'seed': desc['seed'],
            'environment': {'python': '3.13', 'numpy': '2.5.4', 'scipy': '1.18.1', 'soundfile': '0.14.0',
                            'matplotlib (charts only)': '3.11.2', 'ffmpeg': '6.1.1',
                            'venv': 'python3 -m venv .venv-audio && .venv-audio/bin/pip install numpy==2.5.4 scipy==1.18.1 soundfile==0.14.0 matplotlib==3.11.2 (not committed)'},
            'reproducible': 'two runs produce byte-identical assets/music.wav',
            'duration': desc['duration'], 'bpm': desc['bpm'], 'meter': desc['meter'], 'key': desc['key'],
            'beatGrid': desc['grid'], 'onGridActions': desc['onGridActions'], 'nearGrid': desc.get('nearGrid'),
            'sfxFramesKeptClear': desc.get('sfxFramesKeptClear'),
            'instruments': ['felt piano (additive, inharmonic partials, velocity felt low-pass, two detuned strings, felt thump, damper)',
                            'bowed-string pad (3 detuned band-limited saws, slow vibrato, raised-cosine bow attack, low-pass 0.7–1.9 kHz, high-pass 110 Hz)',
                            'sine bass (sine + 2nd/3rd harmonic, soft attack; not under the #11 dark chord)',
                            'paper ticks (band-passed noise grains 2.4–7 kHz) on beats 2 and 4, bars 2–10 and #9 links only, pulled back while reading, skipped within 120 ms of an action SFX',
                            'convolution room (2.6 s decorrelated noise IR, low-passed 4.5 kHz)'],
            'notUsed': ['drum kit', 'marimba', 'electronic pulse', 'risers', 'sub impacts', 'sidechain'],
            'sections': desc['sections'],
            'mastering': 'high-pass 38 Hz (60 Hz on the piano bus, 90 Hz on the #11 dark chord), low shelf −3 dB @ 140 Hz, normalised to −17.5 LUFS, look-ahead limiter at −4.5 dBFS (peak-to-loudness 13 dB so mix_audio.py can normalise the film mix linearly)',
            'analysis': {k: music[k] for k in ['integratedLufs', 'samplePeakDbfs', 'bandEnergyPercent', 'lowEndBelow120HzPercent', 'topPeaks']}
                        | {'perSecond': music['perSecond'],
                           'chords': chord_figures(PROJECT / 'assets/music.wav', plan),
                           'charts': ['evidence/audio/music-spectrum.png', 'evidence/audio/music-loudness.png', 'evidence/audio/music-ltas.png']},
        },
        'sfx': sfx,
        'sfxCharts': {'evidence/audio/sfx-changed.png': 'changed SFX before (review draft) / after: spectrograms and spectra with the piano and contact bands',
                      'evidence/audio/sfx-changed-2.png': 'paper-drag (new), paper-slide (unchanged), typing-long / typing-short on the picture\'s schedules, pop-pair',
                      'evidence/audio/cue-spectra.png': 'raw stems around brand-fold, drop-release, cards 20.5–21.5, align 29.17–29.83 and write-type: draft vs this fix'},
        'bundledNotUsed': unused_bundled,
        'cueSpec': [{'actionId': r['actionId'], 'actionTime': r['actionTime'], 'file': r['file'], 'landmark': r['landmark'], 'syncOffset': r['syncOffset'],
                     'gain': r['gain'], 'duckDb': r['duckDb'], 'why': r['why']} for r in proposed['measurements']],
        'sfxSearch': 'No recorded SFX library was searched or downloaded for this part; every sound is procedural (generated here, partly from the skill\'s make_sfx.py recipes). BRIEF.md asked to look for fitting material first: not done — the paper/desk sounds this film needs were synthesized instead.',
        'listening': 'Not auditioned: this environment cannot play audio. Checked only by measurement (landmarks, per-cue peak and in-band margins vs the ducked music, loudness, spectra).',
    }
    rep = read_json('evidence/audio-mix.json')
    if rep and rep.get('planSha256') == sha(PROJECT / 'plan.json'):
        n = rep['normalization']
        mixcheck = read_json('evidence/audio-mix-check.json') or {}
        margins = read_json('evidence/audio-cue-margins.json') or {}
        doc['mix'] = {
            'report': 'evidence/audio-mix.json', 'planSha256': rep['planSha256'], 'masterSha256': rep['master']['sha256'],
            'normalization': {'type': n.get('normalization_type'), 'requested': n.get('requested'),
                              'rawMix': {k: n['measurement'][k] for k in ['input_i', 'input_tp', 'input_lra']},
                              'master': {k: n['output'][k] for k in ['output_i', 'output_tp', 'output_lra']},
                              'target': '-16 LUFS integrated, true peak <= -1 dBTP (mix_audio.py loudnorm TP -1.5)'},
            'sync': {'maxAbsErrorFrames': mixcheck.get('maxAbsErrorFrames'), 'cuesBelowDuckedMusic': mixcheck.get('cuesBelowDuckedMusic')},
            'inBand': {k: margins.get(k) for k in ['method', 'targetDb', 'target', 'cuesBelowTarget', 'cuesBestBandBelowTarget',
                                                    'cuesWithPianoOnsetWithin13ms']}
                      | {'cues': [{k: r.get(k) for k in ['actionId', 'file', 'landmark', 'gain', 'domHz', 'domBandDb', 'bestBandHz', 'bestBandDb',
                                                          'contactDb', 'peakDb', 'pianoOnsetsMs', 'keysMinDomBandDb', 'keysMedianDomBandDb']
                                  if r.get(k) is not None} | ({'reviewBefore': REVIEW_BEFORE[r['actionId']]} if r['actionId'] in REVIEW_BEFORE else {})
                                 for r in margins.get('cues', [])]},
            'chords': chord_figures(PROJECT / 'assets/master.wav', plan),
            'charts': ['evidence/audio/mix-timeline.png', 'evidence/audio/master-spectrum.png', 'evidence/audio/master-loudness.png'],
        }
    else:
        doc['mix'] = {'status': 'not mixed from the current plan.json: run tools/audio/build.sh --mix after copying the proposed cues'}
    (PROJECT / 'evidence/audio-selection.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    print('wrote evidence/audio-selection.json:', len(sfx), 'sfx,', len(desc['sections']), 'sections,',
          'mix measurements included' if 'report' in doc['mix'] else 'no mix measurements')


if __name__ == '__main__':
    main()
