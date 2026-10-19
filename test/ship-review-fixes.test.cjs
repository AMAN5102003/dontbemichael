'use strict';

/**
 * Fixes from the /ship pre-landing review of the v2 Studio redesign
 * (2026-10-01). Each pins the line that carries the behavior.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('closing time leaves dialogs open but pauses their keyboard traps; the bar sits above them', () => {
  // Value: protects=quitting with Settings or the hire wizard open shows the bar and loses nothing; fails_when=dialogs close on closing time again, or the trap keeps the keyboard; why_new=review pass 2 found closing dialogs lost hire queues and edits; seam=none
  const dialog = read('src/renderer/src/shell/useDialog.ts');
  assert.match(dialog, /if \(suspended \|\| !ref\.current \|\| stack\[stack\.length - 1\] !== me\) return;/);
  assert.match(read('src/renderer/src/App.tsx'), /useEffect\(\(\) => \{ setDialogsSuspended\(closingOpen\); \}, \[closingOpen\]\);/);
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /zIndex: 650,/);
  assert.match(bar, /regionRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  // On Cancel focus goes back into the dialog it came from (review pass 3).
  assert.match(bar, /return \(\) => \{ if \(before && document\.contains\(before\)\) before\.focus\(\{ preventScroll: true \}\); \};/);
});

test('the task detail is a real dialog: Esc from a field stays in the field, focus trapped', () => {
  // Value: protects=Esc on the status select does not close the card; fails_when=the detail goes back to its own window keydown; why_new=core review; seam=none
  const k = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(k, /useDialog\(dialogRef, onClose\);/);
  assert.match(k, /<div ref=\{dialogRef\} tabIndex=\{-1\} role="dialog"/);
  assert.doesNotMatch(k, /if \(e\.key === 'Escape' && !e\.isComposing\) onClose\(\);/);
});

test('the Done column reads newest first, folded or not', () => {
  // Value: protects=order stays the same when "N more" opens; fails_when=the expanded list goes back to file order; why_new=core review; seam=none
  assert.match(read('src/renderer/src/components/TasksKanban.tsx'), /col\.key === 'done' \? \(showAllDone \|\| filtering \? \[\.\.\.all\]\.reverse\(\) : all\.slice\(-DONE_SHOWN\)\.reverse\(\)\) : byNext\(all\)/, 'Done newest first; open columns by Next (task-board-order.test.cjs)');
});

test('a half written note never saves onto the next person', () => {
  // Value: protects=notes land on the right person; fails_when=NoteRow loses its key; why_new=core review; seam=none
  assert.match(read('src/renderer/src/shell/PanelChrome.tsx'), /<NoteRow key=\{agent\.id\} agent=\{agent\} \/>/);
});

test('the compact grid does not run under the right column, and the stage follows the layout switch', () => {
  // Value: protects=every card visible and clickable with 8+ departments; fails_when=the grid host bleeds again or the observer stays on the old host; why_new=red team; seam=none
  const st = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(st, /<div ref=\{hostRef\} style=\{\{ position: 'absolute', inset: 0 \}\}>/);
  assert.match(st, /\}, \[plan\.compact\]\);/);
});

test('dark mode and focus: readable step numbers and force quit, focus rings on Ask me and the composer', () => {
  // Value: protects=contrast and keyboard focus in dark mode; fails_when=white text returns on ink or coral, or outline none hides focus; why_new=design review; seam=none
  assert.match(read('src/renderer/src/components/OnboardingWizard.tsx'), /color: done \|\| now \? 'var\(--cth-bg\)' : 'var\(--cth-ink-3\)',/);
  assert.match(read('src/renderer/src/components/ClosingTimeBar.tsx'), /background: 'var\(--cth-coral-strong\)', color: 'var\(--cth-on-coral\)'/);
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /style=\{\{ flex: 1, minWidth: 0, cursor: 'pointer' \}\}/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-composer:focus-within \{ box-shadow: inset 0 0 0 2px var\(--cth-indigo\)/);
  assert.match(read('src/renderer/src/shell/BottomBar.tsx'), /if \(isComposingKey\(e\)\) return;\n\s*if \(e\.key === 'Enter' && !e\.shiftKey\)/, 'IME Enter never sends a half typed message');
});

test('top bar buttons speak the app language; the release notes backdrop needs a full click', () => {
  // Value: protects=screen readers in Arabic and Chinese, and no dismiss on a drag; fails_when=English aria or mousedown dismiss return; why_new=core review; seam=none
  const top = read('src/renderer/src/shell/TopBar.tsx');
  assert.doesNotMatch(top, /aria="(Toggle dark mode|Settings|Toggle focus mode)"/);
  assert.match(top, /aria-label=\{label\}/);
  assert.match(read('src/renderer/src/components/ReleaseDrop.tsx'), /\{\.\.\.backdrop\}/);
});

test('a paste attaches a screenshot or Finder files, and leaves text (even with an image) as text', () => {
  // Value: protects=pasting into either composer; fails_when=text pastes get swallowed, screenshots stop attaching, or spreadsheet cells become a picture; why_new=review pass 2: the shared helper had no test; seam=none
  const calls = { saved: 0 };
  globalThis.window = { cth: {
    saveClipboardImage: async () => { calls.saved++; return { ok: true, file: { path: '/tmp/shot.png', name: 'shot.png' } }; },
    pathForFile: (f) => f.path ?? ''
  } };
  const { attachmentsFromPaste } = require('./load-ts.cjs')('src/renderer/src/components/pasteAttachments.ts');
  const ev = (items, files = []) => { const e = { prevented: false, preventDefault() { this.prevented = true; }, clipboardData: { items, files } }; return e; };
  const shot = ev([{ kind: 'file', type: 'image/png' }]);
  const p1 = attachmentsFromPaste(shot);
  assert.ok(p1 && shot.prevented, 'a screenshot is taken');
  const cells = ev([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png' }]);
  assert.equal(attachmentsFromPaste(cells), null, 'cells with an image paste as text');
  assert.equal(cells.prevented, false);
  const text = ev([{ kind: 'string', type: 'text/plain' }]);
  assert.equal(attachmentsFromPaste(text), null);
  const finder = ev([], [{ path: '/Users/x/a.pdf', name: 'a.pdf' }, { name: 'nopath' }]);
  const p2 = attachmentsFromPaste(finder);
  assert.ok(p2 && finder.prevented, 'files with paths attach');
  return Promise.all([p1, p2]).then(([a, b]) => {
    assert.deepEqual(a, [{ path: '/tmp/shot.png', name: 'shot.png' }]);
    assert.deepEqual(b, [{ path: '/Users/x/a.pdf', name: 'a.pdf' }]);
  });
});

test('Closing time in the clock menu quits like Cmd-Q', () => {
  // Value: protects=the menu item never leaves the app windowless in the Dock; fails_when=the IPC is renamed or the menu goes back to window.close(); why_new=review pass 2; seam=none
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('app:requestQuit', \(\) => \{\n\s*app\.quit\(\);/);
  assert.match(read('src/preload/index.ts'), /requestQuit: \(\): Promise<void> => ipcRenderer\.invoke\('app:requestQuit'\),/);
  const top = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(top, /void window\.cth\.requestQuit\(\);/);
  assert.doesNotMatch(top, /^\s*window\.close\(\);/m);
});

test('Settings fields are the v2 input, with its focus ring', () => {
  // Value: protects=Settings inputs match setup and the hire wizard and show focus; fails_when=a field drops the cth-input class or the old cream fill comes back; why_new=review pass 3; seam=none
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  const uses = (modal.match(/style=\{\{?\s*(\.\.\.)?slackInputStyle/g) ?? []).length;
  const ringed = (modal.match(/className="cth-input"\s+style=\{\{?\s*(\.\.\.)?slackInputStyle/g) ?? []).length;
  assert.ok(uses >= 21, 'every Settings field uses the shared style');
  assert.equal(ringed, uses, 'every Settings field carries the cth-input class');
  assert.doesNotMatch(modal, /cth-paper-100[^\n]*\n[^\n]*border: 'none',\n\s*boxShadow: 'inset 0 0 0 1px var\(--cth-ink-100\)'/);
});

test('a saved capability with email on but no mailbox list does not crash the office', () => {
  // Value: protects=the studio renders with a hand-edited or partial config; fails_when=the owner lookup indexes mailboxes without a guard; why_new=adversarial review (local model); seam=none
  for (const f of ['src/renderer/src/scene/studio/StudioStage.tsx', 'src/renderer/src/components/MailboxesSettings.tsx']) {
    assert.match(read(f), /c\.email\?\.enabled && c\.email\.mailboxes\?\.\[0\] === mailboxId/);
  }
});

test('closing time: Cancel always stops it, and the bottom bar keeps its files, with one office window', () => {
  // Value: protects=Closing time from a floor closes only that floor; a quick Cancel stops main; Talk to Michael keeps attachments across a cancelled quit; fails_when=requestQuit compares against the focus-following mainWindow, Cancel waits for a progress event, or BottomBar unmounts while closing; why_new=Codex adversarial review (gpt-5.4); seam=none
  const main = read('src/main/index.ts');
  assert.doesNotMatch(main, /\bfloorWindows\b|\bisFloor\b|window:newFloor/, 'the second window is gone (ship 2026-10-03)');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /if \(closing\?\.phase !== 'error'\) cancelClosingTime\(\);/);
  assert.match(app, /<div style=\{\{ display: closingOpen \|\| barHidden \? 'none' : 'contents' \}\}>\n\s+<BottomBar \/>/);
});
