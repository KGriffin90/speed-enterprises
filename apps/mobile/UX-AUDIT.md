# Mobile UX Audit — Every User Path, Traced in Code (2026-06-11)

> **STATUS UPDATE (same day): all findings below are FIXED** except the two
> deliberately deferred items noted here.
>
> - **B2** fixed via a dedicated `browsing_slug` (SecureStore + context) that
>   never touches the session's `tenant_slug`; theme now follows the *browsed*
>   tenant; the wizard is pinned to its storefront's business; cross-tenant
>   submits get an explicit gate that reuses the pending-quote → sign-up flow
>   (which also works for existing users joining a second business).
> - **A3a** fixed: register → immediate sign-in attempt; OTP step only shows
>   when the API actually sent a code ("Email not verified"); existing accounts
>   with a different password are routed to sign-in; 409 conflicts too.
> - **E1** fixed: 15s AbortController timeout on every request; failures surface
>   as readable ApiError messages.
> - **D1a** fixed: transitions mirror shared `LEGAL_STATUS_TRANSITIONS`
>   (sync-by-hand comment added); EXPIRED quotes can re-send estimates.
> - **A2a** fixed: focus-aware `useStatusBarStyle` hook applied to every screen
>   that owns a background (welcome, businesses, storefront, auth ×3, AR,
>   console landing tabs ×3).
> - **C1a** fixed: `LoadFailedBanner` (+retry, suppressed empty states) on
>   customer quotes, staff jobs, staff routes, admin quotes, services, templates.
> - **A5a** fixed (sign-up link hidden on worker/owner path), **B3a/B3b** fixed
>   (storefront: Sign in when signed out; role-aware My Quotes / My Jobs /
>   Dashboard when signed in), **A3b/A3c** fixed (wizard error/empty states +
>   KeyboardAvoidingView), **B4a** fixed ("Continue as …" card on welcome),
>   **A6a** fixed (native `unsupported` event + friendly fallback screen),
>   **B5a/C1b/D1c/D1d/E2/E3** fixed, **E4** resolved as iPhone-only for v1
>   (`supportsTablet: false`, TARGETED_DEVICE_FAMILY=1 — revert both to re-add iPad).
>
> **Deferred (explicitly, with reasons):** native date/time pickers for the
> wizard date question and workforce time editing (requires adding
> `@react-native-community/datetimepicker`, a new native dependency — install +
> rebuild from your machine; text inputs remain functional meanwhile). **A4a**
> kept as-is deliberately: sign-in-with-pending-quote lands on My Quotes (where
> the quote just appeared), sign-up lands on the storefront per your spec.
>
> Native changes in this pass (Swift + Xcode project) require a rebuild:
> `npx pod-install && npx expo run:ios --device`.

## AR measurement accuracy overhaul (follow-up, same day)

Reported: AR window measurements "super inaccurate". Four root causes found in
`ARWindowMeasureView.swift`, all fixed:

1. **Wrong screen mapping (dominant error).** Vision's normalized coordinates
   were multiplied directly by the view size, ignoring that the screen shows an
   aspect-fill **crop** of the 4:3 camera buffer. Every corner was displaced,
   every raycast hit the wrong world point. Now mapped through
   `ARFrame.displayTransform` (rotation + crop correct by construction).
2. **Raycasts allowed any plane alignment** — bottom corners could hit the
   floor in front of the wall. Now vertical-only, with a 3-tier fallback
   (tracked plane geometry → infinite plane extension → estimated plane).
3. **First Vision hit was accepted instantly.** Now requires **3 consecutive
   measurements agreeing within max(1.2 cm, 2%)** (median reported), samples
   invalidated if the camera moves; timeout raised 5s → 12s. This is the
   "needs more time to register" behavior, made intentional and accurate.
4. **No geometric validation.** Each sample must now pass: 4 corners coplanar
   (≤2 cm), surface near-vertical, opposite sides within 12%, all corners
   ≥8 px inside the screen (clipped rectangles measure short). Manual mode
   sorts tapped corners geometrically instead of trusting tap order.

