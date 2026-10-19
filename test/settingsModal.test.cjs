'use strict';

// SettingsModal: the starting tab must come from VISIBLE_SECTIONS.
//
// The deep-link guard that used to live in App.tsx (nine hardcoded strings)
// was moved into the modal itself so there is one canonical place that knows
// which tabs are real.  These tests pin that contract in source so a future
// refactor cannot silently break either side.
//
// SettingsModal is a 2000+ line TSX with a wide import graph, so we read the
// source rather than mounting it — the same house pattern as settings-one-save
// and settings-fold-hidden.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MODAL = read('src/renderer/src/components/SettingsModal.tsx');
const APP   = read('src/renderer/src/App.tsx');

// -- 1. VISIBLE_SECTIONS is defined in SettingsModal --------------------------
test('VISIBLE_SECTIONS is defined in SettingsModal', () => {
  assert.match(MODAL, /const VISIBLE_SECTIONS/, 'VISIBLE_SECTIONS constant is missing from SettingsModal');
});

// -- 2. activeSection initialiser checks VISIBLE_SECTIONS, not a bare ?? ------
test('activeSection useState uses VISIBLE_SECTIONS.includes, not a bare ?? fallback', () => {
  assert.match(
    MODAL,
    /useState<Section>\(initialSection && VISIBLE_SECTIONS\.includes\(initialSection\) \? initialSection : 'General'\)/,
    "activeSection useState must be: initialSection && VISIBLE_SECTIONS.includes(initialSection) ? initialSection : 'General'"
  );
});

// -- 3. The old 9-string guard is gone from App.tsx ---------------------------
test('App.tsx no longer contains the hardcoded section-name guard', () => {
  assert.doesNotMatch(
    APP,
    /section === 'Company profile'/,
    "App.tsx still contains the hardcoded section guard — it must be removed"
  );
  assert.doesNotMatch(
    APP,
    /section === 'Memory & Knowledge'/,
    "App.tsx still contains the hardcoded section guard — it must be removed"
  );
});

// -- 4. App passes the raw value; the modal handles the fallback ---------------
test('App.tsx passes the raw section through to setSettingsSection', () => {
  assert.match(
    APP,
    /setSettingsSection\(section as SettingsSection/,
    'App.tsx must pass the raw section value (cast) to setSettingsSection'
  );
});
