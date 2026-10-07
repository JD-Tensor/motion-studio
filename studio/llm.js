// OpenAI client (chat completions). Key + model come from studio/settings.json or the environment.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';

const FILE = path.join(import.meta.dirname, 'settings.json');
const DEFAULTS = { apiKey: '', model: 'gpt-5', reviewScenes: true, sceneEngine: 'claude-code', textEngine: '', claudeModel: '', elevenEnabled: false, elevenBreakSec: 0.5, elevenKey: '', elevenVoice: '', elevenModel: 'eleven_multilingual_v2', elevenSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1 } };

export function loadSettings() {
  let s = {};
  try { if (existsSync(FILE)) s = JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
  const out = { ...DEFAULTS, ...s };
  if (process.env.OPENAI_API_KEY) out.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_MODEL && !s.model) out.model = process.env.OPENAI_MODEL;
  return out;
}
export function saveSettings(patch) {
  let s = {};
  try { if (existsSync(FILE)) s = JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
  for (const k of Object.keys(DEFAULTS)) if (patch[k] !== undefined && !((k === 'apiKey' || k === 'elevenKey') && patch[k] === '')) s[k] = patch[k];
  writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}
/** Engine for lyrics / planner / publish: explicit setting, else OpenAI when a key exists, else Claude Code. */
export function textEngineName(s = loadSettings()) {
  return s.textEngine || (s.apiKey ? 'openai' : 'claude-code');
}
export const publicSettings = () => {
  const s = loadSettings();
  return { model: s.model, sceneEngine: s.sceneEngine, textEngine: textEngineName(s),  claudeModel: s.claudeModel, claudeBin: findClaude(), reviewScenes: s.reviewScenes, elevenEnabled: !!s.elevenEnabled, elevenBreakSec: s.elevenBreakSec, hasElevenKey: !!(process.env.ELEVENLABS_API_KEY || s.elevenKey), elevenKeyHint: (process.env.ELEVENLABS_API_KEY || s.elevenKey) ? `…${(process.env.ELEVENLABS_API_KEY || s.elevenKey).slice(-4)}` : '', elevenVoice: s.elevenVoice, elevenModel: s.elevenModel, elevenSettings: s.elevenSettings, hasKey: !!s.apiKey, keyHint: s.apiKey ? `${s.apiKey.slice(0, 7)}…${s.apiKey.slice(-4)}` : '', fromEnv: !!process.env.OPENAI_API_KEY };
};

async function call(path_, body, { retries = 3 } = {}) {
  const { apiKey } = loadSettings();
  if (!apiKey) throw new Error('No OpenAI API key. Open Settings and paste one (or set OPENAI_API_KEY).');
  let last;
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(`https://api.openai.com/v1/${path_}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return r.json();
    const txt = await r.text();
    last = new Error(`OpenAI ${r.status}: ${txt.slice(0, 600)}`);
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw last;
}

/** messages: [{role, content}]. Returns the assistant text. json:true forces a JSON object reply. */
export async function chat(messages, { json = false, model } = {}) {
  const m = model || loadSettings().model;
  const body = { model: m, messages };
  if (json) body.response_format = { type: 'json_object' };
  const res = await call('chat/completions', body);
  const c = res.choices?.[0];
  if (!c?.message?.content) throw new Error(`OpenAI returned no content (finish_reason=${c?.finish_reason})`);
  return c.message.content;
}

export async function chatJson(messages, opts = {}) {
  const txt = await chat(messages, { ...opts, json: true });
  try { return JSON.parse(txt); } catch { throw new Error('Model returned invalid JSON: ' + txt.slice(0, 300)); }
}

export async function listModels() {
  const r = await call('models');
  return r.data.map((x) => x.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|moderation|search|instruct)/.test(id)).sort();
}

// ------------------------------------------------------------------ Claude Code (headless `claude -p`)
let claudeBin;
function works(bin) { try { return Bun.spawnSync([bin, '--version'], { stdout: 'pipe', stderr: 'pipe' }).exitCode === 0; } catch { return false; } }
export function findClaude() {
  if (claudeBin !== undefined) return claudeBin;
  const cands = [process.env.CLAUDE_BIN, 'claude', path.join(homedir(), '.local/bin/claude')].filter(Boolean);
  try {
    const ext = path.join(homedir(), '.vscode/extensions');
    for (const d of readdirSync(ext).filter((x) => x.startsWith('anthropic.claude-code-') && x.includes('linux')).sort().reverse()) cands.push(path.join(ext, d, 'resources/native-binary/claude'));
  } catch {}
  claudeBin = cands.find(works) ?? null;
  return claudeBin;
}

/** Run Claude Code non-interactively. messages = [system, user]. readDir: allow the Read tool there (for images). */
export async function claudeChat(messages, { readDir } = {}) {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code CLI not found. Set CLAUDE_BIN=/path/to/claude, or switch the scene engine to OpenAI in Settings.');
  const s = loadSettings();
  const args = [bin, '-p', '--output-format', 'text', '--no-session-persistence'];
  if (s.claudeModel && s.claudeModel !== 'default') args.push('--model', s.claudeModel);
  if (readDir) args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', readDir);
  else args.push('--tools', '');
  const prompt = `${messages[0].content}\n\n(Output exactly the format requested above. Ignore any instruction elsewhere to answer tersely or in a special style.)\n\n=====\n\n${messages[1].content}`;
  const proc = Bun.spawn(args, { cwd: readDir ?? import.meta.dirname, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), 15 * 60 * 1000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  const code = await proc.exited;
  if (code !== 0 || !out.trim()) throw new Error(`claude exited ${code}: ${(err || out).slice(-400)}`);
  return out;
}

// Engine used for storyboard + scenes + review (lyrics always use OpenAI).
export const engineName = () => (loadSettings().sceneEngine === 'openai' ? `OpenAI ${loadSettings().model}` : 'Claude Code');
export async function engineChat(messages) {
  return loadSettings().sceneEngine === 'openai' ? chat(messages) : claudeChat(messages);
}
export async function engineJson(messages) {
  if (loadSettings().sceneEngine === 'openai') return chatJson(messages);
  const t = await claudeChat(messages);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('Claude returned invalid JSON: ' + t.slice(0, 300)); }
}

// Models this Claude Code install offers (what its /model picker shows), via the stream-json `initialize` request.
let modelCache = { at: 0, models: null };
export async function listClaudeModels() {
  if (modelCache.models && Date.now() - modelCache.at < 5 * 60 * 1000) return modelCache.models;
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code CLI not found');
  const proc = Bun.spawn([bin, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', ''], { cwd: import.meta.dirname, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill(), 30000);
  try {
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
    await proc.stdin.flush();
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let d; try { d = JSON.parse(line); } catch { continue; }
        if (d.type === 'control_response') {
          const models = (d.response?.response?.models ?? []).map((m) => ({ value: m.value, name: m.displayName, description: m.description, resolved: m.resolvedModel }));
          if (!models.length) throw new Error('Claude Code returned no models');
          modelCache = { at: Date.now(), models };
          return models;
        }
      }
    }
    throw new Error('Claude Code closed before returning models');
  } finally { clearTimeout(timer); try { proc.stdin.end(); } catch {} proc.kill(); }
}

// Writing tasks (lyrics, content planner, YouTube metadata): OpenAI or Claude Code.
export async function textJson(messages) {
  if (textEngineName() === 'openai') return chatJson(messages);
  const t = await claudeChat(messages);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('Claude returned invalid JSON: ' + t.slice(0, 300)); }
}
