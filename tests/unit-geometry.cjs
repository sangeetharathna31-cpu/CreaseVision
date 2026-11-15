/* Unit tests for src/lib/geometry.ts – image scaling, coordinate mapping, crops, tiles, NMS. Pure maths, no browser. */
const load = require("./load-src.cjs")();
const G = load("geometry");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* ---- scaling: one uniform scale, aspect ratio kept, never enlarged ---- */
const sizes = [[4000, 3000], [3000, 4000], [6000, 4000], [1000, 8000], [8000, 1000], [1024, 768], [768, 1024], [640, 480], [300, 400], [120, 150], [1025, 1025], [1024, 1024], [5000, 5000], [12000, 9000]];
for (const [w, h] of sizes) {
  const s = G.planScale(w, h), r = G.scaledSize(w, h, s);
  const ratioErr = Math.abs(r.w / r.h - w / h) / (w / h);
  check(`G01 ${w}x${h} -> ${r.w}x${r.h}: longest side <= ${G.MAX_SIDE}, never enlarged, aspect ratio kept (err ${(ratioErr * 100).toFixed(2)}%)`,
    Math.max(r.w, r.h) <= G.MAX_SIDE && s <= 1 && (Math.max(w, h) <= G.MAX_SIDE ? s === 1 && r.w === w && r.h === h : true) && ratioErr < 0.01 + 1 / Math.min(r.w, r.h), `scale ${s}`);
}
check("G02 old rule left a 1000x8000 panorama at 1000x8000 (only width was limited); new rule gives 128x1024", (() => { const r = G.scaledSize(1000, 8000, G.planScale(1000, 8000)); return r.w === 128 && r.h === 1024; })());
check("G03 tiny images are not enlarged (120x150 stays 120x150)", (() => { const r = G.scaledSize(120, 150, G.planScale(120, 150)); return r.w === 120 && r.h === 150; })());

/* ---- coordinates ---- */
{
  const s = G.planScale(4000, 3000); // 0.256
  const orig = { x: 1800, y: 900, width: 220, height: 250 };
  const work = G.toWorking(orig, s);
  const back = G.toOriginal(work, s);
  check("G10 working -> original round trip is exact", ["x", "y", "width", "height"].every((k) => near(back[k], orig[k], 1e-9)));
  check("G11 a 220px face of a 4000px photo is only ~56px on the working canvas (what the old code measured)", Math.round(work.width) === 56, String(work.width));
}
{
  // a box found in a tile that was drawn at 0.5x: tile origin (1000, 500), box (100,80,50,60) in tile px -> original
  const b = G.fromRegion({ x: 100, y: 80, width: 50, height: 60 }, { sx: 1000, sy: 500, sw: 800, sh: 800 }, 0.5);
  check("G12 box inside a region drawn at 0.5x maps back to original pixels", near(b.x, 1200) && near(b.y, 660) && near(b.width, 100) && near(b.height, 120), JSON.stringify(b));
}
check("G13 clampBox keeps boxes inside the image", (() => { const b = G.clampBox({ x: -10, y: 90, width: 50, height: 50 }, 100, 100); return b.x === 0 && b.y === 90 && b.width === 40 && b.height === 10; })());

/* ---- crops ---- */
{
  const r = G.cropRect({ x: 1000, y: 800, width: 200, height: 240 }, 4000, 3000, 0.5);
  check("G20 crop = face grown by 50% each side (400x480 -> 400+200... ) inside the image", r.sx === 900 && r.sy === 680 && r.sw === 400 && r.sh === 480, JSON.stringify(r));
  const e = G.cropRect({ x: 10, y: 10, width: 100, height: 100 }, 500, 400, 0.5);
  check("G21 crop is clamped at the image edge", e.sx === 0 && e.sy === 0 && e.sw === 110 + 50 && e.sh === 160, JSON.stringify(e));
  check("G22 regionScale never enlarges and shrinks only above the cap", G.regionScale({ sx: 0, sy: 0, sw: 400, sh: 480 }, 640) === 1 && near(G.regionScale({ sx: 0, sy: 0, sw: 1280, sh: 640 }, 640), 0.5));
}

/* ---- tiles ---- */
for (const [w, h] of [[4000, 3000], [3000, 4000], [6000, 4000], [8000, 1000], [1200, 900], [900, 1200], [5000, 5000]]) {
  const t = G.tileGrid(w, h);
  const inside = t.every((r) => r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= w && r.sy + r.sh <= h && r.sw > 0 && r.sh > 0);
  // every pixel is covered
  let covered = true;
  for (let y = 0; y < h && covered; y += Math.max(1, Math.floor(h / 40))) for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) if (!t.some((r) => x >= r.sx && x < r.sx + r.sw && y >= r.sy && y < r.sy + r.sh)) { covered = false; break; }
  check(`G30 tiles for ${w}x${h}: ${t.length} tiles, inside the image, whole image covered, at most 16`, inside && covered && t.length <= 16, `${t.length} inside=${inside} covered=${covered}`);
}
check("G31 an image that fits in one tile gives a single full-image tile", G.tileGrid(600, 500).length === 1);
check("G32 adjacent tiles overlap (a face on a seam is whole in one of them)", (() => { const t = G.tileGrid(4000, 3000); const row = t.filter((r) => r.sy === t[0].sy); return row.length > 1 && row[0].sx + row[0].sw > row[1].sx; })());

/* ---- non-maximum suppression ---- */
{
  const a = { box: { x: 100, y: 100, width: 100, height: 100 }, score: 0.6 };
  const b = { box: { x: 105, y: 102, width: 98, height: 100 }, score: 0.95 }; // same face seen by another tile
  const c = { box: { x: 500, y: 100, width: 100, height: 100 }, score: 0.8 };
  const k = G.nms([a, b, c]);
  check("G40 NMS keeps one box per face, the highest score, and different faces apart", k.length === 2 && k.some((x) => x.score === 0.95) && k.some((x) => x.score === 0.8) && !k.includes(a));
  const half = { box: { x: 100, y: 100, width: 50, height: 100 }, score: 0.55 }; // a face cut by the tile edge, inside the full box
  check("G41 a cut-off partial detection inside a full face box is suppressed", G.nms([b, half]).length === 1);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
