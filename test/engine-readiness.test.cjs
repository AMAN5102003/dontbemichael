'use strict';

/**
 * The readiness bar for an engine in BUILD_ENGINES (TODOS.md, Engines: "Make a
 * second engine (Codex first) ready for an office").
 *
 * An engine can be offered to an owner only if its preset can do the jobs an
 * office member needs from any CLI: start, take the hive seed prompt, report
 * lifecycle events, receive inbox mail at a safe idle, resume after a restart,
 * run unattended, take a model, and be installed when missing. This test
 * checks that bar on every engine in BUILD_ENGINES, so adding an id there
 * fails here first if its preset is not ready. It also checks Codex and
 * Gemini CLI, the two engines closest to being offered, so a change to their
 * presets cannot quietly lose one of these.
 *
 * It covers the preset only. Runtime wiring (MCP servers, writable folders,
 * usage and context data, memory tidy up) is tracked in TODOS.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const ap = loadTs('src/shared/agentProvider.ts');

// Each check returns '' when the preset passes, else a short reason.
const BAR = {
  'has a command to start it': (p) => (p.defaultCommand ? '' : 'no defaultCommand'),
  'can take the hive seed prompt': (p) =>
    p.hiveAware || p.initialPromptFlag || p.positionalInitialPrompt || p.seedDelivery
      ? '' : 'no hiveAware, initialPromptFlag, positionalInitialPrompt or seedDelivery',
  'reports lifecycle events': (p) =>
    p.hiveAware || ap.bridgeOf(p.id) ? '' : 'no hiveAware flag and no hook or proxy bridge',
  'can receive inbox mail': (p) => (p.canReceiveInbox ? '' : 'canReceiveInbox is false'),
  'can resume a session after a restart': (p) =>
    p.resumeFlag || p.resumeSubcommand ? '' : 'no resumeFlag or resumeSubcommand',
  'can run unattended': (p) => (p.autoModeFlag ? '' : 'no autoModeFlag'),
  'takes a model': (p) =>
    !p.supportsModel ? 'supportsModel is false' : p.modelFlag ? '' : 'supportsModel without a modelFlag',
  'can be installed when missing': (p) => (p.installCommand ? '' : 'no installCommand')
};

function gaps(id) {
  const preset = ap.providerPreset(id);
  return Object.entries(BAR)
    .map(([name, check]) => [name, check(preset)])
    .filter(([, reason]) => reason)
    .map(([name, reason]) => `${name} (${reason})`);
}

test('every engine this build offers meets the preset readiness bar', () => {
  for (const id of ap.BUILD_ENGINES) {
    assert.deepEqual(gaps(id), [], `${id} is in BUILD_ENGINES but its preset is not ready`);
  }
});

for (const id of ['codex', 'gemini']) {
  test(`${id} keeps meeting the preset readiness bar`, () => {
    assert.deepEqual(gaps(id), [], `${id} preset lost something an office member needs`);
  });
}

test('the readiness bar rejects a preset that cannot resume or receive mail', () => {
  const preset = { ...ap.providerPreset('codex'), resumeFlag: undefined, resumeSubcommand: undefined, canReceiveInbox: false };
  const failed = Object.entries(BAR).filter(([, check]) => check(preset)).map(([name]) => name);
  assert.deepEqual(failed, ['can receive inbox mail', 'can resume a session after a restart']);
});

test('the model check names why it failed', () => {
  const codex = ap.providerPreset('codex');
  assert.equal(BAR['takes a model']({ ...codex, supportsModel: false }), 'supportsModel is false');
  assert.equal(BAR['takes a model']({ ...codex, modelFlag: undefined }), 'supportsModel without a modelFlag');
});
