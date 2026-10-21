'use strict';

/**
 * An info bubble stays inside the dialog or window that clips it (#232: on
 * the hire dialog's Finalize step, the Model tip sits at the end of its row
 * near the bottom of the scrolling body, and ran off both edges).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { placeInfoTip } = loadTs('src/renderer/src/components/infoTipPlacement.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

// The hire dialog's scrolling body, about as wide as in the issue's screenshot.
const body = { left: 0, top: 70, right: 1160, bottom: 590 };
const icon = (left, top) => ({ left, top, right: left + 16, bottom: top + 16 });
const bubble = { width: 260, height: 96 };

test('a bubble with room keeps the side it asked for', () => {
  assert.deepEqual(placeInfoTip(icon(30, 240), bubble, body, { opensRight: true }), { opensRight: true, above: false });
  assert.deepEqual(placeInfoTip(icon(900, 240), bubble, body, { opensRight: false }), { opensRight: false, above: false });
});

test('the Model tip at the end of the row, near the bottom, opens toward the start and above (#232)', () => {
  assert.deepEqual(placeInfoTip(icon(977, 484), bubble, body, { opensRight: true }), { opensRight: false, above: true });
});

test('an end aligned tip that wrapped to the start of its row opens the other way', () => {
  // Model wraps under Folder in a narrow window; opening left would run off the start edge.
  assert.deepEqual(placeInfoTip(icon(30, 240), bubble, body, { opensRight: false }), { opensRight: true, above: false });
});

test('with no room either way, the side that spills less wins, and a tie keeps the asked side', () => {
  const narrow = { left: 0, top: 0, right: 200, bottom: 1000 };
  assert.equal(placeInfoTip(icon(40, 100), bubble, narrow, { opensRight: true }).opensRight, true, 'spills 92 right, 196 left');
  assert.equal(placeInfoTip(icon(150, 100), bubble, narrow, { opensRight: true }).opensRight, false, 'spills 202 right, 86 left');
  const exact = { left: 0, top: 0, right: 1000, bottom: 1000 };
  assert.equal(placeInfoTip(icon(400, 100), bubble, exact, { opensRight: false }).opensRight, false);
  const short = { left: 0, top: 0, right: 1000, bottom: 56 };
  assert.equal(placeInfoTip(icon(400, 20), bubble, short, { opensRight: true }).above, false, 'equal spill stays below');
});

test('InfoTip places its bubble before paint, keeping the align prop as the preferred side', () => {
  const src = read('src/renderer/src/components/InfoTip.tsx');
  assert.match(src, /useLayoutEffect\(\(\) => \{/);
  assert.match(src, /const opensRight = \(align === 'start'\) === ltr;/);
  assert.match(src, /placeInfoTip\(a\.getBoundingClientRect\(\), \{ width: b\.offsetWidth, height: b\.offsetHeight \}, clipBoxOf\(a\), \{ opensRight \}\)/);
  assert.match(src, /flip\.above \? \{ top: 'auto', bottom: 'calc\(100% \+ 6px\)' \}/);
});
