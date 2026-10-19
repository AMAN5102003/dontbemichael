'use strict';

/**
 * Settings → Prerequisites shows only what this build uses (owner, 2026-09-25):
 * the engines it offers (BUILD_ENGINES), uv and MemPalace. The developer rows
 * (git, Node.js, every other engine) hide behind SHOW_DEV_TOOLS. The full
 * catalog still feeds tools:status, because onboarding checks every engine.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { toolCatalog, prerequisiteRows } = loadTs('src/shared/toolCatalog.ts');
const { SHOW_DEV_TOOLS } = loadTs('src/shared/buildFeatures.ts');

test('the page shows Claude Code, uv and MemPalace, nothing else', () => {
  assert.equal(SHOW_DEV_TOOLS, false);
  const ids = prerequisiteRows(toolCatalog()).map((t) => t.id).sort();
  assert.deepEqual(ids, ['engine:claude', 'mempalace', 'uv']);
});

test('the switch brings every row back, and the catalog itself is untouched', () => {
  const all = toolCatalog();
  assert.equal(prerequisiteRows(all, true).length, all.length);
  assert.ok(all.some((t) => t.id === 'git') && all.some((t) => t.id === 'engine:codex'), 'onboarding still sees every engine');
});

test('the panel filters what it shows, not what main reports', () => {
  const panel = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/SetupPanel.tsx'), 'utf8');
  assert.match(panel, /setTools\(prerequisiteRows\(await window\.cth\.toolsStatus\(\)\)\)/);
  const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert.match(main, /return toolCatalog\(\)\.map\(/, 'tools:status keeps the full catalog');
});

test('Agents & Models hides the API keys panel while no offered engine reads it', () => {
  const { showByokSettings, BUILD_ENGINES } = loadTs('src/shared/agentProvider.ts');
  assert.deepEqual([...BUILD_ENGINES], ['claude']);
  assert.equal(showByokSettings(), false, 'Claude Code uses its own login');
  assert.equal(showByokSettings(['claude', 'opencode']), true, 'it comes back when a build offers OpenCode');
  const modal = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  assert.match(modal, /\{showByokSettings\(\) && \(\s*<>\s*<AiEnginesSettings config=\{config\} \/>/);
  assert.match(modal, /settings\.agentsModels\.maxTurns/, 'Max turns stays (owner, 2026-09-25)');
});

test('Agents & Models and Autonomy & Budgets are one Agents tab (owner, 2026-10-01)', () => {
  const modal = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  assert.match(modal, /const NAV_SECTIONS: Section\[\] = \['General', 'Company profile', 'Prerequisites', 'Agents', 'Skills', 'Connections', 'Research & privacy', 'Voice', 'Memory & Knowledge'\];/);
  assert.doesNotMatch(modal, /'Autonomy & Budgets'|'Agents & Models'/);
  // One tab, in this order: the model, autonomy, the circuit breaker, then max turns.
  const tab = modal.slice(modal.indexOf("{activeSection === 'Agents' && ("), modal.indexOf("{/* MEMORY & KNOWLEDGE */}"));
  const at = (k) => { const i = tab.indexOf(k); assert.ok(i > 0, k); return i; };
  assert.ok(at("t('settings.agentsModels.defaultModel')") < at("t('settings.autonomy.autonomy')"));
  assert.ok(at("t('settings.autonomy.autonomy')") < at("t('settings.autonomy.breaker')"));
  assert.ok(at("t('settings.autonomy.breaker')") < at("t('settings.agentsModels.maxTurns')"));
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const nav = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', `src/renderer/src/i18n/locales/${loc}.json`), 'utf8')).settings.nav;
    assert.ok(nav.agents, `${loc}: Agents label`);
    assert.equal(nav.autonomyBudgets, undefined, `${loc}: no second tab label`);
  }
  // Agents are told where the owner turns hiring on (hive.ts).
  assert.match(fs.readFileSync(path.resolve(__dirname, '..', 'src/main/hive.ts'), 'utf8'), /under Settings → Agents, and it is/);
});
