/**
 * The product's name as people see it: the macOS menu (and its About, Hide and
 * Quit items), window titles, and the packaged app. Keep electron-builder.yml's
 * `productName` equal to this; `test/app-name.test.cjs` holds them together.
 */
export const APP_NAME = "Don't Be Michael";

/** The program the app is part of: the Greater Austin Asian Chamber of
 *  Commerce open source AI Lab. Written on the office floor in every install
 *  (owner, 2026-10-22, docs/designs/floor-business-name.md D1); a proper name,
 *  never translated. */
export const PROGRAM_MARK = 'GAACC AI Labs';

/** Where the program mark leads: the chamber's site, opened in the browser. */
export const PROGRAM_URL = 'https://austinasianchamber.org/';

/** The mark's full name, shown when the pointer rests on it. */
export const PROGRAM_TITLE = 'Greater Austin Asian Chamber of Commerce';

/** The data folder under Application Support. Pinned explicitly so a future
 *  rename of the app never moves it (Electron would otherwise derive the folder
 *  from the name and start empty). Was `munder-difflin`; the owner chose a clean
 *  folder over carrying old data forward (2026-09-24). */
export const APP_DATA_DIR = 'dontbemichael';

/** The URL scheme the app registers for shareable hires
 *  (`dontbemichael://hire?src=<https-url>`). Was `munderdifflin://`, which the
 *  upstream project's website links to; claiming it would have opened this app
 *  on their hire gallery's links (owner, 2026-09-24). */
export const APP_URL_SCHEME = 'dontbemichael';
