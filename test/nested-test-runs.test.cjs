'use strict';

// A test file that runs itself again under another binary (Electron's Node, for
// a native module built for it) must not hand the inner run the outer runner's
// NODE_TEST_CONTEXT: the inner run then reports to a parent that isn't
// listening and exits 0 even when a test fails, so the outer test can never fail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every nested test run drops the outer runner\'s context', () => {
  const dir = __dirname;
  const nested = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.cjs'))
    .filter((f) => /spawnSync\([^)]*\[\s*'--test'/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(nested.includes('pulse-telemetry.test.cjs'), 'the known nested run is found');
  for (const f of nested) {
    assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /delete env\.NODE_TEST_CONTEXT;/, f);
  }
});
