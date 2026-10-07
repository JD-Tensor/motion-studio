// Motion Studio UI (vanilla). Tabs: Lyrics → Voiceover → Storyboard → Scenes → Render.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null;            // server state
let tab = localStorage.getItem('tab') || 'plan';
let eleven = { breaks: 'ssml', breakSec: 0.5 };
const TABS = [['plan', 'Planner'], ['lyrics', 'Lyrics'], ['voice', 'Voiceover'], ['board', 'Storyboard'], ['scenes', 'Scenes'], ['render', 'Render'], ['publish', 'Publish']];

async function api(path, body, method) {
  method = method || (path === 'state' ? 'GET' : 'POST');
  const opt = method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  const r = await fetch('/api/' + path, opt);
  const j = await r.json().catch(() => ({ error: 'bad response' }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); }
async function copy(text, what = 'Copied') { try { await navigator.clipboard.writeText(text); } catch { const a = document.createElement('textarea'); a.value = text; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); } toast(what); }
async function refresh() { S = await api('state'); }
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }

/** Poll a job, mirroring its log into `logEl` and progress into `progEl`. */
async function follow(jobId, { logEl, progEl, onTick } = {}) {
  let since = 0;
  for (;;) {
    const j = await api('jobs/' + jobId + '?since=' + since, undefined, 'GET');
    since = j.next;
    if (logEl && j.lines.length) { logEl.textContent += j.lines.join('\n') + '\n'; logEl.scrollTop = logEl.scrollHeight; }
    if (progEl) progEl.textContent = j.progress || '';
    onTick?.(j);
    if (j.status !== 'running') { if (j.status === 'error') throw new Error(j.error); return j.result; }
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ------------------------------------------------------------------ shell
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, l], i) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}"><span class="n">${i + 1}</span>${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; localStorage.setItem('tab', tab); show(); } };
  $('#projname').textContent = S.project.title || 'untitled';
}
async function show() { renderTabs(); const f = { plan, lyrics, voice, board, scenes, render, publish }[tab] || plan; await f($('#main')); }

