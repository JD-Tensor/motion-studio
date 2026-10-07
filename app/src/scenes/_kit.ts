// KIT — the simple scene toolkit used by generated plates (studio). A plate extends KitScene and
// implements setup() (find words, precompute) and draw() (one Canvas2D frame, a pure function of k.t).
// Drawing space is k.W x k.H logical px (1920x1080 'wide' or 1080x1920 'reel'), origin top-left. Everything must be deterministic in time.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba, HEX } from '../engine/palette';
import { F, font } from '../engine/type';
import { Lyrics, norm, type Line, type Word } from '../engine/lyrics';
import { clamp, ease, lerp, prog, pulse, hash, noise1, noise2, TAU, springStep, window01, smoothstep } from '../engine/util';

export type C2 = CanvasRenderingContext2D;
export type FontKind = 'display' | 'wide' | 'narrow' | 'serif' | 'serif-italic' | 'mono';
export interface TextOpts {
  size?: number; fam?: FontKind; weight?: number; color?: string; alpha?: number;
  align?: CanvasTextAlign; baseline?: CanvasTextBaseline; tracking?: number; scale?: number; rot?: number;
}
export interface Box { w: Word; text: string; x: number; y: number; width: number; size: number; line: number }
export interface FlowOpts { x: number; y: number; size: number; maxWidth?: number; fam?: FontKind; weight?: number; align?: 'left' | 'center' | 'right'; lead?: number; tracking?: number; upper?: boolean }

export { ease, lerp, clamp, prog, pulse, hash, noise1, noise2, TAU, springStep, window01, smoothstep, rgba, HEX, W, H };

/** The palette as CSS colours: ink, ink2, graphite, ash, bone, signal, ember, blood, acid. */
export const PAL = HEX;

function famName(kind: FontKind, weight: number): string {
  switch (kind) {
    case 'wide': return F.archivo(125, weight);
    case 'narrow': return F.archivo(62, weight);
    case 'serif': return F.serif(weight);
    case 'serif-italic': return F.serif(weight, true);
    case 'mono': return F.mono(weight);
    default: return F.archivo(100, weight);
  }
}

export class Kit {
  /** Song time (s), local time since this plate started, and 0..1 progress through the plate. */
  t = 0; lt = 0; p = 0;
  readonly W = W; readonly H = H; readonly cx = W / 2; readonly cy = H / 2;
  /** Plate window in song seconds. */
  readonly start: number; readonly end: number;
  /** The lyric lines (and their words) that this plate covers. */
  readonly lines: Line[]; readonly words: Word[];
  /** Audio features at t: rms, vocal, low, mid, high (0..1). */
  a: Frame['a'];
  frame!: Frame;
  constructor(public ctx2: C2, readonly sceneCtx: { lyrics: Lyrics; start: number; end: number }, lines: Line[]) {
    this.start = sceneCtx.start; this.end = sceneCtx.end;
    this.lines = lines; this.words = lines.flatMap((l) => l.words);
    this.a = undefined as any;
  }

  // ---------- words ----------
  /** The nth word of this plate whose text matches q (case/punctuation-insensitive). Throws if missing. */
  word(q: string, nth = 0): Word {
    const n = norm(q);
    const hit = this.words.filter((w) => norm(w.w) === n)[nth];
    if (!hit) throw new Error(`word not found in plate: "${q}" #${nth}`);
    return hit;
  }
  /** Like word() but returns undefined instead of throwing. */
  tryWord(q: string, nth = 0): Word | undefined { try { return this.word(q, nth); } catch { return undefined; } }
  line(i = 0): Line { const l = this.lines[i]; if (!l) throw new Error(`line ${i} not in plate`); return l; }
  /** 0 before the word is said, 1 after, linear while it is said. */
  said(w: Word) { return Lyrics.wordProgress(w, this.t); }
  /** Eased 0..1 reveal starting when the word starts. */
  reveal(w: Word, dur = 0.35, fn: (t: number) => number = ease.outExpo) { return prog(this.t, w.start, w.start + dur, fn); }
  /** 1 at the word's start, decaying to 0 (hit pulse). */
  hit(w: Word, halfLife = 0.12) { return pulse(this.t, w.start, halfLife); }
  /** The word being said right now (or the last one said), within this plate. */
  current(): Word | null { let b: Word | null = null; for (const w of this.words) if (w.start <= this.t) b = w; return b; }
  /** True while w is being said. */
  active(w: Word) { return this.t >= w.start && this.t < w.end; }

