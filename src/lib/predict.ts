/* The prediction (decision) engine.
 *
 * Input: the faces found in ONE photo + the face gallery + the thresholds. Output: exactly one outcome.
 * This is a DATABASE-BASED prediction: "no registered cricketer matched" never proves who a person is or what they do.
 *
 * A face is only declared a match when ALL of these hold (a low-confidence match is never forced):
 *   1. exactly one face is in the photo
 *   2. the face is clear enough (detector score) and big enough – size is measured in ORIGINAL photo pixels
 *   3. closest gallery distance  <= distance limit            (default 0.55; face-api's usual cut-off is 0.6)
 *   4. confidence                >= minimum confidence        (default 60 %, confidence = (0.8 - distance) / 0.4)
 *   5. the second-closest *different* player is not almost as close (ambiguity margin) */
import type { Gallery } from "./storage";
import { bestMatches, confidence, isValidDescriptor, type Match } from "./match";
import { faceQualityIssues, type FaceQuality } from "./quality";

export interface PredictConfig {
  /** maximum face distance for a match (0.30 - 0.80) */
  limit: number;
  /** minimum confidence for a match, 0..1 */
  minConfidence: number;
  /** minimum detector score for the face to be considered clear */
  minDetectionScore: number;
  /** absolute minimum face width/height in pixels of the ORIGINAL photo */
  minFacePx: number;
  /** faces under this size need a strong quality check before matching */
  smallFaceQualityPx: number;
  /** faces smaller than this (but >= minFacePx) are still identified, with a "low resolution" warning in the diagnostics */
  lowResPx: number;
  /** if another player is within this distance of the best one (and also under the limit) the result is inconclusive */
  ambiguityMargin: number;
}
export const DEFAULT_CONFIG: PredictConfig = {
  limit: 0.55,
  minConfidence: 0.6,
  minDetectionScore: 0.7,
  minFacePx: 32,
  smallFaceQualityPx: 48,
  lowResPx: 80,
  ambiguityMargin: 0.03,
};
export const makeConfig = (limitPct: number, minConfPct: number): PredictConfig => ({
  ...DEFAULT_CONFIG,
  limit: limitPct / 100,
  minConfidence: minConfPct / 100,
});

export const MESSAGES = {
  noFace: "No face detected. Please upload a clear face image.",
  multiple: (n: number) => `${n} faces detected. Please upload an image containing only one person.`,
  /** a failed database match says nothing about whether the person is a cricketer */
  noMatch: "No registered Indian cricket player matched.",
  /** the face WAS found; the headline says exactly why it was not used */
  smallFace: (px: number, min: number) => `The face is too small to identify (${Math.round(px)} px in your photo; at least ${min} px needed). Please upload a closer or higher-resolution photo.`,
  lowQuality: (issues: string[]) => `The small face is not clear enough for a reliable match (${issues.join("; ")}). Please upload a sharper, better-lit, less-cropped photo.`,
  invalidEmbedding: "A face was detected, but its features could not be extracted reliably. Please upload a clearer photo.",
  lowScore: (score: number, min: number) =>
    `A face was found but the detector is not confident enough (${Math.round(score * 100)}% vs ${Math.round(min * 100)}% needed). Please upload a sharper, better-lit, front-facing photo.`,
  ambiguous: "Could not identify this person with confidence – two registered players look similar. Please upload a clearer photo.",
  emptyGallery: "The face gallery is empty – open Data Sources and build it first.",
  disclaimer:
    "Database-based prediction only: no registered cricketer matched with sufficient confidence. This does not prove the person is not a cricketer, or what their profession is.",
} as const;

export interface FaceInput {
  /** box in the analysed canvas (used only when origBox is missing) */
  box: { width: number; height: number };
  /** box in ORIGINAL photo pixels – the size limit is judged on this one */
  origBox?: { width: number; height: number };
  score: number;
  descriptor: ArrayLike<number>;
  quality?: FaceQuality;
}

export type Prediction =
  | { kind: "no-face" }
  | { kind: "multiple"; count: number }
  | { kind: "unclear"; reason: "low-detection" | "small-face" | "low-quality" | "invalid-embedding"; score: number; sizePx: number; qualityIssues?: string[] }
  | { kind: "empty-gallery" }
  | { kind: "match"; best: Match; confidence: number; margin: number | null; candidates: Match[]; score: number; sizePx: number; lowRes: boolean }
  | { kind: "no-match"; closest: Match; confidence: number; why: "distance" | "confidence"; candidates: Match[]; score: number; sizePx: number; lowRes: boolean }
  | { kind: "ambiguous"; best: Match; runnerUp: Match; confidence: number; candidates: Match[]; score: number; sizePx: number; lowRes: boolean };

const EPS = 1e-9;

