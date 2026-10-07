// Motion Studio server: UI + API. Run: bun studio/server.js   (http://localhost:4000)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, copyFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { chat, chatJson, listModels, loadSettings, saveSettings, publicSettings, engineChat, engineJson, engineName, claudeChat, listClaudeModels, textJson } from './llm.js';
import * as eleven from './eleven.js';
import { plannerPrompt, publishPrompt, lyricsPrompt, storyboardPrompt, scenePrompt, reviewPrompt, reviewPromptPaths, elevenText } from './prompts.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP = path.join(ROOT, 'app');
const DATA = path.join(ROOT, 'data');
const SCENES = path.join(APP, 'src/scenes');
const OUT = path.join(ROOT, 'out');
const PROJECTS = path.join(ROOT, 'projects');
const PUBLIC = path.join(import.meta.dirname, 'public');
const PORT = +(process.env.STUDIO_PORT ?? 4000);
const VITE_PORT = 5173;
const MAX_SECONDS = 60;
const VENV_PY = [path.join(import.meta.dirname, '.venv/bin/python'), path.join(import.meta.dirname, '.venv/Scripts/python.exe')].find(existsSync);
const PY = VENV_PY ?? (process.platform === 'win32' ? 'python' : 'python3');

for (const d of [DATA, OUT, PROJECTS, path.join(ROOT, 'audio')]) mkdirSync(d, { recursive: true });

// ------------------------------------------------------------------ helpers
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const fail = (e, status = 500) => json({ error: String(e?.message ?? e) }, status);
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 1));
const slug = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
const project = () => readJson(path.join(DATA, 'project.json'), { title: '', topic: '', style: 'explainer', seconds: 45, tone: '', extra: '', lines: [], spoken: {}, direction: '' });
const saveProject = (p) => writeJson(path.join(DATA, 'project.json'), p);
const lyrics = () => readJson(path.join(DATA, 'lyrics.json'));
const storyboard = () => readJson(path.join(DATA, 'storyboard.json'));
const audioFile = path.join(ROOT, 'audio/voiceover.mp3');

class Mutex { p = Promise.resolve(); run(fn) { const r = this.p.then(fn, fn); this.p = r.catch(() => {}); return r; } }
const gpu = new Mutex();

// ---- jobs: long tasks with a polled log
const jobs = new Map();
function newJob(kind) {
  const job = { id: Math.random().toString(36).slice(2, 10), kind, status: 'running', log: [], progress: '', result: null, error: null, t0: Date.now() };
  jobs.set(job.id, job);
  job.say = (s) => { job.log.push(String(s)); if (job.log.length > 2000) job.log.splice(0, 500); };
  return job;
}
function startJob(kind, fn) {
  const job = newJob(kind);
  fn(job).then((r) => { job.result = r ?? null; job.status = 'done'; }, (e) => { job.error = String(e?.message ?? e); job.say('ERROR: ' + job.error); job.status = 'error'; });
  return job;
}
/** Run a command, streaming lines into the job. \r-only lines become job.progress. */
async function run(job, cmd, { cwd = ROOT, env = {}, quiet = false } = {}) {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  let text = '';
  const pump = async (stream) => {
    const dec = new TextDecoder();
    for await (const chunk of stream) {
      const s = dec.decode(chunk);
      text += s;
      const parts = s.split(/(\r|\n)/);
      for (let i = 0; i < parts.length; i += 2) {
        const line = parts[i], sep = parts[i + 1];
        if (!line.trim()) continue;
        if (sep === '\r' || (sep === undefined && /frames\s+[\d.]+ fps/.test(line))) job.progress = line.trim();
        else if (!quiet) job.say(line);
      }
    }
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  const code = await proc.exited;
  return { code, text };
}

// ---- hardware H.264 encoder (NVENC) available? Cached.
let nvencOk;
function hasNvenc() {
  if (nvencOk === undefined) {
    try { nvencOk = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { stdout: 'pipe', stderr: 'pipe' }).exitCode === 0; } catch { nvencOk = false; }
  }
  return nvencOk;
}

