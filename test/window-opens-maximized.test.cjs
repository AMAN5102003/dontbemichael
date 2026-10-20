'use strict';

/**
 * The office window opens filling the screen (owner, 2026-10-03: "office when
 * restarted always launched like 70% of screen size"; 2026-10-20: "stopped
 * again to take the full available width and height on relaunch"). The first
 * fix opened maximized unless the last run was left smaller, and one moment
 * read as "not maximized" (a dragged title bar, a display change, quitting
 * from full screen) then kept every later launch small.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
const win = main.slice(main.indexOf('function createWindow(): BrowserWindow {'));

test('every launch opens filling the screen, whatever the last run left; the smaller size is kept for un-maximizing', () => {
  // Value: protects=a relaunch fills the screen; fails_when=a saved "not maximized" (or any saved state) decides the launch size again, or a maximized or full screen rect is saved as the smaller size; why_new=the owner saw it regress 2026-10-20 with window.maximized=false saved the day before; seam=source pin
  assert.match(win, /win\.once\('ready-to-show', \(\) => \{\s*win\.maximize\(\);\s*win\.show\(\);/);
  assert.doesNotMatch(win, /getKv\('window\.maximized'\)/, 'how the last run was left never decides the launch');
  assert.doesNotMatch(win, /setKv\('window\.maximized'/);
  // The smaller size is still kept, never the screen's own rect.
  assert.match(win, /const unsized = \(\): boolean => win\.isDestroyed\(\) \|\| win\.isMinimized\(\) \|\| win\.isMaximized\(\) \|\| win\.isFullScreen\(\);/);
  assert.match(win, /persist\.setKv\('window\.bounds', win\.getBounds\(\)\)/);
});
