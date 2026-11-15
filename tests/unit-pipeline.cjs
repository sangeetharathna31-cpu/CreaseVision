/* Tests for src/lib/pipeline.ts – the real orchestration code (scaling, tile fallback, original-resolution crop, coordinate
 * mapping, error reporting) against a SIMULATED detector. The simulated detector knows where the faces really are
 * ("the world", in original pixels) and behaves like face-api's SSD in the one way that matters here: it squares and resizes
 * its input to 512px, so a face is only found when it is big enough IN THAT 512px INPUT (>= 20px) and its score grows with
 * that size. It proves the pipeline's logic and geometry; it does NOT prove how the real neural networks perform. */
const load = require("./load-src.cjs")();
const { analyseImage, pickSubject, PipelineError } = load("pipeline");
const { predict, DEFAULT_CONFIG } = load("predict");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const near = (a, b, e) => Math.abs(a - b) <= e;

const MIN_NET = 20;
const scoreOf = (net) => Math.min(0.99, 0.45 + net * 0.01);

function makeWorld(w, h, faces, opts = {}) {
  const calls = [];
  let n = 0;
  const root = { id: 0, region: { sx: 0, sy: 0, sw: w, sh: h }, w, h };
  const env = {
    calls,
    detectAll: async (surf) => {
      if (opts.engineError) throw new Error(opts.engineError);
      calls.push({ id: surf.id, w: surf.w, h: surf.h, region: surf.region });
      if (opts.cropThrows && surf.region.sw < w * 0.6 && surf.id > 0 && calls.length > 1 && surf.crop) throw new Error("crop failed");
      const k = surf.region.sw / surf.w; // original px per surface px
      const out = [];
      for (const f of faces) {
        const inside = f.x >= surf.region.sx && f.y >= surf.region.sy && f.x + f.w <= surf.region.sx + surf.region.sw && f.y + f.h <= surf.region.sy + surf.region.sh;
        if (!inside) continue;
        const bw = f.w / k, bh = f.h / k;
        const net = (bw * 512) / Math.max(surf.w, surf.h);
        if (net < MIN_NET) continue;
        let box = { x: (f.x - surf.region.sx) / k, y: (f.y - surf.region.sy) / k, width: bw, height: bh };
        if (surf.crop && opts.wrongFaceInCrop) box = { x: box.x + bw * 3, y: box.y, width: bw, height: bh };
        out.push({ box, score: scoreOf(net), descriptor: new Array(128).fill(surf.id) });
      }
      return out;
    },
    draw: (source, region, dw, dh) => {
      const s = { id: ++n, region, w: dw, h: dh, crop: region.sw < w * 0.6 && !(region.sx === 0 && region.sy === 0 && region.sw === w) && region.sw < 1000 };
      calls.push({ draw: true, w: dw, h: dh, region });
      return s;
    },
  };
  return { env, root, calls };
}
const run = (w, h, faces, opts) => { const W = makeWorld(w, h, faces, opts); return analyseImage(W.root, w, h, W.env, { minScore: 0.7 }).then((r) => ({ ...r, ...W })); };
const face = (x, y, s) => ({ x, y, w: s, h: Math.round(s * 1.15) });

