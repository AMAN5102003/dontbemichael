/**
 * Studio scene colors (branding/DESIGN.md 3.4, 8.2 to 8.5), light and dark.
 * These are illustration faces, not UI tokens: the UI around the stage uses the
 * --cth-* tokens. Department families come from tokens.ts; dark twins are
 * derived from them by rule so the two can never drift.
 */
import { departments, type DepartmentName } from '@/design/tokens';

export interface SceneTokens {
  rim: string; rimOp: number;
  platSh: string; platShOp: number; platL: string; platR: string; bandOp: number;
  floor0: string; floor1: string; grid: string; gridOp: number; edgeF: string; edgeB: string;
  /** The program mark lettered on the platform's right side face. */
  markFill: string; markOp: number;
  flowSh: string; flowShOp: number; under: string; underOp: number;
  papSh: string; papShOp: number; papL: string; papR: string; papTop: string;
  postB: [string, string, string]; postP: [string, string, string]; boxFront: string;
  bill: [string, string, string]; slot: string; env: string;
  desk: string; metal: [string, string, string]; kbase: string; mon: [string, string, string];
  kb: string; kbBd: string; mug: string;
  seat: [string, string, string]; back: [string, string, string]; pot: [string, string, string];
  scrOff: string; spillOp: number; bub: string; bubBd: string; inset: string; insetOp: number;
  hbBase: [string, string, string]; hbFloor: [string, string, string]; ring: string;
  board: string; boardBd: string; wall: string; hdesk: [string, string, string];
  tray: [string, string, string]; tray2: [string, string, string];
  hseat: [string, string, string]; hback: [string, string, string];
  reflOp: [number, number]; mbg: string;
  glassB: [string, number, string, number]; glassF: [string, number, string, number];
  glowOp: [number, number]; tokBg: string; stem: string; pole: string; scr0: string;
  req: string; coral: string; green: string; blue: string; violet: string; amber: string; indigo: string;
}

const LIGHT: SceneTokens = {
  rim: '#FFFFFF', rimOp: 0.75,
  platSh: '#8A82C9', platShOp: 0.22, platL: '#D7D3EF', platR: '#C6C0E6', bandOp: 0.45,
  floor0: '#F1EFFB', floor1: '#E4E1F5', grid: '#FFFFFF', gridOp: 0.7, edgeF: '#FFFFFF', edgeB: '#D9D5EF',
  markFill: '#4E4791', markOp: 1,
  flowSh: '#6E66B8', flowShOp: 0.1, under: '#FFFFFF', underOp: 0.9,
  papSh: '#3A3170', papShOp: 0.13, papL: '#E4E1F4', papR: '#D2CEEA', papTop: '#FFFFFF',
  postB: ['#FFFFFF', '#DAD6F0', '#C9C4E8'], postP: ['#F4F3FB', '#E3E0F3', '#CFCBE8'], boxFront: '#FFFFFF',
  bill: ['#FFD3D4', '#FFFFFF', '#FFB3B5'], slot: '#1E1B2E', env: '#FFFFFF',
  desk: '#FFFFFF', metal: ['#5A5570', '#4A4560', '#3C3852'], kbase: '#6A6582', mon: ['#4A4560', '#2E2A42', '#221F33'],
  kb: '#ECEAF5', kbBd: '#D5D1E8', mug: '#FFFFFF',
  seat: ['#FFFFFF', '#DAD6EE', '#C4BFE0'], back: ['#FFFFFF', '#E6E3F4', '#CFCAE6'], pot: ['#FFFFFF', '#E7E4F3', '#D1CCE7'],
  scrOff: '#5E5A74', spillOp: 0.1, bub: '#FFFFFF', bubBd: '#DCD0FB', inset: '#FFFFFF', insetOp: 0.8,
  hbBase: ['#F4F2FD', '#CFC9F0', '#BDB6EA'], hbFloor: ['#FDFDFF', '#D9D4F5', '#C6BFEF'], ring: '#7C6CF2',
  board: '#FFFFFF', boardBd: '#D7D2F2', wall: '#FFFFFF', hdesk: ['#FFFFFF', '#CFC8F7', '#B5ACEF'],
  tray: ['#FFFFFF', '#DCD7F6', '#C8C1F1'], tray2: ['#FFFFFF', '#EEEBFB', '#E0DBF8'],
  hseat: ['#FFFFFF', '#CFC8F7', '#B5ACEF'], hback: ['#FFFFFF', '#DCD6FA', '#C4BCF3'],
  reflOp: [0.28, 0.25], mbg: '#1E1B2E',
  glassB: ['#FFFFFF', 0.78, '#DCD7FA', 0.42], glassF: ['#FFFFFF', 0.42, '#E9E5FF', 0.12],
  glowOp: [0.42, 0.14], tokBg: '#FFFFFF', stem: '#A9A3CF', pole: '#B9B4D3', scr0: '#FFFFFF',
  req: '#5B55C9', coral: '#FF5A5F', green: '#1FB872', blue: '#4C6FFF', violet: '#8B5CF6', amber: '#F2A93B', indigo: '#6C5CE7'
};

