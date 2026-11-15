/* Generates the deterministic test photos (pure Node, no dependencies, works on Windows/macOS/Linux).
 * Each "player" is a 16x8 grid of grey blocks derived from the name; the test double for face-api turns that grid into a
 * descriptor, so the same name always gives the same face. Output: tests/img/*.png + slugs.json */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "img");
fs.mkdirSync(OUT, { recursive: true });

const popularSrc = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "popular.ts"), "utf8");
const names = [...popularSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const EXTRA = ["Test Player", "Sachin Pilot Fake"];
const slug = (n) => n.replace(/\s*\(.*?\)\s*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pattern = (name) => { const r = rng(name); return Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => 25 + Math.floor(r() * 201))); };

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** pixel(x,y) -> [r,g,b] */
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
const grey = (v) => { const c = Math.max(0, Math.min(254, v)); return [c, c, c]; };
const render = (p, w, h, delta = 0) => png(w, h, (x, y) => grey(p[Math.floor((y * 8) / h)][Math.floor((x * 16) / w)] + delta));
const save = (file, buf) => fs.writeFileSync(path.join(OUT, file), buf);

for (const n of [...names, ...EXTRA]) {
  const p = pattern(n), s = slug(n);
  save(`thumb_${s}.png`, render(p, 330, 247));
  save(`${s}.png`, render(p, 640, 480));
}
for (const n of ["Virat Kohli", "MS Dhoni"]) for (const d of [40, 75]) save(`${slug(n)}_d${d}.png`, render(pattern(n), 640, 480, d));
{ // two faces side by side: Kohli | Dhoni
  const a = pattern("Virat Kohli"), b = pattern("MS Dhoni");
  save("two.png", png(1200, 480, (x, y) => grey((x < 600 ? a : b)[Math.floor((y * 8) / 480)][Math.floor(((x % 600) * 16) / 600)])));
}
save("noface.png", png(640, 480, () => [255, 255, 255]));
// --- scenario fixtures for the prediction tests ---
for (let i = 1; i <= 10; i++) save(`unknown_${i}.png`, render(pattern(`Unknown Person ${i}`), 640, 480)); // people who are not registered
save(`${slug("Virat Kohli")}_d60.png`, render(pattern("Virat Kohli"), 640, 480, 60)); // same face, noticeably different photo
{ // a face that sits half-way between two registered players -> a look-alike / ambiguous case
  const a = pattern("Virat Kohli"), b = pattern("MS Dhoni");
  const mix = a.map((row, y) => row.map((v, x) => Math.round((v + b[y][x]) / 2)));
  save("blend_kohli_dhoni.png", render(mix, 640, 480));
}
// unclear photo: a face the detector is unsure about (test double: red marker pixel => low detector score)
save("blurry_face.png", png(640, 480, (x, y) => (x < 6 && y < 6 ? [255, 0, 0] : grey(pattern("Virat Kohli")[Math.floor((y * 8) / 480)][Math.floor((x * 16) / 640)]))));
save("tiny_face.png", render(pattern("Virat Kohli"), 90, 68)); // a sharp ~36px face exercises the quality-gated small-face path
// non-face picture (a landscape-like gradient; white corner = "no face" for the test double)
save("landscape.png", png(640, 480, (x, y) => (x < 3 && y < 3 ? [255, 255, 255] : [Math.floor((x * 255) / 640), 120, Math.floor((y * 255) / 480)])));
{ const p = pattern("Test Player"); [0, 6, -6].forEach((d, i) => save(`testplayer_${i}.png`, render(p, 640, 480, d))); }
save("unknown.png", render(pattern("Nobody Known"), 640, 480));
fs.writeFileSync(path.join(OUT, "slugs.json"), JSON.stringify(Object.fromEntries([...names, ...EXTRA].map((n) => [n, slug(n)]))));
console.log(`fixtures: ${names.length} players + extras -> ${OUT}`);
