// Each character's signature prop and each department's icon (owner,
// 2026-10-03: the letter next to a name added nothing; the floor wanted more
// character). A prop stands for the person wherever they appear: their avatar,
// and a small copy on their desk. Drawn on a 24 unit grid in fixed colors so a
// prop reads the same in both themes.
import type { CSSProperties, ReactNode } from 'react';
import type { DepartmentName } from '@/design/tokens';
import { useAppTheme } from '@/design/theme';
import { departmentOf, type Seatable } from '@/scene/studio/layout';
import { family } from '@/scene/studio/theme';
import type { OfficeCharacterName } from './cast';

/** Michael's mug, Pam's palette, Dwight's beet, Jim's tuna, Stanley's pretzel,
 *  Phyllis's knitting, Andy's banjo, Ryan's startup rocket, Oscar's calculator,
 *  Angela's cat, Kevin's chili, Toby's island, Kelly's phone, Creed's sprout,
 *  Meredith's party hat, Nick's router, Sadiq's lock, Darryl's music,
 *  Erin's balloon. */
export const PROP_ART: Record<OfficeCharacterName, ReactNode> = {
  michael: <><path d="M5 7h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#fff" stroke="#1E1B2E" strokeWidth="1.4"/><path d="M16 9.5h1.6a2.6 2.6 0 0 1 0 5.2H16" fill="none" stroke="#A5A2B8" strokeWidth="1.4"/><path d="M7.5 11h6M7.5 13.3h4.5" stroke="#E25A83" strokeWidth="1.3" strokeLinecap="round"/><path d="M8.5 3.5c0 1 1 1 1 2M12 3.5c0 1 1 1 1 2" stroke="#A5A2B8" strokeWidth="1.2" fill="none" strokeLinecap="round"/></>,
  jim: <><ellipse cx="12" cy="8" rx="8" ry="3" fill="#D9DDE8" stroke="#8F8AA6" strokeWidth="1.1"/><path d="M4 8v7c0 1.7 3.6 3 8 3s8-1.3 8-3V8" fill="#5468C4"/><path d="M7.5 13c1.6-1.3 3.4-1.3 5 0l2.5-1.2v2.4L12.5 13c-1.6 1.3-3.4 1.3-5 0z" fill="#fff"/></>,
  pam: <><path d="M12 4C6.5 4 3 7.6 3 12c0 4.2 3.5 7.5 7.8 7.5 1.4 0 1.9-1.2 1.4-2.3-.6-1.4.4-2.6 2-2.6h2.3c2.4 0 4.5-1.7 4.5-4.4C21 6.8 17 4 12 4z" fill="#F6D9B8" stroke="#C99A6B" strokeWidth="1.2"/><circle cx="8" cy="10" r="1.6" fill="#E25A83"/><circle cx="11.5" cy="7.6" r="1.6" fill="#3D8BE6"/><circle cx="15.6" cy="8.6" r="1.6" fill="#D29B0B"/><circle cx="7.6" cy="14" r="1.6" fill="#1FA872"/></>,
  erin: <><ellipse cx="12" cy="9" rx="6" ry="7" fill="#F7C3D2" stroke="#E25A83" strokeWidth="1.2"/><path d="M12 16l-1 1.5h2zM12 17.5c0 2 -2 2.5 -1 4.5" stroke="#E25A83" strokeWidth="1.2" fill="none"/><ellipse cx="9.8" cy="6.8" rx="1.4" ry="2" fill="#fff" opacity=".7"/></>,
  dwight: <><path d="M12 9c3.6 0 6 2.4 6 5.4 0 3.2-3 5.8-6 7.6-3-1.8-6-4.4-6-7.6C6 11.4 8.4 9 12 9z" fill="#B0306A"/><path d="M12 9c-.5-2.5-2.5-4.5-5-5 .3 2.6 2.2 4.4 5 5zM12 9c.5-2.8 2.4-5 5.2-5.6-.2 2.9-2.2 5-5.2 5.6z" fill="#3FA463"/><path d="M12 22v1.5" stroke="#B0306A" strokeWidth="1.2"/></>,
  kevin: <><path d="M3.5 11h17l-1.4 7a2.5 2.5 0 0 1-2.5 2H7.4a2.5 2.5 0 0 1-2.5-2z" fill="#E5533D"/><rect x="2.5" y="9.6" width="19" height="2.2" rx="1.1" fill="#B83C2A"/><path d="M8 7.5c0-1.4 1.4-1.4 1.4-2.8M12 7.5c0-1.4 1.4-1.4 1.4-2.8M16 7.5c0-1.4 1.4-1.4 1.4-2.8" stroke="#A5A2B8" strokeWidth="1.2" fill="none" strokeLinecap="round"/></>,
  angela: <><path d="M5 8l1.5-5 4 3.3h3L17.5 3 19 8c1.3 1.8 2 3.6 2 5.5 0 4-4 6.5-9 6.5s-9-2.5-9-6.5c0-1.9.7-3.7 2-5.5z" fill="#ECEAF4" stroke="#8F8AA6" strokeWidth="1.2"/><circle cx="9" cy="12.5" r="1" fill="#1E1B2E"/><circle cx="15" cy="12.5" r="1" fill="#1E1B2E"/><path d="M11 15h2l-1 1z" fill="#E25A83"/></>,
  oscar: <><rect x="6" y="3" width="12" height="18" rx="2" fill="#D8F5E8" stroke="#1FA872" strokeWidth="1.2"/><rect x="8" y="5.5" width="8" height="3.5" rx=".8" fill="#fff" stroke="#1FA872" strokeWidth=".9"/><g fill="#1FA872"><circle cx="9" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="15" r=".9"/><circle cx="12" cy="15" r=".9"/><circle cx="15" cy="15" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="12" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/></g></>,
  stanley: <><path d="M12 18c-4 0-7-2.5-7-6 0-2.6 2-4.5 4.3-4.5 2.3 0 3.6 1.7 2.7 4.3L8.8 18M12 18c4 0 7-2.5 7-6 0-2.6-2-4.5-4.3-4.5-2.3 0-3.6 1.7-2.7 4.3L15.2 18" fill="none" stroke="#B5772F" strokeWidth="2.6" strokeLinecap="round"/><circle cx="8" cy="10" r=".7" fill="#fff"/><circle cx="16" cy="10" r=".7" fill="#fff"/><circle cx="12" cy="15.5" r=".7" fill="#fff"/></>,
  phyllis: <><circle cx="11" cy="13" r="7" fill="#F7C3D2" stroke="#E25A83" strokeWidth="1.1"/><path d="M5.5 10c3 1 7 1 11-1M4.6 14c3.5 1.4 8 1.4 12.6-.4M7 18.5c2.5-3 2.8-7.6 1.2-11.6M13 19.8c1.5-3.4 1.6-8.4 0-12.6" stroke="#E25A83" strokeWidth=".9" fill="none"/><path d="M15 4l5 14" stroke="#8F8AA6" strokeWidth="1.4" strokeLinecap="round"/></>,
  andy: <><circle cx="9" cy="15" r="6" fill="#FFF3CC" stroke="#B5772F" strokeWidth="1.3"/><circle cx="9" cy="15" r="3.6" fill="#fff" stroke="#D9C9A8"/><path d="M12.8 11.2l7-7" stroke="#8A5A2B" strokeWidth="2.2" strokeLinecap="round"/><path d="M18 3.5l2.5 2.5" stroke="#1E1B2E" strokeWidth="1.6" strokeLinecap="round"/></>,
  kelly: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="#DDEEFF" stroke="#3D8BE6" strokeWidth="1.2"/><path d="M12 15.5s-3.3-2-3.3-4.2a1.8 1.8 0 0 1 3.3-1 1.8 1.8 0 0 1 3.3 1c0 2.2-3.3 4.2-3.3 4.2z" fill="#E25A83"/></>,
  ryan: <><path d="M14 3c3.8.6 6.4 3.2 7 7l-7.6 7.6-6-6z" fill="#F9C8AE" stroke="#E57B45" strokeWidth="1.2"/><circle cx="15.4" cy="8.6" r="1.8" fill="#fff" stroke="#E57B45"/><path d="M7.4 11.6L4 12l3-4h4M12.4 16.6L12 20l4-3v-4" fill="#E57B45"/><path d="M6 18c-1 1-1.5 2.6-1.5 2.6S6 20 7 19" stroke="#D29B0B" strokeWidth="1.4" fill="none"/></>,
  toby: <><path d="M12 21V10" stroke="#8A5A2B" strokeWidth="2"/><path d="M12 10C9 6 5 6 3 8c3-.5 6 .5 9 2zM12 10c3-4 7-4 9-2-3-.5-6 .5-9 2zM12 10c-1-4-4-6.5-7-6.5 2.5 1 5 3.5 7 6.5zM12 10c1-4 4-6.5 7-6.5-2.5 1-5 3.5-7 6.5z" fill="#3FA463"/><ellipse cx="12" cy="21" rx="6" ry="1.3" fill="#F8DF95"/></>,
  creed: <><path d="M6 20h12l-1.4-6H7.4z" fill="#D9A27A"/><path d="M12 14V9" stroke="#3FA463" strokeWidth="1.6"/><path d="M12 10c-1-2.6-3.6-3.8-6-3.4.6 2.6 3 4 6 3.4zM12 9c1-3 3.8-4.4 6.4-3.8-.6 3-3.4 4.4-6.4 3.8z" fill="#3FA463"/><circle cx="9" cy="17" r=".8" fill="#F6E9C8"/><circle cx="12" cy="16.4" r=".8" fill="#F6E9C8"/><circle cx="15" cy="17.2" r=".8" fill="#F6E9C8"/></>,
  meredith: <><path d="M12 3l6 15H6z" fill="#A9E3E5" stroke="#169BA3" strokeWidth="1.2"/><circle cx="12" cy="3" r="1.6" fill="#E57B45"/><path d="M8.6 12l6.8 0M7.4 15h9.2" stroke="#169BA3" strokeWidth="1.1"/><circle cx="10" cy="9.5" r=".8" fill="#E25A83"/><circle cx="14" cy="13.5" r=".8" fill="#D29B0B"/></>,
  nick: <><rect x="3" y="12" width="18" height="7" rx="2" fill="#E0E6F7" stroke="#5468C4" strokeWidth="1.2"/><path d="M7 12V5M17 12V5" stroke="#5468C4" strokeWidth="1.4" strokeLinecap="round"/><circle cx="7" cy="15.5" r="1" fill="#1FA872"/><circle cx="10.5" cy="15.5" r="1" fill="#1FA872"/><circle cx="14" cy="15.5" r="1" fill="#D29B0B"/></>,
  sadiq: <><rect x="5" y="10.5" width="14" height="10" rx="2" fill="#E0E6F7" stroke="#5468C4" strokeWidth="1.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="#5468C4" strokeWidth="1.6"/><circle cx="12" cy="15" r="1.5" fill="#5468C4"/><path d="M12 15v2.6" stroke="#5468C4" strokeWidth="1.4"/></>,
  darryl: <><path d="M9 17V5l11-2v12" fill="none" stroke="#169BA3" strokeWidth="1.8"/><ellipse cx="6.8" cy="17.2" rx="2.8" ry="2.2" fill="#169BA3"/><ellipse cx="17.8" cy="15.2" rx="2.8" ry="2.2" fill="#169BA3"/><path d="M9 8.5l11-2" stroke="#169BA3" strokeWidth="1.6"/></>,
};

