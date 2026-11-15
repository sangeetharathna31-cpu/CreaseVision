/* Tests the REAL src/lib/face.ts canvas code (resample, detectImage) with a recording canvas double and a fake face-api.
 * Proves: every drawImage keeps the aspect ratio (never stretches), never enlarges, large reductions go in halving steps,
 * and the detector is handed the right surfaces. Does not run any neural network. */
const load = require("./load-src.cjs")();
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };

const draws = [];
global.document = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage: (src, sx, sy, sw, sh, dx, dy, dw, dh) => draws.push({ srcW: src.width ?? src.naturalWidth, sx, sy, sw, sh, dw, dh, canvasW: c.width, canvasH: c.height }) }) }; return c; } };
const detected = [];
global.window = { faceapi: { SsdMobilenetv1Options: class {}, detectAllFaces: (src) => ({ withFaceLandmarks: () => ({ withFaceDescriptors: async () => { detected.push({ w: src.width ?? src.naturalWidth, h: src.height ?? src.naturalHeight }); return []; } }) }) } };
const { detectImage } = load("face");

(async () => {
  for (const [w, h] of [[4000, 3000], [3000, 4000], [6000, 4000], [1000, 8000], [12000, 9000], [1500, 1500]]) {
    draws.length = 0; detected.length = 0;
    const img = { naturalWidth: w, naturalHeight: h, width: w, height: h };
    const { diag } = await detectImage(img, w, h);
    const aspectOK = draws.every((d) => Math.abs(d.sw / d.sh - d.dw / d.dh) / (d.sw / d.sh) < 0.02 + 2 / Math.min(d.dw, d.dh));
    const noEnlarge = draws.every((d) => d.dw <= d.sw && d.dh <= d.sh);
    const steps = draws.filter((d) => d.sx === 0 && d.sy === 0).length;
    const last = detected[0];
    check(`F1 ${w}x${h}: ${draws.length} draw call(s), aspect kept, never enlarged, detector got ${last.w}x${last.h} (= ${diag.processedSize.w}x${diag.processedSize.h})`,
      aspectOK && noEnlarge && last.w === diag.processedSize.w && last.h === diag.processedSize.h && Math.max(last.w, last.h) <= 1024, JSON.stringify({ aspectOK, noEnlarge, last, draws }));
    // no single drawImage reduces by more than 2x (halving ladder), so fine detail is not aliased away
    check(`F1 ${w}x${h}: no single resampling step shrinks by more than 2x`, draws.every((d) => d.sw / d.dw <= 2.0001 || d.sh / d.dh <= 2.0001 ? Math.max(d.sw / d.dw, d.sh / d.dh) <= 2.0001 : false), JSON.stringify(draws.map((d) => [d.sw, d.dw])));
  }
  draws.length = 0; detected.length = 0;
  const small = { naturalWidth: 300, naturalHeight: 400, width: 300, height: 400 };
  await detectImage(small, 300, 400);
  check("F2 a small image goes to the detector untouched: no canvas, no copy, no enlargement", draws.length === 0 && detected.length === 1 && detected[0].w === 300 && detected[0].h === 400);

  // the detector itself failing must surface as a readable error
  global.window.faceapi.detectAllFaces = () => ({ withFaceLandmarks: () => ({ withFaceDescriptors: async () => { throw new Error("Based on the provided shape, tensor shape mismatch"); } }) });
  let msg = ""; try { await detectImage(small, 300, 400); } catch (e) { msg = e.message; }
  check("F3 an inference error is reported as 'Face detection failed: <cause>'", /^Face detection failed: Based on the provided shape/.test(msg), msg);
  delete global.window.faceapi;
  msg = ""; try { await detectImage(small, 300, 400); } catch (e) { msg = e.message; }
  check("F4 library missing -> still a 'Face detection failed' error, not a silent 'no face'", /^Face detection failed:/.test(msg), msg);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
