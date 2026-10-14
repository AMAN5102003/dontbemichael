'use strict';

/**
 * Edit Agent picks the engine from two lists instead of a wall of buttons
 * (owner, 2026-09-24): provider and model are dropdowns. The provider list is
 * the engines this build offers, like setup, plus the agent's own; the model
 * list always includes the agent's current model.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
const engine = src.slice(src.indexOf('<Fields id="engine">'), src.indexOf('</Fields>', src.indexOf('<Fields id="engine">')));

test('provider and model are dropdowns, not button grids', () => {
  assert.equal((engine.match(/<select\s*\n/g) || []).length, 2);
  assert.doesNotMatch(engine, /<button\b/, 'no buttons left in the engine section');
});

test('the provider list is this build\'s engines, plus the one the agent runs on', () => {
  assert.match(engine, /\.filter\(\(p\) => \(BUILD_ENGINES\.includes\(p\.id\) && \(!isResearch \|\| isClaudeProvider\(p\.id\)\)\) \|\| p\.id === provider\)/);
  assert.match(engine, /onChange=\{\(e\) => pickProvider\(e\.target\.value as AgentProvider\)\}/);
});

test('the model list always includes the current model', () => {
  assert.match(engine, /\[\.\.\.known, \{ id: model, label: t\('editAgent\.modelCurrent', \{ model \}\) \}\]/);
  assert.match(engine, /onChange=\{\(e\) => setModel\(e\.target\.value \|\| undefined\)\}/);
});

// 2026-10-02 (docs/designs/edit-agent.md): Edit agent let the owner turn Pam
// into Michael (picking a character also renamed her) and pick a color nothing
// drew. Character and color are chosen once, at hire; the dialog is one column.
test('Edit agent changes only name, job, work style and engine; never the character or color', () => {
  // Value: protects=a hired team member keeps who they are; fails_when=the cast grid or swatches come back, or save writes character or accent; why_new=nothing checked what the dialog offers; seam=none
  assert.doesNotMatch(src, /OFFICE_CAST|SpritePortrait|setCharacter|ACCENTS|setAccent/);
  const patch = src.slice(src.indexOf('updateAgent(agent.id, {'), src.indexOf('});', src.indexOf('updateAgent(agent.id, {')));
  assert.doesNotMatch(patch, /character|accent/);
  assert.match(patch, /provider,\s*model,\s*command,\s*description: trimmedDescription,/);
});

test('one column in order: name, job and work style, then the engine; no section headings', () => {
  // Value: protects=the D3 layout; fails_when=the two column grid, the 940 wide box or the Identity, Briefing and Engine headings come back, or the order changes; why_new=new layout; seam=none
  assert.doesNotMatch(src, /gridTemplateColumns|width=\{940\}|<Section|hint="/);
  const at = (s) => src.indexOf(s);
  assert.ok(at('<Fields id="name">') > 0 && at('<Fields id="name">') < at('<Fields id="briefing"') && at('<Fields id="briefing"') < at('<Fields id="engine">'));
});

// Owner, 2026-10-02: fold the engine away so what they handle and the work
// style get the room.
test('the engine is one folded line, closed by default, naming the provider and model', () => {
  // Value: protects=the job text keeps the space; fails_when=the engine opens by default, loses its toggle, or the folded line stops saying what it runs on; why_new=new fold; seam=none
  assert.match(src, /const \[engineOpen, setEngineOpen\] = useState\(false\);/);
  assert.match(src, /aria-expanded=\{engineOpen\}\s*aria-controls=\{engineOpen \? 'edit-agent-engine' : undefined\}/, 'never points at a folded, unmounted group');
  assert.match(src, /\{engineOpen && \(\s*<Fields id="engine">/);
  assert.match(src, /\{modelLabel \? `\$\{providerLabel\}, \$\{modelLabel\}` : providerLabel\}/);
  assert.match(src, /resize: 'none', minHeight: 320, flex: 1 \}\}/, 'the work style box takes the room left');
});

test('Edit agent takes the window\'s full height, and the work style box fills what is left (owner, 2026-10-02)', () => {
  // Value: protects=the most edited field gets the space; fails_when=the dialog sizes to its content again or the grow chain from the dialog to the work style box breaks; why_new=new fill option; seam=none
  assert.match(src, /width=\{640\}\s*fill\s*align="end"\s*over=\{panelBehind\}\s*zIndex=\{500\}/, 'exactly over the panel it edits (owner, 2026-10-02)');
  assert.match(src, /document\.querySelector<HTMLElement>\('\[data-right-column\] \[data-panel-card\]'\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/PanelChrome.tsx'), 'utf8'), /<div data-panel-card style=/);
  assert.match(src, /<Fields id="briefing" grow>/);
  assert.match(src, /<Row\s*grow\s*label=\{t\('editAgent\.workStyle'\)\}/);
  const dialog = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/Dialog.tsx'), 'utf8');
  assert.match(dialog, /justifyContent: align === 'end' \? 'flex-end' : 'center'/);
  assert.match(dialog, /\? \{ position: 'fixed', left: box\.left, top: box\.top, width: box\.width, height: box\.height \}/, 'over: the panel\'s exact box');
  assert.match(dialog, /maxHeight: fill \? 'calc\(100vh - 32px\)' : '88vh', \.\.\.\(fill \? \{ height: 'calc\(100vh - 32px\)' \} : \{\}\)/);
});

test('nothing draws over the work style box: the grow chain keeps each box its content height (owner, 2026-10-10)', () => {
  // Value: protects=the scheduled jobs under the work style never overlap it; fails_when=minHeight 0 returns on the column, the briefing fields or the work style row; why_new=a shrunken row let the 320 px box spill under the jobs list; seam=none
  assert.match(src, /<div style=\{\{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 \}\}>/, 'the body column');
  assert.match(src, /gap: 12, \.\.\.\(grow \? \{ flex: 1 \} : \{\}\) \}\}>\{children\}<\/div>;/, 'Fields');
  assert.match(src, /gap: 5, \.\.\.\(grow \? \{ flex: 1 \} : \{\}\) \}\}>/, 'Row');
  assert.doesNotMatch(src, /grow \? \{ flex: 1, minHeight: 0 \}/);
  assert.match(src, /<ScheduledJobsList agentId=\{agent\.id\} compact \/>/, 'the jobs list still sits under the work style');
  // The body scrolls instead: Dialog's body is the scroller.
  const dialog = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/Dialog.tsx'), 'utf8');
  assert.match(dialog, /overflowY: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column'/);
});
