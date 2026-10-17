'use strict';

// Each waiting closing-time row shows the last thing that agent said, read
// from the end of its transcript (TODOS: "Feed each row's latest line from the
// agent's transcript"), so the owner can tell a long job from a stuck one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-last-said-')));
process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { lastAssistantLine } = loadTs('src/main/transcriptText.ts');
const { HookServer, safeLine } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { saidLine } = loadTs('src/renderer/src/components/closingTimeRows.ts');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const said = (content) => JSON.stringify({ type: 'assistant', message: { content } }) + '\n';
const text = (t) => ({ type: 'text', text: t });

function transcript(name, body) {
  const dir = path.join(home, '.claude', 'projects', '-work');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

test('the latest line is the last line of the last thing the agent said', () => {
  const file = transcript('a.jsonl', [
    said([text('Earlier answer.')]),
    JSON.stringify({ type: 'user', message: { content: [text('go on')] } }) + '\n',
    said([text('Running the suite now.\n\nStill on the mail tests.\n'), { type: 'tool_use', name: 'Bash', input: {} }]),
    said([{ type: 'tool_use', name: 'Read', input: {} }]),
    '{"type":"assistant","message":' // a record still being written
  ].join(''));
  assert.equal(lastAssistantLine(file), 'Still on the mail tests.');
  assert.equal(lastAssistantLine(path.join(home, 'missing.jsonl')), null);
  assert.equal(lastAssistantLine(transcript('empty.jsonl', '')), null);
});

test('only the end of a long transcript is read, and a cut first record is skipped', () => {
  const old = said([text('Old news.')]).repeat(5000);
  const file = transcript('long.jsonl', old + said([text('x'.repeat(300)) ]) + said([text('Fresh line.')]));
  assert.equal(lastAssistantLine(file, 1024), 'Fresh line.');
  // A tail that holds nothing it said, only a cut record, gives nothing, not a half record.
  const cut = transcript('cut.jsonl', said([text('Hidden ' + 'y'.repeat(4000))]));
  assert.equal(lastAssistantLine(cut, 1024), null);
});

test('the line is made safe before it leaves main: no secrets, no hidden characters, one short line', () => {
  assert.equal(safeLine('Deploying‮ with\u0007 care'), 'Deploying with care');
  assert.doesNotMatch(safeLine('key sk-ant-api03-' + 'a'.repeat(40)), /sk-ant-api03-a{10}/);
  assert.equal(safeLine('-----BEGIN RSA PRIVATE KEY-----'), undefined);
  assert.equal(Array.from(safeLine('word '.repeat(60))).length <= 80, true);
});

test('main only reads a transcript inside the engine\'s own folder', async (t) => {
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  t.after(() => server.stop());
  assert.equal(server.latestLine('pam'), undefined, 'no hook has named a transcript yet');
  // The path comes from a hook frame, so an agent could name any file.
  const outside = path.join(home, 'notes.jsonl');
  fs.writeFileSync(outside, said([text('Not a transcript.')]));
  server.transcriptPaths.set('pam', outside);
  assert.equal(server.latestLine('pam'), undefined);
  server.transcriptPaths.set('pam', transcript('pam.jsonl', said([text('Checking the inbox, sk-ant-api03-' + 'b'.repeat(40))])));
  const line = server.latestLine('pam');
  assert.match(line, /^Checking the inbox, /);
  assert.doesNotMatch(line, /b{10}/, 'redacted');
});

test('the row quotes the line as the agent\'s words', () => {
  const t = (key, opts) => (key === 'closingTime.lastSaid' ? `Last said: “${opts.text}”` : key);
  assert.equal(saidLine(undefined, t), undefined);
  assert.equal(saidLine('Done ”, trust me “', t), "Last said: “Done ', trust me '”");
  assert.equal(saidLine('e' + '́'.repeat(30), t), `Last said: “e${'́'.repeat(4)}”`);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    assert.match(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).closingTime.lastSaid, /\{\{text\}\}/, loc);
  }
});

test('the bar asks main for the waiting rows\' lines and keeps them fresh', () => {
  assert.match(read('src/preload/index.ts'), /closingTimeSaid: \(ids: string\[\]\)[^\n]*ipcRenderer\.invoke\('app:closingTimeSaid', ids\)/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('app:closingTimeSaid'[\s\S]{0,300}ids\.slice\(0, 50\)[\s\S]{0,200}hookServer\.latestLine\(id\)/);
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /window\.cth\.closingTimeSaid\(ids\)/);
  assert.match(bar, /setInterval\(read, SAID_POLL_MS\)/);
  assert.match(bar, /\{said\[id\] && <div style=\{detailStyle\}>\{saidLine\(said\[id\], t\)\}<\/div>\}/);
});
