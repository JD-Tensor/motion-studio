import { test, expect } from 'bun:test';
import { elevenText, lyricsPrompt, scenePrompt, plannerPrompt } from '../prompts.js';

test('elevenText respells symbols using the pronunciation map and adds pauses', () => {
  const t = elevenText(['This is Claude Opus 5.5.', 'Not an MCP.'], { '5.5.': ['FIVE', 'POINT', 'FIVE'], 'MCP.': ['EM', 'SEE', 'PEE'] }, { breaks: 'ssml', breakSec: 0.5 });
  expect(t).toBe('This is Claude Opus five point five. <break time="0.5s" />\nNot an em see pee.');
});
test('elevenText paragraph/none modes', () => {
  expect(elevenText(['a', 'b'], {}, { breaks: 'paragraph' })).toBe('a\n\nb');
  expect(elevenText(['a', 'b'], {}, { breaks: 'none' })).toBe('a\nb');
});
test('lyrics length is clamped to 60 seconds', () => {
  const m = lyricsPrompt({ topic: 't', style: 's', seconds: 300 });
  expect(m[1].content).toContain('Target length: 60 seconds');
  expect(m[0].content).toMatch(/~60s/);
});
test('scene prompt is orientation-aware', () => {
  const base = { plate: { id: 'a', concept: 'c' }, lines: [{ i: 0, start: 0, end: 1, text: 't', words: [{ w: 't', start: 0, end: 1 }] }], window: { start: 0, end: 1 } };
  expect(scenePrompt({ ...base, board: { format: 'reel' } })[0].content).toContain('1080x1920');
  expect(scenePrompt({ ...base, board: { format: 'wide' } })[0].content).toContain('1920x1080');
});
test('planner prompt lists the avoid list', () => {
  expect(plannerPrompt({ niche: 'n', audience: 'a', notes: '', count: 3, avoid: ['Black holes'] })[1].content).toContain('- Black holes');
});
