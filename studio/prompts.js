// Prompts for lyrics, storyboard and scene generation.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

export function lyricsPrompt({ topic, style, seconds, tone, extra }) {
  seconds = Math.min(60, Math.max(10, seconds));
  const words = Math.round(seconds * 2.5);
  return [
    { role: 'system', content: `You write voiceover scripts ("lyrics") for short motion-graphics videos. Each script is read aloud by a text-to-speech voice (ElevenLabs) and every word is later animated on screen, so write for the ear AND the eye.

Rules:
- Split the script into LINES. One line = one short spoken phrase or sentence (3-20 words). Lines are shown and animated together, so each line should carry one clear idea or image.
- Total about ${words} words (~${seconds}s at a natural pace). Hit this within 10%.
- Strong hook in line 1, a clear build, a memorable last line.
- Prefer concrete, visual words (things that can be drawn or animated) over abstractions.
- Avoid digits, symbols and acronyms unless needed. If you use one, add it to "spoken" with its exact spoken form as an array of ALL-CAPS words, keyed by the token exactly as it appears in the line (including attached punctuation). Example: "5.5." -> ["FIVE","POINT","FIVE"], "MCP." -> ["EM","SEE","PEE"], "3D" -> ["THREE","DEE"], "→" -> ["TO"].
- Use only plain ASCII punctuation plus the characters … — ’ “ ”. No emojis, no stage directions, no markdown.
Reply as JSON: {"title": string, "lines": string[], "spoken": {token: string[]}}` },
    { role: 'user', content: `Topic: ${topic}\nStyle: ${style}\nTone: ${tone || 'engaging'}\nTarget length: ${seconds} seconds\n${extra ? 'Extra notes: ' + extra : ''}` },
  ];
}

export function storyboardPrompt({ title, lines, direction, seconds, format = 'wide' }) {
  const reel = format === 'reel';
  const list = lines.map((l) => `${l.i}\t${l.start.toFixed(2)}-${l.end.toFixed(2)}\t${l.text}`).join('\n');
  return [
    { role: 'system', content: `You are the art director of a procedural motion-graphics video. A voiceover is already recorded and aligned; you split it into PLATES (scenes), each a self-contained animated composition that runs on one or more consecutive lyric lines and cuts hard to the next.

The renderer draws everything with Canvas2D on a ${reel ? '1080x1920 VERTICAL (9:16 Instagram Reel / TikTok / Shorts)' : '1920x1080 (16:9)'} frame, then post (bloom, grain, vignette). House style: restrained palette — ink black background (#0A0A0B), bone white (#EEE9DF) text, ONE signal orange (#FF4D12) accent, graphite/ash greys; Archivo (display, can be wide/narrow), Cormorant serif, IBM Plex Mono; kinetic typography, hairline diagrams, graph paper, spark bursts, strokes that draw on, big type that slams in on its word. Plates should feel animated by the words: things appear exactly when their word is said.

Produce a storyboard:
- 3 to 8 plates (roughly one per 5-10 seconds; the video is at most 60 seconds). Plates cover every line, in order, with no gaps: plate 0 starts at line 0; each next plate's firstLine = previous lastLine + 1.
- "id": lowercase letters/digits/underscore, starts with a letter, unique, short (becomes a filename).
- "concept": 3-6 sentences. Describe the shots in order and tie each visual to specific words ("on 'graphics' the word slams in…"). Be concrete about layout, motion, and what changes color/scale/position. Avoid photos or 3D — only type, shapes, lines, diagrams, particles, grids. Keep it achievable in Canvas2D.
- ${reel ? '- The frame is VERTICAL and tall: stack type in short rows, use big type, centered/vertical compositions, vertical diagrams and scrolling/rising motion. Keep key content in the middle band (the top ~220px and bottom ~420px are covered by app UI). Hook hard in the first second.\n' : ''}- Vary the composition between plates (layout, scale, diagram vs type-only, camera push, light/dark via invert) while keeping the visual language consistent.
- "direction": 2-4 sentences of global art direction shared by all plates (recurring motif, how the accent is used, transitions).
Reply as JSON: {"title": string, "direction": string, "plates": [{"id": string, "title": string, "firstLine": number, "lastLine": number, "concept": string}]}` },
    { role: 'user', content: `Video title: ${title}\nDuration: ${seconds.toFixed(1)}s\n${direction ? 'User style notes: ' + direction + '\n' : ''}\nLines (index, time, text):\n${list}` },
  ];
}

