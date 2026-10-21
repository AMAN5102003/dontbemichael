'use strict';

/**
 * A text selection that ends past the dialog's edge, or Escape in a field,
 * must not close the hire or edit dialog (owner, 2026-09-27: the dialog closed
 * mid-edit).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('the backdrop closes only when the press and the click are both on it', () => {
  const hook = read('src/renderer/src/hooks/useBackdropClose.ts');
  assert.match(hook, /pressedOnBackdrop\.current = e\.target === e\.currentTarget;/);
  assert.match(hook, /const close = pressedOnBackdrop\.current && e\.target === e\.currentTarget;/);
  // Every v2 dialog frame closes through it (shell/Dialog.tsx).
  const frame = read('src/renderer/src/shell/Dialog.tsx');
  assert.match(frame, /const backdrop = useBackdropClose\(close\);/);
  assert.match(frame, /<div \{\.\.\.\(below \? \{\} : backdrop\)\} style=\{\{\n      position: 'fixed', inset: below \? '56px 0 0 0' : 0,/, 'only a wide panel\'s dialog (below) ignores margin clicks (wide panel WD4)');
  for (const f of ['AddAgentModal', 'EditAgentModal']) {
    const src = read(`src/renderer/src/components/${f}.tsx`);
    assert.ok(/<Dialog\b/.test(src) || /const backdrop = useBackdropClose\((?:onClose|close)\);/.test(src), f);
  }
});

// A click outside Settings closed it straight away and dropped staged changes,
// while Esc and the close button asked first.
test('the Settings backdrop asks before dropping unsaved changes, like Esc and close', () => {
  const src = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(src, /const backdrop = useBackdropClose\(\(\) => closeFnRef\.current\(\)\);/);
  assert.match(src, /<div\n      \{\.\.\.backdrop\}\n      style=\{\{\n        position: 'fixed', inset: 0,/);
  assert.doesNotMatch(src, /onClick=\{busy \? undefined : onClose\}/, 'the backdrop must not skip the unsaved changes check');
  assert.match(src, /closeFnRef\.current = busy \? \(\) => \{\} : requestClose;/, 'busy still blocks every close');
});

test('Escape in a field, list or info bubble does not close a dialog', () => {
  assert.match(read('src/renderer/src/shell/useDialog.ts'), /if \(e\.defaultPrevented \|\| escapeBelongsToField\(e\.target\)\) return;/);
  const { escapeBelongsToField } = loadTs('src/renderer/src/hooks/useBackdropClose.ts');
  const el = (hit) => ({ closest: (sel) => (hit && sel.includes(hit) ? {} : null) });
  assert.equal(escapeBelongsToField(el('textarea')), true);
  assert.equal(escapeBelongsToField(el('select')), true);
  assert.equal(escapeBelongsToField(el('[data-infotip]')), true);
  assert.equal(escapeBelongsToField(el(null)), false);
  assert.equal(escapeBelongsToField(null), false);
  assert.match(read('src/renderer/src/components/InfoTip.tsx'), /data-infotip=""/);
});

test('the hire dialog can\'t be closed while Hire runs (pre-landing review)', () => {
  const src = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(src, /const close = \(\): void => \{ if \(!submitting\.current\) onClose\(\); \};/);
  assert.match(src, /<Dialog\n      title=\{tr\('addAgent\.title'\)\}\n      onClose=\{close\}/, 'Esc and the backdrop go through close() too');
  assert.match(src, /try \{ await submitHire\(\); \} finally \{ submitting\.current = false; \}/);
});

// 2026-10-02: Edit agent's Save changes was cut off. Opened from a person's
// panel, the dialog was trapped by the column (a transform kept by its slide in
// animation) and clipped by its overflow.
test('dialogs render into document.body, and the column keeps no transform after sliding in', () => {
  // Value: protects=every dialog sizes to the window and is never clipped by the panel it was opened from; fails_when=Dialog renders in place again or the column animation holds its transform; why_new=nothing checked where dialogs mount; seam=none
  const frame = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/shell/Dialog.tsx'), 'utf8');
  assert.match(frame, /return createPortal\(\(/);
  assert.match(frame, /\), document\.body\);/);
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/design/global.css'), 'utf8');
  assert.match(css, /\.cth-col-in \{ animation: cth-col-in 240ms cubic-bezier\(\.2,0,0,1\) backwards; \}/);
});
