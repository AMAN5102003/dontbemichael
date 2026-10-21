'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { fmtTokens, fmtToolTokens, fmtWorkerTokens } = loadTs('src/shared/tokenFormat.ts');

test('a token count reads in the largest unit that fits', () => {
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(999), '999');
  assert.equal(fmtTokens(1000), '1K');
  assert.equal(fmtTokens(1540), '1.5K');
  assert.equal(fmtTokens(999_949), '999.9K');
  assert.equal(fmtTokens(1_000_000), '1M');
  assert.equal(fmtTokens(12_340_000), '12.3M');
  assert.equal(fmtTokens(1_000_000_000), '1B');
  assert.equal(fmtTokens(1_250_000_000), '1.25B');
});

test('a count that rounds up to the next unit reads in that unit, never "1000K"', () => {
  assert.equal(fmtTokens(999.6), '1K');
  assert.equal(fmtTokens(999_950), '1M');
  assert.equal(fmtTokens(999_999), '1M');
  assert.equal(fmtTokens(999_950_000), '1B');
  assert.equal(fmtTokens(999_999_999), '1B');
});

test('the tool waterfall and worker rows keep their own style across the same boundaries', () => {
  assert.equal(fmtToolTokens(999), '999');
  assert.equal(fmtToolTokens(1500), '2K');
  assert.equal(fmtToolTokens(999_499), '999K');
  assert.equal(fmtToolTokens(999_500), '1.0M');
  assert.equal(fmtToolTokens(2_340_000), '2.3M');

  assert.equal(fmtWorkerTokens(999), '999');
  assert.equal(fmtWorkerTokens(1500), '1.5k');
  assert.equal(fmtWorkerTokens(9_949), '9.9k');
  assert.equal(fmtWorkerTokens(9_999), '10k');
  assert.equal(fmtWorkerTokens(15_000), '15k');
  assert.equal(fmtWorkerTokens(999_500), '1.00M');
  assert.equal(fmtWorkerTokens(1_500_000), '1.50M');
});

test('a count that is not a number reads 0, never "NaN" or "InfinityB"', () => {
  // Value: protects=a row with a missing or broken token count stays readable; fails_when=compact formats NaN or an infinite count as text; why_new=only whole, finite counts were checked; seam=none
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(fmtTokens(bad), '0', `fmtTokens(${bad})`);
    assert.equal(fmtToolTokens(bad), '0', `fmtToolTokens(${bad})`);
    assert.equal(fmtWorkerTokens(bad), '0', `fmtWorkerTokens(${bad})`);
  }
  // Real counts are unchanged.
  assert.equal(fmtTokens(1540), '1.5K');
  assert.equal(fmtToolTokens(1500), '2K');
  assert.equal(fmtWorkerTokens(1500), '1.5k');
});
