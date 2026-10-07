# Architecture

```
browser UI (studio/public)  ⇄  studio/server.js (bun)
                                  ├─ llm.js        OpenAI + Claude Code (`claude -p`) clients
                                  ├─ eleven.js     ElevenLabs client
                                  ├─ prompts.js    all prompts (planner, lyrics, storyboard, scenes, review, publish)
                                  ├─ jobs          long tasks with a polled log (align, scenes, render)
                                  └─ spawns:  python analysis/*.py · bun app/scripts/render.ts · ffmpeg · tsc
app/  (Vite + three.js)  ← the same page is the live preview and the headless-Chrome render target
```

## Engines

Two independent "engine" choices in Settings:

- **Writing engine** — lyrics, content planner, YouTube metadata. OpenAI or Claude Code.
- **Scene engine** — storyboard, scene code, visual review. Claude Code (default) or OpenAI.

Claude Code is invoked non-interactively: `claude -p --output-format text --no-session-persistence --tools ""` for text/code, and `--tools Read` for the visual review (so it can open the still images). The model list in Settings comes from Claude Code's own `initialize` control request, so it always matches your install.

## Scene generation loop

For each plate (two in parallel):

1. Prompt = the kit source + a reference scene + the plate concept + the word timings of its lines + art direction.
2. Write `app/src/scenes/<id>.ts`.
3. `tsc --noEmit` — errors for that file go back to the model.
4. Headless render of three stills (15 %, 50 %, 90 % of the plate) — runtime errors (a missing word, an exception) go back to the model.
5. Optional visual review: the model looks at the stills and reports concrete defects (clipped text, overlaps, empty frames); one repair pass.

Rendering and type-checking are serialised behind a mutex so parallel plates do not fight over the GPU.

## The renderer

`app/src/engine` is a deterministic frame function: `render(t)` composites the active scene(s) into an HDR render target, applies post-processing (bloom, halation, grain, vignette) and returns pixels. Motion blur averages N sub-frames per frame (adaptive: it stops when the estimated error is small). `app/scripts/render.ts` drives it in headless Chrome and streams raw frames to ffmpeg.

### Render speed

Three changes made a ~1-minute 1080×1920 reel go from ~35 min to ~5 min on a laptop:

1. **Canvas upload path** (`Layer2D` in `engine/gl.ts`). Uploading an accelerated canvas to an sRGB-format texture falls back to a CPU round trip (~23 ms per sub-frame). A plain, premultiplied, unflipped RGBA8 texture is a GPU copy (~0.4 ms); the compositor flips and decodes sRGB in its shader. Output differs from the old path by at most 1/255.
2. **Parallel workers** (`--jobs N`). The frame range is split across N Chrome processes, each encodes its chunk, and the chunks are concatenated with the audio muxed in. One Chrome renders sub-frames on a single thread, so workers scale until CPU or GPU saturates (3 was best on an 8-core laptop; 8 was slower).
3. **Hardware encode** (`--encoder nvenc`) moves H.264 off the CPU so it stops competing with Chrome.

## Formats

`data/storyboard.json` → `format: "reel"` (1080×1920) or `"wide"` (1920×1080). `engine/scale.ts` reads it (or `?format=`) and exposes the logical size `W × H`; everything lays out in logical pixels and `--scale 2` renders at twice that.
