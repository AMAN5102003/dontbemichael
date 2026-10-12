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
const { heldByBreak } = loadTs('src/shared/officeBreak.ts');
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
  assert.deepEqual(b.view(), { until: reset, checking: false });
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
  assert.deepEqual(again.view(), { until: reset, checking: false });
  assert.deepEqual(again.current().cutOff, ['sales', 'god']);

  c.t = reset + RESET_GRACE_MS;
  assert.deepEqual(b.tick(), { step: 'check' });
  assert.equal(b.holding(), false, 'delivery opens so one turn can show the plan answers');
  assert.deepEqual(b.view(), { until: reset, checking: true });

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
  assert.deepEqual(b.view(), { until: reset, checking: false });
  assert.equal(b.current().due, reset + RESET_GRACE_MS);
  assert.equal(b.noteRateLimits({ five_hour: { used_percentage: 100, resets_at: (reset + HOUR) / 1000 } }), false, 'a known time is not replaced by a reading');
  assert.equal(new OfficeBreak(memoryStore().store, c.now).noteRateLimits({ five_hour: { used_percentage: 1, resets_at: reset / 1000 } }), false, 'no break, nothing to move');
});

test('a check that hits the limit again waits again; with no reset time it retries', () => {
  // Value: protects=a limit that is still on restarts the break instead of flooding terminals; fails_when=checking stays open or the unknown case never retries; why_new=issue 124; seam=none
  const c = clock();
  const b = new OfficeBreak(memoryStore().store, c.now);
  assert.equal(b.limitReached('god'), 'started');
  assert.deepEqual(b.view(), { until: null, checking: false }, 'no status line reading: the time is unknown');
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
    { kind: 'limit', agentId: 'a1' },
    { kind: 'prompt', agentId: 'a1' },
    { kind: 'turn', agentId: 'a1' }
  ], 'an overloaded server or a subagent is not the plan limit');

  // Claude Code calls the hook only on the usage limit.
  const settingsPath = inj.args[inj.args.indexOf('--settings') + 1];
  const hooks = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks;
  assert.equal(hooks.StopFailure[0].matcher, 'rate_limit');
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
  assert.match(read('src/renderer/src/components/OfficeBreakNotice.tsx'), /return known \? view : \{ until: null, checking: false \};/);
  // Shown at the top of Needs you and in the top bar, never in the count.
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /<OfficeBreakCard \/>\s*<EngineSetupCard/);
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /<CliUpdateBadge \/>\s*<OfficeBreakChip \/>/);
  assert.doesNotMatch(read('src/renderer/src/shell/useNeedsYou.ts'), /officeBreak|OfficeBreak/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['title', 'body', 'bodyUnknown', 'info', 'chip', 'chipUnknown']) assert.equal(typeof j.officeBreak[k], 'string', `${loc} ${k}`);
    assert.match(j.officeBreak.body, /\{\{time\}\}/, loc);
    assert.equal(typeof j.badge.onBreak, 'string', loc);
    assert.doesNotMatch(JSON.stringify(j.officeBreak), /[–—]/, `${loc}: no dashes`);
  }
});
