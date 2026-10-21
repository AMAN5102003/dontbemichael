/**
 * File tabs (docs/designs/open-file-tab.md, R4): a file Michael or an Ask me
 * card names opens as a tab after Who talks to whom. One tab per file, keyed by
 * the path main says it really lands on, so two spellings share a tab; at most
 * five, a sixth closes the one opened longest ago; never saved, so the app
 * restarts on the last fixed view. Pure, so the rules test without a window.
 */
import type { AskFileKind } from '@shared/askFiles';

export const MAX_FILE_TABS = 5;

export interface FileTab {
  /** The canonical path from main: the tab's key. */
  id: string;
  /** The name shown: the file name without folder or extension. */
  title: string;
  kind: AskFileKind;
  /** Who raised the question or reply, which decides the folders searched. */
  who: { raisedBy?: string; assignee?: string };
  openedAt: number;
}

export type FixedView = 'office' | 'tasks' | 'pulse' | 'graph';

export interface FileTabState {
  fileTabs: FileTab[];
  activeFileTab: string | null;
}

/** Open (or select) a file's tab. A sixth tab closes the oldest one that is not
 *  the one being opened. */
export function openTab(s: FileTabState, tab: FileTab): FileTabState {
  if (s.fileTabs.some((f) => f.id === tab.id)) return { fileTabs: s.fileTabs, activeFileTab: tab.id };
  let tabs = [...s.fileTabs, tab];
  while (tabs.length > MAX_FILE_TABS) {
    const oldest = tabs.filter((f) => f.id !== tab.id).reduce((a, b) => (b.openedAt < a.openedAt ? b : a));
    tabs = tabs.filter((f) => f !== oldest);
  }
  return { fileTabs: tabs, activeFileTab: tab.id };
}

/** Close a tab. Closing the selected one selects the file tab to its left, or,
 *  for the first file tab, the view the owner opened files from. */
export function closeTab(s: FileTabState, id: string): FileTabState & { select: 'file' | null } {
  const i = s.fileTabs.findIndex((f) => f.id === id);
  if (i < 0) return { ...s, select: null };
  const tabs = s.fileTabs.filter((f) => f.id !== id);
  if (s.activeFileTab !== id) return { fileTabs: tabs, activeFileTab: s.activeFileTab, select: null };
  const left = i > 0 ? tabs[i - 1] : null;
  return left
    ? { fileTabs: tabs, activeFileTab: left.id, select: 'file' }
    : { fileTabs: tabs, activeFileTab: null, select: null };
}
