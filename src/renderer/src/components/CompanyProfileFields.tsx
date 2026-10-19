import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ENTITY_TYPES, SERVICE_AREAS,
  type CompanyAddress, type CompanyProfile, type RequiredProfileField
} from '@shared/companyProfile';

/**
 * The company profile's fields (src/shared/companyProfile.ts), shared by setup
 * (essentials on step 1, details on step 2) and Settings (all of it). Every
 * field has a short, definite answer; anything longer belongs in Memory &
 * Knowledge, which the hint at the bottom points to.
 */

type Part = 'essentials' | 'details' | 'hint';

export interface CompanyProfileFieldsProps {
  value: CompanyProfile;
  onChange: (next: CompanyProfile) => void;
  parts: Part[];
  /** Ask for the industry in the owner's words (no business type fit). */
  needsIndustry?: boolean;
  /** Required fields to ring as missing. */
  missing?: RequiredProfileField[];
  /** Settings passes a way to jump to Memory & Knowledge; setup doesn't. */
  onOpenKnowledge?: () => void;
}

/** The Mac's time zone, to prefill a new profile. */
export function localTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

/** A likely currency from the Mac's region, to prefill a new profile. Only the
 *  common ones; the owner picks anything else from the list. */
export function localCurrency(): string | undefined {
  const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
  const BY_REGION: Record<string, string> = {
    US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', CN: 'CNY', HK: 'HKD',
    SG: 'SGD', AE: 'AED', SA: 'SAR', EG: 'EGP', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', CH: 'CHF', SE: 'SEK',
    NO: 'NOK', DK: 'DKK', PL: 'PLN', KR: 'KRW', TW: 'TWD', IL: 'ILS', TR: 'TRY', PH: 'PHP', ID: 'IDR',
    AZ: 'AZN', IR: 'IRR', PK: 'PKR', BD: 'BDT', UA: 'UAH', MY: 'MYR', TH: 'THB', VN: 'VND'
  };
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (!region) return undefined;
    return EURO.includes(region) ? 'EUR' : BY_REGION[region];
  } catch { return undefined; }
}

function supported(kind: 'timeZone' | 'currency'): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return f ? f(kind) : [];
  } catch { return []; }
}