let kitSrc, exampleSrc;
let exampleReel;
export function scenePrompt({ plate, board, lines, prevEnd, nextStart, window: win, errors, previous, review }) {
  kitSrc ??= read('app/src/scenes/_kit.ts');
  exampleSrc ??= read('app/src/scenes/_kit_example.ts');
  exampleReel ??= read('app/src/scenes/_kit_example_reel.ts');
  const reel = board.format === 'reel';
  const FW = reel ? 1080 : 1920, FH = reel ? 1920 : 1080;
  const wordsTable = lines.map((l) => `LINE ${l.i} (${l.start.toFixed(2)}s–${l.end.toFixed(2)}s): ${l.text}\n` + l.words.map((w) => `  ${JSON.stringify(w.w)} ${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join('\n')).join('\n');
  const sys = `You write one plate (scene) of a procedural motion-graphics video as a single TypeScript file. The plate is a pure function of time, drawn with Canvas2D on a ${FW}x${FH} ${reel ? 'VERTICAL (9:16 reel)' : 'wide (16:9)'} frame and synced to the exact word timings of a voiceover.

## The toolkit — scenes/_kit.ts (read it carefully; this is the entire API)
\`\`\`ts
${kitSrc}
\`\`\`

## A complete example plate${reel ? ' (vertical 1080x1920 reel)' : ''}
\`\`\`ts
${reel ? exampleReel : exampleSrc}
\`\`\`

## Hard rules
1. The file's only import is \`from './_kit'\` (it re-exports ease, prog, lerp, clamp, pulse, hash, noise1, noise2, TAU, springStep, window01, smoothstep, rgba, PAL, W, H, KitScene, Kit and the types C2, Box, TextOpts). Nothing else.
2. \`export default class <Name> extends KitScene\` implementing \`setup(k)\` and \`draw(c, k)\`. Use the \`override\` keyword on optional hooks \`background\` and \`post\` (the project has noImplicitOverride).
3. draw() must be a pure function of k.t / k.lt / k.p. No Math.random (use hash(i, seed) / noise1 / noise2), no Date, no accumulating state, no mutation that depends on frame order. The renderer seeks randomly.
4. Look words up with k.word('text', nth) in setup() or draw(); text matches case/punctuation-insensitively (e.g. k.word('Effects?') = k.word('effects')). k.word throws if the word is not in this plate — only look up words listed below. Drive animation with k.reveal(w), k.hit(w), k.said(w), k.active(w), or prog(k.t, a, b, ease.xxx) using the timings below.
5. Everything the viewer must read (the spoken words that carry the idea) must appear on screen at or just before the moment it is spoken, stay legible (min ~44px for body text, strong contrast), stay inside a ${reel ? 'safe area of x 90..990 and y 260..1480 (reel UI covers the top ~220px and bottom ~420px; nothing important outside it)' : '120px safe margin'}, and not overlap other text. Use k.flow()/k.measure() to fit text to width; never guess widths for long text.
6. Each plate must be visually rich and animated the whole time (never a static frame for >1s): continuous subtle motion (drifting grid, breathing scale, slow camera push via c.translate/scale around the centre) plus decisive hits on key words (slam, wipe, draw-on, burst, shake, zoom punch via post()).
7. Draw order: background → grid/diagram → type → fx (burst) on top. Use c.save()/c.restore() around transforms. Alpha via c.globalAlpha. Keep per-frame work light (<3000 path segments).
${reel ? '8a. VERTICAL layout: the frame is 1080 wide and 1920 tall. Stack text in short rows (use k.flow with maxWidth <= 900), make type big (headline 110-260px, body >= 64px), use the full height with vertical motion (rising, dropping, scrolling), and never lay out side-by-side columns wider than the frame. Use k.W/k.H/k.cx/k.cy instead of 1920/1080.\n' : ''}8. Palette: PAL.ink/ink2/graphite/ash/bone/signal/ember/blood/acid; signal orange is the single accent. Fonts only via the kit's fam: 'display' | 'wide' | 'narrow' | 'serif' | 'serif-italic' | 'mono', weights 300/500/700/900.
9. The plate begins at its first line with the previous plate hard-cutting out: the first frame should already look composed (not empty) — start with grid/ink and an early reveal. End holding a composed frame; do not fade to black.
10. Output ONLY the full TypeScript file in one \`\`\`ts code block. No commentary. Start the file with a 3-6 line comment describing the shots.`;
  const user = `## Global art direction
${board.direction || '(none)'}

## This plate: "${plate.id}" — ${plate.title ?? ''}
Window: ${win.start.toFixed(2)}s–${win.end.toFixed(2)}s (duration ${(win.end - win.start).toFixed(2)}s). Local time k.lt runs from 0.
Concept (follow it, adapt where the timings demand):
${plate.concept}

## Words in this plate (the ONLY words k.word() can find), with timings in song seconds
${wordsTable}
${prevEnd ? `\nPrevious plate ends with: "${prevEnd}"` : ''}${nextStart ? `\nNext plate begins with: "${nextStart}"` : ''}
${previous ? `\n## Your previous attempt\n\`\`\`ts\n${previous}\n\`\`\`\n` : ''}${errors ? `\n## It failed. Fix these problems and return the complete corrected file:\n${errors}\n` : ''}${review ? `\n## Visual review of your previous attempt (stills at 15%, 50%, 90% of the plate)\n${review}\nFix every issue listed and return the complete corrected file.\n` : ''}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

export function reviewPrompt({ plate, images }) {
  return [
    { role: 'system', content: 'You are a strict motion-design reviewer checking rendered stills of one plate of a 1920x1080 explainer video (dark ink background, bone text, orange accent). Look for concrete defects only: text clipped by the frame edge, text overlapping other text or shapes, illegible/low-contrast text, text too small to read, an empty or mostly blank frame, elements badly off-center or unbalanced, ugly layout. Reply as JSON: {"ok": boolean, "issues": string[]}. ok=true if there are no serious defects (minor taste issues are not defects). Each issue must be specific and actionable (mention which still: 1=early, 2=middle, 3=late).' },
    { role: 'user', content: [{ type: 'text', text: `Plate "${plate.id}": ${plate.concept}\nThree stills follow (early, middle, late).` }, ...images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }))] },
  ];
}

