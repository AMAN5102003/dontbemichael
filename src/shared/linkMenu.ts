/**
 * The right-click "Copy link address" item on links in the app (TODOS.md, named
 * links D4). A named link shows "HubSpot", not the URL, so selecting its text
 * copies the name; this copies the address instead.
 *
 * Main builds the menu, but only the renderer knows the app language, so the
 * renderer sends main the translated label and main keeps the last one.
 */

/** Until the renderer sends its label, and whenever what it sends is unusable. */
export const DEFAULT_COPY_LINK_LABEL = 'Copy link address';

/** The address to copy for a right-clicked link, or null when there should be
 *  no menu: only web and email links, the same schemes the app opens. Anything
 *  else (file:, javascript:, an app's own page) gets nothing. */
export function copyableLink(linkURL: unknown): string | null {
  if (typeof linkURL !== 'string') return null;
  const url = linkURL.trim();
  return /^(?:https?:\/\/|mailto:)\S/i.test(url) ? url : null;
}

/** A label the renderer sent, made safe for a menu item: one line, short, or
 *  the default when it is not text at all. */
export function menuLabel(label: unknown): string {
  if (typeof label !== 'string') return DEFAULT_COPY_LINK_LABEL;
  const line = label.replace(/\s+/g, ' ').trim().slice(0, 60);
  return line || DEFAULT_COPY_LINK_LABEL;
}
