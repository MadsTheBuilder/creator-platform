#!/usr/bin/env node
// Gate for a creator profile in style-library/NN-slug. Run it before claiming
// the profile is done: node validate-profile.mjs <style-dir>
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checklist = JSON.parse(readFileSync(join(here, '../references/checklists.json'), 'utf8'));

const headings = md => md.split('\n').filter(l => /^#{1,4}\s/.test(l)).map(l => l.replace(/^#+\s*/, '').toLowerCase());
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function validateProfile(dir) {
  const errors = [];
  const text = {};
  for (const [file, spec] of Object.entries(checklist.files)) {
    const p = join(dir, file);
    if (!existsSync(p)) { errors.push(`Missing ${file}`); continue; }
    text[file] = readFileSync(p, 'utf8');
    const hs = headings(text[file]);
    for (const section of spec.requiredSections || []) {
      if (!hs.some(h => h.startsWith(section.toLowerCase()))) errors.push(`${file}: missing section "${section}"`);
    }
  }

  let style;
  if (text['style.json']) {
    try { style = JSON.parse(text['style.json']); } catch (e) { errors.push(`style.json: invalid JSON (${e.message})`); }
  }
  if (style) {
    for (const key of checklist.files['style.json'].requiredKeys) {
      const v = get(style, key);
      if (v == null || v === '') errors.push(`style.json: missing "${key}"`);
    }
  }
  checkPacing(dir, text, errors);
  checkTokens(text, style, errors);
  for (const [file, body] of Object.entries(text)) {
    // Same rule as scripts/check-kit.mjs, caught here before the kit check runs.
    if (/(?:[A-Z]:[\\/](?:Users|home)[\\/]|\/Users\/|\/home\/[a-z])/.test(body)) errors.push(`${file}: machine-specific path`);
  }
  return { ok: errors.length === 0, errors };
}

const hexes = s => (s.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).map(h => h.toLowerCase());

// tokens.css is the only place colours are defined; the docs must mirror it.
function checkTokens(text, style, errors) {
  const css = text['tokens.css'];
  if (!css) return;
  const spec = checklist.files['tokens.css'];
  const defined = new Set(css.match(/--[\w-]+(?=\s*:)/g) || []);
  for (const t of spec.requiredTokens) if (!defined.has(t)) errors.push(`tokens.css: missing ${t}`);
  for (const p of spec.requiredTokenPrefixes) if (![...defined].some(t => t.startsWith(p))) errors.push(`tokens.css: no ${p}* token`);
  const known = new Set(hexes(css));
  for (const h of new Set(hexes(text['DESIGN.md'] || ''))) if (!known.has(h)) errors.push(`DESIGN.md: ${h} is not defined in tokens.css`);
  for (const h of new Set(hexes(JSON.stringify(style?.palette || {})))) if (!known.has(h)) errors.push(`style.json: palette ${h} is not defined in tokens.css`);
}

const readJson = (dir, rel, errors, hint) => {
  const p = join(dir, rel);
  if (!existsSync(p)) { errors.push(`Missing ${rel} (${hint})`); return null; }
  return JSON.parse(readFileSync(p, 'utf8'));
};
const cells = line => line.split('|').slice(1, -1).map(c => c.trim());

// Rows of the first markdown table whose header has a "Median" column.
function medianTable(md) {
  const lines = md.split('\n');
  const h = lines.findIndex(l => l.trim().startsWith('|') && /median/i.test(l));
  if (h < 0) return null;
  const col = cells(lines[h]).findIndex(c => /median/i.test(c));
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    rows.push({ line: lines[i], median: parseFloat(cells(lines[i])[col]) });
  }
  return rows;
}

// Every shot-length number must trace back to cut-stats, so two files can never
// quote two different methods (the round-1 Lawtuber bug).
function checkPacing(dir, text, errors) {
  const manifest = readJson(dir, 'references/manifest.json', errors, 'list of analysed videos');
  const pacing = readJson(dir, 'references/research/pacing.json', errors, 'run scripts/cut-stats.mjs');
  if (!manifest || !pacing || !text['analysis.md']) return;
  const rows = medianTable(text['analysis.md']);
  if (!rows) { errors.push('analysis.md: no per-video table with a "Median" column'); return; }
  const byId = Object.fromEntries(pacing.map(p => [p.id, p]));
  const medians = [];
  for (const { id } of manifest.videos) {
    const row = rows.find(r => r.line.includes(id));
    if (!row) { errors.push(`analysis.md: no table row for manifest video ${id}`); continue; }
    medians.push(row.median);
    const want = byId[id]?.median;
    if (want == null) errors.push(`pacing.json: no stats for ${id}`);
    else if (!(Math.abs(row.median - want) <= 0.05)) errors.push(`analysis.md: ${id} median ${row.median}s but cut-stats says ${want}s`);
  }
  for (const line of (text['DESIGN.md'] || '').split('\n').filter(l => /median/i.test(l))) {
    // Only durations in seconds ("2.5s", "1.3–1.7s"); skip cut-offs like "under 0.15s".
    const secs = [...line.matchAll(/(under|over|below|above|threshold|<|>)?\s*(\d+\.\d+)(?:\s*[–-]\s*(\d+\.\d+))?s\b/gi)]
      .filter(m => !m[1]).flatMap(m => [m[2], m[3]]).filter(Boolean);
    for (const n of secs.map(Number)) {
      if (!medians.some(m => Math.abs(m - n) <= 0.05)) errors.push(`DESIGN.md: median ${n}s is not in the analysis.md table`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node validate-profile.mjs <style-dir>'); process.exit(2); }
  const { ok, errors } = validateProfile(dir);
  if (ok) console.log(`profile OK: ${dir}`);
  else { console.error(`profile FAILED (${errors.length}):\n- ${errors.join('\n- ')}`); process.exit(1); }
}
