'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { cutText } = loadTs('src/shared/cutText.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('plain text that fits is returned as is', () => {
  assert.equal(cutText('hello', 5), 'hello');          // exact length
  assert.equal(cutText('hello', 80), 'hello');
  assert.equal(cutText('', 10), '');
});
test('ascii is cut to max characters with the ellipsis', () => {
  assert.equal(cutText('abcdefghij', 5), 'abcd…');
  assert.equal(cutText('x'.repeat(200), 80).length, 80);
});
test('an emoji astride the cut is kept whole or dropped whole', () => {
  const r = cutText(`${'a'.repeat(118)}🎉 done party`, 120);
  assert.equal(r, `${'a'.repeat(118)}🎉…`);
  assert.ok(!lone.test(r));
  assert.equal(cutText(`${'a'.repeat(79)}😀tail`, 80), `${'a'.repeat(79)}…`);
});
test('a ZWJ family, a flag and a skin tone are one character', () => {
  assert.equal(cutText('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 2), '👨‍👩‍👧…');
  assert.equal(cutText('🇮🇳🇺🇸🇯🇵', 2), '🇮🇳…');
  assert.equal(cutText('👍🏽👍🏽👍🏽', 2), '👍🏽…');
});
test('a combining accent stays on its letter', () => {
  assert.equal(cutText('e\u0301e\u0301e\u0301', 2), 'e\u0301…');
});
test('a string whose units exceed max but graphemes fit is unchanged', () => {
  assert.equal(cutText('🇮🇳🇮🇳', 2), '🇮🇳🇮🇳'); // 8 units, 2 graphemes
});
test('max of one or less', () => {
  assert.equal(cutText('abc', 1), '…');
  assert.equal(cutText('a', 1), 'a');
  assert.equal(cutText('abc', 0), '');
  assert.equal(cutText('abc', -3), '');
  assert.equal(cutText('abc', NaN), '');
});
test('owner facing cuts go through cutText', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /ownerToastOpening\(cutText\(text, 120\)/);
  assert.match(main, /const title = cutText\(full, 80\);/);
  assert.match(main, /entry\.title \?\? cutText\(entry\.body, 80\)/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /const title = cutText\(m\.text, 80\);/);
  assert.match(read('src/renderer/src/scene/studio/StudioArt.tsx'), /return cutText\(name, 12\)/);
});
