/* Pure matching maths (no DOM, no network) – shared by the app and by the unit tests. Unchanged from the original app. */
import type { Gallery } from "./storage";

export const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < 128; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
};
/** 0.40 -> 100%, 0.60 -> 50%, 0.80 -> 0%  (unchanged from the original) */
export const confidence = (d: number) => Math.max(0, Math.min(1, (0.8 - d) / 0.4));

export interface Match {
  title: string;
  name: string;
  dist: number;
  samples: number;
}
/** every gallery player ranked by their closest stored sample (ascending distance) */
export function bestMatches(gallery: Gallery, desc: ArrayLike<number>, n = 3): Match[] {
  const out = Object.entries(gallery).map(([title, p]) => ({
    title,
    name: p.name,
    samples: p.samples.length,
    dist: Math.min(...p.samples.map((s) => dist(desc, s))),
  }));
  return out.sort((a, b) => a.dist - b.dist).slice(0, n);
}
