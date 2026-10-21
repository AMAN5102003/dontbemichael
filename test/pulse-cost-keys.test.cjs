'use strict';

// Pulse's processor keeps the last running total of each agent's session so
// the next tick folds from there. Those keys were kept forever, and parsed and
// written every 30 s (TODOS: "Prune the processor's saved cost totals").

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { quietCostsDropped, COST_KEY_KEEP_MS } = loadTs('src/main/telemetryProcessor.ts');

const NOW = Date.UTC(2026, 9, 17, 9);
const DAY = 86_400_000;

test('a session total that has not moved for the keep window goes, a recent one stays', () => {
  const out = quietCostsDropped({
    costs: { 'pam\ts1': 1.5, 'pam\ts1#t': 900, 'jim\ts2': 0.4, 'jim\ts2#t': 120 },
    costsAt: { 'pam\ts1': NOW - COST_KEY_KEEP_MS - DAY, 'pam\ts1#t': NOW - COST_KEY_KEEP_MS - DAY, 'jim\ts2': NOW - DAY, 'jim\ts2#t': NOW - DAY }
  }, NOW);
  assert.deepEqual(out.costs, { 'jim\ts2': 0.4, 'jim\ts2#t': 120 });
  assert.deepEqual(Object.keys(out.costsAt), ['jim\ts2', 'jim\ts2#t']);
});

test('exactly the keep window still stays, and a total from an older save starts its clock now', () => {
  const out = quietCostsDropped({ costs: { 'pam\ts1': 1, 'old\ts0': 2 }, costsAt: { 'pam\ts1': NOW - COST_KEY_KEEP_MS } }, NOW);
  assert.deepEqual(out.costs, { 'pam\ts1': 1, 'old\ts0': 2 });
  assert.equal(out.costsAt['old\ts0'], NOW, 'kept, and dropped only if it stays quiet from here');
  // A time left behind for a total that is gone is not kept either.
  assert.deepEqual(quietCostsDropped({ costs: {}, costsAt: { 'x\ty': NOW } }, NOW), { costs: {}, costsAt: {} });
});
