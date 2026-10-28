// Draws the app icon (a five-bar tally on paper) to PNG with no packages.
// Run: node scripts/icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const PAPER = [0xF1, 0xEC, 0xE2], INK = [0x1C, 0x1B, 0x18], MOSS = [0x2F, 0x6B, 0x3A];

// Strokes in a 100x100 space: four uprights, then the slash. Kept inside the
// maskable safe zone (central 80%).
const STROKES = [
  { a: [29, 28], b: [30, 72], c: INK }, { a: [43, 28], b: [42, 72], c: INK },
  { a: [56, 27], b: [57, 72], c: INK }, { a: [70, 28], b: [69, 72], c: INK },
  { a: [22, 62], b: [78, 38], c: MOSS },
];
const WIDTH = 6.2;

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function draw(size) {
  const px = Buffer.alloc(size * (size * 3 + 1));
  const s = 100 / size;
  for (let y = 0; y < size; y++) {
    px[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = PAPER;
      for (const k of STROKES) {
        const d = segDist((x + 0.5) * s, (y + 0.5) * s, k.a, k.b);
        const cover = Math.max(0, Math.min(1, (WIDTH / 2 - d) / s + 0.5)); // 1px antialias
        if (cover > 0) col = col.map((v, i) => Math.round(v + (k.c[i] - v) * cover));
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2];
    }
  }
  return png(size, px);
}

function png(size, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../public/", import.meta.url);
writeFileSync(new URL("apple-touch-icon.png", out), draw(180));
writeFileSync(new URL("icon-192.png", out), draw(192));
writeFileSync(new URL("icon-512.png", out), draw(512));

const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
writeFileSync(new URL("icon.svg", out), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="${hex(PAPER)}"/>` +
  STROKES.map((k) => `<line x1="${k.a[0]}" y1="${k.a[1]}" x2="${k.b[0]}" y2="${k.b[1]}" stroke="${hex(k.c)}" stroke-width="${WIDTH}" stroke-linecap="round"/>`).join("") + "</svg>\n");
console.log("icons written");
