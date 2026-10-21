'use strict';

/**
 * App subscribes to the whole agents list, so it re-renders on every hook event
 * (each one stamps actionAt). Without memo, that parent render redraws the
 * whole stage and bypasses the stage's own drawn-fields equality on agents.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('StudioStage is wrapped in React.memo', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /export const StudioStage = memo\(function StudioStage\(/);
});

test('App passes StudioStage no inline functions or objects, so memo holds', () => {
  const app = read('src/renderer/src/App.tsx');
  const el = app.match(/<StudioStage\b[^>]*\/>/);
  assert.ok(el, 'App renders <StudioStage ... />');
  assert.doesNotMatch(el[0], /=>/, 'an inline arrow prop is a new function every render');
  assert.doesNotMatch(el[0], /=\{\{/, 'an inline object prop is a new object every render');
});
