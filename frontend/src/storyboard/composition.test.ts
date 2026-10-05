import { describe, expect, it } from 'vitest';
import { buildComposition, cameraMove, figureBox, parseStoryboard, type Storyboard } from './composition';

const shot = (over = {}) => ({ description: 'Dhruv at the stall', magnification: 'MCU', movement: 'Static', lens: '50', angle: 'Eye level', position: '2 m in front', lighting: 'Sodium key', notes: '', audio: "VO: 'Shaam ke 7 baj rahe the.'", duration: 4, ...over });
const board = (over = {}): Storyboard => ({ title: 'Red Balloon', aspect: '16:9', scenes: [{ heading: 'Scene 1 - MELA', lighting: 'Night', shots: [shot(), shot({ duration: 6 })] }], ...over });

describe('parseStoryboard', () => {
  it('keeps a valid storyboard and drops unknown fields', () => {
    const parsed = parseStoryboard({ ...board(), extra: 'x' });
    expect(parsed.scenes[0].shots[1].duration).toBe(6);
    expect(parsed).not.toHaveProperty('extra');
  });
  it('rejects bad aspect, durations, missing fields and overlong films', () => {
    expect(() => parseStoryboard(board({ aspect: '4:3' }))).toThrow(/aspect/);
    expect(() => parseStoryboard(board({ scenes: [{ heading: 'S', lighting: 'L', shots: [shot({ duration: 2.5 })] }] }))).toThrow(/duration/);
    expect(() => parseStoryboard(board({ scenes: [{ heading: 'S', lighting: 'L', shots: [{ ...shot(), lens: 50 }] }] }))).toThrow(/lens/);
    expect(() => parseStoryboard(board({ scenes: Array.from({ length: 16 }, () => ({ heading: 'S', lighting: 'L', shots: [shot({ duration: 120 })] })) }))).toThrow(/minutes/);
    expect(() => parseStoryboard(null)).toThrow();
  });
});

describe('buildComposition', () => {
  it('times clips back to back and sets the root duration and canvas', () => {
    const html = buildComposition(board({ aspect: '9:16' }));
    expect(html).toContain('data-duration="10" data-width="1080" data-height="1920"');
    expect(html).toContain('id="s2" data-start="4" data-duration="6"');
    expect(html).toContain('window.__timelines["storyboard"]');
  });
  it('escapes script text so it cannot break out of the page', () => {
    const html = buildComposition(board({ title: '</title><script>alert(1)</script>', scenes: [{ heading: 'S', lighting: 'L', shots: [shot({ description: '<img src=x onerror=alert(1)>', audio: '</script><script>alert(2)</script>' })] }] }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
  });
});

describe('camera language', () => {
  it('maps moves and framings', () => {
    expect(cameraMove('Drone push in + slow tilt down')).toMatchObject({ to: { scale: 1.25, y: -50 }, from: { y: 50 } });
    expect(cameraMove('Static').to).toEqual({ scale: 1, x: 0, y: 0 });
    expect(cameraMove('Nervous handheld').handheld).toBe(true);
    expect(figureBox('OTS / MCU').height).toBeGreaterThan(figureBox('MLS').height);
    expect(figureBox('ELS').height).toBeLessThan(figureBox('FS').height);
  });
});
