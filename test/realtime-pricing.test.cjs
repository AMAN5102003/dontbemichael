'use strict';

/**
 * Realtime voice cost guard: pricing helpers in src/shared/realtimePricing.ts.
 * Pure functions, so these tests pin the maths and the formatting down.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  normalizeRealtimeUsage,
  computeRealtimeUsd,
  formatUsd,
  REALTIME_AUDIO_INPUT_PER_MTOK,
  REALTIME_AUDIO_OUTPUT_PER_MTOK
} = loadTs('src/shared/realtimePricing.ts');

test('normalizeRealtimeUsage reads camelCase and snake_case', () => {
  assert.deepEqual(normalizeRealtimeUsage({ inputTokens: 10, outputTokens: 5 }), {
    inputTokens: 10,
    outputTokens: 5
  });
  assert.deepEqual(normalizeRealtimeUsage({ input_tokens: 7, output_tokens: 3 }), {
    inputTokens: 7,
    outputTokens: 3
  });
});

test('normalizeRealtimeUsage treats missing or bad values as 0', () => {
  const zero = { inputTokens: 0, outputTokens: 0 };
  assert.deepEqual(normalizeRealtimeUsage(null), zero);
  assert.deepEqual(normalizeRealtimeUsage(undefined), zero);
  assert.deepEqual(normalizeRealtimeUsage({ inputTokens: -4, outputTokens: NaN }), zero);
});

test('computeRealtimeUsd prices 1M tokens at the audio rates', () => {
  assert.equal(computeRealtimeUsd({ inputTokens: 1_000_000 }), REALTIME_AUDIO_INPUT_PER_MTOK);
  assert.equal(computeRealtimeUsd({ outputTokens: 1_000_000 }), REALTIME_AUDIO_OUTPUT_PER_MTOK);
  assert.equal(
    computeRealtimeUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    REALTIME_AUDIO_INPUT_PER_MTOK + REALTIME_AUDIO_OUTPUT_PER_MTOK
  );
});

test('computeRealtimeUsd is 0 for empty usage', () => {
  assert.equal(computeRealtimeUsd(null), 0);
  assert.equal(computeRealtimeUsd({}), 0);
});

test('formatUsd formats zero, tiny, and normal amounts', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(-1), '$0.00');
  assert.equal(formatUsd(NaN), '$0.00');
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatUsd(0.42), '$0.42');
  assert.equal(formatUsd(12.3), '$12.30');
});
