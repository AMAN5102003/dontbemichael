import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Keep the right-click "Copy link address" item in the app language.
 *
 * Mounted once, near the root. Main builds that menu but cannot read the
 * language (it lives in the renderer), so the label is sent to main now and
 * again on every language switch.
 */
export function useCopyLinkLabelSync(): void {
  const { t, i18n } = useTranslation();
  const label = t('markdown.copyLinkAddress');
  useEffect(() => { window.cth.setCopyLinkLabel(label); }, [label, i18n.language]);
}