  // ---------- text ----------
  setFont(o: TextOpts = {}) {
    const c = this.ctx2;
    c.font = font(famName(o.fam ?? 'display', o.weight ?? 700), o.size ?? 64);
    (c as any).letterSpacing = `${o.tracking ?? 0}px`;
    c.textAlign = o.align ?? 'left';
    c.textBaseline = o.baseline ?? 'alphabetic';
  }
  measure(s: string, o: TextOpts = {}) { this.setFont(o); return this.ctx2.measureText(s).width; }
  /** Draw text at (x, y) (baseline). Returns its width. */
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const c = this.ctx2;
    c.save();
    c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    if (o.scale !== undefined && o.scale !== 1) c.scale(o.scale, o.scale);
    this.setFont(o);
    c.globalAlpha = clamp(o.alpha ?? 1);
    c.fillStyle = o.color ?? HEX.bone;
    c.fillText(s, 0, 0);
    const w = c.measureText(s).width;
    c.restore();
    return w;
  }
  /** Lay out words (wrapping at maxWidth) without drawing; use the boxes to place things on specific words. */
  flow(words: Word[], o: FlowOpts): Box[] {
    const to: TextOpts = { size: o.size, fam: o.fam, weight: o.weight, tracking: o.tracking };
    this.setFont(to);
    const c = this.ctx2, sp = c.measureText(' ').width + (o.tracking ?? 0);
    const rows: { b: Box[]; width: number }[] = [{ b: [], width: 0 }];
    const maxW = o.maxWidth ?? 1e9;
    for (const w of words) {
      const text = o.upper ? w.w.toUpperCase() : w.w;
      const width = c.measureText(text).width;
      let r = rows[rows.length - 1]!;
      if (r.b.length && r.width + sp + width > maxW) { r = { b: [], width: 0 }; rows.push(r); }
      r.b.push({ w, text, x: r.width + (r.b.length ? sp : 0), y: 0, width, size: o.size, line: rows.length - 1 });
      r.width += width + (r.b.length > 1 ? sp : 0);
    }
    const lead = (o.lead ?? 1.15) * o.size, out: Box[] = [];
    rows.forEach((r, ri) => {
      const off = o.align === 'center' ? -r.width / 2 : o.align === 'right' ? -r.width : 0;
      for (const b of r.b) out.push({ ...b, x: o.x + off + b.x, y: o.y + ri * lead });
    });
    return out;
  }
  /** Karaoke: draw laid-out words, dim before they are said, `hot` while said, `done` after. */
  karaoke(boxes: Box[], o: { fam?: FontKind; weight?: number; tracking?: number; dim?: string; hot?: string; done?: string; alpha?: number; lift?: number } = {}) {
    for (const b of boxes) {
      const sp = this.said(b.w);
      const col = sp <= 0 ? (o.dim ?? HEX.graphite) : this.active(b.w) ? (o.hot ?? HEX.signal) : (o.done ?? HEX.bone);
      const lift = (o.lift ?? 0) * (1 - ease.outCubic(prog(this.t, b.w.start - 0.05, b.w.start + 0.25)));
      this.text(b.text, b.x, b.y + lift, { size: b.size, fam: o.fam, weight: o.weight, tracking: o.tracking, color: col, alpha: o.alpha });
    }
  }

  // ---------- shapes & fx ----------
  /** Hairline grid ("graph paper") across the frame. */
  grid(step = 48, alpha = 0.08, col = HEX.bone) {
    const c = this.ctx2;
    c.save(); c.strokeStyle = col; c.globalAlpha = alpha; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= W; x += step) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += step) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke(); c.restore();
  }
  /** Stroke a polyline progressively: `u` in 0..1 is how much of it is drawn. */
  polyline(pts: [number, number][], u: number, o: { color?: string; width?: number; alpha?: number } = {}) {
    if (u <= 0 || pts.length < 2) return;
    const c = this.ctx2;
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const target = L[L.length - 1]! * clamp(u);
    c.save(); c.strokeStyle = o.color ?? HEX.bone; c.lineWidth = o.width ?? 2; c.globalAlpha = o.alpha ?? 1; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      if (L[i]! <= target) c.lineTo(pts[i]![0], pts[i]![1]);
      else { const k = (target - L[i - 1]!) / Math.max(1e-6, L[i]! - L[i - 1]!); c.lineTo(lerp(pts[i - 1]![0], pts[i]![0], k), lerp(pts[i - 1]![1], pts[i]![1], k)); break; }
    }
    c.stroke(); c.restore();
  }
  /** Deterministic burst of sparks starting at t0 from (x, y). */
  burst(x: number, y: number, t0: number, o: { n?: number; speed?: number; life?: number; color?: string; seed?: number; size?: number; gravity?: number } = {}) {
    const age = this.t - t0, life = o.life ?? 0.9;
    if (age < 0 || age > life) return;
    const c = this.ctx2, n = o.n ?? 36;
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = o.color ?? HEX.signal;
    for (let i = 0; i < n; i++) {
      const a = hash(i, o.seed ?? 1, 11) * TAU, v = (0.35 + hash(i, o.seed ?? 1, 12)) * (o.speed ?? 700);
      const d = v * (1 - Math.pow(1 - age / life, 2)) * 0.5;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d + (o.gravity ?? 0) * age * age * 200;
      c.globalAlpha = (1 - age / life) * 0.9;
      c.beginPath(); c.arc(px, py, (o.size ?? 3) * (1 - age / life) + 0.5, 0, TAU); c.fill();
    }
    c.restore();
  }
  /** Small deterministic screen-shake offset. */
  shake(amount: number, freq = 45): [number, number] { return [amount * noise1(this.t * freq, 3), amount * noise1(this.t * freq * 1.13, 4)]; }
}

