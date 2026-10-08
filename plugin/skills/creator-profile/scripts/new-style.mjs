#!/usr/bin/env node
// Scaffold a new style folder from this skill's blueprint/ in the current directory.
// Usage: node new-style.mjs <slug> ["Human Name"]   ->  ./style-library/<slug>/
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const blueprint = resolve(dirname(fileURLToPath(import.meta.url)), '../blueprint');
const [, , slug, ...nameParts] = process.argv;
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error('Usage: new-style.mjs <kebab-case-slug> ["Human Name"]'); process.exit(1); }
const name = nameParts.join(' ') || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const library = resolve('style-library');
const dest = join(library, slug);
if (existsSync(dest)) { console.error(`already exists: ${dest}`); process.exit(1); }
const number = String((existsSync(library) ? readdirSync(library).length : 0) + 1).padStart(2, '0');

cpSync(blueprint, dest, { recursive: true });
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(json|css|md|html)$/.test(entry)) continue;
    const txt = readFileSync(p, 'utf8');
    const next = txt.replaceAll('STYLE_ID', slug).replaceAll('"number": "NN"', `"number": "${number}"`).replaceAll('Human Readable Style Name', name);
    if (next !== txt) writeFileSync(p, next);
  }
})(dest);
console.log(JSON.stringify({ created: dest, id: slug, number, name }, null, 2));
