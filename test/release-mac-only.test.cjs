'use strict';

// The 0.0.1 release ships a Mac DMG only (owner, 2026-09-24), and a local or dry
// build without an Apple Developer ID must still be sealed ad hoc, or a copy
// downloaded from GitHub is reported as "damaged" with no way to open it. A tagged
// release must be Developer ID signed and notarized (v0.2.6 on, owner 2026-10-23).

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

test('the release workflow signs from its own keychain, never CSC_LINK', () => {
  // electron-builder 25 builds its own keychain from CSC_LINK and then fails
  // set-key-partition-list on macOS 26.6; an empty CSC_LINK is read as a path to
  // the repo folder ("not a file"). The job imports the cert itself instead.
  const yml = read('.github/workflows/release.yml');
  const live = yml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const imp = live.slice(live.indexOf('- name: Import the Mac signing certificate'), live.indexOf('- name: Package installers'));
  assert.match(imp, /if: matrix\.os == 'macos-latest'/);
  assert.match(imp, /if \[ -z "\$P12" \]; then .*exit 0; fi/, 'a dry build without the cert still works');
  assert.match(imp, /security create-keychain -p "\$KEYCHAIN_PASSWORD"/);
  assert.match(imp, /security set-key-partition-list -S apple-tool:,apple: -s -k "\$KEYCHAIN_PASSWORD"/, 'the keychain password, not the cert password');
  assert.match(imp, /rm -f "\$RUNNER_TEMP\/cert\.p12"/);
  assert.match(imp, /echo "CSC_KEYCHAIN=\$KEYCHAIN" >> "\$GITHUB_ENV"/);
  const pack = live.slice(live.indexOf('- name: Package installers'), live.indexOf('- name: Generate checksums'));
  assert.match(pack, /unset CSC_LINK CSC_KEY_PASSWORD\n\s*npx electron-builder/);
  assert.doesNotMatch(pack, /CSC_LINK:|CSC_KEY_PASSWORD:/);
  // A tag, and only a tag, requires the Developer ID: a missing secret stops the release (see the hook tests below).
  assert.match(pack, /REQUIRE_DEVELOPER_ID: \$\{\{ matrix\.os == 'macos-latest' && github\.ref_type == 'tag' && '1' \|\| '' \}\}/);
});

test('RELEASE.md advertises the Mac DMG, and Windows only inside its strippable section', () => {
  const md = read('RELEASE.md');
  const outside = md.replace(/<!-- windows -->[\s\S]*?<!-- \/windows -->/g, '');
  const assets = [...outside.matchAll(/`(Dont-Be-Michael-[^`]+)`/g)].map((m) => m[1]);
  assert.ok(assets.length > 0);
  for (const a of assets) assert.match(a, /-mac-universal\.dmg$/);
  // Every release since v0.2.6 is signed and notarized: the Mac steps say click Open, never Open Anyway.
  const UNSIGNED_MAC = /Open Anyway|could not verify|not yet signed with an Apple Developer ID/;
  const readme = read('README.md');
  const macReadme = readme.slice(readme.indexOf('**On a Mac**'), readme.indexOf('**On Windows 11**'));
  for (const [name, text] of [['RELEASE.md', outside], ['README.md', macReadme]]) {
    assert.doesNotMatch(text, UNSIGNED_MAC, `${name} keeps the unsigned Mac steps`);
    assert.match(text, /Click \*\*Open\*\*\./, `${name} says to click Open`);
    assert.match(text, /signed with an Apple Developer ID and notarized by Apple/, `${name} says the app is notarized`);
  }
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
function loadHook(t, notarize, team = 'B5EHD4JBD2') {
  const cp = require('node:child_process');
  const calls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args) => { calls.push([cmd, ...args].join(' ')); });
  // codesign -dv prints to stderr, as the real one does.
  t.mock.method(cp, 'spawnSync', () => ({ status: 0, stdout: '', stderr: `Identifier=app\nTeamIdentifier=${team}\n` }));
  const hookPath = path.join(root, 'build/notarize.cjs');
  const notarizePath = require.resolve('@electron/notarize', { paths: [root] });
  const saved = require.cache[notarizePath];
  require.cache[notarizePath] = { id: notarizePath, filename: notarizePath, loaded: true, exports: { notarize } };
  delete require.cache[hookPath];
  const hook = require(hookPath).default;
  const keys = ['CI', 'REQUIRE_DEVELOPER_ID', 'CSC_LINK', 'CSC_KEYCHAIN', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
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
  // The hook joins the path the platform's way; it only runs on a Mac, but the test runs everywhere.
  assert.ok(calls.includes(`xcrun stapler staple ${path.join('/out', 'App.app')}`));
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

test('a release signed by any team but the owner\'s fails before notarizing', async (t) => {
  const { run } = loadHook(t, async () => assert.fail('a wrong team is never submitted'), 'A4X5Y2CSWQ');
  appleCreds();
  Object.assign(process.env, { CI: 'true', CSC_KEYCHAIN: '/tmp/signing.keychain-db' });
  await assert.rejects(run(), /must be signed by Apple team B5EHD4JBD2, but it was signed by A4X5Y2CSWQ/);
});

test('a release that ended up unsigned fails', async (t) => {
  const unsigned = loadHook(t, async () => assert.fail('never submitted'), 'not set');
  Object.assign(process.env, { CI: 'true', CSC_LINK: 'cert' });
  await assert.rejects(unsigned.run(), /signed by no team/);
});

test('the notarization team must be the release team too', async (t) => {
  const { run } = loadHook(t, async () => assert.fail('never submitted'));
  appleCreds();
  Object.assign(process.env, { CI: 'true', CSC_LINK: 'cert', APPLE_TEAM_ID: 'OTHERTEAM1' });
  await assert.rejects(run(), /APPLE_TEAM_ID is OTHERTEAM1, not the release team B5EHD4JBD2/);
});

test('a release signed by the owner\'s team is notarized', async (t) => {
  let sent;
  const { run } = loadHook(t, async (opts) => { sent = opts; });
  appleCreds();
  Object.assign(process.env, { CI: 'true', CSC_LINK: 'cert', APPLE_TEAM_ID: 'B5EHD4JBD2' });
  await run();
  assert.equal(sent.teamId, 'B5EHD4JBD2');
});

test('a tagged release without the Developer ID certificate fails, a dry build does not', async (t) => {
  let submitted = 0;
  const { run, calls } = loadHook(t, async () => { submitted++; });
  Object.assign(process.env, { CI: 'true', REQUIRE_DEVELOPER_ID: '1' });
  await assert.rejects(run(), /a tagged release must be signed with the Developer ID certificate, but none was imported/);
  assert.deepEqual(calls, [], 'nothing is sealed ad hoc or stapled');
  delete process.env.REQUIRE_DEVELOPER_ID;
  await run(); // a dry build without the cert goes on
  assert.equal(submitted, 0, 'a dry build without credentials is not notarized');
  process.env.REQUIRE_DEVELOPER_ID = '1';
  appleCreds();
  Object.assign(process.env, { CSC_KEYCHAIN: '/tmp/signing.keychain-db', APPLE_TEAM_ID: 'B5EHD4JBD2' });
  await run(); // a tag with the cert is notarized as before
  assert.equal(submitted, 1);
  assert.ok(calls.some((c) => c.startsWith('xcrun stapler staple')));
});
