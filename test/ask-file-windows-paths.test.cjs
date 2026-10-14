'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { askFilePaths, plainFilePaths, isAbsolutePathText } = loadTs('src/shared/askFiles.ts');

test('Windows drive paths accept either separator and keep their source offsets', () => {
  // Value: protects=Windows paths printed with forward slashes become file chips; fails_when=only backslashes count; why_new=drive slash paths were missed; seam=none
  for (const file of ['C:/Reports/summary.csv', 'd:/Reports/summary.csv', 'C:\\Reports\\summary.csv', 'C:/Reports\\summary.csv']) {
    const text = `Review (${file}), please.`;
    assert.equal(isAbsolutePathText(file), true, file);
    assert.deepEqual(plainFilePaths(text), [{ path: file, start: 8, end: 8 + file.length }]);
  }
});

test('forward slash drive paths work in prose, links and code spans without duplicates', () => {
  // Value: protects=all file surfaces use the same path spelling and order; fails_when=link detection disagrees with prose; why_new=Windows links with forward slashes were skipped; seam=none
  const text = 'Review C:/Reports/summary.csv, [notes](D:/Reports/notes.md), '
    + '`C:/Reports/Quarterly summary.csv` and C:/Reports/summary.csv again.';
  assert.deepEqual(askFilePaths(text), [
    'C:/Reports/summary.csv', 'D:/Reports/notes.md', 'C:/Reports/Quarterly summary.csv'
  ]);
});

test('recognizing a drive slash does not turn URLs or relative fragments into files', () => {
  // Value: protects=remote links and drive relative paths stay text; fails_when=a URL tail becomes a local file; why_new=guards the expanded drive matcher; seam=none
  for (const text of [
    'https://example.com/C:/Reports/summary.csv',
    'file:///C:/Reports/summary.csv',
    'prefixC:/Reports/summary.csv',
    'relative/C:/Reports/summary.csv',
    'C:Reports/summary.csv',
    'ops@example.com/C:/Reports/summary.csv'
  ]) {
    assert.equal(isAbsolutePathText(text), false, text);
    assert.deepEqual(plainFilePaths(text), [], text);
    assert.deepEqual(askFilePaths(text), [], text);
  }
  assert.deepEqual(askFilePaths('```\nC:/Reports/example.csv\n```'), []);
  assert.deepEqual(askFilePaths('/Reports/summary.csv and ~/Reports/notes.md'), [
    '/Reports/summary.csv', '~/Reports/notes.md'
  ]);
});
