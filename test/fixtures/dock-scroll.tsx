import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MichaelDock } from '../../src/renderer/src/shell/MichaelDock';
import { useStore } from '../../src/renderer/src/store/store';
import { sendToMichael } from '../../src/renderer/src/shell/ownerSend';
import i18n, { directionFor } from '../../src/renderer/src/i18n';
import type { DockItem, OwnerDock } from '../../src/shared/ownerRequests';
import '../../src/renderer/src/design/tokens.css';
import '../../src/renderer/src/design/global.css';
import '../../src/renderer/src/design/fonts.css';

// The real renderer and store, with only the main-process boundary replaced.
// Nothing is read from an office, written to disk, or sent to an agent.
const at = (n: number) => new Date(Date.now() + n * 1000).toISOString();
const question = (n: number): DockItem => ({ kind: 'owner', id: `q${n}`, conversation: `owner:q${n}`, text: `Question ${n}: What changed in the accounts?`, at: at(n * 2), status: 'answered', unread: false });
const reply = (n: number, notes = false): DockItem => ({ kind: 'michael', id: `r${n}`, replyTo: `q${n}`, act: 'done', text: `Answer ${n}. The invoices are ready to review.\n\nThe account balance agrees with the statement.\n\n${'Details for the owner to read. '.repeat(30)}`, at: at(n * 2 + 1), notes });
const history = () => Array.from({ length: 14 }, (_, n) => [question(n), reply(n)]).flat();
let current = history();
let update: (items: DockItem[]) => void;
let remount: () => void;
let failSend = false;
let fileOpened = false;
let resolveFiles: ((value: unknown) => void) | undefined;
Object.assign(window, { cth: {
  platform: navigator.platform.startsWith('Win') ? 'win32' : navigator.platform.startsWith('Mac') ? 'darwin' : 'linux',
  hiveRegistry: async () => ({ agents: { god: { name: 'Michael' } } }),
  ownerDockVisible: async () => {}, ownerRead: async () => {},
  ownerAsk: async () => {
    if (failSend) return { ok: false };
    const q = question(100);
    current = [...current, q];
    update(current);
    return { ok: true, id: q.id, workOrder: 'Fictional test question' };
  },
  askFiles: () => new Promise((resolve) => { resolveFiles = resolve; }),
  openAskFile: async () => { fileOpened = true; return { ok: true, action: 'external' }; }
} });
useStore.getState().setDock(true);

