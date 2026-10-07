# Security

## Threat model

Motion Studio is a **local, single-user tool**. The server listens on `127.0.0.1` by default and can start `ffmpeg`, `claude`, `tsc`, Python and headless Chrome, write files inside the project, and use the API keys you configure. Do not expose it to a network or the internet. If you set `STUDIO_HOST=0.0.0.0` you must put authentication in front of it yourself.

- API keys are stored in `studio/settings.json` (git-ignored, created with mode 600) or read from environment variables. They are never returned to the browser (only a masked hint).
- AI-generated scene files are TypeScript that runs in a headless browser on your machine. Review code you did not write before rendering, especially if you load projects from others.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting (*Security → Report a vulnerability*) on this repository. Include steps to reproduce and the affected version/commit. We aim to acknowledge within 7 days.
