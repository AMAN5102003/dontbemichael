'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { windowsOnly } = require('./platform.cjs');

// ensureClaudePermissionsAccepted() writes below os.homedir(). Redirect both
// home variables before loading config.ts so this test can never touch the
// user's real Claude configuration.
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-claude-config-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
assert.equal(os.homedir(), home, 'home redirect failed; refusing to run against the real home');

const userData = path.join(home, 'user-data');
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { app: { getPath: () => userData } }
};

const { ensureClaudePermissionsAccepted, approveClaudeApiKey, claudeProjectKey } = loadTs('src/main/config.ts');
// Every key a trusted folder is filed under: as typed, and as Claude Code
// files it (forward slashes on Windows; the same key elsewhere).
const trustKeys = (p) => [...new Set([p, claudeProjectKey(p)])];
const trusted = (p) => Object.fromEntries(trustKeys(p).map((k) => [k, { hasTrustDialogAccepted: true }]));
const settingsDir = path.join(home, '.claude');
const settingsPath = path.join(settingsDir, 'settings.json');
const projectConfigPath = path.join(home, '.claude.json');
const cwd = path.join(home, 'workspace', 'project');

function writeSettings(contents) {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(settingsPath, contents, 'utf8');
}

function resetConfigs() {
  fs.rmSync(settingsDir, { recursive: true, force: true });
  fs.rmSync(projectConfigPath, { force: true });
}

test.beforeEach(resetConfigs);
test.after(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

test('preserves malformed Claude config files byte-for-byte', () => {
  const malformedSettings = '{\n  "env": {\n    "CUSTOM_VALUE": "preserve-me"\n  },\n';
  const malformedProjectConfig = '{\n  "projects": {\n';
  const warnings = [];
  const originalWarn = console.warn;
  writeSettings(malformedSettings);
  fs.writeFileSync(projectConfigPath, malformedProjectConfig, 'utf8');

  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    ensureClaudePermissionsAccepted(cwd);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(fs.readFileSync(settingsPath, 'utf8'), malformedSettings);
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), malformedProjectConfig);
  assert.ok(warnings.some((line) => line.includes(settingsPath)));
  assert.ok(warnings.some((line) => line.includes(projectConfigPath)));
});

test('merges required fields into valid configs without losing unrelated data', () => {
  writeSettings(JSON.stringify({
    env: { CUSTOM_VALUE: 'preserve-me' },
    hooks: { example: true }
  }, null, 2));
  fs.writeFileSync(projectConfigPath, JSON.stringify({
    numStartups: 7,
    projects: {
      [claudeProjectKey(cwd)]: { allowedTools: ['Read'], custom: 'keep' },
      '/another/project': { hasTrustDialogAccepted: false }
    }
  }, null, 2));

  ensureClaudePermissionsAccepted(cwd);

  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), {
    env: { CUSTOM_VALUE: 'preserve-me' },
    hooks: { example: true },
    skipDangerousModePermissionPrompt: true,
    skipAutoPermissionPrompt: true
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')), {
    numStartups: 7,
    hasCompletedOnboarding: true,
    projects: {
      ...trusted(cwd),
      [claudeProjectKey(cwd)]: {
        allowedTools: ['Read'],
        custom: 'keep',
        hasTrustDialogAccepted: true
      },
      '/another/project': { hasTrustDialogAccepted: false }
    }
  });
});

test('creates minimal config files when they are missing', () => {
  ensureClaudePermissionsAccepted(cwd);

  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), {
    skipDangerousModePermissionPrompt: true,
    skipAutoPermissionPrompt: true
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')), {
    hasCompletedOnboarding: true,
    projects: trusted(cwd)
  });
});

test('a malformed settings file does not prevent safe project trust updates', () => {
  const malformedSettings = '{ "preserve": true,';
  writeSettings(malformedSettings);
  fs.writeFileSync(projectConfigPath, JSON.stringify({ custom: 'keep' }), 'utf8');

  ensureClaudePermissionsAccepted(cwd);

  assert.equal(fs.readFileSync(settingsPath, 'utf8'), malformedSettings);
  assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')), {
    custom: 'keep',
    hasCompletedOnboarding: true,
    projects: trusted(cwd)
  });
});

