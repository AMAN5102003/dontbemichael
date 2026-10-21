// The Office cast: names, groups and each character's colors. Design v2 draws
// people as avatars in their department's colors (branding/DESIGN.md 3.4); the
// pixel sprites and portraits that used to be painted from here are gone.


export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith'
  // Added so every Office Pack role has its own character: IT, IT security,
  // and the warehouse (inventory & shipping).
  | 'nick' | 'sadiq' | 'darryl'
  // Erin, the receptionist after Pam: same job as Pam (owner, 2026-09-27).
  | 'erin'
  // Pete, the Research member's own face: never a hire's (owner, third ship D4).
  | 'pete';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. */
export const OFFICE_CAST: CastMember[] = [
  { name: 'michael',  displayName: 'Michael',  blurb: "World's best boss" },
  { name: 'jim',      displayName: 'Jim',      blurb: 'Salesman, prankster' },
  { name: 'pam',      displayName: 'Pam',      blurb: 'Receptionist, artist' },
  { name: 'erin',     displayName: 'Erin',     blurb: 'Receptionist' },
  { name: 'dwight',   displayName: 'Dwight',   blurb: 'Assistant (to the) RM' },
  { name: 'kevin',    displayName: 'Kevin',    blurb: 'Accounting' },
  { name: 'angela',   displayName: 'Angela',   blurb: 'Head of accounting' },
  { name: 'oscar',    displayName: 'Oscar',    blurb: 'Accountant' },
  { name: 'stanley',  displayName: 'Stanley',  blurb: 'Sales, crossword' },
  { name: 'phyllis',  displayName: 'Phyllis',  blurb: 'Sales' },
  { name: 'andy',     displayName: 'Andy',     blurb: 'Cornell, a cappella' },
  { name: 'kelly',    displayName: 'Kelly',    blurb: 'Customer service' },
  { name: 'ryan',     displayName: 'Ryan',     blurb: 'The temp' },
  { name: 'toby',     displayName: 'Toby',     blurb: 'Human resources' },
  { name: 'creed',    displayName: 'Creed',    blurb: 'Quality assurance' },
  { name: 'meredith', displayName: 'Meredith', blurb: 'Supplier relations' },
  { name: 'nick',     displayName: 'Nick',     blurb: 'IT' },
  { name: 'sadiq',    displayName: 'Sadiq',    blurb: 'IT security' },
  { name: 'darryl',   displayName: 'Darryl',   blurb: 'Warehouse foreman' },
  { name: 'pete',     displayName: 'Pete',     blurb: 'Research' },
];

/** The Research member's character: Pete is its own, not borrowed from a pack
 *  role (owner, third ship D4). No hire takes it. */
export const RESEARCH_CHARACTER: OfficeCharacterName = 'pete';
/** The cast a hire may take: everyone but the Research member's face. */
export const HIREABLE_CAST: CastMember[] = OFFICE_CAST.filter((c) => c.name !== RESEARCH_CHARACTER);

/** The cast grouped by the kind of work each did in the show, in the order Add
 *  Agent shows them. Related jobs share a group so no group is a lone tile
 *  (owner, 2026-09-27). Every hireable cast member is in exactly one group;
 *  Pete, the Research member's own, is in none. */
export const CAST_GROUPS: { key: string; members: OfficeCharacterName[] }[] = [
  { key: 'office',     members: ['michael', 'pam', 'erin'] },
  { key: 'sales',      members: ['dwight', 'jim', 'stanley', 'phyllis', 'andy', 'ryan'] },
  { key: 'accounting', members: ['oscar', 'angela', 'kevin'] },
  { key: 'people',     members: ['toby', 'kelly'] },
  { key: 'it',         members: ['nick', 'sadiq'] },
  { key: 'operations', members: ['creed', 'meredith', 'darryl'] }
];

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

export const DEFAULT_CHARACTER: OfficeCharacterName = 'jim';


