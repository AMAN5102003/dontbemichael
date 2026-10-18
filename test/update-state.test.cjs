'use strict';

/**
 * Auto-update state model.
 *
 * These cover the two rules that actually broke in the field:
 *   1. a re-check must never wipe out a staged "restart to update" (the 6h tick
 *      and the manual check both emit `checking` → `not-available`);
 *   2. every state maps to a button that says what it does — the v0.3.4-0.3.6
 *      builds could only ever say "open the releases page", which is what the
 *      founder hit when 0.3.6 shipped.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { parseVersion, isNewer, clampPercent, reduceStatus, describeUpdate } =
  loadTs('src/shared/updateState.ts');

test('parseVersion accepts v-prefixed and bare semver, rejects junk', () => {
  assert.deepEqual(parseVersion('0.3.6'), [0, 3, 6]);
  assert.deepEqual(parseVersion('v0.3.6'), [0, 3, 6]);
  assert.deepEqual(parseVersion('1.10.2-beta.1'), [1, 10, 2]);
  assert.equal(parseVersion('nightly'), null);
  assert.equal(parseVersion(''), null);
});

test('isNewer compares numerically, not lexically', () => {
  assert.equal(isNewer('0.3.6', '0.3.5'), true);
  assert.equal(isNewer('v0.3.6', '0.3.5'), true);
  // The one a string compare gets wrong: '0.3.10' < '0.3.9' lexically.
  assert.equal(isNewer('0.3.10', '0.3.9'), true);
  assert.equal(isNewer('0.3.5', '0.3.6'), false);
  assert.equal(isNewer('0.3.6', '0.3.6'), false);
  assert.equal(isNewer('garbage', '0.3.6'), false);
});

test('clampPercent keeps progress renderable', () => {
  assert.equal(clampPercent(42.6), 43);
  assert.equal(clampPercent(-3), 0);
  assert.equal(clampPercent(104), 100);
  assert.equal(clampPercent(NaN), 0);
  assert.equal(clampPercent(undefined), 0);
});

test('a re-check never clobbers a staged update', () => {
  const staged = { state: 'downloaded', version: '0.3.7' };
  // The 6h tick: checking → not-available, both must lose to the staged update.
  assert.deepEqual(reduceStatus(staged, { state: 'checking' }), staged);
  assert.deepEqual(reduceStatus(staged, { state: 'not-available' }), staged);
  // A transient network error mid-session must not drop the restart button.
  assert.deepEqual(reduceStatus(staged, { state: 'error', message: 'ETIMEDOUT' }), staged);
});

test('the pipeline moves forward for the same version', () => {
  let s = reduceStatus(null, { state: 'checking' });
  s = reduceStatus(s, { state: 'available', version: '0.3.7' });
  assert.equal(s.state, 'available');
  s = reduceStatus(s, { state: 'downloading', version: '0.3.7', percent: 12 });
  assert.equal(s.state, 'downloading');
  s = reduceStatus(s, { state: 'downloaded', version: '0.3.7' });
  assert.equal(s.state, 'downloaded');
  // Late progress events must not walk it back off "downloaded".
  s = reduceStatus(s, { state: 'downloading', version: '0.3.7', percent: 99 });
  assert.equal(s.state, 'downloaded');
});

test('a genuinely newer release supersedes a staged one', () => {
  const staged = { state: 'downloaded', version: '0.3.7' };
  const next = reduceStatus(staged, { state: 'available', version: '0.3.8' });
  assert.deepEqual(next, { state: 'available', version: '0.3.8' });
});

test('a download that fails stops showing as downloading, and the manual download replaces it', () => {
  // Value: protects=the update chip and Settings after a failed download; fails_when=the chip spins on "downloading 37%" with nothing to click, and the manual download the updater fell back to never shows, until the next release; seam=none
  const manual = {
    state: 'available-manual', version: '0.3.7', reason: 'net::ERR_CONNECTION_RESET',
    url: 'https://github.com/agentvivekkumar/dontbemichael/releases/tag/v0.3.7',
    downloadUrl: 'https://github.com/agentvivekkumar/dontbemichael/releases/download/v0.3.7/Dont-Be-Michael-0.3.7-mac-universal.dmg'
  };
  // Mid-download, the updater emits the error and then the fallback's offer.
  let s = reduceStatus({ state: 'available', version: '0.3.7' }, { state: 'downloading', version: '0.3.7', percent: 37 });
  s = reduceStatus(s, { state: 'error', message: 'net::ERR_CONNECTION_RESET' });
  assert.equal(s.state, 'error', 'a download that failed is not still downloading');
  assert.equal(describeUpdate(s, '0.3.6').busy, false, 'the chip stops spinning');
  s = reduceStatus(s, manual);
  assert.deepEqual(s, manual);
  assert.equal(describeUpdate(s, '0.3.6').action, 'manual', 'the chip offers the download by hand');
  // A download that never got going: the offer replaces it too. The error
  // before it leaves "available" alone, which is still something to click.
  const available = { state: 'available', version: '0.3.7' };
  assert.deepEqual(reduceStatus(available, { state: 'error', message: 'EACCES' }), available);
  assert.deepEqual(reduceStatus(available, manual), manual);
  // A finished download is on disk: neither takes the restart away.
  const staged = { state: 'downloaded', version: '0.3.7' };
  assert.deepEqual(reduceStatus(staged, manual), staged);
});

test('every actionable state offers the action its label promises', () => {
  const check = (status, expected) => {
    const v = describeUpdate(status, '0.3.6');
    assert.equal(v.action, expected.action, `action for ${status ? status.state : 'null'}`);
    if ('label' in expected) assert.equal(v.label, expected.label);
    if ('busy' in expected) assert.equal(v.busy, expected.busy);
  };

  // Idle / up-to-date: version only, but still clickable to check on demand —
  // the whole point of the founder's "tell me and let me trigger it" ask.
  check(null, { action: 'check', label: null, busy: false });
  check({ state: 'idle' }, { action: 'check', label: null });
  check({ state: 'not-available' }, { action: 'check', label: 'latest' });

  check({ state: 'checking' }, { action: 'none', busy: true });
  check({ state: 'available', version: '0.3.7' }, { action: 'download', busy: false });
  check({ state: 'downloading', version: '0.3.7', percent: 42 }, { action: 'none', busy: true });
  check({ state: 'downloaded', version: '0.3.7' }, { action: 'restart', busy: false });
  check({ state: 'available-manual', version: '0.3.7', url: 'https://x' }, { action: 'manual' });
  check({ state: 'error', message: 'boom' }, { action: 'check' });
});

test('labels name the version so the badge is self-explanatory', () => {
  assert.match(describeUpdate({ state: 'available', version: '0.3.7' }, '0.3.6').label, /0\.3\.7/);
  assert.match(describeUpdate({ state: 'downloaded', version: '0.3.7' }, '0.3.6').label, /restart/i);
  assert.match(describeUpdate({ state: 'downloading', version: '0.3.7', percent: 42.4 }, '0.3.6').label, /42%/);
});

test('the underlying failure reaches the tooltip instead of being swallowed', () => {
  // This is the regression guard for the v0.3.4-0.3.6 bug: the real error was
  // caught and dropped, leaving "open the releases page" with no explanation.
  const err = describeUpdate({ state: 'error', message: 'Cannot set properties of undefined' }, '0.3.6');
  assert.match(err.title, /Cannot set properties of undefined/);

  const manual = describeUpdate(
    { state: 'available-manual', version: '0.3.7', url: 'https://x', reason: 'ENOTFOUND github.com' },
    '0.3.6'
  );
  assert.match(manual.title, /ENOTFOUND github\.com/);
});

// ---------------------------------------------------------------------------
// Settings → General "Updates" block (v0.3.9)
//
// The toolbar chip stays silent when nothing is happening, which is right for a
// chip and useless for someone who opened Settings *to ask*. These lock in the
// two things that make the block worth having: every state says something, and
// the states you can act on hand you a button that names the action.
// ---------------------------------------------------------------------------

const { describeUpdateSettings } = loadTs('src/shared/updateState.ts');

test('every update state produces a headline and a sentence', () => {
  const states = [
    null,
    { state: 'idle' },
    { state: 'checking' },
    { state: 'not-available' },
    { state: 'available', version: '0.4.0' },
    { state: 'downloading', version: '0.4.0', percent: 12 },
    { state: 'downloaded', version: '0.4.0' },
    { state: 'available-manual', version: '0.4.0', url: 'https://x' },
    { state: 'error', message: 'ENOTFOUND github.com' }
  ];
  for (const s of states) {
    const v = describeUpdateSettings(s, '0.3.9');
    assert.ok(v.headline.length > 0, `no headline for ${s?.state ?? 'null'}`);
    assert.ok(v.detail.length > 0, `no detail for ${s?.state ?? 'null'}`);
  }
});

test('idle and up-to-date both offer a check, and say which version you are on', () => {
  const idle = describeUpdateSettings({ state: 'idle' }, '0.3.9');
  assert.equal(idle.action, 'check');
  assert.match(idle.button, /check for updates/i);
  assert.match(idle.headline, /0\.3\.9/);

  const latest = describeUpdateSettings({ state: 'not-available' }, '0.3.9');
  assert.equal(latest.action, 'check');
  assert.match(latest.headline, /0\.3\.9 is the latest/i);
  assert.match(latest.detail, /up to date/i);
});

test('a staged update offers the restart, and names the version it installs', () => {
  const done = describeUpdateSettings({ state: 'downloaded', version: '0.4.0' }, '0.3.9');
  assert.equal(done.action, 'restart');
  assert.match(done.button, /restart to update/i);
  assert.equal(done.tone, 'ready');
  assert.match(done.headline, /0\.4\.0/);
});

test('an available update offers the download, not the restart', () => {
  const avail = describeUpdateSettings({ state: 'available', version: '0.4.0' }, '0.3.9');
  assert.equal(avail.action, 'download');
  assert.match(avail.button, /download v0\.4\.0/i);
});

test('the two mid-flight states have no button to press', () => {
  assert.equal(describeUpdateSettings({ state: 'checking' }, '0.3.9').button, null);
  assert.equal(describeUpdateSettings({ state: 'downloading', version: '0.4.0', percent: 42.4 }, '0.3.9').button, null);
  assert.match(describeUpdateSettings({ state: 'downloading', version: '0.4.0', percent: 42.4 }, '0.3.9').detail, /42%/);
  assert.equal(describeUpdateSettings({ state: 'checking' }, '0.3.9').busy, true);
});

test('failures reach Settings verbatim, same as the tooltip', () => {
  const err = describeUpdateSettings({ state: 'error', message: 'ENOTFOUND github.com' }, '0.3.9');
  assert.match(err.detail, /ENOTFOUND github\.com/);
  assert.equal(err.action, 'check');

  const manual = describeUpdateSettings(
    { state: 'available-manual', version: '0.4.0', url: 'https://x', reason: 'win-portable' },
    '0.3.9'
  );
  assert.match(manual.detail, /win-portable/);
  assert.equal(manual.action, 'open-release');
});

test('manual update with a direct installer reads as a download, not a page to hunt on', () => {
  const { manualInstallSteps } = loadTs('src/shared/updateState.ts');
  const v = describeUpdate(
    { state: 'available-manual', version: '0.4.5', url: 'https://x', downloadUrl: 'https://x/a.dmg' },
    '0.4.4'
  );
  assert.match(v.label, /download/);
  assert.equal(v.action, 'manual');
  assert.equal(v.tone, 'ready');
  for (const p of ['darwin', 'win32', 'linux']) {
    const s = manualInstallSteps(p);
    assert.equal(s.steps.length, 2);
    // Every platform says the update keeps their work.
    assert.match(s.steps.join(' '), /Your team and files are still there\./);
  }
});

test('just-updated is quiet on the badge and loses to a newer available release', () => {
  const v = describeUpdate({ state: 'just-updated', version: '0.4.5' }, '0.4.5');
  assert.equal(v.label, 'latest');
  const next = reduceStatus(
    { state: 'just-updated', version: '0.4.5' },
    { state: 'available', version: '0.4.6' }
  );
  assert.equal(next.state, 'available');
});

test('hyphenated prerelease identifiers retain their full release order', () => {
  // Value: protects=update offers for hyphenated prereleases; fails_when=beta-a.1 and beta-z.1 collapse to the same version; seam=none
  const { isNewerRelease, pendingVersion, reduceStatus } = loadTs('src/shared/updateState.ts');
  const older = '0.1.1-beta-a.1';
  const newer = '0.1.1-beta-z.1';
  assert.equal(isNewerRelease(newer, older), true);
  assert.equal(isNewerRelease(older, newer), false);
  assert.equal(isNewerRelease(newer, newer), false);
  assert.equal(isNewerRelease('0.1.1', newer), true);
  assert.equal(isNewerRelease(newer, '0.1.1'), false);
  assert.equal(isNewerRelease('v0.1.1-beta-z.2+build.7', newer), true);
  assert.equal(isNewerRelease('0.1.1-beta-z.1+build.8', newer), false);

  const available = { state: 'available', version: newer };
  assert.equal(pendingVersion(available, older), newer);
  assert.equal(reduceStatus({ state: 'downloaded', version: older }, available), available);
  assert.equal(isNewer(newer, older), false, 'CLI and model floor comparisons still ignore prereleases');
});
