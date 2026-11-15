/* Pure geometry for the image pipeline (no DOM, no face-api) – unit-tested in tests/unit-geometry.cjs.
 *
 * Why this exists: the old code resized every photo to "at most 1100px WIDE", computed face boxes in that resized
 * space and then judged the face size ("at least 64px") in that same shrunken space. A 4000px-wide photo with a perfectly
 * good 200px face was judged as a 55px face and rejected as "too small or unclear". All sizes shown to the user and
 * compared with the size limit are now measured in ORIGINAL image pixels; the working (resized) canvas is only used to
 * locate faces. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** longest side of the working canvas. face-api's SSD detector squares + resizes its input to 512px internally, so a larger
 * working canvas adds nothing to the first detection pass; tiles / crops (below) read the ORIGINAL pixels instead. */
export const MAX_SIDE = 1024;

/** One uniform scale for both axes (aspect ratio is always preserved, never stretched, never enlarged). */
export function planScale(w: number, h: number, maxSide = MAX_SIDE): number {
  const longest = Math.max(w, h);
  return longest > maxSide ? maxSide / longest : 1;
}
export function scaledSize(w: number, h: number, scale: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** a box in working-canvas coordinates -> original-image coordinates */
export function toOriginal(b: Box, scale: number): Box {
  return { x: b.x / scale, y: b.y / scale, width: b.width / scale, height: b.height / scale };
}
/** a box in original-image coordinates -> working-canvas coordinates */
export function toWorking(b: Box, scale: number): Box {
  return { x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale };
}
/** a box found inside a crop/tile (crop pixels, then `drawScale` = crop px per original px) -> original coordinates */
export function fromRegion(b: Box, region: Rect, drawScale: number): Box {
  return { x: region.sx + b.x / drawScale, y: region.sy + b.y / drawScale, width: b.width / drawScale, height: b.height / drawScale };
}
export function clampBox(b: Box, w: number, h: number): Box {
  const x = Math.max(0, Math.min(w, b.x));
  const y = Math.max(0, Math.min(h, b.y));
  const x2 = Math.max(0, Math.min(w, b.x + b.width));
  const y2 = Math.max(0, Math.min(h, b.y + b.height));
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}
export const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
export const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export function iou(a: Box, b: Box): number {
  const i = intersection(a, b);
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}

/** crop rectangle around a face: the box grown by `margin` (fraction of its size) on every side, clamped to the image */
export function cropRect(face: Box, w: number, h: number, margin = 0.5): Rect {
  const mx = face.width * margin;
  const my = face.height * margin;
  const x1 = Math.max(0, Math.floor(face.x - mx));
  const y1 = Math.max(0, Math.floor(face.y - my));
  const x2 = Math.min(w, Math.ceil(face.x + face.width + mx));
  const y2 = Math.min(h, Math.ceil(face.y + face.height + my));
  return { sx: x1, sy: y1, sw: Math.max(1, x2 - x1), sh: Math.max(1, y2 - y1) };
}
/** scale for drawing a region into a canvas: never enlarge, shrink only when its longest side exceeds `maxSide` */
export function regionScale(r: Rect, maxSide: number): number {
  const longest = Math.max(r.sw, r.sh);
  return longest > maxSide ? maxSide / longest : 1;
}

/** Overlapping square-ish tiles over the ORIGINAL image, used only when the first pass found no usable face (a small face
 * in a large photo). The tile is at least `minTile` px and at least a third of the long side (so at most ~4x3 tiles). */
export function tileGrid(w: number, h: number, minTile = 640, overlap = 0.25): Rect[] {
  const longest = Math.max(w, h);
  const tile = Math.max(minTile, Math.ceil(longest / 3));
  if (tile >= longest) return [{ sx: 0, sy: 0, sw: w, sh: h }]; // image is not bigger than one tile
  const step = Math.max(1, Math.round(tile * (1 - overlap)));
  const starts = (len: number) => {
    if (len <= tile) return [0];
    const out: number[] = [];
    for (let p = 0; p + tile < len; p += step) out.push(p);
    out.push(len - tile); // last tile flush with the edge
    return out;
  };
  const rects: Rect[] = [];
  for (const sy of starts(h)) for (const sx of starts(w)) rects.push({ sx, sy, sw: Math.min(tile, w - sx), sh: Math.min(tile, h - sy) });
  return rects;
}

/** non-maximum suppression: the same face seen by several tiles is kept once (highest score wins) */
export function nms<T extends { box: Box; score: number }>(items: T[], iouLimit = 0.4, containLimit = 0.6): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const it of sorted) {
    const dup = kept.some((k) => {
      const i = intersection(k.box, it.box);
      const smaller = Math.min(area(k.box), area(it.box));
      return iou(k.box, it.box) > iouLimit || (smaller > 0 && i / smaller > containLimit);
    });
    if (!dup) kept.push(it);
  }
  return kept;
}
