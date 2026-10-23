'use strict';

/**
 * Behavior tests for paths that were only checked by regexes over the source
 * (owner approved, 2026-10-23): a pack update's Use it and Keep mine run
 * against the real renderer store, the foundation card's save steps run with
 * a stand in for window.cth, and a hidden Claude session pastes its pictures
 * and prompt into a stand in terminal under mocked timers. Main has no
 * harness, so the foundations wiring there stays a pin, scoped to its block.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- 1. A pack update's Use it and Keep mine, against the renderer store ----

/**
 * Runs one Use it or Keep mine in a child process: the renderer store loads
 * from a stub window (as closing-time-dialog.test.cjs does), `@/store/store`
 * resolves to that same store, and window.cth answers as the scenario says.
 * The starter jobs step finds no pack card, so it adds nothing.
 */
const OFFER_SCRIPT = `
const fs = require('node:fs');
const Module = require('node:module');
const loadTs = require(${JSON.stringify(path.join(__dirname, 'load-ts.cjs'))});
const sc = JSON.parse(process.argv[1]);
const mem = { 'cth.agents': JSON.stringify([{ id: 'god', name: 'Michael', isGod: true }, sc.member]) };
const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const config = { businessType: 'saas-consulting', businessName: 'Sunrise Bakery', workStyleUpdatesDecided: {} };
const calls = { role: [], updateConfig: 0, packsList: 0, listMissions: 0, upsert: 0 };
let throwsLeft = sc.decideThrows || 0;
globalThis.window = {
  localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  cth: {
    hivePatchAgentRole: async (id, role) => { calls.role.push([id, role]); return sc.roleAnswer; },
    getConfig: async () => JSON.parse(JSON.stringify(config)),
    updateConfig: async (patch) => {
      calls.updateConfig++;
      if (throwsLeft > 0) { throwsLeft--; throw new Error('disk full'); }
      Object.assign(config, patch);
      return config;
    },
    packsList: async () => { calls.packsList++; return sc.readOffers ? { packs: [{ pack: JSON.parse(fs.readFileSync('resources/packs/saas-consulting.json', 'utf8')) }], core: null } : { packs: [], core: null }; },
    listMissions: async () => { calls.listMissions++; return []; },
    upsertMission: async () => { calls.upsert++; return { ok: true }; }
  }
};
globalThis.localStorage = storage;
const storeMod = loadTs('src/renderer/src/store/store.ts');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === '@/store/store' ? 'stub:@/store/store' : resolve.call(this, req, ...rest); };
require.cache['stub:@/store/store'] = { id: 'stub:@/store/store', filename: 'stub:@/store/store', loaded: true, exports: storeMod };
const W = loadTs('src/renderer/src/shell/workStyleOffers.ts');
const { workStyleOffers, decisionId } = loadTs('src/shared/workStyleUpdates.ts');
const { jobBase } = loadTs('src/shared/jobChange.ts');
const pack = JSON.parse(fs.readFileSync('resources/packs/saas-consulting.json', 'utf8'));
const cards = new Map([['saas-consulting/pam', pack.agents.find((a) => a.id === 'pam')]]);
const member = () => JSON.parse(JSON.stringify(storeMod.useStore.getState().agents.find((a) => a.id === sc.member.id)));
const offersNow = () => workStyleOffers(storeMod.useStore.getState().agents, cards, config.businessType, { name: config.businessName }, config.workStyleUpdatesDecided);
(async () => {
  const [offer] = offersNow();
  const before = member();
  const from = sc.stale ? jobBase({ goal: 'an older job', description: before.description }) : jobBase(before);
  const revised = sc.revised === 'offer' ? { instructions: offer.goal, plain: 'Clears the inbox every run.', handles: null } : sc.revised;
  let result = null;
  if (sc.choice === 'keep') await W.decideWorkStyleOffer(offer, 'keep');
  else result = await W.adoptWorkStyleOffer(offer, revised, from);
  const offersRead = sc.readOffers ? (await W.readWorkStyleOffers()).map((o) => o.agentId) : null;
  process.stdout.write(JSON.stringify({ offer, result, before, after: member(), decided: config.workStyleUpdatesDecided, calls, offersAfter: offersNow().map((o) => o.agentId), offersRead, id: decisionId(offer.key, offer.agentId) }));
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

function runOffer(scenario) {
  return JSON.parse(execFileSync(process.execPath, ['-e', OFFER_SCRIPT, JSON.stringify(scenario)], { cwd: ROOT, encoding: 'utf8' }));
}

const CHANGED_PAM = {
  id: 'pam', name: 'Pam',
  goal: 'Pam sorts the Sunrise Bakery inbox her own way.',
  description: 'Executive Admin: Sorts the inbox',
  jobChanges: [{ text: 'Flag anything from flour suppliers', at: '2026-10-01T09:00:00.000Z' }]
};
const REVISED = { instructions: '  Run the inbox to zero and flag flour supplier mail.  ', plain: 'Clears the inbox and flags flour suppliers.', handles: 'Runs the inbox to zero and flags supplier mail' };
const titleOf = (description) => description.slice(0, description.indexOf(': '));

test('Use it on a member with job changes saves the revised job, keeps Undo and the change list, and records the decision', () => {
  // Value: protects=Use it saves what the preview showed, with the owner's job one Undo away, and the offer never returns; fails_when=adoptWorkStyleOffer stops applying the revised text, drops jobPrevious or jobChanges, keeps the old title, or records no 'use'; why_new=the adopt path was only pinned by regexes in inbox-zero.test.cjs; seam=stub window.cth in a child process, real store; no_claim=the rendered preview or a real IPC save
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: REVISED, roleAnswer: { ok: true } });
  assert.equal(r.result, 'applied');
  assert.equal(r.after.goal, REVISED.instructions.trim(), 'the revised instructions, trimmed');
  assert.equal(r.after.goalPlain.text, REVISED.plain);
  assert.equal(r.after.description, `${titleOf(r.offer.description)}: ${REVISED.handles}`, 'the new default title with the revised handles');
  assert.notEqual(titleOf(r.offer.description), '', 'sanity: the offer has a title');
  assert.deepEqual(r.after.jobPrevious, { goal: CHANGED_PAM.goal, description: CHANGED_PAM.description, jobChanges: CHANGED_PAM.jobChanges }, 'Undo holds the owner\'s own job');
  assert.deepEqual(r.after.jobChanges, CHANGED_PAM.jobChanges, 'a pack default is no change of the owner\'s');
  assert.deepEqual(r.calls.role, [['pam', r.after.description]], 'the registry role first, with the saved line');
  assert.equal(r.decided[r.id], 'use');
  assert.deepEqual(r.offersAfter, [], 'never offered again');
  assert.equal(r.calls.upsert, 0, 'no starter job without a pack card');
});

test('Use it with no new duties keeps the offer\'s default handles', () => {
  // Value: protects=a rewrite that left the duties alone still saves the new default role line, never the old one; fails_when=revised.handles null falls back to the member's old description; why_new=only the regex pinned the ?? fallback; seam=stub window.cth in a child process; no_claim=the rendered preview
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: { ...REVISED, handles: null }, roleAnswer: { ok: true } });
  assert.equal(r.result, 'applied');
  assert.equal(r.after.description, r.offer.description);
  assert.notEqual(r.after.description, CHANGED_PAM.description);
});

test('Use it on a member with no job changes saves the offer\'s goal and role line', () => {
  // Value: protects=an unchanged member gets the pack's new default as offered; fails_when=adopt writes anything but the offer's text, or invents a change list; why_new=no behavior test of the plain update; seam=stub window.cth in a child process; no_claim=the plain words conversion
  const plain = { id: 'pam', name: 'Pam', goal: 'Pam sorts the inbox.', description: 'Executive Admin: Sorts the inbox' };
  const r = runOffer({ member: plain, choice: 'use', revised: 'offer', roleAnswer: { ok: true } });
  assert.equal(r.offer.changes.length, 0);
  assert.equal(r.result, 'applied');
  assert.equal(r.after.goal, r.offer.goal.trim());
  assert.equal(r.after.description, r.offer.description);
  assert.equal(r.after.jobChanges, undefined);
  assert.equal(r.after.jobPrevious.goal, plain.goal);
  assert.equal(r.decided[r.id], 'use');
});

test('a job that moved since the preview began is never saved over', () => {
  // Value: protects=Use it never overwrites an edit made while the preview ran (A3); fails_when=the jobBase check goes or moves after a write; why_new=only a regex pinned the stale check; seam=stub window.cth in a child process; no_claim=how the review screen words it
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: REVISED, roleAnswer: { ok: true }, stale: true });
  assert.equal(r.result, 'moved');
  assert.deepEqual(r.after, r.before, 'the member is untouched');
  assert.deepEqual(r.calls.role, [], 'nothing reaches the registry');
  assert.equal(r.calls.updateConfig, 0, 'no decision');
  assert.equal(r.calls.packsList, 0, 'no starter jobs');
  assert.deepEqual(r.offersAfter, ['pam'], 'still offered');
});

test('a role the registry refuses changes nothing and records no decision', () => {
  // Value: protects=Michael never routes by a role the member does not have, and a refused save leaves the offer to try again; fails_when=a { ok: false } from hivePatchAgentRole still updates the member, seeds jobs or records 'use'; why_new=only a regex pinned the order; seam=stub window.cth in a child process; no_claim=the main side of hive:patchAgentRole
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: REVISED, roleAnswer: { ok: false } });
  assert.equal(r.result, 'failed');
  assert.deepEqual(r.after, r.before);
  assert.equal(r.calls.role.length, 1);
  assert.equal(r.calls.updateConfig, 0);
  assert.equal(r.calls.packsList, 0);
  assert.deepEqual(r.decided, {});
  assert.deepEqual(r.offersAfter, ['pam']);
});

test('Keep mine leaves the member as it is, records keep, and the offer is gone', () => {
  // Value: protects=Keep mine keeps every word of the owner's job and is asked once; fails_when=decideWorkStyleOffer writes the member, records another choice, or workStyleOffers still offers it; why_new=Keep mine had no behavior test; seam=stub window.cth in a child process; no_claim=the card's busy and failed states
  const r = runOffer({ member: CHANGED_PAM, choice: 'keep', roleAnswer: { ok: true } });
  assert.deepEqual(r.after, r.before);
  assert.deepEqual(r.calls.role, []);
  assert.equal(r.decided[r.id], 'keep');
  assert.deepEqual(r.offersAfter, []);
});

test('a decision that fails to write once is tried again, and Use it still reads as applied', () => {
  // Value: protects=a saved Use it is never reported as failed (a second Use it would leave Undo with the adopted job); fails_when=the retry goes or a decision failure turns into 'failed'; why_new=ship review 2026-10-23 added the retry with no test; seam=stub window.cth in a child process (updateConfig throws once); no_claim=a decision that fails twice
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: REVISED, roleAnswer: { ok: true }, decideThrows: 1 });
  assert.equal(r.result, 'applied');
  assert.equal(r.calls.updateConfig, 2, 'tried once more');
  assert.equal(r.decided[r.id], 'use', 'the second write landed');
  assert.equal(r.after.goal, REVISED.instructions.trim());
});

test('Use it whose decision can not be written still never offers the update again this session', () => {
  // Value: protects=the owner's own job one Undo away after Use it; fails_when=the decision write fails twice, the offer returns, and a second Use it leaves Undo holding the adopted job; why_new=cycle 2 correctness review of the reordered adopt; seam=stub window.cth in a child process, real readWorkStyleOffers; no_claim=after a restart, where the unwritten decision is lost
  const r = runOffer({ member: CHANGED_PAM, choice: 'use', revised: REVISED, roleAnswer: { ok: true }, decideThrows: 2, readOffers: true });
  assert.equal(r.result, 'applied');
  assert.equal(r.decided[r.id], undefined, 'neither write landed');
  assert.deepEqual(r.offersRead, [], 'the offer stays decided for this session');
});

// ---- 2. The foundation card's save steps ----

const FS = loadTs('src/renderer/src/shell/foundationSave.ts');
const { FOUNDATION_QUESTIONS } = loadTs('src/shared/foundations.ts');

/** A stand in for window.cth: each call is logged; answers come from `say`. */
function fakeCth(say = {}) {
  const log = [];
  const answer = (name, fallback) => async (...args) => {
    log.push([name, ...args]);
    const a = say[name] ?? fallback;
    if (a instanceof Error) throw a;
    return a;
  };
  const cth = {
    foundationsAddFile: answer('foundationsAddFile', { ok: true, docId: 'doc-7', name: 'Price list.pdf' }),
    kgRemove: answer('kgRemove', { ok: true }),
    foundationsAnswerFile: answer('foundationsAnswerFile', { ok: true, text: 'saved' }),
    foundationsAnswer: answer('foundationsAnswer', { ok: true }),
    hiveSend: answer('hiveSend', { ok: true })
  };
  const onAnswer = async (text) => { log.push(['onAnswer', text]); const a = say.onAnswer ?? true; if (a instanceof Error) throw a; return a; };
  return { cth, onAnswer, log, names: () => log.map((l) => l[0]) };
}

test('a typed answer the card refuses writes nothing to the foundations', async () => {
  // Value: protects=an answer the card did not take never lands in the foundations or reaches Michael as an add request; fails_when=saveTextAnswer writes before or without the card taking it; why_new=the card's order was only a source regex; seam=injected cth; no_claim=the card's React state
  for (const refusal of [false, new Error('closed')]) {
    const f = fakeCth({ onAnswer: refusal });
    assert.deepEqual(await FS.saveTextAnswer('prices', 'Bread is 5 dollars', f.cth, f.onAnswer), { taken: false });
    assert.deepEqual(f.names(), ['onAnswer']);
  }
  const ok = fakeCth();
  assert.deepEqual(await FS.saveTextAnswer('prices', 'Bread is 5 dollars', ok.cth, ok.onAnswer), { taken: true, how: 'saved' });
  assert.deepEqual(ok.log, [['onAnswer', 'Bread is 5 dollars'], ['foundationsAnswer', 'prices', 'Bread is 5 dollars']]);
  const fallback = fakeCth({ foundationsAnswer: { ok: false } });
  assert.deepEqual(await FS.saveTextAnswer('prices', 'Bread is 5 dollars', fallback.cth, fallback.onAnswer), { taken: true, how: 'michael' });
  assert.deepEqual(fallback.log.at(-1), ['hiveSend', { to: 'michael', act: 'request', subject: 'Add my answer to the company foundations', body: `Please add my answer to the company foundations question "${FOUNDATION_QUESTIONS.prices.text}" (prices): Bread is 5 dollars` }, 'human']);
});

test('a file answer the card refuses removes its document and never writes the answer', async () => {
  // Value: protects=a file the card did not take leaves nothing in company knowledge and no answer naming it; fails_when=kgRemove is skipped or foundationsAnswerFile still runs; why_new=the removal was only a source regex; seam=injected cth; no_claim=the knowledge store's own removal
  const f = fakeCth({ onAnswer: false });
  const steps = [];
  const res = await FS.saveFileAnswer('prices', { path: '/Users/kelly/Price list.pdf' }, 'Sunrise prices', f.cth, f.onAnswer, { checked: () => steps.push('checked'), taken: () => steps.push('taken') });
  assert.deepEqual(res, { kind: 'not-taken' });
  assert.deepEqual(f.names(), ['foundationsAddFile', 'onAnswer', 'kgRemove']);
  assert.deepEqual(f.log[2], ['kgRemove', 'doc-7']);
  assert.deepEqual(steps, ['checked'], 'never marked taken');
});

test('a file the add step refuses never answers the card and returns its refusal', async () => {
  // Value: protects=a file that does not fit, cannot be read or could not be checked never closes the card, and the card can name why; fails_when=onAnswer runs after a refusal or the error and reason are lost; why_new=the refusal lines were only source regexes; seam=injected cth; no_claim=the wording of each line
  for (const error of ['misfit', 'unreadable', 'picture-type', 'picture-engine', 'unchecked', 'no-file']) {
    const f = fakeCth({ foundationsAddFile: { ok: false, error, reason: `why ${error}` } });
    const steps = [];
    const res = await FS.saveFileAnswer('prices', { path: '/Users/kelly/x.pdf' }, 'Sunrise prices', f.cth, f.onAnswer, { checked: () => steps.push('checked'), taken: () => steps.push('taken') });
    assert.deepEqual(res, { kind: 'refused', error, reason: `why ${error}` }, error);
    assert.deepEqual(f.names(), ['foundationsAddFile'], error);
    assert.deepEqual(steps, ['checked'], error);
  }
  // Any other failure of the add step reads as Save failed, and answers nothing either.
  for (const answer of [{ ok: false, error: 'unknown' }, { ok: false, error: 'no-office' }, new Error('ipc gone')]) {
    const f = fakeCth({ foundationsAddFile: answer });
    assert.deepEqual(await FS.saveFileAnswer('prices', { path: '/x.pdf' }, '', f.cth, f.onAnswer), { kind: 'failed' });
    assert.deepEqual(f.names(), ['foundationsAddFile']);
  }
});

test('a file answer that cannot be written sends Michael the exact line with the document id', async () => {
  // Value: protects=the document id survives when the foundations write fails (Codex 3); fails_when=the fallback line changes, loses the id, or goes before the card took it; why_new=the fallback was only a source regex; seam=injected cth; no_claim=Michael adding it
  const f = fakeCth({ foundationsAnswerFile: { ok: false, error: 'no-doc' } });
  const steps = [];
  const res = await FS.saveFileAnswer('prices', { path: '/Users/kelly/Price list.pdf' }, 'Sunrise prices', f.cth, f.onAnswer, { checked: () => steps.push('checked'), taken: () => steps.push('taken') });
  assert.deepEqual(res, { kind: 'taken', how: 'michael' });
  assert.deepEqual(f.names(), ['foundationsAddFile', 'onAnswer', 'foundationsAnswerFile', 'hiveSend']);
  assert.deepEqual(f.log[1], ['onAnswer', 'Sunrise prices\n\nI added "Price list.pdf" to company knowledge for this (document doc-7).']);
  assert.deepEqual(f.log[2], ['foundationsAnswerFile', 'prices', 'doc-7', 'Sunrise prices']);
  assert.deepEqual(f.log[3], ['hiveSend', {
    to: 'michael', act: 'request', subject: 'Add my answer to the company foundations',
    body: 'Please add my answer to the company foundations question "Prices and terms" (prices): Sunrise prices. Full version: company knowledge document doc-7 (Price list.pdf)'
  }, 'human']);
  assert.deepEqual(steps, ['checked', 'taken']);
  const unsent = fakeCth({ foundationsAnswerFile: { ok: false, error: 'no-doc' }, hiveSend: { ok: false } });
  assert.deepEqual(await FS.saveFileAnswer('prices', { path: '/x.pdf' }, '', unsent.cth, unsent.onAnswer), { kind: 'taken', how: 'failed' });
});

test('the card runs its save through the extracted steps with window.cth', () => {
  // Value: protects=the tested steps are the ones the card runs; fails_when=FoundationCard.tsx calls window.cth for these steps itself again or stops passing its callbacks; why_new=the steps moved to shell/foundationSave.ts; seam=source pin; no_claim=rendering
  const card = read('src/renderer/src/components/FoundationCard.tsx');
  assert.match(card, /const res = await saveTextAnswer\(id, text, window\.cth, onAnswer\);/);
  assert.match(card, /const res = await saveFileAnswer\(id, picked, text, window\.cth, onAnswer, \{ checked: \(\) => setChecking\(false\), taken: \(\) => setFile\(null\) \}\);/);
  assert.doesNotMatch(card, /window\.cth\.(foundationsAddFile|foundationsAnswer|foundationsAnswerFile|kgRemove|hiveSend)\(/);
});

// ---- 3. A hidden Claude session's picture pastes ----

test('pictures are pasted one by one before a cleaned prompt, and Enter and onPromptSent wait for it', async (t) => {
  // Value: protects=each picture attaches before the question, the question is not sent early, and outside text cannot end the bracketed paste; fails_when=the picture or prompt timers change order, Enter or onPromptSent fire before the prompt paste, pasteSafe is dropped from the prompt write, or a bad picture path still spawns; why_new=the timing was only a source regex in foundations.test.cjs; seam=node-pty replaced in require.cache, shellEnv exports swapped, t.mock.timers; no_claim=Claude Code attaching the pictures
  const ptyPath = require.resolve('node-pty');
  const events = [];
  let spawned = 0;
  let proc = null;
  const fakePty = {
    spawn() {
      spawned++;
      const handlers = { data: [], exit: [] };
      proc = {
        pid: undefined,
        write: (s) => events.push(['write', s]),
        kill() { events.push(['kill']); },
        onData: (fn) => { handlers.data.push(fn); return { dispose() {} }; },
        onExit: (fn) => { handlers.exit.push(fn); return { dispose() {} }; },
        emit: (d) => handlers.data.forEach((fn) => fn(d)),
        exit: () => handlers.exit.forEach((fn) => fn({ exitCode: 0 }))
      };
      return proc;
    }
  };
  const prior = require.cache[ptyPath];
  require.cache[ptyPath] = { id: ptyPath, filename: ptyPath, loaded: true, exports: fakePty };
  t.after(() => { if (prior) require.cache[ptyPath] = prior; else delete require.cache[ptyPath]; });
  const shell = loadTs('src/main/shellEnv.ts');
  const realPath = shell.userShellPath;
  shell.userShellPath = () => process.env.PATH || '';
  t.after(() => { shell.userShellPath = realPath; });
  const { runHiddenClaude, pasteSafe } = loadTs('src/main/hiddenClaude.ts');

  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'review-hidden-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const base = { model: 'claude-haiku-4-5', cwd, command: path.join(cwd, 'claude'), noTools: true };
  const pictures = [path.join(cwd, 'logo.png'), path.join(cwd, 'menu board.jpg'), path.join(cwd, 'shop front.webp')];

  // A picture path holding a control character: refused at once, nothing spawned or written.
  for (const bad of [`${pictures[0]}\x1b[201~`, `${pictures[0]}\n`, `${pictures[0]}\t`]) {
    const res = await runHiddenClaude('Does this fit?', { ...base, images: [pictures[1], bad] });
    assert.deepEqual(res, { ok: false, error: 'picture path has control characters' }, JSON.stringify(bad));
  }
  assert.equal(spawned, 0);
  assert.deepEqual(events, []);

  const prompt = 'Does this fit Sunrise Bakery?\x1b[201~\rrm -rf ~\x07\x00\x7f\x9b ok\tfine\nnext line';
  const done = runHiddenClaude(prompt, { ...base, images: pictures, onPromptSent: () => events.push(['promptSent']) });
  assert.equal(spawned, 1);
  proc.emit('booting');
  t.mock.timers.tick(1500); // boot went quiet: the prompt is due
  for (let i = 0; i < 40; i++) t.mock.timers.tick(50);
  proc.exit();
  assert.deepEqual(await done, { ok: false, error: 'no assistant response found in transcript' });

  const writes = events.filter((e) => e[0] === 'write').map((e) => e[1]);
  const at = (s) => events.findIndex((e) => e[0] === 'write' && e[1] === s);
  const pasted = `\x1b[200~${pasteSafe(prompt)}\x1b[201~`;
  assert.deepEqual(writes.slice(0, 4), [...pictures.map((p) => `\x1b[200~${p}\x1b[201~`), pasted], 'each picture, in order, then the prompt');
  assert.ok(at(pasted) >= 0);
  assert.ok(writes.slice(0, writes.indexOf(pasted)).every((w) => !w.includes('\r')), 'no Enter before the prompt is pasted');
  assert.equal(writes[4], '\r', 'Enter right after the prompt');
  const sentAt = events.findIndex((e) => e[0] === 'promptSent');
  assert.ok(sentAt > at(pasted), 'onPromptSent only after the prompt paste');
  assert.equal(events.filter((e) => e[0] === 'promptSent').length, 1);
  // The prompt as pasted: no ESC or other control character but tab, newline and return.
  const inner = pasted.slice('\x1b[200~'.length, -'\x1b[201~'.length);
  assert.doesNotMatch(inner, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  assert.equal(inner, 'Does this fit Sunrise Bakery?[201~\rrm -rf ~ ok\tfine\nnext line');
});

// ---- 4. Main's wiring of a foundation card's document into company knowledge ----

test('main files a foundation card\'s document through company knowledge, reindexes it, and checks it with the standing check\'s setup', () => {
  // Value: protects=a card's file is read, added and searchable by meaning, and its fit check runs in the standing check's folder, command and engine; fails_when=the Foundations deps stop routing readFile, addToKnowledge, docTitle or fitFile as below, or fileFitCheck drifts from standingFitCheck's deps; why_new=main has no harness and nothing pinned these deps; seam=source pin scoped to each block; no_claim=the IPC or a real file add
  const src = read('src/main/index.ts');
  const start = src.indexOf('const foundations = new Foundations({');
  assert.ok(start >= 0, 'the Foundations block');
  const block = src.slice(start, src.indexOf('\n});', start) + 4);
  assert.match(block, /\n  readFile: \(path\) => knowledge\.readDocument\(path\),\n/);
  assert.match(block, /\n  fitFile: \(f\) => fileFit\(f\),\n/);
  assert.match(block, /\n  addToKnowledge: \(path, read, opts\) => \{\n    const r = knowledge\.ingestRead\(path, read, opts\);\n    memory\.companyKnowledgeChanged\(\);[^\n]*\n    return r\.docId;\n  \},\n/, 'added, then indexed for search by meaning, then its id');
  assert.match(block, /\n  docTitle: \(id\) => knowledge\.get\(id\)\?\.meta\.title\n\}\);$/);
  const body = (opener) => {
    const at = src.indexOf(opener);
    assert.ok(at >= 0, opener);
    // Code lines only: the two blocks word their comments differently.
    return src.slice(at + opener.length, src.indexOf('\n});', at)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  };
  const fit = body('const fileFit = fileFitCheck({');
  assert.equal(fit, body('const standingFit = standingFitCheck({'), "the file check runs with the standing check's deps");
  assert.match(fit, /join\(app\.getPath\('userData'\), STANDING_CHECK_DIR\)/);
});
