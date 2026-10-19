#!/usr/bin/env python3
"""Write evidence/audio-selection.json: where the music and every SFX came from, with measurements.

Usage: .venv-audio/bin/python tools/audio/write_selection.py
(reads assets/music.wav, assets/sfx/*.wav, evidence/audio-cues.proposed.json; runs score.py --describe)
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


BUNDLED = {'click', 'click-alt', 'toggle', 'pop'}
ROLE = {
    'click': 'UI click / select', 'click-alt': 'second click timbre (opening, context menu, arming, inserting)',
    'toggle': 'tick a highlight checkbox', 'pop': 'popup appears / attachment rows lift (very light)',
    'paper-slide': 'drag start: a paper or card is picked up and slides', 'soft-drop': 'a card lands',
    'click-drop': 'click + one card lands (one event)', 'click-drop-pair': 'click + two quote cards land (one event)',
    'brush': 'format painter applies', 'page-turn': 'the two folded-corner page turns',
    'snap-tick': 'alignment guides snap', 'logo-fold': 'the logo corner folds in',
    'typing-long': 'product typing, two bursts', 'typing-short': 'product typing, one burst',
    'pop-pair': 'two menu rows appear (optional cue)',
}


def main():
    py = sys.executable
    desc = json.loads(subprocess.run([py, str(PROJECT / 'assets/audio/score.py'), '--describe'], capture_output=True,
                                     text=True, check=True).stdout)
    analyze = load('analyze', PROJECT / 'tools/audio/analyze.py').analyze
    music = analyze(PROJECT / 'assets/music.wav')
    lmk = load('sfx_landmarks', SKILL / 'scripts/sfx_landmarks.py').landmarks
    cues = json.loads((PROJECT / 'evidence/audio-cues.proposed.json').read_text())['cues']
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
        if name in BUNDLED:
            row.update(source='guizang-product-video-skill assets/audio/sfx (original procedural, scripts/make_sfx.py); copied unchanged, hash matches the skill manifest',
                       license='GNU AGPL-3.0, © 2026 op7418 (skill README: original audio assets are AGPL-3.0)')
        else:
            row.update(source='generated in this project: tools/audio/make_film_sfx.py (procedural, fixed seed, no samples)',
                       license='this video project\'s own asset' + (
                           '; re-synthesizes the skill\'s make_sfx.py click/typing/pop recipe (AGPL-3.0), treat as AGPL-3.0 derived'
                           if name in {'click-drop', 'click-drop-pair', 'typing-long', 'typing-short', 'pop-pair'} else ''))
        sfx.append(row)
    unused_bundled = [{'file': 'typing.wav', 'reason': 'bundled typing.wav peaks at −26.4 dBFS (−29.4 after mix_audio.py\'s mono→stereo); '
                       'at the mixer\'s max gain 4 it stayed 2.4 dB under the ducked music at links-type (37.3 s). '
                       'Replaced by typing-short.wav (same make_sfx.py keystroke recipe and key times, +7 dB).'}]
    doc = {
        'music': {
            'source': 'code-original', 'script': 'assets/audio/score.py', 'output': 'assets/music.wav',
            'sha256': sha(PROJECT / 'assets/music.wav'), 'seed': desc['seed'],
            'environment': {'python': '3.13', 'numpy': '2.5.4', 'scipy': '1.18.1', 'soundfile': '0.14.0',
                            'matplotlib (charts only)': '3.11.2', 'ffmpeg': '6.1.1',
                            'venv': 'python3 -m venv .venv-audio && .venv-audio/bin/pip install numpy==2.5.4 scipy==1.18.1 soundfile==0.14.0 matplotlib==3.11.2 (not committed)'},
            'reproducible': 'two runs produce byte-identical assets/music.wav',
            'duration': desc['duration'], 'bpm': desc['bpm'], 'meter': desc['meter'], 'key': desc['key'],
            'beatGrid': desc['grid'], 'onGridActions': desc['onGridActions'],
            'instruments': ['felt piano (additive, inharmonic partials, velocity felt low-pass, two detuned strings, felt thump, damper)',
                            'bowed-string pad (3 detuned band-limited saws, slow vibrato, raised-cosine bow attack, low-pass 0.7–1.9 kHz, high-pass 110 Hz)',
                            'sine bass (sine + 2nd/3rd harmonic, soft attack)',
                            'paper ticks (band-passed noise grains 2.4–7 kHz) on beats 2 and 4, bars 2–10 and #9 links only, pulled back while reading, skipped where an action SFX falls',
                            'convolution room (2.6 s decorrelated noise IR, low-passed 4.5 kHz)'],
            'notUsed': ['drum kit', 'marimba', 'electronic pulse', 'risers', 'sub impacts', 'sidechain'],
            'sections': desc['sections'],
            'mastering': 'high-pass 38 Hz, low shelf −3 dB @ 140 Hz, normalised to −17.5 LUFS, look-ahead limiter at −4.5 dBFS (peak-to-loudness 13 dB so mix_audio.py can normalise the film mix linearly)',
            'analysis': {k: music[k] for k in ['integratedLufs', 'samplePeakDbfs', 'bandEnergyPercent', 'lowEndBelow120HzPercent', 'topPeaks']}
                        | {'perSecond': music['perSecond'],
                           'charts': ['evidence/audio/music-spectrum.png', 'evidence/audio/music-loudness.png', 'evidence/audio/music-ltas.png']},
        },
        'sfx': sfx,
        'bundledNotUsed': unused_bundled,
        'sfxSearch': 'No recorded SFX library was searched or downloaded for this part; every sound is procedural (bundled skill WAVs or generated here). BRIEF.md asked to look for fitting material first: not done — the paper/desk sounds this film needs were synthesized instead.',
        'listening': 'Not auditioned: this environment cannot play audio. Checked only by measurement (landmarks, per-cue peak vs ducked music, loudness, spectra).',
    }
    (PROJECT / 'evidence/audio-selection.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    print('wrote evidence/audio-selection.json:', len(sfx), 'sfx,', len(desc['sections']), 'sections')


if __name__ == '__main__':
    main()
