# 音效来源与许可

本片的音效全部是程序合成的原创声音，没有录音素材、采样、第三方音效库或参考视频音频。

全部由 `tools/audio/make_film_sfx.py` 生成（只用 Python 标准库，做法同 skill 的 `scripts/make_sfx.py`；每个声音一个固定种子；48 kHz、16-bit，写成左右相同的立体声，因为 `mix_audio.py` 转换单声道时会低 3 dB）。重新生成：`python3 tools/audio/make_film_sfx.py --output assets/sfx --force`，结果逐字节相同。打字声和白板拖动声按画面自己的时间表生成（`plan.json` 的动作时间、`src/notes/time.js` 的 `TODO_UNITS` / `LINK_UNITS`），动作时间或输入文字改了以后要重新生成。

配乐是毡音钢琴，60% 的能量在 250–1000 Hz，2 kHz 以上几乎没有（2026-10-19 审片实测）。所以界面音效都带一层 10–20 毫秒的带通噪声“接触声”（2–4 / 2–5 kHz）：即使钢琴在同一频段响着，点击仍然听得出是点击。

## 由 skill 配方派生的界面音效

`click`、`click-alt`、`toggle`、`pop` 先按 skill `scripts/make_sfx.py` 的同名配方重新合成（已逐样本核对，和 skill 的 `assets/audio/sfx/*.wav` 完全一致），再在起音处叠一层 2–4 kHz 接触声；`pop` 截到 0.13 秒（那时尾音已低 29 dB）。许可：skill 原创音频资产的衍生素材，GNU AGPL-3.0，© 2026 op7418（skill README）。

| 文件 | 用在 |
|---|---|
| `click.wav` | entry-click、drop-select、ann-details、cards-commit、paint-select、links-filter |
| `click-alt.wav` | ann-open、cards-context、paint-arm、links-insert |
| `toggle.wav` | ann-tick-1、ann-tick-2 |
| `pop.wav` | links-popup、files-lift |

skill 内置的 `typing.wav` 没有用：峰值只有 −26.4 dBFS，六个按键时间也不是画面的。打字声按画面的输入时间表另外生成（见下表）。

## 本片生成的音效

许可：本视频工程自己的素材。`click-drop.wav`、`typing-*.wav`、`pop-pair.wav` 按 skill 的 `make_sfx.py` 配方（click、typing、pop，AGPL-3.0）重新合成，按 AGPL-3.0 衍生素材对待。

| 文件 | 声音 | 用在 |
|---|---|---|
| `paper-slide.wav` | 拖动纸页：轻触 + 带通噪声摩擦（3.2 → 1.7 kHz），峰值约 0.10 秒，长 0.62 秒 | drop-grab |
| `paper-drag.wav` | 卡片跟着指针移动：起音处一声轻触（对齐 align-grab），然后是摩擦声，长度 = align-grab 到 align-snap，在吸附前 20 毫秒结束 | align-grab |
| `soft-drop.wav` | 卡片落下：330 / 780 Hz 两个软分音 + 16 毫秒 2–5 kHz 接触声，约 100 毫秒 | drop-release |
| `click-drop.wav` | 点击 + 18 毫秒后一张卡片落下（合成一个声音，避免两条 cue 同帧叠峰），各带接触声 | ann-add（两张引文卡在同一帧出现，所以只有一次落下）、cards-new-claim |
| `brush.wav` | 格式刷：上扫带通噪声（1.6 → 4.5 kHz）加细颗粒，峰值约 0.11 秒，长 0.26 秒 | paint-apply |
| `page-turn.wav` | 折角翻页：0–0.35 秒纸页抬起，约 0.35 秒一声轻皱褶（实测峰值，对齐翻页开始），然后是折线扫过的纸声，约 1.05 秒（翻页结束）纸页落下。不是 whoosh | write-turn、files-turn |
| `snap-tick.wav` | 吸附：2.35 / 3.9 kHz 短 tick + 1.25 kHz 轻柔音体 + 2.5–5 kHz 接触声，约 45 毫秒 | align-snap |
| `logo-fold.wav` | 标志折角：75 毫秒纸张轻弹（2–6 kHz 噪声 + 纤维颗粒），没有低频（初稿的 306 Hz 落点会和配乐的 F4 混在一起） | brand-fold |
| `typing-claim.wav` | 观点卡里 13 个字，每秒 12 个（`src/canvas/board-build.js` CLAIM） | cards-type（21.50–22.50） |
| `typing-long.wav` | 待办一行，按 `TODO_UNITS`：每个 ASCII 字符在它出现的那一帧一下按键；每个中文词出现前一小簇（1–2 下）较轻的拼音按键，最后一下落在词出现的那一帧；`writeEnter` 那一帧回车 | write-type（33.50–34.90） |
| `typing-short.wav` | `[[` 查询，按 `LINK_UNITS`，同样的规则 | links-type（37.30–37.90） |
| `pop-pair.wav` | 两声极轻 pop，间隔 0.2 秒（make_sfx.py 的 pop 配方，更轻，带轻接触声） | entry-items（可选，不是 soundRequired） |

起音点、峰值和电平用 skill 的 `scripts/sfx_landmarks.py` 实测，记录在 `evidence/audio-cues.proposed.json` 和 `evidence/audio-selection.json`；每条 cue 在混音里高出压低后音乐多少（含本频段余量）记录在 `evidence/audio-cue-margins.json`。
