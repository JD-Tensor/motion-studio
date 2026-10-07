// EXAMPLE REEL PLATE (1080x1920, 9:16) — a reference for generated vertical plates.
// Lines: "What if I told you… you can create motion graphics like this without even opening After Effects?"
// Shot A: the question stacks up word by word in the upper-middle. Shot B: on "motion graphics" two giant
// words slam in one under the other over a drawn curve; a spark burst lands on "create". Shot C: on
// "After Effects?" a timeline strip slides down from the top and is struck out.
// Vertical layout rules used here: content stays inside x 90..990 and y 260..1480 (the reel UI covers the
// top ~220px and the bottom ~420px), type is stacked in short rows and big.
import { KitScene, Kit, type C2, type Box, PAL, ease, prog, lerp, clamp, rgba } from './_kit';

export default class ExampleReel extends KitScene {
  q!: Box[];
  big: { word: string; w: any; y: number }[] = [];
  curve: [number, number][] = [];

  setup(k: Kit) {
    const L = k.line(0);
    // flow wraps to maxWidth, so a long line becomes a tall stack of rows
    this.q = k.flow(L.words.slice(0, 5), { x: 90, y: 520, size: 120, maxWidth: 900, fam: 'display', weight: 700, upper: true, lead: 1.1 });
    this.big = [{ word: 'MOTION', w: k.word('motion'), y: 820 }, { word: 'GRAPHICS', w: k.word('graphics'), y: 1060 }];
    for (let i = 0; i <= 40; i++) this.curve.push([90 + (i / 40) * 900, 1380 - ease.inOutCubic(i / 40) * 200]);
  }

  override background(k: Kit) { return PAL.ink; }

  draw(c: C2, k: Kit) {
    const t = k.t;
    k.grid(54, 0.05);

    const fadeA = 1 - prog(t, k.word('create').start - 0.1, k.word('create').start + 0.25);
    if (fadeA > 0) {
      for (const b of this.q) {
        const u = k.reveal(b.w, 0.3);
        if (u > 0) k.text(b.text, b.x, b.y + (1 - u) * 40, { size: b.size, weight: 700, color: k.active(b.w) ? PAL.signal : PAL.bone, alpha: u * fadeA });
      }
    }

    // two big words: size chosen so the widest ('GRAPHICS') fits the 900px column
    const size = 900 / k.measure('GRAPHICS', { size: 100, fam: 'wide', weight: 900 }) * 100;
    for (const g of this.big) {
      const u = k.reveal(g.w, 0.5, ease.outBack);
      if (u <= 0) continue;
      k.text(g.word, 90, g.y, { size, fam: 'wide', weight: 900, color: PAL.bone, alpha: clamp(u * 3), scale: lerp(1.2, 1, clamp(u)) });
    }
    k.polyline(this.curve, prog(t, k.word('graphics').start, k.word('graphics').end + 0.3, ease.inOutQuad), { color: PAL.signal, width: 5 });
    k.burst(k.cx, 700, k.word('create').start, { n: 48, speed: 700 });

    const wf = k.word('Effects?');
    const slide = prog(t, wf.start - 0.5, wf.start, ease.outExpo);
    if (slide > 0) {
      const y0 = 260 - (1 - slide) * 200;
      c.save();
      c.globalAlpha = slide;
      c.fillStyle = PAL.ink2;
      c.fillRect(90, y0, 900, 150);
      for (let i = 0; i < 6; i++) { c.fillStyle = rgba('ash', 0.6); c.fillRect(120 + i * 140, y0 + 50, 100, 18); }
      c.restore();
      k.polyline([[70, y0 + 75], [1010, y0 + 75]], prog(t, wf.start, wf.start + 0.25, ease.outExpo), { color: PAL.signal, width: 9 });
    }
  }

  override post(k: Kit) {
    const z = 0.02 * (k.hit(k.word('motion'), 0.1) + k.hit(k.word('graphics'), 0.1));
    return { zoom: 1 + z, bloom: 0.7 };
  }
}
