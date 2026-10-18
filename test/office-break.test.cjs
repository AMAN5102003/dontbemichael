'use strict';

/**
 * The office break (issue 124). On a smaller Claude plan the team reaches its
 * usage limit during the day, and the office used to stop without a word while
 * schedules kept sending jobs into terminals that could not answer. Now Claude
 * Code's StopFailure hook (`error: "rate_limit"`) starts a break, the status
 * line's `rate_limits.*.resets_at` says when it ends, schedules hold one run
 * each, nothing types into a Claude terminal, and the office starts again by
 * itself. Payload shapes are the ones Claude Code documents for StopFailure and
 * the status line.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { OfficeBreak, resetFromRateLimits, RESET_GRACE_MS, RETRY_MS, CHECK_TIMEOUT_MS } = loadTs('src/main/officeBreak.ts');
const { heldByBreak, stopReasonFor, stopNeedsOwner, STOP_FAILURE_MATCHER } = loadTs('src/shared/officeBreak.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const HOUR = 3_600_000;

function memoryStore(initial = null) {
  const box = { state: initial };
  return { box, store: { load: () => box.state, save: (s) => { box.state = s === null ? null : JSON.parse(JSON.stringify(s)); } } };
}

function clock(start = T0) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('the reset time is the fullest window\'s, read from the status line', () => {
  // Value: protects=the owner sees when work starts again; fails_when=the wrong window or a past reset is picked; why_new=issue 124; seam=none
  const sec = (ms) => Math.floor(ms / 1000);
  const rl = {
    five_hour: { used_percentage: 99.2, resets_at: sec(T0 + 3 * HOUR) },
    seven_day: { used_percentage: 41.2, resets_at: sec(T0 + 90 * HOUR) }
  };
  assert.equal(resetFromRateLimits(rl, T0), sec(T0 + 3 * HOUR) * 1000);
  // The weekly window ran out instead.
  assert.equal(resetFromRateLimits({ ...rl, seven_day: { used_percentage: 100, resets_at: sec(T0 + 90 * HOUR) } }, T0), sec(T0 + 90 * HOUR) * 1000);
  // A window whose reset has passed is not the limit now.
  assert.equal(resetFromRateLimits({ five_hour: { used_percentage: 100, resets_at: sec(T0 - 1000) } }, T0), null);
  for (const junk of [null, undefined, 'x', 5, {}, { five_hour: null }, { five_hour: { used_percentage: 'a', resets_at: 1 } }]) {
    assert.equal(resetFromRateLimits(junk, T0), null, JSON.stringify(junk));
  }
});

test('a break checks after the reset and ends on the first finished turn', () => {
  // Value: protects=the office starts again by itself; fails_when=the break never ends or ends too soon; why_new=issue 124; seam=none
  const c = clock();
  const { box, store } = memoryStore();
  const b = new OfficeBreak(store, c.now);
  const reset = T0 + 3 * HOUR;
  b.noteRateLimits({ five_hour: { used_percentage: 98, resets_at: reset / 1000 } });
  assert.equal(b.view(), null);

  assert.equal(b.limitReached('sales'), 'started');
  assert.deepEqual(b.view(), { until: reset, checking: false, reason: 'limit', again: false });
  assert.equal(b.holding(), true);
  assert.equal(b.current().due, reset + RESET_GRACE_MS, 'checked a minute after the reset, after Claude Code\'s own continue');
  assert.equal(b.limitReached('god'), 'held', 'a second member hitting the limit is the same break');
  assert.deepEqual(b.current().cutOff, ['sales', 'god']);

  // A reply already on its way when the limit was reached does not end it,
  // however late it lands.
  c.t += 10 * 60_000;
  assert.equal(b.turnFinished('books'), null);
  assert.equal(b.tick(), null, 'nothing before the reset');

  // Saved: a restart during the break still shows it.
  const again = new OfficeBreak(store, c.now);
  assert.deepEqual(again.view(), { until: reset, checking: false, reason: 'limit', again: false });
  assert.deepEqual(again.current().cutOff, ['sales', 'god']);

  c.t = reset + RESET_GRACE_MS;
  assert.deepEqual(b.tick(), { step: 'check' });
  assert.equal(b.holding(), false, 'delivery opens so one turn can show the plan answers');
  assert.deepEqual(b.view(), { until: reset, checking: true, reason: 'limit', again: false });

  b.promptSubmitted('sales');
  assert.deepEqual(b.current().cutOff, ['god'], 'Claude Code continued Sales by itself, so the app does not');

  const ended = b.turnFinished('god');
  assert.equal(b.view(), null);
  assert.equal(box.state, null, 'the saved break is cleared');
  assert.deepEqual(ended.cutOff, [], 'the member whose turn ended it is not told to carry on');
});

test('while waiting, only a turn asked for after the limit ends the break', () => {
  // Value: protects=a reply in flight at the limit does not reopen delivery into dead sessions; fails_when=any late Stop ends the break, or a prompted turn that goes through does not; why_new=adversarial review (issue 124); seam=none
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  b.limitReached('sales');
  c.t += 5 * 60_000;
  assert.equal(b.turnFinished('books'), null, 'Books was mid reply when the limit was reached');
  b.promptSubmitted('books');
  assert.equal(b.limitReached('books'), 'held', 'its next request hit the limit too');
  assert.equal(b.turnFinished('books'), null, 'so its prompt no longer counts');
  b.promptSubmitted('books');
  const ended = b.turnFinished('books');
  assert.ok(ended, 'the owner typed to Books and its turn went through: the plan answers');
  assert.deepEqual(ended.cutOff, ['sales']);
  assert.equal(b.view(), null);
});

test('a break that started before any status line takes the reset time when one arrives', () => {
  // Value: protects=the office checks at the real reset, not 15 minutes of guessing; fails_when=a late reading is ignored, or a known time is replaced; why_new=adversarial review (issue 124); seam=none
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  b.limitReached('god');
  assert.equal(b.current().due, T0 + RETRY_MS);
  const reset = T0 + 2 * 60_000;
  assert.equal(b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: reset / 1000 } }), true);
  assert.deepEqual(b.view(), { until: reset, checking: false, reason: 'limit', again: false });
  assert.equal(b.current().due, reset + RESET_GRACE_MS);
  assert.equal(b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: (reset + HOUR) / 1000 } }), false, 'a known time is not replaced by a reading');
  assert.equal(new OfficeBreak(memoryStore().store, c.now).noteRateLimits({ five_hour: { used_percentage: 1, resets_at: reset / 1000 } }), false, 'no break, nothing to move');
});

test('a check that hits the limit again waits again; with no reset time it retries', () => {
  // Value: protects=a limit that is still on restarts the break instead of flooding terminals; fails_when=checking stays open or the unknown case never retries; why_new=issue 124; seam=none
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  assert.equal(b.limitReached('god'), 'started');
  assert.deepEqual(b.view(), { until: null, checking: false, reason: 'limit', again: false }, 'no status line reading: the time is unknown');
  assert.equal(b.current().due, T0 + RETRY_MS);

  c.t = T0 + RETRY_MS;
  assert.deepEqual(b.tick(), { step: 'check' });
  c.t += 5_000;
  assert.equal(b.limitReached('god'), 'again');
  assert.equal(b.holding(), true);
  assert.equal(b.current().due, c.t + RETRY_MS);

  // A check that hears nothing at all ends the break: no sign the limit is on.
  c.t = b.current().due;
  assert.deepEqual(b.tick(), { step: 'check' });
  c.t += CHECK_TIMEOUT_MS;
  const r = b.tick();
  assert.equal(r.step, 'over');
  assert.equal(b.view(), null);
});

test('a later reset moves the check; an earlier one does not pull it in', () => {
  // Value: protects=a weekly limit is not mistaken for the five hour one; fails_when=the check moves earlier while a window is still full; why_new=issue 124; seam=none
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: (T0 + 2 * HOUR) / 1000 } });
  b.limitReached('a');
  b.noteRateLimits({ seven_day: { used_percentage: 100, resets_at: (T0 + 30 * HOUR) / 1000 } });
  b.limitReached('b');
  assert.equal(b.view().until, T0 + 30 * HOUR);
  b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: (T0 + HOUR) / 1000 } });
  b.limitReached('c');
  assert.equal(b.view().until, T0 + 30 * HOUR);
  assert.equal(b.current().due, T0 + 30 * HOUR + RESET_GRACE_MS);
});

test('only Claude agents are held, and only while waiting', () => {
  // Value: protects=a member on another engine keeps working, and the check can run; fails_when=the break holds Codex or holds during the check; why_new=issue 124; seam=none
  assert.equal(heldByBreak(null, 'claude'), false);
  assert.equal(heldByBreak({ until: null, checking: false }, 'claude'), true);
  assert.equal(heldByBreak({ until: null, checking: false }, undefined), true, 'an agent with no engine named is on Claude');
  assert.equal(heldByBreak({ until: null, checking: false }, 'codex'), false);
  assert.equal(heldByBreak({ until: null, checking: true }, 'claude'), false);
});

test('the hook server passes on the usage limit, the reset times and finished turns', async (t) => {
  // Value: protects=the app hears the limit from Claude Code, not terminal text; fails_when=StopFailure rate_limit, rate_limits or Stop stop reaching the break; why_new=issue 124; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md office break '));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const inj = await hive.ensureAgent({ id: 'a1', name: 'Sales', provider: 'claude', cwd: home });
  const signals = [];
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, (s) => signals.push(s));
  const rl = { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } };

  server.handle({ agent_id: 'a1', hook_event_name: 'Status', context_window: { total_input_tokens: 1, context_window_size: 200000 }, rate_limits: rl });
  server.handle({ agent_id: 'a1', hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: 'API Error: Rate limit reached' });
  server.handle({ agent_id: 'a1', hook_event_name: 'StopFailure', error: 'overloaded' });
  server.handle({ agent_id: 'a1', subagent_id: 'sub', hook_event_name: 'StopFailure', error: 'rate_limit' });
  server.handle({ agent_id: 'a1', hook_event_name: 'UserPromptSubmit', prompt: 'go on' });
  server.handle({ agent_id: 'a1', hook_event_name: 'Stop' });
  server.handle({ agent_id: 'a1', hook_event_name: 'SubagentStop' });
  assert.deepEqual(signals, [
    { kind: 'limits', agentId: 'a1', rateLimits: rl },
    { kind: 'limit', agentId: 'a1', reason: 'limit' },
    { kind: 'prompt', agentId: 'a1' },
    { kind: 'turn', agentId: 'a1' }
  ], 'an overloaded server or a subagent is not the plan limit');

  // Claude Code calls the hook only on the stops (office-stopped-account.md).
  const settingsPath = inj.args[inj.args.indexOf('--settings') + 1];
  const hooks = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks;
  assert.equal(hooks.StopFailure[0].matcher, 'rate_limit|billing_error|authentication_failed');
  // Claude Code continues the task by itself at the reset, whatever the
  // owner's own Claude settings say (issue 36 terms).
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).autoContinueAtUsageLimit, true);
});

test('during a break nothing types into a Claude terminal, and schedules still run as configured', () => {
  // Value: protects=the break holds terminal nudges only, never a scheduled run (owner rule); fails_when=the wake beat or the queue types during a break, or a schedule is held or skipped; why_new=issue 124, aligned to the issue 36 terms; seam=source pin
  const index = read('src/main/index.ts');
  assert.match(index, /const fire = \(\): void => \{\s*try \{[\s\S]{0,200}sendMission\(m\);/);
  assert.doesNotMatch(index, /missionHeldByBreak|holdMission|officeBreak\.hold\(/, 'no schedule run is held, skipped or reshaped');
  assert.doesNotMatch(index.slice(index.indexOf('function armHeartbeat('), index.indexOf('function liveWebContents(')), /officeBreak/, 'the heartbeat runs as configured');
  assert.doesNotMatch(index.slice(index.indexOf('function standupOnOfficeOpen('), index.indexOf('function migrateMissionOwners(')), /officeBreak|Break/, 'the launch standup runs as configured');
  assert.match(index, /if \(heldByBreak\(officeBreak\.view\(\), a\?\.provider\)\) continue;/);
  assert.match(index, /persist\.open\(\); \} catch[^\n]*\n[^\n]*\n\s*armOfficeBreak\(\);/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /if \(heldByBreak\(getOfficeBreak\(\), target\.provider\) && !next\.manual\) return \{ sent: false \};/);
  // After a restart, the queue holds Claude terminals until main first says whether a saved break is on.
  assert.match(read('src/renderer/src/components/OfficeBreakNotice.tsx'), /return known \? view : \{ until: null, checking: false, reason: 'limit', again: false \};/);
  // Shown at the top of Needs you and in the top bar. The plan limit never
  // counts; a stop only the owner can fix does (office-stopped-account.md, D2).
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /<OfficeBreakCard \/>\s*<EngineSetupCard status=\{engineCard \? engineSetup : null\} \/>/);
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /<CliUpdateBadge \/>\s*<OfficeBreakChip \/>/);
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /if \(stopNeedsOwner\(merged\.stop\)\) feed = \{ \.\.\.feed, count: feed\.count \+ 1 \};/);
  assert.equal(stopNeedsOwner({ until: null, checking: false, reason: 'limit', again: false }), false, 'the plan limit never counts');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['title', 'body', 'bodyUnknown', 'info', 'chip', 'chipUnknown']) assert.equal(typeof j.officeBreak[k], 'string', `${loc} ${k}`);
    assert.match(j.officeBreak.body, /\{\{time\}\}/, loc);
    assert.equal(typeof j.badge.onBreak, 'string', loc);
    assert.doesNotMatch(JSON.stringify(j.officeBreak), /[–—]/, `${loc}: no dashes`);
  }
});

// ── Stops only the owner can fix (docs/designs/office-stopped-account.md) ──────

test('the hook passes on no credit and a sign in that stopped working; other errors end one turn only', async (t) => {
  // Value: protects=the three stops reach the office; fails_when=the matcher or the hooks.ts check stays rate_limit only; why_new=only rate_limit was heard; seam=none; no_claim=Claude Code firing the hook live (payload shape from its schema)
  assert.equal(STOP_FAILURE_MATCHER, 'rate_limit|billing_error|authentication_failed');
  assert.equal(stopReasonFor('billing_error'), 'credit');
  assert.equal(stopReasonFor('authentication_failed'), 'signin');
  assert.equal(stopReasonFor('rate_limit'), 'limit');
  for (const e of ['server_error', 'invalid_request', 'unknown', 'constructor', '', null, 5]) assert.equal(stopReasonFor(e), null, String(e));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md office stop '));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'Sales', provider: 'claude', cwd: home });
  const signals = [];
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, (s) => signals.push(s));
  server.handle({ agent_id: 'a1', hook_event_name: 'StopFailure', error: 'billing_error', last_assistant_message: 'Credit balance is too low' });
  server.handle({ agent_id: 'a1', hook_event_name: 'StopFailure', error: 'authentication_failed', last_assistant_message: 'Login expired' });
  server.handle({ agent_id: 'a1', hook_event_name: 'StopFailure', error: 'server_error' });
  assert.deepEqual(signals, [
    { kind: 'limit', agentId: 'a1', reason: 'credit' },
    { kind: 'limit', agentId: 'a1', reason: 'signin' }
  ]);
});

test('a credit or sign in stop has no reset time, checks every 15 minutes, and says when it is still out', () => {
  // Value: protects=an owner who pays and walks away gets the office back, and the card never shows a plan reset time; fails_when=lastReset leaks into a credit stop, the recheck is lost, or again is never set; why_new=new states (eng R2); seam=injected clock (existing); no_claim=Anthropic billing latency
  const c = clock();
  const { box, store } = memoryStore();
  const b = new OfficeBreak(store, c.now);
  // A plan reset read earlier must not become the credit stop's time.
  b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: Math.floor((T0 + HOUR) / 1000) } });
  assert.equal(b.limitReached('god', 'credit'), 'started');
  assert.deepEqual(b.view(), { until: null, checking: false, reason: 'credit', again: false });
  assert.equal(b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: Math.floor((T0 + HOUR) / 1000) } }), false, 'no reset time for credit');
  assert.equal(box.state.due, T0 + RETRY_MS);
  assert.equal(b.limitReached('a1', 'credit'), 'held', 'another member hitting the same stop changes nothing but cutOff');
  assert.deepEqual(box.state.cutOff, ['god', 'a1']);
  c.t = T0 + RETRY_MS;
  assert.deepEqual(b.tick(), { step: 'check' }, 'the 15 minute recheck');
  assert.equal(b.view().checking, true);
  // The check hit the same stop: still out.
  assert.equal(b.limitReached('god', 'credit'), 'again');
  assert.deepEqual(b.view(), { until: null, checking: false, reason: 'credit', again: true });
  // Try again: check now, then the first finished turn ends it.
  assert.equal(b.ownerRetry(), true);
  assert.equal(b.ownerRetry(), false, 'nothing waits while checking');
  const ended = b.turnFinished('god');
  assert.equal(ended.reason, 'credit');
  assert.deepEqual(ended.cutOff, ['a1']);
  assert.equal(b.view(), null);
});

test('a key that stopped working waits for the owner; an expired account login rechecks', () => {
  // Value: protects=no pointless recheck on a dead key, and no lost office on an expired login; fails_when=manual is ignored or set for account sign in; why_new=eng R2; seam=injected clock; no_claim=whether a fresh sign in reaches running terminals (T3 live check)
  const c = clock();
  const key = new OfficeBreak(memoryStore().store, c.now);
  assert.equal(key.limitReached('god', 'signin', false), 'started');
  c.t = T0 + 10 * RETRY_MS;
  assert.equal(key.tick(), null, 'no timer for a key stop');
  assert.equal(key.ownerRetry(), true, 'a saved key checks');
  const account = new OfficeBreak(memoryStore().store, clock().now);
  account.limitReached('god', 'signin', true);
  assert.equal(account.current().manual, false);
});

test('a credit or sign in stop ends only on a finished turn, never on a check that heard nothing', () => {
  // Value: protects=the team is not handed work on an account that still cannot run it; fails_when=a silent check ends a credit or sign in stop; why_new=TODOS "End a credit or sign in stop only on a finished turn"; seam=injected clock
  for (const reason of ['credit', 'signin']) {
    const c = clock();
    const { box, store } = memoryStore();
    const b = new OfficeBreak(store, c.now);
    b.limitReached('god', reason);
    c.t = T0 + RETRY_MS;
    assert.deepEqual(b.tick(), { step: 'check' });
    c.t += CHECK_TIMEOUT_MS;
    assert.deepEqual(b.tick(), { step: 'wait' }, `${reason}: silence says nothing about the account`);
    assert.equal(b.holding(), true, 'terminals are held again');
    assert.equal(box.state.due, c.t + RETRY_MS, 'and checked again later');
    // After a restart the stop is still there, and a finished turn ends it.
    const restarted = new OfficeBreak(store, c.now);
    assert.equal(restarted.view().reason, reason);
    c.t += RETRY_MS;
    assert.deepEqual(restarted.tick(), { step: 'check' });
    assert.equal(restarted.turnFinished('god').reason, reason);
    assert.equal(restarted.view(), null);
  }
});

test('a plan limit check that hears nothing still ends the break, and a key check waits for the owner again', () => {
  // Value: protects=the plan limit keeps its old ending, and an owner's key check never loops; fails_when=the wait applies to the plan limit or clears manual; why_new=same TODO; seam=injected clock
  const c = clock();
  const limit = new OfficeBreak(memoryStore().store, c.now);
  limit.limitReached('god');
  c.t = T0 + RETRY_MS;
  assert.deepEqual(limit.tick(), { step: 'check' });
  c.t += CHECK_TIMEOUT_MS;
  assert.equal(limit.tick().step, 'over');
  const key = new OfficeBreak(memoryStore().store, c.now);
  key.limitReached('god', 'signin', false);
  assert.equal(key.ownerRetry(), true);
  c.t += CHECK_TIMEOUT_MS;
  assert.deepEqual(key.tick(), { step: 'wait' });
  assert.equal(key.current().manual, true);
  c.t += 10 * RETRY_MS;
  assert.equal(key.tick(), null, 'only the owner checks again');
});

test('the app keeps the stop on screen when a check heard nothing', () => {
  // Value: protects=main republishes the stop and arms the next check; fails_when=runOfficeBreakTick ignores the wait step; why_new=index.ts needs Electron; seam=source pin
  assert.match(read('src/main/index.ts'), /if \(r\.step === 'wait'\) \{[\s\S]{0,250}armOfficeBreak\(\);\s*publishOfficeBreak\(\);\s*return;\s*\}/);
});

test('a stop only the owner can fix is never hidden behind a plan limit', () => {
  // Value: protects=eng R4; fails_when=the latest reason always wins; why_new=new rule; seam=none; no_claim=none beyond protects
  const limitFirst = new OfficeBreak(memoryStore().store, clock().now);
  limitFirst.limitReached('god', 'limit');
  assert.equal(limitFirst.limitReached('a1', 'credit'), 'started', 'credit replaces a plan limit');
  assert.deepEqual(limitFirst.view(), { until: null, checking: false, reason: 'credit', again: false });
  const creditFirst = new OfficeBreak(memoryStore().store, clock().now);
  creditFirst.limitReached('god', 'credit');
  assert.equal(creditFirst.limitReached('a1', 'limit'), 'held');
  assert.equal(creditFirst.view().reason, 'credit', 'a limit during a credit stop keeps the credit card');
  assert.deepEqual(creditFirst.current().cutOff, ['god', 'a1']);
});

test('a break saved by an older build reads as the plan limit', () => {
  // Value: protects=an upgrade during a break; fails_when=a state without reason breaks the card or the timer; why_new=new field; seam=none; no_claim=none beyond protects
  const old = { phase: 'waiting', since: T0, until: null, due: T0 + RETRY_MS, cutOff: ['god'], prompted: [] };
  const b = new OfficeBreak(memoryStore(old).store, clock().now);
  assert.deepEqual(b.view(), { until: null, checking: false, reason: 'limit', again: false });
  assert.equal(b.current().manual, false);
});

test('the office says the real cause to the owner, Michael and the team, and resumes without a restart', () => {
  // Value: protects=eng R1 words per reason, B1 (no restart except a new key), the fixed billing address and one sign in card; fails_when=a reason falls back to plan limit words, the check restarts terminals, or the page can choose the address; why_new=new behavior; seam=source pins; no_claim=Claude Code resuming live after credit is added (owner's live test, B1)
  const index = read('src/main/index.ts');
  assert.match(index, /start: 'The office stopped\. Your Anthropic account is out of credit\.'/);
  assert.match(index, /start: 'The office stopped\. The Anthropic API key stopped working\.'/);
  assert.match(index, /start: 'The office stopped\. Your Claude account needs you to sign in again\.'/);
  assert.match(index, /const carry = 'Continue the task you were working on when it stopped; do not repeat work that is already done\.';/);
  assert.match(index, /subject: 'Usage limit reset'/, 'the plan limit words stay');
  assert.match(index, /hive\.send\(\{ to: id, act: 'inform', subject: words\.subject, body: words\.carryOn \}, 'system'\);/);
  assert.match(index, /const ANTHROPIC_BILLING_URL = 'https:\/\/platform\.claude\.com\/settings\/billing';/);
  assert.match(index, /ipcMain\.handle\('office:addCredit', \(\) => \{ void shell\.openExternal\(ANTHROPIC_BILLING_URL\); return \{ ok: true \}; \}\);/, 'no address from the page');
  assert.match(index, /ipcMain\.handle\('office:retry', \(\) => \(\{ ok: ownerRetryOffice\(\) \}\)\);/);
  // The check only sends Michael the next message; only a new key restarts (B1).
  const check = index.slice(index.indexOf('function sendOfficeCheck('), index.indexOf('function ownerRetryOffice('));
  assert.doesNotMatch(check, /respawn|restart|kill/i);
  assert.match(index, /if \(officeBreak\.view\(\)\?\.reason === 'signin'\) \{\s*try \{ liveWebContents\(\)\?\.send\('office:restartClaude', runningClaudePtys\(\)\); \}/);
  assert.match(index, /const retry = !\(signal\.reason === 'signin' && readConfig\(\)\.claudeAuth === 'apiKey'\);/);
  // One sign in card while a sign in stop is on (eng R3).
  const needs = read('src/renderer/src/shell/useNeedsYou.ts');
  assert.match(needs, /return !!\(f\.engineSetup\?\.applies && f\.engineSetup\.needed\) && f\.stop\?\.reason !== 'signin';/);
  assert.match(needs, /if \(setupCardShown\(merged\)\) feed = \{ \.\.\.feed, count: feed\.count \+ 1 \};/);
  // The card: plain, its action per reason, Add credit spoken as leaving the app.
  const card = read('src/renderer/src/components/OfficeBreakNotice.tsx');
  assert.match(card, /<span className="cth-sr-only"> \{t\('markdown\.opensInBrowser'\)\}<\/span>/);
  assert.match(card, /window\.cth\.officeAddCredit\?\.\(\)/);
  assert.doesNotMatch(card.slice(card.indexOf('const stopCard'), card.indexOf('function LimitBreakCard')), /border(Left|InlineStart)|inset 3px/, 'no side rule (design D5)');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['title', 'credit', 'creditAgain', 'signIn', 'keyStopped', 'checking', 'addCredit', 'tryAgain', 'signInAction', 'changeKey', 'chip', 'creditInfo', 'signInInfo', 'keyInfo']) {
      assert.equal(typeof j.officeStop[k], 'string', `${loc} ${k}`);
    }
    assert.doesNotMatch(JSON.stringify(j.officeStop), /[–—]| - /, `${loc}: no dashes`);
  }
});

test('a new key that fails again waits for the owner again, with no automatic check', () => {
  // Value: protects=a key that still does not work never reads as fixed or loops on rechecks; fails_when=the second failure starts an automatic check or clears manual; why_new=testing review (ship 2026-10-13); seam=none; no_claim=the Claude call itself (signals are fed in)
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  assert.equal(b.limitReached('god', 'signin', false), 'started');
  assert.equal(b.ownerRetry(), true, 'a saved key checks');
  assert.equal(b.limitReached('god', 'signin', false), 'again');
  assert.equal(b.current().manual, true);
  c.t = T0 + 10 * RETRY_MS;
  assert.equal(b.tick(), null, 'only the owner ends it');
});

test('Get Michael ready shows unless a sign in stop already asks the same thing', () => {
  // Value: protects=the owner is asked to sign in once, by one card; fails_when=setupCardShown counts the setup card during a sign in stop or hides it for credit; why_new=only a source pin covered it (testing review, third ship); seam=none
  const { setupCardShown } = loadTs('src/renderer/src/shell/useNeedsYou.ts');
  const need = { applies: true, needed: true };
  const stop = (reason) => ({ until: null, checking: false, reason, again: false });
  assert.equal(setupCardShown({ engineSetup: need, stop: null }), true);
  assert.equal(setupCardShown({ engineSetup: need, stop: stop('signin') }), false);
  assert.equal(setupCardShown({ engineSetup: need, stop: stop('credit') }), true);
  assert.equal(setupCardShown({ engineSetup: { applies: true, needed: false }, stop: null }), false);
});
