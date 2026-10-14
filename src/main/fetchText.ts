/**
 * One place that fetches text over https.
 *
 * Extracted from skills.ts when the hero payload needed the same thing: two
 * copies of redirect-following, timeout and status handling would drift, and the
 * one that drifted would be the one nobody was looking at.
 *
 * https only, by construction — every caller fetches from raw.githubusercontent
 * or a repo URL, and an http: fallback would silently downgrade content the app
 * then renders.
 */
import { request as httpsRequest } from 'node:https';

/** Largest body read before giving up. Every caller fetches a small document
 *  (the biggest, the skills catalog, is about 60 KB), and some URLs are scraped
 *  from third-party pages, so an endless or huge body must not fill memory. */
export const MAX_BYTES = 8 * 1024 * 1024;

export function getText(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers: { 'user-agent': 'dontbemichael' } }, (res) => {
      // Follow a redirect once per hop; raw.githubusercontent does this for
      // branch aliases and the request just fails without it.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        getText(res.headers.location, opts).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      // Counted in bytes, not characters, and checked as data arrives: a
      // declared Content-Length can be missing or wrong.
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { reject(new Error('response too large')); req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out')));
    req.end();
  });
}
