'use strict';

/**
 * 2026-10-14 (#409): the sidebar CodeMirror editor and the IDE Monaco editor
 * always painted a light cream theme. The chrome around them already follows
 * data-cth-theme, so dark mode left a cream editor in a dark shell. Both now
 * follow useAppTheme(), the same switch the terminal uses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const codeEditor = read('src/renderer/src/components/CodeEditor.tsx');
const monaco = read('src/renderer/src/ide/monaco.ts');
const monacoEditor = read('src/renderer/src/ide/MonacoEditor.tsx');
const monacoDiff = read('src/renderer/src/ide/MonacoDiff.tsx');

test('sidebar CodeEditor follows useAppTheme, not a hard coded light theme', () => {
  // Value: protects=dark mode keeps the file body readable with the chrome; fails_when=theme="light" or dark:false returns; why_new=#409; seam=source pin
  assert.match(codeEditor, /useAppTheme/, 'reads the app theme');
  assert.match(codeEditor, /theme=\{appTheme\}/, 'passes the app theme to CodeMirror');
  assert.doesNotMatch(codeEditor, /theme=["']light["']/, 'no hard coded light theme prop');
  assert.doesNotMatch(codeEditor, /dark:\s*false/, 'chrome theme is not locked to light');
  assert.match(codeEditor, /var\(--cth-paper-100\)/, 'editor background is a token');
  assert.match(codeEditor, /const darkSyntax = HighlightStyle\.define/, 'dark syntax colours exist');
});

test('monacoThemeFor picks cth-light or cth-dark from the app theme', () => {
  // Value: protects=the IDE theme id flips with the app switch; fails_when=dark always returns light; why_new=#409; seam=source pin (monaco.ts pulls workers)
  assert.match(
    monaco,
    /export function monacoThemeFor\(theme: 'light' \| 'dark'\): 'cth-light' \| 'cth-dark' \{\s*return theme === 'dark' \? 'cth-dark' : 'cth-light';\s*\}/,
    'monacoThemeFor maps light and dark'
  );
});

test('Monaco registers a dark theme and the editors use monacoThemeFor', () => {
  // Value: protects=cth-dark exists and both editors wire the app theme; fails_when=only cth-light is defined or a call site pins CTH_MONACO_THEME; why_new=#409; seam=source pin
  assert.match(monaco, /defineTheme\(\s*['"]cth-dark['"]/, 'cth-dark is registered');
  assert.match(monaco, /'editor\.background': '#1F1E2B'/, 'dark background matches the dark card token');
  assert.match(monacoEditor, /useAppTheme/, 'MonacoEditor reads the app theme');
  assert.match(monacoEditor, /monacoThemeFor\(appTheme\)/, 'MonacoEditor picks the theme id');
  assert.match(monacoDiff, /monacoThemeFor\(appTheme\)/, 'MonacoDiff picks the theme id');
  assert.doesNotMatch(monacoEditor, /CTH_MONACO_THEME/, 'no hard coded light constant');
  assert.doesNotMatch(monacoDiff, /CTH_MONACO_THEME/, 'no hard coded light constant');
});
