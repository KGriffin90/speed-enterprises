/**
 * Generates PNG assets for the mobile app using only Node.js built-ins.
 * Run: node scripts/generate-assets.js
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Minimal PNG encoder ────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len       = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crcData   = Buffer.concat([typeBytes, data]);
  const crcBuf    = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function makePng(width, height, fillR, fillG, fillB, alpha = 255) {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw pixels (filter byte 0 + RGBA per pixel)
  const row = Buffer.allocUnsafe(1 + width * 4);
  row[0] = 0; // filter None
  for (let x = 0; x < width; x++) {
    row[1 + x * 4]     = fillR;
    row[1 + x * 4 + 1] = fillG;
    row[1 + x * 4 + 2] = fillB;
    row[1 + x * 4 + 3] = alpha;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const compressed = zlib.deflateSync(raw);

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// Draw a centered filled circle on an RGBA canvas
function withCircle(width, height, bgR, bgG, bgB, fgR, fgG, fgB) {
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2, cy = height / 2, r = Math.min(width, height) * 0.38;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = Math.hypot(x - cx, y - cy) <= r;
      pixels[i]     = inside ? fgR : bgR;
      pixels[i + 1] = inside ? fgG : bgG;
      pixels[i + 2] = inside ? fgB : bgB;
      pixels[i + 3] = 255;
    }
  }
  return pixelsToPng(width, height, pixels);
}

function pixelsToPng(width, height, pixels) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.allocUnsafe(1 + width * 4);
    row[0] = 0;
    pixels.copy(row, 1, y * width * 4, (y + 1) * width * 4);
    rows.push(row);
  }
  const raw        = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);
  const sig        = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// ── Generate files ─────────────────────────────────────────────────────────

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

// Brand color: #4f46e5 (indigo-600), white circle in centre
// splash-icon.png: 512×512 — shown centred on splash background
const splashIcon = withCircle(512, 512, 0x4f, 0x46, 0xe5, 0xff, 0xff, 0xff);
fs.writeFileSync(path.join(assetsDir, 'splash-icon.png'), splashIcon);
console.log('✓ assets/splash-icon.png  (512×512)');

// icon.png: 1024×1024 — iOS home screen icon
const icon = withCircle(1024, 1024, 0x4f, 0x46, 0xe5, 0xff, 0xff, 0xff);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), icon);
console.log('✓ assets/icon.png         (1024×1024)');

// adaptive-icon.png: 1024×1024 — Android adaptive icon foreground
const adaptive = withCircle(1024, 1024, 0x4f, 0x46, 0xe5, 0xff, 0xff, 0xff);
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptive);
console.log('✓ assets/adaptive-icon.png (1024×1024)');

// favicon.png: 48×48
const favicon = withCircle(48, 48, 0x4f, 0x46, 0xe5, 0xff, 0xff, 0xff);
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favicon);
console.log('✓ assets/favicon.png       (48×48)');

console.log('\nDone. Replace assets/*.png with your real artwork before publishing.');
