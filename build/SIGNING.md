# macOS code signing & notarization (maintainer runbook)

Signing binds the app's TCC grants (Documents/Desktop/Downloads access) to a
**stable code signature**, so users are prompted for folder access **once**
instead of on every agent action. Notarization clears Gatekeeper so the app
opens without the "unidentified developer" warning.

Local and dry builds need none of this: with no credentials present,
`npm run dist:mac` and a manual (`workflow_dispatch`) run of the release
workflow produce a working build sealed ad hoc (`build/notarize.cjs`). A tagged
release is different: since v0.2.6 every release is signed and notarized, and
RELEASE.md tells Mac owners to click Open, so a tag pushed without the
Developer ID certificate fails (`REQUIRE_DEVELOPER_ID`) instead of shipping ad hoc.

## One-time Apple setup

1. Enrol in the Apple Developer Program ($99/yr) and note your **Team ID**
   (Apple Developer → Membership).
2. Create a **Developer ID Application** certificate (Apple Developer →
   Certificates → +), download it, and double-click to import into your login
   keychain.
3. Create an **app-specific password** for notarization at
   <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords.

## Local signed build

```sh
# Export the cert from Keychain Access → My Certificates → "Developer ID
# Application: …" → right-click → Export → .p12 (set an export password).
export CSC_LINK="$(base64 -i DeveloperIDApplication.p12)"   # or a file path
export CSC_KEY_PASSWORD="<the .p12 export password>"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run dist:mac
```

Keep these out of git — `.env.signing`, `*.p12`, and `*.p8` are gitignored.
Source them from a local `.env.signing` if you like.

## CI (tagged release) setup

`.github/workflows/release.yml` reads the secrets below and passes them to
electron-builder on the macOS runner. Add them under **Settings → Secrets and
variables → Actions** (required for a tagged release):

| GitHub secret                  | Value                                              |
| ------------------------------ | -------------------------------------------------- |
| `APPLE_CERTIFICATE_P12`        | `base64 -i DeveloperIDApplication.p12` (one line)  |
| `APPLE_CERTIFICATE_PASSWORD`   | the .p12 export password                           |
| `APPLE_ID`                     | your Apple ID email                                |
| `APPLE_APP_SPECIFIC_PASSWORD`  | the app-specific password from above               |
| `APPLE_TEAM_ID`                | your 10-char Team ID                               |

Then push a `v*` tag as usual; the produced `.dmg` will be signed, notarized,
and stapled.

## Verify a build is properly signed

```sh
codesign --verify --deep --strict --verbose=2 "dist/mac-universal/Don't Be Michael.app"
spctl --assess --type execute --verbose "dist/mac-universal/Don't Be Michael.app"   # → "accepted, source=Notarized Developer ID"
xcrun stapler validate "dist/mac-universal/Don't Be Michael.app"
```

See `electron-builder.yml` (the `mac:` block) and `build/notarize.cjs` for how
these credentials are consumed.
