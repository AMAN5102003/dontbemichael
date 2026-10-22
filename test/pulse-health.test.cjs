'use strict';

/**
 * Pulse's health readout (docs/designs/team-performance.md, Section 8; TODOS.md T9):
 * the last batch and points per batch, failed writes by day, hook frames refused
 * per member, one log line per batch that read something, and one warning when
 * points wait 5 minutes unread.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { PulseHealth, STALL_AFTER_MS } = loadTs('src/shared/pulseHealth.ts');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function clock() {
  let now = new Date(2026, 9, 17, 9).getTime();
  return { now: () => now, add: (ms) => { now += ms; } };
}

test('a batch that read points logs one line; a pass that read nothing logs none; the view says what flowed', () => {
  // Value: protects=the health readout's numbers and the batch log line; fails_when=an empty pass logs every 30 s, or the view loses the last batch, the failed writes or the refused frames; why_new=T9; seam=none; no_claim=the processor's own fold (pulse-telemetry tests)
  const c = clock();
  const h = new PulseHealth(c.now);
  assert.deepEqual(h.view('/office', {}, new Map()), { lastBatch: null, eventsPerBatch: 0, lastPointAt: null, failedWrites: {}, refusedFrames: {}, stalled: false });

  h.point('/office');
  const pointAt = c.now();
  c.add(20_000);
  assert.equal(h.batch(30, 4), '[pulse] batch: 30 points in 4 ms');
  const at = c.now();
  c.add(30_000);
  assert.equal(h.batch(0, 1), null, 'nothing read, nothing logged');
  assert.equal(h.batch(10, 2), '[pulse] batch: 10 points in 2 ms');

  const v = h.view('/office', { '2026-10-16': 3 }, new Map([['god', 2], ['unknown', 1]]));
  assert.deepEqual(v.lastBatch, { at: at + 30_000, events: 10, ms: 2 });
  assert.equal(v.eventsPerBatch, 20, 'average of the batches that read something');
  assert.equal(v.lastPointAt, pointAt);
  assert.deepEqual(v.failedWrites, { '2026-10-16': 3 });
  assert.deepEqual(v.refusedFrames, { god: 2, unknown: 1 }, 'a plain object the window can read');
  assert.equal(v.stalled, false);
});

test('points unread for 5 minutes warn once; a batch clears it and a new stall warns again; the view keeps the last batch', () => {
  // Value: protects=the single stall warning; fails_when=a stall warns every tick, never warns, or a recovered processor stays stalled; why_new=T9; seam=none; no_claim=why the processor stalled (the tick's own error line)
  const c = clock();
  const h = new PulseHealth(c.now);
  h.point('/office');
  h.batch(5, 1);
  const last = c.now();

  h.point('/office');
  const warnings = [];
  for (let i = 0; i < 20; i++) {
    c.add(30_000);
    const w = h.stallWarning('/office');
    if (w) warnings.push(w);
  }
  assert.equal(warnings.length, 1, 'ten minutes of ticks, one warning');
  assert.match(warnings[0], /^\[pulse\] processor stalled: points have waited 5 min unread/);
  assert.ok(warnings[0].includes(new Date(last).toISOString()), 'it says which numbers Pulse still shows');
  const v = h.view('/office', {}, new Map());
  assert.equal(v.stalled, true);
  assert.deepEqual(v.lastBatch, { at: last, events: 5, ms: 1 }, 'the last numbers stay');

  assert.ok(h.batch(12, 3), 'it recovers');
  assert.equal(h.view('/office', {}, new Map()).stalled, false);
  assert.equal(h.stallWarning('/office'), null);

  h.point('/office');
  c.add(STALL_AFTER_MS - 1);
  assert.equal(h.stallWarning('/office'), null, 'not yet');
  c.add(1);
  assert.ok(h.stallWarning('/office'), 'a new stall warns again');
  assert.equal(h.stallWarning('/office'), null);
});

test('an idle office never stalls, and a point after a long quiet waits its own 5 minutes', () => {
  // Value: protects=no false stall; fails_when=a quiet office or the first point after a quiet hour warns; why_new=T9; seam=none; no_claim=none beyond protects
  const c = clock();
  const h = new PulseHealth(c.now);
  h.point('/office');
  h.batch(1, 0);
  c.add(3 * 3600_000);
  assert.equal(h.stallWarning('/office'), null, 'no points, no stall');
  h.point('/office');
  c.add(30_000);
  assert.equal(h.stallWarning('/office'), null, 'the next tick has not had its chance');
  assert.equal(h.stalled('/office'), false);
  assert.equal(h.stalled(null), false, 'no office open');
});

test('points left in the last office do not stall the one now open', () => {
  // Value: protects=no false stall after a home change; fails_when=the old office's unread points warn for the new one; why_new=T9; seam=none; no_claim=reading the old office when it opens again (the processor's cursor)
  const c = clock();
  const h = new PulseHealth(c.now);
  h.point('/old');
  c.add(STALL_AFTER_MS);
  assert.equal(h.stallWarning('/new'), null);
  h.point('/new');
  c.add(STALL_AFTER_MS);
  assert.ok(h.stallWarning('/new'), 'the new office\'s own points still count');
});

test('the store tells the readout of each point it queues, and counts failed writes by day', () => {
  // Value: protects=points arriving and failed writes reach the readout; fails_when=a queued point is not noted (no stall can be seen) or failed writes lose their counts; why_new=T9; seam=no database (writes fail); no_claim=saved failures (pulse-telemetry D15 test)
  const { TelemetryStore } = loadTs('src/main/telemetryStore.ts');
  const { dayKey } = loadTs('src/shared/teamPerformance.ts');
  let office = '/office';
  const store = new TelemetryStore(() => null, () => office, () => 0);
  const seen = [];
  store.onRecord = (o) => seen.push(o);
  const ts = new Date(2026, 9, 16, 9).getTime();
  store.record({ agentId: 'pam', kind: 'prompt', ts });
  store.record({ agentId: 'pam', kind: 'stop', ts });
  office = null;
  store.record({ agentId: 'pam', kind: 'prompt', ts });
  assert.deepEqual(seen, ['/office', '/office'], 'a point with no office open is not queued or noted');
  store.flush();
  assert.deepEqual(store.failedWrites('/office'), { [dayKey(ts)]: 2 });
  assert.deepEqual(store.failureDays('/office'), [dayKey(ts)]);
});

test('main serves telemetry:health, every processor pass is noted, and the 30 s tick warns on a stall', () => {
  // Value: protects=the wiring of the readout; fails_when=a pass skips the health note, rejectedFrames or failed writes are not read, or the stall check is gone; why_new=T9; seam=source pins on index.ts and the preload; no_claim=the IPC round trip itself
  const src = read('src/main/index.ts');
  assert.match(src, /pulseTelemetry\.onRecord = \(office\) => pulseHealth\.point\(office\);/);
  assert.match(src, /const n = pulseProcessor\.tick\(office\);\s*const line = pulseHealth\.batch\(n, Date\.now\(\) - started\);\s*if \(line\) console\.log\(line\);/);
  assert.equal(src.match(/pulseProcessor\.tick\(/g).length, 1, 'every pass goes through pulseTick');
  assert.match(src, /ipcMain\.handle\('telemetry:health', \(\) => \{[\s\S]{0,200}pulseHealth\.view\(office, office \? pulseTelemetry\.failedWrites\(office\) : \{\}, hookServer\.rejectedFrames\(\)\)/);
  const timer = src.slice(src.indexOf('pulseTickTimer = setInterval('), src.indexOf('}, 30_000);', src.indexOf('pulseTickTimer = setInterval(')));
  assert.match(timer, /const stalled = pulseHealth\.stallWarning\(office\);\s*if \(stalled\) console\.warn\(stalled\);/);
  assert.match(read('src/preload/index.ts'), /telemetryHealth: \(\): Promise<PulseHealthView> => ipcRenderer\.invoke\('telemetry:health'\)/);
});