/** ElevenLabs-ready text: spoken forms substituted, optional SSML breaks. */
export function elevenText(lines, spoken = {}, { breaks = 'ssml', breakSec = 0.5 } = {}) {
  const sp = {};
  for (const [k, v] of Object.entries(spoken)) sp[k] = v;
  const lineOut = lines.map((line) => line.split(/\s+/).filter(Boolean).map((w) => {
    if (!(w in sp)) return w;
    const v = sp[w].map((x) => x.toLowerCase()).join(' ');
    const tail = (w.match(/[.,;:!?…”"’']+$/) ?? [''])[0];
    return v ? v + (/[.,;:!?…]/.test(tail) ? tail.replace(/[”"’']/g, '') : '') : '';
  }).filter(Boolean).join(' '));
  if (breaks === 'ssml') return lineOut.map((l, i) => (i < lineOut.length - 1 ? `${l} <break time="${breakSec}s" />` : l)).join('\n');
  if (breaks === 'paragraph') return lineOut.join('\n\n');
  return lineOut.join('\n');
}

/** Review prompt for engines that read image files by path (Claude Code). */
export function reviewPromptPaths({ plate, paths }) {
  const m = reviewPrompt({ plate, images: [] });
  m[1].content = `Plate "${plate.id}": ${plate.concept}\nUse the Read tool to view these three stills (early, middle, late):\n${paths.join('\n')}\nThen reply with ONLY the JSON object.`;
  return m;
}

const STYLES = ['explainer narration', 'punchy hype / trailer', 'poetic / spoken word', 'rhymed song lyrics', 'calm documentary'];

export function plannerPrompt({ niche, audience, notes, count, avoid }) {
  return [
    { role: 'system', content: `You are a content strategist for short vertical videos (YouTube Shorts / Instagram Reels, max 60 seconds). The videos are voiceover-driven motion graphics: kinetic typography, diagrams, particles — no footage, no people.

Suggest ${count} DIFFERENT video ideas that fit the channel. Favour topics with a strong curiosity hook, a clear one-idea payoff, and visuals that can be drawn as shapes/type/diagrams. Mix angles (myth-busting, scale comparisons, "what if", how it works, counter-intuitive facts). Do not repeat or lightly reword any topic in the avoid list. Be honest: only propose topics where the facts are well established.

For each idea fill EVERY field:
- "title": working title (<= 60 chars)
- "hook": the exact first spoken line (<= 14 words) that stops the scroll
- "why": one sentence on why it should perform
- "topic": 1-3 sentences telling the scriptwriter what the video covers and its payoff
- "style": exactly one of ${JSON.stringify(STYLES)}
- "tone": 2-4 words
- "seconds": integer 20-60
- "extra": script notes (must-mention facts, things to avoid, the ending beat)
- "artDirection": 2-3 sentences of art direction for the storyboard (recurring motif, how the orange accent is used, composition ideas for a tall 9:16 frame)
Reply as JSON: {"ideas":[{...}]}` },
    { role: 'user', content: `Channel / niche: ${niche || 'general science and curiosity'}
Audience: ${audience || 'curious general viewers'}
${notes ? 'Notes: ' + notes + '\n' : ''}Avoid these existing topics:\n${avoid.length ? avoid.map((a) => '- ' + a).join('\n') : '(none)'}` },
  ];
}

export function publishPrompt({ title, lines, channel, language, cta, extra }) {
  return [
    { role: 'system', content: `You write YouTube Shorts metadata that is accurate to the video and optimised for search and browse. Rules:
- "titles": 5 options, each <= 60 characters, specific and curiosity-driven, no clickbait that the video does not deliver, no ALL CAPS shouting, at most one emoji. Put the strongest keyword early.
- "description": plain text. Line 1-2 = the hook and a clear summary (these show before "more"). Then 1-2 short lines of context or a question to drive comments. Then${cta ? ' this call to action: "' + cta + '". Then' : ''} 3-5 hashtags on the last line, the first being #Shorts. Under 900 characters total.
- "tags": 12-15 search tags (no # symbol, mix of broad and long-tail), total length <= 450 characters.
- "hashtags": the 3-5 hashtags used in the description.
- "pinnedComment": one engaging question or fact to pin as the first comment.
- "thumbnailText": 2-4 words for a cover frame.
Write in ${language || 'English'}. Reply as JSON: {"titles":[], "description":"", "tags":[], "hashtags":[], "pinnedComment":"", "thumbnailText":""}` },
    { role: 'user', content: `Working title: ${title}\nChannel / niche: ${channel || 'n/a'}\n${extra ? 'Notes: ' + extra + '\n' : ''}Voiceover script:\n${lines.join('\n')}` },
  ];
}
