'use strict';

/**
 * The secret store (src/main/integrations.ts) and its atomic write
 * (src/main/atomicFile.ts).
 *
 * One file holds every saved secret: mailbox passwords (`mail:<id>`), engine
 * keys (`apikey:<backend>`) and integration secrets (`int:<id>`), so a write
 * cut short by a crash must never lose the others. What would hurt: a torn
 * file that reads back as empty, a leftover temp file, or a secret written in
 * plaintext when OS encryption is off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

// integrations.ts and config.ts reach Electron for app.getPath and safeStorage;
// stand in a throwaway userData root and a reversible "encryption" (same seam as
// business-onboarding.test.cjs).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-secret-store-'));
let encryptionOn = true;
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: {
    app: { getPath: () => userData },
    safeStorage: {
      isEncryptionAvailable: () => encryptionOn,
      encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
      decryptString: (b) => b.toString('utf8').replace(/^enc:/, '')
    }
  }
};
const { setSecret, getSecret, hasSecret, deleteSecret, canStoreSecrets, secretStoreUnavailableReason } = loadTs('src/main/integrations.ts');
const { writeFileAtomic, sweepStaleTemps } = loadTs('src/main/atomicFile.ts');
const scratch = [userData];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

const secretsFile = path.join(userData, 'integration-secrets.json');
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

// A temp file a crash left before the rename, an hour old; the store clears it on first use.
const crashLeftover = path.join(userData, 'integration-secrets.json.0123456789ab.tmp');
fs.writeFileSync(crashLeftover, 'ciphertext');
const anHourAgo = new Date(Date.now() - 3600_000);
fs.utimesSync(crashLeftover, anHourAgo, anHourAgo);

test('a temp file a crash left behind is removed the first time the store is used', () => {
  // Value: protects=an encrypted temp file nothing reads doesn't sit in userData forever; fails_when=the store never sweeps; why_new=TODOS "Sweep leftover secrets temp files"; seam=none
  assert.equal(hasSecret('mail:nobody'), false);
  assert.equal(fs.existsSync(crashLeftover), false);
});

test('mail, engine key and integration secrets all round-trip, and are stored encrypted', () => {
  assert.deepEqual(setSecret('mail:sales', 'app-password-1'), { ok: true });
  assert.deepEqual(setSecret('apikey:openai', 'sk-test-2'), { ok: true });
  assert.deepEqual(setSecret('int:quickbooks', 'client-secret-3'), { ok: true });
  assert.equal(getSecret('mail:sales'), 'app-password-1');
  assert.equal(getSecret('apikey:openai'), 'sk-test-2');
  assert.equal(getSecret('int:quickbooks'), 'client-secret-3');
  const raw = fs.readFileSync(secretsFile, 'utf8');
  assert.ok(!raw.includes('app-password-1') && !raw.includes('sk-test-2'), 'no plaintext on disk');
  if (process.platform !== 'win32') assert.equal(fs.statSync(secretsFile).mode & 0o777, 0o600);
  assert.deepEqual(leftovers(userData), [], 'no temp file left behind');
});

test('updating one secret keeps the others, and delete removes only its own', () => {
  setSecret('mail:sales', 'app-password-1b');
  assert.equal(getSecret('mail:sales'), 'app-password-1b');
  assert.equal(getSecret('apikey:openai'), 'sk-test-2');
  deleteSecret('apikey:openai');
  assert.equal(hasSecret('apikey:openai'), false);
  assert.equal(getSecret('int:quickbooks'), 'client-secret-3');
});

test('with OS encryption off, nothing is written in plaintext and nothing is lost', () => {
  const before = fs.readFileSync(secretsFile, 'utf8');
  encryptionOn = false;
  try {
    const r = setSecret('mail:support', 'plain-should-never-land');
    assert.equal(r.ok, false);
    assert.equal(r.error, secretStoreUnavailableReason());
    assert.match(r.error, /nothing was saved/);
    assert.doesNotMatch(r.error, /safeStorage|plaintext|encryption is unavailable/, 'plain words, not the raw error');
  } finally {
    encryptionOn = true;
  }
  assert.equal(fs.readFileSync(secretsFile, 'utf8'), before, 'the file is untouched');
});

test('secretStoreUnavailableReason says what to do on each platform, in plain words', () => {
  assert.match(secretStoreUnavailableReason('darwin'), /keychain/);
  assert.match(secretStoreUnavailableReason('linux'), /keyring/);
  assert.match(secretStoreUnavailableReason('win32'), /Restart the computer/);
  for (const p of ['darwin', 'linux', 'win32']) {
    const reason = secretStoreUnavailableReason(p);
    assert.match(reason, /nothing was saved/);
    assert.match(reason, /try again/i);
  }
});

test('canStoreSecrets follows OS encryption, so a mailbox is refused before its login test', () => {
  assert.equal(canStoreSecrets(), true);
  encryptionOn = false;
  try {
    assert.equal(canStoreSecrets(), false);
  } finally {
    encryptionOn = true;
  }
});

test('a write that fails before the rename leaves the old file intact and no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, '{"mail:sales":"old"}');
  const failRename = { ...realOps(), renameSync: () => { throw new Error('power cut before rename'); } };
  assert.throws(() => writeFileAtomic(file, '{"mail:sales":"new"}', 0o600, failRename), /power cut/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"mail:sales":"old"}');
  assert.deepEqual(leftovers(dir), []);
});

test('a write that fails midway (disk full) leaves the old file intact and no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, '{"mail:sales":"old"}');
  const failWrite = { ...realOps(), writeSync: (fd) => { fs.writeSync(fd, '{"mail:sa'); throw new Error('ENOSPC'); } };
  assert.throws(() => writeFileAtomic(file, '{"mail:sales":"new"}', 0o600, failWrite), /ENOSPC/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"mail:sales":"old"}', 'the half-written data never replaced the file');
  assert.deepEqual(leftovers(dir), []);
});

test('a successful atomic write replaces the file whole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, 'old');
  writeFileAtomic(file, 'new contents');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new contents');
  assert.deepEqual(leftovers(dir), []);
});

test('a short write (disk nearly full) is never renamed over the file', () => {
  // Value: protects=a partially written temp file never replaces the secret store; fails_when=the byte count from the write is ignored; why_new=ship review: a single fs.writeSync can stop short; seam=injected writeSync
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, '{"mail:sales":"old"}');
  const shortWrite = { ...realOps(), writeSync: (fd, data) => fs.writeSync(fd, data.slice(0, 5)) };
  assert.throws(() => writeFileAtomic(file, '{"mail:sales":"new"}', 0o600, shortWrite), /short write/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"mail:sales":"old"}');
  assert.deepEqual(leftovers(dir), []);
});

test('an existing file readable by others comes back owner-only', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, () => {
  // Value: protects=the secret store ends up 0600 even if an older copy was 0644; fails_when=the write keeps the old file's mode; why_new=ship review; seam=none
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, 'old', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  writeFileAtomic(file, 'new');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('a secrets file that is there but unreadable is never saved over', () => {
  // Value: protects=a damaged or momentarily unreadable file can't turn the next save into "erase every other secret"; fails_when=setSecret treats an unreadable file as empty; why_new=ship review (pre-existing bug, owner chose to fix here); seam=none
  const before = fs.existsSync(secretsFile) ? fs.readFileSync(secretsFile) : null;
  try {
    for (const bad of ['{"mail:sales":"enc', '[1,2]', 'null']) {
      fs.writeFileSync(secretsFile, bad);
      const r = setSecret('apikey:openai', 'sk-new');
      assert.equal(r.ok, false, bad);
      assert.match(r.error, /could not be read/);
      assert.equal(fs.readFileSync(secretsFile, 'utf8'), bad, 'left exactly as it was');
    }
  } finally {
    if (before) fs.writeFileSync(secretsFile, before); else fs.rmSync(secretsFile, { force: true });
  }
});

test('after the rename the folder is flushed, and a folder that cannot be opened does not fail the save', () => {
  // Value: protects=a saved secret survives a power cut right after the save, without breaking platforms that can't fsync a folder; fails_when=the folder isn't fsynced, or its failure fails the write; why_new=ship review; seam=injected ops
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  // fd numbers are reused (the temp file's is freed before the folder opens),
  // so each fsync is recorded by the path its fd was opened for.
  const pathOf = new Map();
  const synced = [];
  const ops = { ...realOps(), openSync: (p, f, m) => { const fd = fs.openSync(p, f, m); pathOf.set(fd, p); return fd; }, fsyncSync: (fd) => { synced.push(pathOf.get(fd)); fs.fsyncSync(fd); } };
  writeFileAtomic(file, 'data', 0o600, ops);
  assert.equal(synced.length, 2, 'the temp file, then the folder');
  assert.equal(synced[1], dir, 'the folder was flushed after the rename');
  const noDir = { ...realOps(), openSync: (p, f, m) => { if (p === dir) throw new Error('EISDIR'); return fs.openSync(p, f, m); } };
  writeFileAtomic(file, 'data2', 0o600, noDir);
  assert.equal(fs.readFileSync(file, 'utf8'), 'data2');
  assert.deepEqual(leftovers(dir), []);
});

test('a temp name that is somehow taken is left alone', () => {
  // Value: protects=cleanup never deletes a file this write did not create; fails_when=the catch removes the temp path after the exclusive open failed; why_new=ship review cycle 2; seam=injected openSync
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-atomic-'));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  let removed = 0;
  const taken = { ...realOps(), openSync: () => { const e = new Error('EEXIST'); e.code = 'EEXIST'; throw e; }, rmSync: () => { removed++; } };
  assert.throws(() => writeFileAtomic(file, 'x', 0o600, taken), /EEXIST/);
  assert.equal(removed, 0);
});

test('the sweep removes only old temp files of this target', () => {
  // Value: protects=a write in progress and other files survive the sweep; fails_when=the age or name check is dropped; why_new=TODOS "Sweep leftover secrets temp files"; seam=now
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md atomic sweep '));
  t_cleanup(dir);
  const file = path.join(dir, 'secrets.json');
  const now = Date.now();
  const make = (name, ageMs) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x');
    const t = new Date(now - ageMs);
    fs.utimesSync(p, t, t);
    return p;
  };
  const stale = make('secrets.json.0123456789ab.tmp', 120_000);
  const fresh = make('secrets.json.ba9876543210.tmp', 1_000);
  const other = make('other.json.0123456789ab.tmp', 120_000);
  const lookalike = make('secrets.json.backup.tmp', 120_000);
  const target = make('secrets.json', 120_000);
  sweepStaleTemps(file, 60_000, now);
  assert.equal(fs.existsSync(stale), false);
  for (const kept of [fresh, other, lookalike, target]) assert.ok(fs.existsSync(kept), kept);
  sweepStaleTemps(path.join(dir, 'missing', 'secrets.json'));
});

function realOps() {
  return {
    openSync: fs.openSync,
    writeSync: (fd, data) => { fs.writeFileSync(fd, data, 'utf8'); return Buffer.byteLength(data, 'utf8'); },
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    rmSync: fs.rmSync
  };
}

function t_cleanup(dir) {
  scratch.push(dir);
}

// ── deleteSecret says whether the secret is gone (issue 133) ─────────────────
const { removeRecord } = loadTs('src/main/integrations.ts');

/** Runs `fn` with console.error captured; returns what was logged. */
function captureErrors(fn) {
  const logged = [];
  const real = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try { fn(); } finally { console.error = real; }
  return logged;
}

