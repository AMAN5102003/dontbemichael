'use strict';

/**
 * What the breaker beat sends (issue #153). The member hears a steer and a
 * constrain, as before; a constrain also tells Michael, once, because a member
 * that is truly stuck may never send him the plan it was asked for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { CircuitBreaker, breakerMessages, plainBreakerReason } = loadTs('src/main/breaker.ts');

const T0 = 1_000_000_000_000;
const BEAT = 30_000;

function makeBreaker() {
  return new CircuitBreaker(() => ({ enabled: true, hardStop: false, repeatedToolLimit: 8, errorStormLimit: 5, tokenVelocityPerMin: 60000 }));
}

/** Every message the beat sends for one tick, the way index.ts sends them. */
function beatMessages(b, ids, now, godId = 'god') {
  const out = [];
  for (const d of b.tick(ids.map((agentId) => ({ agentId, sample: null, progressing: true })), now)) {
    if (d.action === 'none') continue;
    out.push(...breakerMessages(d, d.state.agentId === 'kelly' ? 'Kelly' : d.state.agentId, godId));
  }
  return out;
}

function loop(b, id) { for (let i = 0; i < 8; i++) b.recordToolUse(id, 'Bash', { cmd: 'same' }); }

test('a steer tells only the member', () => {
  const b = makeBreaker();
  loop(b, 'kelly');
  const sent = beatMessages(b, ['kelly'], T0);
  assert.deepEqual(sent.map((m) => [m.to, m.subject]), [['kelly', 'Circuit breaker: steer']]);
});

test('a constrain tells Michael once, with the member and the reason in plain words', () => {
  const b = makeBreaker();
  loop(b, 'kelly');
  beatMessages(b, ['kelly'], T0);                       // steer
  const sent = beatMessages(b, ['kelly'], T0 + BEAT);   // constrain
  assert.deepEqual(sent.map((m) => m.to), ['kelly', 'god']);
  const note = sent[1];
  assert.equal(note.act, 'inform');
  assert.equal(note.subject, 'Kelly is held back and needs your call');
  assert.match(note.body, /Kelly \(kelly\)/);
  assert.match(note.body, /it ran the same Bash step 8 times in a row/);
  assert.match(note.body, /split the task, hand it to another team member, or ask the owner/);
  assert.doesNotMatch(`${note.subject} ${note.body}`, /[–—]| - |circuit breaker/i);
});

test('a member that stays held back sends Michael nothing more', () => {
  const b = makeBreaker();
  loop(b, 'kelly');
  beatMessages(b, ['kelly'], T0);
  beatMessages(b, ['kelly'], T0 + BEAT);
  b.recordToolUse('kelly', 'Bash', { cmd: 'same' });   // still looping
  assert.deepEqual(beatMessages(b, ['kelly'], T0 + 2 * BEAT), []);
  assert.deepEqual(beatMessages(b, ['kelly'], T0 + 3 * BEAT), []);
});

test('Michael is never told about himself', () => {
  const d = { state: { agentId: 'god', level: 'constrained', reason: 'looping: 8× identical tool call (Bash)', ts: T0 }, action: 'constrain', changed: true };
  assert.deepEqual(breakerMessages(d, 'Michael', 'god').map((m) => m.to), ['god']);
  assert.equal(breakerMessages(d, 'Michael', 'god')[0].subject, 'Circuit breaker: constrain');
});

test('a stop sends no hive message (the beat ends the member, Michael tells the owner)', () => {
  const d = { state: { agentId: 'kelly', level: 'stopped', reason: 'x', ts: T0 }, action: 'stop', changed: true };
  assert.deepEqual(breakerMessages(d, 'Kelly', 'god'), []);
});

test('every trip reason reads in plain words for Michael', () => {
  const cases = {
    'looping: 8× identical tool call (Bash)': 'it ran the same Bash step 8 times in a row',
    'error storm: 5 consecutive api errors/retries': 'it hit 5 errors in a row talking to the model',
    'token limit: 900,000 work tokens over the agent cap of 800,000 (1,200,000 total incl. cache reads)': 'it went over its own token allowance',
    'cost cap: floor total over $50 (top spender $20.00)': 'the office went over its spending cap, and it spent the most',
    'token cap: floor total over 5,000,000 tokens (top spender 2,000,000)': 'the office went over its token budget, and it used the most',
    'token velocity 90000/min > 60000/min': 'it was using tokens unusually fast',
    'no-progress: generating tokens without coordinating (stale log/files)': 'it kept working without moving its task forward'
  };
  for (const [raw, plain] of Object.entries(cases)) assert.equal(plainBreakerReason(raw), plain, raw);
  // Every reason the breaker can produce is covered above.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'breaker.ts'), 'utf8');
  // The whole prefix, up to ':' or ' ${': "error storm", "token limit" (testing review, third ship).
  const prefixes = [...src.matchAll(/return \{ tripping: true, reason: [`']([^:$`']+?)(?::| \$\{)/g)].map((m) => m[1]);
  assert.ok(prefixes.length >= 7, prefixes.join(','));
  assert.ok(prefixes.includes('error storm') && prefixes.includes('token velocity'), prefixes.join(','));
  for (const p of prefixes) assert.ok(Object.keys(cases).some((k) => k.startsWith(`${p}:`) || k.startsWith(`${p} `)), `no plain words for "${p}"`);
});

test('the beat sends the breaker messages, not its own copies', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  assert.match(src, /for \(const m of breakerMessages\(d, name, reg\.godId \?\? 'god'\)\) hive\.send\(m, 'breaker'\);/);
  assert.doesNotMatch(src, /subject: 'Circuit breaker: (steer|constrain)'/);
});