const DARK: SceneTokens = {
  ...LIGHT,
  rim: '#FFFFFF', rimOp: 0.13,
  platSh: '#000000', platShOp: 0.55, platL: '#231F36', platR: '#1C1A2C', bandOp: 0.08,
  floor0: '#302B49', floor1: '#26223B', grid: '#FFFFFF', gridOp: 0.05, edgeF: '#4E4870', edgeB: '#2C2842',
  markFill: '#8A83C3', markOp: 1,
  flowSh: '#000000', flowShOp: 0.3, under: '#241F38', underOp: 0.85,
  papSh: '#000000', papShOp: 0.35, papL: '#1C1A28', papR: '#161420', papTop: '#2A2838',
  postB: ['#3C3857', '#2C2942', '#232037'], postP: ['#4C4868', '#37334F', '#2B2841'], boxFront: '#34304B',
  bill: ['#6E383C', '#4A2A30', '#5B2F34'], slot: '#0E0D14', env: '#E4E1EF',
  desk: '#433F5E', metal: ['#6C6786', '#57526F', '#47425E'], kbase: '#6C6786', mon: ['#4C4868', '#36324F', '#2B2842'],
  kb: '#56526F', kbBd: '#6B6788', mug: '#D8D5E6',
  seat: ['#4C4868', '#3A3653', '#2F2B45'], back: ['#55516F', '#423E5A', '#36324C'], pot: ['#4C4868', '#3A3653', '#2F2B45'],
  scrOff: '#23212F', spillOp: 0.22, bub: '#1F1E2B', bubBd: '#4B3F7A', inset: '#FFFFFF', insetOp: 0.1,
  hbBase: ['#2F2B47', '#25223A', '#1E1B2F'], hbFloor: ['#38335A', '#2B2745', '#231F39'], ring: '#9D90FF',
  board: '#1F1E2B', boardBd: '#3C3A55', wall: '#7A70C8', hdesk: ['#46406A', '#34304F', '#2A2742'],
  tray: ['#4C4868', '#3A3653', '#2F2B45'], tray2: ['#5A5578', '#46425F', '#3A3653'],
  hseat: ['#4C4868', '#3A3653', '#2F2B45'], hback: ['#55516F', '#423E5A', '#36324C'],
  reflOp: [0.06, 0.05], mbg: '#6C5CE7',
  glassB: ['#A99FF5', 0.2, '#6C5CE7', 0.08], glassF: ['#B8AEFF', 0.1, '#6C5CE7', 0.03],
  glowOp: [0.62, 0.22], tokBg: '#1F1E2B', stem: '#5E5A7C', pole: '#6C6786', scr0: '#F6F4FF',
  req: '#8F89F2', green: '#34CD8A', blue: '#8FA3FF', violet: '#B69CFF', amber: '#F2B45A', indigo: '#9D90FF'
};

export function sceneTokens(dark: boolean): SceneTokens {
  return dark ? DARK : LIGHT;
}

export interface Family { l: string; m: string; d: string; acc: string; lit: string; litM: string }

function hls(hex: string, L: number, S: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}

/** A department's pastel family in this theme. `lit` and `litM` are the lit
 *  screen colors, which stay light in both themes so a working screen glows. */
export function family(dept: DepartmentName, dark: boolean): Family {
  const c = departments[dept];
  if (!dark) return { ...c, lit: c.l, litM: c.m };
  return { l: hls(c.m, 0.36, 0.34), m: hls(c.m, 0.28, 0.3), d: hls(c.m, 0.22, 0.28), acc: hls(c.acc, 0.7, 0.8), lit: c.l, litM: c.m };
}
