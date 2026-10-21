'use strict';

// Clearing an engine key on the AI Engines screen (follow-up to #147).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// No DOM here, so pull clearKey out of the component and run it with stand-ins.
function loadClearKey(result) {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/AiEnginesSettings.tsx'), 'utf8');
  const fn = src.match(/const clearKey = async \(backend: string\) => \{[\s\S]*?\n {2}\};/)[0];
  const js = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const state = { hasKey: { openai: true }, note: {}, talk: true };
  const window = { cth: { providerKeyClear: async () => { if (result instanceof Error) throw result; return result; } } };
  const clearKey = new Function('window', 't', 'setHasKey', 'setNote', 'setHasOpenAiKey', `${js}\nreturn clearKey;`)(
    window,
    (key) => key,
    (f) => { state.hasKey = f(state.hasKey); },
    (f) => { state.note = f(state.note); },
    (on) => { state.talk = on; }
  );
  return { clearKey, state };
}

test('a cleared key shows as cleared', async () => {
  const { clearKey, state } = loadClearKey({ ok: true });
  await clearKey('openai');
  assert.deepEqual(state, { hasKey: { openai: false }, note: { openai: 'aiEngines.cleared' }, talk: false });
});

test('a key that could not be cleared says why and stays set', async () => {
  const failed = loadClearKey({ ok: false, error: 'The saved key could not be removed.' });
  await failed.clearKey('openai');
  assert.deepEqual(failed.state, { hasKey: { openai: true }, note: { openai: 'The saved key could not be removed.' }, talk: true });

  const noReason = loadClearKey({ ok: false });
  await noReason.clearKey('openai');
  assert.equal(noReason.state.note.openai, 'aiEngines.failed');

  const thrown = loadClearKey(new Error('IPC gone'));
  await thrown.clearKey('openai');
  assert.deepEqual(thrown.state, { hasKey: { openai: true }, note: { openai: 'IPC gone' }, talk: true });
});
