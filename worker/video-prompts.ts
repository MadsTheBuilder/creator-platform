// Production track, after the 3D visual: timed prompts for an AI video model, written by the creator's own Claude
// from the blockout, the breakdown and the references (get_guide("ai-video")). Ported from the 3d-video_prompt
// skill's check_prompt.py and analyse_blockout.py, so a save is refused before anyone pays for a bad prompt.

export const SECTIONS = ['GOAL', 'REFERENCES', 'FIRST FRAME AND BLOCKING', 'CONTINUITY', 'STAGES',
  'CAMERA AND OPTICS', 'PHYSICS', 'LIGHTING', 'AUDIO', 'LOOK'];
// Max seconds per call and whether references bind by @ImageN position. `higgsfield` is the model id the
// API kit (bridge/generate.py) sends; only those models can be generated with the creator's API key.
// ponytail: limits hand-copied from the providers; re-check with Higgsfield's models_explore when a model updates.
export const MODELS = {
  'seedance-2.5': { max: 30, tags: true, refs: 9, higgsfield: 'bytedance/seedance-2.5/reference-to-video' },
  'seedance-2.0': { max: 15, tags: true, refs: 9 },
  'veo-3': { max: 8, tags: false },
  kling: { max: 10, tags: false },
  'wan-2.2': { max: 5, tags: false },
  'sora-2': { max: 20, tags: false },
} as Record<string, { max: number; tags: boolean; refs?: number; higgsfield?: string }>;
export type Model = keyof typeof MODELS;

const TAG_LINE = /^@Image(\d+) \(([^)]+)\)/gm;
const FILE_LINE = /^(\S[^\n]*?\.(?:png|jpe?g|webp|gif))\s+-\s/gim;

