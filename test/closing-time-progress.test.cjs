'use strict';

/**
 * Closing time (src/main/closingTime.ts).
 *
 * The first block pins down the protocol as it stood before the progress
 * rows were added (eng review R2, 2026-09-29: written and passing against the
 * old code first, so the refactor could not quietly change them). The rule
 * that matters most: the app never closes while a live team member has not
 * confirmed its work is saved.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { ClosingTimeController } = loadTs('src/main/closingTime.ts');

/** A floor: Michael (god) plus workers, all with live terminals unless told. */
function floor(opts = {}) {
  const agents = { god: { id: 'god', name: 'Michael', isGod: true } };
  for (const id of opts.workers ?? ['pam', 'dwight']) agents[id] = { id, name: id[0].toUpperCase() + id.slice(1) };
  for (const id of opts.archived ?? []) agents[id].archived = true;
  let live = opts.live ?? Object.keys(agents);
  const sent = [];
  const events = [];
  const steers = [];
  const cleared = [];
  const removed = [];
  let failWhen = null;
  let concluded = 0;
  const hive = {
    registry: () => ({ godId: 'god', agents }),
    send: (msg, from) => { if (failWhen?.(msg)) throw new Error('inbox write failed'); sent.push({ ...msg, from }); }
  };
  const control = opts.control ?? {
    steer: (id, text) => steers.push({ id, text }),
    clearSteers: (id) => cleared.push(id),
    removeSteer: (id, text) => removed.push({ id, text })
  };
  const ct = new ClosingTimeController(
    hive,
    () => live,
    () => ({ send: (channel, ev) => { if (channel === 'app:closingTime') events.push(ev); } }),
    () => { concluded++; },
    control
  );
  const route = (from, subject, targets = ['god']) => ct.onRouted({ from, subject, to: targets[0] }, targets);
  // Closing time arms a 6-minute timer; cancel it so the test process ends.
  opts.t?.after(() => ct.cancel());
  return { ct, sent, events, steers, cleared, removed, route, floorAgents: agents, setLive: (ids) => { live = ids; }, failSend: (pred) => { failWhen = pred; }, get concluded() { return concluded; } };
}

const last = (events) => events[events.length - 1];

// ── The protocol before the progress rows (characterization, R2) ──────────

test('closing time refuses to start without a live Michael', (t) => {
  const f = floor({ t, live: ['pam', 'dwight'] });
  const r = f.ct.start();
  assert.equal(r.ok, false);
  assert.match(r.error, /orchestrator/i);
  assert.equal(f.ct.isActive(), false);
});

test('an ACK counts only from a team member being waited on, and only when it reached Michael', (t) => {
  const f = floor({ t });
  f.ct.start();
  f.route('stranger', 'CLOSING-TIME-ACK');
  f.route('pam', 'CLOSING-TIME-ACK', ['dwight']);
  assert.equal(last(f.events).acked, 0, 'neither a stranger nor a mis-addressed ACK counts');
  f.route('pam', 'closing time ack');
  assert.equal(last(f.events).acked, 1, 'the subject is matched forgivingly');
  assert.equal(last(f.events).total, 2);
});

test('only Michael can conclude closing time', (t) => {
  const f = floor({ t, workers: [] });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.notEqual(last(f.events).phase, 'complete');
});

test('an early COMPLETE is refused and Michael is told who is still missing', (t) => {
  const f = floor({ t });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.notEqual(last(f.events).phase, 'complete');
  const refusal = f.sent.find((m) => m.act === 'refuse');
  assert.ok(refusal, 'Michael gets a refusal');
  assert.match(refusal.body, /Dwight \(dwight\)/);
  assert.doesNotMatch(refusal.body, /Pam/);
});

test('a team member whose terminal died or who was archived is not waited on', (t) => {
  // Characterization (R2): uses only the pre-branch API, so it also runs on main's closingTime.ts.
  const f = floor({ t, workers: ['pam', 'dwight', 'jim', 'kevin'] });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.setLive(['god', 'pam', 'jim', 'kevin']); // Dwight's terminal ended
  f.floorAgents.kevin.archived = true; // Kevin was archived mid-close, terminal still up
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.notEqual(last(f.events).phase, 'complete', 'Jim is live and has not confirmed');
  const refusal = f.sent.filter((m) => m.act === 'refuse').pop();
  assert.match(refusal.body, /Jim \(jim\)/);
  assert.doesNotMatch(refusal.body, /Dwight|Kevin/, 'neither the dead nor the archived one is waited on');
  f.route('jim', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'complete');
});

