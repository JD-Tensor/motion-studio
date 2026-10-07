// The edit: which plate plays when. A voiceover has no beat grid, so every cut sits in the pause
// before a line: just before its first word (never after it), anchored to the aligned script
// (data/lyrics.json). The plates come from data/storyboard.json (written by the studio):
//   { plates: [{ id, file?, firstLine, lastLine? }] }  — a plate runs from the cut before its first line to the next plate's cut.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

interface Plate { id: string; file?: string; firstLine: number; lastLine?: number; caption?: { fig: string; text: string } }
const boards = import.meta.glob<{ plates: Plate[] }>('../../data/storyboard.json', { eager: true, import: 'default' });
const plates: Plate[] = Object.values(boards)[0]?.plates ?? [];

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  /** Cut in the pause before line i: 0.18 s before its first word (less if the pause is short). */
  const cut = (i: number) => {
    const l = ly.lines[Math.min(i, ly.lines.length - 1)]!;
    const prev = ly.lines[l.i - 1];
    const gap = prev ? l.start - prev.end : 1;
    return l.start - Math.min(0.18, Math.max(0.04, gap * 0.45));
  };
  return plates.map((p, n) => {
    const next = plates[n + 1];
    const start = n === 0 ? 0 : cut(p.firstLine);
    const end = next ? cut(next.firstLine) : au.duration;
    const lastLine = p.lastLine ?? (next ? Math.max(p.firstLine, next.firstLine - 1) : ly.lines.length - 1);
    return { id: p.id, load: scene(p.file ?? p.id), start, end, caption: p.caption, params: { firstLine: p.firstLine, lastLine } } as TimelineEntry;
  });
}
