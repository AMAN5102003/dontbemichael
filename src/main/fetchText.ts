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

/** Redirect hops followed before giving up. Some callers fetch URLs scraped from
 *  third-party pages, and a redirect loop there would otherwise never settle. */
export const MAX_REDIRECTS = 5;

export function getText(url: string, opts: { timeoutMs?: number } = {}, redirects = 0): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers: { 'user-agent': 'dontbemichael' } }, (res) => {
      // Follow a redirect once per hop; raw.githubusercontent does this for
      // branch aliases and the request just fails without it. A relative
      // Location resolves against this URL; an http: one still fails, since
      // httpsRequest refuses that protocol.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) { reject(new Error('too many redirects')); return; }
        let next: string;
        try { next = new URL(res.headers.location, url).href; }
        catch { reject(new Error('bad redirect')); return; }
        getText(next, opts, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out')));
    req.end();
  });
}
