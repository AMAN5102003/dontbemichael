'use strict';

/**
 * The hourly standup fires every time the office opens (owner, 2026-09-25):
 * once per launch, as soon as Michael is up, then hourly from there. It used
 * to fire only when overdue, and on a brand-new office the first fire happened
 * before setup, with no office to send to, so it was lost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');

const { normalizeWeekly } = loadTs('src/shared/weeklySchedule.ts');
const { normalizeTimes } = loadTs('src/shared/scheduleTimes.ts');
const { scheduledRunBody } = loadTs('src/shared/scheduleMessage.ts');

const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');

test('Michael coming up invokes the launch standup', () => {
  assert.match(main, /if \(res\.ok && opts\.hive\?\.isGod\) \{ standupOnOfficeOpen\(\); catchUpOwnerAnswers\(\); \}/);
});

// Execute the production function without booting Electron. Stub only its
// service boundaries; timing validation and message construction are real.
const source = ts.createSourceFile('index.ts', main, ts.ScriptTarget.Latest, true);
const launchFunction = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'standupOnOfficeOpen');
assert.ok(launchFunction, 'the production launch function exists');
const launchCode = ts.transpileModule(launchFunction.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const now = Date.UTC(2026, 9, 11, 12); // Sunday: no weekday slot is due.

function office(overrides = {}, enabled = true) {
  let mission = {
    id: 'ops-standup', label: 'Standup', intervalMs: 3_600_000,
    to: 'god', body: '', enabled: true, focus: 'Check open work', ...overrides
  };
  const sent = [];
  const writes = [];
  let rearmed = 0;
  const context = vm.createContext({
    standupFiredThisLaunch: false,
    hive: { enabled: () => enabled, send: (...args) => sent.push(args) },
    OPS_STANDUP_MISSION: { id: 'ops-standup' },
    readConfig: () => ({ missions: [mission] }),
    writeConfig: (patch) => { writes.push(patch); mission = patch.missions[0]; },
    liveWebContents: () => null,
    syncMissions: () => { rearmed++; },
    normalizeWeekly, normalizeTimes, scheduledRunBody,
    Date: class extends Date { static now() { return now; } },
    console
  });
  vm.runInContext(launchCode, context);
  return {
    run: () => vm.runInContext('standupOnOfficeOpen()', context),
    sent, writes,
    mission: () => mission,
    rearmed: () => rearmed
  };
}

test('an interval standup dispatches once and restarts its cadence', () => {
  const state = office({ lastFiredAt: now - 1000 });
  state.run();
  state.run();
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0][0].to, 'god');
  assert.equal(state.sent[0][0].body, scheduledRunBody('Standup', '', 'Check open work'));
  assert.equal(state.sent[0][1], 'scheduler');
  assert.equal(state.writes.length, 1);
  assert.equal(state.mission().lastFiredAt, now);
  assert.equal(state.rearmed(), 1);
});

for (const [name, overrides, enabled] of [
  ['several weekday times', { times: [
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 540 },
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 840 }
  ] }, true],
  ['a weekday interval window', { times: [{ kind: 'every', everyMs: 7_200_000, days: [1, 2, 3, 4, 5], from: 480, to: 1080 }] }, true],
  ['a weekly slot', { weekly: { days: [1, 2, 3, 4, 5], minute: 540 } }, true],
  ['a disabled standup', { enabled: false }, true],
  ['an unusable interval', { intervalMs: 0 }, true],
  ['an office that is not enabled', {}, false]
]) {
  test(`opening the office does not dispatch ${name} or stamp it as fired`, () => {
    const state = office({ lastFiredAt: now - 86_400_000, ...overrides }, enabled);
    state.run();
    assert.equal(state.sent.length, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.mission().lastFiredAt, now - 86_400_000);
    assert.equal(state.rearmed(), 0);
  });
}

test('the interval timer never sends a second standup at launch', () => {
  // The decision moved into shared/missions.ts (armPlan); missions.test.cjs
  // checks the waits themselves with fake clocks.
  assert.match(main, /armPlan\(m, Date\.now\(\), \{ standupId: OPS_STANDUP_MISSION\.id, standupFiredThisLaunch \}\)/);
  const shared = fs.readFileSync(path.resolve(__dirname, '../src/shared/missions.ts'), 'utf8');
  assert.match(shared, /const waitForOpen = m\.id === ctx\.standupId && !ctx\.standupFiredThisLaunch;/);
  assert.match(shared, /const firstDelayMs = waitForOpen \? everyMs : Math\.min\(MAX_TIMER_MS, Math\.max\(0,/);
});
