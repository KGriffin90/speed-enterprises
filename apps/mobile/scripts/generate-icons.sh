#!/usr/bin/env bash
#
# Generate the native app icons + splash image from the real Speed Enterprises
# logo (the same artwork the web app serves from apps/web/public/logos).
#
# Uses only macOS `sips` — no ImageMagick / sharp dependency. Re-run this whenever
# assets/logos/speed-enterprises-logo.webp changes:
#
#     bash scripts/generate-icons.sh
#
# The logo is white wordmark + orange mark on solid black, so every output is
# composited on black; app.json sets the matching black splash/adaptive bg.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> apps/mobile

SRC="assets/logos/speed-enterprises-logo.webp"   # high-res master (1402x1122, black bg)
OUT="assets"
BLACK="000000"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# High-res PNG master (sips can read the webp but pads/resamples PNG reliably).
sips -s format png "$SRC" --out "$TMP/master.png" >/dev/null

# Resample the logo to <contentWidth>, then pad to a <canvas>x<canvas> black square.
fit_pad() { # <contentWidth> <canvas> <outfile>
  sips --resampleWidth "$1" "$TMP/master.png" --out "$TMP/fit.png" >/dev/null
  sips --padToHeightWidth "$2" "$2" --padColor "$BLACK" "$TMP/fit.png" --out "$3" >/dev/null
}

fit_pad 880 1024 "$OUT/icon.png"            # iOS app icon — near full-bleed, small margin
fit_pad 600 1024 "$OUT/adaptive-icon.png"   # Android adaptive foreground — inside ~66% safe zone
fit_pad 940 1024 "$OUT/splash-icon.png"     # Splash (contain) — black bars merge with black bg
fit_pad  44   48 "$OUT/favicon.png"         # Web favicon

# In-app logo used by <PlatformLogo> (kept as a wide PNG, composited on its own badge).
sips --resampleWidth 1024 "$TMP/master.png" --out "$OUT/logos/speed-enterprises-logo@1024.png" >/dev/null

echo "Generated: icon.png adaptive-icon.png splash-icon.png favicon.png + logos/speed-enterprises-logo@1024.png"
