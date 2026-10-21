'use strict';

/**
 * Where agents are told their work lives (Decisions 44, 48; F4-F6).
 *
 * The folder instructions are GATED: they appear only on a business install,
 * one with a business folder (Michael's). On an older install Michael still runs inside the
 * harness folder, and telling him never to write there would contradict where
 * he actually is, so the gate matters in both directions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

/** The system-prompt text passed at spawn. */
function promptOf(inj) {
  const i = inj.args.indexOf('--append-system-prompt');
  assert.ok(i >= 0, 'claude spawns carry an appended system prompt');
  return inj.args[i + 1];
}

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-folders-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const business = path.join(home, 'Documents', 'Pho');
  const finance = path.join(business, 'Finance');
  fs.mkdirSync(finance, { recursive: true });
  return { home, business, finance, hive: new HiveManager(() => home) };
}

test('an older install (no business folder) gets no folder instructions at all', async (t) => {
  const { home, hive } = setup(t);
  const p = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }));
  assert.doesNotMatch(p, /YOUR FOLDERS/);
  assert.doesNotMatch(p, /NEVER save documents/);
});

test('a team member is told its own folder is private, and that the hive is off limits', async (t) => {
  const { hive, business, finance } = setup(t);
  const p = promptOf(await hive.ensureAgent(
    { id: 'oscar', name: 'Oscar', provider: 'claude', cwd: finance, role: 'Finance' },
    { businessFolder: business }
  ));
  assert.ok(p.includes(`you work in ${finance}`), 'names its own folder');
  assert.match(p, /read it for context first/);
  assert.doesNotMatch(p, /before searching the internet/, 'only Research uses the internet (issue #230)');
  assert.match(p, /It is private: only you, anyone sharing this folder, and Michael can open it/, 'its folder is private');
  assert.doesNotMatch(p, /Office folder/, 'no shared folder: company knowledge is the knowledge feature');
  assert.match(p, /is only for coordination: your memory notes, inbox and outbox\. Save documents, drafts and other work outside it\./);
});

test('Michael works in his own private folder and reads his team\'s folders', async (t) => {
  const { hive, business } = setup(t);
  const p = promptOf(await hive.ensureAgent(
    { id: 'god', name: 'Michael', provider: 'claude', cwd: business, isGod: true },
    { businessFolder: business }
  ));
  assert.ok(p.includes(`you work in ${business}, your folder. It is private: only you and the owner can open it.`));
  assert.match(p, /You can read their files, but only they change them/);
  assert.doesNotMatch(p, /Office folder/);
  assert.match(p, /Save documents, drafts and other work outside it/);
});

test('agents are given the exact doc-text command for Word, Excel and PowerPoint', async (t) => {
  const { hive, business, finance } = setup(t);
  const cli = '/App/Contents/Resources/app.asar/out/main/docTextCli.js';
  const p = promptOf(await hive.ensureAgent(
    { id: 'oscar', name: 'Oscar', provider: 'claude', cwd: finance },
    { businessFolder: business, docTextCliPath: cli }
  ));
  assert.match(p, /To read a Word, Excel or PowerPoint file, run/);
  assert.ok(p.includes(`"${cli}" "<file>"`), 'the absolute CLI path, quoted');
  assert.match(p, /You can open PDFs and images directly/);
});
