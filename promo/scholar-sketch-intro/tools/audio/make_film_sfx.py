#!/usr/bin/env python3
"""Synthesize the Scholar Sketch film's own paper/desk/UI sounds. No samples or recordings.

Same approach as the skill's scripts/make_sfx.py (standard library only, procedural, 48 kHz 16-bit,
fixed seeds) with a small RBJ biquad for filtered noise. Written as dual-mono stereo (L = R): mix_audio.py
converts mono cues to stereo with ffmpeg's default −3 dB centre mix, so a stereo file keeps its measured
peak in the mix.

The felt-piano score holds ~60 % of its energy at 250–1000 Hz and almost nothing above 2 kHz (review
2026-10-19), so every UI sound carries a short band-passed noise "contact" (10–20 ms, 2–4 / 2–5 kHz): the
click is heard as a click there even when a piano note rings in its tonal band. Sounds (DIRECTION.md §6):
  click / click-alt / toggle / pop   the skill's make_sfx.py recipes re-synthesized sample-exactly (checked
                   against assets/audio/sfx/*.wav in the skill) + a soft 2–4 kHz contact at the onset; pop
                   trimmed to 0.13 s (its tail is −29 dB by then) so it stays one short event
  paper-slide      drag a paper (drop-grab)                        ~0.62 s, soft contact, friction peak ~0.10 s
  paper-drag       the reading-note card follows the pointer (align-grab): contact at the grab, friction that
                   lasts exactly from align-grab to align-snap in plan.json (ends 20 ms before the snap)
  soft-drop        a card lands (drop-release)                     ~80 ms knock 330/780 Hz + 2–5 kHz contact
  click-drop       click + one card lands (cards-new-claim, ann-add) click, soft-drop 18 ms later (one event:
                   two cues on the same frame would stack their peaks; ann-add's two quote cards appear on the
                   same frame, so it is one landing too)
  brush            format painter applies (paint-apply)           ~0.26 s band-passed bristle swish, peak ~0.09 s
  page-turn        the two folded-corner page turns               ~1.3 s: lift rustle, crest at ~0.35 s (turn start),
                                                                   fold-sweep rustle, soft settle at ~1.05 s (turn end)
  snap-tick        alignment snap (align-snap)                     ~45 ms high tick 2.35/3.9 kHz with a 1.25 kHz body
                                                                   and a 2.5–5 kHz contact
  logo-fold        the logo's corner folds in (brand-fold)         ~75 ms paper flick: 2–6 kHz noise + fibre grains,
                                                                   no low body (the first draft's 306 Hz knock fused
                                                                   with the score's F4)
  typing-claim     the claim card's 13 characters at 12/s (cards-type, src/canvas/board-build.js CLAIM)
  typing-long      the to-do line (write-type), from src/notes/time.js TODO_UNITS: one key per ASCII unit on
                   the frame it appears, a short pinyin burst (1–2 lighter keys) ending with the commit key on the
                   frame each Chinese word appears, Enter on writeEnter
  typing-short     the [[ query (links-type), from src/notes/time.js LINK_UNITS, same rules
  pop-pair         two very light pops 0.2 s apart (entry-items)   make_sfx.py's pop recipe, softer, light contact
The typing schedules and the drag length are read from the project (plan.json, src/notes/time.js), so a
rebuild follows retimed actions. Keystrokes: make_sfx.py's 'typing' recipe (bell 650–830 Hz + noise click).
Usage: python3 tools/audio/make_film_sfx.py --output assets/sfx [--force] [--only NAME ...]
       python3 tools/audio/make_film_sfx.py --schedule      (print the typing key times and the drag length)
"""
import argparse
import array
import json
import math
from pathlib import Path
import random
import re
import sys
import wave

RATE = 48000
PROJECT = Path(__file__).resolve().parents[2]
NAMES = ['click', 'click-alt', 'toggle', 'pop', 'paper-slide', 'paper-drag', 'soft-drop', 'click-drop', 'brush', 'page-turn',
         'snap-tick', 'logo-fold', 'typing-long', 'pop-pair', 'typing-short', 'typing-claim']