export function CompanyProfileFields({ value, onChange, parts, needsIndustry, missing = [], onOpenKnowledge }: CompanyProfileFieldsProps) {
  const { t, i18n } = useTranslation();
  const timeZones = useMemo(() => supported('timeZone'), []);
  const currencies = useMemo(() => supported('currency'), []);
  const months = useMemo(() => {
    try {
      const f = new Intl.DateTimeFormat(i18n.language, { month: 'long' });
      return Array.from({ length: 12 }, (_, i) => f.format(new Date(2026, i, 1)));
    } catch {
      return Array.from({ length: 12 }, (_, i) => String(i + 1));
    }
  }, [i18n.language]);

  const set = (patch: Partial<CompanyProfile>) => onChange({ ...value, ...patch });
  const setAddress = (patch: Partial<CompanyAddress>) => set({ address: { ...(value.address ?? {}), ...patch } });
  const miss = (f: RequiredProfileField) => missing.includes(f);
  const text = (v: string | undefined) => v ?? '';
  const orUndefined = (v: string) => (v.trim() ? v : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {parts.includes('essentials') && (
        <>
          <div style={grid2}>
            <Field label={t('companyProfile.ceo')} required>
              <input value={text(value.ceo)} onChange={(e) => set({ ceo: orUndefined(e.target.value) })}
                placeholder={t('companyProfile.ceoPlaceholder')} aria-required aria-invalid={miss('ceo')} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.website')}>
              <input value={text(value.website)} onChange={(e) => set({ website: orUndefined(e.target.value) })}
                placeholder="www.example.com" className="cth-input" style={fieldStyle} />
            </Field>
          </div>
          {needsIndustry && (
            <Field label={t('companyProfile.industry')} required>
              <input value={text(value.industry)} onChange={(e) => set({ industry: orUndefined(e.target.value) })}
                placeholder={t('companyProfile.industryPlaceholder')} aria-required aria-invalid={miss('industry')} className="cth-input" style={fieldStyle} />
            </Field>
          )}
          <Head>{t('companyProfile.addressHead')}</Head>
          <Field label={t('companyProfile.street')} required>
            <input value={text(value.address?.street)} onChange={(e) => setAddress({ street: orUndefined(e.target.value) })}
              placeholder={t('companyProfile.streetPlaceholder')} aria-required aria-invalid={miss('street')} className="cth-input" style={fieldStyle} />
          </Field>
          <div style={grid2}>
            <Field label={t('companyProfile.city')} required>
              <input value={text(value.address?.city)} onChange={(e) => setAddress({ city: orUndefined(e.target.value) })}
                aria-required aria-invalid={miss('city')} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.region')}>
              <input value={text(value.address?.region)} onChange={(e) => setAddress({ region: orUndefined(e.target.value) })} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.postalCode')}>
              <input value={text(value.address?.postalCode)} onChange={(e) => setAddress({ postalCode: orUndefined(e.target.value) })} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.country')} required>
              <input value={text(value.address?.country)} onChange={(e) => setAddress({ country: orUndefined(e.target.value) })}
                aria-required aria-invalid={miss('country')} className="cth-input" style={fieldStyle} />
            </Field>
          </div>
        </>
      )}

      {parts.includes('details') && (
        <>
          <Head>{t('companyProfile.contactHead')}</Head>
          <div style={grid2}>
            <Field label={t('companyProfile.legalName')}>
              <input value={text(value.legalName)} onChange={(e) => set({ legalName: orUndefined(e.target.value) })}
                placeholder={t('companyProfile.legalNamePlaceholder')} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.entityType')}>
              <select value={value.entityType ?? ''} onChange={(e) => set({ entityType: (e.target.value || undefined) as CompanyProfile['entityType'] })} className="cth-input" style={fieldStyle}>
                <option value="">{t('companyProfile.notSet')}</option>
                {ENTITY_TYPES.map((k) => <option key={k} value={k}>{t(`companyProfile.entity.${k}`)}</option>)}
              </select>
            </Field>
            <Field label={t('companyProfile.phone')}>
              <input value={text(value.phone)} onChange={(e) => set({ phone: orUndefined(e.target.value) })} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.email')}>
              <input value={text(value.email)} onChange={(e) => set({ email: orUndefined(e.target.value) })} className="cth-input" style={fieldStyle} />
            </Field>
          </div>
          <Field label={t('companyProfile.social')} hint={t('companyProfile.socialHint')}>
            <textarea
              value={(value.social ?? []).join('\n')}
              onChange={(e) => {
                const links = e.target.value.split('\n').slice(0, 5);
                set({ social: links.some((l) => l.trim()) ? links : undefined });
              }}
              rows={3}
              className="cth-input"
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </Field>

          <Head>{t('companyProfile.operateHead')}</Head>
          <div style={grid2}>
            <Field label={t('companyProfile.hours')}>
              <input value={text(value.hours)} onChange={(e) => set({ hours: orUndefined(e.target.value) })}
                placeholder={t('companyProfile.hoursPlaceholder')} className="cth-input" style={fieldStyle} />
            </Field>
            <Field label={t('companyProfile.timeZone')}>
              <select value={value.timeZone ?? ''} onChange={(e) => set({ timeZone: e.target.value || undefined })} className="cth-input" style={fieldStyle}>
                <option value="">{t('companyProfile.notSet')}</option>
                {value.timeZone && !timeZones.includes(value.timeZone) && <option value={value.timeZone}>{value.timeZone}</option>}
                {timeZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label={t('companyProfile.serviceArea')}>
              <select value={value.serviceArea ?? ''} onChange={(e) => set({ serviceArea: (e.target.value || undefined) as CompanyProfile['serviceArea'] })} className="cth-input" style={fieldStyle}>
                <option value="">{t('companyProfile.notSet')}</option>
                {SERVICE_AREAS.map((k) => <option key={k} value={k}>{t(`companyProfile.area.${k}`)}</option>)}
              </select>
            </Field>
            <Field label={t('companyProfile.languages')}>
              <input value={text(value.languages)} onChange={(e) => set({ languages: orUndefined(e.target.value) })}
                placeholder={t('companyProfile.languagesPlaceholder')} className="cth-input" style={fieldStyle} />
            </Field>
          </div>

          <Head>{t('companyProfile.moneyHead')}</Head>
          <div style={grid2}>
            <Field label={t('companyProfile.currency')}>
              <select value={value.currency ?? ''} onChange={(e) => set({ currency: e.target.value || undefined })} className="cth-input" style={fieldStyle}>
                <option value="">{t('companyProfile.notSet')}</option>
                {value.currency && !currencies.includes(value.currency) && <option value={value.currency}>{value.currency}</option>}
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={t('companyProfile.fiscalMonth')}>
              <select value={value.fiscalYearStartMonth ?? ''} onChange={(e) => set({ fiscalYearStartMonth: e.target.value ? Number(e.target.value) : undefined })} className="cth-input" style={fieldStyle}>
                <option value="">{t('companyProfile.notSet')}</option>
                {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
          </div>
        </>
      )}

      {parts.includes('hint') && (
        <div style={{
          borderRadius: 'var(--cth-r-md)',
          display: 'flex', flexDirection: 'column', gap: 6, padding: 10,
          background: 'var(--cth-sky-light)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)'
        }}>
          <span style={{ fontSize: 14, lineHeight: '19px', color: 'var(--cth-ink-900)' }}>{t('companyProfile.knowledgeHead')}</span>
          <span style={{ fontSize: 14, lineHeight: '19px', color: 'var(--cth-ink-700)' }}>{t('companyProfile.knowledgeBody')}</span>
          {onOpenKnowledge && (
            <button type="button" onClick={onOpenKnowledge} style={{
              borderRadius: 'var(--cth-r-md)',
              alignSelf: 'flex-start', padding: '4px 10px 2px', border: 'none', cursor: 'pointer',
              background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
              fontFamily: 'var(--cth-font-ui)', fontSize: 14, color: 'var(--cth-ink-900)'
            }}>
              {t('companyProfile.knowledgeOpen')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600, color: 'var(--cth-ink-2)' }}>{label}{required ? ' *' : ''}</span>
      {children}
      {hint && <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-3)' }}>{hint}</span>}
    </label>
  );
}

function Head({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 14, lineHeight: '20px', fontWeight: 600, color: 'var(--cth-ink)', marginTop: 4 }}>
      {children}
    </div>
  );
}

const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

/** The v2 field (DESIGN.md 7.9). Its ring, focus ring and the coral ring for a
 *  missing required answer (aria-invalid) come from the `cth-input` class. */
const fieldStyle: CSSProperties = {
  padding: '7px 10px', border: 'none', background: 'var(--cth-card)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 14, color: 'var(--cth-ink)',
  minWidth: 0
};
