'use strict';

/**
 * The wide panel (design review 2026-10-16, WD1 to WD13, and its eng review):
 * a person's or Michael's panel, and Edit agent over it, open wide in the
 * center of the window; leaving Edit with unsaved changes asks first, by any
 * way out. The leave guard and the Esc rule run here; the layout is pinned in
 * source, since the renderer has no DOM harness (live checks cover the look).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const guard = loadTs('src/renderer/src/store/leaveGuard.ts');
const toBoard = { selectedId: 'ryan', rightColumn: 'board' };

/** A guard like Edit's: holds while `dirty` and the change takes Ryan's panel away. */
function editGuard(state) {
  return guard.setLeaveGuard({
    holds: (next) => state.dirty && (next.rightColumn !== 'person' || next.selectedId !== 'ryan'),
    ask: () => { state.asked += 1; }
  });
}

test('with nothing to lose, every change applies at once', () => {
  // Value: protects=panels open and close as today when Edit is shut or unchanged; fails_when=a change waits with no guard or a clean guard; why_new=the guard is new; seam=none
  const done = [];
  assert.equal(guard.attemptLeave(toBoard, () => done.push('a')), true);
  const state = { dirty: false, asked: 0 };
  const release = editGuard(state);
  assert.equal(guard.attemptLeave(toBoard, () => done.push('b')), true);
  state.dirty = true;
  assert.equal(guard.attemptLeave({ selectedId: 'ryan', rightColumn: 'person' }, () => done.push('c')), true, 'a tab change on the same panel keeps Edit');
  assert.equal(guard.attemptLeave(null, () => done.push('d')), true, 'a change that moves nothing');
  release();
  assert.deepEqual(done, ['a', 'b', 'c', 'd']);
  assert.equal(state.asked, 0);
});

test('unsaved changes hold a change of panel; Keep editing drops it, and a two call move waits as one', () => {
  // Value: protects=the owner's writing in Edit is never lost to the pill, the strip, another person or a menu item; fails_when=a change applies under the question, the question shows twice, or Keep editing leaves half a move; why_new=WD4 and outside voice 1, 2; seam=none
  const state = { dirty: true, asked: 0 };
  const release = editGuard(state);
  const done = [];
  assert.equal(guard.attemptLeave({ selectedId: 'michael', rightColumn: 'person' }, () => done.push('select michael')), false);
  assert.equal(guard.attemptLeave({ selectedId: 'michael', rightColumn: 'person' }, () => done.push('schedule tab')), false, 'the second call of the same click waits behind the first');
  assert.equal(state.asked, 1, 'asked once');
  assert.equal(guard.leaveWaiting(), true);
  guard.answerLeave(false);
  assert.deepEqual(done, []);
  assert.equal(guard.leaveWaiting(), false);
  // Still guarded after Keep editing.
  assert.equal(guard.attemptLeave(toBoard, () => done.push('board')), false);
  assert.equal(state.asked, 2);
  guard.answerLeave(false);
  release();
});

test('Discard runs every waiting change in order, and focus moves only after them', () => {
  // Value: protects=after Discard the owner lands where they clicked, with focus there; fails_when=changes replay out of order, focus jumps under the question, or the guard keeps holding; why_new=outside voice 2, 3; seam=none
  const state = { dirty: true, asked: 0 };
  const release = editGuard(state);
  const done = [];
  guard.attemptLeave({ selectedId: 'michael', rightColumn: 'person' }, () => done.push('select'));
  guard.attemptLeave({ selectedId: 'michael', rightColumn: 'person' }, () => done.push('tab'));
  guard.afterLeave(() => done.push('focus'));
  assert.deepEqual(done, []);
  guard.answerLeave(true);
  assert.deepEqual(done, ['select', 'tab', 'focus']);
  assert.equal(guard.attemptLeave(toBoard, () => done.push('next')), true, 'the guard is gone after Discard');
  release();
  guard.afterLeave(() => done.push('now'));
  assert.equal(done.at(-1), 'now', 'with nothing waiting, focus moves at once');
});

