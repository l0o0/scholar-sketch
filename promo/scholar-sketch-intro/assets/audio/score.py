#!/usr/bin/env python3
"""Scholar Sketch promo score, "页边批注" (DIRECTION.md §7). Code-original, no samples, no model.

90 BPM, 4/4, F major, plan.duration (58.5 s). Instruments derived from the product temperament
("quiet, precise, native research desk"): felt piano (lead), soft bowed-string pad (slow attack,
low-passed), sine bass, very light procedural paper ticks (filtered noise) on beats 2 and 4 only in the
middle of chapter 1 and in #9 links. No drum kit, marimba, electronic pulse, risers, sub impacts or
sidechain. Every time below is read from plan.json (shot boundaries and action times).

Beat grid: the director's on-beat actions (DIRECTION.md §6 "落拍": 9.83, 15.83, 21.17, 26.50, 29.83,
39.17, 43.83, 47.17) all sit on t = 0.5 + k·(2/3) s, i.e. a 90 BPM grid with phase 0.5 s (≡ −1/6 s);
bar lines at 2.5 + m·(8/3) s put ann-add, cards-new-claim, paint-apply, links-insert and files-lift on
downbeats. The pulsed sections (A 研究白板, B Markdown) run on that grid; #1, the page turns, #11–#13 are
in free time anchored to their action times (brand-fold 1.2, write-turn 32.0, files-turn 49.5,
end-chord 54.167). The script asserts the anchors are on the grid.

Usage (venv with numpy/scipy/soundfile; ffmpeg on PATH for the loudness pass):
  python3 -m venv .venv-audio && .venv-audio/bin/pip install numpy scipy soundfile
  .venv-audio/bin/python assets/audio/score.py                    # → assets/music.wav (-17 LUFS)
  .venv-audio/bin/python assets/audio/score.py --describe         # section map + grid as JSON
Deterministic: fixed SEED; every note draws its random phases from (SEED, kind, time, pitch).
"""
import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
SR = 48000
SEED = 2909
BPM = 90
BEAT = 60 / BPM          # 0.6667 s
BAR = 4 * BEAT           # 2.6667 s

plan = json.loads((PROJECT / 'plan.json').read_text())
DUR = float(plan['duration'])
N = int(round(DUR * SR))
ACT = {a['id']: s['start'] + a['at'] for s in plan['shots'] for a in s.get('actions', [])}
SHOT = {s['id']: (s['start'], s['end']) for s in plan['shots']}
SFX_TIMES = sorted([ACT[a['id']] for s in plan['shots'] for a in s.get('actions', []) if a.get('soundRequired')]
                   + [ACT['entry-items']])          # entry-items carries an optional light pop pair


def at(action_id):
    return ACT[action_id]


BAR_ORIGIN = round((at('ann-add') % BAR) * 6) / 6    # 2.5 s (snapped to the 1/6 s sixteenth)


def bar(m, beat=1.0):
    """Time of bar m (m = 0 at 2.5 s), beat 1..4.5 (eighths as .5)."""
    return BAR_ORIGIN + m * BAR + (beat - 1) * BEAT


ON_GRID = {'drop-grab': (2, 2), 'drop-release': (2, 4), 'ann-tick-1': (4, 3), 'ann-tick-2': (4, 4), 'ann-add': (5, 1),
           'cards-context': (6, 4), 'cards-new-claim': (7, 1), 'paint-select': (8, 2), 'paint-arm': (8, 3),
           'paint-apply': (9, 1), 'align-grab': (10, 1), 'align-snap': (10, 2), 'links-filter': (13, 4),
           'links-insert': (14, 1), 'back-click': (15, 3), 'dark-switch': (16, 4), 'files-lift': (18, 1)}
for _aid, (_m, _b) in ON_GRID.items():
    if abs(bar(_m, _b) - at(_aid)) > 0.002:
        sys.exit(f'score.py: {_aid} at {at(_aid):.3f} s is no longer on bar {_m} beat {_b} ({bar(_m, _b):.3f} s); re-arrange.')

# Reading moments (DIRECTION.md §6): ticks and broken chords pull back here.
READING = [(16.9, SHOT['annotations'][1]), (21.7, SHOT['cards'][1]), (26.9, SHOT['painter'][1]),
           (30.3, SHOT['align'][1]), (34.9, SHOT['write'][1]), (40.1, SHOT['links'][1]), (43.9, SHOT['backlinks'][1])]


def reading(t):
    return any(a <= t < b for a, b in READING)


