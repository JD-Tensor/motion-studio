# Contributing

Thanks for helping! Bug reports, docs, new scene-kit helpers, prompt improvements and new engines/TTS providers are all welcome.

## Setup

```sh
bun run setup      # tools check, Python env, deps, alignment model
bun run studio     # http://localhost:4000
bun run check      # typecheck (app + scripts) and tests — run before opening a PR
```

## Project map

- `studio/` — server, prompts, UI (vanilla JS, no build step). Tests: `studio/test/*.test.js` (`bun test studio`).
- `app/` — renderer and scene kit (TypeScript). Type-check with `bun run typecheck`.
- `analysis/` — Python alignment/analysis scripts.
- `docs/` — documentation; update it when behaviour changes.

## Guidelines

- Keep scenes deterministic (pure functions of time). Anything that changes how generated scenes are written belongs in `studio/prompts.js` and `app/src/scenes/_kit.ts`; update `docs/writing-scenes.md` too.
- New provider integrations (TTS, LLM) should be **optional, off by default**, and testable against a mock (see `studio/test/eleven.test.js`). Never log or commit keys.
- Prefer small, focused PRs. Include before/after screenshots for UI changes and a short note on how you tested.
- Don't commit generated project files (`data/`, `audio/`, `app/src/scenes/<generated>.ts`, `out/`) — they are git-ignored on purpose.
- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Use the issue template and include: OS, GPU, bun/ffmpeg/Chrome versions, which engine you used, and the relevant job log from the Studio. Remove API keys from anything you paste.

## License

By contributing you agree that your contributions are licensed under the MIT License.
