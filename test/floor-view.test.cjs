'use strict';

/**
 * The floor area toggles between the animated office and the full task board
 * (owner, 2026-09-24): the quickest read of who is doing what, what is blocked
 * and what is done. The choice is remembered on this Mac, the office pauses
 * while the board covers it, and the office whiteboard opens the board.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the office shows by default, and the choice is remembered', () => {
  // freshRun (below) loads the store in its own process, so it really starts
  // from this saved state rather than a module cached by an earlier test.
  const r = freshRun({}, `
    const first = store.getState().floorView;
    store.getState().setFloorView('tasks');
    return { first, now: store.getState().floorView, saved: mem['cth.floorView'] };`);
  assert.deepEqual(r, { first: 'office', now: 'tasks', saved: 'tasks' });
});

// Design v2 (branding/DESIGN.md 7.2): the view switch is the tab group in the
// top bar; the board covers the office and leaves room for the bottom bar.
test('the view tabs sit in the top bar, and the board covers the office above the bottom bar', () => {
  const app = read('src/renderer/src/App.tsx');
  const office = app.indexOf('<StudioStage config={config} bleed={columnShown ? sidebarWidth + 10 : 0} />');
  const board = app.indexOf("{floorView !== 'office' && (");
  const bottom = app.indexOf('<BottomBar />');
  assert.ok(office > 0 && board > office && bottom > board, 'office, then the board over it, then the bottom bar over both');
  assert.match(app.slice(board, board + 700), /position: 'absolute', inset: 0, zIndex: 50,[\s\S]*paddingBottom: barHidden \? 0 : 96,[\s\S]*\{floorView === 'tasks' && <TasksKanban \/>\}/);
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /<ViewTabs \/>/);
  assert.doesNotMatch(app, /<FloorViewToggle \/>/);
});

test('the office pauses while the board covers it, and its whiteboard opens the board', () => {
  const floor = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(floor, /const paused = docHidden \|\| floorView !== 'office' \|\| !!fullscreenAgentId;/);
  assert.match(floor, /onClick=\{\(\) => useStore\.getState\(\)\.setFloorView\('tasks'\)\}/);
});

/**
 * Only Needs you carries a coral count (owner, 2026-10-01): a blocked count on
 * the Tasks tab beside it read as the same thing with a different number
 * (7 blocked, 6 waiting on you). Blocked work shows on the board itself.
 */
test('the Tasks tab carries no count; Needs you is the one number for the owner', () => {
  const src = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(src, /tab\('tasks', t\('floorView\.tasks'\)\)/);
  assert.doesNotMatch(src, /useTaskCounts/);
  assert.doesNotMatch(src, /blockedTitle/);
});

/**
 * GRAPH moved from Michael's panel to the floor too (owner, 2026-09-24): who
 * talks to whom and what they remember needs the room. Clicking an agent in it
 * still opens that agent's memory on Michael's Memory tab.
 */
/** Load the store in its own process, so it really starts from `saved`
 *  (the module cache would otherwise hand every test the first load). */
function freshRun(saved, body) {
  const { execFileSync } = require('node:child_process');
  const script = `
    const mem = ${JSON.stringify(saved)};
    const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    globalThis.localStorage = storage;
    const store = require(${JSON.stringify(path.join(__dirname, 'load-ts.cjs'))})('src/renderer/src/store/store.ts').useStore;
    const out = (() => { ${body} })();
    process.stdout.write(JSON.stringify(out));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
}

test('the floor has a GRAPH view, remembered like the others', () => {
  const r = freshRun({ 'cth.floorView': 'graph' }, `
    const first = store.getState().floorView;
    store.getState().setFloorView('office');
    return { first, saved: mem['cth.floorView'] };`);
  assert.deepEqual(r, { first: 'graph', saved: 'office' });
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /\{floorView === 'graph' && \(\s*<MemoryGraphPanel godId=\{godId\} onJumpToMemory=\{\(id\) => useStore\.getState\(\)\.openAgentMemory\(id\)\} \/>/);
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /tab\('graph', t\('floorView\.graph'\)\)/);
});

test('clicking an agent in the graph opens its memory on Michael\'s panel', () => {
  const r = freshRun({ 'cth.agents': JSON.stringify([{ id: 'god', name: 'Michael', isGod: true }, { id: 'oscar', name: 'Oscar' }]) }, `
    store.getState().select('oscar');
    store.getState().openAgentMemory('oscar');
    const st = store.getState();
    return { selected: st.selectedId, tab: st.ccTabRequest.tab, focus: st.memoryFocusRequest.agentId };`);
  assert.deepEqual(r, { selected: 'god', tab: 'memory', focus: 'oscar' });
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /if \(memoryFocusRequest\) setSelectedMemoryAgent\(memoryFocusRequest\.agentId\);/);
  assert.doesNotMatch(cc, /MemoryGraphPanel|key: 'graph'/);
});

// Design v2: the explanation sits behind an info icon in each view's header
// (fields first, DESIGN.md 2.6), not in a line above it.
test('TASKS and GRAPH explain themselves behind an info icon', () => {
  assert.match(read('src/renderer/src/components/TasksKanban.tsx'), /<InfoTip text=\{t\('floorView\.tasksIntro'\)\} \/>/);
  assert.match(read('src/renderer/src/components/MemoryGraphPanel.tsx'), /<InfoTip text=\{t\('floorView\.graphIntroShort'\)\} \/>/);
  for (const l of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`));
    for (const k of ['tasksIntro', 'graphIntroShort']) assert.ok(j.floorView[k], `${l} ${k}`);
  }
});

test('Tasks and Who talks to whom take the whole window: the right column hides there and opening it goes back to the office', () => {
  // Value: protects=the owner's 2026-10-03 ask (no side column on Tasks or the graph) without losing a person's terminal or a half written reply, and a click that opens the column still shows what was clicked; fails_when=the column shows on Tasks or the graph, is unmounted there, or select, openNeedsYou, openAgentMemory or a Michael tab request leaves the view on Tasks or the graph; why_new=owner ask; seam=source pins
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const app = read('src/renderer/src/App.tsx');
  // A file tab keeps the column beside it (open-file-tab.md, F1); Tasks and the graph still hide it.
  // Pulse hides it like Tasks (owner, 2026-10-15).
  assert.match(app, /const columnView = floorView === 'office' \|\| floorView === 'file';\s*const columnShown = columnOpen && columnView;/);
  assert.match(app, /\{columnShown && \(\n\s+<SidebarSplitter/);
  assert.match(app, /display: columnView \? 'flex' : 'none', flexDirection: 'column'/);
  assert.match(app, /\{\(columnOpen \|\| exiting\) && \(/, 'the column stays mounted while hidden');
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /function officeView\(view: FloorView\): \{ floorView\?: FloorView \} \{\n\s+if \(view === 'office' \|\| view === 'file'\) return \{\};\n\s+try \{ window\.localStorage\.setItem\(LS_FLOOR_VIEW, 'office'\); \}/);
  assert.equal((store.match(/\.\.\.officeView\(s\.floorView\)/g) || []).length, 6, 'select, openAgentMemory, openAgentProfile (Pulse), openNeedsYou and both Michael tab requests');
  // Each also claims the center from the wide 1:1 (wide-dock.test.cjs, 8A).
  assert.match(store, /rightColumn: 'person', centerClaim: 'column', \.\.\.officeView\(s\.floorView\) \};/);
  assert.match(store, /rightColumn: 'board',\n\s+centerClaim: 'column',\n\s+\.\.\.officeView\(s\.floorView\),/);
});
