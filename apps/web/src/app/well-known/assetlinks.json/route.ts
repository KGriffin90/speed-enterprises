/**
 * Digital Asset Links — the Android counterpart to apple-app-site-association.
 * Android verifies this at install time before it will open this domain's
 * `https://…/book/*` links in the app (App Links, `autoVerify: true` in
 * apps/mobile/app.json).
 *
 * ANDROID_CERT_SHA256 must be the SHA-256 of the certificate that signs the
 * SHIPPED artifact. With Play App Signing that is the *app signing key*
 * (Play Console → Setup → App signing), NOT your local upload key — using the
 * upload key is the single most common reason App Links verify fine in a local
 * build and silently fail in production.
 *
 * Accepts a comma-separated list so you can carry several fingerprints at once
 * (upload + Play signing during migration, or debug + release for testing).
 */

/** Read the fingerprints at request time so a redeploy picks up env changes. */
export const dynamic = 'force-dynamic';

const PACKAGE_NAME = 'com.speedenterprises.app';

const FINGERPRINTS = (process.env.ANDROID_CERT_SHA256 ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export function GET(): Response {
  // Nothing configured → this host claims no Android app.
  if (FINGERPRINTS.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: FINGERPRINTS,
      },
    },
  ];

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
