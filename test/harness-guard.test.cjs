'use strict';

/**
 * The harness folder is plumbing only (Decision 48): file-writing tool calls
 * into it are refused, except the files the hive protocol tells agents to write.
 *
 * Two failure directions matter equally. Too loose, and business documents keep
 * landing in the hive's git history. Too strict, and an agent can no longer
 * write its own memory or send a message, and the office quietly stops working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { posixOnly } = require('./platform.cjs');

const { harnessWriteDecision } = loadTs('src/main/harnessGuard.ts');

const HOME = '/Users/me/HarnessAgents';
const HIVE = `${HOME}/hive`;
const FOLDER = '/Users/me/Documents/Pho/Finance';

const decide = (file_path, over = {}) =>
  harnessWriteDecision({
    tool: 'Write',
    toolInput: { file_path },
    cwd: FOLDER,
    agentId: 'oscar',
    isGod: false,
    harnessHome: HOME,
    hiveRoot: HIVE,
    caseInsensitive: true,
    ...over
  });

test('an agent\'s own work, in its own folder, is never touched', () => {
  assert.equal(decide(`${FOLDER}/weekly-summary.md`).deny, false);
  assert.equal(decide('weekly-summary.md').deny, false, 'relative to its folder');
});

test('the protocol files an agent is told to write are allowed', () => {
  for (const p of [
    `${HIVE}/agents/oscar/memory/inbox.md`,
    `${HIVE}/agents/oscar/memory/handoff.md`,
    `${HIVE}/agents/oscar/outbox/msg-1.json`,
    `${HIVE}/agents/oscar/inbox/.done/msg-0.json`,
    `${HIVE}/triage/20261011T143000-oscar.json`
  ]) {
    assert.equal(decide(p).deny, false, p);
  }
});

test('only Michael writes the board; a team member files once in triage/ and Michael files it away', () => {
  // Value: protects=the single writer of tasks.json (ship review D8) and the filing path it depends on; fails_when=the guard refuses a filing, so team members fall back to tasks.json, or still lets them write tasks.json; why_new=review D8 red team found triage/ refused; seam=harnessWriteDecision
  const d = decide(`${HIVE}/tasks.json`);
  assert.equal(d.deny, true, 'a team member never writes tasks.json');
  assert.match(d.reason, /one new file per filing in the triage folder; Michael alone writes tasks\.json, so tell him what changed/);
  assert.equal(decide(`${HIVE}/triage/.done/20261011T143000-oscar.json`).deny, true, 'filing away is Michael\'s');
  assert.equal(decide(`${HIVE}/triage/sub/x.json`).deny, true);
  const god = { agentId: 'god', isGod: true, cwd: '/Users/me/Documents/Pho/Office' };
  assert.equal(decide(`${HIVE}/tasks.json`, god).deny, false);
  assert.equal(decide(`${HIVE}/triage/.done/20261011T143000-oscar.json`, god).deny, false);
});

test('a business document in the hive is refused, and the reason says where it belongs', () => {
  const d = decide(`${HIVE}/agents/oscar/invoice-march.pdf`);
  assert.equal(d.deny, true);
  assert.match(d.reason, /only for coordination/);
  assert.ok(d.reason.includes(FOLDER), 'names the agent\'s own folder');
});

test('the files agents invented in the hive root are refused', () => {
  for (const p of ['shared/brand-voice.md', 'templates/email.md', 'social/post.md', 'PRODUCT-CAPABILITIES.md']) {
    assert.equal(decide(`${HIVE}/${p}`).deny, true, p);
  }
});

test('the rest of the harness folder is off limits too, not just the hive', () => {
  assert.equal(decide(`${HOME}/roster.json`).deny, true);
  assert.equal(decide(`${HOME}/notes.md`).deny, true);
});

test('the memory index is the app\'s to write: an agent adds notes to its memory inbox', () => {
  const d = decide(`${HIVE}/agents/oscar/memory.md`);
  assert.equal(d.deny, true);
  assert.match(d.reason, /add notes to memory\/inbox\.md instead/);
});

test('writing into ANOTHER agent\'s mailbox or memory is refused', () => {
  assert.equal(decide(`${HIVE}/agents/pam/memory/inbox.md`).deny, true);
  assert.equal(decide(`${HIVE}/agents/pam/inbox/sneaky.json`).deny, true);
});

test('board.md is Michael\'s alone, and nobody files spawn requests in this build', () => {
  assert.equal(decide(`${HIVE}/board.md`).deny, true);
  assert.equal(decide(`${HIVE}/spawn-requests/w1.json`).deny, true);
  const god = { agentId: 'god', isGod: true, cwd: '/Users/me/Documents/Pho/Office' };
  assert.equal(decide(`${HIVE}/board.md`, god).deny, false);
  // Temporary workers are off (ALLOW_TEMP_WORKERS), so not even Michael.
  assert.equal(decide(`${HIVE}/spawn-requests/w1.json`, god).deny, true);
  assert.equal(decide(`${HIVE}/agents/god/memory/inbox.md`, god).deny, false);
});

test('`..` cannot smuggle a write out of an allowed folder', () => {
  assert.equal(decide(`${HIVE}/agents/oscar/outbox/../../../board.md`).deny, true);
  assert.equal(decide(`${HIVE}/agents/oscar/outbox/../report.pdf`).deny, true);
});

test('a name that starts with two dots is still inside the harness folder', () => {
  assert.equal(decide(`${HOME}/..notes.md`).deny, true);
  assert.equal(decide(`${HOME}/..shared/brand-voice.md`).deny, true);
  assert.equal(decide(`${HIVE}/..board.md`).deny, true);
  assert.equal(decide(`${HOME}/../outside.md`).deny, false, 'a real step out of the folder is still outside');
});

test('changing the case of the path does not get around it on macOS', () => {
  assert.equal(decide('/Users/me/harnessagents/HIVE/shared/x.md').deny, true);
  assert.equal(decide('/Users/me/HARNESSAGENTS/hive/agents/OSCAR/memory/inbox.md').deny, false, 'and plumbing still passes');
});

test('on Linux, where case matters, a different-case folder is a different folder', posixOnly('Windows paths ignore case, so path.relative matches either case there'), () => {
  assert.equal(decide('/Users/me/harnessagents/hive/x.md', { caseInsensitive: false }).deny, false);
});

test('Edit, MultiEdit and NotebookEdit are guarded the same way', () => {
  for (const tool of ['Edit', 'MultiEdit']) {
    assert.equal(decide(`${HIVE}/x.md`, { tool }).deny, true, tool);
  }
  const nb = harnessWriteDecision({
    tool: 'NotebookEdit', toolInput: { notebook_path: `${HIVE}/analysis.ipynb` }, cwd: FOLDER,
    agentId: 'oscar', isGod: false, harnessHome: HOME, hiveRoot: HIVE, caseInsensitive: true
  });
  assert.equal(nb.deny, true);
});

test('tools that don\'t write a file are never judged', () => {
  for (const tool of ['Read', 'Grep', 'Bash', 'WebFetch']) {
    assert.equal(decide(`${HIVE}/x.md`, { tool }).deny, false, tool);
  }
});

test('a tool call with no path, or a relative path with no known folder, is left alone', () => {
  assert.equal(harnessWriteDecision({
    tool: 'Write', toolInput: {}, agentId: 'oscar', isGod: false,
    harnessHome: HOME, hiveRoot: HIVE, caseInsensitive: true
  }).deny, false);
  assert.equal(decide('notes.md', { cwd: undefined }).deny, false);
});

test('a refusal names the agent\'s folder only when that folder is outside the harness', () => {
  // Michael on an older layout runs inside the harness folder: pointing him
  // back at it as "your own folder" would send the work right back in.
  const legacy = decide(`${HIVE}/shared/brand-voice.md`, { cwd: HOME, agentId: 'god', isGod: true });
  assert.equal(legacy.deny, true);
  // Stronger than matching one format: the reason has no business naming the
  // harness folder at all.
  assert.ok(!legacy.reason.includes(HOME), legacy.reason);
  // A tool input that is not an object names no file, so there is nothing to judge.
  assert.equal(harnessWriteDecision({
    tool: 'Write', toolInput: 'oops', cwd: FOLDER, agentId: 'oscar', isGod: false,
    harnessHome: HOME, hiveRoot: HIVE, caseInsensitive: true
  }).deny, false);
});

test('an agent saves into its own scratch folder in the app\'s home, and no one else\'s', posixOnly('POSIX paths'), () => {
  // Value: protects=a member's session can save temp files in its own scratch folder, which moved out of /tmp; fails_when=the guard refuses it (every scratch save fails) or lets an agent into another's; why_new=ship review pass 3 (D6.1 regression); seam=none
  assert.equal(decide(`${HOME}/agent-tmp/oscar/claude-501/s/scratchpad/notes.md`).deny, false);
  assert.equal(decide(`${HOME}/agent-tmp/pam/notes.md`).deny, true, 'another agent\'s');
  assert.equal(decide(`${HOME}/agent-tmp/oscar-2/notes.md`).deny, true, 'a name that only starts the same');
});