test('the rows list neither a dead nor an archived team member', (t) => {
  // Value: protects=an archived agent is never waited on or listed; fails_when=pendingIds drops the archived filter; why_new=split from the characterization test above; seam=none
  const f = floor({ t, workers: ['pam', 'dwight', 'jim', 'kevin'] });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.setLive(['god', 'pam', 'jim', 'kevin']);
  f.floorAgents.kevin.archived = true;
  f.ct.refresh();
  assert.deepEqual(last(f.events).waiting, ['jim']);
});

test('COMPLETE closes the app after the grace, not before', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t, workers: ['pam'] });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'complete');
  assert.equal(f.concluded, 0);
  t.mock.timers.tick(2_499);
  assert.equal(f.concluded, 0);
  t.mock.timers.tick(1);
  assert.equal(f.concluded, 1);
});

// ── Who is still working (owner, 2026-09-29) ─────────────────────────────

test('every update names who confirmed, who is still working, and Michael', (t) => {
  const f = floor({ t, workers: ['pam', 'dwight', 'jim'] });
  f.ct.start();
  assert.deepEqual(last(f.events), { phase: 'started', acked: 0, total: 3, confirmed: [], waiting: ['pam', 'dwight', 'jim'], excused: [], godId: 'god', godLive: true, relaunch: false });
  f.route('dwight', 'CLOSING-TIME-ACK');
  assert.deepEqual(last(f.events).confirmed, ['dwight']);
  assert.deepEqual(last(f.events).waiting, ['pam', 'jim']);
});

test('a terminal that ends mid-close drops off the list on refresh', (t) => {
  const f = floor({ t, workers: ['pam', 'dwight'] });
  f.ct.start();
  f.setLive(['god', 'pam']);
  f.ct.refresh();
  assert.deepEqual(last(f.events).waiting, ['pam']);
  assert.equal(last(f.events).phase, 'progress');
});

test('refresh does nothing outside closing time, and never reopens a completed close', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t, workers: ['pam'] });
  f.ct.refresh();
  assert.equal(f.events.length, 0, 'not running: nothing sent');
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  const n = f.events.length;
  f.ct.refresh(); // e.g. a terminal ending during the 2.5 s grace
  assert.equal(f.events.length, n);
  assert.equal(last(f.events).phase, 'complete');
  assert.deepEqual(last(f.events).waiting, []);
  // Value: protects=Remind and Close without them do nothing once the close concluded; fails_when=the concluded guard is dropped from remind/excuse; why_new=only refresh was checked in the grace; seam=none
  const mail = f.sent.length;
  assert.equal(f.ct.remind('god', 99_000).ok, false, 'no reminder during the teardown grace');
  assert.equal(f.ct.excuse('pam').ok, false);
  assert.equal(f.sent.length, mail, 'nothing mailed after COMPLETE');
  assert.equal(f.events.length, n, 'and the rows are not reopened');
});

test('Remind re-sends the note to that one agent: steer plus inbox mail, once per 30 s', (t) => {
  const f = floor({ t });
  f.ct.start();
  const steers = f.steers.length;
  assert.deepEqual(f.ct.remind('pam', 1_000), { ok: true });
  assert.equal(f.steers.length, steers + 1);
  assert.equal(f.steers[f.steers.length - 1].id, 'pam');
  const mail = f.sent.filter((m) => m.to === 'pam' && m.subject === 'Closing time: reminder');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, /CLOSING-TIME-ACK/);
  assert.deepEqual(f.ct.remind('pam', 20_000), { ok: true }, 'a double click is not an error');
  assert.equal(f.sent.filter((m) => m.to === 'pam').length, 1, 'but sends nothing within 30 s');
  f.ct.remind('pam', 31_001);
  assert.equal(f.sent.filter((m) => m.to === 'pam').length, 2);
  // Value: protects=the 30 s limit is per agent, so reminding one does not silence another; fails_when=the limit is kept as one shared timestamp; why_new=only one agent was reminded; seam=none
  assert.deepEqual(f.ct.remind('dwight', 31_002), { ok: true });
  assert.equal(f.sent.filter((m) => m.to === 'dwight' && m.subject === 'Closing time: reminder').length, 1);
});

