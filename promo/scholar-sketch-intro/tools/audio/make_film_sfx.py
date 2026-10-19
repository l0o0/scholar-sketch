#!/usr/bin/env python3
"""Synthesize the Scholar Sketch film's own paper/desk sounds. No samples or recordings.

Same approach as the skill's scripts/make_sfx.py (standard library only, procedural, 48 kHz 16-bit,
fixed seeds) with a small RBJ biquad for filtered noise. Written as dual-mono stereo (L = R): mix_audio.py
converts mono cues to stereo with ffmpeg's default −3 dB centre mix, so a stereo file keeps its measured
peak in the mix. Sounds (DIRECTION.md §6 sound column):
  paper-slide      drag a paper (drop-grab, align-grab)            ~0.62 s, soft contact, friction peak ~0.10 s
  soft-drop        a card lands (drop-release, cards-new-claim)    ~80 ms, two soft partials 330/780 Hz
  click-drop       click + the new card lands (cards-new-claim)     make_sfx.py's click, soft-drop 18 ms later (one event:
                                                                   two cues on the same frame would stack their peaks)
  click-drop-pair  click + two quote cards land (ann-add)          click, soft-drops at +18 ms and +113 ms
  brush            format painter applies (paint-apply)           ~0.26 s band-passed bristle swish, peak ~0.09 s
  page-turn        the two folded-corner page turns               ~1.3 s: lift rustle, crest at ~0.35 s (turn start),
                                                                   fold-sweep rustle, soft settle at ~1.05 s (turn end)
  snap-tick        alignment snap (align-snap)                     ~40 ms, very light high tick
  logo-fold        the logo's corner folds in (brand-fold)         ~0.14 s soft paper crease tick + body
  typing-long      two keyboard bursts over 1.4 s (write-type)     make_sfx.py's keystroke recipe, other timings/seed
  pop-pair         two very light pops 0.2 s apart (entry-items)   make_sfx.py's pop recipe, softer
  typing-short     one keyboard burst 0.65 s (links-type)          make_sfx.py's 'typing' (same six key times), +7 dB:
                                                                   the bundled typing.wav peaks at −26.4 dBFS (−29.4 after
                                                                   mix_audio.py's mono→stereo), below the music even at gain 4
Usage: python3 tools/audio/make_film_sfx.py --output assets/sfx [--force]
"""
import argparse
import array
import math
from pathlib import Path
import random
import sys
import wave

RATE = 48000
NAMES = ['paper-slide', 'soft-drop', 'click-drop', 'click-drop-pair', 'brush', 'page-turn', 'snap-tick', 'logo-fold', 'typing-long', 'pop-pair', 'typing-short', 'typing-claim']
SEEDS = {'paper-slide': 3101, 'soft-drop': 3102, 'click-drop': 3103, 'click-drop-pair': 3104, 'brush': 3105,   # fixed per sound,
         'page-turn': 3106, 'snap-tick': 3107, 'logo-fold': 3108, 'typing-long': 3109, 'pop-pair': 3110,      # independent of
         'typing-short': 3111, 'typing-claim': 3112}                                                                                # list order


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