test('Edit going away some other way lets what waited run; an old guard never clears a newer one', () => {
  // Value: protects=a change is never stuck behind a dialog that is gone; fails_when=releasing leaves the line full, or a closing Edit removes the next one's guard; why_new=new; seam=none
  const a = { dirty: true, asked: 0 };
  const releaseA = editGuard(a);
  const done = [];
  guard.attemptLeave(toBoard, () => done.push('board'));
  releaseA();
  assert.deepEqual(done, ['board']);
  const b = { dirty: true, asked: 0 };
  const releaseB = editGuard(b);
  releaseA();
  assert.equal(guard.attemptLeave(toBoard, () => done.push('again')), false, 'B still guards');
  guard.answerLeave(false);
  releaseB();
});

test('every store action that changes the panel asks the guard first', () => {
  // Value: protects=no way round the discard question; fails_when=one of the six actions sets the panel directly again; why_new=outside voice 1: openNeedsYou and three others bypassed select and setRightColumn; seam=source pin
  const all = read('src/renderer/src/store/store.ts');
  const store = all.slice(all.indexOf('export const useStore = create<State>('));
  for (const action of ['openAgentProfile', 'openAgentMemory', 'requestCommandCenterTab', 'select', 'setRightColumn', 'openNeedsYou']) {
    const at = store.indexOf(`  ${action}: (`);
    assert.ok(at > 0, action);
    const body = store.slice(at, at + 400);
    assert.match(body, /attemptLeave\(/, `${action} goes through the guard`);
  }
  assert.doesNotMatch(store, /useStore\.setState\(\{[^}]*rightColumn/, 'nothing sets the column behind the store\'s back');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /afterLeave\(\(\) => document\.querySelector<HTMLElement>\('\[data-closing-bar\]'\)\?\.focus/, 'the closing bar takes focus only once the panel closed');
  assert.match(read('src/renderer/src/shell/rightColumn.ts'), /afterLeave\(\(\) => document\.getElementById\(NEEDS_YOU_PILL_ID\)\?\.focus\(\)\)/);
});

test('Esc: a field with text is left first, then a wide panel goes back to the side, then the column closes', () => {
  // Value: protects=a half written reply and the owner's place; fails_when=Esc closes a wide panel, collapses before leaving a field, or collapses while asks wait and does nothing instead; why_new=WD13 and outside voice 5; seam=none
  const { columnEscAction } = loadTs('src/renderer/src/shell/rightColumn.ts');
  const base = { key: 'Escape', defaultPrevented: false, inColumn: true, fieldHasText: false, locked: false, wide: true };
  assert.equal(columnEscAction({ ...base, fieldHasText: true }), 'blur');
  assert.equal(columnEscAction(base), 'collapse');
  assert.equal(columnEscAction({ ...base, locked: true }), 'collapse', 'asks waiting never keep it wide');
  assert.equal(columnEscAction({ ...base, wide: false }), 'close');
  assert.equal(columnEscAction({ ...base, inColumn: false }), 'none');
  assert.equal(columnEscAction({ ...base, defaultPrevented: true }), 'none', 'the terminal keeps its Esc');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /if \(action === 'collapse'\) \{ useStore\.getState\(\)\.setPanelWide\(false\); return; \}/);
});

test('the wide choice is remembered on this computer, never set by the window, and the board never goes wide', () => {
  // Value: protects=WD6 and WD1; fails_when=the flag is lost on restart, throws without storage, follows the window size, or widens Needs you; why_new=new flag; seam=source pin
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /const LS_PANEL_WIDE = 'cth\.panelWide';/);
  assert.match(store, /try \{ return window\.localStorage\.getItem\(LS_PANEL_WIDE\) === '1'; \} catch \{ return false; \}/);
  assert.match(store, /try \{ window\.localStorage\.setItem\(LS_PANEL_WIDE, on \? '1' : '0'\); \} catch \{ \/\* noop \*\/ \}/);
  const app = read('src/renderer/src/App.tsx');
  // The wide 1:1 takes the center from a panel when opened last (8A, wide-dock.test.cjs).
  assert.match(app, /const wide = panelCentered\(\{ panelWide, panelOpen: columnShown && rightColumn === 'person' && !!agent, dockCentered: dockWide \}\);/);
  assert.doesNotMatch(app, /innerWidth[^\n]*setPanelWide|setPanelWide\(window/);
});

test('wide, the column keeps its slot so the office never reflows, and the office dims under the top bar', () => {
  // Value: protects=the office behind stays put and the coral pill stays live (WD8); fails_when=the slot or the bleed changes, the dimming covers the top bar, or the office stays reachable by Tab; why_new=eng 2 and WD13; seam=source pin
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /<StudioStage config=\{config\} bleed=\{columnShown \? sidebarWidth \+ 10 : 0\} \/>/, 'bleed unchanged');
  assert.match(app, /\{wide && <div aria-hidden style=\{\{ width: sidebarWidth \+ 6, flexShrink: 0 \}\} \/>\}/, 'the slot');
  assert.match(app, /\? \{ position: 'absolute', top: 12, bottom: 12, left: '10%', right: '10%', margin: 0 \}/, '10% in from each side');
  assert.match(app, /\{\(wide \|\| dockWide\) && <div aria-hidden className="cth-wide-scrim" style=\{\{ position: 'absolute', inset: 0, zIndex: 190/, 'inside the row under the top bar');
  assert.match(app, /stageRef\.current\?\.toggleAttribute\('inert', wide \|\| dockWide\)/);
  assert.match(app, /data-wide-panel=\{wide \|\| undefined\}/);
  const css = read('src/renderer/src/design/global.css');
  assert.match(css, /\[data-wide-panel\] \[data-panel-body\]:not\(\[data-tab="terminal"\]\) > \* \{ padding-inline: max\(16px, calc\(\(100% - 720px\) \/ 2\)\) !important; \}/, 'text at most 720 px, the terminal full width (WD2, WD5)');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.cth-wide-scrim \{ animation: none; \} \}/);
  for (const f of ['src/renderer/src/components/AgentDetailPanel.tsx', 'src/renderer/src/components/CommandCenterPanel.tsx']) {
    assert.match(read(f), /data-panel-body data-tab=\{/, f);
  }
});

test('the move animates a transform only, snaps with reduced motion, and the dialog over it follows', () => {
  // Value: protects=WD9 and eng 1, Edit never left at the side box; fails_when=the move animates layout, runs with reduced motion, or Dialog stops following the panel; why_new=new motion; seam=source pin, motion is a live check
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/);
  assert.match(app, /el\.style\.transition = `transform \$\{PANEL_MOVE_MS\}ms var\(--cth-ease\)`;/);
  assert.match(app, /window\.dispatchEvent\(new CustomEvent\(PANEL_MOVE_EVENT, \{ detail: \{ ms: PANEL_MOVE_MS \} \}\)\);/);
  // The move's length is the slow motion token's, so Dialog follows the real move.
  const ms = Number(/export const PANEL_MOVE_MS = (\d+);/.exec(read('src/renderer/src/shell/Dialog.tsx'))?.[1]);
  assert.equal(`${ms}ms`, /--cth-dur-slow: (\d+ms);/.exec(read('src/renderer/src/design/tokens.css'))?.[1]);
  assert.match(app, /const keep = \(\): void => \{ columnBox\.current = \{ l: el\.offsetLeft/, 'boxes read without transforms, so a resize never animates');
  const dialog = read('src/renderer/src/shell/Dialog.tsx');
  assert.match(dialog, /window\.addEventListener\(PANEL_MOVE_EVENT, onMove\);/);
  assert.match(dialog, /export const PANEL_MOVE_EVENT = 'cth:panel-move';/);
});

test('Edit agent: wide in two columns with who it is in the title, the question on every way out, and none from fullscreen', () => {
  // Value: protects=WD2, WD3, WD4 and outside voice 4; fails_when=wide Edit loses its title or grid, a close skips the question, the margins close it, or the fullscreen view gets a wide button; why_new=new; seam=source pin
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(src, /const \[inColumn\] = useState\(\(\) => docked && !!panelBehind\(\)\);/);
  assert.match(src, /holds: \(next\) => dirtyRef\.current && \(next\.rightColumn !== 'person' \|\| next\.selectedId !== agent\.id\)/);
  assert.match(src, /const requestClose = \(\): void => \{ if \(dirtyRef\.current\) setAsking\('close'\); else onClose\(\); \};/);
  assert.match(src, /onClose=\{requestClose\}/, '✕ and Esc ask');
  assert.match(src, /<PixelButton variant="ghost" size="md" onClick=\{requestClose\}>\{t\('editAgent\.cancel'\)\}/, 'Cancel asks');
  assert.match(src, /below=\{wide\}\s*dim=\{!wide\}/, 'wide: under the top bar, margins never close');
  assert.match(src, /actions=\{inColumn \? <WideButton disabled=\{busy\} size=\{30\} \/> : undefined\}/, 'busy disables the switch too');
  assert.match(src, /t\('editAgent\.titleWide', \{ name: agent\.name \}\)/);
  assert.match(src, /<PersonAvatar who=\{agent\} size=\{28\} \/>/);
  assert.match(src, /<PixelButton variant="primary" size="md" onClick=\{keepEditing\} autoFocus>\{t\('editAgent\.keepEditing'\)\}/, 'Keep editing is the default');
  assert.match(src, /const discard = \(\): void => \{ const leaving = asking === 'leave'; setAsking\(null\); onClose\(\); if \(leaving\) answerLeave\(true\); \};/);
  assert.match(src, /readText: CSSProperties = wide \? \{ fontSize: 14, lineHeight: '22px' \} : \{\}/, 't-read in wide panels (WD11)');
  assert.equal((src.match(/dir="auto"/g) ?? []).length, 4, 'every text box (WD13)');
  assert.match(read('src/renderer/src/components/FullscreenTerminal.tsx'), /<EditAgentModal agent=\{agent\} onClose=\{\(\) => setEditAgentOpen\(false\)\} docked=\{false\} \/>/);
  assert.match(read('src/renderer/src/shell/PanelChrome.tsx'), /<WideButton \/>\s*<button onClick=\{\(\) => \{ const f = getNeedsYouFeed\(\);/, 'beside close on every panel header');
});

test('the wide panel strings exist in every language, with no dashes', () => {
  // Value: protects=the button and the question read in every language; fails_when=a key is missing or uses a dash (owner rule); why_new=new strings; seam=none
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const v of [j.panel.openWide, j.panel.backToSide, j.editAgent.titleWide, j.editAgent.discardTitle, j.editAgent.keepEditing, j.editAgent.discard]) {
      assert.equal(typeof v, 'string', loc);
      assert.doesNotMatch(v, /[–—]| - /, `${loc}: ${v}`);
    }
    assert.match(j.editAgent.titleWide, /\{\{name\}\}/);
    assert.match(j.editAgent.discardTitle, /\{\{name\}\}/);
  }
});

test('a focus move waits with the panel change: Keep editing drops both, a released guard runs both in order', () => {
  // Value: protects=focus never leaves Edit for a panel that did not open, and follows one that did; fails_when=afterLeave runs past a held change or is kept after Keep editing; why_new=state machine review, two untested cells (ship review 2026-10-17); seam=none
  const state = { dirty: true, asked: 0 };
  let release = editGuard(state);
  const done = [];
  guard.attemptLeave(toBoard, () => done.push('board'));
  guard.afterLeave(() => done.push('focus'));
  guard.answerLeave(false);
  assert.deepEqual(done, [], 'Keep editing drops the focus move too');
  guard.afterLeave(() => done.push('later'));
  assert.deepEqual(done, ['later'], 'with nothing waiting, it runs at once');
  release();
  done.length = 0;
  release = editGuard(state);
  guard.attemptLeave(toBoard, () => done.push('board'));
  guard.afterLeave(() => done.push('focus'));
  release();
  assert.deepEqual(done, ['board', 'focus']);
});

test('Change engine\'s Edit request waits with the select and is used once', () => {
  // Value: protects=Keep editing never leaves an Edit request that opens later by itself, and a request opens Edit once; fails_when=requestEditAgent sets the request outside the guarded path, or the panel never clears it; why_new=maintainability and state machine reviews (ship review 2026-10-17); seam=source pin, the store needs a window
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /requestEditAgent: \(agentId, opts\) => \{\n\s*get\(\)\.select\(agentId\);\n(\s*\/\/[^\n]*\n)*\s*afterLeave\(\(\) => set\(\(s\) => \(\{ editAgentRequest: \{ agentId, engine: !!opts\?\.engine/);
  assert.match(store, /clearEditAgentRequest: \(\) => set\(\{ editAgentRequest: null \}\),/);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /setEditEngine\(editRequest\.engine\); setEditOpen\(true\); clearEditRequest\(\); \}/);
});