// Every ``` block holding [GOAL], under its ## heading.
export function promptBlocks(markdown: string) {
  return [...markdown.matchAll(/^##+ (.+?)\s*\n```[^\n]*\n([\s\S]*?)```/gm)]
    .filter(m => m[2].includes('[GOAL]')).map(m => ({ heading: m[1].trim(), body: m[2] }));
}

// The reference files a block names, in order (@Image1..N for tag models).
export function referencesOf(body: string, model: Model) {
  const refs = body.slice(Math.max(body.indexOf('[REFERENCES]'), 0), Math.max(body.indexOf('[FIRST FRAME AND BLOCKING]'), 0));
  return MODELS[model].tags
    ? [...refs.matchAll(TAG_LINE)].map(m => ({ n: Number(m[1]), path: m[2].trim() }))
    : [...refs.matchAll(FILE_LINE)].map((m, i) => ({ n: i + 1, path: m[1].trim() }));
}

// Problems with one block; [] means it is ready to send. `exists` says whether a project path is a file.
export function checkBlock(body: string, model: Model, exists: (path: string) => boolean) {
  const m = MODELS[model], errs: string[] = [];
  const pos = SECTIONS.map(s => body.indexOf(`[${s}]`));
  if (pos.includes(-1) || pos.some((p, i) => i && p < pos[i - 1]))
    errs.push(`sections missing (${SECTIONS.filter((_, i) => pos[i] === -1).join(', ') || 'none'}) or out of order; need ${SECTIONS.join(' > ')}`);
  const dur = body.match(/^Duration:\s*([\d.]+)/m);
  if (!dur) errs.push('no "Duration: N seconds." line');
  else if (Number(dur[1]) > m.max) errs.push(`Duration ${dur[1]}s is over ${model}'s ${m.max}s limit: split into segments at cuts`);

  const stages = [...body.matchAll(/^STAGE (\d+) - ([\d.]+) to ([\d.]+)s - (.*)$/gm)];
  if (!stages.length) errs.push('no "STAGE n - a to bs - ... - CUT" lines');
  let t = 0;
  for (const [, n, a, b, rest] of stages) {
    if (Math.abs(Number(a) - t) > 1e-6) errs.push(`STAGE ${n} starts at ${a}s, the previous stage ended at ${t}s`);
    if (Number(b) <= Number(a)) errs.push(`STAGE ${n} ends before it starts`);
    if (!/- (NO )?CUT$/.test(rest.trimEnd())) errs.push(`STAGE ${n} does not end in "- CUT" or "- NO CUT"`);
    t = Number(b);
  }
  if (dur && stages.length && Math.abs(t - Number(dur[1])) > 1e-6) errs.push(`stages end at ${t}s, Duration is ${dur[1]}s`);

  const refs = referencesOf(body, model);
  const refsSec = body.slice(Math.max(body.indexOf('[REFERENCES]'), 0), Math.max(body.indexOf('[FIRST FRAME AND BLOCKING]'), 0));
  let refLines: string[];
  if (m.tags) {
    if (/@image\d+/.test(body)) errs.push('lowercase @image tag: write @ImageN');
    const nums = refs.map(r => r.n);
    if (nums.some((n, i) => n !== i + 1)) errs.push(`@Image numbers are ${nums.join(', ')}; they must run 1..N in order with no gaps`);
    const used = new Set([...body.matchAll(/@Image(\d+)/g)].map(x => Number(x[1])));
    for (const n of [...used].sort((a, b) => a - b)) if (!nums.includes(n)) errs.push(`@Image${n} is used but not defined in [REFERENCES]`);
    if (m.refs && refs.length > m.refs) errs.push(`${refs.length} reference images; ${model} takes at most ${m.refs}`);
    refLines = refsSec.split('\n').filter(l => /^@Image\d+ /.test(l));
    // Braces are Seedance's dialogue marks: allowed around a spoken line inside a stage, nowhere else.
    const text = sendable(body, model).replace(/^(STAGE .*)$/gm, line => line.replace(/\{[^{}]*\}/g, ''));
    const bad = [...new Set(text.match(/[()<>{}【】]/g) ?? [])];
    if (bad.length && model.startsWith('seedance')) errs.push(`reserved characters ${bad.join(' ')} (Seedance reads them as music, sound effects, dialogue and subtitles)`);
  } else {
    if (/@Image\d+/.test(body)) errs.push(`${model} has no positional @ImageN tags: name references by file path`);
    refLines = refsSec.split('\n').filter(l => /^\S[^\n]*?\.(png|jpe?g|webp|gif)\s+-\s/i.test(l));
  }
  for (const r of refs) if (!exists(r.path)) errs.push(`reference not found in the project: ${r.path} (a path from list_references, or blockout/<job_id>/shot-NN.png)`);
  for (const l of refLines) if (!l.includes('Do not')) errs.push(`reference line has no "Do not": ${l.slice(0, 60)}`);
  return errs;
}

// The text the model gets: tags without their (path), no Duration line (an API field, not prose).
export function sendable(body: string, model: Model) {
  const out = MODELS[model].tags ? body.replace(TAG_LINE, '@Image$1') : body;
  return out.replace(/^Duration:.*\n?/m, '').trim();
}

// Higgsfield's published Seedance formula: ceil(seconds * w * h * 24 / 1024) tokens at $0.0214 per 1k.
export function estimateUsd(seconds: number, resolution: '480p' | '720p', aspect: string) {
  const short = Number(resolution.slice(0, -1)), [a, b] = aspect.split(':').map(Number);
  const [w, h] = a >= b ? [Math.ceil(short * a / b), short] : [short, Math.ceil(short * b / a)];
  return Math.round(Math.ceil(seconds * w * h * 24 / 1024) * 0.0214 / 1000 * 100) / 100;
}

// Scene-change times -> contiguous shots. Drops cuts closer than minLen to the previous edge (flash frames).
export function shotsFromCuts(cuts: number[], duration: number, minLen = 0.4) {
  const edges = [0];
  for (const c of [...cuts].sort((a, b) => a - b)) if (c - edges.at(-1)! >= minLen && duration - c >= minLen) edges.push(c);
  edges.push(duration);
  const r = (x: number) => Math.round(x * 100) / 100;
  return edges.slice(1).map((end, i) => ({ shot: i + 1, start: r(edges[i]), end: r(end), duration: r(end - edges[i]) }));
}
