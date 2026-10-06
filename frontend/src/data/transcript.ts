// The Studio track's transcript (transcript.json from `hyperframes transcribe`): words with times in seconds.
export type Word = { text: string; start: number; end: number };

// Readable lines: a new line after a pause, at the end of a sentence, or every 14 words.
export function transcriptLines(words: Word[], pause = 0.6, max = 14): { start: number; text: string }[] {
  const lines: { start: number; words: string[] }[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1], line = lines[lines.length - 1];
    if (!line || w.start - prev.end > pause || /[.?!।]$/.test(prev.text) || line.words.length >= max) lines.push({ start: w.start, words: [w.text] });
    else line.words.push(w.text);
  });
  return lines.map(l => ({ start: l.start, text: l.words.join(' ') }));
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
