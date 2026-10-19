'use strict';

/**
 * The git checkout guard asks "is any live agent working inside this repo?".
 * That answer has to hold on every platform, so the folder check is built on
 * path.relative instead of a hand built "<folder>/" prefix, which never matches
 * a Windows path like C:\work\repo\sub.
 *
 * Paths are built with path.join so the same tests run on macOS, Linux and
 * Windows, including a folder whose name has a space in it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { isSameOrInside } = loadTs('src/main/pathInside.ts');

const ROOT = path.join(os.tmpdir(), 'my repo');

test('the folder itself counts as inside', () => {
  assert.equal(isSameOrInside(ROOT, ROOT), true);
});

test('a nested folder counts as inside, whatever the separator', () => {
  assert.equal(isSameOrInside(ROOT, path.join(ROOT, 'sub')), true);
  assert.equal(isSameOrInside(ROOT, path.join(ROOT, 'sub', 'deeper')), true);
});

test('a trailing separator on the parent does not change the answer', () => {
  assert.equal(isSameOrInside(ROOT + path.sep, path.join(ROOT, 'sub')), true);
});

test('a sibling that only shares a name prefix is not inside', () => {
  assert.equal(isSameOrInside(ROOT, `${ROOT}-two`), false);
  assert.equal(isSameOrInside(ROOT, path.join(os.tmpdir(), 'my repo two')), false);
});

test('the parent folder and unrelated folders are not inside', () => {
  assert.equal(isSameOrInside(ROOT, path.dirname(ROOT)), false);
  assert.equal(isSameOrInside(ROOT, path.join(os.tmpdir(), 'elsewhere')), false);
});

test('a folder whose name starts with two dots is still inside', () => {
  assert.equal(isSameOrInside(ROOT, path.join(ROOT, '..cache')), true);
});