/** Line icons by job function, stroked in the current color. */
export const DEPT_ART: Record<DepartmentName, ReactNode> = {
  'front-desk': <><path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5 13l2-7h10l2 7v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/></>,
  'support': <><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.6-2.2 2.5-5 2.5"/></>,
  'sales': <><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></>,
  'finance': <><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6"/><path d="M5 12v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-6"/></>,
  'marketing': <><path d="M3 10v4h3l7 4V6L6 10z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M18.6 6.4a6.5 6.5 0 0 1 0 11.2"/></>,
  'people': <><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.9.3 5.4 1.9 5.4 4.8"/></>,
  'it': <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M9.5 8.3L7.3 10l2.2 1.7M14.5 8.3l2.2 1.7-2.2 1.7"/></>,
  'operations': <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></>,
  'team': <><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></>,
};

/** Michael's mug sits on ink in both themes (the theme's --cth-ink flips in
 *  dark), with paper for an initial. One place, so the avatar and the chart agree. */
export const INK_FIXED = '#1E1B2E';
export const PAPER_FIXED = '#F7F7FB';

export function hasProp(character: string | undefined): character is OfficeCharacterName {
  return !!character && Object.prototype.hasOwnProperty.call(PROP_ART, character);
}

/** A character's prop as an SVG, for a desk or a chip. */
export function PropGlyph({ character, size }: { character: OfficeCharacterName; size: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>{PROP_ART[character]}</svg>;
}

/** A department's icon. */
export function DeptIcon({ dept, size = 11, strokeWidth = 2.2, color = 'currentColor' }: {
  dept: DepartmentName; size?: number; strokeWidth?: number; color?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      {DEPT_ART[dept]}
    </svg>
  );
}

/**
 * A person's avatar: their prop on their department's pastel, Michael's mug
 * on ink. Someone with no known character keeps the initial of their name.
 * `ring` draws an outer ring (the speaker in a chip, a selection).
 */
export function PersonAvatar({ who, size, ring, separator, style, className }: {
  who: Seatable & { name?: string; isGod?: boolean };
  size: number;
  ring?: string;
  /** A 1.5px card-colored gap around it, where avatars overlap in a chip. */
  separator?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const dark = useAppTheme() === 'dark';
  const god = !!who.isGod;
  const fam = god ? null : family(departmentOf(who), dark);
  const prop = hasProp(who.character) ? who.character : god ? 'michael' : null;
  // A prop sits on the light pastel in both themes, so its colors read the
  // same; Michael's white mug sits on ink, which stays dark in both.
  const edge = fam ? `inset 0 0 0 1px ${prop ? fam.litM : fam.m}` : dark ? 'inset 0 0 0 1px var(--cth-line-2)' : 'none';
  return (
    <span aria-hidden="true" className={className} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-grid', placeItems: 'center',
      background: fam ? (prop ? fam.lit : fam.l) : INK_FIXED, color: fam ? fam.acc : PAPER_FIXED,
      boxShadow: ring ? `0 0 0 1.5px var(--cth-card), 0 0 0 3px ${ring}${fam ? `, ${edge}` : ''}` : separator ? `0 0 0 1.5px var(--cth-card)${edge === 'none' ? '' : `, ${edge}`}` : edge,
      fontFamily: 'var(--cth-font-ui)', fontSize: Math.round(size * 0.42), fontWeight: 700, lineHeight: 1, overflow: 'hidden',
      ...style
    }}>
      {prop ? <PropGlyph character={prop} size={Math.round(size * 0.72)} /> : (who.name ?? who.id).slice(0, 1).toUpperCase()}
    </span>
  );
}
