/**
 * Appointment/booking primitives shared by the customer BookingPanel and the
 * admin SchedulingPanel.
 *
 * Mirrors apps/web/src/app/dashboard/quotes/[id]/BookingSection.tsx and
 * apps/web/src/app/admin/quotes/[id]/SchedulingPanel.tsx — same types, same
 * timezone resolution, same display format. Kept in one place here because the
 * two panels talk to the same endpoints and must agree on the wire shape.
 */

/** A conflict-free window returned by GET /api/appointments/slots. */
export interface Slot {
  startAt: string;
  endAt: string;
  label: string;
}

export interface Appointment {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'RESCHEDULED';
  mode: 'SELF_SERVE' | 'PROPOSED';
  startAt: string | null;
  endAt: string | null;
  customerTimezone: string;
  businessTimezone: string;
  rescheduleToken: string | null;
  cancelToken: string | null;
  proposedSlots: Slot[] | null;
}

/**
 * A self-serve "pick a slot" flow maps cleanly to fixed-length jobs that fit in
 * a single work day. Anything longer routes to the owner-driven propose-slots
 * flow instead. MUST match SELF_SERVE_MAX_MINUTES on web.
 */
export const SELF_SERVE_MAX_MINUTES = 480;

/**
 * The device timezone, resolved the same way web does. Hermes ships full ICU on
 * RN 0.81, but the try/catch keeps an older JS engine (or a device with a
 * broken zone database) from taking the whole booking panel down.
 */
export const CUSTOMER_TZ: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
  } catch {
    return 'America/Denver';
  }
})();

/** Web's `fmt()` — "Tue, Mar 4, 9:00 AM" in the given zone. */
export function fmtInZone(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: tz,
    });
  } catch {
    // Some Android builds reject an explicit timeZone; fall back to local time.
    return new Date(iso).toLocaleString();
  }
}

/** Business-local format used by the admin panel (no explicit zone, like web). */
export function fmtLocal(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** "America/Denver" → "America/Denver" with underscores humanised, as on web. */
export function humanZone(tz: string): string {
  return tz.replace(/_/g, ' ');
}
