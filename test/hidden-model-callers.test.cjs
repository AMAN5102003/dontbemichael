'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const ptyPath = require.resolve('node-pty');
require.cache[ptyPath] = { id: ptyPath, filename: ptyPath, loaded: true, exports: { spawn() { throw new Error('no real pty in tests'); } } };
const HM = loadTs('src/main/hiddenModel.ts');
const { standingFitCheck } = loadTs('src/main/standingCheck.ts');
const { checkDistinct } = loadTs('src/main/hireCheck.ts');
const W = loadTs('src/main/workStyleConvert.ts');
const { MemoryTidy } = loadTs('src/main/memoryTidy.ts');
const MI = loadTs('src/shared/memoryIndex.ts');
const { instructionsOpening, plainFallback, instructionsFallback, roleLabel } = loadTs('src/shared/workStyleText.ts');
const run = HM.runHiddenModel;
test.after(() => { HM.runHiddenModel = run; });

const engine = { engine: 'codex', engineModel: 'owner-choice' };
const deps = { ...engine, command: 'codex', cwd: os.tmpdir() };
const ctx = { name: 'Erin', title: 'Travel', business: { name: 'Test Business' } };
const job = { name: 'Erin', title: 'Travel', routing: 'Erin books travel and hotel rooms.' };
const team = [{ name: 'Pam', title: 'Finance', routing: 'Pam prepares financial reports.' }];
const email = { to: 'customer@example.org', subject: 'Order status', body: 'Your order is ready.' };
const focus = { name: 'Erin', job: 'Travel', focus: 'Check hotel bookings', workStyle: 'Check dates first.', others: [] };
const suggestion = { ctx, handles: 'Books travel', team: [] };

function stub(reply) {
  const calls = [];
  HM.runHiddenModel = async (prompt, opts) => { calls.push({ prompt, opts }); return reply; };
  return calls;
}

function assertEngine(calls, count = 1) {
  assert.equal(calls.length, count);
  for (const { opts } of calls) {
    assert.equal(opts.engine, 'codex');
    assert.equal(opts.engineModel, 'owner-choice');
    assert.equal(opts.command, 'codex');
    assert.equal(opts.noTools, true, 'outside text is never given tools');
  }
}

test('standing approval uses the neutral runner; unavailable remains an owner decision', async () => {
  const check = standingFitCheck({ cwd: () => os.tmpdir(), command: () => 'codex', modelEngine: () => engine });
  const calls = stub({ ok: true, text: 'FITS' });
  assert.deepEqual(await check('order status', email), { fits: true });
  assertEngine(calls);
  assert.equal(calls[0].opts.settingSources, 'user', 'Claude restrictions are preserved');
  stub({ ok: false, error: 'engine unavailable' });
  assert.equal(await check('order status', email), null);
});

test('hire overlap check uses the neutral runner and retains the rules fallback', async () => {
  const calls = stub({ ok: true, text: '{"distinct":true,"overlapsWith":[],"why":"Different work."}' });
  assert.equal((await checkDistinct(job, team, deps)).source, 'ai');
  assertEngine(calls);
  stub({ ok: false, error: 'engine unavailable' });
  assert.equal((await checkDistinct(job, team, deps)).source, 'rules');
});

test('work style conversion uses the runner in both directions and retains plain-text fallbacks', async () => {
  for (const to of ['plain', 'instructions']) {
    const req = { to, text: 'Check dates before booking.', ctx };
    const text = to === 'plain' ? 'The job: Books travel.' : `${instructionsOpening(ctx.business)}\nCheck dates first.`;
    const calls = stub({ ok: true, text });
    assert.equal((await W.convertWorkStyle(req, deps)).source, 'ai');
    assertEngine(calls);
    assert.equal(calls[0].opts.model, to === 'plain' ? 'claude-haiku-4-5' : 'claude-sonnet-5', 'existing Claude models stay intact');
    stub({ ok: false, error: 'engine unavailable' });
    assert.deepEqual(await W.convertWorkStyle(req, deps), {
      source: 'rules', text: to === 'plain' ? plainFallback(req.text, roleLabel(ctx.title)) : instructionsFallback(req.text, ctx)
    });
  }
});

test('focus check uses the runner and unavailable remains unchecked', async () => {
  const calls = stub({ ok: true, text: 'OK' });
  assert.deepEqual(await W.checkFocusArea(focus, deps), { checked: true });
  assertEngine(calls);
  stub({ ok: false, error: 'engine unavailable' });
  assert.deepEqual(await W.checkFocusArea(focus, deps), { checked: false });
});

test('work style suggestion uses the runner, keeps preview/Stop and returns empty when unavailable', async () => {
  const signal = new AbortController().signal;
  const onText = () => {};
  const calls = stub({ ok: true, text: 'The job: Books travel.' });
  assert.deepEqual(await W.suggestWorkStyle(suggestion, deps, { signal, onText }), { text: 'The job: Books travel.' });
  assertEngine(calls);
  assert.equal(calls[0].opts.signal, signal);
  assert.equal(calls[0].opts.onScreenText, onText);
  stub({ ok: false, error: 'engine unavailable' });
  assert.deepEqual(await W.suggestWorkStyle(suggestion, deps), { text: '' });
  stub({ ok: false, error: 'cancelled' });
  assert.deepEqual(await W.suggestWorkStyle(suggestion, deps), { text: '', cancelled: true });
});

test('memory tidy uses the runner and restores original notes/index when unavailable', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory check with spaces '));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'erin');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const indexPath = path.join(dir, 'memory.md');
  const inbox = path.join(dir, 'memory', 'inbox.md');
  fs.writeFileSync(indexPath, MI.renderIndex('Erin', 'erin', []));
  fs.writeFileSync(inbox, '- Check dates before booking.\n');
  const tidy = new MemoryTidy(() => home, () => 'codex', () => ({}), () => true, () => 'Erin', () => {}, () => engine);
  const calls = stub({ ok: true, text: '{"ops":[{"op":"add","kind":"fact","text":"Check dates before booking.","source":"task"}]}' });
  assert.equal((await tidy.tidyNow('erin'))[0].tidied, true);
  assertEngine(calls);
  assert.match(fs.readFileSync(indexPath, 'utf8'), /Check dates before booking/);
  assert.ok(!fs.existsSync(inbox));
  const original = fs.readFileSync(indexPath, 'utf8');
  const notes = '- New externally supplied note.\n';
  fs.writeFileSync(inbox, notes);
  stub({ ok: false, error: 'engine unavailable' });
  const result = (await tidy.tidyNow('erin'))[0];
  assert.equal(result.tidied, false);
  assert.equal(result.reason, 'model-failed');
  assert.equal(fs.readFileSync(indexPath, 'utf8'), original);
  assert.equal(fs.readFileSync(inbox, 'utf8'), notes);
});

test('production callers take the engine and model from Michael, not a command-name guess', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const section = source.slice(source.indexOf("ipcMain.handle('hire:checkDistinct'"), source.indexOf("ipcMain.handle('engine:status'"));
  for (const fn of ['checkDistinct', 'convertWorkStyle', 'checkFocusArea', 'suggestWorkStyle']) {
    assert.match(section, new RegExp(`${fn}\\([^]*?engine: cfg\\.godProvider \\?\\? 'claude',\\s*engineModel: cfg\\.godModel`));
  }
  assert.match(source, /modelEngine: \(\) => \{\s*const cfg = readConfig\(\);\s*return \{ engine: cfg\.godProvider \?\? 'claude', engineModel: cfg\.godModel \};/);
});
