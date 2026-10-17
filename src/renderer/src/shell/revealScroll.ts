/**
 * How far to scroll a list so an item that just grew (a reply opened with
 * More) shows: all of it when it fits, else its start at the top. Zero when
 * its end is already in view. `pad` keeps that much room at either edge.
 */
export function revealScroll(view: { top: number; bottom: number }, item: { top: number; bottom: number }, pad = 0): number {
  const below = item.bottom - (view.bottom - pad);
  if (below <= 0) return 0;
  return Math.min(item.top - (view.top + pad), below);
}
