/* Unit tests for the prediction rules (src/lib/predict.ts + src/lib/match.ts).
 * Runs the REAL source (transpiled in memory with the project's own TypeScript) on synthetic 128-number descriptors placed at
 * exact distances. This proves the decision rules and thresholds; it says nothing about how well the neural network
 * recognises real faces. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SRC = path.join(__dirname, "..", "src", "lib");
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const file = path.join(SRC, name + ".ts");
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod;
  new Function("exports", "require", "module", out)(mod.exports, (s) => load(s.replace("./", "")), mod);
  return mod.exports;
}
const { predict, makeConfig, DEFAULT_CONFIG, MESSAGES } = load("predict");
const { confidence, dist, bestMatches } = load("match");
const { faceQualityIssues, measurePixelQuality } = load("quality");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* a descriptor at exact Euclidean distance d from the origin, along axis k */
const at = (d, k = 0) => { const v = new Array(128).fill(0); v[k] = d; return v; };
const gal = (o) => Object.fromEntries(Object.entries(o).map(([title, samples]) => [title, { name: title.replace(/\s*\(.*\)$/, ""), samples }]));
const face = (descriptor, extra = {}) => ({ box: { width: 200, height: 220 }, score: 0.97, descriptor, ...extra });
const cfg = DEFAULT_CONFIG;
const ORIGIN = new Array(128).fill(0);
const G = gal({ "Player A": [ORIGIN] });
const goodSmallQuality = { available: true, brightness: 120, contrast: 45, sharpness: 80, visibleFraction: 1 };

/* ---- exact wording required by the product spec ---- */
check("U01 message: a failed database match is worded as NO MATCH, never \"not a cricket player\"", MESSAGES.noMatch === "No registered Indian cricket player matched." && !("notCricketer" in MESSAGES));
check("U02 message: no face", MESSAGES.noFace === "No face detected. Please upload a clear face image.");
check("U03 message: multiple faces asks for one person", MESSAGES.multiple(3) === "3 faces detected. Please upload an image containing only one person.");
check("U04 disclaimer says it is not proof", /does not prove/.test(MESSAGES.disclaimer) && /Database-based/.test(MESSAGES.disclaimer));

/* ---- defaults ---- */
check("U05 defaults: distance 0.55, confidence 60%, detection 0.7, face 32px floor / 48px quality gate / 80px low-res warning", cfg.limit === 0.55 && cfg.minConfidence === 0.6 && cfg.minDetectionScore === 0.7 && cfg.minFacePx === 32 && cfg.smallFaceQualityPx === 48 && cfg.lowResPx === 80);
const c2 = makeConfig(48, 72);
check("U06 makeConfig converts slider percents", near(c2.limit, 0.48) && near(c2.minConfidence, 0.72) && c2.minFacePx === 32);

{
  const checker = new Uint8ClampedArray(34 * 34 * 4);
  const flat = new Uint8ClampedArray(34 * 34 * 4);
  for (let y = 0; y < 34; y++) for (let x = 0; x < 34; x++) {
    const o = (y * 34 + x) * 4;
    const v = (x + y) % 2 ? 210 : 45;
    checker[o] = checker[o + 1] = checker[o + 2] = v;
    checker[o + 3] = 255;
    flat[o] = flat[o + 1] = flat[o + 2] = 120;
    flat[o + 3] = 255;
  }
  const sharp = measurePixelQuality(checker, 34, 34);
  const blurred = measurePixelQuality(flat, 34, 34);
  check("Q01 pixel quality detects sharp detail and rejects a flat/blurred crop", sharp && sharp.sharpness >= 18 && sharp.contrast >= 12 && blurred && blurred.sharpness === 0 && blurred.contrast === 0);
  check("Q02 a clear small-face crop passes the quality gate", faceQualityIssues({ ...goodSmallQuality, visibleFraction: 1 }).length === 0);
  check("Q03 a cropped or unmeasurable small-face crop fails the quality gate", faceQualityIssues({ ...goodSmallQuality, visibleFraction: 0.5 }).length > 0 && faceQualityIssues(undefined).length > 0);
}

/* ---- confidence maths (unchanged from the original app) ---- */
check("U07 confidence(0.40)=1, (0.60)=0.5, (0.80)=0", near(confidence(0.4), 1) && near(confidence(0.6), 0.5) && near(confidence(0.8), 0));
check("U08 confidence clamps to 0..1", confidence(0) === 1 && confidence(2) === 0);
check("U09 dist() is Euclidean", near(dist(at(3), at(0)), 3) && near(dist([...at(3).slice(0, 1), 4, ...new Array(126).fill(0)], ORIGIN), 5));

