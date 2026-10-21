/**
 * Pure link/path logic for the markdown preview.
 *
 * Extracted from MarkdownPreview.tsx so it can be unit-tested: these are the
 * functions that decide what a rendered document is allowed to REACH, and a
 * `.tsx` file cannot be loaded by the `node --test` harness. The component keeps
 * only the rendering.
 */
import { isImagePath } from '@shared/imageTypes';
import { isFileSpan } from '@shared/askFiles';

/** Resolve `href` against the directory of `baseRel` ('' when unknown).
 *
 *  Note that `..` can only ever pop segments that this function itself pushed —
 *  once `parts` is empty a `..` is dropped — so the result is always a path
 *  UNDER the workspace root, never a sibling of it. That is a convenience, not
 *  the security boundary: the real containment check is `safeResolve` in the main
 *  process, which every read goes through. */
export function resolveRel(baseRel: string | undefined, href: string): string {
  const baseDir = (baseRel ?? '').split('/').slice(0, -1);
  const parts = [...baseDir];
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

export function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/** True when `href` carries any URI scheme (http:, data:, file:, javascript:…). */
function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function isRelativeMd(href: string): boolean {
  return !hasScheme(href) && /\.(md|markdown)(#.*)?$/i.test(href);
}

/**
 * Workspace-relative path for a markdown `<img src>`, or null when the source is
 * not a local image we may load.
 *
 * WHY THIS EXISTS: the preview used to replace EVERY image with a placeholder
 * chip, so an agent-written report containing screenshots rendered as a row of
 * "🖼 screenshot" pills — the report's evidence was invisible everywhere in the
 * app. Local images can now be resolved and read through the same root-confined
 * IPC as everything else.
 *
 * What is refused, and why:
 *  - anything with a SCHEME (http:, https:, data:, file:, javascript:). Remote
 *    URLs are already dead under the CSP (`img-src 'self' data: blob:`), and
 *    silently proxying them through the main process would turn a rendered
 *    document into a network beacon that leaks "this user opened this file" to
 *    whoever authored the markdown. Agent-generated markdown is untrusted.
 *  - anything whose extension is not a known image type — there is no reason for
 *    an <img> to pull an arbitrary file's bytes into the renderer.
 *
 * A leading `/` is read as workspace-root-relative rather than as a filesystem
 * absolute path; the leading slashes are stripped and the rest resolves from the
 * root, so `/etc/passwd` becomes the (harmless, nonexistent) `etc/passwd` inside
 * the workspace instead of escaping to the real one.
 */
export function resolveLocalImageRel(baseRel: string | undefined, src: string | undefined): string | null {
  if (typeof src !== 'string') return null;
  const raw = src.trim();
  if (!raw) return null;
  if (hasScheme(raw)) return null;
  if (!isImagePath(raw)) return null;
  // Strip the query/hash before resolving — they are cache-busters, not path.
  let clean = raw.split('#')[0].split('?')[0];
  // react-markdown hands over the src percent-encoded ("My shot.png" arrives as
  // "My%20shot.png"), and the file on disk has the name as written.
  try { clean = decodeURIComponent(clean); } catch { /* a stray % stays as written */ }
  if (hasScheme(clean) || !isImagePath(clean)) return null;
  const rooted = clean.startsWith('/');
  const rel = resolveRel(rooted ? undefined : baseRel, clean);
  return rel || null;
}

// ─── Named links (docs/designs/named-links.md) ──────────────────────────────
// Owner, 2026-10-11: a card showing a raw record URL is ugly; show a name such
// as HubSpot that takes you there. Display only: the agent's text is unchanged.

/** Web apps an owner opens from a card, by domain. A function picks the name
 *  from the path where one domain serves several products. Product names, so
 *  never translated. */
const KNOWN_APPS: ReadonlyArray<readonly [string, string | ((path: string) => string)]> = [
  ['hubspot.com', 'HubSpot'],
  ['intuit.com', 'QuickBooks'],
  ['mail.google.com', 'Gmail'],
  ['docs.google.com', (p) => (/^\/spreadsheets\//.test(p) ? 'Google Sheets' : /^\/presentation\//.test(p) ? 'Google Slides' : 'Google Docs')],
  ['drive.google.com', 'Google Drive'],
  ['calendar.google.com', 'Google Calendar'],
  ['outlook.office.com', 'Outlook'],
  ['outlook.live.com', 'Outlook'],
  ['slack.com', 'Slack'],
  ['notion.so', 'Notion'],
  ['stripe.com', 'Stripe'],
  ['github.com', 'GitHub'],
  ['linear.app', 'Linear'],
  ['atlassian.net', (p) => (/^\/wiki(\/|$)/.test(p) ? 'Confluence' : 'Jira')],
  ['sentry.io', 'Sentry'],
  ['xero.com', 'Xero']
];

/** Every name a label might borrow, with the domains that name really lives on. */
const APP_DOMAINS: ReadonlyMap<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  const add = (name: string, d: string) => m.set(name.toLowerCase(), [...(m.get(name.toLowerCase()) ?? []), d]);
  for (const [d, n] of KNOWN_APPS) {
    if (typeof n === 'string') add(n, d);
    else for (const name of d === 'docs.google.com' ? ['Google Docs', 'Google Sheets', 'Google Slides'] : ['Jira', 'Confluence']) add(name, d);
  }
  return m;
})();

/** The host itself, or any host under it, on a dot boundary: `app.hubspot.com`
 *  is on hubspot.com, `app.hubspot.com.evil.io` and `evilhubspot.com` are not. */
const onDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

const stripWww = (host: string): string => host.replace(/^www\./, '');

/** A web or email URL, parsed. `hostname` is what the browser will really reach:
 *  lowercase, punycode for a look-alike letter, no `user:pw@`. */
function webUrl(href: string): URL | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  return /^(https?|mailto):$/.test(u.protocol) ? u : null;
}

/** The email address a `mailto:` URL writes to, without its query. */
function mailAddress(u: URL): string | null {
  try { return decodeURIComponent(u.pathname) || null; } catch { return null; }
}

/** True when the link's text is its own address: a pasted URL (`https://…`,
 *  `<https://…>`), a `www.` autolink (remark-gfm adds `http://` to the href),
 *  or an email autolink (it adds `mailto:`). */
export function isBareLink(text: string, href: string): boolean {
  const t = text.trim();
  if (!t || !href) return false;
  return t === href || `http://${t}` === href || `mailto:${t}` === href;
}

/** The name a bare link shows: a known app's name, else the site's host
 *  without `www.`, or the address for email. Null when the URL does not parse
 *  or is not a web or email link, so the caller keeps the raw text. */
export function linkName(href: string): string | null {
  const u = webUrl(href);
  if (!u) return null;
  if (u.protocol === 'mailto:') return mailAddress(u);
  const host = u.hostname;
  if (!host) return null;
  for (const [d, name] of KNOWN_APPS) {
    if (onDomain(host, d)) return typeof name === 'string' ? name : name(u.pathname);
  }
  return stripWww(host);
}

/** A label that is itself a web address (`app.hubspot.com`, `https://x.io/a`),
 *  as a lowercase host; null for anything else, and for a file name such as
 *  `report.md`, which looks like a host but names a file. */
function labelHost(label: string): string | null {
  const t = label.trim();
  if (!t || /\s/.test(t) || isFileSpan(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  const u = webUrl(withScheme);
  if (!u || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(u.hostname)) return null;
  return u.hostname;
}

/**
 * Where a link really goes, when its words say otherwise (D4): the words name
 * a known app the link is not on, or are a web address on another host. Returns
 * the real site (the host without `www.`, or the email address) for the card to
 * show after the link; null when the words agree or name nothing to check.
 */
export function labelMismatch(label: string, href: string): string | null {
  const u = webUrl(href);
  if (!u) return null;
  const mail = u.protocol === 'mailto:';
  const address = mail ? mailAddress(u) : null;
  const host = mail ? (address?.split('@')[1] ?? '').toLowerCase() : u.hostname;
  if (!host) return null;
  const real = mail ? address : stripWww(host);
  const words = label.toLowerCase();
  for (const [name, domains] of APP_DOMAINS) {
    // Names are letters and spaces only, so they go into the pattern as is.
    const named = new RegExp(`(^|[^a-z0-9])${name}($|[^a-z0-9])`).test(words);
    if (named && !domains.some((d) => onDomain(host, d))) return real;
  }
  const said = labelHost(label);
  if (said && !onDomain(host, stripWww(said))) return real;
  return null;
}

