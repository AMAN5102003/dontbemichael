'use strict';

/**
 * The date on a memory note is the owner's local day. The Memory tab compares
 * a fact's "check again" date with the local day (expiryState), so a note
 * dated in UTC is a day ahead every evening west of Greenwich and a day behind
 * every morning east of it.
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

const mi = loadTs('src/shared/memoryIndex.ts');
const { MailApprovals } = loadTs('src/main/mailApprovals.ts');
const { MemoryTidy } = loadTs('src/main/memoryTidy.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

// Saturday 10 October 2026, 18:30 in Los Angeles. In UTC it is already the 11th.
const EVENING = Date.UTC(2026, 9, 11, 1, 30);

/** Los Angeles for one test, with the clock at EVENING when `clock` is set. */
function losAngeles(t, clock = false) {
  const tz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  if (clock) t.mock.timers.enable({ apis: ['Date'], now: EVENING });
}

test('a note about email is dated with the local day', (t) => {
  // Value: protects=the owner's notes carry the day the owner made them; fails_when=today() is taken from the UTC date; why_new=notes written in the evening were dated tomorrow; seam=clock
  losAngeles(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-notedate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notes = [];
  const approvals = new MailApprovals({
    path: path.join(dir, 'mail-proposals.json'),
    send() {}, remember: (_id, line) => notes.push(line), toast() {},
    agentName: (id) => id, godId: () => 'god', changed() {},
    now: () => EVENING
  });
  approvals.sendingChanged('pam', 'ceo', 'ceo@shop.com', 'draft');
  assert.match(notes[0], /^- From the owner \(2026-10-10\): /);
});

test('the owner\'s answer is dated with the local day', async (t) => {
  // Value: protects=an Ask me answer is filed under the day it was given; fails_when=rememberOwnerAnswer uses the UTC date; why_new=same fault as the email notes; seam=clock
  losAngeles(t, true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-notedate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  assert.equal(hive.rememberOwnerAnswer('oscar', 'Pay the supplier', 'Pay now?', 'Yes.'), true);
  const [note] = mi.parseInbox(fs.readFileSync(path.join(home, 'hive', 'agents', 'oscar', 'memory', 'inbox.md'), 'utf8'));
  assert.match(note, /^From the owner \(2026-10-10\), /);
});

test('the tidy-up dates an entry with the local day', async (t) => {
  // Value: protects=an entry's date and the Memory tab's "today" are the same calendar; fails_when=the tidy-up passes applyOps the UTC date; why_new=same fault as the email notes; seam=clock, fake model
  losAngeles(t, true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-notedate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'oscar');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', []));
  fs.writeFileSync(path.join(dir, 'memory', 'inbox.md'), '- Supplier cutoff is Thursday noon\n');
  const tidy = new MemoryTidy(() => home, () => 'claude', () => ({}), () => true, () => 'Oscar', () => {});
  tidy.askModel = async () => ({ ops: [{ op: 'add', kind: 'fact', text: 'Supplier cutoff is Thursday noon', source: 'task' }] });
  const [r] = await tidy.tidyNow();
  assert.equal(r.tidied, true);
  const { entries } = mi.parseIndex(fs.readFileSync(path.join(dir, 'memory.md'), 'utf8'));
  assert.deepEqual(entries.map((e) => e.date), ['2026-10-10']);
});
