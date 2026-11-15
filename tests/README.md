Fast unit tests only (no browser, no build):  pnpm test:unit
Tests, run from the project root with:  pnpm test      (ONLY=t4.cjs pnpm test  runs a single file)
  unit.cjs  prediction rules (src/lib/predict.ts, match.ts) on exact synthetic distances - no browser, no test double
  unit-geometry.cjs  image scaling, coordinate mapping, crops, tiles, NMS (pure maths)
  unit-pipeline.cjs  real src/lib/pipeline.ts against a SIMULATED detector: sizes, tile fallback, crop refinement, errors, enrolment subject choice
  unit-face-env.cjs  real src/lib/face.ts canvas code with recording canvas / fake face-api: aspect ratio, no enlargement, halving steps, error text
  unit-reference.cjs  regression: gallery reference photos are fetched at Wikimedia-standard widths (src/lib/face.ts descriptorFromUrl) - real face.ts, face-api + Wikimedia TEST DOUBLES, no browser
  t1.cjs    scanner, thresholds, theme, camera, history       t2.cjs  library, data tools, records, log, failure paths
  t3.cjs    camera cleanup/errors, duplicates, corrupt + blocked LocalStorage
  t4.cjs    prediction outcomes: 74 known players, 11 unknown people, unclear, non-face, several faces, look-alike, threshold grid

First time only:  pnpm install   then   pnpm test:setup   (downloads Playwright's Chromium)

What they do and do NOT prove
- They drive the real built app in Chromium with Chromium's fake camera, mocked Wikipedia responses, and a deterministic
  face-api TEST DOUBLE (tests/faceapi-mock.js) that derives a descriptor from the image pixels.
- So they exercise the app's real matching / threshold / storage / history / UI code, but NOT the real neural networks.
  Real recognition with the real models must be checked by hand (see ../README.md, "Check real recognition by hand").
- Everything is Node-only and uses relative paths; nothing is tied to a machine or OS.
