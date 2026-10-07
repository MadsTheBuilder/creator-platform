import { describe, expect, it } from 'vitest';
import { cardPreview, readStyleFolder, summarise } from './styles';

const file = (path: string, text: string) => Object.assign(new File([text], path.split('/').at(-1)!), { webkitRelativePath: path }) as File;

describe('style folders', () => {
  it('keeps only the files a style holds, by their path inside the picked folder', async () => {
    const picked = await readStyleFolder([
      file('03-indian-lawtuber/DESIGN.md', '# Look'), file('03-indian-lawtuber/cards/tier1/t1-stat-redtear.html', '<div/>'),
      file('03-indian-lawtuber/HANDOFF.md', 'x'), file('03-indian-lawtuber/references/manifest.json', '{}'), file('03-indian-lawtuber/cards/tier1/Bad Name.html', 'x'),
    ]);
    expect(picked.map(f => f.path)).toEqual(['DESIGN.md', 'cards/tier1/t1-stat-redtear.html']);
  });
  it('refuses a folder with no style files', async () => {
    await expect(readStyleFolder([file('videos/a.mp4', 'x')])).rejects.toThrow(/No style files/);
  });
});

describe('style summary', () => {
  it('reads palette, fonts and motion from style.json, skipping non-colours', () => {
    const s = summarise(JSON.stringify({ summary: 'Noir', palette: { bg: '#0b0b0c', accent: '#e10a14', notes: 'Red is the alarm' }, fonts: { display: 'Anton' }, motion: 'Hard pops' }));
    expect(s).toEqual({ summary: 'Noir', palette: [['bg', '#0b0b0c'], ['accent', '#e10a14']], fonts: [['display', 'Anton']], motion: 'Hard pops', transitions: undefined });
  });
  it('is empty for a missing or broken file', () => {
    expect(summarise(undefined)).toBeNull();
    expect(summarise('{')).toBeNull();
  });
});

describe('card preview', () => {
  it('inlines the style tokens and plays the card on repeat', () => {
    const p = cardPreview('<html><head><link rel="stylesheet" href="../../tokens.css" /></head><body><div data-composition-id="c" data-start="0" data-width="1080" data-height="1920"></div></body></html>', ':root{--red:#e10a14}');
    expect(p.html).toContain('<style>:root{--red:#e10a14}</style>');
    expect(p.html).not.toContain('tokens.css');
    expect(p.html).toMatch(/t\.repeat\(-1\).*<\/body>/);
    expect([p.width, p.height]).toEqual([1080, 1920]);
  });
});