def sound(kind):
    rng = random.Random(SEEDS[kind])
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
    if kind == 'soft-drop':
        out = partial_knock([330, 780], [0.020, 0.011], [1.0, 0.45], 0.10)
        tap = biquad(noise(rng, round(0.012 * RATE)), 'lp', 1600, 0.7)
        add(out, [v * math.exp(-i / RATE / 0.003) * 0.25 for i, v in enumerate(tap)], 0.0)
        return norm([v * min(1.0, (0.10 - i / RATE) / 0.015) for i, v in enumerate(out)], 0.22)
    if kind in ('click-drop', 'click-drop-pair'):
        # make_sfx.py 'click' (bell 740 Hz, 0.14 s) exactly, then the card(s) landing
        click = [0.0] * round(0.14 * RATE)
        for i in range(len(click)):
            t = i / RATE
            env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (.14 / 5)) * min(1, (.14 - t) / .025)
            click[i] = .15 * env * (math.sin(math.tau * 740 * t) + .16 * math.sin(math.tau * 1480 * t) * math.exp(-t * 12))
        dur = 0.24 if kind == 'click-drop-pair' else 0.16
        out = [0.0] * round(dur * RATE)
        add(out, norm(click, 1.0), 0.0)
        drops = [(0.018, [330, 780], 0.8)] + ([(0.113, [350, 830], 0.65)] if kind == 'click-drop-pair' else [])
        for at, fr, lv in drops:
            add(out, norm(partial_knock(fr, [0.020, 0.011], [1.0, 0.45], 0.10), lv), at)
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
        out = partial_knock([2350, 3900], [0.005, 0.003], [1.0, 0.6], 0.04, drop=0.0, attack=0.0004)
        clk = biquad(noise(rng, round(0.002 * RATE)), 'hp', 3000, 0.7)
        add(out, clk, 0.0, 0.3)
        return norm(out, 0.12)
    if kind == 'logo-fold':
        n = round(0.14 * RATE)
        out = [0.0] * n
        crease = biquad(biquad(noise(rng, round(0.03 * RATE)), 'hp', 1800, 0.7), 'lp', 5000, 0.7)
        add(out, [v * (1 - math.exp(-i / RATE / 0.0005)) * math.exp(-i / RATE / 0.006) for i, v in enumerate(crease)], 0.0)
        add(out, partial_knock([280, 610], [0.016, 0.009], [0.5, 0.25], 0.09), 0.018)
        return norm([v * min(1.0, (0.14 - i / RATE) / 0.02) for i, v in enumerate(out)], 0.20)
    if kind in ('typing-long', 'typing-short', 'typing-claim'):
        # keystrokes exactly as scripts/make_sfx.py 'typing', two bursts (DIRECTION #8: 键盘声两簇)
        dur = 1.45
        samples = [0.0] * round(dur * RATE)

        def bell(at, frequency, length, level):
            offset = round(at * RATE)
            for i in range(min(round(length * RATE), len(samples) - offset)):
                t = i / RATE
                env = (1 - math.exp(-t / 0.004)) * math.exp(-t / (length / 5)) * min(1, (length - t) / .025)
                partial = math.sin(math.tau * frequency * t) + .16 * math.sin(math.tau * frequency * 2 * t) * math.exp(-t * 12)
                samples[offset + i] += level * env * partial
        hits = [0, .085, .18, .245, .39, .49, .80, .875, .965, 1.04, 1.16, 1.25, 1.33]
        if kind == 'typing-short':
            dur, hits = 0.65, hits[:6]
            samples = samples[:round(dur * RATE)]
        if kind == 'typing-claim':   # the claim card's 13 characters at 12/s (src/canvas/board-build.js CLAIM)
            hits = [k / 12 for k in range(13)]
            dur = 1.2
            samples = samples[:round(dur * RATE)]
        for j, at in enumerate(hits):
            bell(at, 650 + 90 * (j % 3), .06, .07 * (0.92 + 0.16 * rng.random()))
            pos = round(at * RATE)
            for i in range(round(.022 * RATE)):
                if pos + i < len(samples):
                    samples[pos + i] += .04 * rng.uniform(-1, 1) * math.sin(math.pi * i / (.022 * RATE)) * math.exp(-i / RATE * 120)
        return [v * (1.6 if kind == 'typing-long' else 2.2) for v in samples]   # typing-claim uses typing-short's level
    if kind == 'pop-pair':
        out = [0.0] * round(0.45 * RATE)
        for at, base, lv in [(0.0, 240, 0.16), (0.2, 270, 0.13)]:
            one = []
            for i in range(round(0.22 * RATE)):
                t = i / RATE
                phase = math.tau * (base * t + 2 * base * .022 * (1 - math.exp(-t / .022)))
                one.append(lv * math.sin(phase) * (1 - math.exp(-t / .002)) * math.exp(-t * 28))
            add(out, one, at)
        return out
    raise ValueError(kind)


def to_pcm(samples):
    pcm = array.array('h', (v for x in samples for v in [round(max(-.95, min(.95, x)) * 32767)] * 2))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return pcm


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--force', action='store_true', help='overwrite this script\'s own outputs')
    p.add_argument('--only', nargs='*', choices=NAMES)
    args = p.parse_args()
    names = args.only or NAMES
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
