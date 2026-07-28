import { apiCall } from './api';

/**
 * Holds a quote the user built while signed out. The wizard stashes it here when
 * an anonymous user taps "Submit" (the only gated action), then routes them
 * through sign-up / sign-in. After auth succeeds, the auth screen calls
 * `submitPendingQuote()` so the request lands linked to the new session — which
 * is what makes it show up under "My Quotes".
 *
 * Submission goes through the authed `POST /api/quotes` (not `/api/public/quotes`)
 * precisely because the public endpoint creates an *unlinked* guest quote. The
 * tenant is carried by the X-Tenant-Slug header that `apiCall` reads from
 * SecureStore, so no slug needs to travel with the draft.
 */

/** A `CreateQuoteDto` payload — kept local to avoid a hard shared-types coupling. */
export interface QuoteDraft {
  serviceId:     string;
  propertyKind:  'RESIDENTIAL' | 'COMMERCIAL';
  address:       { line1: string; city: string; state: string; postalCode: string; country: string };
  answers:       Record<string, unknown>;
  customerNotes?: string;
  preferredAt?:  string;
}

let pending: QuoteDraft | null = null;

export function setPendingQuote(draft: QuoteDraft): void {
  pending = draft;
}

export function getPendingQuote(): QuoteDraft | null {
  return pending;
}

export function clearPendingQuote(): void {
  pending = null;
}

/**
 * Submit the held draft (if any) through the authenticated quotes endpoint and
 * clear it. Returns the created quote, or null when there was nothing pending.
 * Must be called only after a session exists (token written to SecureStore).
 *
 * Creating is only half the job: `POST /api/quotes` drafts the request at status
 * NEW, and `POST /api/quotes/:id/submit` is what runs notifyOnCreate so the
 * business actually hears about it. Web pairs the two calls in submitAuthed();
 * we do the same here.
 */
export async function submitPendingQuote<T = unknown>(): Promise<T | null> {
  if (!pending) return null;
  const draft = pending;
  pending = null;
  const created = await apiCall<T & { id: string }>('POST', '/api/quotes', draft);
  await apiCall('POST', `/api/quotes/${created.id}/submit`, {});
  return created;
}
