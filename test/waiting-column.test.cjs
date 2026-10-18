'use strict';

/**
 * The Waiting column (owner, 2026-10-03: "i see two tasks in doing section, one
 * for Oscar and one for Kelly. But they are not working on anything."). Doing
 * held both work in progress and work held on a customer or a teammate. A card
 * held on someone now sits in Waiting, with who it waits on; Doing means
 * someone is working on it now. Michael sets Waiting, as he does Blocked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('a waiting card keeps its status and who it waits on through the parse', () => {
  const { parseTasks } = loadTs('src/renderer/src/components/hiveTasks.ts');
  const [a, b, c] = parseTasks({ tasks: [
    { id: 'k1', title: 'Salesforce setup', status: 'waiting', waitingOn: ' customer Gopi ', assignee: 'kelly' },
    { id: 'o1', title: 'Summary', status: 'waiting' },
    { id: 'x1', title: 'Odd', status: 'parked' }
  ] });
  assert.equal(a.status, 'waiting');
  assert.equal(a.waitingOn, 'customer Gopi');
  assert.equal(b.status, 'waiting');
  assert.equal(b.waitingOn, undefined);
  assert.equal(c.status, 'todo', 'an unknown status still falls back to To do');
});

test('the board has a Waiting column between Doing and Blocked, and each card says who', () => {
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  const keys = [...kanban.matchAll(/\{ key: '([a-z]+)',\s+labelKey: 'kanban\.col/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['todo', 'doing', 'waiting', 'blocked', 'done']);
  // Yellow (owner, 2026-10-03).
  assert.match(kanban, /key: 'waiting', labelKey: 'kanban\.colWaiting', accent: 'var\(--cth-amber\)',\s+soft: 'var\(--cth-amber-soft\)',\s+text: 'var\(--cth-amber-text\)'/);
  assert.match(kanban, /task\.waitingOn \? t\('kanban\.waitingOn', \{ who: task\.waitingOn \}\) : t\('kanban\.waitingOnUnknown'\)/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const k = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;
    for (const key of ['colWaiting', 'waitingOn', 'waitingOnUnknown', 'waitingOnTitle']) assert.ok(k[key], `${loc} ${key}`);
    assert.match(k.waitingOn, /\{\{who\}\}/, loc);
  }
  assert.equal(JSON.parse(read('src/renderer/src/i18n/locales/en.json')).kanban.waitingOn, 'Waiting on {{who}}');
});

test('Michael is told: waiting names who, doing means working now, and back to doing on the answer', () => {
  const hive = read('src/main/hive.ts');
  assert.match(hive, /status: 'triage' \| 'todo' \| 'doing' \| 'waiting' \| 'blocked' \| 'done';\n\s+\/\*\* Who a Waiting card waits on/);
  const rules = hive.match(/is "waiting", with "waitingOn" naming who in a few words/g) || [];
  assert.equal(rules.length, 2, 'both the house rules and Michael\'s own instructions say it');
  assert.doesNotMatch(hive, /waiting on someone outside the office[^.]*is "doing"/);
  assert.match(hive, /"doing" means someone is working on it now\./);
  assert.match(hive, /todo \/ doing \/ waiting \/ blocked \/ done/);
  assert.match(read('src/shared/ownerRequests.ts'), /move it to "waiting" and name who in "waitingOn"/);
});

test('the hourly standup sends a card held on someone to Waiting, and an office on the old focus gets the new one', () => {
  // Value: protects=cards held on a customer or teammate reach Waiting (owner 2026-10-08: GreenWorld nudge sent, card still in Doing; no card had ever been set to Waiting); fails_when=the standup focus tells Michael to move such a card to doing, or offices keep the 2026-10-03 focus; why_new=the standup focus was missed when the Waiting column shipped; seam=none
  const { OPS_STANDUP_FOCUS, OPS_STANDUP_BUILT_IN_FOCUSES } = loadTs('src/main/config.ts');
  assert.doesNotMatch(OPS_STANDUP_FOCUS, /move it to doing with who it waits on/);
  assert.match(OPS_STANDUP_FOCUS, /move it to waiting naming who in waitingOn, or to done\./);
  assert.match(OPS_STANDUP_FOCUS, /A doing card held on someone outside the office or a teammate goes to waiting, naming who in waitingOn;/);
  assert.match(OPS_STANDUP_FOCUS, /a waiting card returns to doing when they answer; else chase them\./, 'Waiting cards are reviewed, and chasing never moves one back to doing');
  const { FOCUS_MAX } = loadTs('src/shared/missions.ts');
  assert.ok(OPS_STANDUP_FOCUS.length <= FOCUS_MAX, `the focus fits the ${FOCUS_MAX} character limit the schedule editor keeps`);
  assert.ok(OPS_STANDUP_BUILT_IN_FOCUSES.some((f) => /Move every doing card that waits on someone/.test(f)), 'an office on the 2026-10-09 dev text gets the current one');
  assert.doesNotMatch(OPS_STANDUP_FOCUS, /[–—]| - /, 'no dashes');
  const old = OPS_STANDUP_BUILT_IN_FOCUSES.find((f) => /move it to doing with who it waits on, or to done\./.test(f));
  assert.ok(old, 'the 2026-10-03 focus is replaced at launch');
  // Value: protects=an office still on the 2026-10-03 standup focus migrates at launch; fails_when=the kept old text is edited in any way (a wording or dash sweep), since launch matches it word for word; why_new=the line above finds it by one phrase only; seam=none
  assert.equal(old,
    'First close your open requests from the owner: route each answer and reply done to it. ' +
    'Then fix every blocked card with nothing asked: put its question for the owner on Ask me, ' +
    'or move it to doing with who it waits on, or to done. ' +
    'Then check the floor through fleet.json: who is doing what, whether each team member is still running, ' +
    'whether in-flight cards are on track, and whether any card has nobody on it. ' +
    'Re-engage anyone stalled and keep the board accurate.', 'the text 0.1.4 shipped, word for word');
  assert.ok(!OPS_STANDUP_BUILT_IN_FOCUSES.includes(OPS_STANDUP_FOCUS), 'the current focus is never migrated away');
});

test('a waiting card is nobody\'s work right now: not Doing on the floor, not busy on the roster', () => {
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /if \(t\.status !== 'waiting'\) board\[t\.status\]\+\+;/);
  assert.match(stage, /if \(t\.status === 'doing' && t\.assignee\) doingBy/);
  assert.match(read('src/main/hive.ts'), /t\?\.assignee === id && t\.status === 'doing'\)\?\.title/);
});

test('only Michael sets Waiting: not from Task detail, the IPC or voice', () => {
  assert.match(read('src/main/index.ts'), /!\['todo', 'doing', 'done'\]\.includes\(status as string\)/);
  const voice = read('src/main/realtimeActions.ts');
  assert.match(voice, /const valid = \['todo', 'doing', 'waiting', 'blocked', 'done'\];/);
  assert.match(voice, /if \(status === 'waiting'\) \{[\s\S]*?Waiting names who the card waits on, so only \$\{godName\} sets it\./);
  assert.match(read('src/renderer/src/realtime/tools.ts'), /\$\{by\('waiting'\)\.length\} waiting on someone/);
});

test('the owner cannot set Waiting, and moving a card out of Waiting drops who it waited on', () => {
  // Value: protects=a card the owner moves from Waiting to Doing or To do no longer says "Waiting on <who>", and Waiting stays Michael's; fails_when=ownerMoveTask keeps waitingOn or accepts waiting; why_new=ship review 2026-10-03 maintainability finding; seam=none
  const os = require('node:os');
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-waiting-'));
  try {
    fs.mkdirSync(path.join(home, 'hive'), { recursive: true });
    fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks: [{ id: 'c1', title: 'Setup', status: 'waiting', waitingOn: 'customer Gopi', assignee: 'kelly', dependsOn: [], priority: 3, createdAt: 'x' }] }));
    const hive = new HiveManager(() => home);
    assert.equal(hive.ownerMoveTask('c1', 'waiting'), false);
    assert.equal(hive.ownerMoveTask('c1', 'doing'), true);
    const card = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'tasks.json'), 'utf8')).tasks.find((t) => t.id === 'c1');
    assert.equal(card.status, 'doing');
    assert.equal(card.waitingOn, undefined);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the renderer can patch a card only with Ask me answers; a move goes through the owner move rules', () => {
  // Value: protects=Blocked and Waiting stay Michael's at the main process boundary, not just in the UI; fails_when=hive:patchTask accepts status, waitingOn or any other field from the renderer; why_new=Codex adversarial review 2026-10-04; seam=none
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('hive:patchTask'"), src.indexOf("ipcMain.handle('hive:moveTask'"));
  assert.match(handler, /if \(Object\.keys\(patch\)\.some\(\(k\) => k !== 'humanQA'\)\) return \{ ok: false, error: 'only Ask me answers can be patched' \};/);
  assert.ok(handler.indexOf("k !== 'humanQA'") < handler.indexOf('hive.patchTask('), 'refused before anything is written');
  const callers = [];
  function collectCallers(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collectCallers(file);
      else if (entry.isFile()) {
        for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
          if (line.includes('hivePatchTask(')) callers.push(`${file}:${index + 1}:${line}`);
        }
      }
    }
  }
  collectCallers(path.resolve(__dirname, '..', 'src', 'renderer'));
  for (const c of callers) assert.match(c, /hivePatchTask\([^,]+, \{ humanQA: [^}]+\}, index\)/, c);
});
