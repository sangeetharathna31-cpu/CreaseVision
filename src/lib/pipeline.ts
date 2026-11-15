/* Image -> faces pipeline, independent of the browser and of face-api (both are injected), so the real logic can be unit-tested.
 *
 *  1. ONE uniform scale (aspect ratio kept, never enlarged) gives a working canvas whose longest side is <= MAX_SIDE.
 *     (Old code: only the width was limited, so tall portraits were never reduced, and the face-size limit was applied
 *     to the shrunken canvas instead of the original photo.)
 *  2. Pass 1 detects on the working canvas.
 *  3. Only when pass 1 found no face, or none clear enough, and the photo was actually reduced: the ORIGINAL pixels are
 *     scanned in overlapping tiles (a small face in a big photo is only a few pixels in a 512px detector input).
 *  4. When exactly one face is found in a reduced photo, its descriptor is re-extracted from a crop of the ORIGINAL pixels, so
 *     the 150x150 recognition chip is not built from a down-sampled copy.
 *  Every size reported (and judged against the size limit) is in original-image pixels. */
import {
  MAX_SIDE,
  area,
  cropRect,
  fromRegion,
  iou,
  nms,
  planScale,
  regionScale,
  scaledSize,
  tileGrid,
  toOriginal,
  toWorking,
  type Box,
  type Rect,
} from "./geometry";
import type { FaceQuality } from "./quality";

export interface RawFace {
  box: Box;
  score: number;
  descriptor: number[];
  quality?: FaceQuality;
}
export interface DetectedFace {
  /** box in WORKING-canvas coordinates (what the overlay draws; see ScanState.size) */
  box: Box;
  /** the same box in ORIGINAL-image pixels (what sizes are judged and reported in) */
  origBox: Box;
  /** best detector confidence over all passes */
  score: number;
  descriptor: number[];
  quality?: FaceQuality;
  /** which pass produced the face box */
  via: "full" | "tile";
  /** descriptor extracted from a crop of the original pixels */
  refined: boolean;
}
export interface PipelineDiag {
  origSize: { w: number; h: number };
  processedSize: { w: number; h: number };
  /** working px per original px (1 = not reduced) */
  scale: number;
  passes: string[];
  tiles: number;
  /** faces the detector returned in pass 1 */
  firstPassFaces: number;
  ms: number;
}
export interface PipelineEnv<S> {
  /** detector + landmarks + descriptors on a surface, boxes in that surface's pixels */
  detectAll(src: S): Promise<RawFace[]>;
  /** draw `region` of `source` into a new dw x dh surface (a straight proportional copy, high-quality resampling) */
  draw(source: S, region: Rect, dw: number, dh: number): S;
}
export class PipelineError extends Error {
  constructor(
    readonly code: "empty" | "engine",
    message: string,
  ) {
    super(message);
  }
}

const TILE_DRAW_MAX = 1024;
const CROP_DRAW_MAX = 640;

