# Troubleshooting

**`claude` not found / "Claude Code not found" in Settings**
Install Claude Code and log in. If it is installed but not on `PATH` (for example only the VS Code extension's bundled binary exists), set `CLAUDE_BIN=/path/to/claude` before `bun run studio`. The studio also looks in `~/.local/bin` and the VS Code extension folder.

**Alignment fails**
Run `bun run setup` (creates `studio/.venv` and downloads the model). `analysis/models/w2v2_base_960h_q.onnx` must exist (~95 MB). The aligner only understands letters and apostrophes, so unusual symbols need an entry in the *Pronunciations* box on the Lyrics tab.

**A word shows as unmatched after alignment**
Add its spoken form in *Pronunciations* (`GPT-5 = GEE PEE TEE FIVE`), save, and align again.

**Render is slow or the GPU is idle**
Chrome picks the integrated GPU on some hybrid laptops. On Linux the renderer sets the NVIDIA PRIME variables automatically; set `CHROME_GPU=intel` to disable. The renderer runs 3 parallel Chrome workers with GPU H.264 encoding when ffmpeg has `h264_nvenc`; otherwise 2 workers with x264.

**Render fails with a WebGL error**
Run `cd app && bun scripts/render.ts gpu` — it prints the renderer Chrome uses. Try `CHROME_ANGLE=gl` (Linux default), `vulkan`, or `swiftshader` (slow software rendering).

**A generated scene fails all 4 attempts**
The last version stays on disk; open it with *Edit code*, fix the error shown in the log, or press *Regenerate* (the model sees the previous error). Choosing a stronger Claude model in Settings helps.

**Port 4000 is in use**
A previous studio is still running. Stop it, or use `STUDIO_PORT=4001 bun run studio`.

**Videos longer than 60 seconds**
The studio targets ≤ 60 s shorts. Longer voiceovers still render, with a note in the log.
