'use strict';

// A file fit check runs in a throwaway Claude Code settings folder: Claude
// Code keeps every pasted prompt in its shared history.jsonl and paste-cache,
// which dropping the transcript does not touch, so a private file picked by
// mistake stayed on disk (ship review, 2026-10-23). Runs a fake `claude` in a
// real PTY that writes where Claude Code would.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const POSIX = process.platform !== 'win32';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-isolate-home-'));
process.env.HOME = home;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const { runHiddenClaude } = loadTs('src/main/hiddenClaude.ts');

// The fake reports what it was started with, then on Enter writes its history
// and transcript under CLAUDE_CONFIG_DIR as Claude Code does, and answers.
const FAKE = `
const fs = require('fs');
const path = require('path');
const id = process.argv[process.argv.indexOf('--session-id') + 1];
const cfg = process.env.CLAUDE_CONFIG_DIR;
fs.writeFileSync(process.env.FAKE_REPORT, JSON.stringify({
  cfg, secure: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, market: process.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL,
  claudeJson: JSON.parse(fs.readFileSync(path.join(cfg, '.claude.json'), 'utf8')),
  settings: JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'))
}));
const line = (type, text) => JSON.stringify({ type, message: { content: [{ type: 'text', text }] } }) + '\\n';
process.stdout.write('> ');
process.stdin.on('data', (d) => {
  if (!/[\\r\\n]/.test(String(d))) return;
  fs.appendFileSync(path.join(cfg, 'history.jsonl'), JSON.stringify({ display: 'the private file text' }) + '\\n');
  const dir = path.join(cfg, 'projects', process.env.FAKE_CWD.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.jsonl');
  fs.writeFileSync(file, line('user', 'check'));
  setTimeout(() => fs.appendFileSync(file, line('assistant', 'FITS')), 200);
});
`;

function fakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-isolate-bin-'));
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" "$@"\n`, { mode: 0o755 });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-isolate-cwd-'));
  return { bin, cwd, report: path.join(dir, 'report.json') };
}

test('an isolated check answers from its own folder and leaves nothing behind', { skip: !POSIX }, async () => {
  // Value: protects=a private file picked by mistake on a foundation card; fails_when=the check's pasted text stays in ~/.claude history or paste cache, or the throwaway folder is left on disk; why_new=ship review 2026-10-23 found both stores kept the file text after dropTranscript; seam=fake claude in a real PTY writing under CLAUDE_CONFIG_DIR; no_claim=that real Claude Code honours CLAUDE_SECURESTORAGE_CONFIG_DIR (verified live, not here)
  const { bin, cwd, report } = fakeClaude();
  const realCfg = path.join(home, '.claude');
  const r = await runHiddenClaude('Does this file fit?', {
    model: 'haiku', cwd, command: bin, noTools: true, timeoutMs: 30_000, isolateConfig: true, dropTranscript: true,
    // Something passed in can not point the check back at the shared folder.
    env: { FAKE_REPORT: report, FAKE_CWD: cwd, CLAUDE_CONFIG_DIR: realCfg }
  });
  assert.deepEqual(r, { ok: true, text: 'FITS' });
  const seen = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.notEqual(seen.cfg, realCfg);
  assert.ok(path.basename(seen.cfg).startsWith('dbm-check-'));
  assert.equal(seen.secure, '', 'the sign in stays the default ~/.claude one');
  assert.equal(seen.market, '1');
  assert.equal(seen.claudeJson.hasCompletedOnboarding, true);
  assert.equal(seen.claudeJson.projects[cwd].hasTrustDialogAccepted, true);
  assert.equal(seen.settings.skipDangerousModePermissionPrompt, true);
  // Removed at once; the PTY may still be exiting, so give it a moment.
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(fs.existsSync(seen.cfg), false, 'the throwaway folder is gone, history with it');
  assert.equal(fs.existsSync(path.join(realCfg, 'history.jsonl')), false, 'nothing reached the shared history');
});

test('the file fit check asks for an isolated run', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/main/fileFitCheck.ts'), 'utf8'), /dropTranscript: true,[\s\S]{0,120}isolateConfig: true/);
});