test('does not rewrite configs that already contain every required field', () => {
  const settings = '{"skipDangerousModePermissionPrompt":true,"skipAutoPermissionPrompt":true}\n';
  const projectConfig = JSON.stringify({
    hasCompletedOnboarding: true,
    projects: trusted(cwd)
  }) + '\n';
  writeSettings(settings);
  fs.writeFileSync(projectConfigPath, projectConfig, 'utf8');

  ensureClaudePermissionsAccepted(cwd);
  ensureClaudePermissionsAccepted(cwd);

  assert.equal(fs.readFileSync(settingsPath, 'utf8'), settings);
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), projectConfig);
});

test('preserves existing config files with unsafe JSON root shapes', () => {
  writeSettings('null\n');
  fs.writeFileSync(projectConfigPath, '["keep"]\n', 'utf8');

  ensureClaudePermissionsAccepted(cwd);

  assert.equal(fs.readFileSync(settingsPath, 'utf8'), 'null\n');
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), '["keep"]\n');
});

test('a folder typed in another letter case is trusted under its real name too', () => {
  const real = path.join(home, 'workspace', 'CaseFolder');
  fs.mkdirSync(real, { recursive: true });
  const typed = path.join(home, 'workspace', 'CASEFOLDER');
  const caseInsensitive = fs.existsSync(typed);
  ensureClaudePermissionsAccepted(caseInsensitive ? typed : real);
  const projects = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).projects;
  assert.equal(projects[claudeProjectKey(fs.realpathSync.native(real))].hasTrustDialogAccepted, true, 'the real name is trusted');
  if (caseInsensitive) assert.equal(projects[claudeProjectKey(typed)].hasTrustDialogAccepted, true, 'the typed name stays trusted');
});

test('on Windows a folder is trusted under the key Claude Code looks up, with forward slashes', () => {
  // Value: protects=a Windows agent starts instead of stopping on "Quick safety check: Is this a project you trust?" and exiting code 1 (owner 2026-10-09, office folder under OneDrive); fails_when=the trust key keeps backslashes on Windows, or Mac and Linux paths are changed; why_new=Claude Code 2.1.295 normalizePathForConfigKey turns \\ into / on Windows and reads only that key; seam=platform injected for the key, real file write on the Windows runner
  assert.equal(claudeProjectKey(String.raw`C:\Users\Ann\OneDrive\Documents\Office`, 'win32'), 'C:/Users/Ann/OneDrive/Documents/Office');
  assert.equal(claudeProjectKey('C:/Users/Ann/Office', 'win32'), 'C:/Users/Ann/Office', 'already forward');
  assert.equal(claudeProjectKey('/Users/ann/Office', 'darwin'), '/Users/ann/Office');
  assert.equal(claudeProjectKey(String.raw`/odd\name`, 'linux'), String.raw`/odd\name`, 'a backslash is a real character outside Windows');
  ensureClaudePermissionsAccepted(cwd);
  const keys = Object.keys(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).projects);
  if (process.platform === 'win32') {
    assert.ok(keys.includes(cwd.replaceAll('\\', '/')), JSON.stringify(keys));
    assert.ok(keys.includes(cwd), 'the folder as typed too, for an older Claude');
  } else {
    assert.ok(keys.includes(cwd));
  }
  // Value: protects=the trust write itself uses the Windows key, checked on every runner; fails_when=trustClaudeFolder stops passing its folders through claudeProjectKey; why_new=the write above is only checked for slashes on the Windows runner, which is advisory in CI; seam=none (process.platform overridden in this test only)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  try {
    resetConfigs();
    ensureClaudePermissionsAccepted(String.raw`C:\Users\Ann\Office`);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).projects).sort(), [String.raw`C:\Users\Ann\Office`, 'C:/Users/Ann/Office'].sort(),
    'the key Claude Code reads, plus the folder as typed for an older Claude');
});

