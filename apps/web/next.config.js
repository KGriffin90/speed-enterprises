/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Each tenant page is fully dynamic (different headers, config, theme).
    // Setting staleTimes to 0 prevents the client router cache from serving
    // a prior tenant's RSC payload when navigating between tenants. Without
    // this, a failed RSC fetch falls back to the cached render — showing the
    // wrong business entirely.
    staleTimes: { dynamic: 0 },
  },
  // Allow Next/Image to load tenant-supplied logos & app icons from anywhere
  // (lock down per tenant in prod).
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http',  hostname: '**' },
    ],
  },
  // Mobile deep-link domain verification.
  //
  // The files must be reachable at /.well-known/…, but Next's App Router skips
  // dot-prefixed directories under app/ — a route at app/.well-known/… never
  // registers and 404s. So the handlers live at app/well-known/… and we rewrite
  // the real paths onto them.
  //
  // These MUST be rewrites, not redirects: Apple's CDN follows zero redirects
  // when fetching apple-app-site-association, and Android's verifier is equally
  // strict. A rewrite is internal, so both see a 200 at the original URL.
  async rewrites() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/well-known/apple-app-site-association',
      },
      {
        source: '/.well-known/assetlinks.json',
        destination: '/well-known/assetlinks.json',
      },
    ];
  },
  // Surface the API origin to client + server.
  env: {
    NEXT_PUBLIC_API_ORIGIN: process.env.API_ORIGIN ?? 'http://localhost:4000',
    PLATFORM_DOMAIN:        process.env.PLATFORM_DOMAIN ?? 'localhost:3000',
    PLATFORM_NAME:          process.env.PLATFORM_NAME ?? 'Speed Enterprises',
  },
};
module.exports = nextConfig;