test('a Remind whose note fails is reported as not sent, steers nothing, and can be retried at once', (t) => {
  // Value: protects=a failed reminder note is never shown as success; fails_when=remind returns ok:true or keeps its 30 s limit after the mail throws; why_new=review R18 (owner, 2026-09-29); seam=none
  const f = floor({ t });
  f.ct.start();
  const steers = f.steers.length;
  f.failSend((msg) => msg.subject === 'Closing time: reminder');
  t.mock.method(console, 'error', () => {});
  let r;
  assert.doesNotThrow(() => { r = f.ct.remind('pam', 1_000); });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be sent/);
  assert.equal(f.steers.length, steers, 'no steer until the note goes out');
  f.failSend(() => false);
  assert.deepEqual(f.ct.remind('pam', 2_000), { ok: true }, 'no 30 s wait after a failure');
  assert.equal(f.steers.length, steers + 1, 'exactly one steer after the retry');
  assert.equal(f.sent.filter((m) => m.to === 'pam' && m.subject === 'Closing time: reminder').length, 1);
});

test('Remind reaches Michael too, with his own note', (t) => {
  const f = floor({ t });
  f.ct.start();
  assert.deepEqual(f.ct.remind('god', 1), { ok: true });
  const mail = f.sent.filter((m) => m.to === 'god' && m.subject === 'Closing time: reminder');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, /CLOSING-TIME-COMPLETE/);
});

test('Remind and Close without them refuse when there is nothing to act on', (t) => {
  const f = floor({ t });
  assert.equal(f.ct.remind('pam').ok, false, 'not running');
  assert.equal(f.ct.excuse('pam').ok, false, 'not running');
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  assert.equal(f.ct.remind('pam').ok, false, 'already confirmed');
  assert.equal(f.ct.remind('stranger').ok, false, 'not on the floor');
  assert.equal(f.ct.remind(42).ok, false, 'not an id');
  assert.equal(f.ct.excuse('god').ok, false, 'never without Michael');
  assert.equal(f.ct.excuse('pam').ok, false, 'already confirmed');
});

test('Close without them lets the office close without that one agent, and tells Michael', (t) => {
  const f = floor({ t, workers: ['pam', 'dwight'] });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  // Value: protects=an agent closed without gets no queued closing-time steer; fails_when=excuse stops clearing that agent's steers; why_new=the fixture's clearSteers was a no-op; seam=none
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true });
  assert.deepEqual(f.removed.map((r) => r.id), ['dwight'], "only Dwight's pending closing-time steer is dropped");
  assert.deepEqual(f.cleared, [], 'no whole-queue clear');
  assert.deepEqual(last(f.events).excused, ['dwight']);
  assert.deepEqual(last(f.events).waiting, []);
  const told = f.sent.find((m) => m.to === 'god' && m.act === 'inform');
  assert.match(told.subject, /closing without Dwight/);
  assert.equal(f.ct.excuse('dwight').ok, false, 'only once');
  assert.equal(f.ct.remind('dwight').ok, false, 'no reminders once closed without');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'complete', 'no refusal for Dwight');
});

test('Close without them still refuses an early COMPLETE while someone else is working', (t) => {
  const f = floor({ t, workers: ['pam', 'dwight'] });
  f.ct.start();
  f.ct.excuse('dwight');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.notEqual(last(f.events).phase, 'complete');
  assert.match(f.sent.find((m) => m.act === 'refuse').body, /Pam \(pam\)/);
});

test('an agent closed without that confirms anyway moves to confirmed, never both', (t) => {
  const f = floor({ t, workers: ['pam'] });
  f.ct.start();
  f.ct.excuse('pam');
  f.route('pam', 'CLOSING-TIME-ACK');
  assert.deepEqual(last(f.events).confirmed, ['pam']);
  assert.deepEqual(last(f.events).excused, []);
});