export abstract class KitScene extends Scene {
  ui = new Layer2D();
  kit!: Kit;

  override init() {
    const p = this.ctx.params as { firstLine?: number; lastLine?: number };
    const ly = this.ctx.lyrics;
    const a = p.firstLine ?? ly.lyricsLineAt(this.ctx.start), b = p.lastLine ?? a;
    this.kit = new Kit(this.ui.ctx, { lyrics: ly, start: this.ctx.start, end: this.ctx.end }, ly.lines.slice(a, b + 1));
    this.setup(this.kit);
  }

  /** Find words, precompute geometry. Called once. */
  abstract setup(k: Kit): void;
  /** Draw one frame onto the k.W x k.H canvas c. The background is already cleared to `background()`. */
  abstract draw(c: C2, k: Kit): void;
  /** Background colour (CSS). Default ink black. */
  background(_k: Kit): string { return HEX.ink; }
  /** Optional post-processing overrides for this frame (bloom, vignette, grain, zoom, shake, ca, flash, fade, invert...). */
  post(_k: Kit): PostOverrides { return {}; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const k = this.kit;
    k.t = f.t; k.lt = f.lt; k.p = f.p; k.a = f.a; k.frame = f;
    clearRT(renderer, out, LIN.ink, 1);
    const U = this.ui;
    U.clear(this.background(k));
    k.ctx2.save();
    this.draw(k.ctx2, k);
    k.ctx2.restore();
    comp.draw(renderer, U.upload(), out);
    return { bloom: 0.6, bloomThreshold: 0.85, vignette: 0.4, grain: 0.05, ...this.post(k) };
  }
}
