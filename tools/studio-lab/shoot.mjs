#!/usr/bin/env node
/**
 * Re-shoots the reference screens (branding/reference/studio/*.png) from the
 * app's real components: builds tools/studio-lab/reference.tsx into one page,
 * then captures each screen with headless Chrome at 1440 x 900.
 *
 *   npm run shoot                 every screen
 *   npm run shoot -- home-dark    just the ones named
 *
 * Then `python3 branding/source/build.py social guide` rebuilds the social
 * card and the brand guide PDF, which use these screens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLab } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../branding/reference/studio');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** File name, then the page's query and hash. */
const SHOTS = [
  ['home-light', '?shot=home'],
  ['home-dark', '?shot=home#dark'],
  ['kelly-access', '?shot=kelly-access'],
  ['kelly-work', '?shot=kelly-work'],
  ['michael-office-schedule', '?shot=michael-office-schedule'],
  ['tasks-detail', '?shot=tasks-detail'],
  ['who-talks-to-whom', '?shot=who-talks-to-whom'],
  ['file-tab', '?shot=file-tab'],
  ['onboarding-team', '?shot=onboarding-team'],
  ['onboarding-business', '?shot=onboarding-business'],
  ['onboarding-meet', '?shot=onboarding-meet'],
  ['onboarding-ready', '?shot=onboarding-ready'],
  ['kelly-memory', '?shot=kelly-memory'],
  ['hire', '?shot=hire'],
  ['settings-autonomy', '?shot=settings-autonomy']
];

const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter(([name]) => only.includes(name)) : SHOTS;
if (only.length && shots.length !== only.length) {
  console.error(`unknown shot; known: ${SHOTS.map(([n]) => n).join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  console.error(`no Chrome at ${CHROME} (set CHROME=…)`);
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-shoot-'));
const page = path.join(dir, 'reference.html');
await buildLab(page, { entry: 'reference.tsx', title: 'Reference screens' });

for (const [name, query] of shots) {
  const out = path.join(OUT, `${name}.png`);
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    // Long enough for the lights, the cards and the panels to settle, and
    // before the studio's own first idle line (8 s; reference.tsx).
    '--virtual-time-budget=7000',
    '--window-size=1440,900', `--screenshot=${out}`, `file://${page}${query}`
  ], { stdio: 'ignore', timeout: 120_000 });
  console.log(`shot ${path.relative(process.cwd(), out)}`);
}
fs.rmSync(dir, { recursive: true, force: true });