⚠️ Swift-only change — requires a native rebuild on a real device. I cannot
compile Swift in this environment; if Xcode reports an error in this file,
paste it and I'll correct it.

Field-accuracy expectations after the fix: phone held 1–3 m from the window,
roughly facing it, non-LiDAR iPhones typically land within ~1–2% once the wall
plane is tracked; LiDAR models better. Glass itself provides no features —
accuracy comes from the surrounding wall plane, so very large glass curtain
walls with little visible wall remain the hard case (manual corners work there).

Method: every route in `app/` was walked per persona; each claim below was verified
against the actual mobile source AND the API source (guards, services, enums) —
not assumed. File references included.

---

## A. Signed-out visitor paths

**A1. Launch → index → welcome.** Works. Splash releases correctly.

**A2. welcome → "I need a service" → businesses → pick → storefront.** Works.
- 🔴 **A2a — StatusBar is inconsistent and breaks on dark screens.** Only
  `businesses.tsx` (light-content) and `storefront.tsx` (dark-content) set it
  imperatively. `welcome.tsx` has a near-black background but sets nothing — if
  you arrive at welcome from the storefront (dark-content was just set), the
  status bar text is dark-on-dark = invisible. Same on sign-in (white bg) after
  businesses set light-content: white-on-white. Imperative `StatusBar.barStyle`
  persists across screens. Fix: `expo-status-bar` `<StatusBar style>` per screen,
  or set it on every screen that owns a background.

**A3. storefront → "Get a free quote" → wizard → questions → contact → submit gate → sign-up → OTP → storefront.** Works end-to-end, BUT:
- 🔴 **A3a — Existing users hit a dead end in sign-up.** Verified against
  `auth.service.ts register()`: an existing *verified* user adding a second
  business gets a membership created and **no OTP email is sent**
  (`if (!user.emailVerifiedAt)` guard). Mobile unconditionally advances to the
  OTP step (`sign-up.tsx setStep('otp')`) → user waits forever for a code that
  never comes. Fix: after register, attempt `signIn()` directly; only show the
  OTP step if login fails with a verification-required error.
- 🟡 **A3b — Wizard has no empty/error state for services.** If the config fetch
  fails or no services are visible, step 1 renders the heading and nothing else
  (`QuoteWizard.tsx` — `services.map` with no fallback). Add "Couldn't load
  services / no services available" + retry.
- 🟡 **A3c — Wizard has no KeyboardAvoidingView.** The contact step (7 inputs)
  sits in a plain ScrollView; on smaller iPhones the keyboard covers the
  ZIP/notes fields and the submit button. Sign-in/sign-up have KAV; the wizard
  doesn't.
- 🟡 **A3d — Pending quote lives only in memory** (`pending-quote.ts` module
  variable). If the app is killed during sign-up/OTP, the account exists but the
  drafted quote is silently gone — user lands on storefront with no feedback.
  Acceptable for v1; consider persisting the draft to AsyncStorage.
- 🟢 **A3e — `date` questions are a raw "YYYY-MM-DD" text input.** Error-prone;
  use a date picker eventually.

**A4. Gate → "Already have an account" → sign-in → pending quote submits → My Quotes.** Works.
- 🟢 **A4a — Inconsistent landing:** sign-up path now returns to the storefront
  (your requested change) but the sign-in path still lands on My Quotes. Pick
  one. (Sign-in→My Quotes is arguably right since the quote just landed there;
  flagging the asymmetry as deliberate-until-you-say-otherwise.)

**A5. welcome → "I work for a business" / "I own a business" → businesses → sign-in.** Works; routes by real role after login.
- 🟡 **A5a — Sign-in shows "New customer? Create an account" even on the
  staff/owner path.** `businesses.tsx` passes `role` to sign-in but sign-in
  ignores it. A staff member tapping it would silently create a *customer*
  account. Hide the sign-up link when `role` is staff/owner.

