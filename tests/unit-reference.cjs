/* Regression test: gallery reference photos must be fetched at a width Wikimedia actually serves.
 *
 * BUG: descriptorFromUrl() (src/lib/face.ts) tried to fetch a bigger copy of the Wikipedia portrait by rewriting
 * "/330px-" to "/640px-". Wikimedia only serves its standard thumbnail widths (20, 40, 60, 120, 250, 330, 500, 960, 1280,
 * 1920, 3840 px) and rejects any other width with HTTP 429. The failure was swallowed by a bare catch, so every player was
 * silently enrolled from the small summary thumbnail instead (a tiny face -> a poor reference descriptor -> real photos of
 * the player end up "not a cricket player"). Very small reference faces now additionally need to pass the quality gate.
 *
 * WHAT THIS TEST USES: the REAL src/lib/face.ts (transpiled in memory) with
 *   - a fake `window.faceapi` (TEST DOUBLE - no neural network; the "descriptor" simply encodes the width of the image the
 *     detector was given, so the test can see which resolution the reference was built from), and
 *   - a fake Wikimedia (TEST DOUBLE) that enforces the standard-width rule and refuses to upscale past the original.
 * WHAT IT PROVES: which image URLs/widths the app requests and enrolls. It does NOT prove anything about real face
 * recognition accuracy - that needs the real models and real photos (see README "Check real recognition by hand"). */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SRC = path.join(__dirname, "..", "src", "lib");
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const out = ts.transpileModule(fs.readFileSync(path.join(SRC, name + ".ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod;
  new Function("exports", "require", "module", out)(mod.exports, (s) => load(s.replace("./", "")), mod);
  return mod.exports;
}

const STANDARD = new Set([20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840]);
const widthOf = (u) => +u.match(/\/(\d+)px-/)[1];
const thumb = (w) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Player.jpg/${w}px-Player.jpg`;

/* install the doubles; `original` = width in px of the original file on the fake Wikimedia; `faceless` = widths with no face */
function install(original, faceless = [], custom = null) {
  const requested = [];
  const seen = [];
  /* minimal canvas double: remembers the width of the ORIGINAL image it was drawn from, so a resized working copy / crop still
   * "encodes" which Wikimedia width the reference was built from */
  global.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext() {
        const c = this;
          return {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "low",
            drawImage(src) { c._origW = src._origW ?? src.naturalWidth; },
            getImageData(_x, _y, w, h) {
              const data = new Uint8ClampedArray(w * h * 4);
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const o = (y * w + x) * 4;
                const v = (x + y) % 2 ? 210 : 45;
                data[o] = data[o + 1] = data[o + 2] = v;
                data[o + 3] = 255;
              }
              return { data };
            },
          };
      },
    }),
  };
  const widthOfSrc = (img) => img._origW ?? img.naturalWidth;
  global.window = {
    faceapi: {
      SsdMobilenetv1Options: class {},
      fetchImage: async (u) => {
        requested.push(u);
        const w = widthOf(u);
        if (!STANDARD.has(w)) throw new Error("HTTP 429 Use thumbnail steps"); // real Wikimedia policy
        if (w > original) throw new Error("HTTP 400 requested size larger than the original");
        return { naturalWidth: w, naturalHeight: Math.round(w * 0.75) };
      },
      detectAllFaces: (img) => ({
        withFaceLandmarks: () => ({
          withFaceDescriptors: async () => {
            const ow = widthOfSrc(img);
            seen.push(ow);
            if (faceless.includes(ow)) return [];
            const W = img.naturalWidth ?? img.width, H = img.naturalHeight ?? img.height;
            if (custom) return custom(W, H).map((f) => ({ detection: { box: f.box, score: f.score }, descriptor: new Float32Array(128).fill(ow / 10000) }));
            // one big, clear face in the middle; the descriptor encodes the width of the image it came from
            return [{ detection: { box: { x: W * 0.25, y: H * 0.2, width: W * 0.5, height: H * 0.6 }, score: 0.97 }, descriptor: new Float32Array(128).fill(ow / 10000) }];
          },
        }),
      }),
    },
  };
  return { requested, seen };
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const enrolledWidth = (d) => (d ? Math.round(d[0] * 10000) : null);

(async () => {
  const { descriptorFromUrl } = load("face");

  // R1: normal case - the original is large, the REST summary hands out the 330px thumbnail
  let t = install(2000);
  let d = await descriptorFromUrl(thumb(330));
  check("R1 reference is built from a LARGE image (960px), not the 330px summary thumbnail", enrolledWidth(d) === 960, `enrolled from ${enrolledWidth(d)}px; requested ${t.requested.map(widthOf)}`);
  check("R1 every width the app asks Wikimedia for is a standard width (non-standard ones get HTTP 429)", t.requested.length > 0 && t.requested.every((u) => STANDARD.has(widthOf(u))), `requested ${t.requested.map(widthOf)}`);
  check("R1 a successful large fetch needs no further requests", t.requested.length === 1, `requested ${t.requested.map(widthOf)}`);

  // R2: original is only 700px wide -> 960 is refused (no upscaling) -> falls back to 500, still better than 330
  t = install(700);
  d = await descriptorFromUrl(thumb(330));
  check("R2 original narrower than 960px -> falls back to 500px (not straight to 330px)", enrolledWidth(d) === 500, `enrolled from ${enrolledWidth(d)}px; requested ${t.requested.map(widthOf)}`);

  // R3: original only 400px -> bigger copies refused -> the thumbnail URL as given is still used (previous behaviour kept)
  t = install(400);
  d = await descriptorFromUrl(thumb(330));
  check("R3 small original -> uses the summary thumbnail as before (never fails to enrol a usable photo)", enrolledWidth(d) === 330, `enrolled from ${enrolledWidth(d)}px`);

  // R4: the large copy has no detectable face -> next candidate is tried
  t = install(2000, [960]);
  d = await descriptorFromUrl(thumb(330));
  check("R4 no face in the 960px copy -> the next copy (500px) is tried", enrolledWidth(d) === 500, `enrolled from ${enrolledWidth(d)}px`);

  // R5: nothing usable at all -> null, no crash
  t = install(2000, [960, 500, 330]);
  d = await descriptorFromUrl(thumb(330));
  check("R5 no face in any copy -> null (player is skipped, no exception)", d === null);

  // R6: a URL that is not a Wikimedia thumbnail is used untouched
  t = install(5000);
  const plain = "https://example.org/photos/player.jpg";
  global.window.faceapi.fetchImage = async (u) => { t.requested.push(u); return { naturalWidth: 700, naturalHeight: 525 }; };
  d = await descriptorFromUrl(plain);
  check("R6 a non-thumbnail URL is requested exactly as given", t.requested.length === 1 && t.requested[0] === plain && enrolledWidth(d) === 700, t.requested.join());

  // R7: already-large thumbnails are never replaced by a SMALLER copy first
  t = install(5000);
  d = await descriptorFromUrl(thumb(1280));
  check("R7 a 1280px thumbnail is used as given (no downgrade to 960/500)", enrolledWidth(d) === 1280 && t.requested.length === 1, `enrolled ${enrolledWidth(d)}px; requested ${t.requested.map(widthOf)}`);

  // R8-R10: what is allowed into the gallery as a reference
  const bx = (W, H, k, sc = 0.97, ox = 0.25) => ({ box: { x: W * ox, y: H * 0.2, width: W * k, height: W * k * 1.15 }, score: sc });
  t = install(2000, [], (W, H) => [bx(W, H, 0.5, 0.9, 0.05), bx(W, H, 0.45, 0.99, 0.5)]);
  d = await descriptorFromUrl(thumb(330));
  check("R8 team photo (two similar faces) is NOT enrolled - the highest-score face is not necessarily the player", d === null, `enrolled ${enrolledWidth(d)}`);
  t = install(2000, [], (W, H) => [bx(W, H, 0.5, 0.9, 0.05), bx(W, H, 0.12, 0.99, 0.7)]);
  d = await descriptorFromUrl(thumb(330));
  check("R8 a dominant face wins over a small background face with a higher score", enrolledWidth(d) === 960, `enrolled ${enrolledWidth(d)}`);
  t = install(2000, [], (W, H) => [bx(W, H, 0.04, 0.97)]);
  d = await descriptorFromUrl(thumb(330));
  check("R9 a sharp ~38px face is eligible for reference enrollment", enrolledWidth(d) === 960, `enrolled ${enrolledWidth(d)}`);
  t = install(2000, [], (W, H) => [bx(W, H, 0.5, 0.6)]);
  d = await descriptorFromUrl(thumb(330));
  check("R10 a face the detector is only 60% sure of is not enrolled as a reference", d === null, `enrolled ${enrolledWidth(d)}`);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