test('deleteSecret says the secret is gone when it removed it, or when there was nothing to remove (issue 133)', () => {
  // Value: protects=removal paths can tell a removed secret from one left behind; fails_when=deleteSecret stops returning true after a real removal; why_new=deleteSecret returned nothing; seam=none
  setSecret('mail:support', 'app-password-9');
  setSecret('apikey:gemini', 'gm-key');
  assert.equal(deleteSecret('mail:support'), true);
  assert.equal(hasSecret('mail:support'), false);
  assert.equal(getSecret('apikey:gemini'), 'gm-key', 'the others stay');
  assert.equal(deleteSecret('mail:support'), true, 'already gone: nothing left to remove');
  assert.equal(deleteSecret(undefined), true);
  assert.equal(deleteSecret('apikey:gemini'), true);
});

test('with an unreadable secrets file, deleteSecret does not throw, says so, and leaves the file as it was (issue 133)', () => {
  // Value: protects=a removal never reports success while the old encrypted secret is still on disk; fails_when=an unreadable file reads as empty again, or deleteSecret throws; why_new=it read as empty and returned quietly; seam=none
  const before = fs.existsSync(secretsFile) ? fs.readFileSync(secretsFile) : null;
  try {
    for (const bad of ['{"mail:sales":"enc', '[1,2]', 'null']) {
      fs.writeFileSync(secretsFile, bad);
      assert.equal(deleteSecret('mail:sales'), false, bad);
      assert.equal(fs.readFileSync(secretsFile, 'utf8'), bad, 'left exactly as it was');
    }
  } finally {
    if (before) fs.writeFileSync(secretsFile, before); else fs.rmSync(secretsFile, { force: true });
  }
});

