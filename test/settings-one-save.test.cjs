'use strict';

// A1: one Save button. Settings used to persist three different ways — toggles
// wrote on click, some sections had their own Save, a couple of fields saved on
// blur — and nothing told the user which kind they were looking at.
//
// SettingsModal is a 2000-line TSX with a wide import graph, so these read the
// source rather than mounting it. That is the existing house pattern for this
// file, and it holds the RULE, which is what actually regressed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MODAL = read('src/renderer/src/components/SettingsModal.tsx');

test('there is exactly one writer of config in the whole modal', () => {
  const calls = MODAL.match(/window\.cth\.updateConfig\(/g) ?? [];
  assert.equal(calls.length, 1,
    `${calls.length} updateConfig calls — every setting must go through saveAll`);
});

test('the one writer is saveAll, and it sends a single merged patch', () => {
  const i = MODAL.indexOf('const saveAll');
  assert.ok(i > 0, 'saveAll is gone');
  const body = MODAL.slice(i, MODAL.indexOf('\n  };', i));
  assert.match(body, /window\.cth\.updateConfig\(patch\)/,
    'saveAll must write one patch, not several calls');
  for (const part of ['maxTurnsPatch()', 'budgetPatch()', '...pending']) {
    assert.ok(body.includes(part), `saveAll does not include ${part}`);
  }
});

test('toggles stage their change instead of writing it', () => {
  // The specific toggles that used to persist the instant you clicked them.
  // semanticMemory left with its switch: search by meaning runs whenever
  // MemPalace is installed (owner, 2026-10-19).
  for (const key of ['strongKeepalive', 'autoMode', 'orchestratorMaySpawn', 'telemetryEnabled']) {
    // autoUpdate left with its switch: every installed build checks (owner, 2026-10-02).
    const re = new RegExp(`stage\\(\\{ ${key}:`);
    assert.match(MODAL, re, `${key} is not staged`);
  }
});

test('closing with staged changes asks first, instead of dropping them', () => {
  assert.match(MODAL, /const requestClose/, 'no close guard');
  const i = MODAL.indexOf('const requestClose');
  const body = MODAL.slice(i, i + 300);
  assert.match(body, /dirty/, 'the guard does not check for staged changes');
  assert.match(body, /window\.confirm/, 'the guard does not actually ask');
  // And the footer button must use it, not raw onClose.
  assert.match(MODAL, /onClick=\{requestClose\}/, 'the footer Close bypasses the guard');
});

test('the footer offers Save, and it is the only Save left in the modal', () => {
  assert.match(MODAL, /onClick=\{\(\) => void saveAll\(\)\}/, 'no footer Save');
  // The per-section Save buttons this replaced are gone.
  assert.doesNotMatch(MODAL, /onClick=\{saveBudget\}/, 'the budget Save button is back');
  assert.doesNotMatch(MODAL, /onBlur=\{\(\) => void saveMaxTurns\(\)\}/, 'maxTurns saves on blur again');
});

// --- the two deliberate exceptions ------------------------------------------

test('API keys still save immediately: there is no staged value to hold', () => {
  // The broker is write-only — nothing can read a key back to diff it — so a
  // key cannot participate in a staged form.
  const engines = read('src/renderer/src/components/AiEnginesSettings.tsx');
  assert.match(engines, /saveKey\(/, 'the per-provider key save was removed');
  assert.match(MODAL, /saveOpenAiVoiceKey/, 'the voice key save was folded into saveAll');
});

test('Free Flow still saves immediately: it arms a global hotkey', () => {
  // Staging it would leave main's hotkey and the checkbox disagreeing until
  // someone pressed Save.
  assert.match(MODAL, /window\.cth\.freeflowSetConfig\(/, 'freeflow no longer persists on its own');
});

// --- A2: Connections tidying -------------------------------------------------

test('every Settings section is a named group on the soft panel, with no small caps head or hairline', () => {
  // Value: protects=AS2 and AS3 in Settings (app-style-rollout.md T3); fails_when=a section head or divider is written out again, or a section loses its panel; why_new=replaces the sectionHead and sectionRule pins retired by T3; seam=none; no_claim=source pins, not rendered
  assert.match(MODAL, /const group: CSSProperties = \{ \.\.\.panelStyle, gap: 10 \};/);
  assert.doesNotMatch(MODAL, /sectionHead|sectionRule/, 'the old head and rule are retired');
  assert.doesNotMatch(MODAL, /fontSize: 10, fontWeight: 600|textTransform: 'uppercase'/, 'no small caps');
  assert.doesNotMatch(MODAL, /\{\{ height: (1|2), background: 'var\(--cth-(line|ink-300)\)'/, 'no hairlines between sections');
  assert.ok((MODAL.match(/<h3 style=\{groupName\}>/g) ?? []).length >= 12, 'each section names itself');
  for (const f of ['MailboxesSettings', 'ClaudeConnectorsSettings', 'IntegrationsRegistry', 'ResearchPrivacySettings', 'SetupPanel', 'SettingsHeroCard']) {
    const src = fs.readFileSync(path.join(__dirname, '..', `src/renderer/src/components/${f}.tsx`), 'utf8');
    assert.match(src, /panelStyle/, `${f} sits on the soft panel`);
    assert.match(src, /groupName/, `${f} names its group`);
  }
});

test('no integration was removed from Connections', () => {
  // The founder was explicit: nothing is deleted from this tab.
  for (const key of ['settings.connections.slack', 'settings.connections.webhooks']) {
    assert.ok(MODAL.includes(key), `${key} vanished from the Connections tab`);
  }
  assert.match(MODAL, /slackStart|slackStop/, 'the Slack lifecycle controls are gone');
});
