import { describe, expect, it } from 'vitest';
import { isStep, stepIn, stepsFor } from './tracks';

describe('Playground tracks', () => {
  it('give each track its own steps, both ending in the editor', () => {
    expect(stepsFor('production').map(s => s.step)).toEqual(['script', 'shots', 'storyboard', '3d', 'edit']);
    expect(stepsFor('studio').map(s => s.step)).toEqual(['direct', 'build', 'edit']);
  });
  it('open a step only on the track that has it', () => {
    expect(stepIn('studio', 'edit')).toBe('edit');
    expect(stepIn('studio', 'shots')).toBe('direct');
    expect(stepIn('production', 'build')).toBe('script');
    expect(stepIn('production')).toBe('script');
  });
  it('recognise steps from either track in a link', () => {
    expect(isStep('direct')).toBe(true);
    expect(isStep('3d')).toBe(true);
    expect(isStep('nope')).toBe(false);
    expect(isStep(undefined)).toBe(false);
  });
});
