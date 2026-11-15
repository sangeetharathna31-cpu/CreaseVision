/* Prediction suite: known cricketers, unknown people, unclear photos, non-face images, several faces, thresholds,
 * look-alikes, and the preserved camera / enrollment features - all through the real UI of the built app.
 * NOTE: face-api is replaced by a deterministic test double here (see tests/README.md). These tests prove the app's
 * decision logic, wording and wiring. They are NOT evidence of how well the real neural network recognises real faces. */
const { chromium } = require("playwright");
const { setup, IMG, ALL, NO_THUMB } = require("./lib.cjs");
const fs = require("fs");
const path = require("path");
process.chdir(__dirname);
const URL = process.env.CV_URL || "http://localhost:8099/";
const slugs = JSON.parse(fs.readFileSync(path.join(IMG, "slugs.json")));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsJSON = async (page, k) => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), k)) || "null");
const setRange = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
const errors = [];
const MSG = {
  notCricketer: "No registered Indian cricket player matched.",
  noFace: "No face detected. Please upload a clear face image.",
  multiple2: "2 faces detected. Please upload an image containing only one person.",
  ambiguous: "Could not identify this person with confidence – two registered players look similar. Please upload a clearer photo.",
};
const disp = (t) => t.replace(/\s*\(.*?\)\s*$/, "");
const EXTRA = new Set(["Test Player", "Sachin Pilot Fake"]);
const KNOWN = ALL.filter((n) => !EXTRA.has(n) && !NO_THUMB.has(disp(n)));