RETIRED = ['click-drop-pair']   # ann-add's two quote cards appear on one frame: one landing (click-drop)
SEEDS = {'paper-slide': 3101, 'soft-drop': 3102, 'click-drop': 3103, 'brush': 3105,                     # fixed per sound,
         'page-turn': 3106, 'snap-tick': 3107, 'logo-fold': 3108, 'typing-long': 3109, 'pop-pair': 3110,  # independent of
         'typing-short': 3111, 'typing-claim': 3112, 'paper-drag': 3113, 'click': 3114,                # list order
         'click-alt': 3115, 'toggle': 3116, 'pop': 3117}


# ── what the picture does (read from the project, so a rebuild follows retimed actions) ──────────────────
def _plan():
    return json.loads((PROJECT / 'plan.json').read_text())


def action_time(action_id):
    """src/stage/layout.js actionTime(): shot.start + action.at snapped to the frame grid (JS Math.round)."""
    plan = _plan()
    for s in plan['shots']:
        for a in s.get('actions', []):
            if a['id'] == action_id:
                return math.floor((s['start'] + a['at']) * plan['fps'] + 0.5) / plan['fps']
    raise KeyError(action_id)


def first_frame(t):
    """Time of the first rendered frame f / fps with f / fps >= t (render.mjs seeks f / plan.fps)."""
    fps = _plan()['fps']
    f = max(0, math.ceil(t * fps) - 1)
    while f / fps < t:
        f += 1
    return f / fps


def js_units(name):
    """[[offset, text], ...] of an export in src/notes/time.js (TODO_UNITS, LINK_UNITS)."""
    src = (PROJECT / 'src/notes/time.js').read_text()
    m = re.search(r'export const ' + name + r'\s*=\s*\[(.*?)\]\s*;', src, re.S)
    if not m:
        raise SystemExit(f'make_film_sfx.py: {name} not found in src/notes/time.js')
    units = [(float(o), t.replace("\\'", "'")) for o, t in re.findall(r"\[\s*([0-9.]+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]", m.group(1))]
    if not units:
        raise SystemExit(f'make_film_sfx.py: could not parse {name}')
    return units


def js_write_enter():
    src = (PROJECT / 'src/notes/time.js').read_text()
    m = re.search(r'writeEnter:\s*(?:snap\(\s*)?writeType\s*\+\s*([0-9.]+)', src)   # time.js may frame-snap it
    if not m:
        raise SystemExit('make_film_sfx.py: writeEnter not found in src/notes/time.js')
    return float(m.group(1))


IME_GAP = 0.06       # pinyin keys before a commit, this far apart (a quick roll)


def typed_keys(units, action_id, enter=None):
    """Keystrokes (t from the action time, level, kind) for typed units: one key per ASCII character on the frame
    the unit appears; a Chinese unit is an IME commit, so a short pinyin burst (1–2 lighter keys, 60 ms apart,
    never closer than 40 ms to the previous key) ends with the commit key on the frame the word appears."""
    at = action_time(action_id)
    keys, prev = [], None
    for off, text in units:
        t = first_frame(at + off) - at
        if all(ord(ch) < 128 for ch in text):
            # several ASCII characters in one unit land together; one key per unit is what the picture shows
            keys.append((t, 1.0, 'key'))
        else:
            if prev is not None:
                n = min(2, int((t - prev - 0.04) / IME_GAP + 1e-9))
                keys += [(t - j * IME_GAP, 0.7, 'pinyin') for j in range(n, 0, -1)]
            keys.append((t, 1.0, 'commit'))
        prev = t
    if enter is not None:
        keys.append((first_frame(at + enter) - at, 1.1, 'enter'))
    return [(round(t, 4), lv, kind) for t, lv, kind in keys]


def key_schedule(name):
    """(t, level) of every keystroke in a typing file (t = seconds from the file start), or None."""
    if name == 'typing-claim':
        return [(k / 12, 1.0) for k in range(13)]
    if name == 'typing-long':
        return [(t, lv) for t, lv, _ in typed_keys(js_units('TODO_UNITS'), 'write-type', js_write_enter())]
    if name == 'typing-short':
        return [(t, lv) for t, lv, _ in typed_keys(js_units('LINK_UNITS'), 'links-type')]
    return None


