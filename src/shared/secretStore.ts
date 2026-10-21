/**
 * Plain words the secret store (src/main/integrations.ts) refuses with, shared
 * so a caller can pass them on to the owner as they are.
 */

/** The encrypted secrets file exists but cannot be read, so nothing is
 *  written over it. */
export const SECRETS_FILE_UNREADABLE = 'The saved secrets file could not be read, so nothing was saved over it. Try again; if it keeps failing, the file needs repair.';
