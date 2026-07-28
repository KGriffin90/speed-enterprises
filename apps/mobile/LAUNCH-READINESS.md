# Mobile iOS Launch Readiness — Audit & Fixes (2026-06-10)

## Update — second fix pass (same day)

1. **Tenant-flow routing**: account creation now lands back on the tenant storefront (not "My Quotes"); sign-out (and account deletion) returns to the tenant storefront (not the platform sign-in). Signed-in customers get a "My Quotes" button in the storefront top bar so it's never a dead end.
2. **Back-to-platform buttons**: top-left back affordances added — storefront back now goes to the Speed Enterprises landing; sign-in/sign-up/forgot-password got a top-left back; customer Quotes/Account screens link back to the landing page.
3. **SOLAR industry**: added to shared enum + labels (dist rebuilt), Prisma schema, two migrations (enum value + `es-solar` backfill — split because PG can't use a new enum value in the transaction that adds it), seed file, and mobile label/emoji maps (☀️ Solar).
   → Run `pnpm prisma:generate && pnpm prisma:migrate` (the one API typecheck error about `"SOLAR"` disappears after generate). Restart the API.
4. **AR "Unimplemented component" fixed**: root cause — `expo-modules-autolinking` v3 only discovers podspecs **one level below** the module root; `ar-window-measure.podspec` sat at the root, so the module was silently dropped from `ExpoModulesProvider.swift` (and from the generated `expo-configure-project.sh` package list). Moved the podspec to `modules/ar-window-measure/ios/` (canonical layout), fixed its internal paths, and patched the generated script.
   → Run `cd apps/mobile && npx pod-install && npx expo run:ios --device`. ARKit requires a **physical iPhone**, not the simulator.


Scope: `apps/mobile` (+ two small `apps/api` additions it required). `apps/web` untouched.

## Fixed in this pass

**Bugs**
1. **Sign-in role routing** — staff/admin always landed on customer tabs (`isStaff` read from a stale closure). `signIn()` now returns the session; routing uses the fresh role. (`src/lib/auth-context.tsx`, `app/(auth)/sign-in.tsx`)
2. **Admin internal notes saved to a nonexistent endpoint** — mobile PATCHed `/api/admin/quotes/:id`, which didn't exist. Added the ADMIN-guarded endpoint + `adminUpdate` service method in `apps/api` (zod-validated, tenant-scoped).
3. **No route guards** — `(customer)`, `(staff)`, `(admin)` groups rendered for anyone, including expired sessions. Each layout now redirects on missing session / insufficient role, which also handles mid-use session expiry.
4. **AR screen moved** `(customer)/ar-measure` → `(platform)/ar-measure` so the signed-out public quote flow can still reach it now that `(customer)` is guarded. (Empty old folder remains; safe to delete.)
5. **Splash never dismissed on deep-link launches** — `hideAsync` only ran in `app/index.tsx`. Now also released when session restore settles (AuthProvider).
6. **Typecheck failure** — `ar-window-measure` module couldn't resolve `expo-modules-core` (pnpm strict deps). Added the dependency, removed unused imports. `tsc` is clean.
7. **Test suite completely broken** — `babel-preset-expo` / `@babel/runtime` unresolvable from `apps/mobile` under pnpm. Added both as explicit dev deps (+ working links). All 51 tests pass.

**App Store compliance**
8. **Account deletion (Guideline 5.1.1(v))** — added `DELETE /api/me/account` (soft-delete, deactivates memberships, revokes all refresh tokens; login already rejects deleted users) and a double-confirm Delete Account action on the customer Account screen.
9. **Background-location claims stripped** — Info.plist/app.json claimed background route tracking but code only does foreground watching. Removed `NSLocationAlways*`, Android `ACCESS_BACKGROUND_LOCATION`; kept When-In-Use.
10. **Unused permission strings removed** — microphone (disabled via expo-camera plugin) and photo library (nothing saves to the library).
11. **`ITSAppUsesNonExemptEncryption=false`** added (skips the export-compliance prompt on every upload).
12. **Password recovery added** — sign-in now links to a Forgot Password screen → `POST /api/auth/forgot-password` (reset completes via emailed link, same as web).

**Config hygiene**
13. **Single `API_URL`** exported from `src/lib/api.ts` (was duplicated); **release builds now refuse non-HTTPS API URLs** (a prod build silently baked against `localhost` would ship a dead app). Local dev unchanged: `.env` + localhost fallback still work; ATS already only allows local-network cleartext.
14. **`eas.json` created** (development/preview/production profiles) and **`.env.example`** documenting `EXPO_PUBLIC_API_URL`.
15. Businesses screen: replaced silent `fetch().catch({})` with `apiCall` + visible error/retry state.

## Still required before App Store submission (not code, or your call)

- Run `pnpm install` at the repo root after pulling these changes (package.json gained `expo-modules-core`, `babel-preset-expo`, `@babel/runtime`).
- Replace the placeholder HTTPS URLs in `eas.json` with your real staging/production API origins. The API itself must be deployed behind HTTPS.
- `eas init` to attach an EAS project ID; set up App Store Connect app, signing, screenshots, description, **privacy policy URL** (required), support URL, and App Privacy questionnaire (you collect: email, name, phone, address, precise location for staff).
- Provide Apple a **demo account** (customer + admin) for review.
- Re-run `npx expo prebuild --platform ios --clean` if you want `ios/` regenerated from app.json instead of my direct Info.plist edits (both are currently in sync).
- Note: nested `apps/mobile/pnpm-lock.yaml` + own `node_modules` alongside the workspace root install is fragile. Works today; consider consolidating into the root workspace install later.

## Known gaps (acceptable for v1, be aware)

- Many list screens swallow fetch errors silently (empty state instead of error state) — businesses screen fixed; others unchanged.
- Quote wizard hardcodes `propertyKind: 'RESIDENTIAL'` (web asks).
- Route GPS tracking stops when the app is backgrounded (by design after #9 — matches what the permission now claims).
- `assets/favicon.png` is actually an `.ico` (only affects Expo web; harmless for iOS).
- No appointments/photo-upload/payments parity with web — server supports them; mobile v1 omits them.
