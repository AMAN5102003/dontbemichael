// Pete's first day welcome (branding/DESIGN.md 8.8): the first conversation
// after the owner turns Research on is one of Pete's, once per turn on (owner,
// 2026-10-13, D5 and D7). A flag remembers it played, kept per office because
// localStorage is shared by every office this origin opens (D9; the roster
// claims it per office for the same reason, store.ts). Turning Research on
// forgets it (startResearch), so the next turn on welcomes Pete again. Once it
// has played, a restart or a restore does not play it again; an office that had
// Research on before this flag existed, or whose storage was cleared, has no
// flag yet and plays it once on its next start.
//
// Pure, so the tests load it: the storage and the office come in as arguments.
// A storage that throws or is missing falls back to this window's memory, so a
// blocked storage can replay the welcome on a later start but never twice in
// one session.

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'pete-welcomed';
const played = new Set<string>();

/** The flag's key for an office (its home folder); the plain key when unknown. */
export const welcomeKey = (home: string | null | undefined): string => (home ? `${KEY}:${home}` : KEY);

/** This window's storage, or undefined where reading it throws. */
export function browserStorage(): FlagStorage | undefined {
  try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}

/** True until the welcome has played in this office since Research was last turned on. */
export function welcomeArmed(storage: FlagStorage | undefined, home: string | null | undefined): boolean {
  const key = welcomeKey(home);
  if (played.has(key)) return false;
  try { return storage?.getItem(key) !== '1'; } catch { return true; }
}

/** The welcome played: not again in this office until Research is turned on again. */
export function markWelcomed(storage: FlagStorage | undefined, home: string | null | undefined): void {
  const key = welcomeKey(home);
  played.add(key);
  try { storage?.setItem(key, '1'); } catch { /* blocked storage: this window remembers */ }
}

/** Research was just turned on: the next quiet moment welcomes Pete. */
export function forgetWelcome(storage: FlagStorage | undefined, home: string | null | undefined): void {
  const key = welcomeKey(home);
  played.delete(key);
  try { storage?.removeItem(key); } catch { /* blocked storage: nothing to forget */ }
}
