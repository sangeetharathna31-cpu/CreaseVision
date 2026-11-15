/* Pure matching maths (no DOM, no network) – shared by the app and by the unit tests.
 * Distance and confidence formulas are unchanged from the original app. What changed: malformed descriptors can no longer
 * poison the ranking. Before, a stored sample that was not 128 finite numbers made dist() return NaN; Math.min() then
 * returned NaN for that whole player and Array.sort() with NaN comparisons leaves the list in an undefined order, so the
 * true closest player could silently end up behind another one (or the player could never match). */
import type { Gallery } from "./storage";

export const DESC_LEN = 128;

/** a usable face descriptor: exactly 128 finite numbers */
export function isValidDescriptor(d: unknown): d is ArrayLike<number> {
  if (!d || typeof d !== "object" || (d as ArrayLike<number>).length !== DESC_LEN) return false;
  const a = d as ArrayLike<number>;
  for (let i = 0; i < DESC_LEN; i++) if (typeof a[i] !== "number" || !Number.isFinite(a[i]!)) return false;
  return true;
}

/** Euclidean distance; Infinity (never NaN) when either side is not a valid descriptor */
export const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (!isValidDescriptor(a) || !isValidDescriptor(b)) return Infinity;
  let s = 0;
  for (let i = 0; i < DESC_LEN; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
};
/** 0.40 -> 100%, 0.60 -> 50%, 0.80 -> 0%  (unchanged from the original) */
export const confidence = (d: number) => (Number.isFinite(d) ? Math.max(0, Math.min(1, (0.8 - d) / 0.4)) : 0);

export interface Match {
  title: string;
  name: string;
  dist: number;
  samples: number;
}
/** every gallery player ranked by their closest VALID stored sample (ascending distance). Players without any valid sample
 * are left out (they cannot be compared); invalid samples of other players are ignored. */
export function bestMatches(gallery: Gallery, desc: ArrayLike<number>, n = 3): Match[] {
  const out: Match[] = [];
  for (const [title, p] of Object.entries(gallery)) {
    const samples = Array.isArray(p?.samples) ? p.samples.filter(isValidDescriptor) : [];
    if (!samples.length) continue;
    let best = Infinity;
    for (const s of samples) best = Math.min(best, dist(desc, s));
    if (Number.isFinite(best)) out.push({ title, name: p.name, samples: samples.length, dist: best });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, n);
}

export interface GalleryHealth {
  players: number;
  /** valid samples */
  samples: number;
  /** samples that are not 128 finite numbers (ignored when matching) */
  invalidSamples: number;
  /** players with no usable sample at all (cannot ever match) */
  unusablePlayers: number;
  /** players that have only one reference photo (the weakest kind of reference) */
  singleSample: number;
  /** the same descriptor stored twice for one player */
  duplicateSamples: number;
}
export function galleryHealth(gallery: Gallery): GalleryHealth {
  const h: GalleryHealth = { players: 0, samples: 0, invalidSamples: 0, unusablePlayers: 0, singleSample: 0, duplicateSamples: 0 };
  for (const p of Object.values(gallery)) {
    h.players++;
    const raw = Array.isArray(p?.samples) ? p.samples : [];
    const ok = raw.filter(isValidDescriptor);
    h.samples += ok.length;
    h.invalidSamples += raw.length - ok.length;
    if (!ok.length) h.unusablePlayers++;
    if (ok.length === 1) h.singleSample++;
    for (let i = 0; i < ok.length; i++) for (let j = 0; j < i; j++) if (dist(ok[i]!, ok[j]!) < 1e-6) { h.duplicateSamples++; break; }
  }
  return h;
}
