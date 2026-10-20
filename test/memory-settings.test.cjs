'use strict';

/**
 * The floating "hive memory" panel on the office floor is gone (owner,
 * 2026-09-24). Nothing in it was about the floor: its on/off duplicated
 * Settings → Memory & Knowledge, searching memory is on Michael's Memory tab,
 * and its one unique control, the search language, moved into Settings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the office floor no longer carries the memory panel', () => {
  assert.doesNotMatch(read('src/renderer/src/App.tsx'), /MemoryPanel/);
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../src/renderer/src/components/MemoryPanel.tsx')));
});

test('search by meaning sits under Company knowledge: its switch, status and search language', () => {
  const s = read('src/renderer/src/components/SettingsModal.tsx');
  const start = s.indexOf("activeSection === 'Memory & Knowledge'");
  const section = s.slice(start, start + 9000);
  // One section: company knowledge first, search by meaning inside it, only while it is on.
  assert.ok(section.indexOf("t('settings.memory.kg')") < section.indexOf("t('settings.memory.meaning.title')"));
  assert.match(section, /\{kgEnabled && \(\n\s*<div style=\{\{ marginTop: 14, paddingTop: 12/);
  assert.doesNotMatch(s, /settings\.memory\.semanticMemory|settings\.memory\.crossSession/);
  assert.match(section, /onClick=\{toggleSemMem\}/);
  assert.match(section, /t\('memoryPanel\.onReady'\)/);
  assert.match(section, /onClick=\{\(\) => pickEmbeddingModel\(id\)\}/);
  assert.match(section, /settings\.memory\.meaning\.languageTip/);
  // Saved with the rest of Settings, not instantly like the old panel.
  assert.match(s, /stage\(\{ embeddingModel: m \} as Partial<HarnessConfig>\);/);
  // Not installed: straight to the setup that installs it.
  assert.match(section, /setActiveSection\('Prerequisites'\)/);
});

test('Michael\'s Memory tab searches the team\'s notes by exact words only', () => {
  const panel = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.doesNotMatch(panel, /searchMemory|memoryNotes\.byMeaning|role="radiogroup" aria-label=\{t\('memoryNotes\.searchTitle'\)\}/);
  assert.match(panel, /window\.cth\.textSearch\(q\)/);
  assert.doesNotMatch(read('src/renderer/src/realtime/tools.ts'), /window\.cth\.searchMemory/, 'the voice tool reads notes by exact words too');
});

test('a new search language rebuilds the index, and running members get the command for it', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /'embeddingModel' in patch && \(next\.embeddingModel \?\? 'minilm'\) !== modelBefore\) memory\.modelChanged\(\);/);
  assert.match(main, /\{ bin, palace, model: memory\.model\(\) \}/);
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const m = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`)).settings.memory;
    for (const text of [m.kg, m.kgTitle, m.kgDesc, ...Object.values(m.meaning)]) assert.doesNotMatch(text, /[\u2013\u2014]| - /, `${lang}: ${text}`);
  }
});
