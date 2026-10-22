// Generate src/icons.json: subset icon (per prefix) yang dipakai di src/components/Icon.jsx.
// Jalankan: node scripts/gen-icons.mjs
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const iconSrc = fs.readFileSync(new URL('../src/components/Icon.jsx', import.meta.url), 'utf8');

// Semua '<prefix>:<name>' dari MAP, dikelompokkan per prefix.
const byPrefix = {};
for (const [, prefix, name] of iconSrc.matchAll(/'([a-z0-9]+):([a-z0-9-]+)'/g)) {
  (byPrefix[prefix] = byPrefix[prefix] || new Set()).add(name);
}

const out = {};
const missing = [];
for (const [prefix, names] of Object.entries(byPrefix)) {
  const full = require(`@iconify-json/${prefix}/icons.json`);
  const col = { prefix, icons: {}, width: full.width, height: full.height };
  for (const n of names) {
    if (full.icons[n]) col.icons[n] = full.icons[n];
    else missing.push(`${prefix}:${n}`);
  }
  out[prefix] = col;
}

fs.writeFileSync(new URL('../src/icons.json', import.meta.url), JSON.stringify(out));
const total = Object.values(out).reduce((s, c) => s + Object.keys(c.icons).length, 0);
console.log(`wrote src/icons.json — ${total} icons across ${Object.keys(out).length} set(s)`);
if (missing.length) console.warn('MISSING (nama salah):', missing);
