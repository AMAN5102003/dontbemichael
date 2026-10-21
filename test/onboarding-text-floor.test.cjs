'use strict';

/**
 * Setup text is 14px or larger, with a 20px line height (owner rule, #151).
 * Business and Team were raised in #138. Welcome and Permissions, and the
 * toggle rows only those steps use, stay on the same floor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = fs.readFileSync(
  path.join(__dirname, '..', 'src/renderer/src/components/OnboardingWizard.tsx'),
  'utf8'
);

function between(start, end) {
  const a = wizard.indexOf(start);
  const b = wizard.indexOf(end, a + start.length);
  assert.ok(a !== -1 && b > a, `missing ${start} .. ${end}`);
  return wizard.slice(a, b);
}

function assertFloor(label, source) {
  const sizes = [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0, `${label} names no text size`);
  for (const size of sizes) {
    assert.ok(size >= 14, `${label} has fontSize ${size}, under the 14px floor`);
  }
  const lines = [...source.matchAll(/lineHeight:\s*'(\d+)px'/g)].map((m) => Number(m[1]));
  assert.ok(lines.length > 0, `${label} names no line height`);
  for (const line of lines) {
    assert.ok(line >= 20, `${label} has lineHeight ${line}px, under 20px`);
  }
}

test('Welcome and Permissions setup text stays at 14px', () => {
  assertFloor('Welcome', between("{step === 'welcome' && (", "{step === 'home' && ("));
  assertFloor('Permissions', between("{step === 'permissions' && (", '{error && ('));
  assertFloor('ToggleRow', between('function ToggleRow', 'function Dots'));
});