/* ---- no face / several faces / unclear / empty gallery ---- */
check("U10 no faces -> no-face", predict([], G, cfg).kind === "no-face");
const two = predict([face(at(0)), face(at(0))], G, cfg);
check("U11 two faces -> multiple (count 2), no identification", two.kind === "multiple" && two.count === 2 && !("best" in two));
check("U12 five faces -> multiple (count 5)", predict(Array.from({ length: 5 }, () => face(at(0))), G, cfg).count === 5);
check("U13 low detection score 0.69 -> unclear", (() => { const p = predict([face(at(0), { score: 0.69 })], G, cfg); return p.kind === "unclear" && p.reason === "low-detection"; })());
check("U14 detection score exactly 0.70 is accepted", predict([face(at(0), { score: 0.7 })], G, cfg).kind === "match");
check("U15 a sharp 34px face is eligible for matching without changing the match thresholds", (() => { const p = predict([face(at(0), { box: { width: 34, height: 39 }, origBox: { width: 34, height: 39 }, quality: goodSmallQuality })], G, cfg); return p.kind === "match"; })());
check("U16 face 48px accepted", predict([face(at(0), { box: { width: 48, height: 48 } })], G, cfg).kind === "match");
check("Q04 a blurry 34px face is unclear rather than identified", (() => { const p = predict([face(at(0), { origBox: { width: 34, height: 39 }, quality: { ...goodSmallQuality, sharpness: 2 } })], G, cfg); return p.kind === "unclear" && p.reason === "low-quality"; })());
check("Q05 a 31px face remains below the practical input floor", (() => { const p = predict([face(at(0), { origBox: { width: 31, height: 35 }, quality: goodSmallQuality })], G, cfg); return p.kind === "unclear" && p.reason === "small-face"; })());
check("Q06 an invalid face embedding is unclear rather than an empty-gallery result", (() => { const p = predict([face([NaN], { origBox: { width: 34, height: 39 }, quality: goodSmallQuality })], G, cfg); return p.kind === "unclear" && p.reason === "invalid-embedding"; })());
check("Q07 a sharp 34px face still cannot bypass the existing identity distance threshold", (() => { const p = predict([face(at(0.7), { origBox: { width: 34, height: 39 }, quality: goodSmallQuality })], G, cfg); return p.kind === "no-match" && p.why === "distance"; })());
check("U17 NaN detection score is treated as unclear (never matched)", predict([face(at(0), { score: NaN })], G, cfg).kind === "unclear");
check("U18 empty gallery -> empty-gallery", predict([face(at(0))], {}, cfg).kind === "empty-gallery");
check("U19 multiple faces beats empty gallery / unclear", predict([face(at(0)), face(at(0), { score: 0.1 })], {}, cfg).kind === "multiple");

/* ---- matching and the two thresholds ---- */
const m0 = predict([face(at(0))], G, cfg);
check("U20 identical face -> match, confidence 100%", m0.kind === "match" && m0.best.title === "Player A" && m0.confidence === 1);
check("U21 distance exactly at the limit (0.55) matches", predict([face(at(0.55))], G, cfg).kind === "match");
const over = predict([face(at(0.5501))], G, cfg);
check("U22 distance just above the limit -> no-match (why: distance)", over.kind === "no-match" && over.why === "distance");
check("U23 a far face -> no-match, closest still reported", (() => { const p = predict([face(at(0.9))], G, cfg); return p.kind === "no-match" && p.closest.title === "Player A" && p.confidence === 0; })());
const loose = makeConfig(70, 60);
check("U24 limit 0.70: distance 0.57 passes distance but confidence 57.5% < 60% -> no-match (why: confidence)", (() => { const p = predict([face(at(0.57))], G, loose); return p.kind === "no-match" && p.why === "confidence"; })());
check("U25 limit 0.70, floor 60%: distance 0.56 (confidence exactly 60%) matches", predict([face(at(0.56))], G, loose).kind === "match");
check("U26 raising the floor to 90% rejects distance 0.45 (confidence 87.5%)", predict([face(at(0.45))], G, makeConfig(55, 90)).kind === "no-match");
check("U27 lowering the floor to 30% with limit 0.80 accepts distance 0.68 (confidence 30%)", predict([face(at(0.68))], G, makeConfig(80, 30)).kind === "match");
check("U28 the stricter of the two thresholds always wins", [0.3, 0.4, 0.5, 0.55, 0.6, 0.7].every((d) => { const p = predict([face(at(d))], G, makeConfig(80, 60)); return (p.kind === "match") === (d <= 0.56 + 1e-9); }));
check("U29 low-confidence face is NEVER forced into a match (sweep 0.57..2.0)", Array.from({ length: 60 }, (_, i) => 0.57 + i * 0.0239).every((d) => predict([face(at(d))], G, cfg).kind === "no-match"));

