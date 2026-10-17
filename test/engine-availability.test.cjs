'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  classifyEngineAvailability,
  engineBlocksOnboarding,
  engineAvailabilityBadge,
  engineAvailabilityMessage
} = loadTs('src/shared/engineAvailability.ts');
const { toolCatalog } = loadTs('src/shared/toolCatalog.ts');
const { AGENT_PROVIDER_PRESETS, canReceiveInbox } = loadTs('src/shared/agentProvider.ts');

// Build what `tools:status` returns for a machine where `found` lists the only
// binaries present. Mirrors the main-process handler's shape without electron.
function statusesFor(found) {
  return toolCatalog().map((spec) => ({
    ...spec,
    installCommand: spec.install.posix,
    found: !!spec.bin && found.includes(spec.bin),
    path: spec.bin && found.includes(spec.bin) ? `/usr/local/bin/${spec.bin}` : null
  }));
}

test('an installed engine is installed, whatever its installer story', () => {
  const s = statusesFor(['claude', 'grok']);
  assert.equal(classifyEngineAvailability(s, 'claude').state, 'installed');
  assert.equal(classifyEngineAvailability(s, 'grok').state, 'installed');
  assert.equal(classifyEngineAvailability(s, 'grok').path, '/usr/local/bin/grok');
});

test('a missing engine with an installer installs on first run and does not block', () => {
  const s = statusesFor([]);
  for (const id of ['claude', 'codex', 'qwen', 'opencode', 'crush', 'pi', 'copilot']) {
    const a = classifyEngineAvailability(s, id);
    assert.equal(a.state, 'installs-on-first-run', id);
    assert.ok(a.installCommand.length > 0, id);
    assert.equal(engineBlocksOnboarding(a), false, id);
  }
});

test('grok and antigravity have no installer, so the wizard blocks but links to the docs', () => {
  const s = statusesFor([]);
  const offered = AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id)).map((p) => p.id);
  for (const id of ['grok', 'antigravity']) {
    assert.ok(offered.includes(id), `${id} is on the picker`);
    const a = classifyEngineAvailability(s, id);
    assert.equal(a.state, 'not-installable', id);
    assert.equal(engineBlocksOnboarding(a), true, id);
    assert.match(a.docsUrl ?? '', /^https:\/\//, `${id} links to install instructions`);
    assert.equal(engineAvailabilityBadge(a), 'NOT INSTALLED');
    const msg = engineAvailabilityMessage(a, 'Grok');
    assert.match(msg, /not installed/);
    assert.match(msg, /check again/);
    assert.match(msg, /Claude Code/);
    assert.doesNotMatch(msg, /[–—-]/, 'no dashes in user facing prose');
  }
});

test('every engine the wizard offers links to install instructions', () => {
  const s = statusesFor([]);
  for (const p of AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id) && p.id !== 'custom')) {
    const a = classifyEngineAvailability(s, p.id);
    assert.match(a.docsUrl ?? '', /^https:\/\//, `${p.id} has a docs link`);
  }
});

test('no probe result means unknown, and unknown never blocks', () => {
  const a = classifyEngineAvailability(undefined, 'grok');
  assert.equal(a.state, 'unknown');
  assert.equal(engineBlocksOnboarding(a), false);
  assert.equal(engineAvailabilityBadge(a), null);
  assert.equal(engineAvailabilityMessage(a, 'Grok'), null);
  // a probe that ran but lacks the row behaves the same
  assert.equal(classifyEngineAvailability([], 'grok').state, 'unknown');
});

test('only the dead end has a message', () => {
  const s = statusesFor(['claude']);
  assert.equal(engineAvailabilityMessage(classifyEngineAvailability(s, 'claude'), 'Claude Code'), null);
  assert.equal(engineAvailabilityMessage(classifyEngineAvailability(s, 'codex'), 'Codex'), null);
});