// Get Michael ready (docs/designs/get-michael-ready.md): Claude Code's welcome
// screen and its "use this API key?" question would wait in an agent's
// terminal, which the owner never sees.
test('the welcome screen is marked done, and an owner who already finished it is left alone', () => {
  // Value: protects=a bare Mac's first agent start does not stop on Claude's text style picker; fails_when=hasCompletedOnboarding is not written, or a finished one is rewritten; why_new=bare Mac report 2026-10-07; seam=real file in a temp home
  ensureClaudePermissionsAccepted(cwd);
  assert.equal(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).hasCompletedOnboarding, true);
  const done = JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: trusted(cwd) });
  fs.writeFileSync(projectConfigPath, done, 'utf8');
  ensureClaudePermissionsAccepted(cwd);
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), done);
});

test('an API key the owner chose is approved by its last 20 characters, once, keeping everything else', () => {
  // Value: protects=a Claude agent started with ANTHROPIC_API_KEY never stops on the approve-this-key question; fails_when=the tail is wrong, duplicated, stays rejected, or other keys are lost; why_new=API key sign in; seam=real file in a temp home
  const key = 'sk-ant-api03-' + 'x'.repeat(40) + 'ABCDEFGHIJ0123456789';
  fs.writeFileSync(projectConfigPath, JSON.stringify({ custom: 'keep', customApiKeyResponses: { approved: ['older'], rejected: ['ABCDEFGHIJ0123456789'] } }), 'utf8');
  approveClaudeApiKey(key, home);
  approveClaudeApiKey(key, home);
  const c = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  assert.equal(c.custom, 'keep');
  assert.deepEqual(c.customApiKeyResponses, { approved: ['older', 'ABCDEFGHIJ0123456789'], rejected: [] });
  assert.ok(!JSON.stringify(c).includes(key), 'the whole key is never written');
});

test('one start writes the welcome, the folder trust and the key approval in a single pass', () => {
  // Value: protects=a Claude start reads and writes ~/.claude.json (megabytes for a busy owner) once, and approves the key with the rest; fails_when=approveKey is ignored or the three edits split back into separate writes that lose each other; why_new=review performance 2026-10-07; seam=none
  const key = 'sk-ant-api03-' + 'y'.repeat(40) + 'KLMNOPQRST0123456789';
  ensureClaudePermissionsAccepted(cwd, { approveKey: key });
  const c = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  assert.equal(c.hasCompletedOnboarding, true);
  assert.equal(c.projects[claudeProjectKey(cwd)].hasTrustDialogAccepted, true);
  assert.deepEqual(c.customApiKeyResponses, { approved: ['KLMNOPQRST0123456789'], rejected: [] });
});

test('approving a blank key, or into an odd file, changes nothing it should not', () => {
  // Value: protects=a blank key is never approved and odd Claude config shapes are cleaned or left alone, never corrupted; fails_when=the empty-tail guard goes, non-string entries survive, or a non-object file is rewritten; why_new=review testing specialist; seam=none
  fs.writeFileSync(projectConfigPath, '[1,2]', 'utf8');
  approveClaudeApiKey('k'.repeat(30), home);
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), '[1,2]');
  const plain = JSON.stringify({ custom: 'keep' });
  fs.writeFileSync(projectConfigPath, plain, 'utf8');
  approveClaudeApiKey('   ', home);
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), plain);
  fs.writeFileSync(projectConfigPath, JSON.stringify({ customApiKeyResponses: { approved: [1, 'a'], rejected: 'no' } }), 'utf8');
  approveClaudeApiKey('k'.repeat(30), home);
  assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).customApiKeyResponses, { approved: ['a', 'k'.repeat(20)], rejected: [] });
});

test('approving a key says whether ~/.claude.json now holds it', () => {
  // Value: protects=a hidden check retries an approval that a half written ~/.claude.json blocked; fails_when=approveClaudeApiKey stops returning false for an unreadable file or true once approved; why_new=review cycle 3; seam=none
  fs.writeFileSync(projectConfigPath, '{"half": ', 'utf8');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(approveClaudeApiKey('k'.repeat(30), home), false, 'unreadable file: not approved'); } finally { console.warn = warn; }
  fs.rmSync(projectConfigPath, { force: true });
  assert.equal(approveClaudeApiKey('k'.repeat(30), home), true, 'written');
  assert.equal(approveClaudeApiKey('k'.repeat(30), home), true, 'already there');
  assert.equal(approveClaudeApiKey('   ', home), false, 'a blank key is never approved');
});