/* ---- closest player, multiple samples, ranking ---- */
const G3 = gal({ "Player A": [at(0.9, 1), at(0.4, 0)], "Player B": [at(0.8, 2)], "Player C": [at(1.5, 3)] });
const r3 = predict([face(ORIGIN)], G3, makeConfig(55, 60));
check("U30 uses each player's CLOSEST sample (A: 0.4 not 0.9)", r3.kind === "match" && r3.best.title === "Player A" && near(r3.best.dist, 0.4));
check("U31 candidates are ranked by ascending distance", r3.candidates.map((c) => c.title).join() === "Player A,Player B,Player C");
check("U32 candidates limited to N", predict([face(ORIGIN)], G3, cfg, 2).candidates.length === 2);

/* ---- ambiguity: do not guess between two similar players ---- */
const GA = gal({ "Player A": [at(0.4, 0)], "Player B": [at(0.41, 1)] });
const amb = predict([face(ORIGIN)], GA, cfg);
check("U33 two players 0.01 apart, both within limit -> ambiguous, no name", amb.kind === "ambiguous" && amb.best.title === "Player A" && amb.runnerUp.title === "Player B");
check("U34 runner-up 0.05 behind -> clear match with margin", (() => { const p = predict([face(ORIGIN)], gal({ "Player A": [at(0.4, 0)], "Player B": [at(0.45, 1)] }), cfg); return p.kind === "match" && near(p.margin, 0.05, 1e-6); })());
check("U35 runner-up exactly at the margin (0.03) is NOT ambiguous", predict([face(ORIGIN)], gal({ "Player A": [at(0.4, 0)], "Player B": [at(0.43, 1)] }), makeConfig(55, 60)).kind === "match");
check("U36 close runner-up but beyond the limit is NOT ambiguous", predict([face(ORIGIN)], gal({ "Player A": [at(0.54, 0)], "Player B": [at(0.56, 1)] }), cfg).kind === "match");
check("U37 same person registered twice (same name, 2 keys) is NOT ambiguous", predict([face(ORIGIN)], { "Mukesh Kumar (cricketer)": { name: "Mukesh Kumar", samples: [at(0.4, 0)] }, "Mukesh Kumar": { name: "Mukesh Kumar", samples: [at(0.405, 1)] } }, cfg).kind === "match");
check("U38 ambiguity is skipped when the best is already rejected (no-match wins)", predict([face(ORIGIN)], gal({ "Player A": [at(0.9, 0)], "Player B": [at(0.91, 1)] }), cfg).kind === "no-match");
check("U39 single-player gallery can never be ambiguous", predict([face(ORIGIN)], gal({ "Player A": [at(0.4, 0)] }), cfg).kind === "match");

/* ---- purity ---- */
const before = JSON.stringify(G3);
predict([face(ORIGIN)], G3, cfg);
check("U40 predict() does not modify the gallery", JSON.stringify(G3) === before);
check("U41 bestMatches on a big gallery stays sorted", (() => { const g = {}; for (let i = 0; i < 300; i++) g["P" + i] = { name: "P" + i, samples: [at(((i * 37) % 300) / 100 + 0.01, i % 128)] }; const m = bestMatches(g, ORIGIN, 300); return m.every((x, i) => i === 0 || m[i - 1].dist <= x.dist); })());

/* ================= regression tests for the root causes found in the audit ================= */
const { isValidDescriptor, galleryHealth } = load("match");
const { explain } = load("predict");

/* ---- R-A: face size is judged in ORIGINAL photo pixels, not in the shrunken working canvas ---- */
{
  // 4000x3000 photo, 220px face. Working canvas is 1024px wide (scale 0.256) so the canvas box is only 56px.
  const f = { box: { width: 56, height: 62 }, origBox: { width: 220, height: 240 }, score: 0.95, descriptor: at(0) };
  check("U50 220px face in a 4000px photo is accepted (judged on origBox, not the 56px canvas box)", predict([f], G, cfg).kind === "match");
  const old = predict([{ box: f.box, score: f.score, descriptor: f.descriptor }], G, { ...cfg, minFacePx: 64 }); // what the old code saw
  check("U51 (proof of the old bug) the same face judged on the 56px canvas box with the old 64px limit is rejected", old.kind === "unclear" && old.reason === "small-face");
  const small = predict([{ box: { width: 40, height: 44 }, origBox: { width: 40, height: 44 }, score: 0.95, descriptor: at(0) }], G, cfg);
  check("U52 a 40px face with unavailable quality data is rejected as unclear", small.kind === "unclear" && small.reason === "low-quality" && small.sizePx === 40);
  const low = predict([face(at(0), { origBox: { width: 60, height: 70 } })], G, cfg);
  check("U53 a 60px face is identified but flagged low-resolution", low.kind === "match" && low.lowRes === true);
  check("U54 a 200px face is not flagged low-resolution", predict([face(at(0))], G, cfg).lowRes === false);
}

