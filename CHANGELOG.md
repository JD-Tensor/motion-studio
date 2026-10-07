# Changelog

## Unreleased

- UI redesign: orange-on-black glass design, step-by-step navigation with completion states and a sliding highlight, animated header activity meter, page and dialog transitions, button spinners, animated progress, count-up numbers (all motion respects `prefers-reduced-motion`)
- Bundled fonts (Archivo, IBM Plex Mono) are served locally

## 0.1.0 — first public release

- Web studio: Planner, Lyrics, Voiceover, Storyboard, Scenes, Render, Publish tabs
- Claude Code (`claude -p`) as scene/storyboard/review engine with a model picker read from your install; OpenAI optional
- Word-level forced alignment (wav2vec2 CTC) and per-word-timed scenes
- 9:16 and 16:9 output, scene kit for generated plates
- Optional ElevenLabs voiceover generation (off by default)
- Fast render: GPU canvas-upload path, parallel Chrome workers, NVENC
- YouTube Shorts title / description / tags generator
