import type { PricingRule, Question } from '@speed-enterprises/shared';

/**
 * Generic, deterministic pricing engine. Given a service's base price, its
 * declared questions (for type info), the answers the customer provided, and
 * the service's pricing rules, produce a total and a structured breakdown.
 *
 * The breakdown is stored on QuoteRequest.pricingBreakdown so admins can see
 * exactly why a quote came out where it did — and so the customer-facing
 * estimate can show line items.
 *
 * Rules run in `order` ascending. Each rule's effect can:
 *   - add(cents)              → add a flat amount
 *   - multiply(factor)        → multiply the running subtotal
 *   - per_unit(qid, cents)    → add answers[qid] * cents
 *   - tier(qid, tiers[])      → step function based on answers[qid]
 *   - volume_discount(qid, …) → apply % off when answers[qid] >= threshold
 *   - min_price(cents)        → floor on the subtotal
 *   - max_price(cents)        → cap on the subtotal
 *
 * NOTE: Money flows in integer cents. `multiply` introduces rounding; we
 * round half-up to the nearest cent and record the rounding delta in the
 * breakdown.
 */

export interface PricingResult {
  subtotalCents: number;
  totalCents: number;
  breakdown: BreakdownStep[];
  appliedRuleIds: string[];
}

export interface BreakdownStep {
  ruleId: string | null;
  label: string;
  deltaCents: number;   // signed change to running total
  runningCents: number; // total after this step
  meta?: Record<string, unknown>;
}

export function computePricing(args: {
  basePriceCents: number;
  questions: Question[];
  answers: Record<string, unknown>;
  rules: PricingRule[];
}): PricingResult {
  const { basePriceCents, answers, rules } = args;

  const breakdown: BreakdownStep[] = [];
  let running = basePriceCents;

  breakdown.push({
    ruleId: null,
    label: 'Base price',
    deltaCents: basePriceCents,
    runningCents: running,
  });

  const appliedRuleIds: string[] = [];
  const sorted = [...rules].sort((a, b) => a.order - b.order);

  for (const rule of sorted) {
    if (!ruleApplies(rule, answers)) continue;

    let delta = 0;
    let meta: Record<string, unknown> | undefined;

    switch (rule.effect.kind) {
      case 'add': {
        delta = rule.effect.cents;
        break;
      }
      case 'multiply': {
        const next = Math.round(running * rule.effect.factor);
        delta = next - running;
        meta = { factor: rule.effect.factor };
        break;
      }
      case 'per_unit': {
        const qty = toNumber(answers[rule.effect.questionId]);
        if (qty == null) continue;
        delta = qty * rule.effect.cents;
        meta = { questionId: rule.effect.questionId, qty, unitCents: rule.effect.cents };
        break;
      }
      case 'tier': {
        const val = toNumber(answers[rule.effect.questionId]);
        if (val == null) continue;
        const tier = rule.effect.tiers.find((t) => val <= t.upTo);
        if (!tier) continue;
        delta = tier.cents;
        meta = { questionId: rule.effect.questionId, value: val, tierUpTo: tier.upTo };
        break;
      }
      case 'volume_discount': {
        const qty = toNumber(answers[rule.effect.questionId]);
        if (qty == null) continue;
        // Pick the highest threshold the qty meets
        const best = [...rule.effect.thresholds]
          .sort((a, b) => b.atLeast - a.atLeast)
          .find((t) => qty >= t.atLeast);
        if (!best) continue;
        const next = Math.round(running * (1 - best.percentOff / 100));
        delta = next - running;
        meta = { questionId: rule.effect.questionId, qty, percentOff: best.percentOff };
        break;
      }
      case 'min_price': {
        if (running >= rule.effect.cents) continue;
        delta = rule.effect.cents - running;
        meta = { floor: rule.effect.cents };
        break;
      }
      case 'max_price': {
        if (running <= rule.effect.cents) continue;
        delta = rule.effect.cents - running;
        meta = { cap: rule.effect.cents };
        break;
      }
    }

    if (delta !== 0 || rule.effect.kind === 'multiply') {
      running += delta;
      appliedRuleIds.push(rule.id);
      breakdown.push({
        ruleId: rule.id,
        label: rule.label,
        deltaCents: delta,
        runningCents: running,
        meta,
      });
    }
  }

  return {
    subtotalCents: basePriceCents,
    totalCents: Math.max(0, running),
    breakdown,
    appliedRuleIds,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function ruleApplies(rule: PricingRule, answers: Record<string, unknown>): boolean {
  if (!rule.when || rule.when.length === 0) return true;
  return rule.when.every((cond) => evaluate(cond, answers));
}

type Op =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin' | 'truthy' | 'falsy';

interface Cond { questionId: string; op: Op; value?: unknown }

function evaluate(cond: Cond, answers: Record<string, unknown>): boolean {
  const actual = answers[cond.questionId];
  switch (cond.op) {
    case 'eq':     return actual === cond.value;
    case 'neq':    return actual !== cond.value;
    case 'gt':     return toNumber(actual)! >  toNumber(cond.value)!;
    case 'gte':    return toNumber(actual)! >= toNumber(cond.value)!;
    case 'lt':     return toNumber(actual)! <  toNumber(cond.value)!;
    case 'lte':    return toNumber(actual)! <= toNumber(cond.value)!;
    case 'in':     return Array.isArray(cond.value) && cond.value.includes(actual as any);
    case 'nin':    return Array.isArray(cond.value) && !cond.value.includes(actual as any);
    case 'truthy': return Boolean(actual);
    case 'falsy':  return !actual;
    default: return false;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}
