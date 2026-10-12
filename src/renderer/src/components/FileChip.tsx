/**
 * A file Michael or an Ask me question names, as a chip in place of its path
 * (docs/designs/open-file-tab.md, R2 and DD1; owner, 2026-10-10: show the Open
 * option instead of the path). Main checks every path and decides what the
 * chip does: a file the office can show opens as a tab next to Who talks to
 * whom; another document inside the office folders opens in its own app; a
 * file the office cannot open shows in Finder (Show in folder on Windows); a
 * file that is gone, or outside every folder, reads Not found.
 *
 * Replaces the rows under the question (docs/designs/ask-me-open-file.md, D2).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { askFilePaths, fileTitle, kindOf, type AskFileCheck } from '@shared/askFiles';
import { MarkdownPreview, type MarkdownVariant } from '@/markdown/MarkdownPreview';
import { useStore } from '@/store/store';
import { Icon } from './Icon';

export type Checks = Record<string, AskFileCheck>;
type Who = { raisedBy?: string; assignee?: string };

/** Main's check caps one call at 20 paths. */
const ASK_FILES_PER_CALL = 20;

/** Asks main what each path can do. If the check fails the chips fall back to
 *  Show in Finder rather than sitting disabled: the click asks main again
 *  anyway (fs:openAskFile), so it opens, shows or reports the file missing. */
async function checkAskFiles(paths: string[], who: Who): Promise<Checks> {
  const out: Checks = {};
  for (let i = 0; i < paths.length; i += ASK_FILES_PER_CALL) {
    const chunk = paths.slice(i, i + ASK_FILES_PER_CALL);
    try {
      const v = await window.cth.askFiles(chunk, who);
      chunk.forEach((p, j) => { out[p] = v[j] ?? { verdict: 'missing', tab: false, path: p }; });
    } catch {
      for (const p of chunk) out[p] = { verdict: 'reveal', tab: false, path: p };
    }
  }
  return out;
}

/**
 * One check for every question on a card (Task detail), not one per question.
 * Grouped by who raised each question, since that decides which team folder is
 * searched first; a card's questions usually share one raiser, so one call.
 * Returns the checks by raiser ('' for none), each keyed by path.
 */
export function useAskFileChecks(
  entries: ReadonlyArray<{ q: string; raisedBy?: string }> | undefined,
  assignee?: string
): Record<string, Checks> {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of entries ?? []) {
      const raiser = e.raisedBy ?? '';
      const list = m.get(raiser) ?? [];
      for (const p of askFilePaths(e.q)) if (!list.includes(p)) list.push(p);
      if (list.length) m.set(raiser, list);
    }
    return [...m];
  }, [entries]);
  const key = JSON.stringify(groups);
  const [byRaiser, setByRaiser] = useState<Record<string, Checks>>({});

  useEffect(() => {
    setByRaiser({});
    let alive = true;
    for (const [raiser, paths] of groups) {
      void checkAskFiles(paths, { raisedBy: raiser || undefined, assignee })
        .then((v) => { if (alive) setByRaiser((s) => ({ ...s, [raiser]: v })); });
    }
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, assignee]);

  return byRaiser;
}

/** The chip itself (DD1): soft, one button; Not found is text, not a button. */
export function FileChip({ path, check, who, onGone }: {
  path: string;
  check?: AskFileCheck;
  who: Who;
  onGone: (path: string) => void;
}) {
  const { t } = useTranslation();
  const win = window.cth.platform === 'win32';
  const name = fileTitle(path);
  const kind = kindOf(path);
  const icon = kind === 'excel' || kind === 'csv' ? 'sheet' : kind === 'image' ? 'image' : 'file';
  const missing = check?.verdict === 'missing';
  const reveal = !!check && !check.tab && check.verdict === 'reveal';
  const chip: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle', maxWidth: '100%',
    height: 24, padding: '0 8px', margin: '1px 0', border: 0, borderRadius: 'var(--cth-r-sm)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 500, lineHeight: '24px', whiteSpace: 'nowrap'
  };
  const nameEl = (
    <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, unicodeBidi: 'isolate' }}>{name}</span>
  );
  if (missing) {
    return (
      <span title={`⁨${path}⁩`} style={{ ...chip, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--cth-line)', color: 'var(--cth-ink-3)' }}>
        <Icon name={icon} size={0.875} />{nameEl}<span style={{ fontWeight: 400 }}>{t('askMe.fileNotFound')}</span>
      </span>
    );
  }
  const open = () => {
    if (!check) return;
    if (check.tab) {
      useStore.getState().openFileTab({ id: check.path, title: fileTitle(check.path), kind: kindOf(check.path), who });
      return;
    }
    void window.cth.openAskFile(path, who)
      .then((r) => { if (!r.ok) onGone(path); })
      .catch(() => undefined);
  };
  const labels = [t('askMe.fileOpen'), t(win ? 'askMe.fileRevealWindows' : 'askMe.fileReveal')];
  return (
    <button
      type="button"
      className="cth-file-chip"
      onClick={open}
      disabled={!check}
      title={`⁨${path}⁩`}
      aria-label={reveal
        ? t(win ? 'askMe.fileRevealLabelWindows' : 'askMe.fileRevealLabel', { name })
        : t('askMe.fileOpenLabel', { name })}
      style={{ ...chip, background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink)', cursor: check ? 'pointer' : 'default' }}
    >
      <span aria-hidden style={{ color: 'var(--cth-ink-3)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={0.875} /></span>
      {nameEl}
      {/* Both labels share one cell, so the chip is as wide as the longer one
          whichever shows: nothing jumps when the check lands. */}
      <span aria-hidden style={{ display: 'inline-grid', color: 'var(--cth-indigo-text)', fontWeight: 600 }}>
        {labels.map((l, j) => (
          <span key={j} style={{ gridArea: '1 / 1', visibility: check && (j === 1) === reveal ? 'visible' : 'hidden' }}>{l}</span>
        ))}
      </span>
    </button>
  );
}

/**
 * Markdown with its files as chips: Michael's replies, Ask me questions and the
 * Task detail trail. `checks` comes from a parent that checked many questions
 * at once (useAskFileChecks); without it the text checks its own paths, once
 * per set of paths, so a 5 s poll that re-renders the card asks main nothing.
 */
export function FileText({ source, who, checks: given, variant = 'card' }: {
  source: string;
  who: Who;
  checks?: Checks;
  variant?: MarkdownVariant;
}) {
  const paths = useMemo(() => askFilePaths(source), [source]);
  const key = paths.join('\n');
  const [own, setOwn] = useState<Checks>({});
  // A click that finds the file gone marks it here, over either source.
  const [gone, setGone] = useState<Record<string, true>>({});
  const { raisedBy, assignee } = who;

  useEffect(() => {
    if (!paths.length || given) return;
    let alive = true;
    void checkAskFiles(paths, { raisedBy, assignee }).then((v) => { if (alive) setOwn(v); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, raisedBy, assignee, !given]);

  const checks = given ?? own;
  const onGone = useCallback((p: string) => setGone((g) => ({ ...g, [p]: true })), []);
  const fileChip = useCallback((p: string) => (
    <FileChip
      path={p}
      check={gone[p] ? { verdict: 'missing', tab: false, path: p } : checks[p]}
      who={{ raisedBy, assignee }}
      onGone={onGone}
    />
  ), [checks, gone, raisedBy, assignee, onGone]);
  return <MarkdownPreview source={source} variant={variant} fileChip={paths.length ? fileChip : undefined} />;
}