export async function analyseImage<S>(
  source: S,
  w: number,
  h: number,
  env: PipelineEnv<S>,
  opts: { minScore: number },
): Promise<{ faces: DetectedFace[]; diag: PipelineDiag }> {
  const t0 = Date.now();
  if (!(w > 0 && h > 0)) throw new PipelineError("empty", "The image has no pixels (width or height is 0).");

  const scale = planScale(w, h);
  const proc = scaledSize(w, h, scale);
  const passes: string[] = [];
  const working = scale === 1 ? source : env.draw(source, { sx: 0, sy: 0, sw: w, sh: h }, proc.w, proc.h);
  passes.push(scale === 1 ? `full image ${w}×${h} (not resized)` : `full image resized to ${proc.w}×${proc.h}`);

  const make = (r: RawFace, origBox: Box, via: DetectedFace["via"]): DetectedFace => ({
    box: toWorking(origBox, scale),
    origBox,
    score: r.score,
    descriptor: r.descriptor,
    quality: r.quality,
    via,
    refined: false,
  });

  let faces: DetectedFace[];
  try {
    faces = (await env.detectAll(working)).map((r) => make(r, toOriginal(r.box, scale), "full"));
  } catch (e) {
    throw new PipelineError("engine", `Face detection failed: ${(e as Error).message || e}`);
  }
  const firstPassFaces = faces.length;
  let tiles = 0;

  /* pass 2: small face in a big photo -> scan the original pixels */
  const bestScore = faces.reduce((m, f) => Math.max(m, f.score), 0);
  if (scale < 1 && (faces.length === 0 || bestScore < opts.minScore)) {
    const rects = tileGrid(w, h);
    if (rects.length > 1) {
      tiles = rects.length;
      const found: DetectedFace[] = [];
      try {
        for (const r of rects) {
          const ds = regionScale(r, TILE_DRAW_MAX);
          const surf = env.draw(source, r, Math.max(1, Math.round(r.sw * ds)), Math.max(1, Math.round(r.sh * ds)));
          for (const rf of await env.detectAll(surf)) found.push(make(rf, fromRegion(rf.box, r, ds), "tile"));
        }
      } catch (e) {
        throw new PipelineError("engine", `Face detection failed: ${(e as Error).message || e}`);
      }
      passes.push(`${rects.length} overlapping tiles of the original ${w}×${h} image`);
      const merged = nms(faces.concat(found).map((f) => ({ box: f.origBox, score: f.score, f })));
      faces = merged.map((m) => m.f);
    }
  }
  faces.sort((a, b) => area(b.origBox) - area(a.origBox));

  /* pass 3: single face in a reduced photo -> descriptor from the original pixels */
  if (faces.length === 1 && scale < 1) {
    const f = faces[0]!;
    const rect = cropRect(f.origBox, w, h, 0.5);
    const ds = regionScale(rect, CROP_DRAW_MAX);
    try {
      const surf = env.draw(source, rect, Math.max(1, Math.round(rect.sw * ds)), Math.max(1, Math.round(rect.sh * ds)));
      const expected: Box = { x: (f.origBox.x - rect.sx) * ds, y: (f.origBox.y - rect.sy) * ds, width: f.origBox.width * ds, height: f.origBox.height * ds };
      let pick: RawFace | null = null;
      let pickIou = 0.3; // must clearly be the same face
      for (const c of await env.detectAll(surf)) {
        const v = iou(c.box, expected);
        if (v >= pickIou) {
          pick = c;
          pickIou = v;
        }
      }
      if (pick) {
        const origBox = fromRegion(pick.box, rect, ds);
        faces = [{ box: toWorking(origBox, scale), origBox, score: Math.max(f.score, pick.score), descriptor: pick.descriptor, quality: pick.quality, via: f.via, refined: true }];
        passes.push("descriptor re-extracted from the original-resolution crop");
      } else passes.push("original-resolution crop gave no matching face (kept the first descriptor)");
    } catch {
      passes.push("original-resolution crop failed (kept the first descriptor)");
    }
  }

  return { faces, diag: { origSize: { w, h }, processedSize: proc, scale, passes, tiles, firstPassFaces, ms: Date.now() - t0 } };
}

/** Which face is the subject of a reference photo (gallery enrolment)? The largest one – but only when it clearly dominates;
 * with two comparable faces we cannot know which one is the player, and enrolling the wrong person would poison the gallery.
 * (Old code used detectSingleFace = the highest-SCORE face, which in a team photo is often not the player.) */
export function pickSubject(faces: DetectedFace[], dominance = 2): { face: DetectedFace | null; reason: string } {
  if (!faces.length) return { face: null, reason: "no face found" };
  const sorted = [...faces].sort((a, b) => area(b.origBox) - area(a.origBox));
  const [a, b] = sorted;
  if (b && area(a!.origBox) < dominance * area(b.origBox)) return { face: null, reason: "several faces of similar size – cannot tell which one is the player" };
  return { face: a!, reason: "" };
}

export { MAX_SIDE };
