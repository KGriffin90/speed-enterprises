/**
 * Strips non-digits and formats up to 10 digits as (XXX) XXX-XXXX.
 * Byte-for-byte mirror of apps/web/src/lib/formatPhone.ts so a number typed on
 * one client reads identically on the other.
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