function Fixture() {
  const [items, setItems] = useState(current);
  const [version, setVersion] = useState(0);
  const composer = useRef<HTMLDivElement>(null);
  update = (next) => { current = next; setItems([...next]); };
  remount = () => setVersion((v) => v + 1);
  const dock: OwnerDock = { items, open: 0, unread: 0, waitingForYou: 0 };
  return <>
    <div style={{ padding: 24 }}>
      <h1>Keep your place</h1>
      <p>Fictional local conversation. Scroll back, then deliver two replies.</p>
      <button onClick={() => reset()}>Reset</button>{' '}
      <button onClick={() => append()}>Deliver two replies</button>{' '}
      <button onClick={() => append(true)}>Deliver notes</button>{' '}
      <button onClick={() => useStore.getState().setDock(true, 'q4')}>Go to question 4</button>{' '}
      <button onClick={() => document.documentElement.dataset.cthTheme = document.documentElement.dataset.cthTheme === 'dark' ? 'light' : 'dark'}>Theme</button>{' '}
      {['en', 'ar', 'zh-CN'].map((lng) => <button key={lng} onClick={() => language(lng)}>{lng}</button>)}
    </div>
    <div ref={composer} style={{ position: 'absolute', bottom: 40, insetInlineStart: 40, width: 400 }}>
      <MichaelDock key={version} dock={dock} refresh={() => {}} godId="god" onFillComposer={(s) => useStore.getState().setDraft('god', s)} onReply={() => {}} composerRef={composer} />
      <textarea aria-label="Test composer" placeholder="Test composer" style={{ width: '100%', height: 50 }} />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

const settle = () => new Promise<void>((r) => setTimeout(r, 80));
const list = () => document.querySelector('.cth-dock > div:nth-child(2)') as HTMLElement;
const jump = () => document.querySelector('[data-dock-jump]') as HTMLButtonElement | null;
const bottom = () => list().scrollHeight - list().clientHeight - list().scrollTop;
function reset() {
  flushSync(() => { useStore.getState().setDock(false); update(history()); remount(); });
  flushSync(() => useStore.getState().setDock(true));
}
function append(notes = false) {
  const n = 20 + current.length;
  flushSync(() => update([...current, { ...reply(n, notes), replyTo: 'q13' }, ...(notes ? [] : [{ ...reply(n + 1), replyTo: 'q13' }])]));
}
async function language(lng: string) {
  await i18n.changeLanguage(lng);
  document.documentElement.dir = directionFor(lng);
}

Object.assign(window, { dockTest: { reset, append, list, bottom, jump, settle, update, language, sendToMichael } });

async function runDockTests() {
  const passed: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const near = (a: number, b: number, message: string) => check(Math.abs(a - b) <= 1, `${message}: ${a} vs ${b}`);
  const pause = async (top = 200) => { list().scrollTop = top; await settle(); };
  const commit = async (next: DockItem[]) => { flushSync(() => update(next)); await settle(); };
  const anchor = () => {
    const top = list().getBoundingClientRect().top;
    const row = [...list().querySelectorAll<HTMLElement>('[data-dock-item]')].find((r) => r.getBoundingClientRect().bottom > top)!;
    return { id: row.dataset.dockItem!, offset: row.getBoundingClientRect().top - top };
  };
  const unchanged = (saved: ReturnType<typeof anchor>, label: string) => {
    const row = list().querySelector<HTMLElement>(`[data-dock-item="${saved.id}"]`)!;
    check(row, `${label}: anchor survives`);
    near(row.getBoundingClientRect().top - list().getBoundingClientRect().top, saved.offset, label);
  };
  const navigate = async (id?: string) => { flushSync(() => useStore.getState().setDock(true, id)); await settle(); };

  reset(); await settle();
  check(bottom() <= 1 && !jump(), 'opening starts at latest without a count');
  append(); await settle();
  check(bottom() <= 1 && !jump(), 'bottom follows incoming replies');
  passed.push('open and follow at bottom');

  await pause();
  const reading = anchor();
  const viewportHeight = list().clientHeight;
  const composer = document.querySelector('textarea')!;
  composer.focus();
  append(); await settle();
  unchanged(reading, 'two replies preserve the passage');
  check(jump()?.textContent?.includes('2 new replies'), `two distinct arrivals are counted: ${jump()?.textContent}, bottom=${bottom()}`);
  check(document.querySelector('[aria-live]')?.textContent === '2 new replies', 'arrivals use one polite announcement');
  check(document.activeElement === composer, 'arrivals preserve composer focus');
  check(list().clientHeight === viewportHeight, 'jump control reserves space');
  await commit([...current]);
  check(jump()?.textContent?.includes('2 new replies'), 'duplicate polling does not count twice');
  await commit(current.map((it) => it.kind === 'owner' ? { ...it, status: 'couldnt-finish' as const } : it));
  unchanged(reading, 'status reflow preserves the passage');
  check(jump()?.textContent?.includes('2 new replies'), 'status edits do not count');
  jump()!.click(); await settle();
  check(bottom() <= 1 && !jump(), 'jump clears count and resumes following');
  check(document.querySelector('[aria-live]')?.textContent === '', 'catch-up does not replay a stale announcement');
  append(); await settle();
  check(bottom() <= 1 && !jump(), 'following remains enabled after jump');
  passed.push('reading anchor, counts, polling, status, focus and jump');

  await pause(); append(); await settle();
  list().scrollTop = list().scrollHeight; await settle();
  check(!jump(), 'manual catch-up clears count');
  append(); await settle(); check(bottom() <= 1 && !jump(), 'manual catch-up resumes following');
  await pause(); append(true); await settle();
  check(jump()?.textContent?.includes('Jump to latest'), 'notes have no invented reply count');
  await commit(current.slice(0, -1));
  check(!jump(), 'removing arrivals clears stale count');
  passed.push('manual catch-up, notes and removal');

  await navigate('q4');
  await pause(500); const targeted = anchor();
  append(); await settle(); unchanged(targeted, 'retained target is not recentered');
  await navigate('q4');
  const q4 = list().querySelector<HTMLElement>('[data-q="q4"]')!;
  near(q4.getBoundingClientRect().top - list().getBoundingClientRect().top + q4.offsetHeight / 2, list().clientHeight / 2, 'same target explicitly navigates again');
  check(!jump(), 'explicit navigation clears arrival count');
  passed.push('one-time and repeated explicit navigation');

  reset(); await settle(); await pause(800);
  const beforeEarlier = anchor();
  const oldQ = { ...question(-1), at: new Date(Date.now() - 40 * 86400000).toISOString() };
  const oldR = { ...reply(-1), at: oldQ.at };
  await commit([oldQ, oldR, ...current]);
  unchanged(beforeEarlier, 'hidden old history does not move reading');
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Earlier')!.click(); await settle();
  unchanged(beforeEarlier, 'Earlier prepends preserve reading');
  check(!jump(), 'old history is not a new reply');
  await navigate('q-1');
  check(list().scrollTop < 80, 'old question can be targeted');
  // A quoted answer after another exchange navigates through the same path.
  await commit([...current, { ...reply(101), replyTo: 'q4' }]);
  await navigate();
  const quote = list().querySelector('[data-dock-item="r101"] button') as HTMLButtonElement;
  check(quote, 'quote is rendered'); quote.click(); await settle();
  await pause(600); const afterQuote = anchor(); append(); await settle();
  unchanged(afterQuote, 'quote navigation is consumed once');
  passed.push('Earlier, hidden question and quote navigation');

  reset(); await settle();
  await commit([oldQ, oldR, ...current]);
  check(!list().querySelector('[data-q="q-1"]'), 'target starts hidden');
  await navigate('q-1');
  check(list().querySelector('[data-q="q-1"]') && list().scrollTop < 80, 'explicit navigation reveals hidden history');
  await navigate('missing-question');
  check(bottom() <= 1, 'missing question falls back to latest');
  passed.push('hidden and missing navigation targets');

  reset(); await settle();
  const foldedReply = { ...reply(300), replyTo: oldQ.id };
  await commit([oldQ, oldR, ...current, foldedReply]);
  await pause(); const beforeReveal = anchor();
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Earlier')!.click(); await settle();
  unchanged(beforeReveal, 'revealing a folded exchange preserves reading');
  check(!jump(), 'an existing reply in a folded exchange is not a new arrival');
  passed.push('folded exchange arrival baseline');

  reset(); await settle(); await navigate('q200'); await pause(); append(); await settle();
  jump()!.click(); await settle();
  await commit([question(200), ...current]);
  check(bottom() <= 1 && !jump(), 'catch-up cancels an unresolved question target');
  passed.push('catch-up supersedes pending navigation');

  reset(); await settle(); await pause(); const beforeDelayedReply = anchor();
  const delayedReply = { ...reply(400), replyTo: 'q11', at: at(23) };
  await commit([...current.slice(0, 24), delayedReply, ...current.slice(24)]);
  unchanged(beforeDelayedReply, 'a delayed reply below the reader preserves reading');
  check(jump()?.textContent?.includes('1 new reply'), 'arrival IDs count even when their timestamps precede the latest reply');
  passed.push('delayed arrival below the reader');

  reset(); await settle(); await pause(350);
  const beforeMore = anchor();
  const more = list().querySelector(`[data-dock-item="${beforeMore.id}"] button`) as HTMLButtonElement;
  check(more?.textContent === 'More', 'visible reply can expand');
  more.click(); await settle(); unchanged(beforeMore, 'More preserves the reply text');
  await navigate(); const lastReply = list().querySelector('[data-dock-item="r13"] button') as HTMLButtonElement;
  const beforeLastMore = anchor();
  lastReply.click(); await settle(); unchanged(beforeLastMore, 'More at bottom keeps the text being read visible');
  check(bottom() > 32, 'More pauses following for reading');
  await pause(800); const beforeResize = anchor();
  document.querySelector<HTMLElement>('.cth-dock')!.style.maxHeight = '300px'; await settle();
  unchanged(beforeResize, 'viewport resize preserves reading');
  // Child-only layout change exercises ResizeObserver without a dock rerender.
  (list().querySelector('[data-dock-item="r0"]') as HTMLElement).style.minHeight = '350px'; await settle();
  unchanged(beforeResize, 'late child layout preserves reading');
  passed.push('More, viewport resize and asynchronous child layout');

  reset(); await settle(); await pause();
  const removedAnchor = anchor();
  const nextRow = [...list().querySelectorAll<HTMLElement>('[data-dock-item]')].find((r) => r.dataset.dockItem !== removedAnchor.id && r.getBoundingClientRect().top > list().getBoundingClientRect().top)!;
  const neighbour = { id: nextRow.dataset.dockItem!, offset: nextRow.getBoundingClientRect().top - list().getBoundingClientRect().top };
  await commit(current.filter((it) => it.id !== removedAnchor.id));
  unchanged(neighbour, 'removing visible anchor preserves a surviving neighbour');
  passed.push('visible anchor removal');

  reset(); await settle(); await pause();
  const beforeSend = anchor(); failSend = true;
  useStore.getState().setDraft('god', 'Keep this draft');
  composer.value = 'Keep this draft';
  check(await sendToMichael('god', 'Keep this draft', []) === false, 'send failure is reported');
  await settle(); unchanged(beforeSend, 'failed send preserves viewport');
  check(useStore.getState().drafts.god === 'Keep this draft', 'failed send preserves draft');
  failSend = false;
  check(await sendToMichael('god', 'New owner question', []) === true, 'send succeeds');
  await settle(); check(bottom() <= 1 && !jump(), 'successful send navigates to new owner message');
  // The send target may arrive in a later poll than setDock.
  await navigate('q200'); await pause(400);
  await commit([...current, question(200)]);
  check(bottom() <= 1, 'pending send target is applied when it arrives');
  passed.push('send success, failure and delayed target');

  reset(); await settle(); await pause(); append(); await settle();
  flushSync(() => useStore.getState().setDock(false));
  flushSync(() => useStore.getState().setDock(true)); await settle();
  check(bottom() <= 1 && !jump(), 'reopening starts at latest');
  flushSync(() => useStore.getState().setDock(false));
  await commit([]);
  flushSync(() => useStore.getState().setDock(true)); await settle();
  check(document.querySelector('.cth-dock') && !jump(), 'empty dock renders');
  await commit(history()); check(bottom() <= 1 && !jump(), 'delayed first history is baseline');
  passed.push('reopen, empty and initial history');

  document.querySelector('.cth-dock')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check(!document.querySelector('.cth-dock') && document.activeElement === composer, 'Escape closes and returns composer focus');
  reset(); await settle();
  passed.push('Escape and composer focus');

  reset(); await settle(); await pause();
  const beforeFiles = anchor();
  const file = list().querySelector('[data-dock-item="r0"]');
  await commit(current.map((it) => it.id === 'r0' ? { ...it, text: 'Saved as /tmp/accounts.csv.' } : it));
  resolveFiles?.([{ verdict: 'open', tab: false, path: '/tmp/accounts.csv' }]); await settle();
  unchanged(beforeFiles, 'file verdict preserves reading');
  const fileButton = file!.querySelector('button') as HTMLButtonElement;
  check(fileButton, 'existing file chip is retained'); fileButton.click(); await settle();
  check(fileOpened, 'file opening still reaches main boundary');
  passed.push('file verdict and file opening');

  for (const lng of ['en', 'zh-CN', 'ar']) {
    await language(lng);
    for (const count of [1, 2, 3, 11, 100]) check(!i18n.t('dock.newReplies', { count }).includes('dock.'), `${lng} plural category resolves`);
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.cthTheme = theme;
      reset(); await settle(); await pause(); append(); await settle();
      check(jump()?.textContent?.includes(i18n.t('dock.newReplies', { count: 2 })), `${lng} ${theme} localized count`);
      check(!jump()?.textContent?.includes('dock.'), 'no untranslated key');
      check(jump()!.getBoundingClientRect().width < 380, 'localized button fits');
      jump()!.focus();
      check(document.activeElement === jump(), 'button is focusable');
      jump()!.click(); await settle(); check(bottom() <= 1, `${lng} ${theme} jump`);
    }
  }
  await language('en'); document.documentElement.dataset.cthTheme = 'light';
  reset(); await settle(); await pause(); append(); await settle();
  passed.push('all locales, RTL, both themes and focus ring');
  return passed;
}
Object.assign(window, { runDockTests });
