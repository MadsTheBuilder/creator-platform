import { describe, expect, it } from 'vitest';
import { clock, transcriptLines } from './transcript';

describe('transcript lines', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  it('break at pauses and sentence ends, Hindi full stops included', () => {
    const words = [w('Namaste', 0), w('dosto.', 0.4), w('Aaj', 0.8), w('hum', 1.1), w('बात', 2.5), w('करेंगे।', 2.8), w('Chalo', 3.2)];
    expect(transcriptLines(words)).toEqual([
      { start: 0, text: 'Namaste dosto.' }, { start: 0.8, text: 'Aaj hum' }, { start: 2.5, text: 'बात करेंगे।' }, { start: 3.2, text: 'Chalo' },
    ]);
  });
  it('cap long runs of speech', () => {
    const words = Array.from({ length: 30 }, (_, i) => w(`w${i}`, i * 0.3));
    expect(transcriptLines(words).map(l => l.text.split(' ').length)).toEqual([14, 14, 2]);
  });
  it('show times as m:ss.s', () => {
    expect(clock(3.25)).toBe('0:03.3');
    expect(clock(75)).toBe('1:15.0');
  });
});
