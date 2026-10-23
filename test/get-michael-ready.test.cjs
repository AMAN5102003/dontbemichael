'use strict';

/**
 * Get Michael ready (docs/designs/get-michael-ready.md, owner 2026-10-07).
 *
 * A business owner on a brand new Mac finished setup and landed on an office
 * where nothing happened. Claude Code was missing, so the app ran Node's
 * installer inside Michael's own terminal: it waited for a Mac password in a
 * terminal the owner never sees, failed, and nothing said so. Sign in would
 * have been just as hidden. These checks keep the fix in place: Claude is
 * installed and signed in where the owner can see it (setup's Ready step, or
 * the Ask me card), with its own installer, and a missing Claude at start is
 * never silent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const setup = loadTs('src/main/engineSetup.ts');
const { engineSetupPhase } = loadTs('src/shared/engineSetup.ts');

test('Claude installs with its own installer: no Node, no npm, no password', () => {
  const unix = setup.claudeInstallScript('darwin');
  assert.match(unix, /curl -fsSL https:\/\/claude\.ai\/install\.sh -o "\$__s"/);
  assert.match(unix, /bash "\$__s"/);
  assert.doesNotMatch(unix, /sudo|npm|nodejs\.org|installer -pkg/);
  // A failed download fails the script instead of piping nothing into bash.
  assert.match(unix, /\|\| \{ echo '  \[x\] Could not download the installer\.'; rm -f "\$__s"; exit 1; \}/);
  assert.doesNotMatch(unix, /\| bash/);
  const win = setup.claudeInstallScript('win32');
  assert.match(win, /install\.ps1/);
  assert.doesNotMatch(win, /"/, 'no double quotes: pty.ts wraps it in /d /s /c "..."');
});

test('a missing Claude at start installs nothing and says where to go', () => {
  for (const platform of ['darwin', 'win32']) {
    const s = setup.claudeMissingScript(platform);
    assert.match(s, /Get Michael ready/);
    assert.doesNotMatch(s, /curl|npm|sudo|install\.sh|install\.ps1|powershell/);
  }
  const main = read('src/main/index.ts');
  // The Claude branch comes before the old install ladder and returns.
  const claudeAt = main.indexOf('if (claudeMissing) {');
  const ladderAt = main.indexOf('if (bin && !opts.noAutoInstall && !ptyManager.isCommandAvailable(bin)) {');
  assert.ok(claudeAt > 0 && ladderAt > claudeAt, 'Claude is handled before the install ladder');
  const branch = main.slice(claudeAt, ladderAt);
  assert.match(main, /const claudeMissing = bin && claudeProvider && \(bin === 'claude' \? !claudePathFast\(\) : !ptyManager\.isCommandAvailable\(bin\)\);/, 'the plain claude is found without a login shell');
  assert.match(branch, /claudeBlocked\.set\(opts\.id, \{ god: !!opts\.hive\?\.isGod \}\);/, 'who could not start is remembered, to start exactly those later');
  assert.match(main, /else if \(!claudeMissing\) claudeBlocked\.delete\(opts\.id\);/, 'a member leaves the list when it starts ready');
  assert.match(branch, /shellScript: claudeMissingScript\(process\.platform, godName\)/);
  assert.match(branch, /noticeEngineSetup\(opts\.id\);/, 'Ask me hears at once, coalesced');
  assert.match(branch, /return res;/);
  assert.doesNotMatch(branch, /pendingInstallRelaunch/, 'no relaunch is armed for a script that installs nothing');
});

test('the sign in state is read from claude auth status, and an unreadable one never blocks', () => {
  assert.deepEqual(setup.parseClaudeAuthStatus('{"loggedIn":true,"email":"owner@example.com"}'), { signedIn: true, email: 'owner@example.com' });
  assert.deepEqual(setup.parseClaudeAuthStatus('{"loggedIn":false}'), { signedIn: false });
  assert.equal(setup.parseClaudeAuthStatus('error: unknown command auth'), null);
  assert.equal(setup.parseClaudeAuthStatus('{"other":1}'), null);
  assert.equal(setup.engineSetupNeeded(false, null), true, 'not installed');
  assert.equal(setup.engineSetupNeeded(true, false), true, 'signed out');
  assert.equal(setup.engineSetupNeeded(true, true), false);
  assert.equal(setup.engineSetupNeeded(true, null), false, 'unknown sign in state does not lock the owner out');
});

test('the rows follow what main reports and what the step started', () => {
  const f = { installing: false, installFailed: false, browser: false };
  assert.equal(engineSetupPhase(undefined, f), 'checking');
  assert.equal(engineSetupPhase(undefined, { ...f, statusFailed: true }), 'checkFailed', 'a rejected first status read is actionable');
  assert.equal(engineSetupPhase({ applies: true, installed: false, signedIn: false, needed: true }, { ...f, installing: true }), 'installing');
  assert.equal(engineSetupPhase({ applies: true, installed: false, signedIn: false, needed: true }, { ...f, installFailed: true }), 'installFailed');
  assert.equal(engineSetupPhase({ applies: true, installed: true, signedIn: false, needed: true }, f), 'signin');
  assert.equal(engineSetupPhase({ applies: true, installed: true, signedIn: false, needed: true }, { ...f, browser: true }), 'browser');
  assert.equal(engineSetupPhase({ applies: true, installed: true, signedIn: true, needed: false }, f), 'ready');
  assert.equal(engineSetupPhase({ applies: true, installed: true, signedIn: null, needed: false }, f), 'unknown', 'an unreadable sign in is never a green check');
  assert.equal(engineSetupPhase({ applies: true, installed: true, signedIn: true, needed: false }, { ...f, statusFailed: true }), 'ready', 'a later failed read keeps a known status');
  const { engineSetupPhaseOpensOffice } = loadTs('src/shared/engineSetup.ts');
  assert.equal(engineSetupPhaseOpensOffice('unknown'), true, '...but it never blocks the office either');
  assert.equal(engineSetupPhaseOpensOffice('ready'), true);
  for (const p of ['checking', 'checkFailed', 'installing', 'installFailed', 'signin', 'browser']) assert.equal(engineSetupPhaseOpensOffice(p), false, p);
});

test('a failed first status read shows a retry instead of an endless checking spinner', () => {
  const ready = read('src/renderer/src/components/GetMichaelReady.tsx');
  assert.match(ready, /if \(mine === reads\.current\) setStatusFailed\(true\);/, 'the current read records its own failure');
  assert.match(ready, /case 'checkFailed': return \([\s\S]*?t\('engineSetup\.checkFailed'\)[\s\S]*?setStatusFailed\(false\); void read\(\)/, 'the failed state explains itself and retries the same read');
  for (const l of ['en', 'zh-CN', 'ar']) {
    assert.ok(JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`)).engineSetup.checkFailed, `${l}: check failure copy exists`);
  }
});

test('setup ends on the Ready step with Claude, and Open the office waits for it', () => {
  const w = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(w, /const withReady = isClaudeProvider\(godProvider\);/);
  assert.match(w, /const lastStep: Step = withReady \? 'ready' : 'permissions';/);
  assert.match(w, /: s === 'permissions' \? 'ready'/);
  assert.match(w, /\{step === 'ready' && <GetMichaelReady provider=\{godProvider\} onReadyChange=\{setEngineReady\} \/>\}/);
  assert.match(w, /onClick=\{finish\} disabled=\{busy \|\| !engineReady\}>\s*\{busy \? t\('common\.saving'\) : t\('engineSetup\.openOffice'\)\}/);
  assert.match(w, /\{step === 'ready' && !engineReady && \(\s*<PixelButton variant="ghost" size="md" onClick=\{finish\}/, 'Set up later still opens the office');
  // Value: protects=an owner whose Michael runs on another engine still has a way out of setup; fails_when=the permissions Finish button is removed or tied to Claude, so with no Ready step the last step has neither Next nor Finish; why_new=only the Claude path was pinned; seam=none (source pin, the renderer has no DOM harness)
  assert.match(w, /\{step !== lastStep && step !== 'resume' && \(/, 'Next hides only on the real last step');
  assert.match(w, /\{step === 'permissions' && lastStep === 'permissions' && \(\s*<PixelButton variant="primary" size="md" onClick=\{finish\}/);
  assert.match(w, /const steps: readonly Step\[\] = withReady \? ORDERED_STEPS : ORDERED_STEPS\.filter\(\(s\) => s !== 'ready'\);/, 'the counter does not promise a step that never comes');
});

test('Ask me holds one card, counted, until Michael can start, and Claude turning ready restarts everyone on it', () => {
  // Value: protects=the team restarts however Claude turns ready (card, setup, browser, an install outside the app) and only Claude members restart; fails_when=the restart moves back into the card, the ready edge loses its listener, or the Claude filter goes; why_new=review red team 2026-10-07; seam=none (source pin, no DOM harness)
  const feed = read('src/renderer/src/shell/useNeedsYou.ts');
  assert.match(feed, /if \(setupCardShown\(merged\)\) feed = \{ \.\.\.feed, count: feed\.count \+ 1 \};/);
  assert.match(feed, /onEngineSetupChanged\?\.\(\(\) => readEngine\(\)\)/);
  const ask = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(ask, /<EngineSetupCard status=\{engineCard \? engineSetup : null\} \/>/);
  const card = read('src/renderer/src/components/EngineSetupCard.tsx');
  assert.doesNotMatch(card, /setPendingRestart/, 'the card no longer owns the restart');
  assert.match(card, /status\.forTeam \? t\('engineSetup\.cardTitleTeam'\)/, 'with Michael on another engine the card speaks for the team');
  assert.doesNotMatch(card, /cardFrom/, 'no kicker above the title (DESIGN.md 7.8)');
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /window\.addEventListener\(ENGINE_READY_EVENT, onReady\);/);
  // Only the terminals main names restart: an agent already at work keeps going.
  assert.match(hive, /if \(a\.ptyId && restart\.has\(a\.ptyId\) && isClaudeProvider\(a\.provider \?\? 'claude'\)\) setPendingRestart\(a\.id, \{ at: Date\.now\(\), reason: 'engine', now: true \}\);/);
});

test('the setup terminals are not agents: their exit only tells the step to look again', () => {
  const main = read('src/main/index.ts');
  const at = main.indexOf('ptyManager.setExitHandler((id, exitCode, info) => {');
  const head = main.slice(at, at + 1200);
  assert.match(head, /if \(isEngineSetupPty\(id\)\) \{[\s\S]*?send\('engineSetup:changed'[\s\S]*?return;/);
  assert.equal(setup.isEngineSetupPty('engine-setup-install'), true);
  assert.equal(setup.isEngineSetupPty('engine-setup-signin'), true);
  assert.equal(setup.isEngineSetupPty('god'), false);
});

test('an API key instead of a Claude account: checked with Anthropic, kept write only, handed to every Claude start', () => {
  // Value: protects=an owner without a Claude plan can still start the office, and a typo never becomes a team that cannot start; fails_when=the key is saved unchecked, comes back over IPC, or never reaches Claude agents or the hidden checks; why_new=owner 2026-10-07; seam=source pin, main has no harness for Electron IPC
  const main = read('src/main/index.ts');
  const h = main.slice(main.indexOf("ipcMain.handle('engineSetup:useApiKey'"));
  const handler = h.slice(0, h.indexOf('});') + 3);
  assert.ok(handler.indexOf('await checkAnthropicKey(key') < handler.indexOf("integrations.setSecret(providerKeyRef('anthropic'), key)"), 'checked before it is saved');
  assert.match(handler, /writeConfig\(\{ claudeAuth: 'apiKey' \}\)/);
  assert.match(handler, /Promise<\{ ok: boolean; error\?: 'invalid' \| 'rejected' \| 'refused' \| 'workspace' \| 'busy' \| 'unreachable' \| 'store'; reason\?: string \}>/, 'only a verdict and Anthropic\'s reason come back, never the key');
  // The check itself lives in engineSetup.ts, where its own tests run it.
  assert.match(main, /import \{[^}]*\bcheckAnthropicKey\b[^}]*\} from '\.\/engineSetup';/);
  // Value: protects=an owner on a Claude account is never billed to an Anthropic key kept for Settings, AI engines; fails_when=claudeAuthEnv hands over the stored key without claudeAuth being apiKey, or a pasted key with spaces or a stub is sent to Anthropic; why_new=only the save order and the spawn call were pinned; seam=none (source pin, main has no IPC harness)
  const env = main.slice(main.indexOf('function claudeAuthEnv()'));
  assert.match(env.slice(0, env.indexOf('\n}') + 2), /^function claudeAuthEnv\(\): Record<string, string> \{\s*if \(readConfig\(\)\.claudeAuth !== 'apiKey'\) return \{\};/);
  assert.match(handler, /if \(!apiKeyShapeOk\(key\)\) return \{ ok: false, error: 'invalid' \};/);
  assert.ok(handler.indexOf("error: 'invalid'") < handler.indexOf('await checkAnthropicKey(key'), 'a malformed key never leaves the computer');
  // Every Claude start gets the key, approved first.
  assert.match(main, /const authEnv = claudeAuthEnv\(\);\s*try \{ ensureClaudePermissionsAccepted\(opts\.cwd, \{ approveKey: authEnv\.ANTHROPIC_API_KEY \}\); \}[^\n]*\n\s*if \(authEnv\.ANTHROPIC_API_KEY\) opts\.env = \{ \.\.\.\(opts\.env \?\? \{\}\), \.\.\.authEnv \};/);
  // Hidden checks approve the key too, or Claude's own question rejects it.
  // Once per key, not on every check.
  assert.match(main, /if \(key && key !== hiddenApprovedKey\) \{\s*try \{ if \(approveClaudeApiKey\(key\)\) hiddenApprovedKey = key; \}/);
  // A key changed or cleared in Settings, AI engines, while it signs Claude in.
  assert.match(main, /if \(res\.ok && p\.backend === 'anthropic' && readConfig\(\)\.claudeAuth === 'apiKey'\) \{\s*try \{ approveClaudeApiKey\(p\.key\); \}/);
  assert.match(main, /const \{ verdict, reason \} = await checkAnthropicKey\(key, net\.fetch as unknown as KeyCheckFetch\);/, 'the check follows the system proxy');
  assert.match(read('src/main/hiddenClaude.ts'), /const auth = hiddenClaudeAuthEnv\(\);[\s\S]*\.\.\.auth,\s*\.\.\.\(opts\.env \?\? \{\}\)/);
  // The key an isolated check approves is the one its session gets (cycle 3 review).
  assert.match(read('src/main/hiddenClaude.ts'), /isolatedConfigDir\(opts\.cwd, \{ \.\.\.auth, \.\.\.\(opts\.env \?\? \{\}\) \}\)/);
  // A key counts as signed in; signing in with an account switches back.
  assert.match(main, /const status = await readEngineSetupStatus\(\{[\s\S]*?claudeAuth: cfg\.claudeAuth,\s*hasKey: \(\) => integrations\.hasSecret\(providerKeyRef\('anthropic'\)\),/);
  assert.match(main, /if \(readConfig\(\)\.claudeAuth === 'apiKey'\) writeConfig\(\{ claudeAuth: 'account' \}\);/);
  const ready = read('src/renderer/src/components/GetMichaelReady.tsx');
  assert.match(ready, /type="password" autoComplete="off"/);
  assert.match(ready, /t\('engineSetup\.useApiKey'\)/);
});

test('the install script really runs in a plain shell: a failed download stops before bash, the installer exit code comes back, and nothing is left in temp', { skip: process.platform === 'win32' }, () => {
  // Value: protects=a bare Mac's install fails loudly instead of feeding an empty script to bash, and a failed installer is reported as failed; fails_when=an edit leaves a syntax error or bash only construct (pty runs it with $SHELL -lc, /bin/sh as fallback), drops the download guard, swallows the installer's exit code, or leaves the downloaded script behind; why_new=the existing checks only match the script's text, nothing executes it; seam=none (fake curl on PATH, temp TMPDIR, no network)
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const script = setup.claudeInstallScript('darwin');
  const shells = ['/bin/sh', '/bin/zsh', '/bin/bash'].filter((s) => fs.existsSync(s));
  const run = (shell, installer) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-engine-install-'));
    const bin = path.join(dir, 'bin');
    const tmp = path.join(dir, 'tmp');
    fs.mkdirSync(bin); fs.mkdirSync(tmp);
    // curl -fsSL <url> -o <file>: write the fake installer, or fail like a dead network.
    fs.writeFileSync(path.join(bin, 'curl'), installer === null
      ? '#!/bin/sh\nexit 6\n'
      : `#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = -o ]; then shift; printf '%s\\n' ${JSON.stringify(installer)} > "$1"; fi; shift; done\n`, { mode: 0o755 });
    try {
      const r = spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: tmp, HOME: dir } });
      return { code: r.status, out: r.stdout + r.stderr, left: fs.readdirSync(tmp) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.ok(shells.length > 0);
  for (const shell of shells) {
    const offline = run(shell, null);
    assert.equal(offline.code, 1, `${shell}: a failed download fails the script`);
    assert.match(offline.out, /Could not download the installer/);
    assert.deepEqual(offline.left, [], `${shell}: no downloaded file is left behind`);
    const failed = run(shell, 'echo INSTALLER-RAN; exit 7');
    assert.match(failed.out, /INSTALLER-RAN/, `${shell}: the downloaded installer runs`);
    assert.equal(failed.code, 7, `${shell}: the installer's own failure comes back`);
    assert.deepEqual(failed.left, []);
    const ok = run(shell, 'echo INSTALLER-RAN');
    assert.equal(ok.code, 0, `${shell}: a good install ends cleanly`);
    assert.deepEqual(ok.left, []);
  }
  const missing = spawnSync(shells[0], ['-c', setup.claudeMissingScript('darwin')], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /Claude Code is not set up on this computer[\s\S]*Open Ask me and choose Get Michael ready/);
});

test('main, the bridge and the step agree on the setup channels, terminal names and key errors', () => {
  // Value: protects=the Ready step and the Ask me card hear main at all: a renamed channel leaves the step on Checking forever, a renamed terminal leaves Installing spinning after the install ended, and a new key error shows a raw string key; fails_when=one side renames an engineSetup channel, main's ENGINE_*_PTY ids drift from the step's copies, or the useApiKey error union gains a code with no string; why_new=each side is pinned alone, nothing ties them together; seam=none
  const main = read('src/main/index.ts');
  const preload = read('src/preload/index.ts');
  const ready = read('src/renderer/src/components/GetMichaelReady.tsx');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('(engineSetup:[A-Za-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(invoked, ['engineSetup:install', 'engineSetup:signIn', 'engineSetup:status', 'engineSetup:useApiKey']);
  for (const ch of invoked) assert.ok(main.includes(`ipcMain.handle('${ch}'`), `main handles ${ch}`);
  const heard = [...preload.matchAll(/ipcRenderer\.on\('(engineSetup:[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(heard, ['engineSetup:changed']);
  const sent = [...main.matchAll(/send\('(engineSetup:[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(sent.length >= 3 && sent.every((c) => c === 'engineSetup:changed'), 'main only sends the channel the bridge hears');
  // One source for the terminal names: main and the step both read shared.
  const shared = loadTs('src/shared/engineSetup.ts');
  assert.equal(setup.ENGINE_INSTALL_PTY, shared.ENGINE_INSTALL_PTY);
  assert.equal(setup.ENGINE_SIGNIN_PTY, shared.ENGINE_SIGNIN_PTY);
  assert.match(ready, /import \{ ENGINE_INSTALL_PTY, ENGINE_SIGNIN_PTY,[^}]*\} from '@shared\/engineSetup';/, 'the step watches the terminals main runs');
  assert.doesNotMatch(ready, /'engine-setup-/, 'no second copy of a terminal name');
  const union = main.match(/ipcMain\.handle\('engineSetup:useApiKey'[^\n]*error\?: ([^;}]+)[;}]/);
  assert.ok(union, 'the useApiKey verdict type can be read');
  const codes = [...union[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.match(ready, /t\(`engineSetup\.keyError\.\$\{res\.error \?\? 'unreachable'\}`\)/);
  for (const l of ['en', 'zh-CN', 'ar']) {
    const strings = JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`)).engineSetup.keyError;
    assert.deepEqual(Object.keys(strings).sort(), codes, `${l}: one string per key error main can return`);
  }
});

test('where Claude stands: another engine never asks, a missing Claude needs setup, a key or an account decides the rest', async () => {
  // Value: protects=the Ready step and the Ask me card block exactly when Michael cannot start, and never for another engine, a stored key, or a sign in state Claude cannot report; fails_when=readEngineSetupStatus marks a non Claude engine as needing setup, misses a missing Claude, ignores a missing key, asks for an account while a key is chosen, leaks an email for a signed out account, or turns an unreadable auth status into a blocker; why_new=only engineSetupNeeded and the IPC call text were pinned, the status decision itself never ran; seam=none (hasKey and authStatus are plain inputs, authStatus parses raw stdout like main does)
  const cases = [
    { name: 'another engine', in: { isClaude: false, claudePath: '/x/claude' }, auth: '{"loggedIn":false}',
      want: { applies: false, installed: true, signedIn: null, needed: false }, asksAuth: false, asksKey: false },
    { name: 'Claude not installed', in: { isClaude: true, claudePath: null }, auth: '{"loggedIn":true}',
      want: { applies: true, installed: false, signedIn: false, needed: true }, asksAuth: false, asksKey: false },
    { name: 'API key chosen and stored', in: { isClaude: true, claudePath: '/x/claude', claudeAuth: 'apiKey', key: true }, auth: '{"loggedIn":false}',
      want: { applies: true, installed: true, signedIn: true, method: 'apiKey', needed: false }, asksAuth: false, asksKey: true },
    { name: 'API key chosen but missing', in: { isClaude: true, claudePath: '/x/claude', claudeAuth: 'apiKey', key: false }, auth: '{"loggedIn":true}',
      want: { applies: true, installed: true, signedIn: false, method: 'apiKey', needed: true }, asksAuth: false, asksKey: true },
    { name: 'account signed in', in: { isClaude: true, claudePath: '/x/claude', claudeAuth: 'account', key: true }, auth: '{"loggedIn":true,"email":"owner@example.com"}',
      want: { applies: true, installed: true, signedIn: true, method: 'account', email: 'owner@example.com', needed: false }, asksAuth: true, asksKey: false },
    { name: 'account signed out (no claudeAuth saved yet)', in: { isClaude: true, claudePath: '/x/claude' }, auth: '{"loggedIn":false,"email":"old@example.com"}',
      want: { applies: true, installed: true, signedIn: false, method: 'account', needed: true }, asksAuth: true, asksKey: false },
    { name: 'auth status unreadable', in: { isClaude: true, claudePath: '/x/claude', claudeAuth: 'account' }, auth: 'error: unknown command auth',
      want: { applies: true, installed: true, signedIn: null, method: 'account', needed: false }, asksAuth: true, asksKey: false }
  ];
  for (const c of cases) {
    const calls = { auth: [], key: 0 };
    const got = await setup.readEngineSetupStatus({
      isClaude: c.in.isClaude,
      claudePath: c.in.claudePath,
      claudeAuth: c.in.claudeAuth,
      hasKey: () => { calls.key++; return !!c.in.key; },
      authStatus: async (p) => { calls.auth.push(p); return setup.parseClaudeAuthStatus(c.auth); }
    });
    assert.deepEqual(got, c.want, c.name);
    assert.deepEqual(calls.auth, c.asksAuth ? [c.in.claudePath] : [], `${c.name}: auth status is read only on the account path, at the installed Claude`);
    assert.equal(calls.key > 0, c.asksKey, `${c.name}: the key store is read only on the key path`);
  }
});

test('the install starts once: a second ask while one runs, or after Claude is there, starts nothing', () => {
  // Value: protects=Back then Next on the Ready step never runs two installers into the same terminal or reinstalls a working Claude; fails_when=shouldStartInstall starts while an install is running or when Claude is already installed, or refuses the one case that needs it; why_new=the dedupe moved out of the IPC handler and nothing ran it; seam=none
  const table = [
    [{ installRunning: false, installed: false }, true],
    [{ installRunning: true, installed: false }, false],
    [{ installRunning: false, installed: true }, false],
    [{ installRunning: true, installed: true }, false]
  ];
  for (const [s, want] of table) assert.equal(setup.shouldStartInstall(s), want, JSON.stringify(s));
});

test('a pasted key is sent only when it looks like a key, and Anthropic\'s answer maps to ok, rejected, refused, busy or unreachable', () => {
  // Value: protects=a stub, a paragraph or a key with a stray space or newline never leaves the computer, and an outage or rate limit is never shown as a wrong key; fails_when=apiKeyShapeOk moves its 20 or 400 bounds or lets whitespace through, or apiKeyVerdict treats a non 2xx as ok or anything but 401 and 403 as rejected; why_new=the shape check and verdict were only pinned as call sites in main; seam=none
  const k = (n) => 'k'.repeat(n);
  const shapes = [
    [k(19), false], [k(20), true], [k(400), true], [k(401), false], ['', false],
    [`${k(15)} ${k(15)}`, false], [`${k(30)}\n`, false], [`\t${k(30)}`, false], [`sk-ant-${k(40)}`, true]
  ];
  for (const [key, want] of shapes) assert.equal(setup.apiKeyShapeOk(key), want, `length ${key.length}: ${JSON.stringify(key.slice(-3))}`);
  const verdicts = [
    [200, 'ok'], [204, 'ok'], [299, 'ok'], [199, 'unreachable'], [300, 'unreachable'],
    [401, 'rejected'], [403, 'rejected'], [400, 'refused'], [404, 'refused'], [499, 'refused'],
    [408, 'busy'], [429, 'busy'], [500, 'busy'], [529, 'busy'], [0, 'unreachable']
  ];
  for (const [code, want] of verdicts) assert.equal(setup.apiKeyVerdict(code), want, `HTTP ${code}`);
});

test('Claude is found without a login shell, on the PATH or where its installers put it, on macOS and Windows', () => {
  // Value: protects=status reads never freeze the app for a login shell while Claude is missing, and Windows finds claude.exe in ~/.local/bin after install.ps1; fails_when=a candidate is dropped, the PATH is not searched, or the Windows names change; why_new=review: a missing Claude froze every status read for about a second, and Windows looped on Could not install; seam=none (exists injected, no file system)
  const find = (platform, pathEnv, have, extra = {}) =>
    setup.findClaudeFast({ platform, pathEnv, home: platform === 'win32' ? 'C:\\Users\\o' : '/Users/o', exists: (p) => have.includes(p), ...extra });
  assert.equal(find('darwin', '/usr/bin:/opt/n/bin', ['/opt/n/bin/claude']), '/opt/n/bin/claude', 'on the PATH');
  assert.equal(find('darwin', '/usr/bin', ['/Users/o/.local/bin/claude']), '/Users/o/.local/bin/claude', 'the standalone installer, off the PATH');
  assert.equal(find('darwin', '/usr/bin', []), null, 'missing: null, and no shell was asked');
  assert.equal(find('win32', 'C:\\Windows', ['C:\\Users\\o\\.local\\bin\\claude.exe']), 'C:\\Users\\o\\.local\\bin\\claude.exe', 'install.ps1 on Windows');
  assert.equal(find('win32', 'C:\\Windows', ['C:\\A\\npm\\claude.cmd'], { appData: 'C:\\A' }), 'C:\\A\\npm\\claude.cmd', 'npm on Windows');
  // The PTY's own lookup knows the Windows install folder too.
  for (const f of ['src/main/pty.ts', 'src/main/shellEnv.ts']) assert.match(read(f), /`\$\{home\}\\\\\.local\\\\bin\\\\\$\{command\}\.exe`/, f);
  const main = read('src/main/index.ts');
  assert.match(main, /claudePath: isClaude \|\| teamNeedsClaude \? claudePathFast\(\) : null,/, 'status uses the fast lookup');
  assert.match(main, /installed: !!claudePathFast\(\)/, 'install dedupe uses the fast lookup');
});

test('with Michael on another engine, a team member missing Claude still gets the step and the card', () => {
  // Value: protects=a Claude team member under a Codex Michael is never left pointing at a card that does not exist; fails_when=readEngineSetupStatus ignores teamNeedsClaude or drops forTeam; why_new=review red team 2026-10-07; seam=none
  return (async () => {
    const base = { claudePath: null, hasKey: () => false, authStatus: async () => null };
    assert.deepEqual(await setup.readEngineSetupStatus({ ...base, isClaude: false }), { applies: false, installed: true, signedIn: null, needed: false });
    assert.deepEqual(await setup.readEngineSetupStatus({ ...base, isClaude: false, teamNeedsClaude: true }), { applies: true, forTeam: true, installed: false, signedIn: false, needed: true });
    const own = await setup.readEngineSetupStatus({ ...base, isClaude: true, teamNeedsClaude: true });
    assert.equal(own.forTeam, undefined, 'Michael on Claude: the card is about Michael');
  })();
});

test('the missing Claude message names the manager safely, and the install runs under /bin/sh', () => {
  // Value: protects=the terminal points to the card by its real name, a renamed manager can never inject shell, and fish users can install; fails_when=the name is not used or not filtered, or the install goes back to the owner's shell; why_new=review 2026-10-07; seam=none
  assert.match(setup.claudeMissingScript('darwin', 'Ada'), /choose Get Ada ready/);
  const evil = setup.claudeMissingScript('darwin', "Bob'; rm -rf ~ #");
  assert.doesNotMatch(evil, /rm -rf|'; |#/);
  assert.match(setup.claudeMissingScript('darwin', '!!!'), /Get Michael ready/, 'nothing usable falls back to Michael');
  const main = read('src/main/index.ts');
  assert.match(main, /command: '\/bin\/sh', args: \['-c', script\]/);
});

test('the step marks an install that ended without Claude as failed, and installs on its own only once', () => {
  // Value: protects=a failed install shows Try again instead of spinning forever, and opening the step never starts two installs; fails_when=the install exit no longer sets installFailed, or the first look loses its once guard; why_new=review testing specialist; seam=none (source pin, no DOM harness)
  const ready = read('src/renderer/src/components/GetMichaelReady.tsx');
  assert.match(ready, /if \(e\.id === ENGINE_INSTALL_PTY\) \{\s*setInstalling\(false\);\s*setInstallFailed\(!s\.installed\);/);
  assert.match(ready, /if \(s && s\.applies && !s\.installed && !autoInstalled\.current\) \{\s*autoInstalled\.current = true;/);
  assert.match(ready, /if \(inFlight\.current\) return;/, 'the 2 s sign in poll never stacks claude auth status');
  assert.match(ready, /case 'unknown': return keyForm \? keyFormRow : \(\s*<Row icon="help" tone="idle" label=\{t\('engineSetup\.account'\)\} status=\{t\('engineSetup\.signInUnknown'\)\}>/, 'unknown sign in: no green check');
});
