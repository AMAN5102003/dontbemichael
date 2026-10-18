/**
 * The owner's Claude plan and what it costs (owner, 2026-10-15): on a plan,
 * Pulse shows each member's part of the plan's real price, split by their
 * share of the work, instead of what the same work would cost per use.
 *
 * The plan is read from Claude Code's own account record (plan fields only,
 * never a token); the owner can set the price in Settings, which wins. Prices
 * are the published monthly list prices and can drift, which is why the
 * owner's own figure always comes first.
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */
import type { PulseSnapshot } from './teamPerformance';

export type ClaudePlanId = 'pro' | 'max-5x' | 'max-20x' | 'team' | 'enterprise';

/** Monthly list price in USD, or null where it depends on seats and terms. */
export const PLAN_PRICES: Record<ClaudePlanId, number | null> = {
  pro: 20,
  'max-5x': 100,
  'max-20x': 200,
  team: null,
  enterprise: null
};

export const PLAN_LABELS: Record<ClaudePlanId, string> = {
  pro: 'Claude Pro',
  'max-5x': 'Claude Max 5x',
  'max-20x': 'Claude Max 20x',
  team: 'Claude Team',
  enterprise: 'Claude Enterprise'
};

/** The plan from Claude Code's account record (its organization type and rate
 *  limit tier), or null when it is not a plan this table knows. */
export function planFromAccount(acct: { organizationType?: unknown; organizationRateLimitTier?: unknown; userRateLimitTier?: unknown } | null | undefined): ClaudePlanId | null {
  if (!acct) return null;
  const type = String(acct.organizationType ?? '').toLowerCase();
  const tier = `${String(acct.organizationRateLimitTier ?? '')} ${String(acct.userRateLimitTier ?? '')}`.toLowerCase();
  if (type.includes('max') || tier.includes('max')) return tier.includes('20x') ? 'max-20x' : 'max-5x';
  if (type.includes('pro')) return 'pro';
  if (type.includes('team')) return 'team';
  if (type.includes('enterprise')) return 'enterprise';
  return null;
}

/** The plan Pulse prices by: the owner's price first, else the detected plan's list price. */
export interface PlanPrice { plan: ClaudePlanId | null; label: string | null; monthly: number; source: 'owner' | 'detected' }

export function planPrice(detected: ClaudePlanId | null, ownerMonthly: number | undefined | null): PlanPrice | null {
  const label = detected ? PLAN_LABELS[detected] : null;
  if (typeof ownerMonthly === 'number' && Number.isFinite(ownerMonthly) && ownerMonthly > 0) return { plan: detected, label, monthly: ownerMonthly, source: 'owner' };
  const list = detected ? PLAN_PRICES[detected] : null;
  return list ? { plan: detected, label, monthly: list, source: 'detected' } : null;
}

export const DAYS_PER_MONTH = 365.25 / 12;

/** The plan's cost for the part of [fromMs, toMs] that has passed by `now`. */
export function planCostFor(monthly: number, fromMs: number, toMs: number, now: number): number {
  const elapsed = Math.max(0, Math.min(now, toMs) - fromMs);
  return (monthly * elapsed) / (DAYS_PER_MONTH * 86_400_000);
}

/** Every dollar in a snapshot times `factor`: the period's plan cost over its
 *  pay per use value, so each member's part is their share of the work. */
export function scaleSnapshot(s: PulseSnapshot, factor: number): PulseSnapshot {
  const k = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : v * factor);
  return {
    ...s,
    totalUsd: s.totalUsd * factor,
    members: s.members.map((m) => ({
      ...m,
      usd: m.usd * factor,
      perPiece: Object.fromEntries(Object.entries(m.perPiece).map(([kind, v]) => [kind, (v as number) * factor])),
      costForWork: { ...m.costForWork, perPiece: k(m.costForWork.perPiece), usual: k(m.costForWork.usual) }
    }))
  };
}
