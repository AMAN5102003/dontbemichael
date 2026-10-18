'use strict';

// A var(--cth-…) that no stylesheet defines never fails loudly: the browser
// takes the inline fallback, which was always a light theme hex. In dark mode
// that left the update chip's "update check failed" and the Connections error
// and status text close to unreadable. Every token the renderer uses has to be
// one tokens.css (or global.css) defines, so it carries a dark value too.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

test('every --cth token the renderer uses is defined', () => {
  const files = sourceFiles(RENDERER);
  const defined = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--cth-[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  assert.ok(defined.has('--cth-ink-900'), 'tokens.css was not found under src/renderer');

  const missing = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\(\s*(--cth-[\w-]+)/g)) {
      if (!defined.has(m[1])) missing.push(`${m[1]} in ${path.relative(RENDERER, f)}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

// #6E1423 is a dark red with no dark theme value: on the dark card it sits near
// 1.4:1, so the public webhook warning and the office folder error in Settings
// all but vanished. Warning text takes --cth-coral-text, which has both.
test('no warning text is drawn in the light only #6E1423', () => {
  const hits = [];
  for (const f of sourceFiles(RENDERER)) {
    if (/#6E1423\b/i.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(RENDERER, f));
  }
  assert.deepEqual(hits, []);
});