// ------------------------------------------------------------------ 1. lyrics
function lyrics(m) {
  const p = S.project;
  m.innerHTML = `
  <h2>Lyrics</h2><p class="sub">Generate the voiceover script from a topic (max ${S.maxSeconds}s), edit it, then copy the ElevenLabs version.</p>
  <div class="card">
    <div class="row"><div class="col" style="flex:3"><label>Topic</label><textarea id="topic" style="min-height:64px" placeholder="e.g. How black holes evaporate">${esc(p.topic)}</textarea></div>
    <div class="col"><label>Style</label><select id="style">${['explainer narration', 'punchy hype / trailer', 'poetic / spoken word', 'rhymed song lyrics', 'calm documentary'].map((s) => `<option ${p.style === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>Length: <span id="secv">${p.seconds || 40}</span>s</label><input id="sec" type="range" min="10" max="${S.maxSeconds}" step="5" value="${p.seconds || 40}"></div></div>
    <div class="row" style="margin-top:10px"><div class="col"><label>Tone (optional)</label><input id="tone" value="${esc(p.tone)}" placeholder="curious, confident, a bit cheeky"></div>
    <div class="col"><label>Extra notes (optional)</label><input id="extra" value="${esc(p.extra)}" placeholder="must mention X, avoid Y"></div></div>
    <div class="bar"><button id="gen">Generate lyrics</button><span id="gstat" class="dim"></span></div>
  </div>
  <div class="card" id="script"></div>
  <div class="card" id="el"></div>`;
  $('#sec').oninput = (e) => ($('#secv').textContent = e.target.value);
  $('#gen').onclick = async (e) => {
    busy(e.target, true, 'Writing…');
    try { const r = await api('lyrics/generate', { topic: $('#topic').value, style: $('#style').value, seconds: +$('#sec').value, tone: $('#tone').value, extra: $('#extra').value }); S.project = r.project; await api('script', { lines: S.project.lines, spoken: S.project.spoken, title: S.project.title }); renderTabs(); drawScript(); }
    catch (err) { toast(err.message); $('#gstat').textContent = err.message; $('#gstat').className = 'warn'; }
    busy(e.target, false);
  };
  drawScript();
}
function words(lines) { return lines.join(' ').split(/\s+/).filter(Boolean).length; }
function drawScript() {
  const p = S.project, box = $('#script');
  const est = (words(p.lines) / 2.5).toFixed(0);
  box.innerHTML = `<div class="bar" style="margin:0 0 10px"><b class="grow">Script</b><span class="dim">${p.lines.length} lines · ${words(p.lines)} words · ≈${est}s ${est > S.maxSeconds ? '<span class="warn">(over the 60s limit)</span>' : ''}</span></div>
  <div class="col"><label>Title</label><input id="title" name="video-title" autocomplete="off" value="${esc(p.title)}"></div>
  <label style="display:block;margin:12px 0 4px">Lines (one per row — each line animates as a unit)</label>
  <div class="linesbox" id="lines">${p.lines.map((l, i) => `<div class="lrow"><span class="i">${i}</span><input data-i="${i}" value="${esc(l)}"><button class="ghost sm" data-del="${i}">✕</button></div>`).join('')}</div>
  <div class="bar"><button class="ghost sm" id="addl">+ line</button><button class="ghost sm" id="bulk">Paste whole script</button><span class="grow"></span><button id="save">Save script</button></div>
  ${Object.keys(p.spoken || {}).length ? `<label style="display:block;margin:14px 0 4px">Pronunciations (how symbols/acronyms are spoken — used for alignment and the ElevenLabs text)</label><textarea id="spoken" class="mono" style="min-height:60px">${esc(Object.entries(p.spoken).map(([k, v]) => `${k} = ${v.join(' ')}`).join('\n'))}</textarea>` : '<textarea id="spoken" class="mono" style="min-height:50px" placeholder="optional pronunciations, one per line:  MCP. = EM SEE PEE"></textarea>'}`;
  const collect = () => {
    p.title = $('#title').value;
    p.lines = [...box.querySelectorAll('#lines input')].map((i) => i.value.trim()).filter(Boolean);
    p.spoken = {};
    for (const row of $('#spoken').value.split('\n')) { const [k, ...v] = row.split('='); if (k?.trim() && v.length) p.spoken[k.trim()] = v.join('=').trim().toUpperCase().split(/\s+/); }
  };
  box.oninput = () => { collect(); drawEleven(); };
  box.onclick = (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { collect(); p.lines.splice(+d.dataset.del, 1); drawScript(); }
    if (e.target.id === 'addl') { collect(); p.lines.push(''); drawScript(); box.querySelector('#lines').lastChild.querySelector('input').focus(); }
    if (e.target.id === 'bulk') {
      const t = prompt('Paste the whole script. Each line (or sentence) becomes a row:');
      if (t) { collect(); p.lines = t.split(/\n+/).flatMap((l) => l.trim().match(/[^.!?…]+[.!?…]+["”’]?|[^.!?…]+$/g) ?? []).map((x) => x.trim()).filter(Boolean); drawScript(); }
    }
    if (e.target.id === 'save') (async () => { collect(); await api('script', { lines: p.lines, spoken: p.spoken, title: p.title }); await refresh(); renderTabs(); toast('Script saved'); })();
  };
  drawEleven();
}
let elTimer;
function drawEleven() {
  const p = S.project, box = $('#el');
  if (!box) return;
  if (!box.dataset.init) {
    box.dataset.init = 1;
    box.innerHTML = `<div class="bar" style="margin:0 0 10px"><b class="grow">ElevenLabs text — copy &amp; paste</b>
      <select id="brk" style="width:auto"><option value="ssml">pause tags between lines</option><option value="paragraph">blank line between lines</option><option value="none">no pauses</option></select>
      <select id="brks" style="width:auto"><option>0.3</option><option selected>0.5</option><option>0.8</option><option>1.2</option></select><span class="dim">sec</span>
      <button id="cp">Copy</button></div>
      <textarea id="eltext" class="mono" style="min-height:200px" readonly></textarea>
      <p class="dim" style="margin:8px 0 0">Paste into ElevenLabs Text-to-Speech, generate, download the MP3, then upload it in <b>Voiceover</b>. Numbers/acronyms are respelled as they are pronounced so the alignment matches. Pause tags work with the Multilingual/Turbo models; with v3 use “blank line”. Keep the voice settings fixed so a regenerate sounds the same.</p>`;
    $('#brk').onchange = (e) => { eleven.breaks = e.target.value; drawEleven(); };
    $('#brks').onchange = (e) => { eleven.breakSec = +e.target.value; drawEleven(); };
    $('#cp').onclick = () => copy($('#eltext').value, 'ElevenLabs text copied');
  }
  clearTimeout(elTimer);
  elTimer = setTimeout(async () => { const r = await api('eleven', { lines: p.lines, spoken: p.spoken, ...eleven }); $('#eltext').value = r.text; }, 120);
}

// ------------------------------------------------------------------ 2. voiceover
function voice(m) {
  const ly = S.lyrics;
  m.innerHTML = `
  <h2>Voiceover &amp; timing</h2><p class="sub">Upload the ElevenLabs MP3 (max ${S.maxSeconds}s). Alignment finds when every word is spoken and writes the JSON files the animations read.</p>
  <div class="card">
    <div class="row"><div class="col"><label>Voiceover file (mp3 / wav / m4a)</label><input type="file" id="file" accept="audio/*"></div>
    <div class="col"><label>Current</label>${S.hasAudio ? `<audio controls src="/audio/voiceover.mp3?${Date.now()}" style="width:100%"></audio>` : '<span class="dim">none uploaded</span>'}</div></div>
    <div class="bar"><button id="up" class="ghost">Upload</button><button id="align" ${S.hasAudio && S.project.lines.length ? '' : 'disabled'}>Align &amp; analyse</button><span id="vstat" class="dim"></span></div>
    <pre id="vlog" class="log" style="margin-top:12px;display:none"></pre>
  </div>
  <div class="card" id="elcard"></div>
  <div class="card"><b>What the JSON files are</b>
    <p class="dim" style="margin:6px 0 0"><code>data/script.json</code> — your script lines + pronunciations (input).<br>
    <code>data/lyrics.json</code> — <b>word-level timings</b>: for each line and word, <code>start</code>/<code>end</code> seconds in the audio. Made by CTC forced alignment with wav2vec2 (the model finds where each letter of your script sits in the audio), then edges are snapped to the real silences. Every animation keys off these times.<br>
    <code>data/audio.json</code> — voice loudness curves (rms, low/mid/high bands at 100 fps), word onsets and a nominal beat grid; scenes read it for pulses.<br>
    <code>data/storyboard.json</code> — which plate (scene) plays on which lines (next tab).</p></div>
  <div class="card" id="timing">${timingView(ly)}</div>`;
  elevenCard();
  $('#up').onclick = async (e) => {
    const f = $('#file').files[0]; if (!f) return toast('Choose a file first');
    busy(e.target, true, 'Uploading…');
    try { const r = await (await fetch('/api/audio', { method: 'POST', body: f })).json(); if (r.error) throw new Error(r.error); toast(`Uploaded ${r.duration.toFixed(1)}s` + (r.tooLong ? ' — over the 60s limit!' : '')); await refresh(); voice(m); }
    catch (err) { toast(err.message); }
    busy(e.target, false);
  };
  $('#align').onclick = async (e) => {
    busy(e.target, true, 'Aligning…');
    const log = $('#vlog'); log.style.display = 'block'; log.textContent = '';
    try { await api('script', { lines: S.project.lines, spoken: S.project.spoken, title: S.project.title }); const { job } = await api('align'); const r = await follow(job, { logEl: log, progEl: $('#vstat') });
      toast(`Aligned ${r.lines} lines, ${r.duration.toFixed(1)}s` + (r.missing ? ` (${r.missing} words unmatched)` : '')); await refresh(); $('#timing').innerHTML = timingView(S.lyrics); }
    catch (err) { toast(err.message); }
    busy(e.target, false);
  };
}

// ElevenLabs generation card (Voiceover tab)
async function elevenCard() {
  const box = $('#elcard'); if (!box) return;
  const s = S.settings;
  if (!s.elevenEnabled) { box.remove(); return; }
  if (!s.hasElevenKey) { box.innerHTML = '<b>Generate with ElevenLabs</b><p class="dim" style="margin:6px 0 0">Add your ElevenLabs API key in <b>Settings</b> to generate the voiceover here instead of pasting text into the website. A free account works (see the README for limits).</p>'; return; }
  box.innerHTML = '<b>Generate with ElevenLabs</b> <span class="dim">loading voices…</span>';
  let voices, models, usage = null;
  try { [voices, models] = await Promise.all([api('eleven/voices', undefined, 'GET').then((r) => r.voices), api('eleven/models', undefined, 'GET').then((r) => r.models)]); api('eleven/usage', undefined, 'GET').then((r) => { usage = r.usage; paint(); }).catch(() => {}); }
  catch (err) { box.innerHTML = `<b>Generate with ElevenLabs</b><p class="warn" style="margin:6px 0 0">${esc(err.message)}</p>`; return; }
  const es = s.elevenSettings || {};
  const vopt = (list) => list.map((v) => `<option value="${esc(v.id)}" ${v.id === s.elevenVoice ? 'selected' : ''}>${esc(v.name)}${v.labels?.accent ? ' · ' + esc(v.labels.accent) : ''}${v.labels?.gender ? ' · ' + esc(v.labels.gender) : ''}</option>`).join('');
  const pre = voices.filter((v) => v.category === 'premade'), other = voices.filter((v) => v.category !== 'premade');
  const slider = (id, label, min, max, step, val) => `<div class="col"><label>${label}: <span id="${id}v">${val}</span></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  function paint() {
    const u = usage ? `<span class="tag ${usage.limit - usage.used < 1500 ? 'bad' : 'ok'}">${(usage.limit - usage.used).toLocaleString()} credits left · ${esc(usage.tier)}</span>` : '';
    box.innerHTML = `<div class="bar" style="margin:0 0 10px"><b class="grow">Generate with ElevenLabs</b>${u}</div>
      <div class="row"><div class="col"><label>Voice</label><select id="elv">${pre.length ? `<optgroup label="Premade (all plans)">${vopt(pre)}</optgroup>` : ''}${other.length ? `<optgroup label="Library / cloned (may need a paid plan)">${vopt(other)}</optgroup>` : ''}</select></div>
      <div class="col"><label>Model</label><select id="elm">${models.map((m) => `<option value="${esc(m.id)}" ${m.id === s.elevenModel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div></div>
      <div class="row" style="margin-top:10px">${slider('els', 'Stability', 0, 1, 0.05, es.stability ?? 0.5)}${slider('elsim', 'Similarity', 0, 1, 0.05, es.similarity_boost ?? 0.75)}${slider('elst', 'Style', 0, 1, 0.05, es.style ?? 0)}${slider('elsp', 'Speed', 0.7, 1.2, 0.05, es.speed ?? 1)}</div>
      <div class="bar"><button id="elgo" ${S.project.lines.length ? '' : 'disabled'}>Generate voiceover</button>
        <label style="text-transform:none;letter-spacing:0;font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="elal" style="width:auto" checked> then align automatically</label>
        <button class="ghost sm" id="elpv">▶ preview voice</button><span id="elinfo" class="dim"></span></div>
      <p class="dim" style="margin:8px 0 0;font-size:12px">${S.hasAudio ? 'This replaces the current voiceover (the previous one is kept as <code>audio/voiceover.prev.mp3</code>). ' : ''}Pauses between lines are inserted automatically. Free plans: 10,000 credits/month, non-commercial use only.</p>`;
    for (const [id] of [['els'], ['elsim'], ['elst'], ['elsp']]) $('#' + id).oninput = (e) => ($('#' + id + 'v').textContent = e.target.value);
    const upd = async () => { try { const m = models.find((x) => x.id === $('#elm').value); const r = await api('eleven', { lines: S.project.lines, spoken: S.project.spoken, breaks: m && !m.ssml ? 'paragraph' : 'ssml', breakSec: 0.5 }); $('#elinfo').textContent = `${r.text.length} characters ≈ ${r.text.length} credits`; } catch {} };
    $('#elm').onchange = upd; upd();
    $('#elpv').onclick = () => { const v = voices.find((x) => x.id === $('#elv').value); if (v?.preview) new Audio(v.preview).play(); else toast('No preview for this voice'); };
    $('#elgo').onclick = async (e) => {
      if (S.hasAudio && !confirm('Replace the current voiceover?')) return;
      busy(e.target, true, 'Generating…');
      try {
        const m = models.find((x) => x.id === $('#elm').value);
        const r = await api('eleven/generate', { voiceId: $('#elv').value, modelId: $('#elm').value, breaks: m && !m.ssml ? 'paragraph' : 'ssml', settings: { stability: +$('#els').value, similarity_boost: +$('#elsim').value, style: +$('#elst').value, speed: +$('#elsp').value } });
        toast(`Voiceover ready: ${r.duration.toFixed(1)}s, ${r.chars} credits` + (r.tooLong ? ' — over 60s!' : ''));
        await refresh(); const auto = $('#elal').checked; voice($('#main')); if (auto) $('#align').click();
      } catch (err) { toast(err.message); $('#elinfo').textContent = err.message; $('#elinfo').className = 'warn'; }
      busy(e.target, false);
    };
  }
  paint();
}

function timingView(ly) {
  if (!ly) return '<span class="dim">No timings yet. Upload the voiceover and press “Align &amp; analyse”.</span>';
  return `<b>Word timings</b> <span class="tag">${ly.lines.length} lines</span><div style="margin-top:10px;display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto">` +
    ly.lines.map((l, i) => `<div><div class="dim" style="font:11px monospace">#${i} ${l.start.toFixed(2)}–${l.end.toFixed(2)}s</div><div class="words">${l.words.map((w) => `<span>${esc(w.w)} <small>${w.start.toFixed(2)}</small></span>`).join('')}</div></div>`).join('') + '</div>' +
    `<div class="bar"><a href="/data/lyrics.json" target="_blank" style="color:var(--ash)">lyrics.json</a><a href="/data/audio.json" target="_blank" style="color:var(--ash)">audio.json</a></div>`;
}

// ------------------------------------------------------------------ 3. storyboard
function board(m) {
  const sb = S.storyboard, ly = S.lyrics;
  m.innerHTML = `
  <h2>Storyboard</h2><p class="sub">The model splits the script into plates (scenes) and writes a visual concept for each. Edit anything, then generate the code.</p>
  <div class="card"><div class="row"><div class="col" style="flex:0 0 260px"><label>Format</label><select id="fmt"><option value="reel" ${(sb?.format ?? S.project.format ?? 'reel') === 'reel' ? 'selected' : ''}>9:16 Reel (1080×1920)</option><option value="wide" ${(sb?.format ?? S.project.format) === 'wide' ? 'selected' : ''}>16:9 Wide (1920×1080)</option></select></div></div><label style="display:block;margin-top:10px">Style notes (optional)</label><textarea id="dir" style="min-height:56px" placeholder="e.g. mostly typographic, one recurring orange spark, keep diagrams hairline thin">${esc(sb?.userDirection ?? S.project.direction ?? '')}</textarea>
  <div class="bar"><button id="gen" ${ly ? '' : 'disabled'}>${sb ? 'Regenerate storyboard' : 'Generate storyboard'}</button>${ly ? '' : '<span class="warn">Align the voiceover first.</span>'}<span id="gstat" class="dim"></span></div></div>
  <div id="sb"></div>`;
  $('#gen').onclick = async (e) => {
    if (sb && !confirm('Replace the current storyboard? Generated scene files stay on disk.')) return;
    busy(e.target, true, 'Planning…');
    try { const r = await api('storyboard/generate', { direction: $('#dir').value, format: $('#fmt').value }); r.storyboard.userDirection = $('#dir').value; S.storyboard = r.storyboard; await api('storyboard', { storyboard: r.storyboard }); await refresh(); board(m); }
    catch (err) { toast(err.message); $('#gstat').textContent = err.message; $('#gstat').className = 'warn'; }
    busy(e.target, false);
  };
  $('#fmt').onchange = async () => { if (!sb) return; sb.format = $('#fmt').value; await api('storyboard', { storyboard: sb }); toast('Format set — regenerate the scenes so they match'); };
  if (!sb) return;
  const dur = ly.lines.at(-1).end;
  const L = (i) => ly.lines[Math.min(i, ly.lines.length - 1)];
  $('#sb').innerHTML = `<div class="card"><label>Global art direction</label><textarea id="gdir" style="min-height:60px">${esc(sb.direction)}</textarea>
    <div class="tl">${sb.plates.map((p) => `<div style="width:${((L(p.lastLine).end - L(p.firstLine).start) / dur) * 100}%" title="${esc(p.id)}">${esc(p.id)}</div>`).join('')}</div></div>` +
    sb.plates.map((p, i) => `<div class="card" data-i="${i}"><div class="bar" style="margin:0 0 8px"><b class="grow">${i + 1}. <input class="pid" value="${esc(p.id)}" style="width:200px;display:inline-block"> <input class="ptitle" value="${esc(p.title ?? '')}" style="width:260px;display:inline-block"></b>
      <span class="tag">lines ${p.firstLine}–${p.lastLine}</span><span class="tag">${L(p.firstLine).start.toFixed(1)}s</span></div>
      <div class="dim" style="margin-bottom:8px">“${esc(ly.lines.slice(p.firstLine, p.lastLine + 1).map((l) => l.text).join(' '))}”</div>
      <textarea class="pconcept" style="min-height:96px">${esc(p.concept)}</textarea></div>`).join('') +
    `<div class="bar"><button id="savesb">Save storyboard</button></div>`;
  $('#savesb').onclick = async () => {
    sb.direction = $('#gdir').value;
    document.querySelectorAll('#sb .card[data-i]').forEach((c) => { const p = sb.plates[+c.dataset.i]; p.id = c.querySelector('.pid').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'); p.title = c.querySelector('.ptitle').value; p.concept = c.querySelector('.pconcept').value; });
    await api('storyboard', { storyboard: sb }); await refresh(); toast('Storyboard saved');
  };
}

// ------------------------------------------------------------------ 4. scenes
function scenes(m) {
  const sb = S.storyboard;
  if (!sb) { m.innerHTML = '<h2>Scenes</h2><p class="sub warn">Generate a storyboard first.</p>'; return; }
  m.innerHTML = `
  <h2>Scenes</h2><p class="sub">The model writes one TypeScript file per plate. Each is type-checked, test-rendered at 3 moments, and (optionally) visually reviewed and auto-fixed.</p>
  <div class="card"><div class="bar" style="margin:0"><button id="all">Generate all scenes</button><span id="pstat" class="dim"></span></div>
  <pre id="slog" class="log" style="margin-top:12px;display:none"></pre></div>
  <div id="plates">${sb.plates.map((p) => plateCard(p)).join('')}</div>`;
  const runGen = async (ids, btn) => {
    busy(btn, true, 'Generating…');
    const log = $('#slog'); log.style.display = 'block'; log.textContent = '';
    try { const { job } = await api('scenes/generate', { ids }); const res = await follow(job, { logEl: log, progEl: $('#pstat') });
      toast(`${res.filter((r) => r.ok).length}/${res.length} plates OK`); await refresh(); scenes(m); $('#slog').style.display = 'block'; $('#slog').textContent = log.textContent; }
    catch (err) { toast(err.message); }
    busy(btn, false);
  };
  $('#all').onclick = (e) => runGen(null, e.target);
  m.onclick = async (e) => {
    const g = e.target.closest('[data-gen]'); if (g) return runGen([g.dataset.gen], g);
    const ed = e.target.closest('[data-edit]');
    if (ed) { const id = ed.dataset.edit; const { code } = await api('scene/' + id, undefined, 'GET'); const d = $('#dlg'); d.style.width = 'min(1000px,95vw)';
      d.innerHTML = `<h3 style="margin-top:0">${id}.ts</h3><textarea id="code" class="mono" style="min-height:60vh">${esc(code)}</textarea><div class="bar"><button id="sv">Save</button><button class="ghost" id="cl">Close</button><span class="dim">Saved files hot-reload in the Render tab preview.</span></div>`;
      d.showModal(); $('#cl').onclick = () => d.close(); $('#sv').onclick = async () => { await api('scene/' + id, { code: $('#code').value }, 'PUT'); toast('Saved'); d.close(); }; }
  };
}
function plateCard(p) {
  const has = S.scenes.includes(p.id), st = S.stills[p.id] || [];
  return `<div class="card plate"><div><div class="bar" style="margin:0 0 6px"><b class="grow">${esc(p.id)}</b><span class="tag ${has ? 'ok' : ''}">${has ? 'code written' : 'not generated'}</span></div>
    <div class="dim">${esc(p.concept)}</div><div class="bar"><button class="sm" data-gen="${p.id}">${has ? 'Regenerate' : 'Generate'}</button>${has ? `<button class="ghost sm" data-edit="${p.id}">Edit code</button>` : ''}</div></div>
    <div class="stills">${st.map((s) => `<img src="${s}?${Date.now()}">`).join('')}</div></div>`;
}

// ------------------------------------------------------------------ 5. render
async function render(m) {
  const dur = S.lyrics?.lines.at(-1).end ?? 0;
  m.innerHTML = `
  <h2>Preview &amp; render</h2><p class="sub">Live preview runs the same code as the render. Space = play, ← → seek, [ ] jump plate.</p>
  <div class="card"><div id="pv" class="dim">Starting preview…</div></div>
  <div class="card"><b>Render MP4</b> <span class="tag">${dur ? dur.toFixed(1) + 's' : 'no timings'}</span>
    <div class="row" style="margin-top:10px">
      <div class="col"><label>Quality</label><select id="q"><option value="draft">Draft — 30 fps, no motion blur</option><option value="good" selected>Good — 60 fps, adaptive blur</option><option value="best">Best — 60 fps, 4K</option></select></div>
      <div class="col"><label>File name</label><input id="name" value="${esc((S.project.title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-'))}"></div></div>
    <div class="bar"><button id="go" ${S.lyrics && S.storyboard ? '' : 'disabled'}>Render video</button><span id="rstat" class="dim"></span></div>
    <div class="prog" style="margin-top:10px"><i id="bar"></i></div><pre id="rlog" class="log" style="margin-top:10px;display:none"></pre></div>
  <div class="card"><b>Videos</b><div id="vids" style="margin-top:10px">${vids()}</div></div>`;
  api('preview/start', {}).then((r) => { const reel = S.storyboard?.format === 'reel'; $('#pv').innerHTML = r.ok ? `<iframe src="${r.url}/" allow="autoplay" style="${reel ? 'aspect-ratio:9/16;max-width:380px;display:block;margin:auto' : ''}"></iframe><div class="bar"><a style="color:var(--ash)" target="_blank" href="${r.url}/">open full size ↗</a></div>` : '<span class="warn">Could not start the preview server (run bunx vite in app/).</span>'; });
  $('#go').onclick = async (e) => {
    const q = { draft: { fps: 30, samples: 1, crf: 22, preset: 'veryfast' }, good: { fps: 60, samples: 'auto', crf: 17, preset: 'medium' }, best: { fps: 60, samples: 'auto', maxSamples: 12, crf: 16, scale: 2, preset: 'slow' } }[$('#q').value];
    busy(e.target, true, 'Rendering…'); const log = $('#rlog'); log.style.display = 'block'; log.textContent = '';
    try { const { job } = await api('render', { ...q, name: $('#name').value });
      const r = await follow(job, { logEl: log, progEl: $('#rstat'), onTick: (j) => { const mm = /(\d+)\/(\d+) frames/.exec(j.progress || ''); if (mm) $('#bar').style.width = (100 * mm[1] / mm[2]) + '%'; } });
      $('#bar').style.width = '100%'; toast('Render finished'); await refresh(); $('#vids').innerHTML = vids(); }
    catch (err) { toast(err.message); }
    busy(e.target, false);
  };
}
const vids = () => S.videos.length ? S.videos.map((v) => `<div style="margin-bottom:14px"><div class="bar" style="margin:0 0 6px"><b>${esc(v.name)}</b><span class="dim">${(v.size / 1e6).toFixed(1)} MB</span><a href="/out/${esc(v.name)}" download style="color:var(--sig)">download</a></div><video controls preload="none" style="max-height:80vh;width:auto;max-width:100%" src="/out/${esc(v.name)}"></video></div>`).join('') : '<span class="dim">none yet</span>';


// ------------------------------------------------------------------ 0. planner
function plan(m) {
  const P = S.planner || { ideas: [] };
  m.innerHTML = `
  <h2>Content planner</h2><p class="sub">Tell the AI about your channel. It proposes video ideas with every field filled in for the Lyrics and Storyboard tabs. Pick one to start a project.</p>
  <div class="card">
    <div class="row"><div class="col" style="flex:2"><label>Channel / niche</label><textarea id="niche" style="min-height:64px" placeholder="e.g. space and physics explained with kinetic typography">${esc(P.niche)}</textarea></div>
    <div class="col"><label>Audience</label><input id="aud" value="${esc(P.audience)}" placeholder="curious teens and adults"><label style="margin-top:8px">Ideas</label><select id="cnt">${[4, 6, 8, 10].map((n) => `<option ${+P.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <div class="col" style="margin-top:10px"><label>Notes (optional)</label><input id="pnotes" value="${esc(P.notes)}" placeholder="series idea, topics to lean into or avoid, trends you saw"></div>
    <div class="bar"><button id="suggest">${P.ideas.length ? 'Suggest new ideas' : 'Suggest ideas'}</button><span id="pstat" class="dim">Ideas avoid your earlier projects' topics.</span></div></div>
  <div id="ideas">${P.ideas.map((i, n) => ideaCard(i, n)).join('')}</div>`;
  const save = () => api('planner/save', { niche: $('#niche').value, audience: $('#aud').value, notes: $('#pnotes').value, count: +$('#cnt').value });
  m.oninput = () => { clearTimeout(plan.t); plan.t = setTimeout(save, 600); };
  $('#suggest').onclick = async (e) => {
    busy(e.target, true, 'Thinking…');
    try { const r = await api('planner/ideas', { niche: $('#niche').value, audience: $('#aud').value, notes: $('#pnotes').value, count: +$('#cnt').value }); S.planner = r.planner; plan(m); }
    catch (err) { toast(err.message); $('#pstat').textContent = err.message; $('#pstat').className = 'warn'; }
    busy(e.target, false);
  };
  m.onclick = async (e) => {
    const b = e.target.closest('[data-use]'); if (!b) return;
    const index = +b.dataset.use;
    try {
      let r = await api('planner/apply', { index });
      if (r.needsConfirm) { if (!confirm('This starts a new project. Your current script, storyboard and scenes will be archived (not deleted). Continue?')) return; r = await api('planner/apply', { index, force: true }); }
      await refresh(); tab = 'lyrics'; localStorage.setItem('tab', tab); show(); toast('Idea loaded — review it and press Generate lyrics');
    } catch (err) { toast(err.message); }
  };
}
function ideaCard(i, n) {
  return `<div class="card"><div class="bar" style="margin:0 0 6px"><b class="grow">${esc(i.title)}</b>${i.used ? '<span class="tag ok">used</span>' : ''}<span class="tag">${esc(i.style)}</span><span class="tag">${i.seconds}s</span><button class="sm" data-use="${n}">Use this idea</button></div>
    <div style="margin-bottom:6px">“${esc(i.hook)}”</div><div class="dim" style="margin-bottom:8px">${esc(i.why)}</div>
    <details><summary class="dim" style="cursor:pointer">Fields this fills in</summary>
      <div class="dim" style="margin-top:8px;display:grid;grid-template-columns:110px 1fr;gap:4px 12px"><b>Topic</b><span>${esc(i.topic)}</span><b>Tone</b><span>${esc(i.tone)}</span><b>Script notes</b><span>${esc(i.extra)}</span><b>Art direction</b><span>${esc(i.artDirection)}</span><b>Format</b><span>9:16 reel</span></div></details></div>`;
}

// ------------------------------------------------------------------ 6. publish
function publish(m) {
  const pr = S.project, pub = pr.publish;
  m.innerHTML = `
  <h2>Publish — YouTube Shorts</h2><p class="sub">Title options, description, tags and a pinned comment written from your final script.</p>
  <div class="card"><div class="row"><div class="col"><label>Channel / niche</label><input id="ch" value="${esc(pub?.channel ?? S.planner?.niche ?? '')}"></div>
    <div class="col"><label>Language</label><input id="lang" value="${esc(pub?.language ?? 'English')}"></div></div>
    <div class="row" style="margin-top:10px"><div class="col"><label>Call to action (optional)</label><input id="cta" value="${esc(pub?.cta ?? '')}" placeholder="Follow for a new space short every day"></div>
    <div class="col"><label>Notes (optional)</label><input id="pextra" value="${esc(pub?.extra ?? '')}" placeholder="keywords to include, series name"></div></div>
    <div class="bar"><button id="pg" ${pr.lines.length ? '' : 'disabled'}>${pub ? 'Regenerate' : 'Generate metadata'}</button>${pr.lines.length ? '' : '<span class="warn">Write the lyrics first.</span>'}<span id="pgs" class="dim"></span></div></div>
  <div id="pubout">${pub ? pubView(pub) : ''}</div>`;
  $('#pg').onclick = async (e) => {
    busy(e.target, true, 'Writing…');
    try { const r = await api('publish/generate', { channel: $('#ch').value, language: $('#lang').value, cta: $('#cta').value, extra: $('#pextra').value }); S.project.publish = r.publish; publish(m); }
    catch (err) { toast(err.message); $('#pgs').textContent = err.message; $('#pgs').className = 'warn'; }
    busy(e.target, false);
  };
  m.onclick = (e) => { const c = e.target.closest('[data-copy]'); if (c) copy(document.getElementById(c.dataset.copy).value ?? '', 'Copied'); const t = e.target.closest('[data-title]'); if (t) copy(t.dataset.title, 'Title copied'); };
}
function pubView(p) {
  const tags = p.tags.join(', ');
  return `<div class="card"><b>Titles</b> <span class="dim">(click to copy)</span><div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${p.titles.map((t) => `<button class="ghost" style="text-align:left;font-weight:500" data-title="${esc(t)}">${esc(t)} <span class="dim" style="float:right">${t.length}</span></button>`).join('')}</div></div>
  <div class="card"><div class="bar" style="margin:0 0 8px"><b class="grow">Description</b><span class="dim">${p.description.length} chars</span><button class="sm" data-copy="pdesc">Copy</button></div><textarea id="pdesc" style="min-height:200px">${esc(p.description)}</textarea></div>
  <div class="card"><div class="bar" style="margin:0 0 8px"><b class="grow">Tags</b><span class="dim">${tags.length}/500 chars</span><button class="sm" data-copy="ptags">Copy</button></div><textarea id="ptags" style="min-height:70px">${esc(tags)}</textarea>
    <div class="bar"><span class="dim">Hashtags: ${esc(p.hashtags.join(' '))}</span></div></div>
  <div class="card"><div class="bar" style="margin:0 0 8px"><b class="grow">Pinned comment</b><button class="sm" data-copy="pcom">Copy</button></div><textarea id="pcom" style="min-height:60px">${esc(p.pinnedComment)}</textarea>
    <div class="bar"><span class="dim">Cover text suggestion: <b>${esc(p.thumbnailText)}</b></span></div></div>`;
}

// ------------------------------------------------------------------ dialogs
$('#btnSettings').onclick = async () => {
  const d = $('#dlg'); d.style.width = '';
  const s = S.settings;
  d.innerHTML = `<h3 style="margin-top:0">Settings</h3>
    <div class="col"><label>Writing engine (lyrics, planner, publish)</label><select id="teng"><option value="openai" ${s.textEngine === 'openai' ? 'selected' : ''}>OpenAI (needs API key below)</option><option value="claude-code" ${s.textEngine === 'claude-code' ? 'selected' : ''}>Claude Code (your installed CLI)</option></select></div>
    <div class="col" style="margin-top:14px"><label>Scene engine (storyboard, scene code, visual review) ${s.claudeBin ? '<span class="tag ok">Claude Code found</span>' : '<span class="tag bad">Claude Code not found</span>'}</label><select id="eng"><option value="claude-code" ${s.sceneEngine === 'claude-code' ? 'selected' : ''}>Claude Code (your installed CLI)</option><option value="openai" ${s.sceneEngine === 'openai' ? 'selected' : ''}>OpenAI</option></select>
    <select id="cm" style="margin-top:6px"><option value="">Default (your Claude Code default)</option>${s.claudeModel ? `<option value="${esc(s.claudeModel)}" selected>${esc(s.claudeModel)}</option>` : ''}</select><div class="dim" style="font-size:12px">${esc(s.claudeBin || '')}</div></div>
    <div class="col" style="margin-top:14px"><label>OpenAI API key (only needed if an engine above is OpenAI) ${s.hasKey ? `<span class="tag ok">set ${esc(s.keyHint)}${s.fromEnv ? ' (env)' : ''}</span>` : '<span class="tag bad">missing</span>'}</label><input id="key" type="text" name="openai-key-field" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="sk-… (stored only in studio/settings.json)"></div>
    <div class="col" style="margin-top:12px"><label>OpenAI model <button class="ghost sm" id="lm" style="margin-left:8px">list available</button></label><input id="model" list="ml" value="${esc(s.model)}"><datalist id="ml"></datalist></div>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--bone)"><input type="checkbox" id="eon" style="width:auto" ${s.elevenEnabled ? 'checked' : ''}> <b>Generate voiceover with the ElevenLabs API</b> <span class="dim">(optional — off = upload your own MP3)</span></label>
      <div id="elset" style="display:${s.elevenEnabled ? 'block' : 'none'};margin-top:10px">
        <div class="col"><label>ElevenLabs API key ${s.hasElevenKey ? `<span class="tag ok">set ${esc(s.elevenKeyHint)}</span>` : '<span class="tag bad">missing</span>'}</label><input id="ekey" type="text" name="elevenlabs-key-field" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="paste to set or replace (stored only in studio/settings.json)"></div>
        <div class="row" style="margin-top:10px"><div class="col"><label>Default model</label><select id="emod"><option value="${esc(s.elevenModel)}">${esc(s.elevenModel)}</option></select></div>
          <div class="col"><label>Default voice</label><select id="evoi"><option value="${esc(s.elevenVoice)}">${s.elevenVoice ? esc(s.elevenVoice) : '(choose after connecting)'}</option></select></div>
          <div class="col" style="flex:0 0 120px"><label>Pause (sec)</label><input id="ebrk" type="number" min="0" max="3" step="0.1" value="${s.elevenBreakSec ?? 0.5}"></div></div>
        <div class="bar" style="margin-top:8px"><button class="ghost sm" id="econ">Connect &amp; load voices</button><span id="eres" class="dim"></span></div>
        <p class="dim" style="margin:6px 0 0;font-size:12px">Free plan: 10,000 credits/month, non-commercial use only. Pick a premade voice.</p>
      </div></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:14px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" id="rev" style="width:auto" ${s.reviewScenes ? 'checked' : ''}> Visual review: model checks each plate's stills and fixes layout problems (extra cost)</label>
    <div class="bar"><button id="ss">Save</button><button class="ghost" id="sc">Close</button></div>`;
  d.showModal();
  api('claude-models', undefined, 'GET').then((r) => { const cur = s.claudeModel; $('#cm').innerHTML = `<option value="">Default (your Claude Code default)</option>` + r.models.map((m) => `<option value="${esc(m.value)}" ${m.value === cur ? 'selected' : ''}>${esc(m.name)} — ${esc(m.description)}</option>`).join('') + (cur && !r.models.some((m) => m.value === cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''); }).catch(() => {});
  $('#eon').onchange = (e) => ($('#elset').style.display = e.target.checked ? 'block' : 'none');
  $('#econ').onclick = async (e) => {
    busy(e.target, true, 'Connecting…');
    try {
      await api('settings', { elevenEnabled: true, elevenEnabled: $('#eon').checked, elevenKey: $('#ekey').value.trim(), elevenModel: $('#emod').value, elevenVoice: $('#evoi').value, elevenBreakSec: +$('#ebrk').value || 0.5 }); await refresh();
      const [vs, ms, us] = await Promise.all([api('eleven/voices', undefined, 'GET'), api('eleven/models', undefined, 'GET'), api('eleven/usage', undefined, 'GET').catch(() => ({}))]);
      const cm = S.settings.elevenModel, cv = S.settings.elevenVoice;
      $('#emod').innerHTML = ms.models.map((m) => `<option value="${esc(m.id)}" ${m.id === cm ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
      const opt = (v) => `<option value="${esc(v.id)}" ${v.id === cv ? 'selected' : ''}>${esc(v.name)}${v.category === 'premade' ? '' : ' (' + esc(v.category) + ')'}</option>`;
      $('#evoi').innerHTML = vs.voices.map(opt).join('');
      $('#eres').textContent = `Connected: ${vs.voices.length} voices` + (us.usage ? ` · ${(us.usage.limit - us.usage.used).toLocaleString()} credits left (${us.usage.tier})` : '');
      $('#eres').className = 'dim'; $('#ekey').value = '';
    } catch (err) { $('#eres').textContent = err.message; $('#eres').className = 'warn'; }
    busy(e.target, false);
  };
  $('#sc').onclick = () => d.close();
  $('#lm').onclick = async () => { try { await api('settings', { apiKey: $('#key').value }); const r = await api('models', undefined, 'GET'); $('#ml').innerHTML = r.models.map((x) => `<option>${x}</option>`).join(''); toast(r.models.length + ' models'); } catch (e) { toast(e.message); } };
  $('#ss').onclick = async () => { await api('settings', { apiKey: $('#key').value, model: $('#model').value.trim(), reviewScenes: $('#rev').checked, sceneEngine: $('#eng').value, textEngine: $('#teng').value, claudeModel: $('#cm').value.trim(), elevenEnabled: $('#eon').checked, elevenKey: $('#ekey').value.trim(), elevenModel: $('#emod').value, elevenVoice: $('#evoi').value, elevenBreakSec: +$('#ebrk').value || 0.5 }); await refresh(); d.close(); toast('Saved'); };
};
$('#btnProjects').onclick = () => {
  const d = $('#dlg'); d.style.width = '';
  d.innerHTML = `<h3 style="margin-top:0">Projects</h3><p class="dim">The current project is the files in <code>data/</code>, <code>audio/voiceover.mp3</code> and <code>app/src/scenes/</code>. Starting a new one archives them into <code>projects/</code> — nothing is deleted.</p>
    <div class="bar"><button id="np">Start new project</button></div>
    <label style="display:block;margin-top:16px">Archived</label>${S.projects.length ? S.projects.map((n) => `<div class="bar"><span class="grow">${esc(n)}</span><button class="ghost sm" data-load="${esc(n)}">Open (archives current)</button></div>`).join('') : '<span class="dim">none</span>'}
    <div class="bar"><button class="ghost" id="pc">Close</button></div>`;
  d.showModal(); $('#pc').onclick = () => d.close();
  $('#np').onclick = async () => { if (!confirm('Archive the current project and start a blank one?')) return; const r = await api('project/new'); await refresh(); d.close(); tab = 'lyrics'; show(); toast(r.archived ? 'Archived as ' + r.archived : 'New project'); };
  d.onclick = async (e) => { const b = e.target.closest('[data-load]'); if (!b) return; const r = await api('project/load', { name: b.dataset.load }); await refresh(); d.close(); show(); toast('Loaded' + (r.archived ? ` (previous → ${r.archived})` : '')); };
};

refresh().then(show);