(async () => {
  /* P1 large landscape: scaling + coordinates + original-resolution descriptor */
  let r = await run(4000, 3000, [face(1500, 1000, 400)]);
  check("P1 4000x3000: working canvas 1024x768, original size kept in the diagnostics", r.diag.processedSize.w === 1024 && r.diag.processedSize.h === 768 && r.diag.origSize.w === 4000 && r.diag.origSize.h === 3000, JSON.stringify(r.diag));
  const drawn = r.calls.find((c) => c.draw);
  check("P1 the working canvas is a proportional copy of the WHOLE photo (no crop, no stretch)", drawn.region.sx === 0 && drawn.region.sy === 0 && drawn.region.sw === 4000 && drawn.region.sh === 3000 && near(drawn.w / drawn.h, 4 / 3, 0.002), JSON.stringify(drawn));
  const f1 = r.faces[0];
  check("P1 one face; its origBox is reported in ORIGINAL pixels (~400px, not ~102px)", r.faces.length === 1 && near(f1.origBox.width, 400, 3) && near(f1.origBox.x, 1500, 3) && near(f1.origBox.y, 1000, 3), JSON.stringify(f1.origBox));
  check("P1 the overlay box is the origBox scaled to the working canvas", near(f1.box.x, f1.origBox.x * 0.256, 0.5) && near(f1.box.width, f1.origBox.width * 0.256, 0.5), JSON.stringify(f1.box));
  check("P1 single face in a reduced photo -> descriptor re-extracted from the ORIGINAL-resolution crop (marked refined)", f1.refined === true && f1.descriptor[0] === r.calls.filter((c) => !c.draw).pop().id && r.diag.passes.some((p) => /re-extracted/.test(p)));
  const crop = r.calls.filter((c) => c.draw).pop();
  check("P1 the crop is taken from the original pixels at native resolution (not enlarged, face + 50% margin each side)", crop.w === crop.region.sw && crop.region.sw === 800 || (crop.w <= 640 && near(crop.region.sw, 800, 4)), JSON.stringify(crop));

  /* P2 the old rejection: 220px face in a 4000px photo */
  r = await run(4000, 3000, [face(1800, 900, 220)]);
  const p2 = predict(r.faces, { A: { name: "A", samples: [new Array(128).fill(r.faces[0].descriptor[0])] } }, DEFAULT_CONFIG);
  check("P2 220px face in a 4000x3000 photo: canvas box is ~56px but the face is judged at its real ~220px -> not rejected as small", r.faces.length === 1 && near(r.faces[0].box.width, 56, 2) && near(r.faces[0].origBox.width, 220, 3) && p2.kind !== "unclear", `${r.faces[0].box.width} / ${r.faces[0].origBox.width} / ${p2.kind}`);

  /* P3 small face in a big photo: tiles find it, merged once */
  r = await run(4000, 3000, [face(1900, 1300, 150)]);
  check("P3 150px face in 4000x3000 is invisible in the 512px detector input of pass 1 (first pass found 0)", r.diag.firstPassFaces === 0);
  check("P3 the tile scan of the ORIGINAL pixels finds it, once (overlapping tiles are merged)", r.faces.length === 1 && r.diag.tiles > 1 && r.diag.passes.some((p) => /tiles/.test(p)), `faces ${r.faces.length}, tiles ${r.diag.tiles}`);
  check("P3 tile coordinates are mapped back to the original photo", near(r.faces[0].origBox.x, 1900, 4) && near(r.faces[0].origBox.y, 1300, 4) && near(r.faces[0].origBox.width, 150, 4), JSON.stringify(r.faces[0].origBox));
  check("P3 the result is accepted by the prediction rules (score >= 0.7, size >= 32)", r.faces[0].score >= 0.7 && Math.min(r.faces[0].origBox.width, r.faces[0].origBox.height) >= DEFAULT_CONFIG.minFacePx);

  /* P4 low first-pass score is retried at native resolution; the better score wins */
  r = await run(4000, 3000, [face(1600, 1100, 190)]);
  check("P4 first pass sees the face but only at ~69% (below the 70% gate)", r.diag.firstPassFaces === 1);
  check("P4 native-resolution tiles raise the score above the gate; still exactly one face", r.faces.length === 1 && r.faces[0].score >= 0.7 && r.diag.tiles > 1, `score ${r.faces[0].score}`);

  /* P5 not reduced -> nothing to gain from tiling or cropping */
  r = await run(800, 600, [face(300, 200, 30)]);
  check("P5 800x600 photo with a 30px face: not resized, no tiles, no crop, no wasted passes, honestly reports no face", r.faces.length === 0 && r.diag.scale === 1 && r.diag.tiles === 0 && r.calls.every((c) => !c.draw) && r.calls.length === 1, JSON.stringify(r.diag));
  r = await run(640, 480, [face(200, 100, 200)]);
  check("P5 640x480 photo is passed to the detector untouched (no copy, no enlargement)", r.diag.processedSize.w === 640 && r.diag.processedSize.h === 480 && r.calls.every((c) => !c.draw) && r.faces.length === 1 && !r.faces[0].refined);
  r = await run(300, 400, [face(80, 60, 150)]);
  check("P5 small 300x400 portrait: not enlarged, face found at its real size", r.diag.scale === 1 && r.diag.processedSize.w === 300 && near(r.faces[0].origBox.width, 150, 0.01));

  /* P6 portrait, panorama */
  r = await run(3000, 4000, [face(2300, 3300, 450)]);
  check("P6 3000x4000 portrait: 768x1024 working canvas, face near the bottom-right edge maps inside the photo", r.diag.processedSize.w === 768 && r.diag.processedSize.h === 1024 && r.faces.length === 1 && r.faces[0].origBox.x + r.faces[0].origBox.width <= 3000.5 && r.faces[0].origBox.y + r.faces[0].origBox.height <= 4000.5, JSON.stringify(r.faces[0] && r.faces[0].origBox));
  r = await run(8000, 1000, [face(5000, 300, 200)]);
  check("P6 8000x1000 panorama: working canvas 1024x128 (old code: only width<=1100 mattered)", r.diag.processedSize.w === 1024 && r.diag.processedSize.h === 128, JSON.stringify(r.diag.processedSize));
  check("P6 ... and the 200px face is still found via the tile scan", r.faces.length === 1 && near(r.faces[0].origBox.x, 5000, 5), `faces ${r.faces.length}`);

  /* P7 several faces */
  r = await run(4000, 3000, [face(800, 900, 420), face(2400, 900, 400)]);
  check("P7 two faces -> both reported (largest first), no crop pass, no descriptor refinement", r.faces.length === 2 && area(r.faces[0]) >= area(r.faces[1]) && r.faces.every((f) => !f.refined) && r.calls.filter((c) => c.draw).length === 1);
  function area(f) { return f.origBox.width * f.origBox.height; }
  check("P7 prediction on two faces = multiple (nobody identified)", predict(r.faces, { A: { name: "A", samples: [new Array(128).fill(0)] } }, DEFAULT_CONFIG).kind === "multiple");

  /* P8 crop pass safety */
  r = await run(4000, 3000, [face(1500, 1000, 400)], { wrongFaceInCrop: true });
  check("P8 if the crop pass finds a DIFFERENT face (IoU too low) the first descriptor is kept", r.faces.length === 1 && r.faces[0].refined === false && r.diag.passes.some((p) => /kept the first descriptor/.test(p)));
  r = await run(4000, 3000, [face(1500, 1000, 400)], { cropThrows: true });
  check("P8 if the crop pass throws, the scan still succeeds with the first descriptor", r.faces.length === 1 && r.faces[0].refined === false, JSON.stringify(r.diag.passes));

  /* P9 errors carry the real reason; any positive image dimensions reach the detector */
  const W0 = makeWorld(20, 20, []);
  const tiny = await analyseImage(W0.root, 20, 20, W0.env, { minScore: 0.7 });
  check("P9 a 20x20 image reaches the detector instead of failing an image-size gate", tiny.faces.length === 0 && W0.calls.some((c) => c.id === W0.root.id));
  let e = null; try { await analyseImage(W0.root, 0, 100, W0.env, { minScore: 0.7 }); } catch (x) { e = x; }
  check("P9 a 0px image is rejected as empty", e instanceof PipelineError && e.code === "empty");
  e = null; try { const W = makeWorld(800, 600, [], { engineError: "model not loaded" }); await analyseImage(W.root, 800, 600, W.env, { minScore: 0.7 }); } catch (x) { e = x; }
  check("P9 a detector/model failure is reported with its cause (not as 'no face')", e instanceof PipelineError && e.code === "engine" && /Face detection failed: model not loaded/.test(e.message), e && e.message);

  /* P10 enrolment: choose the subject, never the wrong person */
  const mk = (w, h, s) => ({ origBox: { x: 0, y: 0, width: w, height: h }, score: s, box: {}, descriptor: [], via: "full", refined: false });
  check("P10 reference photo with one face -> that face", pickSubject([mk(200, 230, 0.9)]).face !== null);
  check("P10 team photo with similar-sized faces -> no subject (old detectSingleFace took the highest SCORE, often a bystander)", pickSubject([mk(200, 230, 0.99), mk(190, 215, 0.97)]).face === null);
  const dom = pickSubject([mk(300, 345, 0.8), mk(90, 100, 0.99)]);
  check("P10 a clearly dominant face wins even if a small background face scores higher", dom.face && dom.face.origBox.width === 300);
  check("P10 no face -> no subject", pickSubject([]).face === null);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