// ------------------------------------------------------------------ vite (live preview)
async function reachable(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } }
let viteProc = null;
async function ensureVite() {
  if (await reachable(`http://localhost:${VITE_PORT}`)) return true;
  viteProc = Bun.spawn(['bunx', 'vite', '--port', String(VITE_PORT), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore' });
  for (let i = 0; i < 100; i++) { if (await reachable(`http://localhost:${VITE_PORT}`)) return true; await Bun.sleep(100); }
  return false;
}

// ------------------------------------------------------------------ windows (same cut rule as app/src/timeline.ts)
function windows(sb, ly) {
  const lines = ly.lines;
  const cut = (i) => {
    const l = lines[Math.min(i, lines.length - 1)];
    const prev = lines[i - 1];
    const gap = prev ? l.start - prev.end : 1;
    return l.start - Math.min(0.18, Math.max(0.04, gap * 0.45));
  };
  const dur = readJson(path.join(DATA, 'audio.json'), {}).duration ?? lines[lines.length - 1].end;
  return sb.plates.map((p, n) => {
    const next = sb.plates[n + 1];
    return { id: p.id, start: n === 0 ? 0 : cut(p.firstLine), end: next ? cut(next.firstLine) : dur };
  });
}
const withIndex = (ly) => ly.lines.map((l, i) => ({ ...l, i }));

// ------------------------------------------------------------------ scene generation
function extractCode(txt) {
  const m = [...txt.matchAll(/```(?:ts|typescript|tsx)?\n([\s\S]*?)```/g)];
  const code = m.length ? m.sort((a, b) => b[1].length - a[1].length)[0][1] : txt;
  return code.trim() + '\n';
}
async function tscErrors(id, job) {
  const r = await run(job, ['bunx', 'tsc', '--noEmit', '-p', '.'], { cwd: APP, quiet: true });
  return r.text.split('\n').filter((l) => l.includes(`scenes/${id}.ts`)).map((l) => l.replace(/^.*scenes\//, 'scenes/')).slice(0, 12).join('\n');
}
async function stillsAndErrors(id, job) {
  const dir = path.join(OUT, 'studio', id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = await run(job, ['bun', 'scripts/render.ts', 'stills', '--private', '--plate', id, '--frac', '0.15,0.5,0.9', '--only', id, '--out', dir], { cwd: APP, quiet: true });
  const bad = r.text.split('\n').filter((l) => /SCENE ERRORS|^\[\w+\] |\[pageerror\]|Error:|failed/.test(l) && !/404/.test(l)).slice(0, 14);
  const pngs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
  const jpgs = [];
  for (let i = 0; i < pngs.length; i++) {
    const o = path.join(OUT, 'studio', `${id}_${i + 1}.jpg`);
    await run(job, ['ffmpeg', '-y', '-loglevel', 'error', '-i', path.join(dir, pngs[i]), '-vf', 'scale=iw/2:-2', '-q:v', '4', o], { quiet: true });
    jpgs.push(o);
  }
  if (!bad.length && r.code !== 0) bad.push(`render exited with code ${r.code}: ${r.text.slice(-500)}`);
  if (!bad.length && pngs.length < 3) bad.push('render produced no stills');
  return { errors: bad.join('\n'), jpgs };
}

async function genPlate(job, plate, board, ly, win, idx, review) {
  const all = withIndex(ly);
  const lines = all.slice(plate.firstLine, plate.lastLine + 1);
  const prev = all[plate.firstLine - 1], next = all[plate.lastLine + 1];
  const file = path.join(SCENES, `${plate.id}.ts`);
  let code = null, errors = '', reviewTxt = '', attempts = 0, stills = [], reviewed = false;
  const MAX = 4;
  while (attempts < MAX) {
    attempts++;
    job.say(`[${plate.id}] attempt ${attempts}: asking ${engineName()}${errors ? ' (fixing errors)' : reviewTxt ? ' (visual fixes)' : ''}`);
    const txt = await engineChat(scenePrompt({ plate, board, lines, prevEnd: prev?.text, nextStart: next?.text, window: win, errors: errors || null, previous: code, review: reviewTxt || null }));
    code = extractCode(txt);
    writeFileSync(file, code);
    errors = await gpu.run(() => tscErrors(plate.id, job));
    if (errors) { job.say(`[${plate.id}] type errors:\n${errors}`); continue; }
    const res = await gpu.run(() => stillsAndErrors(plate.id, job));
    stills = res.jpgs;
    if (res.errors) { errors = res.errors; job.say(`[${plate.id}] runtime errors:\n${errors}`); continue; }
    if (review && !reviewed && stills.length === 3) {
      reviewed = true;
      try {
        let rv;
        if (loadSettings().sceneEngine === 'openai') rv = await chatJson(reviewPrompt({ plate, images: stills.map((f) => readFileSync(f).toString('base64')) }));
        else { const t = await claudeChat(reviewPromptPaths({ plate, paths: stills }), { readDir: path.join(OUT, 'studio') }); rv = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); }
        if (!rv.ok && rv.issues?.length) { reviewTxt = rv.issues.map((x, n) => `${n + 1}. ${x}`).join('\n'); job.say(`[${plate.id}] review issues:\n${reviewTxt}`); continue; }
        job.say(`[${plate.id}] review ok`);
      } catch (e) { job.say(`[${plate.id}] review skipped: ${e.message}`); }
    }
    reviewTxt = '';
    job.say(`[${plate.id}] done`);
    return { id: plate.id, ok: true, attempts, stills: stills.map((f) => '/out/studio/' + path.basename(f)) };
  }
  if (errors) job.say(`[${plate.id}] FAILED after ${attempts} attempts; last file kept for manual editing`);
  else job.say(`[${plate.id}] accepted after ${attempts} attempts with remaining visual notes`);
  return { id: plate.id, ok: !errors, attempts, error: errors || undefined, stills: stills.map((f) => '/out/studio/' + path.basename(f)) };
}

async function genScenes(job, ids) {
  const sb = storyboard(), ly = lyrics();
  if (!sb) throw new Error('No storyboard yet');
  if (!ly) throw new Error('No lyrics.json yet — upload the voiceover and run alignment first');
  await ensureVite();
  const wins = windows(sb, ly);
  const todo = sb.plates.filter((p) => !ids || ids.includes(p.id));
  const review = loadSettings().reviewScenes;
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = next++, p = todo[i];
      try { results.push(await genPlate(job, p, sb, ly, wins.find((w) => w.id === p.id), i, review)); }
      catch (e) { job.say(`[${p.id}] ERROR ${e.message}`); results.push({ id: p.id, ok: false, error: e.message }); }
      job.progress = `${results.length}/${todo.length} plates`;
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}

/** Normalise any audio file into audio/voiceover.mp3 (keeps the previous one as voiceover.prev.mp3). */
async function ingestAudio(src) {
  const job = newJob('audio');
  const tmpOut = audioFile + '.new.mp3';
  const r = await run(job, ['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '2', tmpOut], { quiet: true });
  if (r.code !== 0) { rmSync(tmpOut, { force: true }); throw new Error('ffmpeg could not read that audio: ' + r.text.slice(-300)); }
  if (existsSync(audioFile)) copyFileSync(audioFile, audioFile.replace(/\.mp3$/, '.prev.mp3'));
  renameSync(tmpOut, audioFile);
  const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioFile]);
  const duration = parseFloat(new TextDecoder().decode(probe.stdout));
  return { duration, tooLong: duration > MAX_SECONDS + 0.5 };
}

// ------------------------------------------------------------------ project archive
const PROJECT_FILES = ['script.json', 'lyrics.json', 'audio.json', 'storyboard.json', 'project.json', 'voiceover.words.json'];
const sceneFiles = () => readdirSync(SCENES).filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
function archiveCurrent(name) {
  const dir = path.join(PROJECTS, name);
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  mkdirSync(path.join(dir, 'audio'), { recursive: true });
  for (const f of PROJECT_FILES) if (existsSync(path.join(DATA, f))) renameSync(path.join(DATA, f), path.join(dir, 'data', f));
  for (const f of sceneFiles()) renameSync(path.join(SCENES, f), path.join(dir, 'scenes', f));
  if (existsSync(audioFile)) renameSync(audioFile, path.join(dir, 'audio/voiceover.mp3'));
}
function restore(name) {
  const dir = path.join(PROJECTS, name);
  for (const f of PROJECT_FILES) if (existsSync(path.join(dir, 'data', f))) renameSync(path.join(dir, 'data', f), path.join(DATA, f));
  if (existsSync(path.join(dir, 'scenes'))) for (const f of readdirSync(path.join(dir, 'scenes'))) renameSync(path.join(dir, 'scenes', f), path.join(SCENES, f));
  if (existsSync(path.join(dir, 'audio/voiceover.mp3'))) renameSync(path.join(dir, 'audio/voiceover.mp3'), audioFile);
  rmSync(dir, { recursive: true, force: true });
}
const hasWork = () => PROJECT_FILES.some((f) => existsSync(path.join(DATA, f))) || existsSync(audioFile) || sceneFiles().length > 0;
function currentName() {
  const p = project(), sb = storyboard();
  let n = slug(p.title || sb?.title || 'untitled');
  while (existsSync(path.join(PROJECTS, n))) n += '-' + Math.random().toString(36).slice(2, 5);
  return n;
}

// ------------------------------------------------------------------ planner storage
const PLANNER = path.join(import.meta.dirname, 'planner.json');
const planner = () => readJson(PLANNER, { niche: '', audience: '', notes: '', count: 6, ideas: [] });
function pastTopics() {
  const out = [];
  const add = (t) => { if (t && !out.includes(t)) out.push(t); };
  add(project().title);
  for (const n of existsSync(PROJECTS) ? readdirSync(PROJECTS) : []) add(readJson(path.join(PROJECTS, n, 'data', 'project.json'), {}).title);
  for (const i of planner().ideas) if (i.used) add(i.title);
  return out.filter(Boolean).slice(0, 40);
}

// ------------------------------------------------------------------ routes
async function api(req, url) {
  const p = url.pathname, m = req.method;
  const body = async () => (await req.json().catch(() => ({})));

  if (p === '/api/state') {
    const sb = storyboard();
    return json({
      settings: publicSettings(), project: project(), hasAudio: existsSync(audioFile), audioBytes: existsSync(audioFile) ? statSync(audioFile).size : 0,
      planner: planner(), lyrics: lyrics(), storyboard: sb, scenes: sceneFiles().map((f) => f.replace(/\.ts$/, '')),
      stills: Object.fromEntries((sb?.plates ?? []).map((pl) => [pl.id, [1, 2, 3].map((n) => `${pl.id}_${n}.jpg`).filter((f) => existsSync(path.join(OUT, 'studio', f))).map((f) => '/out/studio/' + f)])),
      videos: existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.mp4')).map((f) => ({ name: f, size: statSync(path.join(OUT, f)).size, mtime: statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime) : [],
      projects: readdirSync(PROJECTS).filter((f) => statSync(path.join(PROJECTS, f)).isDirectory()),
      maxSeconds: MAX_SECONDS,
    });
  }
  if (p === '/api/settings' && m === 'POST') { saveSettings(await body()); return json(publicSettings()); }
  if (p === '/api/claude-models') { try { return json({ models: await listClaudeModels() }); } catch (e) { return fail(e); } }
  if (p === '/api/models') { try { return json({ models: await listModels() }); } catch (e) { return fail(e); } }


  if (p === '/api/planner/ideas' && m === 'POST') {
    const b = await body();
    const count = Math.min(10, Math.max(3, +b.count || 6));
    const r = await textJson(plannerPrompt({ niche: b.niche, audience: b.audience, notes: b.notes, count, avoid: pastTopics() }));
    const STY = ['explainer narration', 'punchy hype / trailer', 'poetic / spoken word', 'rhymed song lyrics', 'calm documentary'];
    const ideas = (r.ideas ?? []).map((i) => ({
      title: String(i.title ?? '').slice(0, 120), hook: String(i.hook ?? ''), why: String(i.why ?? ''), topic: String(i.topic ?? ''),
      style: STY.includes(i.style) ? i.style : 'explainer narration', tone: String(i.tone ?? ''), seconds: Math.min(MAX_SECONDS, Math.max(15, Math.round(+i.seconds || 40))),
      extra: String(i.extra ?? ''), artDirection: String(i.artDirection ?? ''), used: false,
    })).filter((i) => i.topic);
    if (!ideas.length) return fail('Model returned no usable ideas', 502);
    const st = { niche: b.niche || '', audience: b.audience || '', notes: b.notes || '', count, ideas };
    writeJson(PLANNER, st);
    return json({ planner: st });
  }
  if (p === '/api/planner/apply' && m === 'POST') {
    const b = await body();
    const st = planner();
    const idea = st.ideas[+b.index];
    if (!idea) return fail('no such idea', 404);
    if (hasWork() && !b.force && (project().lines.length || storyboard())) return json({ needsConfirm: true });
    if (hasWork() && b.force) archiveCurrent(currentName());
    const pr = { ...project(), title: idea.title, topic: idea.topic, style: idea.style, seconds: idea.seconds, tone: idea.tone, extra: idea.extra, direction: idea.artDirection, format: 'reel', hook: idea.hook, lines: [], spoken: {}, publish: null };
    saveProject(pr);
    idea.used = true;
    writeJson(PLANNER, st);
    return json({ project: pr, planner: st });
  }
  if (p === '/api/planner/save' && m === 'POST') {
    const b = await body(); const st = { ...planner(), niche: b.niche ?? '', audience: b.audience ?? '', notes: b.notes ?? '', count: +b.count || 6 };
    writeJson(PLANNER, st); return json({ ok: true });
  }
  if (p === '/api/publish/generate' && m === 'POST') {
    const b = await body();
    const pr = project();
    if (!pr.lines.length) return fail('No script yet. Write the lyrics first.', 400);
    const r = await textJson(publishPrompt({ title: pr.title, lines: pr.lines, channel: b.channel || planner().niche, language: b.language, cta: b.cta, extra: b.extra }));
    const tags = []; let len = 0;
    for (const t of (r.tags ?? []).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean)) { if (len + t.length + 1 > 480) break; tags.push(t); len += t.length + 1; }
    const publish = {
      titles: (r.titles ?? []).map((x) => String(x).slice(0, 100)), description: String(r.description ?? '').slice(0, 4900), tags,
      hashtags: (r.hashtags ?? []).map((x) => '#' + String(x).replace(/^#/, '').trim()), pinnedComment: String(r.pinnedComment ?? ''), thumbnailText: String(r.thumbnailText ?? ''),
      channel: b.channel ?? '', language: b.language ?? '', cta: b.cta ?? '', extra: b.extra ?? '',
    };
    saveProject({ ...pr, publish });
    return json({ publish });
  }

  if (p === '/api/lyrics/generate' && m === 'POST') {
    const b = await body();
    const seconds = Math.min(MAX_SECONDS, Math.max(10, +b.seconds || 40));
    if (!b.topic?.trim()) return fail('Topic is empty', 400);
    const r = await textJson(lyricsPrompt({ topic: b.topic, style: b.style || 'explainer narration', seconds, tone: b.tone, extra: b.extra }));
    const lines = (r.lines ?? []).map((x) => String(x).trim()).filter(Boolean);
    const pr = { ...project(), title: r.title || b.topic, topic: b.topic, style: b.style, seconds, tone: b.tone || '', extra: b.extra || '', lines, spoken: r.spoken ?? {} };
    saveProject(pr);
    return json({ project: pr });
  }
  if (p === '/api/script' && m === 'POST') {
    const b = await body();
    const pr = { ...project(), title: b.title ?? project().title, lines: (b.lines ?? []).map((x) => String(x).trim()).filter(Boolean), spoken: b.spoken ?? project().spoken };
    saveProject(pr);
    writeJson(path.join(DATA, 'script.json'), { lines: pr.lines, spoken: pr.spoken });
    return json({ project: pr });
  }
  if (p === '/api/eleven' && m === 'POST') {
    const b = await body();
    return json({ text: elevenText(b.lines ?? [], b.spoken ?? {}, { breaks: b.breaks ?? 'ssml', breakSec: +b.breakSec || 0.5 }) });
  }

  if (p === '/api/audio' && m === 'POST') {
    const tmp = path.join(OUT, `upload_${Date.now()}`);
    writeFileSync(tmp, new Uint8Array(await req.arrayBuffer()));
    try { return json(await ingestAudio(tmp)); } catch (e) { return fail(e, 400); } finally { rmSync(tmp, { force: true }); }
  }

  // ---- ElevenLabs
  if (p.startsWith('/api/eleven/') && p !== '/api/eleven/') {
    if (!loadSettings().elevenEnabled) return fail('ElevenLabs is turned off. Enable it in Settings.', 400);
    try {
      if (p === '/api/eleven/voices') return json({ voices: await eleven.listVoices() });
      if (p === '/api/eleven/models') return json({ models: await eleven.listModels() });
      if (p === '/api/eleven/usage') return json({ usage: await eleven.subscription() });
      if (p === '/api/eleven/generate' && m === 'POST') {
        const b = await body();
        const pr = project();
        if (!pr.lines.length) return fail('No script yet. Write the lyrics first.', 400);
        const v3 = /v3/i.test(b.modelId || '');
        const text = elevenText(pr.lines, pr.spoken, { breaks: b.breaks ?? (v3 ? 'paragraph' : 'ssml'), breakSec: +b.breakSec || loadSettings().elevenBreakSec || 0.5 });
        const sub = await eleven.subscription().catch(() => null);
        if (sub && sub.limit - sub.used < text.length) return fail(`This script is ${text.length} characters but only ${Math.max(0, sub.limit - sub.used)} credits are left on your ElevenLabs plan (${sub.tier}).`, 400);
        saveSettings({ elevenVoice: b.voiceId, elevenModel: b.modelId, elevenSettings: b.settings });
        const bytes = await eleven.speak({ text, voiceId: b.voiceId, modelId: b.modelId, settings: b.settings });
        const tmp = path.join(OUT, `eleven_${Date.now()}.mp3`);
        writeFileSync(tmp, bytes);
        try { return json({ ...(await ingestAudio(tmp)), chars: text.length }); } finally { rmSync(tmp, { force: true }); }
      }
    } catch (e) { return fail(e, e.status && e.status < 600 ? e.status : 500); }
  }
  if (p === '/api/align' && m === 'POST') {
    const pr = project();
    if (!pr.lines.length) return fail('No script. Generate or paste lyrics first.', 400);
    if (!existsSync(audioFile)) return fail('Upload the voiceover first.', 400);
    writeJson(path.join(DATA, 'script.json'), { lines: pr.lines, spoken: pr.spoken });
    const job = startJob('align', async (job) => {
      job.say('Aligning script to audio (wav2vec2 CTC)…');
      let r = await run(job, [PY, 'analysis/align_vo.py']);
      if (r.code !== 0) throw new Error('alignment failed (is studio/setup.sh done?)');
      job.say('Analysing audio…');
      r = await run(job, [PY, 'analysis/audio_vo.py']);
      if (r.code !== 0) throw new Error('audio analysis failed');
      const ly = lyrics();
      const missing = ly.lines.flatMap((l) => l.words).filter((w) => w.start === null).length;
      return { lines: ly.lines.length, duration: readJson(path.join(DATA, 'audio.json')).duration, missing };
    });
    return json({ job: job.id });
  }

  if (p === '/api/storyboard/generate' && m === 'POST') {
    const b = await body();
    const ly = lyrics();
    if (!ly) return fail('Run alignment first (Voiceover tab).', 400);
    const dur = readJson(path.join(DATA, 'audio.json'), {}).duration ?? ly.lines.at(-1).end;
    const r = await engineJson(storyboardPrompt({ title: project().title, lines: withIndex(ly), direction: b.direction, seconds: dur, format: b.format === 'wide' ? 'wide' : 'reel' }));
    const n = ly.lines.length;
    const used = new Set(sceneFilesProtected());
    let plates = (r.plates ?? []).map((pl, i) => ({ ...pl, id: uniqueId(String(pl.id || `plate${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'p_'), used), firstLine: +pl.firstLine, lastLine: +pl.lastLine }));
    plates.sort((a, c) => a.firstLine - c.firstLine);
    plates = plates.filter((pl) => Number.isFinite(pl.firstLine));
    // enforce contiguous coverage
    if (!plates.length) return fail('Model returned no plates', 502);
    plates[0].firstLine = 0;
    plates.forEach((pl, i) => { pl.lastLine = i + 1 < plates.length ? Math.max(pl.firstLine, plates[i + 1].firstLine - 1) : n - 1; });
    plates = plates.filter((pl, i) => i === 0 || pl.firstLine > plates[i - 1].firstLine).filter((pl) => pl.firstLine < n);
    const sb = { title: r.title || project().title, format: b.format === 'wide' ? 'wide' : 'reel', direction: r.direction || '', plates };
    writeJson(path.join(DATA, 'storyboard.json'), sb);
    return json({ storyboard: sb });
  }
  if (p === '/api/storyboard' && m === 'POST') {
    const b = await body();
    writeJson(path.join(DATA, 'storyboard.json'), b.storyboard);
    return json({ ok: true });
  }
  if (p === '/api/scenes/generate' && m === 'POST') {
    const b = await body();
    const job = startJob('scenes', (job) => genScenes(job, b.ids?.length ? b.ids : null));
    return json({ job: job.id });
  }
  const sm = p.match(/^\/api\/scene\/([a-z][a-z0-9_]*)$/);
  if (sm) {
    const f = path.join(SCENES, sm[1] + '.ts');
    if (m === 'GET') return existsSync(f) ? json({ code: readFileSync(f, 'utf8') }) : fail('no such scene', 404);
    if (m === 'PUT') { writeFileSync(f, (await body()).code); return json({ ok: true }); }
  }

  if (p === '/api/preview/start') return json({ ok: await ensureVite(), url: `http://localhost:${VITE_PORT}` });
  if (p === '/api/render' && m === 'POST') {
    const b = await body();
    if (!lyrics() || !storyboard()) return fail('Need aligned voiceover and storyboard first.', 400);
    const dur = readJson(path.join(DATA, 'audio.json'), {}).duration ?? 0;
    const name = slug(b.name || project().title || 'video');
    const args = ['bun', 'scripts/render.ts', 'video', '--private', '--fps', String(+b.fps || 60), '--crf', String(+b.crf || 17), '--scale', String(+b.scale || 1), '--out', path.join(OUT, `${name}.mp4`)];
    if (b.samples === 'auto') args.push('--samples', 'auto', '--min-samples', '4', '--max-samples', String(+b.maxSamples || 12), '--shutter', '0.5');
    else args.push('--samples', String(+b.samples || 1));
    if (b.preset) args.push('--preset', String(b.preset));
    // fastest path: several Chrome workers + hardware encode when the GPU supports it
    const nv = b.encoder !== 'x264' && hasNvenc();
    args.push('--jobs', String(+b.jobs || (nv ? 3 : 2)));
    if (nv) args.push('--encoder', 'nvenc');
    const job = startJob('render', async (job) => {
      if (dur > MAX_SECONDS + 0.5) job.say(`note: voiceover is ${dur.toFixed(1)}s, over the ${MAX_SECONDS}s target (rendering anyway)`);
      job.say(args.join(' '));
      const r = await gpu.run(() => run(job, args, { cwd: APP }));
      if (r.code !== 0) throw new Error('render failed (see log)');
      return { file: `/out/${name}.mp4` };
    });
    return json({ job: job.id });
  }

  if (p === '/api/project/new' && m === 'POST') {
    const b = await body();
    let archived = null;
    if (hasWork()) { archived = currentName(); archiveCurrent(archived); }
    return json({ archived });
  }
  if (p === '/api/project/load' && m === 'POST') {
    const b = await body();
    if (!existsSync(path.join(PROJECTS, b.name))) return fail('no such project', 404);
    let archived = null;
    if (hasWork()) { archived = currentName(); archiveCurrent(archived); }
    restore(b.name);
    return json({ archived });
  }

  const jm = p.match(/^\/api\/jobs\/(\w+)$/);
  if (jm) {
    const j = jobs.get(jm[1]);
    if (!j) return fail('no such job', 404);
    const since = +url.searchParams.get('since') || 0;
    return json({ status: j.status, lines: j.log.slice(since), next: j.log.length, progress: j.progress, result: j.result, error: j.error });
  }
  return fail('not found', 404);
}

function sceneFilesProtected() { return []; }
function uniqueId(id, used) {
  let n = id, i = 2;
  while (used.has(n)) n = `${id}_${i++}`;
  used.add(n);
  return n;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
function serveFile(file, req) {
  if (!existsSync(file) || !statSync(file).isFile()) return new Response('not found', { status: 404 });
  const f = Bun.file(file);
  const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const size = f.size, s = range[1] ? +range[1] : 0, e = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    return new Response(f.slice(s, e + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${s}-${e}/${size}`, 'content-length': String(e - s + 1) } });
  }
  return new Response(f, { headers });
}
const inside = (base, rel) => { const f = path.resolve(base, '.' + path.posix.normalize('/' + rel)); return f.startsWith(base) ? f : null; };

Bun.serve({
  port: PORT,
  hostname: process.env.STUDIO_HOST || '127.0.0.1', // local only by default: this server can run ffmpeg, claude and Chrome
  idleTimeout: 255,
  maxRequestBodySize: 200 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, url);
      if (url.pathname.startsWith('/data/')) return serveFile(inside(DATA, url.pathname.slice(6)) ?? '', req);
      if (url.pathname.startsWith('/out/')) return serveFile(inside(OUT, url.pathname.slice(5)) ?? '', req);
      if (url.pathname.startsWith('/fonts/')) return serveFile(inside(path.join(APP, 'public/fonts'), decodeURIComponent(url.pathname.slice(7))) ?? '', req);
      if (url.pathname === '/audio/voiceover.mp3') return serveFile(audioFile, req);
      return serveFile(inside(PUBLIC, url.pathname === '/' ? '/index.html' : url.pathname) ?? '', req);
    } catch (e) { return fail(e); }
  },
});
console.log(`Motion Studio  http://localhost:${PORT}  (bound to ${process.env.STUDIO_HOST || '127.0.0.1'})`);
