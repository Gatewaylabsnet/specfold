// Generates apps/desktop/build/icon.ico, icon.icns, and icon.png with no dependencies.
// Draws a rounded-square gradient badge with a small endpoint node graph,
// supersamples for smooth edges, encodes PNGs via Node's zlib, then wraps the
// platform-specific icon containers. Run: node apps/desktop/build/generate-icon.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const BASE_SIZE = 256;
const SS = 2;
const GRAD_A = [37, 99, 235]; // #2563EB
const GRAD_B = [124, 58, 237]; // #7C3AED
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
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

function renderPixels(size) {
  const scale = size / BASE_SIZE;
  const canvasSize = size * SS;
  const nodes = [
    [90, 92],
    [176, 108],
    [116, 178]
  ].map(([x, y]) => [x * scale * SS, y * scale * SS]);
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0]
  ];
  const nodeR = 15 * scale * SS;
  const edgeR = 8 * scale * SS;
  const radius = 48 * scale * SS;

  function sampleColor(x, y) {
    if (!insideRounded(x, y, canvasSize, canvasSize, radius)) {
      return [0, 0, 0, 0];
    }
    const t = (x + y) / (2 * canvasSize);
    let color = mix(GRAD_A, GRAD_B, t);

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

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
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
      const sampleCount = SS * SS;
      const idx = (y * size + x) * 4;
      const outAlpha = a / sampleCount;
      pixels[idx] = outAlpha > 0 ? Math.round(r / a) : 0;
      pixels[idx + 1] = outAlpha > 0 ? Math.round(g / a) : 0;
      pixels[idx + 2] = outAlpha > 0 ? Math.round(b / a) : 0;
      pixels[idx + 3] = Math.round(outAlpha * 255);
    }
  }
  return pixels;
}

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function renderPng(size) {
  return encodePng(size, size, renderPixels(size));
}

function encodeIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

function encodeIcnsEntry(type, pngBuf) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(8 + pngBuf.length, 4);
  return Buffer.concat([header, pngBuf]);
}

function encodeIcns(entries) {
  const body = Buffer.concat(entries.map(({ type, png }) => encodeIcnsEntry(type, png)));
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

const png256 = renderPng(256);
const icns = encodeIcns([
  { type: "icp4", png: renderPng(16) },
  { type: "icp5", png: renderPng(32) },
  { type: "icp6", png: renderPng(64) },
  { type: "ic07", png: renderPng(128) },
  { type: "ic08", png: png256 },
  { type: "ic09", png: renderPng(512) },
  { type: "ic10", png: renderPng(1024) }
]);

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "icon.png"), png256);
writeFileSync(join(here, "icon.ico"), encodeIco(png256));
writeFileSync(join(here, "icon.icns"), icns);
console.log("Wrote build/icon.png, build/icon.ico, and build/icon.icns");
