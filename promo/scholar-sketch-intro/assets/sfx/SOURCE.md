# 音效来源与许可

本片的音效全部是程序合成的原创声音，没有录音素材、采样、第三方音效库或参考视频音频。

## 从 skill 复制的内置 WAV（原样复制，未改动）

来源：`guizang-product-video-skill/assets/audio/sfx/`，由该 skill 的 `scripts/make_sfx.py` 生成（48 kHz、单声道、16-bit）。许可：GNU AGPL-3.0，© 2026 op7418（skill 的 README “原创音频资产采用 AGPL-3.0”）。SHA-256 与 skill 的 `assets/audio/manifest.json` 一致。

| 文件 | 用在 | SHA-256 |
|---|---|---|
| `click.wav` | entry-click、drop-select、ann-details、paint-select、links-filter、back-click | `8cb3444a4ab4640a7417dcb539a556bd10c697b19869c17c3d4289a4c1eebc13` |
| `click-alt.wav` | ann-open、cards-context、paint-arm、links-insert | `7700032cc4caa89af1b41e407bf60e48f07e4d4f69e372ef78df0632666fb527` |
| `toggle.wav` | ann-tick-1、ann-tick-2 | `509be1af88150e4acf3c273ae29ab404027876fb61d705de5f21d7a62b99d6b6` |
| `pop.wav` | links-popup、files-lift | `ea11b896eb402c995a63f01ff298f0def88deed0ce96d37eb5f52d266b654dc9` |

内置 `typing.wav` 没有用：它的峰值只有 −26.4 dBFS，`mix_audio.py` 把单声道转成立体声时又低 3 dB，到混音上限（gain 4）仍比 37.3 秒处压低后的音乐低 2.4 dB。改用下面同配方、电平更高的 `typing-short.wav`。

## 本片生成的音效

生成脚本：`tools/audio/make_film_sfx.py`（只用 Python 标准库，做法同 skill 的 `make_sfx.py`；每个声音一个固定种子；48 kHz、16-bit，写成左右相同的立体声，因为 `mix_audio.py` 转换单声道时会低 3 dB）。重新生成：`python3 tools/audio/make_film_sfx.py --output assets/sfx --force`，结果逐字节相同。许可：本视频工程自己的素材。`click-drop*.wav` 和 `typing-*.wav` 按 skill 的 `make_sfx.py` 配方（click、typing，AGPL-3.0）重新合成，按 AGPL-3.0 衍生素材对待。

| 文件 | 声音 | 用在 |
|---|---|---|
| `paper-slide.wav` | 拖动纸页：轻触 + 带通噪声摩擦（3.2 → 1.7 kHz），峰值约 0.10 秒，长 0.62 秒 | drop-grab、align-grab |
| `soft-drop.wav` | 卡片落下：330 / 780 Hz 两个软分音，约 80 毫秒 | drop-release |
| `click-drop.wav` | 点击 + 18 毫秒后一张卡片落下（合成一个声音，避免两条 cue 同帧叠峰） | cards-new-claim |
| `click-drop-pair.wav` | 点击 + 两张引文卡依次落下（+18 / +113 毫秒） | ann-add |
| `brush.wav` | 格式刷：上扫带通噪声（1.6 → 4.5 kHz）加细颗粒，峰值约 0.11 秒，长 0.26 秒 | paint-apply |
| `page-turn.wav` | 折角翻页：0–0.35 秒纸页抬起，约 0.35 秒一声轻皱褶（实测峰值，对齐翻页开始），然后是折线扫过的纸声，约 1.05 秒（翻页结束）纸页落下。不是 whoosh | write-turn、files-turn |
| `snap-tick.wav` | 吸附：2.35 / 3.9 kHz 两声极短 tick，约 40 毫秒 | align-snap |
| `logo-fold.wav` | 标志折角：纸面折痕（高通噪声，6 毫秒）+ 18 毫秒后轻软的落点 | brand-fold |
| `typing-long.wav` | 两簇键盘声，1.45 秒（make_sfx.py 的 typing 按键配方，换了时间点和种子） | write-type（33.50–34.90） |
| `typing-short.wav` | 一簇键盘声，0.65 秒（make_sfx.py 的 typing 配方和六个按键时间，+7 dB） | links-type（37.30–37.90） |
| `pop-pair.wav` | 两声极轻 pop，间隔 0.2 秒（make_sfx.py 的 pop 配方，更轻） | entry-items（可选，不是 soundRequired） |

起音点、峰值和电平用 skill 的 `scripts/sfx_landmarks.py` 实测，记录在 `evidence/audio-cues.proposed.json` 和 `evidence/audio-selection.json`。
