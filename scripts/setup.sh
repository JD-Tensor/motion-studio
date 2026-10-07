#!/usr/bin/env bash
# One-time setup: checks system tools, creates the Python env for alignment, installs JS deps, fetches the model.
set -euo pipefail
cd "$(dirname "$0")/.."
ok=1
need() { if command -v "$1" >/dev/null 2>&1; then echo "  ✓ $1"; else echo "  ✗ $1 — $2"; ok=0; fi; }
echo "Checking tools"
need bun "install from https://bun.sh"
need ffmpeg "install ffmpeg with libx264 (apt install ffmpeg / brew install ffmpeg)"
need python3 "install Python 3.9+"
need curl "install curl"
if command -v google-chrome >/dev/null || command -v chromium >/dev/null || command -v chromium-browser >/dev/null || [ -d "/Applications/Google Chrome.app" ]; then echo "  ✓ Chrome/Chromium"; else echo "  ✗ Google Chrome — needed for rendering (https://google.com/chrome)"; ok=0; fi
if command -v claude >/dev/null 2>&1 || ls "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude >/dev/null 2>&1; then echo "  ✓ Claude Code"; else echo "  ! Claude Code not found — install it (https://claude.com/claude-code) or set CLAUDE_BIN, or use OpenAI as the engine"; fi
[ "$ok" = 1 ] || { echo "Install the missing tools above and re-run."; exit 1; }
echo "Python env"
python3 -m venv studio/.venv
if [ -x studio/.venv/bin/pip ]; then studio/.venv/bin/pip install -q -r requirements.txt; else studio/.venv/Scripts/pip install -q -r requirements.txt; fi
echo "JS dependencies"
(cd app && bun install)
echo "Alignment model"
bash scripts/fetch-model.sh
echo
echo "Done. Start the studio:  bun run studio   then open http://localhost:4000"