export function predict(faces: FaceInput[], gallery: Gallery, cfg: PredictConfig = DEFAULT_CONFIG, candidatesN = 10): Prediction {
  if (faces.length === 0) return { kind: "no-face" };
  if (faces.length > 1) return { kind: "multiple", count: faces.length };

  const f = faces[0]!;
  const sz = f.origBox ?? f.box;
  const sizePx = Math.min(sz.width, sz.height);
  if (!(f.score >= cfg.minDetectionScore)) return { kind: "unclear", reason: "low-detection", score: f.score, sizePx };
  if (!(sizePx >= cfg.minFacePx)) return { kind: "unclear", reason: "small-face", score: f.score, sizePx };
  if (!isValidDescriptor(f.descriptor)) return { kind: "unclear", reason: "invalid-embedding", score: f.score, sizePx };
  if (sizePx < cfg.smallFaceQualityPx) {
    const issues = faceQualityIssues(f.quality);
    if (issues.length) return { kind: "unclear", reason: "low-quality", score: f.score, sizePx, qualityIssues: issues };
  }
  if (Object.keys(gallery).length === 0) return { kind: "empty-gallery" };

  const candidates = bestMatches(gallery, f.descriptor, candidatesN);
  const best = candidates[0];
  if (!best) return { kind: "empty-gallery" }; // players exist but none has a usable (128-number) sample
  const lowRes = sizePx < cfg.lowResPx;
  const conf = confidence(best.dist);
  const withinDistance = best.dist <= cfg.limit + EPS;
  const withinConfidence = conf >= cfg.minConfidence - EPS;
  if (!withinDistance || !withinConfidence) {
    return { kind: "no-match", closest: best, confidence: conf, why: withinDistance ? "confidence" : "distance", candidates, score: f.score, sizePx, lowRes };
  }

  // a different player who is almost as close makes the result unreliable -> do not guess
  const runnerUp = candidates.find((c, i) => i > 0 && c.name !== best.name);
  if (runnerUp && runnerUp.dist <= cfg.limit + EPS && runnerUp.dist - best.dist < cfg.ambiguityMargin - EPS) {
    return { kind: "ambiguous", best, runnerUp, confidence: conf, candidates, score: f.score, sizePx, lowRes };
  }
  return { kind: "match", best, confidence: conf, margin: runnerUp ? runnerUp.dist - best.dist : null, candidates, score: f.score, sizePx, lowRes };
}

/** One sentence naming the exact rule that decided the outcome (shown in the scanner's diagnostics). */
export function explain(p: Prediction, cfg: PredictConfig): string {
  const d = (x: number) => x.toFixed(3);
  switch (p.kind) {
    case "no-face":
      return "The detector found no face (confidence >= 50%) in the whole photo, including a scan of the original-resolution tiles when the photo was reduced.";
    case "multiple":
      return `${p.count} faces were found; nobody is identified when a photo contains more than one face.`;
    case "unclear":
      if (p.reason === "small-face") return `Rejected: the face is ${Math.round(p.sizePx)} px (shorter side, original photo pixels), below the ${cfg.minFacePx} px minimum.`;
      if (p.reason === "low-detection") return `Rejected: detector confidence ${Math.round(p.score * 100)}% is below the ${Math.round(cfg.minDetectionScore * 100)}% needed for a clear face.`;
      if (p.reason === "low-quality") return MESSAGES.lowQuality(p.qualityIssues || []);
      return MESSAGES.invalidEmbedding;
    case "empty-gallery":
      return "The gallery has no usable reference photos.";
    case "match":
      return `Matched: ${p.best.name} at distance ${d(p.best.dist)} (limit ${cfg.limit.toFixed(2)}), confidence ${(p.confidence * 100).toFixed(1)}% (minimum ${Math.round(cfg.minConfidence * 100)}%)` +
        (p.margin === null ? "; no other player within range." : `; next different player is ${d(p.margin)} further away.`);
    case "no-match": {
      const one = p.closest.samples === 1 ? " The closest player has only 1 reference photo – adding more photos in Player Library improves recognition." : "";
      const failures = [
        p.closest.dist > cfg.limit + EPS ? `distance ${d(p.closest.dist)} exceeds the ${cfg.limit.toFixed(2)} limit` : "",
        p.confidence < cfg.minConfidence - EPS ? `confidence ${(p.confidence * 100).toFixed(1)}% is below the ${Math.round(cfg.minConfidence * 100)}% minimum` : "",
      ].filter(Boolean);
      return `Rejected: closest registered player ${p.closest.name}; ${failures.join(" and ")}.${one}`;
    }
    case "ambiguous":
      return `Not decided: ${p.best.name} (${d(p.best.dist)}) and ${p.runnerUp.name} (${d(p.runnerUp.dist)}) are less than ${cfg.ambiguityMargin} apart.`;
  }
}