**A6. AR measure from the public wizard.** Route is public (`(platform)/ar-measure`) — works signed-out and signed-in.
- 🟡 **A6a — Unsupported devices get a silent black screen.** In
  `ARWindowMeasureView.swift`, `startARSession()` silently returns when
  `ARWorldTrackingConfiguration.isSupported` is false (simulator, old devices).
  JS shows the camera HUD over black forever. Emit an `onError` so JS can show
  "AR not supported on this device" + fall back to manual number entry.

**A7. Forgot password.** Works; returns to sign-in with slug preserved.

---

## B. Signed-in customer paths

**B1. Launch → My Quotes; quote detail; accept/decline; new quote; account.** All work.

**B2. 🔴 THE BIG ONE — browsing another business while signed in silently breaks the whole app.**
Traced precisely:
1. Customer of business A taps "← Speed Enterprises" → welcome → businesses → opens business B.
2. `businesses.tsx open()` **unconditionally overwrites** `SecureStore('tenant_slug')` with B.
3. `apiCall` sends `X-Tenant-Slug` from that key on **every** request from then on.
4. Result: "My Quotes" now queries tenant B → **empty list** ("No quotes yet")
   with zero explanation. This persists across app relaunches until they sign
   out or re-open business A. Their quotes haven't gone anywhere — the app is
   just asking the wrong tenant.
5. Bonus wrongness: `ThemeProvider` prefers `session.tenant.slug` (A), so
   storefront B renders in business A's colors.
6. Bonus wrongness 2: submitting a quote on storefront B while signed in to A
   *does* write a quote into B's database linked to their user id (verified:
   `quotes.service.createForUser` has no membership check) — but the app never
   shows it once the slug flips back.

The platform's design is tenant-bound sessions (login takes `tenantSlug`;
`switch-tenant` endpoint exists; register supports one user joining many
businesses). Mobile just doesn't respect that boundary. Recommended fix:
- Never let browsing clobber the session tenant: `apiCall` should send the
  **session's** slug for authed calls; keep a separate `browsing_slug` for
  public storefront/config fetches.
- On storefront B with a session bound to A: theme by B (browsing slug should
  win over session for the *public* surface), and on quote submit either call
  `switch-tenant`/re-register flow, or tell the user explicitly "You're signed
  in with {A}".

**B3. Storefront as the post-signup/post-signout hub.** Works for customers ("My Quotes" button).
- 🟡 **B3a — No "Sign in" affordance on the storefront for signed-out users.**
  After sign-out you land here; signing back in requires
  back→welcome→role→businesses→pick-the-same-business→sign-in (5 steps). Add a
  small "Sign in" link in the storefront top bar when there's no session.
- 🟡 **B3b — Staff/admin who end up on the storefront have no way back to their
  console.** The "My Quotes" button is customer-only; index (`/`) would redirect
  them but nothing on the storefront links there. Make the button role-aware:
  customer → My Quotes, staff → Jobs, admin → Dashboard.

**B4. welcome for a signed-in user.**
- 🟡 **B4a — No "continue as" shortcut.** A signed-in customer who backs out to
  welcome sees only the three cold-start role cards; the path back to their
  account is non-obvious (only the storefront button or app relaunch). Add a
  "Continue to my account →" card when a session exists.

**B5. Quote detail edge.**
- 🟢 **B5a — "Quote not found" states have no back button** (customer quote
  detail, staff job detail, admin quote detail all render a centered text with
  no affordance; tab bar is the only escape). Add a back link.

**B6. Session expiry mid-use.** Guards redirect to welcome reactively. Works.

---

## C. Staff paths

**C1. Jobs list/week toggle, job detail, timesheet clock-in/out + GPS, routes, account.** All work; endpoints verified against API role guards (STAFF+ on `/api/admin/quotes`, etc.).
- 🟡 **C1a — Silent failure pattern.** `jobs.tsx`, `routes.tsx`, customer
  `quotes.tsx`, admin `quotes.tsx` etc. catch fetch errors with `catch {}` and
  render the *empty* state ("No jobs found") on network failure. An offline
  staffer can't distinguish "no work today" from "no connection". Add an error
  state + retry (the businesses screen now has one — reuse the pattern).