test('cancelling clears the list, so the next closing time starts fresh', (t) => {
  const f = floor({ t, workers: ['pam', 'dwight'] });
  f.ct.start();
  f.ct.remind('pam', 1_000);
  f.ct.excuse('dwight');
  f.ct.cancel();
  f.ct.start();
  assert.deepEqual(last(f.events).excused, []);
  assert.deepEqual(last(f.events).waiting, ['pam', 'dwight']);
  const before = f.sent.filter((m) => m.to === 'pam').length;
  f.ct.remind('pam', 2_000);
  assert.equal(f.sent.filter((m) => m.to === 'pam').length, before + 1, 'the 30 s limit did not carry over');
});

test('after the 6-minute timeout the list stays, and Remind and Close without them still work', (t) => {
  // Value: protects=the timeout view keeps the waiting rows and their actions; fails_when=timeout ends the run (active/concluded) so the buttons fail; why_new=no test reached the timeout; seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t, workers: ['pam', 'dwight'] });
  f.ct.start();
  t.mock.timers.tick(6 * 60_000);
  assert.equal(last(f.events).phase, 'timeout');
  assert.deepEqual(last(f.events).waiting, ['pam', 'dwight']);
  assert.deepEqual(f.ct.remind('pam', 1), { ok: true });
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true });
  assert.deepEqual(last(f.events).waiting, ['pam']);
  assert.deepEqual(last(f.events).excused, ['dwight']);
});

test('Close without them stops no terminal: the agent must come back tomorrow', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/closingTime.ts'), 'utf8');
  const start = src.indexOf('  excuse(id: unknown)');
  const end = src.indexOf('  refresh(agentId');
  assert.ok(start >= 0 && end > start, 'excuse() found and bounded; update the markers if its neighbours are renamed');
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /kill|teardownPty/, 'pty:kill archives the agent (index.ts teardownPty)');
});

// ── Pre-landing review fixes (ship, 2026-09-29) ───────────────────────────

test('Close without them changes nothing when the note to Michael fails, so the owner can retry', (t) => {
  // Value: protects=the app never stops waiting on an agent Michael was not told about; fails_when=excuse keeps the agent excused after the mail throws; why_new=only the Remind mail failure was covered; seam=none
  const f = floor({ t });
  f.ct.start();
  f.failSend((m) => /closing without/.test(m.subject));
  t.mock.method(console, 'error', () => {});
  const n = f.events.length;
  const r = f.ct.excuse('dwight');
  assert.equal(r.ok, false);
  assert.match(r.error, /Michael could not be told/);
  assert.equal(f.events.length, n, 'no row change');
  assert.deepEqual(f.removed, [], 'its steer is kept');
  f.failSend(() => false);
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true }, 'a retry works');
  assert.deepEqual(last(f.events).excused, ['dwight']);
});

test('a terminal ending that is not on the list (an ephemeral worker) sends nothing', (t) => {
  // Value: protects=routine worker exits do not disturb the dialog; fails_when=refresh ignores the ended agent id; why_new=refresh was only tested for listed agents; seam=none
  const f = floor({ t });
  f.ct.start();
  const n = f.events.length;
  f.ct.refresh('worker-123');
  assert.equal(f.events.length, n);
  f.ct.refresh('pam');
  assert.equal(f.events.length, n + 1);
});

test('after the timeout, row updates keep the "still wrapping up" view', (t) => {
  // Value: protects=the timeout explanation stays up while rows change; fails_when=refresh/excuse emit plain progress after the timeout; why_new=timeout phase was not checked on refresh; seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t });
  f.ct.start();
  t.mock.timers.tick(6 * 60_000);
  assert.equal(last(f.events).phase, 'timeout');
  f.ct.refresh('pam');
  assert.equal(last(f.events).phase, 'timeout');
  f.ct.excuse('dwight');
  assert.equal(last(f.events).phase, 'timeout');
  f.ct.start(); // "keep waiting" from the timeout view re-arms
  assert.equal(last(f.events).phase, 'progress');
});

test('Remind for Michael is refused when his terminal has ended', (t) => {
  // Value: protects=the owner is not told a reminder went to a dead Michael; fails_when=remind(god) skips the liveness check; why_new=remind(god) was only tested live; seam=none
  const f = floor({ t });
  f.ct.start();
  f.setLive(['pam', 'dwight']);
  const r = f.ct.remind('god', 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /Michael/);
});

