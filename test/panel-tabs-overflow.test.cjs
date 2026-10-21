'use strict';

/**
 * Issue #65: in a narrow panel the tab row overflows with its scrollbar hidden,
 * so a tab scrolled out of view had no visible way back. Pins the wheel and the
 * edge fade in PanelTabs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('the mouse wheel scrolls an overflowing tab row sideways, mirrored in RTL', () => {
  // Value: protects=a plain mouse wheel brings Profile back; fails_when=the listener goes passive (preventDefault ignored) or RTL scrolls the wrong way; why_new=issue #65; seam=none
  const src = read('src/renderer/src/shell/PanelChrome.tsx');
  assert.match(src, /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\);/);
  assert.match(src, /if \(e\.ctrlKey \|\| Math\.abs\(e\.deltaY\) <= Math\.abs\(e\.deltaX\)\) return;/);
  assert.match(src, /el\.scrollLeft \+= rtl \? -e\.deltaY : e\.deltaY;/);
});

test('an edge of the tab row fades while tabs are hidden past it, and the rule under the row does not', () => {
  // Value: protects=the owner can see the row scrolls; fails_when=the fade is dropped, goes stale after a label change, RTL edges swap, or the mask moves onto the element carrying the rule; why_new=issue #65; seam=none
  const src = read('src/renderer/src/shell/PanelChrome.tsx');
  assert.match(src, /const fromStart = Math\.abs\(el\.scrollLeft\);/);
  assert.match(src, /const next = rtl \? \{ left: end, right: start \} : \{ left: start, right: end \};/);
  assert.match(src, /maskImage: fade, WebkitMaskImage: fade/);
  // A label change (language, font load) resizes the tabs, not the row.
  assert.match(src, /for \(const tab of el\.children\) ro\.observe\(tab\);/);
  assert.match(src, /<div style=\{\{ flexShrink: 0, boxShadow: 'inset 0 -1px 0 var\(--cth-line\)' \}\}>\s*<div ref=\{stripRef\} role="tablist"/);
});