/* ---- R-B: malformed descriptors must not poison the ranking (NaN) ---- */
{
  const bad = [1, 2, 3]; // wrong length
  const nan = new Array(128).fill(0); nan[5] = NaN;
  const g = { "Real Player": { name: "Real Player", samples: [at(0.3, 0)] }, "Broken Sample": { name: "Broken Sample", samples: [bad, at(0.1, 1)] }, "NaN Sample": { name: "NaN Sample", samples: [nan] }, "No Samples": { name: "No Samples", samples: [] } };
  check("U55 isValidDescriptor accepts 128 finite numbers only", isValidDescriptor(at(1)) && !isValidDescriptor(bad) && !isValidDescriptor(nan) && !isValidDescriptor(null) && !isValidDescriptor(new Array(129).fill(0)));
  check("U56 dist() with an invalid descriptor is Infinity (never NaN)", dist(ORIGIN, bad) === Infinity && dist(nan, ORIGIN) === Infinity);
  const m = bestMatches(g, ORIGIN, 10);
  check("U57 invalid samples are ignored, the player's valid sample still counts, unusable players are skipped", m.length === 2 && m[0].title === "Broken Sample" && near(m[0].dist, 0.1) && m[0].samples === 1 && m[1].title === "Real Player", JSON.stringify(m));
  check("U58 confidence(NaN/Infinity) is 0, never NaN", confidence(NaN) === 0 && confidence(Infinity) === 0);
  const only = predict([face(at(0))], { A: { name: "A", samples: [bad] }, B: { name: "B", samples: [] } }, cfg);
  check("U59 a gallery with players but no usable sample -> empty-gallery (previously: crash on candidates[0])", only.kind === "empty-gallery");
  const h = galleryHealth({ ...g, Dup: { name: "Dup", samples: [at(1), at(1)] } });
  check("U60 galleryHealth counts invalid / unusable / single-sample / duplicate entries", h.invalidSamples === 2 && h.unusablePlayers === 2 && h.singleSample === 2 && h.duplicateSamples === 1, JSON.stringify(h));

  // the original match.ts (kept from the uploaded project) really did mis-rank when one sample was malformed
  const ts2 = require("typescript");
  const src = fs.readFileSync(path.join(__dirname, "fixtures", "match.original.ts"), "utf8");
  const out = ts2.transpileModule(src, { compilerOptions: { module: ts2.ModuleKind.CommonJS, target: ts2.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} }; new Function("exports", "require", "module", out)(mod.exports, () => ({}), mod);
  const oldM = mod.exports.bestMatches({ "Truly Closest": { name: "Truly Closest", samples: [at(0.2, 0)] }, "Has Bad Sample": { name: "Has Bad Sample", samples: [[1, 2, 3], at(0.1, 1)] }, Other: { name: "Other", samples: [at(0.5, 2)] } }, ORIGIN, 3);
  check("U61 (proof of the old bug) original bestMatches: NaN sample gives that player a NaN distance and disturbs the order", oldM.some((x) => Number.isNaN(x.dist)), JSON.stringify(oldM.map((x) => [x.title, x.dist])));
}

/* ---- R-C: wording + exact reasons ---- */
{
  const g = gal({ "Player A": [at(0.9, 0)] });
  const p = predict([face(ORIGIN)], g, cfg);
  check("U62 explain(no-match, distance) names the closest player, the distance and the limit", p.kind === "no-match" && /Player A/.test(explain(p, cfg)) && /0\.900/.test(explain(p, cfg)) && /0\.55/.test(explain(p, cfg)) && /only 1 reference photo/.test(explain(p, cfg)), explain(p, cfg));
  const conf = predict([face(ORIGIN)], gal({ "Player A": [at(0.5, 0)] }), makeConfig(60, 80));
  check("U63 explain(no-match, confidence) names the confidence rule when distance passes but confidence does not", conf.kind === "no-match" && conf.why === "confidence" && /below the 80% minimum/.test(explain(conf, makeConfig(60, 80))));
  const both = predict([face(at(0.7))], G, cfg);
  check("U68 explain(no-match) reports both failed thresholds when distance and confidence are below their limits", both.kind === "no-match" && /distance 0\.700 exceeds the 0\.55 limit/.test(explain(both, cfg)) && /confidence 25\.0% is below the 60% minimum/.test(explain(both, cfg)));
  check("U64 explain(small face) reports measured px and the minimum", /20 px/.test(explain(predict([face(at(0), { origBox: { width: 20, height: 25 } })], G, cfg), cfg)) && /32 px/.test(explain(predict([face(at(0), { origBox: { width: 20, height: 25 } })], G, cfg), cfg)));
  check("U65 explain(low detection) reports score and minimum", /62%/.test(explain(predict([face(at(0), { score: 0.62 })], G, cfg), cfg)) && /70%/.test(explain(predict([face(at(0), { score: 0.62 })], G, cfg), cfg)));
  check("U66 headline texts: small face / low score give their own reason, not the old generic text", /too small to identify \(40 px/.test(MESSAGES.smallFace(40, 48)) && /not confident enough \(62%/.test(MESSAGES.lowScore(0.62, 0.7)) && !/too small or unclear/.test(MESSAGES.smallFace(40, 48) + MESSAGES.lowScore(0.62, 0.7)));
  check("U67 no message anywhere claims the person is not a cricketer", !Object.values(MESSAGES).some((m) => typeof m === "string" && /not a cricket player/i.test(m)));
}

/* ---- R-D: synthetic identity simulation (decision logic only – NOT real face recognition) ----
 * Players are random points in 128-d; each "photo" is the identity plus noise. Sized so that same-person photos sit around
 * distance 0.45 and different people around 1.0, like dlib-style descriptors. It shows how the thresholds behave when a
 * player has one vs several reference photos; it cannot say how the real network performs. */
{
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const unit = (sd) => Array.from({ length: 128 }, () => gauss() * sd);
  const identity = () => unit(0.125);                 // two identities ~ 0.125*sqrt(2*128) = 2.0 apart -> scaled to 1.0 below
  const scaleV = (v, k) => v.map((x) => x * k);
  // every photo has its own quality factor (lighting / pose / blur): log-normal, so some photos of a person are much further away
  // from the reference than others. Without this, distances in 128-d concentrate unrealistically and every photo looks alike.
  const photo = (id, noise) => { const q = Math.exp(0.45 * gauss()); return id.map((x) => x + gauss() * noise * q); };
  const N = 74, K = 0.5;
  const ids = Array.from({ length: N }, () => scaleV(identity(), K));
  const noise = 0.40 / Math.sqrt(2 * 128);               // a typical pair of photos of one person differs by ~0.40 (varies widely, see above)
  const single = {}, multi = {};
  ids.forEach((id, i) => { single["P" + i] = { name: "P" + i, samples: [photo(id, noise)] }; multi["P" + i] = { name: "P" + i, samples: [photo(id, noise), photo(id, noise), photo(id, noise), photo(id, noise)] }; });
  let hitS = 0, hitM = 0, wrongS = 0, wrongM = 0, trials = 0;
  for (let i = 0; i < N; i++) for (let t = 0; t < 4; t++) {
    const q = photo(ids[i], noise); trials++;
    const a = predict([face(q)], single, cfg), b = predict([face(q)], multi, cfg);
    if (a.kind === "match") (a.best.title === "P" + i ? hitS++ : wrongS++);
    if (b.kind === "match") (b.best.title === "P" + i ? hitM++ : wrongM++);
  }
  let fpS = 0, fpM = 0; const U = 300;
  for (let u = 0; u < U; u++) { const q = scaleV(identity(), K); if (predict([face(q)], single, cfg).kind === "match") fpS++; if (predict([face(q)], multi, cfg).kind === "match") fpM++; }
  console.log(`   (synthetic) recall 1 photo/player ${hitS}/${trials}, 4 photos/player ${hitM}/${trials}; wrong-player matches ${wrongS}/${wrongM}; unknown accepted ${fpS}/${U} vs ${fpM}/${U}`);
  check("U70 (synthetic) several reference photos per player recognise strictly more new photos of the same person than one photo", hitM > hitS, `${hitM} vs ${hitS} of ${trials}`);
  check("U71 (synthetic) recall with 4 reference photos is at least 85%", hitM / trials >= 0.85, `${hitM}/${trials}`);
  check("U72 (synthetic) a recognised photo is never attributed to the WRONG player", wrongS === 0 && wrongM === 0, `${wrongS}/${wrongM}`);
  check("U73 (synthetic) unknown people are not forced into a match (<= 1% accepted)", fpS / U <= 0.01 && fpM / U <= 0.01, `${fpS}/${fpM} of ${U}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
