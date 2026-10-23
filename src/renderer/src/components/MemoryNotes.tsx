import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useRtl } from '@/i18n/useDirection';
import { expiryState, procedurePointer, type MemoryEntry, type MemoryView } from '@shared/memoryIndex';
import { localDay } from '@shared/messageView';
import { groupName } from './fieldText';

/**
 * An agent's memory as notes, not the raw index (docs/designs/memory-tab-readable.md).
 * Grouped by kind, each entry a sentence with where it came from and when under
 * it; procedures open to their steps; a passed "check again" date is flagged.
 * The ids, kind words and pipes of the file are never shown here: the Memory
 * tab's "Show the file" is where the raw text lives.
 */

/** "2026-09-25" as "Sep 25" in the app language, read as a local date. */
function shortDate(ymd: string, lang: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  try { return new Date(y, m - 1, d).toLocaleDateString(lang, { month: 'short', day: 'numeric' }); }
  catch { return ymd; }
}

export function MemoryNotes({ agentId, name, view, waiting }: {
  agentId: string; name: string; view: MemoryView; waiting: number;
}) {
  const { t } = useTranslation();
  const count = view.groups.reduce((n, g) => n + g.entries.length, 0) + view.other.length;

  if (count === 0) {
    return (
      <div style={{ padding: '12px 0' }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
          {t('memoryNotes.empty', { name })}
        </p>
        {waiting > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>
            {t(waiting === 1 ? 'memoryNotes.emptyWaiting' : 'memoryNotes.emptyWaitingPlural', { count: waiting })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {view.groups.map((g) => (
        <Group key={g.kind} title={t(`memoryNotes.group.${g.kind}`)} count={g.entries.length}>
          {g.entries.map((e) => <EntryRow key={e.id} agentId={agentId} entry={e} />)}
        </Group>
      ))}
      {view.other.length > 0 && (
        <Group title={t('memoryNotes.group.other')} count={view.other.length}>
          {view.other.map((line, i) => (
            <Row key={i}><EntryText>{line}</EntryText></Row>
          ))}
        </Group>
      )}
    </div>
  );
}

/** The count line under the header: "12 things remembered, 3 notes waiting to be sorted in". */
export function memorySummary(t: (k: string, o?: Record<string, unknown>) => string, view: MemoryView, waiting: number): string {
  const count = view.groups.reduce((n, g) => n + g.entries.length, 0) + view.other.length;
  if (count === 0) return '';
  const parts = [t(count === 1 ? 'memoryNotes.remembered' : 'memoryNotes.rememberedPlural', { count })];
  if (waiting > 0) parts.push(t(waiting === 1 ? 'memoryNotes.waiting' : 'memoryNotes.waitingPlural', { count: waiting }));
  return parts.join(t('memoryNotes.joiner'));
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ ...groupName, margin: '0 0 4px', display: 'flex', gap: 6 }}>
        {title}<span style={{ fontWeight: 400, color: 'var(--cth-ink-500)' }}>{count}</span>
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  // One ink-100 hairline between rows (DESIGN.md §7.10); see .cth-memory-row.
  return <li className="cth-memory-row" style={{ padding: '8px 0' }}>{children}</li>;
}

function EntryText({ children }: { children: React.ReactNode }) {
  const rtl = useRtl();
  return (
    <div dir={rtl ? 'auto' : undefined} style={{ fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-900)', wordBreak: 'break-word' }}>
      {children}
    </div>
  );
}

function EntryRow({ agentId, entry }: { agentId: string; entry: MemoryEntry }) {
  const { t, i18n } = useTranslation();
  const godName = useResolvedGodName();
  const lang = i18n.language;
  const proc = entry.kind === 'procedure' ? procedurePointer(entry.text) : null;
  const source = t(`memoryNotes.source.${entry.source}`, { godName });
  const expiry = expiryState(entry.expires, localDay(new Date().toISOString()));

  return (
    <Row>
      {proc ? <Procedure agentId={agentId} name={proc.name} slug={proc.slug} /> : <EntryText>{entry.text}</EntryText>}
      <div style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span>{t('memoryNotes.sourceLine', { source, date: shortDate(entry.date, lang) })}</span>
        {expiry !== 'none' && entry.expires && (
          <span style={{
            borderRadius: 'var(--cth-r-md)',
            padding: '0 6px', color: 'var(--cth-ink-900)',
            background: expiry === 'passed' ? 'var(--cth-coral-light)' : 'var(--cth-lemon-light)',
            boxShadow: `inset 0 0 0 1px ${expiry === 'passed' ? 'var(--cth-coral)' : 'var(--cth-lemon)'}`
          }}>
            {expiry === 'passed'
              ? `! ${t('memoryNotes.outOfDate', { date: shortDate(entry.expires, lang) })}`
              : t('memoryNotes.checkAgain', { date: shortDate(entry.expires, lang) })}
          </span>
        )}
      </div>
    </Row>
  );
}

/** A procedure's name that opens to its steps, read on first open. */
function Procedure({ agentId, name, slug }: { agentId: string; name: string; slug: string }) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<string | null | undefined>(undefined); // undefined: not read yet

  useEffect(() => { setSteps(undefined); setOpen(false); }, [agentId, slug]);
  useEffect(() => {
    if (!open || steps !== undefined) return;
    let alive = true;
    window.cth.hiveProcedure(agentId, slug)
      .then((s) => { if (alive) setSteps(s); })
      .catch(() => { if (alive) setSteps(null); });
    return () => { alive = false; };
  }, [open, steps, agentId, slug]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', gap: 6, alignItems: 'baseline', width: '100%', padding: 0, border: 'none', background: 'transparent',
          cursor: 'pointer', textAlign: rtl ? 'right' : 'left', fontFamily: 'var(--cth-font-ui)', fontSize: 14, lineHeight: '20px',
          color: 'var(--cth-ink-900)'
        }}
      >
        <span aria-hidden style={{ width: 10, flexShrink: 0, color: 'var(--cth-ink-500)' }}>{open ? '▾' : (rtl ? '◂' : '▸')}</span>
        <span dir={rtl ? 'auto' : undefined} style={{ wordBreak: 'break-word' }}>{name}</span>
      </button>
      {open && (
        <div style={{ margin: '4px 0 0 16px', fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
          {steps === undefined
            ? <span style={{ color: 'var(--cth-ink-500)' }}>{t('memoryNotes.loading')}</span>
            : steps
              ? <MarkdownPreview source={stripProcedureChrome(steps)} variant="card" />
              : <span style={{ color: 'var(--cth-ink-500)' }}>{t('memoryNotes.stepsMissing')}</span>}
        </div>
      )}
    </div>
  );
}

/** The file repeats the name as its heading and ends "Updated <date>."; the row
 *  already shows both, so render just the steps. */
export function stripProcedureChrome(text: string): string {
  return text.replace(/^#[^\n]*\n+/, '').replace(/\n*Updated \d{4}-\d{2}-\d{2}\.\s*$/, '').trim();
}

