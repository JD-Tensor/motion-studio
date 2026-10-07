// EXAMPLE PLATE — a reference for generated plates (the studio shows it to the model).
// Lines: "What if I told you… you can create motion graphics like this without even opening After Effects?"
// Shot A: the question types in word by word. Shot B: on "motion graphics" two giant words slam in over a
// drawn curve; a spark burst lands on "create". Shot C: on "After Effects?" a timeline strip slides in and
// is struck out with a signal-orange line.
import { KitScene, Kit, type C2, type Box, PAL, ease, prog, lerp, clamp, rgba } from './_kit';

export default class Example extends KitScene {
  q!: Box[];
  big: { word: string; w: any; y: number }[] = [];
  curve: [number, number][] = [];

  setup(k: Kit) {
    // 1. look up the words this plate animates on (by text, nth occurrence for repeats)
    const L = k.line(0);
    // 2. precompute layout once (flow wraps text and returns a box per word)
    this.q = k.flow(L.words.slice(0, 5), { x: 160, y: 300, size: 110, maxWidth: 1600, fam: 'display', weight: 700, upper: true });
    this.big = [{ word: 'MOTION', w: k.word('motion'), y: 560 }, { word: 'GRAPHICS', w: k.word('graphics'), y: 800 }];
    for (let i = 0; i <= 40; i++) this.curve.push([160 + (i / 40) * 1600, 960 - ease.inOutCubic(i / 40) * 260]);
  }

  override background(k: Kit) { return PAL.ink; }

  draw(c: C2, k: Kit) {
    const t = k.t;
    k.grid(48, 0.05);

    // Shot A: the question (hidden once "create" is said)
    const fadeA = 1 - prog(t, k.word('create').start - 0.1, k.word('create').start + 0.25);
    if (fadeA > 0) {
      for (const b of this.q) {
        const u = k.reveal(b.w, 0.3);
        if (u > 0) k.text(b.text, b.x, b.y + (1 - u) * 40, { size: b.size, weight: 700, color: k.active(b.w) ? PAL.signal : PAL.bone, alpha: u * fadeA });
      }
    }

    // Shot B: two big words slam in, each on its own word
    for (const g of this.big) {
      const u = k.reveal(g.w, 0.5, ease.outBack);
      if (u <= 0) continue;
      const s = lerp(1.25, 1, clamp(u));
      k.text(g.word, 160, g.y, { size: 230, fam: 'wide', weight: 900, color: PAL.bone, alpha: clamp(u * 3), scale: s });
    }
    k.polyline(this.curve, prog(t, k.word('graphics').start, k.word('graphics').end + 0.3, ease.inOutQuad), { color: PAL.signal, width: 4 });
    k.burst(160, 540, k.word('create').start, { n: 48, speed: 900 });

    // Shot C: a timeline strip slides in, then is struck out
    const wf = k.word('Effects?');
    const slide = prog(t, wf.start - 0.5, wf.start, ease.outExpo);
    if (slide > 0) {
      c.save();
      c.globalAlpha = slide;
      c.fillStyle = PAL.ink2;
      c.fillRect(160, 40 + (1 - slide) * -120, 1600, 110);
      for (let i = 0; i < 12; i++) { c.fillStyle = rgba('ash', 0.6); c.fillRect(190 + i * 130, 72 + (1 - slide) * -120, 90, 14); }
      c.restore();
      k.polyline([[140, 95], [1780, 95]], prog(t, wf.start, wf.start + 0.25, ease.outExpo), { color: PAL.signal, width: 8 });
    }
  }

  override post(k: Kit) {
    // punch-in on each hit of the two big words
    const z = 0.02 * (k.hit(k.word('motion'), 0.1) + k.hit(k.word('graphics'), 0.1));
    return { zoom: 1 + z, bloom: 0.7 };
  }
}
