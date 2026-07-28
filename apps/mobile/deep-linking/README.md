# Deep linking — appointment emails → the app

Appointment emails link to the **web origin**, not a custom scheme
(`apps/api/src/appointments/appointments.service.ts`):

```ts
const baseUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
`<a href="${baseUrl}/book/cancel/${appt.cancelToken}">Cancel</a>`
`<a href="${baseUrl}/book/reschedule/${appt.rescheduleToken}">Reschedule</a>`
`<a href="${baseUrl}/book/confirm-proposed/${appt.id}?slot=${i}">${s.label}</a>`
```

For those `https://` links to open the app instead of the browser, the OS must
verify — at install time — that the domain authorizes this app. Everything
needed for that is now wired up. **Two environment variables are all that's
left**; until they're set the endpoints return 404, meaning "this host claims no
app", and the links keep opening the website exactly as they do today.

## What's already wired

**Mobile** (`apps/mobile`)
- `app.json` declares `ios.associatedDomains` and an Android `intentFilters`
  entry with `autoVerify: true`, both scoped to `/book` — claiming `/*` would
  pull the entire marketing site into the app.
- `app/book/cancel/[token].tsx`, `app/book/reschedule/[token].tsx`,
  `app/book/confirm-proposed/[appointmentId].tsx` handle the three link shapes.
  They render **signed out** on purpose: the token in the URL is the credential,
  and the matching `/api/book/*` endpoints carry no auth guard.

**Web** (`apps/web`)
- `src/app/well-known/apple-app-site-association/route.ts`
- `src/app/well-known/assetlinks.json/route.ts`
- `next.config.js` rewrites `/.well-known/*` onto them.
- `src/middleware.ts` excludes `/.well-known/` from tenant resolution.

Three non-obvious things that shaped this, all verified against a real build:

1. **Next's App Router silently ignores dot-prefixed directories.** A route at
   `app/.well-known/…` never registers — it compiles fine and 404s at runtime.
   Hence the `well-known/` directory plus a rewrite.
2. **It must be a rewrite, not a redirect.** Apple's CDN follows zero redirects
   fetching AASA; Android's verifier is equally strict. A rewrite is internal, so
   both see a 200 at the original URL.
3. **A file in `public/.well-known/` would shadow all of this.** Array-form
   rewrites are applied *after* filesystem routes, so a static copy wins. Don't
   add one — that's why no placeholder files ship in this directory.

**API** (`apps/api`) — `validate-env.ts` now refuses to boot in production
unless `WEB_ORIGIN` is set to an `https://` origin.

## What you need to do

### 1. Set two env vars on the web deployment

| Variable | Value | Where to get it |
|---|---|---|
| `IOS_APP_ID` | `<TeamID>.com.speedenterprises.app` | developer.apple.com → Membership, or `eas credentials` |
| `ANDROID_CERT_SHA256` | SHA-256 fingerprint | Play Console → Setup → App signing |

Use the **app signing key** fingerprint, not your upload key. With Play App
Signing the two differ, and using the upload key is the single most common
reason App Links verify in a local build and silently fail in production.
`ANDROID_CERT_SHA256` accepts a comma-separated list if you need to publish
several at once (e.g. mid signing-key migration).

Set them on **every host that sends mail**. Production is `speedenterprises.app`
with tenants on subdomains; iOS fetches AASA per-host, so the
`*.speedenterprises.app` wildcard in `associatedDomains` does *not* mean one
response covers every subdomain — each host has to answer.

### 2. Point `WEB_ORIGIN` at the real origin

Currently `http://localhost:3000` in `apps/api/.env`, which means production
would mail dead links to real customers — breaking the **web** booking flow, not
just deep links. The API now fails closed on this in production rather than
booting with it.

### 3. Rebuild the app

Associated domains are native entitlements; an OTA update won't carry them.

```
cd apps/mobile
npx expo prebuild --clean
eas build --profile production --platform all
```

## Verifying

Check the endpoints first — no app build required:

```
curl -i https://<host>/.well-known/apple-app-site-association
curl -i https://<host>/.well-known/assetlinks.json
```

Expect `200`, `content-type: application/json`, no redirect, no `Set-Cookie`.

**iOS, without waiting on Apple's CDN:** append `?mode=developer` to the entry in
`app.json` (`applinks:speedenterprises.app?mode=developer`) and enable Associated
Domains Development on the device. The device then fetches AASA straight from
your host, so changes land in seconds instead of hours. Strip it before the
store build.

**Android:**

```
adb shell pm verify-app-links --re-verify com.speedenterprises.app
adb shell pm get-app-links com.speedenterprises.app     # every domain: verified
```

**Before the domain is live:** point `WEB_ORIGIN` and `associatedDomains` at an
ngrok or Cloudflare tunnel — real https, real cert, no DNS work.

## Keep the web pages

Universal Links fall back to the browser whenever the app isn't installed, and
plenty of customers open email on a desktop. `apps/web/src/app/book/*` remains
the canonical target; the mobile screens are an additive fast path.
