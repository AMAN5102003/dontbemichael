'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('saving an AI provider key checks encrypted secret availability before writing', () => {
  // Value: protects=a key on a computer with no usable keychain is refused up front with the plain reason; fails_when=providerKey:set writes before checking availability or answers with a raw error; why_new=TODOS credential encryption guidance, saved AI keys; seam=IPC source contract
  const main = read('src/main/index.ts');
  const handler = main.match(/ipcMain\.handle\('providerKey:set',[\s\S]*?\n\}\);/);
  assert.ok(handler, 'provider key save handler exists');

  const check = handler[0].indexOf('!integrations.canStoreSecrets()');
  const write = handler[0].indexOf('integrations.setSecret(');
  assert.ok(check !== -1, 'availability is checked');
  assert.ok(check < write, 'availability is checked before the key is written');
  assert.match(
    handler[0],
    /!integrations\.canStoreSecrets\(\)\) return \{ ok: false, error: integrations\.secretStoreUnavailableReason\(\) \}/,
    'the refusal carries the plain reason'
  );
});
