/**
 * Reads a document in a process of its own, so a large or crafted file never
 * freezes every window while it parses (TODOS: "Parse documents off the main
 * thread"). It runs the doc-text command agents already use (docTextCli.ts)
 * in its --json mode, and stops it, with anything it started, after a time
 * limit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { DocExtraction } from './docText';
import { hardKillTree } from './procKill';

/** Longer than a scanned PDF's own OCR limit (macOcr.ts), so that clearer
 *  reason wins when it applies. */
export const DOC_TEXT_TIME_LIMIT_MS = 4 * 60_000;

const TOO_SLOW = 'This file took too long to read. Try a smaller one, or split it.';
const FAILED = 'This file could not be read. It may be damaged.';

/** How to start doc-text: a Node and the script to run with it. */
export interface DocTextLaunch {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function extractDocumentTextApart(srcPath: string, launch: DocTextLaunch, timeoutMs = DOC_TEXT_TIME_LIMIT_MS): Promise<DocExtraction> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (r: DocExtraction): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ChildProcess;
    try {
      // Its own process group off Windows, so a timeout stops the OCR helper too.
      child = spawn(launch.file, [...launch.args, '--json', srcPath], {
        env: launch.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      });
    } catch {
      done({ kind: 'unreadable', reason: FAILED });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { out += chunk; });
    child.on('error', () => done({ kind: 'unreadable', reason: FAILED }));
    child.on('close', () => done(parseExtraction(out) ?? { kind: 'unreadable', reason: FAILED }));
    timer = setTimeout(() => {
      if (child.pid) hardKillTree(child.pid);
      done({ kind: 'unreadable', reason: TOO_SLOW });
    }, timeoutMs);
  });
}

/** The child's answer, or null when it isn't one. */
export function parseExtraction(out: string): DocExtraction | null {
  let v: Record<string, unknown>;
  try { v = JSON.parse(out) as Record<string, unknown>; } catch { return null; }
  if (v?.kind === 'passthrough') return { kind: 'passthrough' };
  if (v?.kind === 'unreadable' && typeof v.reason === 'string') return { kind: 'unreadable', reason: v.reason };
  const { text, extractor, modality, mime } = v ?? {};
  if (v?.kind === 'text' && typeof text === 'string' && typeof extractor === 'string' && typeof modality === 'string' && typeof mime === 'string') {
    return { kind: 'text', text, extractor, modality, mime };
  }
  return null;
}