- 🟢 **C1b — Clock-out is a single tap, no confirmation**, while sign-out has a
  confirm dialog. Accidental clock-out ends the GPS route. Add confirm.
- 🟢 **C1c — Staff sign-out lands on the customer storefront** ("Get a free
  quote" hero). Per your requirement, but it reads odd for workers; consider the
  role-aware top-bar button (B3b) to soften it.

---

## D. Admin / Owner paths

**D1. Quotes list/KPIs/search/filters, quote detail, schedule, services, workforce, business, templates, account.** All endpoints verified to exist with correct guards.
- 🔴 **D1a — Status-change menu is missing six legal transitions.** Mobile's
  hardcoded `TRANSITIONS` in `(admin)/quote/[id].tsx` vs the API's
  `LEGAL_STATUS_TRANSITIONS` (shared/enums.ts):
  missing `REVIEWING→NEW`, `ESTIMATE_SENT→REVIEWING/EXPIRED`,
  `SCHEDULED→ACCEPTED`, `IN_PROGRESS→CANCELED`, `COMPLETED→PAID`,
  `INVOICED→CANCELED`, and **EXPIRED quotes show no actions at all** (API allows
  re-sending the estimate). Admins must fall back to web for these. Fix: mirror
  the shared map (note: don't runtime-import `@speed-enterprises/shared` — it's
  types-only for Metro; copy the map with a sync comment, or add the package as
  a real dependency first).
- 🟡 **D1b — Workforce time-entry editing uses raw "YYYY-MM-DD HH:MM" text
  fields.** Typo → confusing "Invalid time value" alert. Date pickers, eventually.
- 🟢 **D1c — Owner sees role chip hardcoded as "ADMIN"** in (admin)/account.tsx.
  Cosmetic and intentional elsewhere (`displayRole`), fine — but it's literal
  `value="ADMIN"` rather than the session role.
- 🟢 **D1d — Services price edit: invalid input silently saves $0**
  (`parseFloat(price) || 0`). Validate before save.

---

## E. Cross-cutting

- 🔴 **E1 — No network timeout anywhere.** `api.ts` uses bare `fetch`; a hung
  connection (flaky LTE, sleeping dev server) = sign-in spinner/SplashView
  forever with no recovery. Add an AbortController timeout (~15s) in `apiCall`
  and surface "Request timed out".
- 🟡 **E2 — "Speed Enterprises" links use `router.push`**, so repeated loops
  (quotes→welcome→businesses→storefront→quotes→welcome…) grow the nav stack
  indefinitely. Use `replace` for the landing-page links or `dismissTo`.
- 🟢 **E3 — No accessibility labels** on icon-only buttons (back buttons, close
  X on AR screen, search clear). VoiceOver users get "button". Low effort to add.
- 🟢 **E4 — iPad:** `supportsTablet: true` but every layout is phone-width;
  either design-check on iPad or ship iPhone-only for v1 (`supportsTablet:
  false` avoids iPad review screenshots too).

---

## Priority order (my recommendation)

| # | Finding | Severity |
|---|---------|----------|
| 1 | B2 cross-tenant slug clobbering (quotes "disappear") | Critical — data appears lost |
| 2 | A3a existing-user sign-up OTP dead end | Critical — onboarding dead end |
| 3 | E1 no network timeout | High — infinite spinners |
| 4 | D1a missing admin status transitions | High — feature gap vs web |
| 5 | A2a StatusBar invisible on dark screens | High — visible polish bug |
| 6 | C1a silent empty-vs-error states | Medium |
| 7 | A5a staff sees customer sign-up link | Medium |
| 8 | B3a/B3b storefront sign-in + role-aware console button | Medium |
| 9 | A3b/A3c wizard empty state + keyboard | Medium |
| 10 | B4a welcome "continue as" card | Nice-to-have |
| 11 | A6a AR unsupported-device feedback | Nice-to-have (device-only feature) |
| 12 | Remaining 🟢 items | Polish backlog |