test('~/.claude.json is swapped in whole, keeps its permissions, and leaves no temp file', () => {
  // Value: protects=Claude's own settings file is never left half written by a crash mid write, keeps owner-only permissions, and an edit Claude makes between our read and write is kept; fails_when=the write goes back in place, the mode is dropped, the temp copy is left behind, or the changed-under-us retry goes; why_new=Codex adversarial pass 3; seam=none (real file in a temp home, source pin for the retry)
  fs.writeFileSync(projectConfigPath, JSON.stringify({ custom: 'keep' }), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(projectConfigPath, 0o600);
  approveClaudeApiKey('k'.repeat(30), home);
  // Windows has no POSIX permission bits to keep.
  if (process.platform !== 'win32') assert.equal(fs.statSync(projectConfigPath).mode & 0o777, 0o600, 'owner-only stays owner-only');
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('.dbm-')), [], 'no temp copy left behind');
  assert.equal(JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')).custom, 'keep');
  const src = fs.readFileSync(path.join(__dirname, '../src/main/config.ts'), 'utf8');
  assert.match(src, /if \(stamp\(\) !== before\) \{ rmSync\(tmp, \{ force: true \}\); continue; \}\s*try \{\s*renameSync\(tmp, p\);/, 'changed under us: start again instead of overwriting');
});

/** Make each rename onto ~/.claude.json fail as Windows does while another
 *  process holds the file, `times` times; `onHold` runs at each refusal. */
function holdClaudeJson(times, onHold = () => {}) {
  const real = fs.renameSync;
  let held = 0;
  fs.renameSync = (from, to) => {
    if (to === projectConfigPath && held < times) {
      held++;
      onHold();
      throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' });
    }
    return real(from, to);
  };
  return { held: () => held, restore: () => { fs.renameSync = real; } };
}

test('a ~/.claude.json that Windows briefly holds is saved from a fresh read, keeping what Claude wrote meanwhile', windowsOnly('only Windows refuses a rename onto an open file'), () => {
  // Value: protects=a key approval or folder trust is not lost when antivirus or a backup tool holds ~/.claude.json for a moment; fails_when=the first EPERM fails the save, or the retry renames the old copy over Claude's edit; why_new=seen on a Windows 11 run of this suite (EPERM on the rename); seam=fs.renameSync
  fs.writeFileSync(projectConfigPath, JSON.stringify({ theme: 'dark' }), 'utf8');
  const hold = holdClaudeJson(1, () => fs.writeFileSync(projectConfigPath, JSON.stringify({ theme: 'light' }), 'utf8'));
  try { assert.equal(approveClaudeApiKey('k'.repeat(30), home), true); } finally { hold.restore(); }
  const c = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  assert.equal(c.theme, 'light', 'the edit Claude made while the file was held is kept');
  assert.deepEqual(c.customApiKeyResponses, { approved: ['k'.repeat(20)], rejected: [] });
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('.dbm-')), [], 'no temp copy left behind');
});

test('a ~/.claude.json that stays held is left as it was, with no temp copy beside it', () => {
  // Value: protects=a file that never frees fails the save safely, without litter in the home folder or a wait on a Mac; fails_when=the temp copy is left behind, the retry never stops, or it runs off Windows; why_new=the same Windows run; seam=fs.renameSync
  fs.writeFileSync(projectConfigPath, '{"theme":"dark"}', 'utf8');
  const hold = holdClaudeJson(Infinity);
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(approveClaudeApiKey('k'.repeat(30), home), false); } finally { hold.restore(); console.warn = warn; }
  assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), '{"theme":"dark"}');
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('.dbm-')), [], 'no temp copy left behind');
  assert.equal(hold.held(), process.platform === 'win32' ? 3 : 1, 'three tries on Windows, one elsewhere');
});