test('when the secrets file cannot be written, deleteSecret says so and the secret is still there (issue 133)', { skip: process.platform === 'win32' ? 'POSIX folder modes' : false }, () => {
  // Value: protects=a failed write is reported, not taken as removed; fails_when=deleteSecret swallows a failed write as success; why_new=a failed write threw out of deleteSecret; seam=a read-only userData folder
  setSecret('mail:billing', 'app-password-7');
  setSecret('apikey:openai', 'sk-keep');
  fs.chmodSync(userData, 0o500);
  try {
    assert.equal(deleteSecret('mail:billing'), false);
  } finally {
    fs.chmodSync(userData, 0o700);
  }
  assert.equal(getSecret('mail:billing'), 'app-password-7', 'still stored, as reported');
  assert.equal(deleteSecret('mail:billing'), true, 'removed once the folder is writable again');
  deleteSecret('apikey:openai');
});

test('removing a connected app logs when its secret could not be removed, and stays quiet when it could (issue 133)', () => {
  // Value: protects=a connected app's leftover secret is never silently kept; fails_when=removeRecord ignores deleteSecret's answer; why_new=the removal path reported nothing; seam=console.error captured
  setSecret('int:crm', 'client-secret');
  let quiet;
  const ok = captureErrors(() => { quiet = removeRecord('crm'); });
  assert.deepEqual(quiet, { ok: true });
  assert.deepEqual(ok, [], 'removed: nothing logged');
  assert.equal(hasSecret('int:crm'), false);
  const before = fs.existsSync(secretsFile) ? fs.readFileSync(secretsFile) : null;
  try {
    fs.writeFileSync(secretsFile, '{"int:crm":"enc');
    let res;
    const logged = captureErrors(() => { res = removeRecord('crm'); });
    assert.deepEqual(res, { ok: true }, 'the record is still removed, and nothing throws');
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^\[integrations\] .*could not be: crm$/);
  } finally {
    if (before) fs.writeFileSync(secretsFile, before); else fs.rmSync(secretsFile, { force: true });
  }
});

test('clearing an engine key still reports a key that could not be removed (issue 133)', () => {
  // Value: protects=Settings is not told a key is gone when it may still be stored; fails_when=providerKey:clear ignores deleteSecret's answer now that it no longer throws; why_new=the handler relied on a throw; seam=source pin (index.ts does not load under node)
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const start = main.indexOf("ipcMain.handle('providerKey:clear'");
  const handler = main.slice(start, main.indexOf('\n});', start));
  assert.match(handler, /if \(!integrations\.deleteSecret\(providerKeyRef\(backend\)\)\) return \{ ok: false, error: '[^']+' \};/);
});
