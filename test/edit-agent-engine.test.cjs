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
test('Edit agent changes only name, role, job and engine; never the character or color', () => {
  // Value: protects=a hired team member keeps who they are; fails_when=the cast grid or swatches come back, or save writes character or accent; why_new=nothing checked what the dialog offers; seam=none
  assert.doesNotMatch(src, /OFFICE_CAST|SpritePortrait|setCharacter|ACCENTS|setAccent/);
  const save = src.slice(src.indexOf('const save = async'));
  const patch = save.slice(save.indexOf('updateAgent(agent.id, {'), save.indexOf('});', save.indexOf('updateAgent(agent.id, {')));
  assert.doesNotMatch(patch, /character|accent/);
  assert.match(patch, /provider,\s*model,\s*command,\s*description: trimmedDescription\s*$/);
});

test('groups on soft panels, field labels only: who, the job, the scheduled jobs, then the engine (owner, 2026-10-23, mockup 2B)', () => {
  // Value: protects=H1 and H2, groups read as shapes with no headings (D3 kept); fails_when=a heading comes back, a panel gains a border or shadow, or the order changes; why_new=edit-agent-hierarchy.md H1 (2B); seam=none; no_claim=source pin, not rendered
  assert.doesNotMatch(src, /width=\{940\}|<Section|<h3|hint="/);
  // Only the wide panel has two columns (wide panel WD2).
  assert.equal((src.match(/gridTemplateColumns/g) ?? []).length, 1);
  assert.match(src, /<div style=\{wide\s*\? \{ display: 'grid', gridTemplateColumns: 'minmax\(300px, 360px\) minmax\(0, 720px\)', justifyContent: 'center'/);
  assert.match(src, /function Panel\(\{ id, children \}[^\n]*\n\s*return <SoftPanel id=\{`edit-agent-\$\{id\}`\}>\{children\}<\/SoftPanel>;/, 'the shared soft panel (fieldText)');
  const ramp = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/fieldText.tsx'), 'utf8');
  const panel = ramp.slice(ramp.indexOf('export const panelStyle'), ramp.indexOf('export function Panel('));
  assert.match(panel, /padding: '14px 16px', borderRadius: 'var\(--cth-r-xl\)', background: 'var\(--cth-bg\)'/);
  assert.doesNotMatch(panel, /boxShadow|border:/, 'no border or shadow');
  // One column: who, the job, then the jobs and the engine (agent-role-fields.test.cjs pins each column).
  const side = src.slice(src.indexOf('<div key="job"'));
  const at = (s) => side.indexOf(s);
  assert.ok(at('<Panel id="job">') > 0 && at('<Panel id="job">') < at('<div key="more"') && at('<div key="more"') < at('<Panel id="schedules">') && at('<Panel id="schedules">') < at('{engine}'));
});

// Owner, 2026-10-02: fold the engine away so what they handle and the work
// style get the room.
test('the engine is one folded line, closed by default, naming the provider and model', () => {
  // Value: protects=the job text keeps the space; fails_when=the engine opens by default, loses its toggle, or the folded line stops saying what it runs on; why_new=new fold; seam=none
  assert.match(src, /const \[engineOpen, setEngineOpen\] = useState\(openEngine\);/);
  // Closed by default; only Change engine on a not reporting card opens it (issue #326).
  assert.match(src, /engineOpen: openEngine = false \}: EditAgentModalProps/);
  assert.match(src, /aria-expanded=\{engineOpen\}\s*aria-controls=\{engineOpen \? 'edit-agent-engine' : undefined\}/, 'never points at a folded, unmounted group');
  assert.match(src, /\{engineOpen && \(\s*<Fields id="engine">/);
  assert.match(src, /\{modelLabel \? `\$\{providerLabel\}, \$\{modelLabel\}` : providerLabel\}/);
  assert.match(src, /<JobParts plain=\{plain\} wide=\{wide\} folded=\{!showAll\} \/>/, 'the job folds to its first part (H4)');
});

test('Edit agent takes the window\'s full height over the panel it edits (owner, 2026-10-02)', () => {
  // Value: protects=the dialog lays exactly over the panel, the full window high; fails_when=the dialog sizes to its content again or leaves the panel; why_new=new fill option; seam=none
  assert.match(src, /width=\{640\}\s*fill\s*align="end"\s*over=\{docked \? panelBehind : undefined\}\s*zIndex=\{500\}/, 'exactly over the panel it edits (owner, 2026-10-02); the fullscreen view has none');
  assert.match(src, /document\.querySelector<HTMLElement>\('\[data-right-column\] \[data-panel-card\]'\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/PanelChrome.tsx'), 'utf8'), /<div data-panel-card style=/);
  const dialog = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/Dialog.tsx'), 'utf8');
  assert.match(dialog, /justifyContent: align === 'end' \? 'flex-end' : 'center'/);
  assert.match(dialog, /\? \{ position: 'fixed', left: box\.left, top: box\.top, width: box\.width, height: box\.height \}/, 'over: the panel\'s exact box');
  assert.match(dialog, /maxHeight: fill \? 'calc\(100vh - 32px\)' : '88vh', \.\.\.\(fill \? \{ height: 'calc\(100vh - 32px\)' \} : \{\}\)/);
});

test('the job reads in place and the body scrolls: no typed job box to grow (work-style-change-request.md)', () => {
  // Value: protects=the scheduled jobs sit under the job and nothing overlaps; fails_when=a typed Work style box or a grow chain returns; why_new=the job became read only; seam=none
  assert.doesNotMatch(src, /<textarea/);
  assert.doesNotMatch(src, /grow \? \{ flex: 1/);
  assert.match(src, /<ScheduledJobsList agentId=\{agent\.id\} name=\{who\} onChange=\{goToSchedules\} \/>/, 'the jobs list is its own group (SJ2, H1)');
  const dialog = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/Dialog.tsx'), 'utf8');
  assert.match(dialog, /overflowY: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column'/);
});
