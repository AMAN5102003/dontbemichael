'use strict';

/**
 * "Open at login" has no Linux implementation: Electron's login item API works
 * on macOS and Windows only. The setup row is hidden on Linux, and the main
 * process handler returns false there without calling setLoginItemSettings, so
 * nothing can switch it on by another path. Both are source checks, in the
 * style of onboarding-steps.test.cjs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const wizard = fs.readFileSync(path.join(root, 'src/renderer/src/components/OnboardingWizard.tsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');

test('the setup wizard hides the Open at login row on Linux', () => {
  assert.match(
    wizard,
    /\{platform !== 'linux' && \(\s*<ToggleRow[^>]*onboarding\.permissions\.openAtLogin/,
    'the openAtLogin ToggleRow must sit inside a platform !== "linux" condition'
  );
});

test('app:setLoginItem returns false on Linux before touching setLoginItemSettings', () => {
  const start = main.indexOf("ipcMain.handle('app:setLoginItem'");
  assert.notEqual(start, -1, 'could not find the app:setLoginItem handler');
  const body = main.slice(start, main.indexOf('\n});', start));
  const guard = body.indexOf("if (process.platform === 'linux') return false;");
  const call = body.indexOf('app.setLoginItemSettings(');
  assert.ok(guard !== -1, 'the handler needs an explicit linux guard');
  assert.ok(call !== -1, 'could not find the setLoginItemSettings call');
  assert.ok(guard < call, 'the linux guard must come before setLoginItemSettings');
});