test('after the timeout, a late ACK or a refused early COMPLETE keeps the "still wrapping up" view', (t) => {
  // Value: protects=the timeout view does not flicker back as confirmations trickle in; fails_when=onRouted emits plain progress after the timeout; why_new=review R15 (owner, 2026-09-29); seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t });
  f.ct.start();
  t.mock.timers.tick(6 * 60_000);
  f.route('pam', 'CLOSING-TIME-ACK');
  assert.equal(last(f.events).phase, 'timeout');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'timeout', 'refused: Dwight is still working');
});

test('a waited-on terminal that ends mid-close: Michael is told once not to wait for it', (t) => {
  // Value: protects=Michael never waits for an ACK that can never come while the rows look done; fails_when=refresh drops the row without telling Michael; why_new=review R16 (owner, 2026-09-29); seam=none
  const f = floor({ t });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  f.ct.refresh('dwight');
  const notes = f.sent.filter((m) => m.to === 'god' && /Dwight's terminal ended/.test(m.subject));
  assert.equal(notes.length, 1, 'told once');
  assert.match(notes[0].body, /Do not wait for it/);
  assert.deepEqual(last(f.events).waiting, []);
  f.ct.refresh('pam');
  assert.equal(f.sent.filter((m) => /terminal ended/.test(m.subject)).length, 1, 'a confirmed agent ending needs no note');
});

test('a terminal that ends after the owner closed without it sends Michael no second note', (t) => {
  // Value: protects=Michael gets one clear note per agent he need not wait for; fails_when=tellMichaelAboutEnded drops its excused filter; why_new=only the confirmed-agent case was checked; seam=none
  const f = floor({ t });
  f.ct.start();
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true });
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  assert.equal(f.sent.filter((m) => /terminal ended/.test(m.subject)).length, 0);
  assert.deepEqual(last(f.events).excused, ['dwight'], 'still listed as closed without');
});

