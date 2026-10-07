# Data files

A project's working state lives in `data/` and `audio/`. These files are created by the studio; you rarely edit them by hand.

| File | Written by | Purpose |
|---|---|---|
| `data/project.json` | Planner / Lyrics / Publish tabs | title, topic, style, tone, script lines, pronunciations, art direction, format, YouTube metadata |
| `data/script.json` | Lyrics tab, Align step | the aligner's input: `{ "lines": [...], "spoken": { token: [WORDS] } }` |
| `audio/voiceover.mp3` | Upload or ElevenLabs | the narration (always normalised to mono 44.1 kHz MP3; the previous one is kept as `voiceover.prev.mp3`) |
| `data/lyrics.json` | `analysis/align_vo.py` | **word-level timings** (below) |
| `data/audio.json` | `analysis/audio_vo.py` | loudness envelopes, word onsets, nominal beat grid |
| `data/storyboard.json` | Storyboard tab | plates, their line ranges and concepts, `format` (`reel` or `wide`) |
| `app/src/scenes/<id>.ts` | Scenes tab | one generated scene per plate |

## `lyrics.json`

```json
{
  "lines": [
    {
      "text": "What if the Moon vanished?",
      "start": 0.09, "end": 2.1,
      "words": [
        { "w": "What", "start": 0.09, "end": 0.36 },
        { "w": "5.5.", "start": 8.0, "end": 8.9, "syl": [[8.0, 8.3], [8.3, 8.6], [8.6, 8.9]] }
      ]
    }
  ]
}
```

How it is made (`analysis/align_vo.py`):

1. Each displayed word is mapped to a *spoken form* (`5.5.` → FIVE POINT FIVE, `MCP.` → EM SEE PEE). Plain numbers and percentages are spelled out automatically; anything else comes from the pronunciation map in `script.json`.
2. wav2vec2-base-960h (quantized ONNX, character-level CTC) turns the audio into per-20 ms character probabilities.
3. One Viterbi pass (CTC forced alignment) finds the best path through the whole file, assigning every character a time.
4. Word edges are refined against the audio's energy envelope so a word ends where the voice actually stops, and tiny gaps inside a phrase are closed.
5. Display words made of several spoken words get `syl` spans so each part can light up as it is said.

Because every scene looks words up by *content* (`k.word('moon')`), re-recording the voiceover and re-aligning re-times every animation without touching code.

## `audio.json`

`rms`, `vocal`, `low`, `mid`, `high` — loudness curves normalised to 0–1 at 100 samples per second; `onsets.vocal` — word start times with their loudness; `beats`/`downbeats` — a nominal 120 BPM grid (the scenes time from words, not beats, since there is no music).

## `storyboard.json`

```json
{
  "title": "...", "format": "reel", "direction": "global art direction",
  "plates": [ { "id": "vanish", "title": "...", "firstLine": 0, "lastLine": 1, "concept": "..." } ]
}
```

Plates must cover every line in order with no gaps. A plate runs from a hard cut placed in the pause just before its first line to the cut of the next plate (`app/src/timeline.ts`).
