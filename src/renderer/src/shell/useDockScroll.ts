import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { DockItem } from '@shared/ownerRequests';

const BOTTOM_SLOP = 32;
type Anchor = { id: string; offset: number };
type Position = { top: number; anchors: Anchor[] };

const atBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_SLOP;
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-dock-item]'));

function capture(el: HTMLElement): Position {
  const top = el.getBoundingClientRect().top;
  // Keep visible neighbours too, so removing the first visible item still
  // leaves a surviving passage at its old offset.
  const anchors = rows(el).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > top && rect.top < top + el.clientHeight;
  }).map((row) => ({ id: row.dataset.dockItem!, offset: row.getBoundingClientRect().top - top }));
  return { top: el.scrollTop, anchors };
}

function restore(el: HTMLElement, position: Position): void {
  const byId = new Map(rows(el).map((row) => [row.dataset.dockItem, row]));
  for (const anchor of position.anchors) {
    const row = byId.get(anchor.id);
    if (!row) continue;
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
    return;
  }
  el.scrollTop = position.top;
}

/** Local reading position only. Explicit navigation wins over every passive
 * refresh; ResizeObserver covers font/file layout without observing each reply. */
export function useDockScroll(
  list: RefObject<HTMLDivElement>, content: RefObject<HTMLDivElement>,
  open: boolean, navigation: number, focus: string | undefined, items: DockItem[]
) {
  const following = useRef(true);
  const position = useRef<Position>({ top: 0, anchors: [] });
  const lastNavigation = useRef<number>();
  const pendingFocus = useRef<string>();
  const seen = useRef(new Set<string>());
  const arrivals = useRef(new Set<string>());
  const latestAt = useRef(Number.NEGATIVE_INFINITY);
  const [news, setNews] = useState({ replies: 0, show: false });
  const published = useRef(news);

  const updateNews = (replies: number, show: boolean) => {
    if (published.current.replies === replies && published.current.show === show) return;
    published.current = { replies, show };
    setNews(published.current);
  };

  const publish = () => {
    const replies = items.filter((it) => arrivals.current.has(it.id) && it.kind === 'michael' && !it.notes).length;
    const show = !following.current && arrivals.current.size > 0;
    updateNews(replies, show);
  };
  const remember = (el: HTMLElement) => { position.current = capture(el); };
  const follow = (el: HTMLElement) => {
    following.current = true;
    arrivals.current.clear();
    el.scrollTop = el.scrollHeight;
    remember(el);
    publish();
  };
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    following.current = atBottom(el);
    if (following.current) arrivals.current.clear();
    remember(el);
    publish();
  };

  // Run after every dock commit: status text, Earlier and More can change
  // geometry without changing the number of items. Read the pre-change intent
  // captured by onScroll, never infer it from the new scroll height.
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) {
      lastNavigation.current = undefined;
      seen.current.clear();
      arrivals.current.clear();
      latestAt.current = Number.NEGATIVE_INFINITY;
      updateNews(0, false);
      return;
    }
    const navigate = lastNavigation.current !== navigation;
    if (navigate) {
      lastNavigation.current = navigation;
      pendingFocus.current = focus;
      arrivals.current.clear();
      following.current = true;
    }
    // First nonempty history is a baseline, including a delayed initial load.
    if (!navigate && seen.current.size > 0) {
      for (const it of items) {
        if (!seen.current.has(it.id) && Date.parse(it.at) >= latestAt.current && !following.current) arrivals.current.add(it.id);
      }
    }
    const present = new Set(items.map((it) => it.id));
    for (const id of arrivals.current) if (!present.has(id)) arrivals.current.delete(id);
    for (const it of items) {
      seen.current.add(it.id);
      const at = Date.parse(it.at);
      if (at > latestAt.current) latestAt.current = at;
    }
    const target = pendingFocus.current
      ? el.querySelector<HTMLElement>(`[data-q="${CSS.escape(pendingFocus.current)}"]`)
      : null;
    if (target) {
      el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - (el.clientHeight - target.offsetHeight) / 2;
      pendingFocus.current = undefined;
      following.current = atBottom(el);
      remember(el);
    } else if (following.current) {
      el.scrollTop = el.scrollHeight;
      remember(el);
    } else if (!navigate) {
      restore(el, position.current);
      remember(el);
    } else remember(el);
    publish();
  });

  useLayoutEffect(() => {
    const el = list.current;
    const body = content.current;
    if (!open || !el || !body) return;
    const observer = new ResizeObserver(() => {
      if (following.current) el.scrollTop = el.scrollHeight;
      else restore(el, position.current);
      remember(el);
    });
    observer.observe(el);
    observer.observe(body);
    return () => observer.disconnect();
  }, [open, list, content]);

  return {
    onScroll,
    jumpToLatest: () => { if (list.current) follow(list.current); },
    // More is a reading action. Keep the text being expanded visible even
    // when the reader was following the latest before clicking it.
    pauseForExpansion: () => {
      following.current = false;
      if (list.current) remember(list.current);
    },
    ...news
  };
}
