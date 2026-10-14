import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from '../PixelButton';
import { JsonEditor } from './JsonEditor';
import { schemaParseError } from './schemaParseError';
import { Callout, MiniButton } from './ui';

/**
 * The body format (JSON Schema) one webhook checks its requests against: a
 * button that opens an editor, which refuses to save anything that does not
 * parse. Used by Settings → Connections, where webhooks live now that they left
 * Michael's Triggers tab (they serve the whole office).
 */
export function WebhookSchemaEditor({ schema, onSave }: { schema: string; onSave: (schema: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(schema);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-opening starts from what is actually stored.
  useEffect(() => {
    if (!open) return;
    setText(schema);
    setError(false);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    const problem = schemaParseError(text);
    if (problem !== null) {
      // Never persist a schema that cannot be parsed — a broken one would lock
      // the caller out of their own endpoint with nothing on screen to say why.
      // The owner sees plain words; the parser's own message goes to the
      // console so a developer can still find where the mistake was.
      console.error('[webhooks] body format is not valid JSON:', problem);
      setError(true);
      return;
    }
    setError(false);
    onSave(text);
    setSaved(true);
    setTimeout(() => setSaved(false), 1300);
  };

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MiniButton onClick={() => setOpen(true)}>{t('webhooksSection.editSchema')}</MiniButton>
        <span style={{ fontSize: 14, color: 'var(--cth-ink-500)' }}>
          {t('webhooksSection.schemaDesc')}
        </span>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <JsonEditor value={text} onChange={(v) => { setText(v); setError(false); }} />
      {error && <Callout>{t('webhooksSection.notValidJson')}</Callout>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <PixelButton variant="primary" size="sm" onClick={save}>
          {saved ? t('webhooksSection.saved') : t('webhooksSection.saveSchema')}
        </PixelButton>
        <PixelButton variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('common.close')}</PixelButton>
      </div>
    </div>
  );
}