let logged = 0; // single-face predictions that must appear in the log
async function scan(page, file, { log = false } = {}) {
  if (await page.locator('button[aria-label="Clear result"]').count()) await page.click('button[aria-label="Clear result"]');
  await page.setInputFiles("[data-testid=file-input]", file);
  await page.waitForFunction(() => !["idle", "scanning"].includes(document.querySelector("[data-testid=verification]").dataset.state), null, { timeout: 15000 });
  if (log) logged++;
  return {
    state: await page.getAttribute("[data-testid=verification]", "data-state"),
    name: await page.textContent("[data-testid=result-name]"),
    note: (await page.locator("[data-testid=prediction-note]").count()) ? await page.textContent("[data-testid=prediction-note]") : "",
    conf: parseFloat(await page.textContent("[data-testid=confidence]")),
    dist: parseFloat(await page.textContent("[data-testid=distance]")),
  };
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
  await setup(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  await page.waitForSelector("[data-testid=build-banner]"); await page.waitForSelector("[data-testid=build-banner]", { state: "detached", timeout: 90000 });
  const galleryCount = Object.keys(await lsJSON(page, "cricketGalleryV1")).length;
  check(`P0 gallery ready (${galleryCount} registered players == ${KNOWN.length} expected)`, galleryCount === KNOWN.length, `${galleryCount} vs ${KNOWN.length}`);

  /* ---------- 1. known cricketers: correct name, profile image, confidence ---------- */
  const wrong = [];
  let imgShown = 0, confMin = 100;
  for (const [i, n] of KNOWN.entries()) {
    const r = await scan(page, `${IMG}/${slugs[n]}.png`, { log: true });
    if (r.state !== "match" || r.name !== disp(n)) wrong.push(`${n} -> ${r.state}/${r.name}`);
    confMin = Math.min(confMin, r.conf);
    if (i < 8 && r.state === "match") {
      const ok = await page.waitForSelector("[data-testid=profile-image]", { timeout: 4000 }).then(() => true).catch(() => false);
      if (ok && (await page.getAttribute("[data-testid=profile-image]", "src")).includes("upload.wikimedia.org")) imgShown++;
    }
  }
  console.log(`     known cricketers identified correctly: ${KNOWN.length - wrong.length}/${KNOWN.length}; lowest confidence shown: ${confMin}%`);
  check(`P1 all ${KNOWN.length} registered cricketers are identified as themselves`, wrong.length === 0, wrong.slice(0, 3).join("; "));
  check("P1 every one shows a confidence of at least 95%", confMin >= 95, String(confMin));
  check("P1 the profile image is shown for matches (first 8 checked)", imgShown === 8, String(imgShown));
  const one = await scan(page, `${IMG}/${slugs["MS Dhoni"]}.png`, { log: true });
  check("P1 name + confidence + header for a match", one.name === "MS Dhoni" && one.conf > 95 && (await page.textContent(".verification-head")).includes("IDENTITY VERIFIED") && one.note === "");
  check("P1 a match enables 'Open full player profile'", !(await page.locator(".view-profile").isDisabled()));

  /* ---------- 2. unknown people: database-based message, never a forced match ---------- */
  const unknownFiles = [...Array.from({ length: 10 }, (_, i) => `unknown_${i + 1}.png`), "unknown.png"];
  let rejected = 0, maxConf = 0;
  for (const f of unknownFiles) {
    const r = await scan(page, `${IMG}/${f}`, { log: true });
    const ok = r.state === "no-match" && r.name === MSG.notCricketer && /does not prove/.test(r.note) && /Database-based/.test(r.note) && (await page.locator("[data-testid=profile-image]").count()) === 0 && (await page.locator(".view-profile").isDisabled());
    if (ok) rejected++; else console.log("     unexpected:", f, r.state, r.name);
    maxConf = Math.max(maxConf, r.conf);
  }
  console.log(`     unknown people correctly NOT matched: ${rejected}/${unknownFiles.length}; highest confidence they reached: ${maxConf}%`);
  check(`P2 ${unknownFiles.length} unregistered people all get exactly "No registered Indian cricket player matched." + the not-proof disclaimer`, rejected === unknownFiles.length);
  check("P2 no profile image / no name is attached to an unmatched person", (await page.locator("[data-testid=profile-image]").count()) === 0 && (await page.textContent("[data-testid=result-name]")) === MSG.notCricketer);
  check("P2 unmatched header says NO MATCH IN DATABASE (a prediction about the database)", (await page.textContent(".verification-head")).includes("NO MATCH IN DATABASE"));
  check("P2 unmatched face box is amber and labelled NO MATCH", (await page.locator(".face-frame.is-unknown").count()) === 1 && (await page.textContent(".face-frame small")).startsWith("NO MATCH"));

  /* ---------- 3. thresholds: low confidence is never forced; both knobs are live and combine with AND ---------- */
  const k60 = await scan(page, `${IMG}/${slugs["Virat Kohli"]}_d60.png`, { log: true });
  console.log(`     same-person-different-photo fixture: distance ${k60.dist}, confidence ${k60.conf}% (default state: ${k60.state})`);
  let bad = [], combos = 0;
  for (const lim of [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]) for (const mc of [30, 45, 60, 75, 90, 95]) {
    await setRange(page, "#limit", lim); await setRange(page, "#minconf", mc);
    await page.waitForFunction(([l, m]) => document.querySelector("[data-testid=limit-value]").textContent === (l / 100).toFixed(2) && document.querySelector("[data-testid=minconf-value]").textContent === m + "%", [lim, mc]);
    const state = await page.getAttribute("[data-testid=verification]", "data-state");
    const expectMatch = k60.dist <= lim / 100 && k60.conf >= mc;
    const expected = expectMatch ? "match" : "no-match";
    combos++;
    if (state !== expected) bad.push(`limit ${lim} floor ${mc}: got ${state}, expected ${expected}`);
  }
  console.log(`     threshold grid checked through the UI: ${combos - bad.length}/${combos} combinations behave as distance<=limit AND confidence>=floor`);
  check("P3 distance limit x confidence floor grid (66 combinations) all follow the AND rule live, without re-uploading", bad.length === 0, bad.slice(0, 3).join("; "));
  await setRange(page, "#limit", 80); await setRange(page, "#minconf", 95);
  check("P3 a very strict confidence floor (95%) rejects a clearly different photo of the SAME person (never lowered to fit)", (await page.getAttribute("[data-testid=verification]", "data-state")) === "no-match");
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  check("P3 thresholds survive a reload (0.80 / 95%)", (await page.textContent("[data-testid=limit-value]")) === "0.80" && (await page.textContent("[data-testid=minconf-value]")) === "95%");
  await setRange(page, "#limit", 55); await setRange(page, "#minconf", 60);
  check("P3 defaults restored (0.55 / 60%)", (await page.evaluate(() => localStorage.getItem("cricketLimitV1"))) === "55" && (await page.evaluate(() => localStorage.getItem("cricketMinConfV1"))) === "60");

  /* ---------- 4. look-alike: refuse to guess ---------- */
  const blend = await scan(page, `${IMG}/blend_kohli_dhoni.png`, { log: true });
  check("P4 a face half-way between two registered players is INCONCLUSIVE, not a coin-flip match", blend.state === "ambiguous" && blend.name === MSG.ambiguous, JSON.stringify(blend));
  check("P4 inconclusive result names no one and explains why", /Virat Kohli/.test(blend.note) && /MS Dhoni/.test(blend.note) && (await page.locator(".view-profile").isDisabled()) && (await page.locator("[data-testid=profile-image]").count()) === 0);
  check("P4 inconclusive is logged as NOT a verified match", (await lsJSON(page, "cricketHistoryV1"))[0].known === false);

  /* ---------- 5. unclear photos: not identified, not logged ---------- */
  const h5 = (await lsJSON(page, "cricketHistoryV1")).length;
  const blurry = await scan(page, `${IMG}/blurry_face.png`);
  check("P5 a face the detector is unsure about -> unclear message (exact), nothing guessed", blurry.state === "unclear" && /not confident enough \(55% vs 70% needed\)/.test(blurry.name) && /Detector confidence 55%/.test(blurry.note) && !/too small or unclear/.test(blurry.name), JSON.stringify(blurry));
  check("P5 an unclear face shows no candidates and is not logged", (await page.locator("[data-testid=candidate]").count()) === 0 && (await lsJSON(page, "cricketHistoryV1")).length === h5);
  const tiny = await scan(page, `${IMG}/tiny_face.png`, { log: true });
  check("P5 a sharp ~36px face can match without relaxing either match threshold", tiny.state === "match" && tiny.name === "Virat Kohli", JSON.stringify(tiny));
  check("P5 the small-face match is logged only after passing the normal identity thresholds", (await lsJSON(page, "cricketHistoryV1")).length === h5 + 1);
  await setRange(page, "#limit", 80); await setRange(page, "#minconf", 30);
  await scan(page, `${IMG}/blurry_face.png`);
  check("P5 loosening identity thresholds never rescues a detector-unclear photo", (await page.getAttribute("[data-testid=verification]", "data-state")) === "unclear");
  await setRange(page, "#limit", 55); await setRange(page, "#minconf", 60);

  /* ---------- 6. non-face images ---------- */
  const nf = await scan(page, `${IMG}/noface.png`);
  const ls1 = await scan(page, `${IMG}/landscape.png`);
  check('P6 blank image -> "No face detected. Please upload a clear face image."', nf.state === "no-face" && nf.name === MSG.noFace, JSON.stringify(nf));
  check("P6 landscape-style picture -> same message", ls1.state === "no-face" && ls1.name === MSG.noFace);
  fs.writeFileSync("notanimage.png", "this is not an image");
  if (await page.locator('button[aria-label="Clear result"]').count()) await page.click('button[aria-label="Clear result"]');
  await page.setInputFiles("[data-testid=file-input]", "notanimage.png");
  await page.waitForFunction(() => document.querySelector("[data-testid=verification]").dataset.state === "error");
  check("P6 a file that is not an image is rejected with a clear error (no crash)", /Could not read ".*" as an image/.test(await page.textContent(".scan-status")));
  check("P6 no-face / non-image results are not logged and show no candidates", (await lsJSON(page, "cricketHistoryV1")).length === h5 + 1);

  /* ---------- 7. several faces ---------- */
  const multi = await scan(page, `${IMG}/two.png`);
  check("P7 several faces -> asked for a one-person image (exact text)", multi.state === "multiple" && multi.name === MSG.multiple2, JSON.stringify(multi));
  check("P7 nobody is identified from a group photo (no names, no candidates, nothing logged)", !(await page.textContent(".camera-stage")).includes("KOHLI") && (await page.locator("[data-testid=candidate]").count()) === 0 && (await lsJSON(page, "cricketHistoryV1")).length === h5 + 1);

  /* ---------- 8. preserved features: camera + enrollment ---------- */
  await page.click('button[aria-label="Clear result"]');
  await page.click('button[aria-label="Use camera"]');
  await page.waitForSelector(".camera-stage video");
  await page.waitForFunction(() => document.querySelector(".camera-stage video")?.videoWidth > 0);
  await page.click(".capture");
  await page.waitForFunction(() => !["idle", "scanning"].includes(document.querySelector("[data-testid=verification]").dataset.state), null, { timeout: 15000 });
  logged++;
  const cam = await page.getAttribute("[data-testid=verification]", "data-state");
  check("P8 camera capture runs the same prediction (a stranger in front of the camera -> not a registered player) and releases the camera", cam === "no-match" && (await page.locator(".camera-stage video").count()) === 0 && (await lsJSON(page, "cricketHistoryV1"))[0].source === "camera", cam);
  await page.click('.nav button:has-text("Player Library")');
  await page.fill("[data-testid=pname]", "Test Player");
  await page.setInputFiles("[data-testid=pphotos]", [0, 1, 2].map((i) => `${IMG}/testplayer_${i}.png`));
  await page.click("[data-testid=add-form] button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-testid=add-status]")?.textContent.includes("Added 3"));
  await page.click('.nav button:has-text("AI Scanner")');
  const tp = await scan(page, `${IMG}/testplayer_1.png`, { log: true });
  check("P8 a newly enrolled person is recognised (name + confidence)", tp.state === "match" && tp.name === "Test Player" && tp.conf > 90, JSON.stringify(tp));
  await page.click('.nav button:has-text("Player Library")');
  await page.fill('input[aria-label="Filter players"]', "test player");
  await page.click('button[aria-label="Delete Test Player"]');
  await page.click('.nav button:has-text("AI Scanner")');
  const tp2 = await scan(page, `${IMG}/testplayer_1.png`, { log: true });
  check('P8 after deleting the player the SAME photo is "No registered Indian cricket player matched." (the answer depends on the database)', tp2.state === "no-match" && tp2.name === MSG.notCricketer, JSON.stringify(tp2));

  /* ---------- 9. history integrity ---------- */
  const hist = await lsJSON(page, "cricketHistoryV1");
  check(`P9 exactly the single-face predictions were logged (${logged} expected)`, hist.length === logged, `log has ${hist.length}`);
  check("P9 no duplicate log ids", new Set(hist.map((h) => h.id)).size === hist.length);
  const knownLogged = hist.filter((h) => h.known).length;
  check("P9 verified entries == 74 cricketers + Dhoni recheck + Kohli (different and small photo, matched) + enrolled Test Player", knownLogged === KNOWN.length + 4, `${knownLogged}`);

  console.log("\nERRORS:", errors);
  fs.writeFileSync("results4.json", JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
