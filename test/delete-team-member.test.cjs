'use strict';

/**
 * A hired team member can be deleted for good (owner, 2026-10-14): a Danger
 * zone in Edit agent, under the engine. Before it, the only remove control was
 * the close button hidden on 2026-09-24, so no hire could leave the team.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { canDeleteTeamMember, deleteTeamMember } = loadTs('src/renderer/src/shell/deleteTeamMember.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function recorder({ fail } = {}) {
  const calls = [];
  const step = (name) => (arg) => {
    calls.push(`${name}:${arg}`);
    return fail === name ? Promise.reject(new Error('boom')) : Promise.resolve();
  };
  return {
    calls,
    deps: {
      closeByOwner: step('close'),
      releaseBindings: step('release'),
      killPty: step('kill'),
      disposeTerminal: (id) => { calls.push(`dispose:${id}`); },
      archiveInRegistry: step('archive'),
      settleWork: step('settle'),
      forget: (id) => { calls.push(`forget:${id}`); }
    }
  };
}

test('a hired member can be deleted; Michael, his assistant and Research cannot', () => {
  assert.equal(canDeleteTeamMember({ id: 'meredith' }), true);
  assert.equal(canDeleteTeamMember({ id: 'god', isGod: true }), false);
  assert.equal(canDeleteTeamMember({ id: 'assistant', isAssistant: true }), false);
  assert.equal(canDeleteTeamMember({ id: 'research' }), false);
});

test('a running member: schedules pause, bound work goes back, terminal stops, asks settle, then off the team', async () => {
  const r = recorder();
  assert.equal(await deleteTeamMember({ id: 'meredith', ptyId: 'pty-meredith' }, r.deps), true);
  assert.deepEqual(r.calls, ['close:meredith', 'release:meredith', 'kill:pty-meredith', 'dispose:pty-meredith', 'settle:meredith', 'forget:meredith']);
});

test('a member with no terminal is archived in the registry directly', async () => {
  const r = recorder();
  await deleteTeamMember({ id: 'meredith' }, r.deps);
  assert.deepEqual(r.calls, ['close:meredith', 'release:meredith', 'archive:meredith', 'settle:meredith', 'forget:meredith']);
});

test('a failing step never leaves them half on the floor', async () => {
  for (const fail of ['close', 'release', 'kill', 'settle']) {
    const r = recorder({ fail });
    await deleteTeamMember({ id: 'meredith', ptyId: 'pty-meredith' }, r.deps);
    assert.equal(r.calls.at(-1), 'forget:meredith', `forgotten even when ${fail} fails`);
  }
});

test('Michael is never deleted, even if the button were reached', async () => {
  const r = recorder();
  assert.equal(await deleteTeamMember({ id: 'god', isGod: true, ptyId: 'pty-god' }, r.deps), false);
  assert.deepEqual(r.calls, []);
});

test('Edit agent shows the Danger zone under the engine, behind canDeleteTeamMember', () => {
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  const engine = src.indexOf('<Fields id="engine">');
  const danger = src.indexOf('const danger = canDeleteTeamMember(agent) && (');
  assert.ok(engine > 0 && danger > engine, 'Danger zone comes after the engine');
  // Laid out under the engine in both layouts (wide panel WD2).
  assert.equal((src.match(/\{engine\}\s*(?:<div style=\{\{ flex: 1 \}\} \/>\s*)?\{danger\}/g) ?? []).length, 2);
  const zone = src.slice(danger, src.indexOf('</div>', danger));
  assert.match(zone, /data-fields="danger"/);
  // The Settings Danger zone's card: coral tint, r-xl corners, its 55% coral ring (DESIGN.md 6.3).
  assert.match(zone, /borderRadius: 'var\(--cth-r-xl\)'/);
  assert.match(zone, /inset 0 0 0 1\.5px color-mix\(in srgb, var\(--cth-coral-base\) 55%, transparent\)', background: 'var\(--cth-coral-soft\)'/, 'drawn in the danger red');
  assert.match(zone, /<PixelButton variant="destructive"/);
  assert.match(src, /if \(!confirm\(deleteConfirmText\(agent\.id, agent\.name, t\)\)\) return;/);
  // Off the floor, the archived list and the restore list: nothing brings them back.
  assert.match(src, /forget: \(id\) => \{ st\.archiveAgent\(id\); st\.removeArchivedAgent\(id\); st\.removeRestorableAgent\(id\); \}/);
});

test('the delete strings exist in every language, with no dashes', () => {
  const keys = ['danger', 'delete', 'deleting', 'deleteInfo', 'deleteConfirm', 'deleteConfirmSchedules', 'deleteConfirmSchedulesPlural'];
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).editAgent;
    for (const k of keys) {
      assert.equal(typeof d[k], 'string', `${loc} editAgent.${k}`);
      assert.doesNotMatch(d[k], /[–—]| - /, `${loc} editAgent.${k} has no dash`);
    }
    assert.ok(d.deleteConfirmSchedules.includes('{{count}}'), `${loc} names the schedule count`);
  }
});

test('deleting a member withdraws their open asks and tells Michael their open cards', async (t) => {
  // Value: protects=a deleted member's question leaves Ask me and Michael gets their cards; fails_when=memberDeleted leaves asks open, touches others' asks, or sends no note; why_new=owner 2026-10-15, Meredith's ask stayed after delete; seam=none
  const os = require('node:os');
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { openAskIndexes } = loadTs('src/shared/askMeRouting.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-member-deleted-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'meredith-x1', name: 'Meredith', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const ask = (raisedBy) => ({ q: 'Which vendors?', askedAt: '2026-10-15T01:27:24Z', ...(raisedBy ? { raisedBy } : {}) });
  fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks: [
    { id: 'first-meredith', title: 'Vendor list', status: 'blocked', assignee: 'meredith-x1', humanQA: [ask('meredith-x1')] },
    { id: 'unrecorded', title: 'Shipping quotes', status: 'blocked', assignee: 'meredith-x1', humanQA: [ask(), { ...ask('meredith-x1'), a: 'answered' }] },
    { id: 'pams', title: 'Invoices', status: 'blocked', assignee: 'pam', humanQA: [ask('pam'), ask('meredith-x1')] },
    { id: 'doing', title: 'Stock count', status: 'doing', assignee: 'meredith-x1' },
    { id: 'old', title: 'Done work', status: 'done', assignee: 'meredith-x1' }
  ] }));
  // A filing she made that Michael has not worked yet, and one of Pam's.
  const triage = path.join(home, 'hive', 'triage');
  fs.mkdirSync(triage, { recursive: true });
  fs.writeFileSync(path.join(triage, '20261015T010000-meredith-x1.json'), JSON.stringify({ title: 'Vendor terms', filedBy: 'meredith-x1', ask: 'Net 30 or net 60?' }));
  fs.writeFileSync(path.join(triage, '20261015T010100-pam.json'), JSON.stringify({ title: 'Invoice run', filedBy: 'pam', ask: 'Send today?' }));
  const token = hive.mintHookToken('meredith-x1');
  const godInbox = path.join(home, 'hive', 'agents', 'god', 'inbox');
  const inboxFiles = () => (fs.existsSync(godInbox) ? fs.readdirSync(godInbox).filter((f) => f.endsWith('.json')) : []);
  const before = inboxFiles().length;

  assert.deepEqual(hive.memberDeleted('meredith-x1'), { withdrawn: 3, cards: 4 });
  const cards = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(home, 'hive', 'tasks.json'), 'utf8')).tasks.map((c) => [c.id, c]));
  assert.deepEqual(openAskIndexes(cards['first-meredith'].humanQA), [], 'her own ask leaves Ask me');
  assert.equal(cards['first-meredith'].humanQA[0].dismissedBy, 'member-deleted');
  assert.equal(cards['first-meredith'].status, 'blocked', 'the card is Michael\'s to move');
  assert.equal(cards['first-meredith'].assignee, 'meredith-x1');
  assert.deepEqual(openAskIndexes(cards.unrecorded.humanQA), [], 'an ask with no raiser on her card was hers');
  assert.equal(cards.unrecorded.humanQA[1].a, 'answered', 'an answered ask is left as it was');
  assert.equal(cards.unrecorded.humanQA[1].dismissedAt, undefined);
  assert.deepEqual(openAskIndexes(cards.pams.humanQA), [0], "Pam's ask stays open; Meredith's on Pam's card goes");
  assert.equal(hive.openQuestionsRaisedBy('meredith-x1'), 0);
  assert.deepEqual(fs.readdirSync(triage).filter((f) => f.endsWith('.json')), ['20261015T010100-pam.json'], 'her filing is set aside, Pam\'s stays for Michael');
  assert.ok(fs.existsSync(path.join(triage, '.done', '20261015T010000-meredith-x1.json')));
  assert.equal(hive.hookTokenOwner(token), undefined, 'her hook secret no longer opens anything');

  const after = inboxFiles().map((f) => JSON.parse(fs.readFileSync(path.join(godInbox, f), 'utf8')));
  assert.equal(after.length, before + 1, 'Michael hears once');
  const note = after.find((m) => /OWNER DELETED Meredith/.test(m.subject));
  assert.ok(note, 'the note names who was deleted');
  assert.match(note.body, /Never route work to them again\./);
  for (const id of ['first-meredith', 'unrecorded', 'pams', 'doing']) assert.match(note.body, new RegExp(`- card ${id}:`));
  assert.doesNotMatch(note.body, /card old:/, 'a Done card is not listed');
  assert.match(note.body, /withdrew their 3 open questions on Ask me/);
  assert.match(note.body, /set aside a filing they made that you had not worked yet/);
  assert.doesNotMatch(`${note.subject}\n${note.body}`, /[–—]| - [a-z]/, 'no dashes');

  assert.deepEqual(hive.memberDeleted('god'), { withdrawn: 0, cards: 0 }, 'Michael is never deleted');
  assert.deepEqual(hive.memberDeleted('nobody'), { withdrawn: 0, cards: 0 });
});

test('Task detail says a deleted member\'s question was withdrawn, in every language', () => {
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /e\.dismissedBy === 'member-deleted'\s*\? t\('kanban\.askWithdrawnMemberDeleted'\)/);
  assert.match(read('src/renderer/src/components/hiveTasks.ts'), /e\.dismissedBy === 'card-closed' \|\| e\.dismissedBy === 'member-deleted'/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const v = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban.askWithdrawnMemberDeleted;
    assert.equal(typeof v, 'string', loc);
    assert.doesNotMatch(v, /[–—]| - /, loc);
  }
});