def drag_length():
    """align-grab → align-snap: how long the card visibly follows the pointer."""
    return action_time('align-snap') - action_time('align-grab')


def biquad(x, kind, f0, q=0.707):
    """RBJ cookbook biquad (lowpass / highpass / bandpass with 0 dB peak)."""
    w0 = 2 * math.pi * f0 / RATE
    alpha = math.sin(w0) / (2 * q)
    c = math.cos(w0)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:
        b = [alpha, 0, -alpha]
    a0, a1, a2 = 1 + alpha, -2 * c, 1 - alpha
    b0, b1, b2 = (v / a0 for v in b)
    a1 /= a0
    a2 /= a0
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def sweep_bp(x, f_start, f_end, q, block=256):
    """Band-pass whose centre moves exponentially from f_start to f_end (state carried across blocks)."""
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    nb = max(1, (len(x) + block - 1) // block)
    for bi in range(nb):
        f0 = f_start * (f_end / f_start) ** (bi / max(1, nb - 1))
        w0 = 2 * math.pi * f0 / RATE
        alpha = math.sin(w0) / (2 * q)
        c = math.cos(w0)
        a0 = 1 + alpha
        b0, b2, a1, a2 = alpha / a0, -alpha / a0, -2 * c / a0, (1 - alpha) / a0
        for i in range(bi * block, min(len(x), (bi + 1) * block)):
            v = x[i]
            out = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, v, y1, out
            y[i] = out
    return y


def norm(x, peak):
    m = max(abs(v) for v in x) or 1.0
    return [v * peak / m for v in x]


def add(dst, src, at, gain=1.0):
    off = round(at * RATE)
    for i, v in enumerate(src):
        if 0 <= off + i < len(dst):
            dst[off + i] += v * gain


def partial_knock(freqs, taus, levels, dur, drop=0.04, attack=0.0015):
    """Soft knock: decaying sine partials with a small downward pitch settle."""
    n = round(dur * RATE)
    out = [0.0] * n
    for f, tau, lv in zip(freqs, taus, levels):
        ph = 0.0
        for i in range(n):
            t = i / RATE
            ph += 2 * math.pi * f * (1 + drop * math.exp(-t / 0.012)) / RATE
            env = (1 - math.exp(-t / attack)) * math.exp(-t / tau)
            out[i] += lv * env * math.sin(ph)
    return out


def noise(rng, n):
    return [rng.uniform(-1, 1) for _ in range(n)]


def crackle(rng, n, density_fn, lo=2200, hi=7000):
    """Sparse paper-fibre grains: 0.6–1.2 ms decaying impulses at a time-varying density, band-passed."""
    x = [0.0] * n
    i = 0
    while i < n:
        t = i / RATE
        d = max(1e-3, density_fn(t))
        i += max(1, int(rng.expovariate(d) * RATE))
        if i >= n:
            break
        amp = rng.uniform(0.3, 1.0) * (1 if rng.random() < 0.5 else -1)
        tau = rng.uniform(0.0006, 0.0012)
        for k in range(int(tau * 6 * RATE)):
            if i + k < n:
                x[i + k] += amp * math.exp(-k / RATE / tau)
    return biquad(biquad(x, 'hp', lo, 0.7), 'lp', hi, 0.7)


def band_noise(rng, n, lo, hi):
    """White noise through 2nd-order high-pass lo and low-pass hi, each applied twice (≈ 24 dB/oct skirts)."""
    pre = 256                                           # let the filters settle before the part we keep
    x = noise(rng, n + pre)
    for _ in range(2):
        x = biquad(x, 'hp', lo, 0.707)
    for _ in range(2):
        x = biquad(x, 'lp', hi, 0.707)
    return x[pre:]


def contact(rng, lo=2000, hi=4000, dur=0.014, tau=0.003):
    """The 10–20 ms contact transient: band-passed noise, 0.3 ms attack, exponential decay; peak 1."""
    n = round(dur * RATE)
    x = band_noise(rng, n, lo, hi)
    out = [v * (1 - math.exp(-i / RATE / 0.0003)) * math.exp(-i / RATE / tau) * min(1.0, (n - i) / (0.003 * RATE))
           for i, v in enumerate(x)]
    return norm(out, 1.0)


def skill_sound(kind):
    """scripts/make_sfx.py's click / click-alt / pop / toggle, exactly (float samples before 16-bit rounding)."""
    duration = {'click': .16, 'click-alt': .12, 'pop': .22, 'toggle': .25}[kind]
    samples = [0.0] * round(duration * RATE)

    def bell(at, frequency, length, level):
        offset = round(at * RATE)
        for i in range(min(round(length * RATE), len(samples) - offset)):
            t = i / RATE
            env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (length / 5)) * min(1, (length - t) / .025)
            partial = math.sin(math.tau * frequency * t) + .16 * math.sin(math.tau * frequency * 2 * t) * math.exp(-t * 12)
            samples[offset + i] += level * env * partial
    if kind == 'click':
        bell(0, 740, .14, .15)
    elif kind == 'click-alt':
        bell(0, 590, .10, .14)
    elif kind == 'pop':
        for i in range(len(samples)):
            t = i / RATE
            phase = math.tau * (240 * t + 480 * .022 * (1 - math.exp(-t / .022)))
            samples[i] = .22 * math.sin(phase) * (1 - math.exp(-t / .002)) * math.exp(-t * 28)
    else:
        bell(0, 600, .11, .13)
        bell(.07, 920, .15, .16)
    return samples


