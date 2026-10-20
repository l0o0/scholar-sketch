#!/usr/bin/env bash
# Rebuild the film's sound from source, in order. Run from the video project root.
#   tools/audio/build.sh            score + SFX + proposed cues + evidence charts + evidence/audio-selection.json
#   tools/audio/build.sh --mix      also mix with the skill's mix_audio.py and measure the result (check_mix.py,
#                                   cue_margins.py per-cue in-band margins, master charts)
#                                   (requires plan.json audio.cues = evidence/audio-cues.proposed.json "cues")
# The SFX follow the picture's own schedules (plan.json action times, src/notes/time.js TODO_UNITS / LINK_UNITS):
# rebuild after any action-time or typed-text change, then copy the proposed cues into plan.json and --mix.
# Needs: python3 -m venv .venv-audio && .venv-audio/bin/pip install numpy==2.5.4 scipy==1.18.1 soundfile==0.14.0 matplotlib==3.11.2
set -euo pipefail
SKILL=${SKILL:-/root/.claude/skills/guizang-product-video-skill}
PY=${PY:-.venv-audio/bin/python}
python3 tools/audio/make_film_sfx.py --output assets/sfx --force
"$PY" assets/audio/score.py
"$PY" tools/audio/plan_cues.py
"$PY" tools/audio/analyze.py assets/music.wav --brief --spectrum evidence/audio/music-spectrum.png \
  --loudness-png evidence/audio/music-loudness.png --ltas evidence/audio/music-ltas.png --marks plan.json > /dev/null
if [[ "${1:-}" == "--mix" ]]; then
  python3 "$SKILL/scripts/mix_audio.py" plan.json
  "$PY" tools/audio/check_mix.py --png evidence/audio/mix-timeline.png > evidence/audio-mix-check.json
  "$PY" tools/audio/cue_margins.py --out evidence/audio-cue-margins.json
  ffmpeg -v error -y -i assets/master.wav -lavfi showspectrumpic=s=1600x500:scale=log:fscale=log:legend=1 evidence/audio/master-spectrum.png
  "$PY" tools/audio/analyze.py assets/master.wav --loudness-png evidence/audio/master-loudness.png --marks plan.json --brief > /dev/null
fi
"$PY" tools/audio/write_selection.py      # folds in the mix measurements when they match the current plan
