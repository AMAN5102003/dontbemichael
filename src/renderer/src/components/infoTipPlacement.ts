/** A rectangle in viewport pixels, as getBoundingClientRect gives it. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** How far a span runs past the [lo, hi] it has to stay inside. */
const spill = (from: number, to: number, lo: number, hi: number): number => Math.max(0, lo - from) + Math.max(0, to - hi);

/**
 * Which way an info bubble opens so it stays inside the box that clips it.
 * The bubble hangs `inset` past one edge of its icon and sits `gap` below it;
 * each axis moves to the other side only when that side spills less, so a
 * bubble that fits keeps the placement it asked for (#232: the Model tip on
 * Finalize, at the end of its row near the bottom, ran off both edges).
 * Physical sides, so the caller maps `opensRight` back for right to left.
 */
export function placeInfoTip(
  icon: Box, size: { width: number; height: number }, clip: Box, prefer: { opensRight: boolean },
  gap = 6, inset = 8
): { opensRight: boolean; above: boolean } {
  const right = spill(icon.left - inset, icon.left - inset + size.width, clip.left, clip.right);
  const left = spill(icon.right + inset - size.width, icon.right + inset, clip.left, clip.right);
  const opensRight = prefer.opensRight ? right <= left : right < left;
  const below = spill(icon.bottom + gap, icon.bottom + gap + size.height, clip.top, clip.bottom);
  const above = spill(icon.top - gap - size.height, icon.top - gap, clip.top, clip.bottom);
  return { opensRight, above: above < below };
}

/**
 * The part of the window an element can show through: the window, cut down
 * by every ancestor that clips or scrolls (a dialog's scrolling body).
 * Measured inside their scrollbars.
 */
export function clipBoxOf(el: Element): Box {
  const box: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    const left = r.left + p.clientLeft;
    const top = r.top + p.clientTop;
    box.left = Math.max(box.left, left);
    box.top = Math.max(box.top, top);
    box.right = Math.min(box.right, left + p.clientWidth);
    box.bottom = Math.min(box.bottom, top + p.clientHeight);
  }
  return box;
}
