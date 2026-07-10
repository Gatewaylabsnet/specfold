// Generates apps/desktop/build/icon.ico (and icon.png) with no dependencies.
// Draws a rounded-square gradient badge with a small "endpoints" node graph,
// supersampled 2x for smooth edges, encodes a PNG via Node's zlib, and wraps
// it in an ICO container. Run: node apps/desktop/build/generate-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SS = 2; // supersample factor
const W = SIZE * SS;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Signed distance helpers (in supersampled space).
function roundedRectInside(x, y, w, h, r) {
  const dx = Math.max(r - x, x - (w - r), 0);
  const dy = Math.max(r - y, y - (h - r), 0);
  return Math.hypot(dx, dy) <= r || (x >= r && x <= w - r) || (y >= r && y <= h - r)
    ? insideRounded(x, y, w, h, r)
    : false;
}

function insideRounded(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const GRAD_A = [37, 99, 235]; // #2563EB
const GRAD_B = [124, 58, 237]; // #7C3AED
const WHITE = [255, 255, 255];

// Node graph in 256-space, scaled to supersample space.
const nodes = [
  [90, 92],
  [176, 108],
  [116, 178]
].map(([x, y]) => [x * SS, y * SS]);
const edges = [
  [0, 1],
  [1, 2],
  [2, 0]
];
const nodeR = 15 * SS;
const edgeR = 8 * SS;

function sampleColor(x, y) {
  // Outside the rounded badge -> transparent.
  if (!insideRounded(x, y, W, W, 48 * SS)) {
    return [0, 0, 0, 0];
  }
  const t = (x + y) / (2 * W);
  let color = mix(GRAD_A, GRAD_B, t);

  // White marks (edges then nodes on top).
  let markCoverage = 0;
  for (const [a, b] of edges) {
    const d = distToSegment(x, y, nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
    markCoverage = Math.max(markCoverage, d <= edgeR ? 1 : 0);
  }
  for (const [nx, ny] of nodes) {
    if (Math.hypot(x - nx, y - ny) <= nodeR) {
      markCoverage = 1;
    }
  }
  if (markCoverage > 0) {
    color = WHITE;
  }
  return [color[0], color[1], color[2], 255];
}

// Render supersampled, then box-average down to SIZE (premultiplied-correct).
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const [pr, pg, pb, pa] = sampleColor(x * SS + sx + 0.5, y * SS + sy + 0.5);
        const alpha = pa / 255;
        r += pr * alpha;
        g += pg * alpha;
        b += pb * alpha;
        a += alpha;
      }
    }
    const n = SS * SS;
    const idx = (y * SIZE + x) * 4;
    const outAlpha = a / n;
    pixels[idx] = outAlpha > 0 ? Math.round(r / a) : 0;
    pixels[idx + 1] = outAlpha > 0 ? Math.round(g / a) : 0;
    pixels[idx + 2] = outAlpha > 0 ? Math.round(b / a) : 0;
    pixels[idx + 3] = Math.round(outAlpha * 255);
  }
}

// --- PNG encoding ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const png = encodePng(SIZE, SIZE, pixels);

// --- ICO container (single 256x256 PNG entry) ---
function encodeIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 == 256
  entry[1] = 0; // height 0 == 256
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, pngBuf]);
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "icon.png"), png);
writeFileSync(join(here, "icon.ico"), encodeIco(png));
console.log("Wrote build/icon.png and build/icon.ico");
