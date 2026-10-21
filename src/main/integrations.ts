/**
 * Integrations registry + encrypted secret store (Phase 2 foundation, main process).
 *
 * Two responsibilities, deliberately separated from the broker:
 *   1. Registry — config-backed CRUD over IntegrationRecord metadata (NO secrets).
 *   2. Secret store — secrets ENCRYPTED AT REST via Electron `safeStorage`, kept in a
 *      file SEPARATE from config.json, decrypted only here, only in main.
 *
 * The broker (src/main/integrationBroker.ts) is electron-free and receives `getRecord`
 * + `getSecret` from here by injection, so it stays unit-testable without electron.
 *
 * SECURITY: a secret is never written unless `safeStorage.isEncryptionAvailable()`
 * (fail closed — no plaintext fallback), never returned to the renderer, never logged,
 * never placed in agent env/transcript, never echoed in any response. Records carry
 * only a `secretRef` handle.
 *
 * Contract: hive/docs/integrations-spec.md.
 */
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sweepStaleTemps, writeFileAtomic } from './atomicFile';
import {
  type IntegrationRecord,
  validateIntegrationRecord,
  authTypeNeedsSecret,
  secretRefFor
} from '../shared/integrations';
import { readConfig, writeConfig } from './config';
import { SECRETS_FILE_UNREADABLE } from '../shared/secretStore';

// ─── Registry (config-backed) ────────────────────────────────────────────────

/** All registered integration records (metadata only). */
export function listRecords(): IntegrationRecord[] {
  return readConfig().integrations ?? [];
}

/** Look up one record by id. */
export function getRecord(id: string): IntegrationRecord | undefined {
  return listRecords().find((r) => r.id === id);
}

/** Ids of integrations a worker may use right now (enabled, and — for secret auth —
 *  actually holding a stored secret). This is the default capability scope granted to
 *  every ephemeral worker. */
export function enabledIds(): string[] {
  return listRecords()
    .filter((r) => r.enabled && (!authTypeNeedsSecret(r.authType) || hasSecret(r.secretRef)))
    .map((r) => r.id);
}

/** Create or replace a record (validated). Stamps createdAt/updatedAt; preserves the
 *  original createdAt on update. Does NOT touch the secret store. */
export function upsertRecord(input: unknown): { ok: true; record: IntegrationRecord } | { ok: false; error: string } {
  const v = validateIntegrationRecord(input);
  if (!v.ok) return v;
  const now = Date.now();
  const existing = getRecord(v.value.id);
  const record: IntegrationRecord = {
    ...v.value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const next = listRecords().filter((r) => r.id !== record.id);
  next.push(record);
  writeConfig({ integrations: next });
  return { ok: true, record };
}

/** Remove a record AND its stored secret. */
export function removeRecord(id: string): { ok: boolean } {
  const next = listRecords().filter((r) => r.id !== id);
  writeConfig({ integrations: next });
  if (!deleteSecret(secretRefFor(id))) console.error('[integrations] the record was removed, but its stored secret could not be:', id);
  return { ok: true };
}

/** Records with the secretRef redacted to a boolean — the renderer-safe shape. */
export function listRecordsRedacted(): Array<Omit<IntegrationRecord, 'secretRef'> & { hasSecret: boolean }> {
  return listRecords().map(({ secretRef, ...rest }) => ({ ...rest, hasSecret: !!secretRef && hasSecret(secretRef) }));
}

// ─── Secret store (encrypted at rest) ────────────────────────────────────────

let tempsSwept = false;

function secretsPath(): string {
  const p = join(app.getPath('userData'), 'integration-secrets.json');
  // A crash inside a write leaves an encrypted temp file nothing reads; clear
  // those once per run, on first use.
  if (!tempsSwept) { tempsSwept = true; sweepStaleTemps(p); }
  return p;
}

function readSecretBlob(): Record<string, string> {
  const p = secretsPath();
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The blob to change and write back. Unlike readSecretBlob, a file that is
 *  there but can't be read or parsed throws: writing back `{}` plus one new
 *  secret would erase every other saved password and key. */
function readSecretBlobForWrite(): Record<string, string> {
  const p = secretsPath();
  if (!existsSync(p)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(SECRETS_FILE_UNREADABLE);
  }
  return parsed as Record<string, string>;
}

/** Every secret lives in this one file, so a torn write would lose all of them:
 *  write it atomically (atomicFile.ts). */
function writeSecretBlob(blob: Record<string, string>): void {
  const p = secretsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileAtomic(p, JSON.stringify(blob, null, 2), 0o600);
}

/** Whether the OS can encrypt a secret right now. Asked before a credential is
 *  tested, so one that could never be stored is refused up front, in words. */
export function canStoreSecrets(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** What the owner reads when a saved key or connection could not be kept
 *  encrypted on this computer: the OS secret store (Keychain, DPAPI, or a Linux
 *  keyring) is unavailable. Says what to do, never the raw error. Mailboxes have
 *  their own wording for a password (cannotStoreReason in mail.ts). */
export function secretStoreUnavailableReason(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return 'This Mac could not store the key safely in its keychain, so nothing was saved. If macOS asks whether this app may use your keychain, choose Allow. Then try again, and restart the Mac if it keeps happening.';
  }
  if (platform === 'linux') {
    return 'This computer could not store the key safely because no keyring is unlocked, so nothing was saved. Set up a keyring such as GNOME Keyring or KWallet, unlock it, then try again.';
  }
  return 'This computer could not store the key safely, so nothing was saved. Restart the computer, then try again.';
}

/** Store a secret ENCRYPTED. Fail closed if OS encryption is unavailable (never
 *  writes plaintext). The plaintext is used only to encrypt and is not retained. */
export function setSecret(secretRef: string, plaintext: string): { ok: boolean; error?: string } {
  if (!secretRef) return { ok: false, error: 'secretRef required' };
  if (typeof plaintext !== 'string' || plaintext === '') return { ok: false, error: 'secret required' };
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: secretStoreUnavailableReason() };
    }
    const cipher = safeStorage.encryptString(plaintext).toString('base64');
    const blob = readSecretBlobForWrite();
    blob[secretRef] = cipher;
    writeSecretBlob(blob);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Decrypt a secret. MAIN-INTERNAL ONLY — never expose this over IPC. Returns
 *  undefined if absent or undecryptable (the broker maps that to 503 no_secret). */
export function getSecret(secretRef: string | undefined): string | undefined {
  if (!secretRef) return undefined;
  const cipher = readSecretBlob()[secretRef];
  if (!cipher) return undefined;
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
  } catch {
    return undefined;
  }
}

/** Whether a secret is stored for this ref (no decryption). */
export function hasSecret(secretRef: string | undefined): boolean {
  if (!secretRef) return false;
  return !!readSecretBlob()[secretRef];
}

/** Delete a stored secret. Idempotent, and never throws. True when it is not
 *  stored any more (removed now, or never there); false when it may still be
 *  in the file, because the file could not be read or written. */
export function deleteSecret(secretRef: string | undefined): boolean {
  if (!secretRef) return true;
  try {
    // An unreadable file throws here instead of reading as empty, which
    // would report the secret gone while it is still on disk.
    const blob = readSecretBlobForWrite();
    if (!(secretRef in blob)) return true;
    delete blob[secretRef];
    if (Object.keys(blob).length === 0) rmSync(secretsPath(), { force: true });
    else writeSecretBlob(blob);
    return true;
  } catch {
    return false;
  }
}
