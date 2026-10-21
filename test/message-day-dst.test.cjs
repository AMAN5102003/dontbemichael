'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('previous local day follows the calendar across both daylight saving transitions', () => {
  // A separate process fixes the timezone without changing other tests' environment.
  const script = `
    const assert = require('node:assert/strict');
    const { localDay } = require('./test/load-ts.cjs')('src/shared/messageView.ts');
    const cases = [
      ['2026-03-09T00:30:00-04:00', '2026-03-08'],
      ['2026-11-01T23:30:00-05:00', '2026-10-31'],
      ['2026-01-01T12:00:00-05:00', '2025-12-31'],
      ['2024-03-01T12:00:00-05:00', '2024-02-29']
    ];
    for (const [iso, expected] of cases) {
      assert.equal(localDay(iso, -1), expected, iso);
      assert.equal(localDay(iso), iso.slice(0, 10), 'today is unchanged');
    }
    assert.equal(localDay('invalid', -1), '');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});
