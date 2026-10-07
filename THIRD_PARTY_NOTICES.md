# Third-party notices

Motion Studio's own code is MIT-licensed (see `LICENSE`). It includes or downloads the following components under their own licenses.

| Component | Where | License |
|---|---|---|
| **pdoom-video** engine and visual language — Giacomo Magnanini (<https://github.com/mexicat/pdoom-video>) | `app/src/engine/`, `app/src/scenes/_vo.ts`, `_motifs.ts`, parts of `app/scripts/render.ts` | MIT — `LICENSE.pdoom-engine` |
| **Archivo**, **Cormorant Garamond**, **IBM Plex Mono** fonts | `app/public/fonts/` | SIL Open Font License 1.1 — `app/public/fonts/src/OFL.txt` |
| **EMS** single-stroke fonts (Allure, Felix, Osmotron, Readability, Tech) — Evil Mad Scientist | `app/public/fonts/stroke/` | SIL Open Font License 1.1 (stated in each file; EMS Readability derives from Source Sans Pro) |
| **Hershey** vector fonts (Sans 1, Script 1, Serif Medium) — Dr. A. V. Hershey | `app/public/fonts/stroke/` | "liberal license" — the notice is kept in each file |
| **wav2vec2-base-960h** (quantized ONNX export by Xenova) — Meta AI / Hugging Face | downloaded by `scripts/fetch-model.sh` into `analysis/models/` (not committed) | Apache-2.0 — <https://huggingface.co/Xenova/wav2vec2-base-960h> |
| **three.js**, **opentype.js**, **Vite**, **playwright-core** | `app/package.json` | MIT / Apache-2.0 (see each package) |
| **onnxruntime**, **numpy** | `requirements.txt` | MIT / BSD-3-Clause |

Trademarks: Claude and Claude Code (Anthropic), OpenAI, ElevenLabs, YouTube, Instagram and TikTok belong to their respective owners. This project is independent and is not affiliated with or endorsed by any of them.

Audio produced with ElevenLabs is subject to ElevenLabs' terms; in particular the free plan does not permit commercial use.
