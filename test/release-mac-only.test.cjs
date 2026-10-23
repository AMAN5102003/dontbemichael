'use strict';

// The 0.0.1 release ships a Mac DMG only (owner, 2026-09-24), and without an
// Apple Developer ID the app must still be sealed ad hoc, or a copy downloaded
// from GitHub is reported as "damaged" with no way to open it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the release workflow builds Mac, and Windows as a beta that never blocks it', () => {
  // Owner, 2026-10-04 (docs/designs/windows-11-installer.md): Windows returns as a
  // beta; it replaces the Mac only rule of 2026-09-24. Linux stays off.
  const yml = read('.github/workflows/release.yml');
  const live = yml.split('\n').filter((l) => !l.trim().startsWith('#'));
  const oses = live.map((l) => /^\s*- os:\s*(\S+)/.exec(l)).filter(Boolean).map((m) => m[1]);
  assert.deepEqual(oses, ['macos-latest', 'windows-2022']);
  assert.match(yml, /continue-on-error: \$\{\{ matrix\.os == 'windows-2022' \}\}/);
});

test('the release workflow unsets an empty signing cert before packaging', () => {
  // An empty CSC_LINK is read as a path to the repo folder ("not a file").
  const yml = read('.github/workflows/release.yml');
  const step = yml.slice(yml.indexOf('- name: Package installers'), yml.indexOf('- name: Generate checksums'));
  assert.match(step, /if \[ -z "\$CSC_LINK" \]; then unset CSC_LINK CSC_KEY_PASSWORD; fi\n\s*npx electron-builder/);
});

test('RELEASE.md advertises the Mac DMG, and Windows only inside its strippable section', () => {
  const md = read('RELEASE.md');
  const outside = md.replace(/<!-- windows -->[\s\S]*?<!-- \/windows -->/g, '');
  const assets = [...outside.matchAll(/`(Dont-Be-Michael-[^`]+)`/g)].map((m) => m[1]);
  assert.ok(assets.length > 0);
  for (const a of assets) assert.match(a, /-mac-universal\.dmg$/);
  assert.match(md, /Open Anyway/);
  const win = (md.match(/<!-- windows -->([\s\S]*?)<!-- \/windows -->/) ?? [])[1] ?? '';
  assert.match(win, /`Dont-Be-Michael-[^`]+-win-x64-setup\.exe`\]\(https:\/\/github\.com\/agentvivekkumar\/dontbemichael\/releases\/download\/v/, 'tag pinned');
  assert.match(win, /More info\*\*, then \*\*Run anyway/);
  assert.match(win, /ARM PCs aren't supported/);
});

test('the afterSign hook seals an unsigned Mac app ad hoc, and only then', () => {
  const hook = read('build/notarize.cjs');
  assert.match(hook, /function sealAdHocIfUnsigned/);
  // Verify first, so a real Developer ID signature is never replaced.
  assert.match(hook, /'--verify', '--strict', appPath[\s\S]*return; \/\/ properly signed already/);
  assert.match(hook, /'--sign', '-'/);
  assert.match(hook, /'--options', 'runtime', '--entitlements'/);
  const builder = read('electron-builder.yml');
  assert.match(builder, /^afterSign: build\/notarize\.cjs$/m);
});

// A signed Mac release must be notarized too, or it fails (owner, 2026-10-22):
// a signed but unnotarized download still shows macOS's "cannot verify" warning.
// Apple's tools are stubbed, so these run on every platform.
function loadHook(t, notarize) {
  const cp = require('node:child_process');
  const calls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args) => { calls.push([cmd, ...args].join(' ')); });
  const hookPath = path.join(root, 'build/notarize.cjs');
  const notarizePath = require.resolve('@electron/notarize', { paths: [root] });
  const saved = require.cache[notarizePath];
  require.cache[notarizePath] = { id: notarizePath, filename: notarizePath, loaded: true, exports: { notarize } };
  delete require.cache[hookPath];
  const hook = require(hookPath).default;
  const keys = ['CI', 'CSC_LINK', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  t.after(() => {
    for (const k of keys) if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    if (saved) require.cache[notarizePath] = saved; else delete require.cache[notarizePath];
    delete require.cache[hookPath];
  });
  const context = { electronPlatformName: 'darwin', appOutDir: '/out', packager: { appInfo: { productFilename: 'App' } } };
  return { run: () => hook(context), calls };
}
const appleCreds = () => Object.assign(process.env, { APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' });

test('a failed notarization stops the Mac release instead of shipping it unnotarized', async (t) => {
  const { run, calls } = loadHook(t, async () => { throw new Error('The submission was rejected'); });
  appleCreds();
  await assert.rejects(run(), /notarization failed, so the Mac release stops here[\s\S]*The submission was rejected/);
  assert.ok(!calls.some((c) => c.startsWith('xcrun stapler')), 'nothing is stapled');
});

test('a notarized Mac build is stapled', async (t) => {
  let sent;
  const { run, calls } = loadHook(t, async (opts) => { sent = opts; });
  appleCreds();
  await run();
  assert.equal(sent.teamId, 'T');
  assert.ok(calls.includes('xcrun stapler staple /out/App.app'));
});

test('a release signed in CI without notarization credentials fails, a local build does not', async (t) => {
  const { run } = loadHook(t, async () => assert.fail('no credentials, no submission'));
  process.env.CSC_LINK = 'cert';
  await run();
  process.env.CI = 'true';
  await assert.rejects(run(), /signed with a Developer ID but has no APPLE_\* notarization credentials/);
});

test('the Mac app takes no DYLD entitlement, and keeps library validation off for the team Node runtime', () => {
  const plist = read('build/entitlements.mac.plist');
  const keys = [...plist.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
  assert.ok(!keys.includes('com.apple.security.cs.allow-dyld-environment-variables'));
  assert.ok(keys.includes('com.apple.security.cs.disable-library-validation'));
});
