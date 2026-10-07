# Writing scenes

Claude Code writes scenes for you, but you can also write or edit them by hand (Scenes tab → *Edit code*, or any editor — the preview hot-reloads).

A scene is one TypeScript file in `app/src/scenes/` that extends `KitScene` from `./_kit` and is a **pure function of time**: given `k.t` it must draw the same frame every time, because the renderer seeks and re-samples frames out of order (motion blur renders several sub-frames per frame).

```ts
import { KitScene, Kit, type C2, PAL, ease, prog } from './_kit';

export default class Hello extends KitScene {
  setup(k: Kit) { /* look up words, precompute layout (runs once) */ }

  override background(k: Kit) { return PAL.ink; }

  draw(c: C2, k: Kit) {
    const w = k.word('moon');                   // a word in this plate, by text
    const u = k.reveal(w, 0.4, ease.outExpo);   // 0 → 1 when the word is said
    k.text('MOON', k.cx - 300, k.cy, { size: 220, fam: 'wide', weight: 900, alpha: u });
    k.burst(k.cx, k.cy, w.start);               // deterministic spark burst
  }

  override post(k: Kit) { return { zoom: 1 + 0.02 * k.hit(k.word('moon')) }; }
}
```

## The kit API (`app/src/scenes/_kit.ts`)

- **Time and words**: `k.t`, `k.lt` (time since the plate began), `k.p` (0–1 progress), `k.word(text, nth)`, `k.line(i)`, `k.said(w)`, `k.reveal(w, dur, ease)`, `k.hit(w)`, `k.active(w)`, `k.current()`.
- **Layout and text**: `k.W`, `k.H`, `k.cx`, `k.cy`, `k.text()`, `k.measure()`, `k.flow()` (wrap words into boxes), `k.karaoke()`.
- **Drawing helpers**: `k.grid()`, `k.polyline()` (draw-on strokes), `k.burst()`, `k.shake()`.
- **Re-exports**: `ease`, `prog`, `lerp`, `clamp`, `pulse`, `hash`, `noise1`, `noise2`, `springStep`, `PAL` (palette), `rgba`.
- **Post-processing** from `post()`: `bloom`, `vignette`, `grain`, `zoom`, `shake`, `ca`, `flash`, `fade`, `invert`.

## Rules the generator follows (and you should too)

1. Import only from `./_kit`.
2. No `Math.random`, `Date`, or state that accumulates between frames — use `hash(i, seed)` / `noise1`.
3. Use `override` on `background` and `post` (the project uses `noImplicitOverride`).
4. Look words up with `k.word`; it throws if the word is not in the plate, which the generator treats as an error to fix.
5. For 9:16, keep important content inside roughly x 90–990 and y 260–1480 — the reel UI covers the top ~220 px and bottom ~420 px. Use `k.W`/`k.H` instead of hard-coded sizes.

Reference plates: `app/src/scenes/_kit_example.ts` (16:9) and `_kit_example_reel.ts` (9:16). These are also given to the model as examples.

## Hand-built scenes

The engine underneath (`app/src/engine/`, `app/src/scenes/_vo.ts`, `_motifs.ts`) is the full three.js renderer from pdoom-video: GLSL passes, stroke fonts, a plotter pen. You can write scenes directly against it for custom shader effects; the generated kit scenes are a thin Canvas2D layer on top.
