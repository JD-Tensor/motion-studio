#!/usr/bin/env bash
# Downloads the wav2vec2 forced-alignment model (quantized ONNX, ~95 MB) into analysis/models/ and verifies it.
# Source: https://huggingface.co/Xenova/wav2vec2-base-960h  (Apache-2.0, derived from facebook/wav2vec2-base-960h)
set -euo pipefail
cd "$(dirname "$0")/../analysis/models"
BASE="https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main"
SHA256="cd5040c147381580ed73258143dd8e0c28e800a09e74ee42ee2b3e8cb4d760a3"
sum() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
if [ -f w2v2_base_960h_q.onnx ] && [ "$(sum w2v2_base_960h_q.onnx)" = "$SHA256" ] && [ -f vocab.json ]; then echo "model already present and verified"; exit 0; fi
echo "downloading model (~95 MB)…"
curl -fL --retry 3 -o w2v2_base_960h_q.onnx "$BASE/onnx/model_quantized.onnx"
curl -fL --retry 3 -o vocab.json "$BASE/vocab.json"
curl -fL --retry 3 -o preprocessor_config.json "$BASE/preprocessor_config.json"
[ "$(sum w2v2_base_960h_q.onnx)" = "$SHA256" ] || { echo "checksum mismatch, deleting"; rm -f w2v2_base_960h_q.onnx; exit 1; }
echo "ok"
