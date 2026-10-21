'use strict';

/**
 * The Work tab's terminal toolbar (zoom out, reset, zoom in, Focus) was English
 * only in an app that ships Arabic and Chinese, and its tooltips named Cmd on
 * Windows, where the owner presses Ctrl. Structural checks: the renderer has no
 * DOM test harness here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const view = read('src/renderer/src/components/PtyTerminalView.tsx');

test('the terminal toolbar has no literal English tooltips or labels', () => {
  // Value: protects=an Arabic or Chinese owner reads the toolbar in their language; fails_when=a title or aria-label on the toolbar is a string literal again; why_new=i18n-keys-exist only checks keys the code asks for, never text that skips t(); seam=none
  assert.doesNotMatch(view, /\btitle="[A-Za-z]/);
  assert.doesNotMatch(view, /aria-label="[A-Za-z]/);
  assert.doesNotMatch(view, /title=\{[^}]*'[A-Z][a-z]+ [^']*'/, 'no English literal inside a title expression');
});

test('the shortcut names the key this OS uses', () => {
  // Value: protects=a Windows owner is told Ctrl, not Cmd; fails_when=the modifier is hard-coded or the tooltips stop passing it; why_new=the tooltips said Cmd on every OS; seam=none
  assert.match(view, /const mod = window\.cth\.platform === 'darwin' \? 'Cmd' : 'Ctrl';/);
  for (const k of ['zoomOut', 'zoomIn', 'zoomReset']) {
    assert.match(view, new RegExp(`t\\('workTab\\.${k}', \\{ mod \\}\\)`), `${k} gets the modifier`);
  }
  for (const locale of ['en', 'zh-CN', 'ar']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).workTab;
    for (const k of ['zoomOut', 'zoomIn', 'zoomReset']) assert.match(w[k], /\{\{mod\}\}/, `${locale} workTab.${k} shows the key`);
    for (const k of ['zoomOutLabel', 'zoomInLabel', 'zoomResetLabel', 'exitFocus']) assert.ok(w[k], `${locale} workTab.${k}`);
  }
});

test('the reset button says what it does and keeps its visible text in its name', () => {
  // Value: protects=a screen reader hears "Reset zoom, 14px", not just "14px"; fails_when=the button loses its aria-label or drops the size shown on it; why_new=its only name was the size; seam=none
  assert.match(view, /aria-label=\{`\$\{t\('workTab\.zoomResetLabel'\)\}, \$\{fontSize\}px`\}/);
});
