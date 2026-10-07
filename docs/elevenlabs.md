# ElevenLabs voiceover

The ElevenLabs integration is **optional and off by default**. Without it, the Lyrics tab gives you ready-to-paste text and you upload the MP3 yourself.

## Turning it on

1. **Settings →** tick *Generate voiceover with the ElevenLabs API*.
2. Paste your API key (create one in your ElevenLabs account settings; if you restrict the key's permissions, allow Text to Speech, Voices and Models, plus User read access if you want remaining credits shown).
3. Click **Connect & load voices**, choose a default model, voice and pause length, and **Save**.
4. In the **Voiceover** tab a *Generate with ElevenLabs* card appears. Adjust stability / similarity / style / speed, then **Generate voiceover**. If *then align automatically* is ticked the word alignment runs straight away.

The key is stored in `studio/settings.json` (git-ignored) or read from `ELEVENLABS_API_KEY`.

## What is sent

The script lines with numbers and acronyms respelled the way they are pronounced (so alignment matches), joined with `<break time="0.5s" />` pause tags for models that support SSML breaks, or blank lines for models that do not (e.g. v3). The request is `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`. The result is normalised to mono 44.1 kHz MP3 and replaces `audio/voiceover.mp3`; the previous file is kept as `voiceover.prev.mp3`.

## Free accounts

As of writing (verify on [elevenlabs.io/pricing](https://elevenlabs.io/pricing)):

- API access is included with **10,000 credits per month** (~10 minutes of speech). One character of text is one credit on the standard models; break tags count as characters too.
- **Commercial use is not allowed on the free plan.** For ads or monetised channels use a paid plan and read ElevenLabs' terms.
- Premade voices can be used on all plans. Voices from the shared library or cloned voices may return *paid plan required*; pick a premade voice.
- Requests are rate-limited and concurrency is low; the app reports `429` clearly.

The app checks your remaining credits before sending and refuses a script that would exceed them.

## Troubleshooting

| Message | Cause |
|---|---|
| *rejected the API key (401)* | wrong or revoked key |
| *needs a paid ElevenLabs plan* | the selected voice/feature is not available on your plan |
| *not enough ElevenLabs credits* | monthly credits used up |
| voices list empty | the key lacks the *Voices* permission |
| sounds different between runs | ElevenLabs output is not deterministic; keep a good take and re-upload it instead of regenerating |