CONTACT = {   # UI sound: (contact level × the recipe's peak, band, length, decay, at)
    'click': [(0.55, 2000, 4000, 0.014, 0.003, 0.0)],
    'click-alt': [(0.55, 1900, 3800, 0.014, 0.003, 0.0)],
    'toggle': [(0.45, 2000, 4000, 0.012, 0.0025, 0.0), (0.35, 2400, 4500, 0.010, 0.002, 0.07)],
    'pop': [(0.45, 2000, 4000, 0.012, 0.0025, 0.0)],
}


def sound(kind):
    rng = random.Random(SEEDS[kind])
    if kind in CONTACT:
        out = skill_sound(kind)
        if kind == 'pop':                               # one short event: −29 dB by 0.12 s, cut at 0.13 s
            out = out[:round(0.13 * RATE)]
            out = [v * min(1.0, (len(out) - i) / (0.015 * RATE)) for i, v in enumerate(out)]
        pk = max(abs(v) for v in out)
        for lv, lo, hi, dur, tau, at in CONTACT[kind]:
            add(out, contact(rng, lo, hi, dur, tau), at, lv * pk)
        return out
    if kind == 'paper-slide':
        dur = 0.62
        n = round(dur * RATE)
        base = sweep_bp(noise(rng, n), 3200, 1700, 0.9)
        flutter = biquad(noise(rng, n), 'lp', 45, 0.7)
        fm = max(abs(v) for v in flutter) or 1
        out = []
        for i, v in enumerate(base):
            t = i / RATE
            env = (t / 0.10) ** 1.6 if t < 0.10 else math.exp(-(t - 0.10) / 0.17)
            env *= min(1.0, (dur - t) / 0.06)
            out.append(v * env * (0.72 + 0.28 * abs(flutter[i]) / fm))
        grain = crackle(rng, n, lambda t: 180 * math.exp(-t / 0.25), 1800, 6000)
        out = [a + 0.18 * b for a, b in zip(out, grain)]
        press = partial_knock([410], [0.006], [0.25], 0.03)
        add(out, press, 0.0)
        return norm(out, 0.26)
    if kind == 'paper-drag':
        # the card is picked up (contact at 0 = the measured onset, aligned with align-grab) and follows the pointer
        # until it snaps: friction only while it visibly moves, gone 20 ms before align-snap's tick
        dur = max(0.25, drag_length() - 0.02)
        n = round(dur * RATE)
        base = sweep_bp(noise(rng, n), 2600, 1900, 0.9)
        flutter = biquad(noise(rng, n), 'lp', 40, 0.7)
        fm = max(abs(v) for v in flutter) or 1
        out = []
        for i, v in enumerate(base):
            t = i / RATE
            env = (t / 0.06) ** 1.5 if t < 0.06 else 1.0 - 0.35 * (t - 0.06) / max(0.01, dur - 0.06)
            env *= min(1.0, (dur - t) / 0.06)
            out.append(v * env * (0.72 + 0.28 * abs(flutter[i]) / fm))
        out = norm(out, 1.0)
        grain = crackle(rng, n, lambda t: 140, 1800, 6000)
        out = [a + 0.18 * b for a, b in zip(out, grain)]
        add(out, norm(partial_knock([410], [0.006], [0.25], 0.03), 0.5), 0.0)
        add(out, contact(rng, 2000, 4500, 0.012, 0.0025), 0.0, 0.8)
        return norm(out, 0.24)
    if kind == 'soft-drop':
        out = partial_knock([330, 780], [0.020, 0.011], [1.0, 0.45], 0.10)
        tap = biquad(noise(rng, round(0.012 * RATE)), 'lp', 1600, 0.7)
        add(out, [v * math.exp(-i / RATE / 0.003) * 0.25 for i, v in enumerate(tap)], 0.0)
        # the card's edge meeting the board: a 16 ms 2–5 kHz contact the piano cannot cover (review: the 340 Hz
        # knock alone sat inside the piano band, +3.5 dB in its own band)
        add(out, contact(rng, 2000, 5000, 0.016, 0.0035), 0.0, 0.55 * max(abs(v) for v in out))
        return norm([v * min(1.0, (0.10 - i / RATE) / 0.015) for i, v in enumerate(out)], 0.22)
    if kind == 'click-drop':
        # make_sfx.py 'click' (bell 740 Hz, 0.14 s) exactly + its contact, then the card landing (+ its contact)
        click = [0.0] * round(0.14 * RATE)
        for i in range(len(click)):
            t = i / RATE
            env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (.14 / 5)) * min(1, (.14 - t) / .025)
            click[i] = .15 * env * (math.sin(math.tau * 740 * t) + .16 * math.sin(math.tau * 1480 * t) * math.exp(-t * 12))
        dur = 0.16
        out = [0.0] * round(dur * RATE)
        add(out, norm(click, 1.0), 0.0)
        add(out, contact(rng, 2000, 4000, 0.014, 0.003), 0.0, 0.55)
        add(out, norm(partial_knock([330, 780], [0.020, 0.011], [1.0, 0.45], 0.10), 0.8), 0.018)
        add(out, contact(rng, 2000, 5000, 0.014, 0.003), 0.018, 0.35)
        return norm([v * min(1.0, (dur - i / RATE) / 0.015) for i, v in enumerate(out)], 0.22)
    if kind == 'brush':
        dur = 0.26
        n = round(dur * RATE)
        sw = sweep_bp(noise(rng, n), 1600, 4500, 1.1)
        grain = crackle(rng, n, lambda t: 300, 3000, 7000)
        out = []
        for i in range(n):
            t = i / RATE
            env = (t / 0.09) ** 2 if t < 0.09 else 0.5 + 0.5 * math.cos(math.pi * (t - 0.09) / (dur - 0.09))
            out.append((sw[i] + 0.3 * grain[i]) * env)
        return norm(out, 0.24)
    if kind == 'page-turn':
        dur = 1.32
        n = round(dur * RATE)
        crest = 0.35
        lift = sweep_bp(noise(rng, n), 1200, 2600, 0.8)
        fold = sweep_bp(noise(rng, n), 2600, 1100, 0.8)
        flutter = biquad(noise(rng, n), 'lp', 30, 0.7)
        fm = max(abs(v) for v in flutter) or 1
        grains = crackle(rng, n, lambda t: 40 + 900 * math.exp(-((t - crest) / 0.03) ** 2) + 70 * (crest < t < 1.0), 1800, 6500)
        out = []
        for i in range(n):
            t = i / RATE
            if t < crest:
                e_lift = 0.55 * (t / crest) ** 2.5
                e_fold = 0.0
            else:
                e_lift = 0.55 * math.exp(-(t - crest) / 0.05)
                e_fold = 0.42 * math.exp(-(t - crest) / 0.55) * min(1.0, (t - crest) / 0.03)
            e_fold *= min(1.0, max(0.0, (dur - t) / 0.25))
            tex = 0.75 + 0.25 * abs(flutter[i]) / fm
            out.append(lift[i] * e_lift * tex + fold[i] * e_fold * tex + 0.5 * grains[i] * (0.4 + 0.6 * math.exp(-((t - crest) / 0.04) ** 2)))
        out = norm(out, 1.0)
        # the crest: one soft crinkle exactly at the turn start (the measured peak / syncOffset)
        crinkle = biquad(noise(rng, round(0.03 * RATE)), 'bp', 2400, 0.9)
        add(out, norm([v * math.exp(-i / RATE / 0.008) for i, v in enumerate(crinkle)], 0.5), crest - 0.002)
        # the settle: the page lies down at the end of the 0.7 s fold
        settle = partial_knock([220, 520], [0.022, 0.012], [1.0, 0.4], 0.09)
        tap = biquad(noise(rng, round(0.02 * RATE)), 'bp', 1500, 0.8)
        add(out, settle, crest + 0.70, 0.30)
        add(out, [v * math.exp(-i / RATE / 0.005) for i, v in enumerate(tap)], crest + 0.70, 0.35)
        return norm(out, 0.30)
    if kind == 'snap-tick':
        # still a light high tick, now with a little body and a contact so it is not mistaken for the score's
        # high partials (review: the first draft sat under the music at its own moment)
        out = partial_knock([2350, 3900], [0.006, 0.0035], [1.0, 0.6], 0.045, drop=0.0, attack=0.0004)
        add(out, partial_knock([1250], [0.008], [0.45], 0.045, drop=0.0, attack=0.0006), 0.0)
        add(out, contact(rng, 2500, 5000, 0.010, 0.002), 0.0, 0.7)
        return norm([v * min(1.0, (0.045 - i / RATE) / 0.008) for i, v in enumerate(out)], 0.2)
    if kind == 'logo-fold':
        # a paper flick (like page-turn's crest crinkle): 2–6 kHz noise snap + a few fibre grains, 75 ms, no body
        dur = 0.075
        n = round(dur * RATE)
        flick = band_noise(rng, n, 2000, 6000)
        out = [v * (1 - math.exp(-i / RATE / 0.0004)) * (0.75 * math.exp(-i / RATE / 0.007) + 0.25 * math.exp(-i / RATE / 0.025))
               for i, v in enumerate(flick)]
        out = norm(out, 1.0)
        grains = crackle(rng, n, lambda t: 900 * math.exp(-t / 0.02), 2200, 6500)
        add(out, norm(grains, 1.0), 0.0, 0.35)
        return norm([v * min(1.0, (dur - i / RATE) / 0.015) for i, v in enumerate(out)], 0.20)
    if kind in ('typing-long', 'typing-short'):
        # keystrokes as scripts/make_sfx.py 'typing', on the picture's own input schedule (key_schedule)
        keys = typed_keys(*((js_units('TODO_UNITS'), 'write-type', js_write_enter()) if kind == 'typing-long'
                            else (js_units('LINK_UNITS'), 'links-type')))
        dur = keys[-1][0] + 0.12
        samples = [0.0] * round(dur * RATE)

        def bell(at, frequency, length, level):
            offset = round(at * RATE)
            for i in range(min(round(length * RATE), len(samples) - offset)):
                t = i / RATE
                env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (length / 5)) * min(1, (length - t) / .025)
                partial = math.sin(math.tau * frequency * t) + .16 * math.sin(math.tau * frequency * 2 * t) * math.exp(-t * 12)
                samples[offset + i] += level * env * partial
        for j, (at, lv, what) in enumerate(keys):
            if what == 'enter':
                bell(at, 540, .08, .075 * lv)
            else:
                bell(at, 650 + 90 * (j % 3), .06, .07 * lv * (0.92 + 0.16 * rng.random()))
            pos = round(at * RATE)
            for i in range(round(.022 * RATE)):
                if pos + i < len(samples):
                    samples[pos + i] += .04 * lv * rng.uniform(-1, 1) * math.sin(math.pi * i / (.022 * RATE)) * math.exp(-i / RATE * 120)
        return [v * 2.2 for v in samples]
    if kind == 'typing-claim':
        # keystrokes exactly as scripts/make_sfx.py 'typing' (unchanged since the first draft)
        dur = 1.45
        samples = [0.0] * round(dur * RATE)

        def bell(at, frequency, length, level):
            offset = round(at * RATE)
            for i in range(min(round(length * RATE), len(samples) - offset)):
                t = i / RATE
                env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (length / 5)) * min(1, (length - t) / .025)
                partial = math.sin(math.tau * frequency * t) + .16 * math.sin(math.tau * frequency * 2 * t) * math.exp(-t * 12)
                samples[offset + i] += level * env * partial
        hits = [k / 12 for k in range(13)]   # the claim card's 13 characters at 12/s (src/canvas/board-build.js CLAIM)
        dur = 1.2
        samples = samples[:round(dur * RATE)]
        for j, at in enumerate(hits):
            bell(at, 650 + 90 * (j % 3), .06, .07 * (0.92 + 0.16 * rng.random()))
            pos = round(at * RATE)
            for i in range(round(.022 * RATE)):
                if pos + i < len(samples):
                    samples[pos + i] += .04 * rng.uniform(-1, 1) * math.sin(math.pi * i / (.022 * RATE)) * math.exp(-i / RATE * 120)
        return [v * 2.2 for v in samples]
    if kind == 'pop-pair':
        out = [0.0] * round(0.45 * RATE)
        for at, base, lv in [(0.0, 240, 0.16), (0.2, 270, 0.13)]:
            one = []
            for i in range(round(0.22 * RATE)):
                t = i / RATE
                phase = math.tau * (base * t + 2 * base * .022 * (1 - math.exp(-t / .022)))
                one.append(lv * math.sin(phase) * (1 - math.exp(-t / .002)) * math.exp(-t * 28))
            add(out, one, at)
            add(out, contact(rng, 2000, 4000, 0.012, 0.0025), at, 0.35 * lv)
        return out
    raise ValueError(kind)