# The product types twice (write-type 33.5–34.9, links-type 37.3–37.9): the arpeggio steps back for the keys.
TYPING = [(at('write-type') - 0.1, at('write-type') + 1.45), (at('links-type') - 0.15, at('links-type') + 0.7)]


def typing(t):
    return any(a <= t < b for a, b in TYPING)


# ── utilities ────────────────────────────────────────────────────────────────────────────────────
buses = {k: np.zeros((N, 2)) for k in ['piano', 'pad', 'bass', 'tick']}


def hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def tt(d):
    return np.arange(int(round(d * SR))) / SR


def rng_for(kind, t, note=0):
    return np.random.default_rng([SEED, sum(map(ord, kind)), int(round(t * 1000)), int(note)])


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos'), x, axis=0)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x, axis=0)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x, axis=0)


def low_shelf(x, f0, gain_db, q=0.7071):
    """RBJ cookbook low shelf (keeps the desk-quiet low end from building up under piano + sine bass)."""
    from scipy.signal import lfilter
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f0 / SR
    alpha = math.sin(w0) / (2 * q)
    cw = math.cos(w0)
    b = [A * ((A + 1) - (A - 1) * cw + 2 * math.sqrt(A) * alpha), 2 * A * ((A - 1) - (A + 1) * cw),
         A * ((A + 1) - (A - 1) * cw - 2 * math.sqrt(A) * alpha)]
    a = [(A + 1) + (A - 1) * cw + 2 * math.sqrt(A) * alpha, -2 * ((A - 1) + (A + 1) * cw),
         (A + 1) + (A - 1) * cw - 2 * math.sqrt(A) * alpha]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def put(bus, t0, sig, pan=0.0, gain=1.0):
    i = int(round(t0 * SR))
    if i >= N or len(sig) == 0:
        return
    if sig.ndim == 1:
        sig = np.stack([sig * math.sqrt((1 - pan) / 2), sig * math.sqrt((1 + pan) / 2)], 1)
    j = min(N, i + len(sig))
    buses[bus][max(0, i):j] += sig[max(0, -i):j - i] * gain


# ── instruments ──────────────────────────────────────────────────────────────────────────────────
def felt_piano(note, vel, hold, t0):
    """Felt piano: inharmonic partials with a velocity-dependent felt low-pass, two-stage decay,
    two slightly detuned strings, a soft felt thump, damper after `hold` seconds."""
    r = rng_for('piano', t0, note)
    f0 = hz(note)
    tail = 0.7
    t = tt(min(hold, 9.0) + tail)
    inh = 2.5e-4 * (f0 / 261.6) ** 0.5
    corner = 1300 + 3400 * vel ** 1.2                # softer touch = darker felt
    reg = (f0 / 261.6) ** 0.55                       # higher notes decay faster
    out = np.zeros_like(t)
    for k in range(1, 19):
        fk = k * f0 * math.sqrt(1 + inh * k * k)
        if fk > 8500:
            break
        amp = k ** -1.0 / (1 + (fk / corner) ** 2.0)
        if amp < 2e-4:
            continue
        e = 0.5 * np.exp(-t * (2.6 + 1.1 * k) * reg) + 0.5 * np.exp(-t * (0.30 + 0.08 * k) * reg)
        det = 1 + r.uniform(2.5e-4, 6e-4)
        s = np.sin(2 * np.pi * fk * t + r.uniform(0, 6.28)) + 0.8 * np.sin(2 * np.pi * fk * det * t + r.uniform(0, 6.28))
        out += amp * e * s / 1.8
    out *= 1 - np.exp(-t / (0.0035 + 0.006 * (1 - vel)))
    nl = int(0.035 * SR)
    thump = lp(r.standard_normal(nl), 450 + 900 * vel) * np.exp(-np.arange(nl) / SR / 0.007)
    out[:nl] += 0.05 * vel * thump
    tock = bp(r.standard_normal(nl), 1200, 4200) * np.exp(-np.arange(nl) / SR / 0.004)
    out[:nl] += 0.012 * vel * tock                    # the felt action's soft mechanical 'tock'
    damp = np.where(t < hold, 1.0, np.exp(-(t - hold) / 0.10))
    return out * damp * (vel ** 1.5) * 0.55


def piano(t0, notes, vel, hold, roll=0.0):
    """Strike one or more notes; `roll` staggers a chord bottom-up (seconds between notes)."""
    for i, n in enumerate(sorted(notes)):
        t = t0 + i * roll
        pan = float(np.clip((n - 62) / 30, -0.45, 0.45))
        put('piano', t, felt_piano(n, vel, hold - i * roll, t), pan)


