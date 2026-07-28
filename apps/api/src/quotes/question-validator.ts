import { BadRequestException } from '@nestjs/common';
import type { Question } from '@speed-enterprises/shared';

/**
 * Validates an `answers` map against a service's declared `questions`.
 * Honors conditional visibility (a question that isn't visible isn't required).
 * Returns a normalized copy of answers with values coerced to the expected
 * primitive type (number→number, boolean→boolean, etc.).
 *
 * Throws BadRequestException with field-level messages on failure.
 */
export function validateAnswers(
  questions: Question[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const errors: Array<{ field: string; message: string }> = [];

  for (const q of questions) {
    if (!isVisible(q, answers)) continue;
    const raw = answers[q.id];

    if (raw === undefined || raw === null || raw === '') {
      if (q.required) errors.push({ field: q.id, message: `${q.label} is required` });
      continue;
    }

    switch (q.type) {
      case 'number':
      case 'currency':
      case 'rating': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) { errors.push({ field: q.id, message: `${q.label} must be a number` }); continue; }
        if (q.min !== undefined && n < q.min) errors.push({ field: q.id, message: `${q.label} must be ≥ ${q.min}` });
        if (q.max !== undefined && n > q.max) errors.push({ field: q.id, message: `${q.label} must be ≤ ${q.max}` });
        out[q.id] = n;
        break;
      }
      case 'boolean': {
        out[q.id] = raw === true || raw === 'true' || raw === 1 || raw === '1';
        break;
      }
      case 'select': {
        const v = String(raw);
        const valid = q.options?.some(o => o.value === v) ?? true;
        if (!valid) errors.push({ field: q.id, message: `${q.label} must be one of the listed options` });
        out[q.id] = v;
        break;
      }
      case 'multiselect': {
        if (!Array.isArray(raw)) { errors.push({ field: q.id, message: `${q.label} must be a list` }); continue; }
        const vals = raw.map(String);
        if (q.options) {
          const allowed = new Set(q.options.map(o => o.value));
          for (const v of vals) {
            if (!allowed.has(v)) { errors.push({ field: q.id, message: `Unknown option for ${q.label}: ${v}` }); break; }
          }
        }
        out[q.id] = vals;
        break;
      }
      case 'date':
      case 'time':
      case 'text':
      case 'longtext':
      case 'address': {
        out[q.id] = String(raw);
        break;
      }
      case 'photo':
      case 'video':
      case 'file':
      case 'measurement': {
        // Photo/file values are array of UploadedImage ids set after upload; we
        // don't deeply validate here.
        out[q.id] = raw;
        break;
      }
    }
  }

  if (errors.length) {
    throw new BadRequestException({ message: 'Quote answers invalid', errors });
  }
  return out;
}

function isVisible(q: Question, answers: Record<string, unknown>): boolean {
  if (!q.conditional) return true;
  const evalAll = q.conditional.all?.every(c => evalCond(c, answers)) ?? true;
  const evalAny = q.conditional.any?.some(c => evalCond(c, answers)) ?? true;
  return evalAll && evalAny;
}

function evalCond(
  cond: { questionId: string; op: string; value?: unknown },
  answers: Record<string, unknown>,
): boolean {
  const a = answers[cond.questionId];
  switch (cond.op) {
    case 'eq':     return a === cond.value;
    case 'neq':    return a !== cond.value;
    case 'gt':     return Number(a) >  Number(cond.value);
    case 'gte':    return Number(a) >= Number(cond.value);
    case 'lt':     return Number(a) <  Number(cond.value);
    case 'lte':    return Number(a) <= Number(cond.value);
    case 'in':     return Array.isArray(cond.value) && cond.value.includes(a as any);
    case 'nin':    return Array.isArray(cond.value) && !cond.value.includes(a as any);
    case 'truthy': return Boolean(a);
    case 'falsy':  return !a;
    default: return true;
  }
}