test('a failed "terminal ended" note is retried on the next row update, then sent once', (t) => {
  // Value: protects=Michael is eventually told not to wait for an ended terminal; fails_when=the note is marked sent before it goes out; why_new=review pass 3 (owner, 2026-09-29); seam=none
  const f = floor({ t });
  f.ct.start();
  f.failSend((m) => /terminal ended/.test(m.subject));
  t.mock.method(console, 'error', () => {});
  f.setLive(['god', 'pam']);
  assert.doesNotThrow(() => f.ct.refresh('dwight'));
  assert.deepEqual(last(f.events).waiting, ['pam'], 'the row still goes');
  f.failSend(() => false);
  f.route('pam', 'CLOSING-TIME-ACK'); // any later row update retries
  f.ct.refresh('pam');
  assert.equal(f.sent.filter((m) => /Dwight's terminal ended/.test(m.subject)).length, 1);
});

test('a team member archived mid-close leaves the rows, and Michael is told once not to wait', (t) => {
  // Value: protects=Michael stops waiting for someone the owner archived; fails_when=refresh only notes ended terminals, not an archived one still running; why_new=TODOS "Archiving a live agent during closing time"; seam=none
  const f = floor({ t });
  f.ct.start();
  f.floorAgents.dwight.archived = true;
  f.ct.refresh('dwight');
  f.ct.refresh('dwight');
  const notes = f.sent.filter((m) => m.to === 'god' && /Dwight was archived/.test(m.subject));
  assert.equal(notes.length, 1, 'told once');
  assert.match(notes[0].body, /^Dwight \(dwight\) was archived, so no CLOSING-TIME-ACK will come from them\. Do not wait for it/);
  assert.deepEqual(last(f.events).waiting, ['pam']);
  assert.equal(f.sent.filter((m) => /terminal ended/.test(m.subject)).length, 0);
});

test('archiving from the panel or by voice refreshes closing time', () => {
  // Value: protects=both archive paths reach the controller; fails_when=an archive path stops calling closingTime.refresh; why_new=index.ts can't be loaded in a test; seam=source pin
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const ipc = src.slice(src.indexOf("ipcMain.handle('hive:setArchived'"));
  assert.match(ipc.slice(0, ipc.indexOf('});')), /hive\.setArchived\(id, archived === true\);\s*\/\/[^\n]*\s*try \{ if \(archived === true\) closingTime\.refresh\(id\); \}/);
  const voice = src.slice(src.indexOf('  setArchived: (id, archived) => {'));
  assert.match(voice.slice(0, voice.indexOf('\n  },')), /hive\.setArchived\(id, archived\);\s*try \{ if \(archived\) closingTime\.refresh\(id\); \}/);
});

test('a new closing time tells Michael again about a terminal that ends again', (t) => {
  // Value: protects=the told-about-ended list does not carry over a cancel; fails_when=start() stops resetting it; why_new=review pass 3 (owner, 2026-09-29); seam=none
  const f = floor({ t });
  f.ct.start();
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  f.ct.cancel();
  f.setLive(['god', 'pam', 'dwight']);
  f.ct.start();
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  assert.equal(f.sent.filter((m) => /terminal ended/.test(m.subject)).length, 2);
});

test("when Michael's terminal ends, the rows say so and waiting on cannot be re-armed", (t) => {
  // Value: protects=the owner learns closing time cannot finish instead of waiting forever; fails_when=godLive is dropped or start() re-arms without Michael; why_new=review pass 3 (owner, 2026-09-29); seam=none
  const f = floor({ t });
  f.ct.start();
  assert.equal(last(f.events).godLive, true);
  f.setLive(['pam', 'dwight']);
  f.ct.refresh('god');
  assert.equal(last(f.events).godLive, false);
  const r = f.ct.start();
  assert.equal(r.ok, false);
  assert.match(r.error, /No orchestrator/);
});

test('a late ACK during the teardown grace reopens nothing', (t) => {
  // Value: protects="floor saved" never flips back to progress before the app quits; fails_when=onRouted handles an ACK after COMPLETE was accepted; why_new=review run 2 (red team); seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.ct.excuse('dwight');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  const n = f.events.length;
  f.route('dwight', 'CLOSING-TIME-ACK');
  assert.equal(f.events.length, n);
  assert.equal(last(f.events).phase, 'complete');
});

test('a failed "terminal ended" note is also retried by Remind on Michael and by the timeout', (t) => {
  // Value: protects=Michael is told even when the ended agent was the last one waited on; fails_when=only row updates retry the note; why_new=review run 2 (red team); seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t, workers: ['pam'] });
  f.ct.start();
  t.mock.method(console, 'error', () => {});
  f.failSend((m) => /terminal ended/.test(m.subject));
  f.setLive(['god']);
  f.ct.refresh('pam');
  f.failSend(() => false);
  f.ct.remind('god', 1);
  assert.equal(f.sent.filter((m) => /Pam's terminal ended/.test(m.subject)).length, 1, 'Remind on Michael retried it');
  const g = floor({ t, workers: ['pam'] });
  g.ct.start();
  g.failSend((m) => /terminal ended/.test(m.subject));
  g.setLive(['god']);
  g.ct.refresh('pam');
  g.failSend(() => false);
  t.mock.timers.tick(6 * 60_000);
  assert.equal(g.sent.filter((m) => /Pam's terminal ended/.test(m.subject)).length, 1, 'the timeout retried it');
});

test('re-pressing closing time also retries a failed "terminal ended" note', (t) => {
  // Value: protects=the owner's re-press is a retry point for the note; fails_when=start() re-press emits without tellMichaelAboutEnded; why_new=review run 2 pass B showed the mutation survived; seam=none
  const f = floor({ t, workers: ['pam'] });
  f.ct.start();
  t.mock.method(console, 'error', () => {});
  f.failSend((m) => /terminal ended/.test(m.subject));
  f.setLive(['god']);
  f.ct.refresh('pam');
  f.failSend(() => false);
  f.ct.start();
  assert.equal(f.sent.filter((m) => /Pam's terminal ended/.test(m.subject)).length, 1);
});

test('Remind refuses a team member whose terminal has ended, and a re-press after COMPLETE restarts nothing', (t) => {
  // Value: protects=no "reminded" for a dead agent and no reopened close after COMPLETE; fails_when=remind skips the liveness check or start() re-arms while concluded; why_new=ship adversarial review (2026-09-29); seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t });
  f.ct.start();
  f.setLive(['god', 'pam']);
  assert.equal(f.ct.remind('dwight', 1).ok, false);
  f.route('pam', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'complete');
  const n = f.events.length;
  const r = f.ct.start();
  assert.equal(r.ok, false);
  assert.equal(f.events.length, n, 'no progress event after complete');
});

test("Close without them keeps the owner's other notes; repeated Reminds leave one closing-time note", (t) => {
  // Value: protects=an owner steer queued before closing time survives excuse, and Remind never stacks copies that push other notes off the 20-note queue; fails_when=excuse clears the whole queue or remind appends without dropping its old copy; why_new=ship run 3 Step 11 adversarial F1/F2; seam=real ControlRegistry
  const { ControlRegistry } = loadTs('src/main/control.ts');
  const control = new ControlRegistry();
  const f = floor({ t, workers: ['pam', 'dwight'], control });
  control.steer('dwight', "Don't push to main.");
  f.ct.start();
  f.ct.remind('pam', 0);
  f.ct.remind('pam', 60_000);
  assert.equal(control.snapshot('pam').pendingSteers, 1, 'one closing-time note for Pam');
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true });
  assert.equal(control.takeSteer('dwight'), "Don't push to main.");
  assert.equal(control.takeSteer('dwight'), undefined);
});

test('a reopen asked for mid-close counts, but a refused re-press never turns it on', (t) => {
  // Value: protects=the app reopens only when a start that was accepted asked for it; fails_when=relaunch is set before the concluded / no-Michael checks; why_new=merge of #21 (relaunch) with the closing-time rows (re-press refusals); seam=none
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = floor({ t, workers: ['pam'] });
  f.ct.start();
  assert.equal(last(f.events).relaunch, false);
  assert.deepEqual(f.ct.start({ relaunch: true }), { ok: true });
  assert.equal(last(f.events).relaunch, true, 'asked for on the way out');
  const g = floor({ t, workers: ['pam'] });
  g.ct.start();
  g.setLive(['pam']);
  assert.equal(g.ct.start({ relaunch: true }).ok, false, 'Michael is gone');
  g.setLive(['god', 'pam']);
  g.ct.refresh();
  assert.equal(last(g.events).relaunch, false, 'the refused press changed nothing');
});

test('a team member whose terminal comes back mid-close is waited on again, and Michael is told (TODOS: an agent respawned mid-close)', (t) => {
  const f = floor({ t });
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  // Dwight's terminal ends: Michael is told not to wait.
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  assert.deepEqual(last(f.events).waiting, []);
  // It comes back: the row returns, the new session gets the closing note and
  // the steer, and Michael is told to wait after all.
  f.steers.length = 0;
  f.setLive(['god', 'pam', 'dwight']);
  f.ct.revive('dwight');
  assert.deepEqual(last(f.events).waiting, ['dwight']);
  assert.ok(f.sent.some((m) => m.to === 'dwight' && m.subject === 'Closing time' && /CLOSING-TIME-ACK/.test(m.body)));
  assert.deepEqual(f.steers.map((s) => s.id), ['dwight']);
  const back = f.sent.filter((m) => m.to === 'god' && m.subject === 'Closing time: Dwight is back');
  assert.equal(back.length, 1);
  assert.match(back[0].body, /wait for their CLOSING-TIME-ACK after all/);
  // Michael's early COMPLETE is refused until Dwight confirms.
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.notEqual(last(f.events).phase, 'complete');
  // If it ends again, Michael hears that again too.
  f.setLive(['god', 'pam']);
  f.ct.refresh('dwight');
  assert.equal(f.sent.filter((m) => /Dwight's terminal ended/.test(m.subject)).length, 2);
  f.setLive(['god', 'pam', 'dwight']);
  f.ct.revive('dwight');
  f.route('dwight', 'CLOSING-TIME-ACK');
  f.route('god', 'CLOSING-TIME-COMPLETE', ['human']);
  assert.equal(last(f.events).phase, 'complete');
});

test('revive leaves alone anyone closing time is not waiting on', (t) => {
  const f = floor({ t });
  f.ct.revive('pam');
  assert.deepEqual([f.sent.length, f.events.length], [0, 0], 'not running');
  f.ct.start();
  f.route('pam', 'CLOSING-TIME-ACK');
  f.ct.revive('pam');
  assert.deepEqual(f.ct.excuse('dwight'), { ok: true });
  f.ct.revive('dwight');
  f.ct.revive('ghost');
  assert.equal(f.sent.filter((m) => m.subject === 'Closing time').length, 0, 'confirmed, closed without, or never on the list');
});
