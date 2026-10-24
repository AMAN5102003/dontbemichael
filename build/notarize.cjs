// electron-builder `afterSign` hook — notarize + staple the macOS app.
//
// A local build with no notarization credentials (a contributor without an
// Apple account running `npm run dist:mac`) skips notarization and still works.
// In CI with a Developer ID cert, the build must be signed by RELEASE_TEAM_ID,
// needs the credentials below, and fails if notarization fails; the .app/.dmg
// is then signed, notarized and stapled, so end users get one macOS prompt.
//
// Credentials (set whichever pair you use):
//   App-specific password:  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//   App Store Connect key:  APPLE_API_KEY (path to .p8), APPLE_API_KEY_ID, APPLE_API_ISSUER
//
// A release that is signed must also be notarized, or it fails. A signed but
// unnotarized download still gets macOS's "cannot verify" warning, and the
// release would look done while it is not (owner, 2026-10-22).
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

/** The only Apple team a release is signed by: the owner's own account, never
 *  an employer's or a contributor's (owner, 2026-10-22). It is public; every
 *  signed copy of the app carries it. */
const RELEASE_TEAM_ID = 'B5EHD4JBD2';

/** The team that signed the app, or null when it is unsigned or ad hoc. */
function signingTeam(appPath) {
  const out = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' });
  const m = /^TeamIdentifier=(\S+)$/m.exec(`${out.stdout || ''}${out.stderr || ''}`);
  return m && m[1] !== 'not' ? m[1] : null;
}

/**
 * Without a Developer ID cert electron-builder skips signing entirely, which
 * leaves only the Mach-O linker signatures: the bundle itself is not sealed
 * (`codesign --verify` says "code object is not signed at all"). A copy of that
 * downloaded from GitHub gets macOS's "damaged, move to Trash" dialog, with no
 * way to open it. Sealing it ad hoc turns that into the ordinary "could not
 * verify the developer" dialog, which Privacy & Security > Open Anyway clears.
 * Only local and dry builds take this path: a tagged release must carry a real
 * Developer ID signature (requireDeveloperId below).
 *
 * Runs only when the bundle does not already verify, so a real Developer ID
 * signature is never touched. electron-builder 25 has no ad-hoc identity of its
 * own (`identity: "-"` is looked up in the keychain and skipped), hence here.
 */
function sealAdHocIfUnsigned(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'ignore' });
    return; // properly signed already
  } catch { /* not sealed: fall through */ }
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');
  console.log('[sign] no Developer ID signature: sealing the app ad hoc so a downloaded copy can be opened.');
  execFileSync('codesign', [
    '--force', '--deep', '--sign', '-',
    '--options', 'runtime', '--entitlements', entitlements,
    appPath
  ], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
}

/**
 * A tagged release must be Developer ID signed (owner, 2026-10-23): RELEASE.md and
 * dontbemichael.com tell Mac owners to click Open, which an ad hoc build never
 * offers. release.yml sets REQUIRE_DEVELOPER_ID on tags only, so a missing
 * APPLE_CERTIFICATE_P12 secret stops the release instead of shipping it ad hoc.
 */
function requireDeveloperId() {
  if (process.env.REQUIRE_DEVELOPER_ID && !(process.env.CSC_LINK || process.env.CSC_KEYCHAIN)) {
    throw new Error('[sign] a tagged release must be signed with the Developer ID certificate, but none was imported. Check the APPLE_CERTIFICATE_P12 secret.');
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return; // mac only

  requireDeveloperId();
  sealAdHocIfUnsigned(path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`));

  // CI with a cert is a real release: it must be signed by the owner's team.
  if (process.env.CI && (process.env.CSC_LINK || process.env.CSC_KEYCHAIN)) {
    const team = signingTeam(path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`));
    if (team !== RELEASE_TEAM_ID) {
      throw new Error(`[sign] the release must be signed by Apple team ${RELEASE_TEAM_ID}, but it was signed by ${team || 'no team'}. Check the APPLE_CERTIFICATE_P12 secret.`);
    }
    if (process.env.APPLE_TEAM_ID && process.env.APPLE_TEAM_ID !== RELEASE_TEAM_ID) {
      throw new Error(`[notarize] APPLE_TEAM_ID is ${process.env.APPLE_TEAM_ID}, not the release team ${RELEASE_TEAM_ID}.`);
    }
  }

  const {
    APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID,
    APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
  } = process.env;

  const hasPassword = !!(APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID);
  const hasApiKey = !!(APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER);
  if (!hasPassword && !hasApiKey) {
    // CI with a Developer ID cert is a real release: never ship it unnotarized.
    // A local build without credentials stays as it was.
    if (process.env.CI && (process.env.CSC_LINK || process.env.CSC_KEYCHAIN)) {
      throw new Error('[notarize] the release is signed with a Developer ID but has no APPLE_* notarization credentials. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
    }
    console.log('[notarize] no APPLE_* credentials in env — skipping notarization.');
    return;
  }

  const { notarize } = require('@electron/notarize');

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const creds = hasApiKey
    ? { appleApiKey: APPLE_API_KEY, appleApiKeyId: APPLE_API_KEY_ID, appleApiIssuer: APPLE_API_ISSUER }
    : { appleId: APPLE_ID, appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD, teamId: APPLE_TEAM_ID };

  console.log(`[notarize] submitting ${appName}.app to Apple via notarytool (this can take a few minutes)…`);
  try {
    await notarize({ tool: 'notarytool', appPath, ...creds });
    console.log('[notarize] stapling ticket to the app…');
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
    console.log('[notarize] done — app is signed, notarized, and stapled.');
  } catch (err) {
    // Notarization talks to Apple's servers and can fail for reasons outside the
    // build (a bad or expired app-specific password, an unaccepted Developer
    // Program agreement, an Apple outage, a rejected submission). Fail the Mac
    // build so the release is not published; fix the cause and push the tag again.
    throw new Error(`[notarize] notarization failed, so the Mac release stops here. notarytool said:\n${err && err.message ? err.message : err}`);
  }
};
