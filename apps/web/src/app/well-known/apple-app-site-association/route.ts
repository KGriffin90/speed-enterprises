/**
 * Apple App Site Association — the file iOS fetches to verify that this domain
 * authorizes the mobile app to open its `https://…/book/*` links (Universal
 * Links). Without it, appointment-email links always open the browser.
 *
 * Served from a route handler rather than `public/.well-known/` for three
 * reasons:
 *   1. Content type. The file must have NO extension, so a static `public/`
 *      copy is served with a guessed (or absent) MIME type — the classic silent
 *      failure where the file looks fine to curl but Apple rejects it. Here we
 *      set `application/json` explicitly.
 *   2. The app ID comes from the environment, so no Team ID is committed and
 *      staging can claim a different app than production.
 *   3. iOS fetches AASA per-host, and tenants live on subdomains
 *      (acme.speedenterprises.app). One handler answers on every host the app
 *      serves; a static file would too, but only if nothing shadows it.
 *
 * NOTE: a file at `public/.well-known/apple-app-site-association` would take
 * precedence over this route and silently shadow it. Don't add one.
 *
 * Paths are scoped to /book/* deliberately — claiming "/*" would pull the whole
 * marketing site into the app.
 */

/** Read IOS_APP_ID at request time, not build time, so env changes take effect
 *  on redeploy without a rebuild. */
export const dynamic = 'force-dynamic';

/** `<APPLE_TEAM_ID>.<bundleIdentifier>`, e.g. ABCDE12345.com.speedenterprises.app */
const APP_ID = process.env.IOS_APP_ID;

export function GET(): Response {
  // No app ID configured → this host genuinely claims no app. A 404 is the
  // honest answer; serving a malformed association would fail verification
  // anyway, just more confusingly.
  if (!APP_ID) {
    return new Response('Not Found', { status: 404 });
  }

  const body = {
    applinks: {
      details: [
        {
          appID: APP_ID,
          paths: ['/book/*'],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      // Apple requires JSON and follows ZERO redirects when fetching this.
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
