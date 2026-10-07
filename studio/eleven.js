// ElevenLabs text-to-speech client. Key comes from studio/settings.json (elevenKey) or ELEVENLABS_API_KEY.
import { loadSettings } from './llm.js';

const BASE = process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io'; // override only for tests
export const elevenKey = () => process.env.ELEVENLABS_API_KEY || loadSettings().elevenKey || '';

export class ElevenError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function call(path, { method = 'GET', body, raw = false } = {}) {
  const key = elevenKey();
  if (!key) throw new ElevenError(400, 'No ElevenLabs API key. Open Settings and paste one (or set ELEVENLABS_API_KEY).');
  const r = await fetch(BASE + path, { method, headers: { 'xi-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.ok) return raw ? new Uint8Array(await r.arrayBuffer()) : r.json();
  let detail = {}, txt = '';
  try { txt = await r.text(); detail = JSON.parse(txt).detail ?? JSON.parse(txt); } catch {}
  const code = detail?.status ?? detail?.code ?? '';
  let msg = detail?.message ?? (typeof detail === 'string' ? detail : txt.slice(0, 300)) ?? r.statusText;
  if (r.status === 401) msg = 'ElevenLabs rejected the API key (401). Check the key in Settings.';
  else if (r.status === 402 || /paid_plan_required|payment/i.test(code)) msg = `${msg} — this voice or feature needs a paid ElevenLabs plan. On the free plan pick a premade voice.`;
  else if (/quota_exceeded/i.test(code)) msg = `${msg} — not enough ElevenLabs credits left this month.`;
  else if (r.status === 429) msg = 'ElevenLabs rate limit hit (429). Wait a moment and retry (the free plan allows few concurrent requests).';
  throw new ElevenError(r.status, msg, code);
}

/** Voices this account can use. Premade first. */
export async function listVoices() {
  const out = [];
  let token;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
    if (token) q.set('next_page_token', token);
    const r = await call(`/v2/voices?${q}`);
    for (const v of r.voices ?? []) out.push({ id: v.voice_id, name: v.name, category: v.category ?? '', labels: v.labels ?? {}, preview: v.preview_url ?? '', description: v.description ?? '' });
    if (!r.has_more || !r.next_page_token) break;
    token = r.next_page_token;
  }
  const rank = (c) => (c === 'premade' ? 0 : c === 'professional' ? 3 : 1);
  return out.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
}

export async function listModels() {
  const r = await call('/v1/models');
  return r.filter((m) => m.can_do_text_to_speech).map((m) => ({ id: m.model_id, name: m.name, description: m.description ?? '', ssml: !/v3/i.test(m.model_id), maxChars: m.maximum_text_length_per_request ?? null }));
}

/** Credits used / limit and tier. Restricted keys without user_read return null. */
export async function subscription() {
  try { const r = await call('/v1/user/subscription'); return { tier: r.tier, used: r.character_count, limit: r.character_limit, resetUnix: r.next_character_count_reset_unix ?? null }; }
  catch (e) { if (e.status === 401 || e.status === 403) return null; throw e; }
}

/** Returns mp3 bytes. */
export async function speak({ text, voiceId, modelId, settings = {} }) {
  if (!voiceId) throw new ElevenError(400, 'Choose a voice first.');
  const voice_settings = {};
  for (const k of ['stability', 'similarity_boost', 'style', 'speed']) if (typeof settings[k] === 'number') voice_settings[k] = settings[k];
  if (settings.use_speaker_boost !== undefined) voice_settings.use_speaker_boost = !!settings.use_speaker_boost;
  return call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, { method: 'POST', body: { text, model_id: modelId || 'eleven_multilingual_v2', voice_settings } , raw: true });
}
