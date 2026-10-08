#!/usr/bin/env node
// The one pacing method for creator profiles. Every shot-length number in
// analysis.md and DESIGN.md must come from this script, never from eyeballing.
// Input: <dir>/<id>.cuts.txt (one scene-cut time in seconds per line, from
// ffmpeg select=gt(scene,0.3)) next to <dir>/<id>.info.json (yt-dlp, needs "duration").
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const round1 = x => Math.round(x * 10) / 10;

export function cutStats(times, duration) {
  const cuts = times.filter(t => t > 0 && t < duration).sort((a, b) => a - b);
  const bounds = [0, ...cuts, duration];
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]).filter(s => s >= 0.15);
  const sorted = [...shots].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    cuts: cuts.length,
    median: round1(median),
    mean: round1(shots.reduce((a, b) => a + b, 0) / shots.length),
    cutsFirst60: cuts.filter(t => t < 60).length,
    shotsOver10: shots.filter(s => s > 10).length,
  };
}

export function statsForDir(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.cuts.txt')).sort().map(f => {
    const id = f.slice(0, -'.cuts.txt'.length);
    const info = join(dir, `${id}.info.json`);
    if (!existsSync(info)) throw new Error(`${id}: missing ${id}.info.json (need duration)`);
    const { duration } = JSON.parse(readFileSync(info, 'utf8'));
    const times = (readFileSync(join(dir, f), 'utf8').match(/\d+(\.\d+)?/g) || []).map(Number);
    return { id, duration, ...cutStats(times, duration) };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node cut-stats.mjs <captions-dir>  (prints JSON)'); process.exit(2); }
  console.log(JSON.stringify(statsForDir(dir), null, 2));
}