def to_pcm(samples):
    pcm = array.array('h', (v for x in samples for v in [round(max(-.95, min(.95, x)) * 32767)] * 2))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return pcm


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--output', type=Path)
    p.add_argument('--force', action='store_true', help='overwrite this script\'s own outputs')
    p.add_argument('--only', nargs='*', choices=NAMES)
    p.add_argument('--schedule', action='store_true', help='print the typing key schedules and the drag length, write nothing')
    args = p.parse_args()
    if args.schedule:
        print(json.dumps({'typing-long': typed_keys(js_units('TODO_UNITS'), 'write-type', js_write_enter()),
                          'typing-short': typed_keys(js_units('LINK_UNITS'), 'links-type'),
                          'paper-drag': {'alignGrab': action_time('align-grab'), 'alignSnap': action_time('align-snap'),
                                         'seconds': round(drag_length() - 0.02, 4)}}, ensure_ascii=False, indent=1))
        return
    if not args.output:
        p.error('--output is required')
    names = args.only or NAMES
    if args.force and not args.only:
        for old in RETIRED:                     # sounds this script used to write and no cue uses any more
            if (args.output / (old + '.wav')).exists():
                (args.output / (old + '.wav')).unlink()
                print('removed', args.output / (old + '.wav'))
    if not args.force and any((args.output / (name + '.wav')).exists() for name in names):
        p.error('Sound files already exist; pass --force to regenerate this script\'s own sounds.')
    args.output.mkdir(parents=True, exist_ok=True)
    for name in names:
        with wave.open(str(args.output / (name + '.wav')), 'wb') as f:
            f.setnchannels(2)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes(to_pcm(sound(name)).tobytes())
        print('wrote', args.output / (name + '.wav'))


if __name__ == '__main__':
    main()