def bowed(note, dur, level, t0, attack=0.9, release=1.2, cutoff=1500):
    """Bowed-string ensemble voice: three detuned band-limited saws with slow vibrato, raised-cosine bow
    attack and release, low-passed (no bright edge) and high-passed at 110 Hz (keeps the low end clean)."""
    r = rng_for('pad', t0, note)
    t = tt(dur + release)
    L = len(t) / SR
    f = hz(note)
    out = np.zeros((len(t), 2))
    for i, cents in enumerate((-7, 0, 6)):
        fv = f * 2 ** (cents / 1200)
        vib = 1 + 0.0016 * np.sin(2 * np.pi * (4.6 + 0.35 * i) * t + r.uniform(0, 6.28))
        ph = 2 * np.pi * np.cumsum(fv * vib) / SR + r.uniform(0, 6.28)
        s = np.zeros_like(t)
        for k in range(1, int(max(1, min(12, 3600 // fv))) + 1):
            s += np.sin(k * ph) / k
        pan = (i - 1) * 0.45
        out[:, 0] += s * math.sqrt((1 - pan) / 2)
        out[:, 1] += s * math.sqrt((1 + pan) / 2)
    a = 0.5 - 0.5 * np.cos(np.pi * np.clip(t / attack, 0, 1))
    rel = 0.5 - 0.5 * np.cos(np.pi * np.clip((L - t) / release, 0, 1))
    out *= (a * rel)[:, None]
    out = hp(lp(out, cutoff), 110)
    return out * level / 3


def pad(t0, t1, notes, level=0.05, attack=0.9, release=1.2, cutoff=1900):
    for n in notes:
        put('pad', t0, bowed(n, t1 - t0, level, t0, attack, release, cutoff))


def sine_bass(t0, note, dur, vel=0.5):
    t = tt(dur + 0.25)
    f = hz(note)
    s = np.sin(2 * np.pi * f * t) + 0.12 * np.sin(4 * np.pi * f * t) + 0.035 * np.sin(6 * np.pi * f * t)
    env = (1 - np.exp(-t / 0.02)) * np.exp(-t * 0.8)
    env *= 0.5 + 0.5 * np.cos(np.pi * np.clip((t - dur) / 0.25, 0, 1))
    put('bass', t0, s * env * vel)


def near_sfx(t, tol=0.05):
    return any(abs(t - s) < tol for s in SFX_TIMES)


def paper_tick(t0, level):
    """Very light paper tick: band-passed noise grain (2.4–7 kHz) with a faint 0.6–1.5 kHz body."""
    if level <= 0 or any(abs(t0 - s) < 0.07 for s in SFX_TIMES):
        return                                   # leave the slot to the action's own SFX
    r = rng_for('tick', t0)
    t = tt(0.06)
    x = bp(r.standard_normal(len(t)), 2400, 7000) * np.exp(-t / 0.0045)
    x += 0.35 * bp(r.standard_normal(len(t)), 600, 1500) * np.exp(-t / 0.010)
    x *= 1 - np.exp(-t / 0.0004)
    put('tick', t0, x / np.abs(x).max() * level, pan=r.uniform(-0.25, 0.25))


# ── harmony (MIDI) ───────────────────────────────────────────────────────────────────────────────
#  bass: sine bass root · lh: left-hand dyad · rh: broken-chord tones (A) · arp: eighth arpeggio (B) · pad
CH = {
    'Fadd9':  dict(bass=41, lh=(53, 60), rh=(67, 69, 72), arp=(60, 65, 67, 72), pad=(53, 57, 60, 67)),
    'Dm7':    dict(bass=38, lh=(50, 57), rh=(65, 69, 72), pad=(50, 57, 60, 65)),
    'Bbmaj7': dict(bass=46, lh=(53, 62), rh=(62, 65, 69), arp=(62, 65, 69, 72), pad=(50, 53, 57, 62)),
    'Bbmaj9': dict(bass=46, lh=(53, 62), rh=(65, 69, 72), arp=(62, 65, 69, 72), pad=(50, 57, 60, 62)),
    'Csus4':  dict(bass=36, lh=(48, 55), rh=(65, 67, 72), pad=(53, 55, 60)),
    'C7sus4': dict(bass=36, lh=(48, 55), rh=(65, 70, 72), pad=(53, 58, 60)),
    'F/A':    dict(bass=45, lh=(53, 60), rh=(69, 72, 77), pad=(57, 60, 65)),
    'Gm9':    dict(bass=43, lh=(55, 62), rh=(65, 69, 74), arp=(62, 65, 69, 74), pad=(53, 58, 62, 69)),
    'Gm7':    dict(bass=43, lh=(55, 62), rh=(65, 70, 74), pad=(53, 58, 62)),
    'Fmaj7':  dict(bass=41, lh=(53, 60), rh=(64, 69, 72), pad=(57, 60, 64)),
    'Am7':    dict(bass=45, lh=(57, 64), arp=(64, 67, 69, 72), pad=(55, 60, 64)),
    'C/E':    dict(bass=40, lh=(52, 60), arp=(64, 67, 72, 74), pad=(55, 60, 64)),
}

SECTIONS = []


def section(name, t0, t1, what):
    SECTIONS.append({'name': name, 'start': round(t0, 3), 'end': round(t1, 3), 'music': what})


# ── #1 brand: sparse single piano notes (free time, anchored on brand-fold) ─────────────────────
t_entry = SHOT['entry'][0]
section('#1 brand', 0.0, t_entry, 'sparse single felt-piano notes C5 · F4 (lands with the logo fold at brand-fold) · A4 · G4; pedal held to 4.0')
for t, n, v in [(0.20, 72, 0.44), (at('brand-fold'), 65, 0.46), (1.85, 69, 0.36), (2.85, 67, 0.32)]:
    piano(t, [n], v, t_entry - t - 0.04)

# ── #2 entry: open fifths + soft pad ───────────────────────────────────────────────────────────
a_start = SHOT['drop'][0]
section('#2 entry', t_entry, a_start, 'open fifths F–C (4.0), D–A (5.17), Bb–F (6.50) over a soft bowed pad; RH A4, G4; C5 pickup at 7.50 into A')
fifths = [(t_entry, (41, 48, 53, 60), (53, 60)), (bar(1), (38, 45, 50, 57), (50, 57)), (bar(1, 3), (46, 53), (58, 65))]
for i, (t, pn, pd) in enumerate(fifths):
    t_next = fifths[i + 1][0] if i + 1 < len(fifths) else bar(2)
    piano(t, pn, 0.25 if i == 0 else 0.27, t_next - t + 0.05)
    pad(t, t_next if i + 1 < len(fifths) else bar(2) - 0.3, pd, level=0.045, attack=1.2 if i == 0 else 0.7,
        release=0.7 if i + 1 < len(fifths) else 0.9, cutoff=1200)
piano(bar(1, 3) - BEAT, [69], 0.24, BEAT * 2)          # 5.83 A4
piano(bar(1, 4), [67], 0.22, BEAT)                     # 7.17 G4
piano(bar(2) - BEAT / 2, [72], 0.30, BEAT / 2 + 0.05)  # 7.50 C5 pickup with the board window

# ── A 研究白板 (#3–#7): broken-chord piano + sine bass + paper ticks on 2 and 4 ─────────────────
A_END = bar(11)                                        # 31.833: last bar line before the page turn
section('A 研究白板', bar(2), A_END,
        'broken-chord felt piano + sine bass on the 0.5 s-phase grid, paper ticks on beats 2/4 (pulled back while reading); '
        'chord changes on drop (7.83), ann-add (15.83), cards-new-claim (21.17), paint-apply (26.50)')
PAT1 = [(1.0, 'L', 0.38), (2.0, 0, 0.33), (2.5, 1, 0.27), (3.0, 2, 0.37), (4.0, 1, 0.27), (4.5, 0, 0.24)]
PAT2 = [(1.0, 'L', 0.38), (2.0, 1, 0.31), (2.5, 2, 0.28), (3.0, 0, 0.34), (3.5, 1, 0.25), (4.0, 2, 0.30)]


def broken(m, name, beats=(1, 5), dyn=1.0, pat=PAT1, until=None):
    c = CH[name]
    end = until if until is not None else bar(m + 1)
    for b, idx, v in pat:
        if not beats[0] <= b < beats[1]:
            continue
        t = bar(m, b)
        v *= dyn * (0.72 if reading(t) else 1.0) * (0.75 if near_sfx(t) else 1.0)   # make room for the click
        if idx == 'L':
            piano(t, c['lh'], v, end - t)
        else:
            piano(t, [c['rh'][idx]], v, min(end - t, 1.6))


def bass_bar(m, name, beats=(1, 5), until=None, vel=0.5):
    t0 = bar(m, beats[0])
    t1 = until if until is not None else bar(m, beats[1])
    sine_bass(t0, CH[name]['bass'], t1 - t0 - 0.05, vel)


def pad_span(t0, t1, name, level=0.04, attack=0.9, release=None, **kw):
    """A bowed chord from t0; its release starts at t1, which is where the next chord's attack starts, with the
    same raised-cosine length: complementary crossfade, so tones common to both chords do not pile up."""
    pad(t0, t1, CH[name]['pad'], level=level, attack=attack, release=release or attack, **kw)


# bar 2 (7.83) drop · Fadd9
broken(2, 'Fadd9', dyn=0.9)
bass_bar(2, 'Fadd9', vel=0.42)
pad_span(bar(2) - 0.3, bar(3) - 0.2, 'Fadd9', 0.036)
# bar 3 (10.50) drop-select / ann-details · Dm7
broken(3, 'Dm7', pat=PAT2)
bass_bar(3, 'Dm7')
pad_span(bar(3) - 0.2, bar(4) - 0.2, 'Dm7', 0.036)
# bar 4 (13.17) ann-open, ticks · Bbmaj7 → Csus4 on beat 3 (ann-tick-1)
broken(4, 'Bbmaj7', beats=(1, 3), until=bar(4, 3), dyn=0.85)
broken(4, 'Csus4', beats=(3, 5), pat=[(3.0, 'L', 0.36), (3.0, 2, 0.30), (4.0, 1, 0.28), (4.5, 0, 0.24)])
bass_bar(4, 'Bbmaj7', beats=(1, 3))
bass_bar(4, 'Csus4', beats=(3, 5))
pad_span(bar(4) - 0.2, bar(4, 3) - 0.1, 'Bbmaj7', 0.036)
pad_span(bar(4, 3) - 0.1, bar(5) - 0.15, 'Csus4', 0.036)
# bar 5 (15.83) ann-add: F/A arrival, chord struck together, then pulled back for reading
piano(bar(5), CH['F/A']['lh'] + CH['F/A']['rh'], 0.36, BAR, roll=0.016)
broken(5, 'F/A', beats=(2, 5), dyn=0.85, pat=PAT2)
bass_bar(5, 'F/A', vel=0.45)
pad_span(bar(5) - 0.15, bar(6) - 0.2, 'F/A', 0.04)
# bar 6 (18.50) cards (wide view, push in) · Gm9; motif pickup C5 on beat 4 = cards-context
broken(6, 'Gm9', beats=(1, 4), pat=PAT1)
bass_bar(6, 'Gm9')
pad_span(bar(6) - 0.2, bar(7) - 0.15, 'Gm9', 0.038)
# bar 7 (21.17) cards-new-claim · Bbmaj9 + the rising "line of thought" motif C5–D5–F5–G5–A5
section('motif 思路', at('cards-context'), bar(7, 3.5) + 1.3, 'upward pentatonic line C5 (cards-context) → D5 on cards-new-claim → F5 → G5 → A5 held')
motif = [(at('cards-context'), 72, 0.31), (bar(7), 74, 0.36), (bar(7, 1.5), 77, 0.33), (bar(7, 2), 79, 0.34), (bar(7, 2.5), 81, 0.36)]
for i, (t, n, v) in enumerate(motif):
    piano(t, [n], v, (motif[i + 1][0] - t + 0.25) if i + 1 < len(motif) else 1.9)
piano(bar(7), CH['Bbmaj9']['lh'], 0.30, BAR)
broken(7, 'Bbmaj9', beats=(3.5, 5), dyn=0.8, pat=[(4.0, 0, 0.26), (4.5, 1, 0.22)])
bass_bar(7, 'Bbmaj9', vel=0.42)
pad_span(bar(7) - 0.15, bar(8) - 0.2, 'Bbmaj9', 0.042)
# bar 8 (23.83) painter · Gm7 → C7sus4 (paint-arm) → one beat stop-time (only the pad) before paint-apply
STOP = bar(8, 4)                                         # 25.833
section('stop-time', STOP, at('paint-apply'), 'one beat: piano and bass damped, only the bowed pad (C7sus4) holds')
broken(8, 'Gm7', beats=(1, 3), pat=PAT1, until=bar(8, 3), dyn=0.85)
piano(bar(8, 3), CH['C7sus4']['lh'] + CH['C7sus4']['rh'][1:], 0.30, STOP - bar(8, 3) - 0.03, roll=0.012)
bass_bar(8, 'Gm7', beats=(1, 3), vel=0.42)
sine_bass(bar(8, 3), CH['C7sus4']['bass'], STOP - bar(8, 3) - 0.08, 0.45)
pad_span(bar(8) - 0.2, bar(8, 3) - 0.1, 'Gm7', 0.038)
pad_span(bar(8, 3) - 0.1, at('paint-apply') - 0.05, 'C7sus4', 0.042)
# bar 9 (26.50) paint-apply: the chord returns on the click · Fmaj7, then reading
piano(bar(9), CH['Fmaj7']['lh'] + CH['Fmaj7']['rh'], 0.36, BAR, roll=0.016)
broken(9, 'Fmaj7', beats=(3, 5), dyn=0.8, pat=[(3.0, 2, 0.30), (4.0, 1, 0.26), (4.5, 0, 0.22)])
bass_bar(9, 'Fmaj7', vel=0.48)
pad_span(bar(9) - 0.05, bar(10) - 0.2, 'Fmaj7', 0.04)
# bar 10 (29.17) align · Bbmaj9 → Csus4 on beat 3; piano stops at the bar line before the turn
broken(10, 'Bbmaj9', beats=(1, 3), dyn=0.9, pat=PAT2, until=bar(10, 3))
piano(bar(10, 3), CH['Csus4']['lh'] + CH['Csus4']['rh'][1:], 0.30, A_END - bar(10, 3) - 0.04, roll=0.012)
piano(bar(10, 4), [CH['Csus4']['rh'][0]], 0.22, A_END - bar(10, 4) - 0.04)
bass_bar(10, 'Bbmaj9', beats=(1, 3), vel=0.44)
sine_bass(bar(10, 3), CH['Csus4']['bass'], A_END - bar(10, 3) - 0.06, 0.40)
pad_span(bar(10) - 0.2, bar(10, 3) - 0.1, 'Bbmaj9', 0.038)
# ticks: beats 2 and 4, bars 2–10, never in the stop-time beat; pulled back while reading
for m in range(2, 11):
    for b in (2, 4):
        t = bar(m, b)
        if abs(t - STOP) < 0.01:
            continue
        paper_tick(t, 0.04 * (0.35 if reading(t) else 1.0))

# ── page turn 1 (write-turn 32.0): only the pad ─────────────────────────────────────────────────
B_START = bar(11, 2.5)                                    # 32.833: first arpeggio note after the turn lands
section('turn 1', A_END, B_START, 'page turn (write-turn 32.0): only the bowed pad, Csus4 held, resolving to F as B starts')
pad_span(bar(10, 3) - 0.1, B_START - 0.1, 'Csus4', 0.044, release=0.8)

# ── B Markdown (#8–#10): steady eighth-note arpeggio, like writing ─────────────────────────────
B_END = bar(16, 2) + BEAT / 2                             # 46.0 (dark shot) — last note on 45.833
section('B Markdown 笔记', B_START, SHOT['dark'][0],
        'steady eighth-note felt-piano arpeggio (like writing), LH dyads + sine bass; chord changes 34.50, 37.17, '
        'links-insert 39.83, backlinks 42.50, 45.17; paper ticks only in #9 links')
ARP1 = [0, 2, 1, 3, 2, 1, 3, 2]
ARP2 = [0, 2, 1, 3, 0, 2, 1, 3]
B_BARS = [(11, 'Fadd9'), (12, 'Am7'), (13, 'Bbmaj9'), (14, 'C/E'), (15, 'Gm9'), (16, 'Bbmaj7')]
for m, name in B_BARS:
    c = CH[name]
    pat = ARP1 if m % 2 else ARP2
    for e in range(8):
        t = bar(m, 1 + e / 2)
        if t < B_START - 1e-6 or t > bar(16, 2) + 1e-6:
            continue
        v = (0.31 if e == 0 else 0.27 if e % 2 == 0 else 0.21)
        if reading(t):
            v *= 0.74
        if typing(t):
            v *= 0.7
        if near_sfx(t):
            v *= 0.75
        if m == 16:
            v *= [0.85, 0.65, 0.45][e] if e < 3 else 0
        piano(t, [c['arp'][pat[e]]], v, 0.62)
    lh_t = max(bar(m), bar(11, 3))
    end = min(bar(m + 1), bar(16, 2) + 0.6)
    piano(lh_t, c['lh'], 0.24 if m == 16 or typing(lh_t + 0.2) else 0.30, end - lh_t)
    if m != 16:
        piano(bar(m, 3) if m != 11 else bar(11, 4), [c['lh'][0] + 12], 0.18, BEAT * 1.5)
    sine_bass(lh_t, c['bass'], (end - lh_t) - 0.05 if m != 16 else 1.1, 0.40 if m != 16 else 0.30)
    pad(max(bar(m) - 0.2, B_START - 0.1), bar(m + 1) - 0.2 if m != 16 else at('dark-switch') - 0.25,
        c['pad'], level=0.03 if m != 16 else 0.034, attack=0.8, release=0.8 if m != 16 else 0.6,
        cutoff=1900 if m != 16 else 900)
for m in (12, 13, 14):                                     # ticks in #9 links only
    for b in (2, 4):
        t = bar(m, b)
        if SHOT['links'][0] - 0.01 <= t < SHOT['links'][1]:
            paper_tick(t, 0.035 * (0.35 if reading(t) else 1.0))

# ── #11 dark: low-register chord at dark-switch, darker voicing ─────────────────────────────────
t_dark = at('dark-switch')
t_files = at('files-turn')
section('#11 dark', SHOT['dark'][0], t_files, 'Bbmaj7 pad darkens (900 Hz); at dark-switch a low Dm9 (D2 A2 F3 C4 E4) on piano + D2 sine bass + dark pad (700 Hz)')
piano(t_dark, (38, 45, 53, 60, 64), 0.32, t_files - t_dark + 0.3, roll=0.022)
sine_bass(t_dark, 38, 2.4, 0.42)
pad(t_dark - 0.25, t_files + 0.3, (50, 53, 57, 60), level=0.04, attack=0.6, release=1.1, cutoff=700)
piano(bar(17, 2), [69], 0.20, 1.3)                         # 48.50 A4, a single soft answer

# ── #12 files: only long piano notes ────────────────────────────────────────────────────────────
t_end = at('end-chord')
section('#12 files', t_files, SHOT['end'][0], 'only long felt-piano notes: Bb2+F3 & D5 on files-lift (50.50), C5 51.83, C3+G3 52.50, G4 53.17 (common tone into Fadd9)')
for t, ns, v, off in [(at('files-lift'), (46, 53), 0.28, bar(18, 4)), (at('files-lift'), (74,), 0.33, t_end),
                      (bar(18, 3), (72,), 0.28, t_end), (bar(18, 4), (48, 55), 0.25, t_end), (bar(19), (67,), 0.25, t_end)]:
    piano(t, ns, v, off - t - 0.02)                       # the Bb2+F3 dyad is pedalled off when C3+G3 enters

# ── #13 end: final Fadd9 at end-chord, natural decay complete before 58.4 ──────────────────────
PEDAL_UP = DUR - 1.35                                      # 57.15: pedal released, the chord dies away
section('#13 end', SHOT['end'][0], DUR, f'final Fadd9 (F2 C3 A3 F4 G4 C5) rolled on end-chord {t_end:.3f}; pedal up {PEDAL_UP:.2f}; silent from ~58.2')
piano(t_end, (41, 48, 57, 65, 67, 72), 0.38, PEDAL_UP - t_end, roll=0.02)
sine_bass(t_end, 41, PEDAL_UP - t_end - 0.4, 0.40)
pad(t_end + 0.05, PEDAL_UP - 0.4, (53, 57, 60, 67), level=0.036, attack=0.5, release=1.2, cutoff=1300)


# ── mix ──────────────────────────────────────────────────────────────────────────────────────────
def render():
    r = np.random.default_rng(SEED)
    ti = tt(2.6)
    ir = np.stack([r.standard_normal(len(ti)), r.standard_normal(len(ti))], 1) * np.exp(-ti * 2.7)[:, None]
    ir[:int(0.012 * SR)] = 0                                 # 12 ms pre-delay
    ir = lp(ir, 4500)
    ir /= np.sqrt((ir ** 2).sum(0))
    gains = {'piano': 1.0, 'pad': 1.0, 'bass': 0.13, 'tick': 1.0}
    buses['piano'] = hp(buses['piano'], 60)                 # keep F2/D2 fundamentals, drop rumble below them
    dry = sum(buses[k] * g for k, g in gains.items())
    send = buses['piano'] * 0.30 + buses['pad'] * 0.40 + buses['tick'] * 0.12
    wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1) * 0.55
    mix = low_shelf(hp(dry + wet, 38), 140, -3.0)
    t = np.arange(N) / SR
    # Deliberate ending: the chord has been damped at PEDAL_UP; a short raised-cosine closes the reverb tail.
    close = 0.5 + 0.5 * np.cos(np.pi * np.clip((t - (DUR - 0.85)) / 0.6, 0, 1))
    mix *= (close * np.minimum(1, t / 0.01))[:, None]
    return mix


def soft_limit(x, ceiling, look=0.004, release=0.12):
    """Look-ahead peak limiter (gain computed from the future 4 ms, smoothed release). Only touches the few
    struck chords that exceed the ceiling; reports the deepest reduction."""
    from scipy.ndimage import maximum_filter1d
    from scipy.signal import lfilter
    env = np.abs(x).max(1)
    red = np.maximum(0, 1 - ceiling / np.maximum(env, 1e-9))           # needed reduction (0..1)
    w = int(look * SR)
    red = maximum_filter1d(red, size=2 * w + 1, origin=0)
    a = math.exp(-1 / (release * SR))
    smooth = lfilter([1 - a], [1, -a], red)
    red = np.maximum(red, smooth)                                       # instant attack (within look-ahead), slow release
    red = np.convolve(red, np.ones(w) / w, mode='same')                 # de-click the gain curve
    g = 1 - red
    y = x * g[:, None]
    events, i = [], 0
    while i < len(g):                                                   # where (and how deep) it worked
        if g[i] < 10 ** (-0.5 / 20):
            j = i
            while j < len(g) and g[j] < 0.999:
                j += 1
            events.append([round(i / SR, 2), round(float(20 * math.log10(g[i:j].min())), 1)])
            i = j
        i += 1
    return np.clip(y, -ceiling, ceiling), float(20 * math.log10(max(1e-9, g.min()))), events


def measure(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stderr
    summary = out[out.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    tp = float(re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    return lufs, tp


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--out', type=Path, default=PROJECT / 'assets' / 'music.wav')
    p.add_argument('--target-lufs', type=float, default=-17.5)
    p.add_argument('--describe', action='store_true', help='print grid + section map as JSON and exit')
    p.add_argument('--stems', type=Path, help='also write the unnormalized dry buses (piano/pad/bass/tick) here')
    a = p.parse_args()
    if a.describe:
        print(json.dumps({'bpm': BPM, 'meter': '4/4', 'key': 'F major', 'duration': DUR, 'seed': SEED,
                          'grid': {'beat': round(BEAT, 6), 'phase': round(BAR_ORIGIN % BEAT, 6), 'barOrigin': round(BAR_ORIGIN, 6),
                                   'note': 'beats at 0.5 + k*2/3 s; bars at 2.5 + m*8/3 s'},
                          'onGridActions': {k: {'time': round(at(k), 3), 'bar': m, 'beat': b} for k, (m, b) in ON_GRID.items()},
                          'sections': sorted(SECTIONS, key=lambda s: s['start'])}, ensure_ascii=False, indent=2))
        return
    mix = render()
    if a.stems:
        a.stems.mkdir(parents=True, exist_ok=True)
        for k, x in buses.items():
            sf.write(a.stems / f'{k}.wav', x.astype(np.float32), SR, subtype='FLOAT')
        sf.write(a.stems / 'mix-unnormalized.wav', mix.astype(np.float32), SR, subtype='FLOAT')
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / 'raw.wav'
        sf.write(raw, (mix / np.abs(mix).max() * 0.5).astype(np.float32), SR, subtype='FLOAT')
        lufs, _ = measure(raw)
        g = 10 ** ((a.target_lufs - lufs) / 20) * 0.5 / np.abs(mix).max()
    mix *= g
    # Peak-to-loudness ≤ 13 dB so the film mix (music × 0.65 + SFX) can be normalised to −16 LUFS / −1.5 dBTP
    # by mix_audio.py's loudnorm in *linear* mode (it falls back to dynamic gain riding above ~14.5 dB).
    ceiling = 10 ** ((a.target_lufs + 13.0) / 20)
    mix, deepest, limited = soft_limit(mix, ceiling)
    peak = float(np.abs(mix).max())
    a.out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(a.out, mix.astype(np.float32), SR, subtype='PCM_24')
    lufs, tp = measure(a.out)
    tail = mix[int((DUR - 0.1) * SR):]
    print(json.dumps({'out': str(a.out), 'duration': DUR, 'lufsIntegrated': lufs, 'truePeakDbtp': tp, 'limiterDeepestDb': round(deepest, 2), 'limiterEvents': limited,
                      'samplePeakDbfs': round(20 * math.log10(peak), 2),
                      'last100msPeakDbfs': round(20 * math.log10(max(1e-12, float(np.abs(tail).max()))), 1)}))


if __name__ == '__main__':
    main()
