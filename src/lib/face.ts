/* Face detection / recognition, ported from the original app.
 * Same library (face-api, loaded from the CDN in index.html), same models, same SSD options (minConfidence 0.5), same
 * distance maths and same confidence formula. What changed is everything AROUND the networks: how the photo is resized,
 * where face sizes are measured, which face is chosen when enrolling – see src/lib/pipeline.ts and geometry.ts. */
import type { Gallery } from "./storage";
import { cricketSummary, disp } from "./wikipedia";
import { DEFAULT_CONFIG } from "./predict";
import { analyseImage, pickSubject, type DetectedFace, type PipelineDiag, type PipelineEnv, type RawFace } from "./pipeline";
import type { Rect } from "./geometry";
import { faceQualityIssues, measurePixelQuality, type FaceQuality } from "./quality";
import { isValidDescriptor } from "./match";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fa = (): any => (window as any).faceapi;
export const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/";
/** the detector's own cut-off (unchanged). The app's stricter "clear face" gate (DEFAULT_CONFIG.minDetectionScore) sits on top. */
export const DETECTOR_MIN_CONFIDENCE = 0.5;
const SSD = () => new (fa().SsdMobilenetv1Options)({ minConfidence: DETECTOR_MIN_CONFIDENCE });

export async function loadModels() {
  if (typeof fa() === "undefined") throw new Error("Could not load the face-recognition library from the internet.");
  const load = (async () => {
    await fa().nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await fa().nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await fa().nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  })();
  let timer = 0;
  const timeout = new Promise<never>((_, rej) => {
    timer = window.setTimeout(() => rej(new Error("Loading the face models timed out.")), 90000);
  });
  try {
    await Promise.race([load, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

const round = (arr: ArrayLike<number>) => Array.from(arr, (x) => +x.toFixed(4));
export { dist, confidence, bestMatches } from "./match";
export type { Match } from "./match";
export type { DetectedFace, PipelineDiag };
export { PipelineError } from "./pipeline";

/* ---------- the real engine: face-api + canvas ---------- */
type Src = CanvasImageSource;

function mediaSize(src: Src): { w: number; h: number } {
  const media = src as HTMLImageElement & HTMLVideoElement & HTMLCanvasElement;
  return {
    w: media.naturalWidth || media.videoWidth || media.width,
    h: media.naturalHeight || media.videoHeight || media.height,
  };
}

function faceQuality(src: Src, box: { x: number; y: number; width: number; height: number }): FaceQuality {
  const { w, h } = mediaSize(src);
  const faceArea = box.width * box.height;
  const sx = Math.max(0, Math.floor(box.x));
  const sy = Math.max(0, Math.floor(box.y));
  const ex = Math.min(w, Math.ceil(box.x + box.width));
  const ey = Math.min(h, Math.ceil(box.y + box.height));
  const cropW = ex - sx;
  const cropH = ey - sy;
  const visibleFraction = faceArea > 0 ? Math.min(1, Math.max(0, cropW * cropH) / faceArea) : 0;
  const unavailable = (unavailableReason: string): FaceQuality => ({ available: false, visibleFraction, brightness: 0, contrast: 0, sharpness: 0, unavailableReason });
  if (!(w > 0 && h > 0 && cropW >= 3 && cropH >= 3)) return unavailable("face pixels are outside the image");

  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return unavailable("the browser could not read the face crop");
  try {
    context.drawImage(src, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    const pixels = context.getImageData(0, 0, cropW, cropH);
    const measured = measurePixelQuality(pixels.data, cropW, cropH);
    return measured
      ? { available: true, visibleFraction, ...measured }
      : unavailable("the face crop did not contain enough pixels");
  } catch {
    return unavailable("the browser could not read the face crop");
  }
}

/** proportional copy of `r` into a dw x dh canvas. Large reductions are done in halving steps (a single 4000px -> 1000px
 * drawImage aliases and softens exactly the fine detail the detector needs). */
function resample(source: Src, r: Rect, dw: number, dh: number): HTMLCanvasElement {
  const mk = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    if (!x) throw new Error("the browser could not create a drawing canvas (image too large or out of memory)");
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    return { c, x };
  };
  let cur: Src = source;
  let { sx, sy, sw, sh } = r;
  while (sw / dw > 2 || sh / dh > 2) {
    const nw = Math.max(dw, Math.ceil(sw / 2));
    const nh = Math.max(dh, Math.ceil(sh / 2));
    const { c, x } = mk(nw, nh);
    x.drawImage(cur, sx, sy, sw, sh, 0, 0, nw, nh);
    cur = c;
    sx = 0;
    sy = 0;
    sw = nw;
    sh = nh;
  }
  const { c, x } = mk(dw, dh);
  x.drawImage(cur, sx, sy, sw, sh, 0, 0, dw, dh);
  return c;
}

const engine: PipelineEnv<Src> = {
  async detectAll(src): Promise<RawFace[]> {
    const dets = await fa().detectAllFaces(src, SSD()).withFaceLandmarks().withFaceDescriptors();
    return dets.map((d: any) => {
      const { x, y, width, height } = d.detection.box;
      const box = { x, y, width, height };
      return {
        box,
        score: d.detection.score as number,
        descriptor: Array.from(d.descriptor as ArrayLike<number>),
        quality: faceQuality(src, box),
      };
    });
  },
  draw: resample,
};

/** Find every face in a photo (any size / orientation). Boxes in the result: `box` = working-canvas coordinates (overlay),
 * `origBox` = original pixels (sizes). Throws PipelineError with a readable reason when detection cannot run at all. */
export function detectImage(source: Src, w: number, h: number, minScore = DEFAULT_CONFIG.minDetectionScore): Promise<{ faces: DetectedFace[]; diag: PipelineDiag }> {
  return analyseImage(source, w, h, engine, { minScore });
}

const dimsOf = (s: HTMLImageElement | HTMLCanvasElement) => ({
  w: (s as HTMLImageElement).naturalWidth || s.width,
  h: (s as HTMLImageElement).naturalHeight || s.height,
});

/** Descriptor of the SUBJECT of a reference photo, built by the same pipeline as a scan (so gallery and query are prepared
 * identically). null when there is no single clear face, the embedding is invalid, or a small face fails its quality gate. */
export async function descriptorFromImage(img: HTMLImageElement | HTMLCanvasElement) {
  const { w, h } = dimsOf(img);
  const { faces } = await detectImage(img, w, h, DEFAULT_CONFIG.minDetectionScore);
  const { face } = pickSubject(faces);
  if (!face) return null;
  if (!(face.score >= DEFAULT_CONFIG.minDetectionScore)) return null;
  if (!(Math.min(face.origBox.width, face.origBox.height) >= DEFAULT_CONFIG.minFacePx)) return null;
  if (!isValidDescriptor(face.descriptor)) return null;
  if (Math.min(face.origBox.width, face.origBox.height) < DEFAULT_CONFIG.smallFaceQualityPx && faceQualityIssues(face.quality).length) return null;
  return round(face.descriptor);
}

/* Wikimedia only serves thumbnails at its standard widths (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840 px) and
 * rejects every other width with HTTP 429. The old code asked for 640px, which always failed (the error was swallowed), so
 * every gallery reference was silently built from the small summary thumbnail. Try the larger STANDARD widths first
 * (a width the original is too small for is refused too, hence the ladder), then the URL exactly as given. */
const REFERENCE_WIDTHS = [960, 500];
function referenceUrls(url: string): string[] {
  const m = url.match(/\/(\d+)px-/);
  if (!m) return [url];
  return [...REFERENCE_WIDTHS.filter((w) => w > +m[1]!).map((w) => url.replace(/\/\d+px-/, `/${w}px-`)), url];
}
export async function descriptorFromUrl(url: string) {
  for (const u of referenceUrls(url)) {
    try {
      const d = await descriptorFromImage(await fa().fetchImage(u));
      if (d) return d;
    } catch {
      /* try next */
    }
  }
  return null;
}
export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    const url = URL.createObjectURL(file);
    i.onload = () => {
      res(i);
      URL.revokeObjectURL(url);
    };
    i.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("unreadable image"));
    };
    i.src = url;
  });
}

/** add a player to the gallery from their Wikipedia photo; true when the player is (now) in the gallery */
export async function addPlayerFromWiki(title: string, gallery: Gallery): Promise<boolean> {
  const s = await cricketSummary(title);
  if (!s || !s.thumbnail) return false;
  const key = s.title;
  if (gallery[key]) return true;
  const d = await descriptorFromUrl(s.thumbnail.source);
  if (!d) return false;
  gallery[key] = { name: disp(s.title), samples: [d] };
  return true;
}
