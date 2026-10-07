import { test, expect, beforeAll, afterAll } from 'bun:test';

let server, calls = [];
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      calls.push({ method: req.method, path: u.pathname + u.search, key: req.headers.get('xi-api-key'), body: req.method === 'POST' ? await req.json() : null });
      if (req.headers.get('xi-api-key') !== 'good') return new Response(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'bad key' } }), { status: 401 });
      if (u.pathname === '/v2/voices') return Response.json({ voices: [
        { voice_id: 'b', name: 'Bella', category: 'professional', labels: {} },
        { voice_id: 'a', name: 'Adam', category: 'premade', labels: { accent: 'american' }, preview_url: 'http://x/a.mp3' },
      ], has_more: false });
      if (u.pathname === '/v1/models') return Response.json([{ model_id: 'eleven_v3', name: 'v3', can_do_text_to_speech: true }, { model_id: 'eleven_multilingual_v2', name: 'M2', can_do_text_to_speech: true, maximum_text_length_per_request: 10000 }, { model_id: 'scribe', name: 'STT', can_do_text_to_speech: false }]);
      if (u.pathname === '/v1/user/subscription') return Response.json({ tier: 'free', character_count: 100, character_limit: 10000 });
      if (u.pathname.startsWith('/v1/text-to-speech/paywalled')) return new Response(JSON.stringify({ detail: { status: 'paid_plan_required', message: 'Free users cannot use library voices via the API.' } }), { status: 402 });
      if (u.pathname.startsWith('/v1/text-to-speech/')) return new Response(new Uint8Array([1, 2, 3]));
      return new Response('nope', { status: 404 });
    },
  });
  process.env.ELEVENLABS_BASE = `http://localhost:${server.port}`;
  process.env.ELEVENLABS_API_KEY = 'good';
});
afterAll(() => server.stop(true));

const load = () => import('../eleven.js?' + Math.random());

test('voices: premade first, mapped fields', async () => {
  const { listVoices } = await load();
  const v = await listVoices();
  expect(v.map((x) => x.id)).toEqual(['a', 'b']);
  expect(v[0].preview).toBe('http://x/a.mp3');
  expect(calls.at(-1).key).toBe('good');
});

test('models: only text-to-speech models, v3 flagged as no-SSML', async () => {
  const { listModels } = await load();
  const m = await listModels();
  expect(m.map((x) => x.id)).toEqual(['eleven_v3', 'eleven_multilingual_v2']);
  expect(m.find((x) => x.id === 'eleven_v3').ssml).toBe(false);
});

test('subscription', async () => {
  const { subscription } = await load();
  expect(await subscription()).toMatchObject({ tier: 'free', used: 100, limit: 10000 });
});

test('speak: request shape and bytes', async () => {
  const { speak } = await load();
  const out = await speak({ text: 'hi <break time="0.5s" />', voiceId: 'a', modelId: 'eleven_multilingual_v2', settings: { stability: 0.4, speed: 1.1, bogus: 9 } });
  expect([...out]).toEqual([1, 2, 3]);
  const c = calls.at(-1);
  expect(c.path).toContain('/v1/text-to-speech/a?output_format=mp3_44100_128');
  expect(c.body).toEqual({ text: 'hi <break time="0.5s" />', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4, speed: 1.1 } });
});

test('paid-plan error is explained', async () => {
  const { speak } = await load();
  await expect(speak({ text: 'x', voiceId: 'paywalled' })).rejects.toThrow(/paid ElevenLabs plan.*premade/);
});

test('bad key gives a clear message', async () => {
  process.env.ELEVENLABS_API_KEY = 'wrong';
  const { listVoices } = await load();
  await expect(listVoices()).rejects.toThrow(/rejected the API key/);
  process.env.ELEVENLABS_API_KEY = 'good';
});

test('missing key', async () => {
  delete process.env.ELEVENLABS_API_KEY;
  const { listVoices } = await load();
  await expect(listVoices()).rejects.toThrow(/No ElevenLabs API key/);
  process.env.ELEVENLABS_API_KEY = 'good';
});
