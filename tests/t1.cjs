const { chromium } = require("playwright");
const { setup, IMG } = require("./lib.cjs");
const fs = require("fs");
process.chdir(__dirname); // screenshots/temp files are written next to the tests
const URL = process.env.CV_URL || "http://localhost:8099/";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const ls = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const lsJSON = async (page, k) => JSON.parse((await ls(page, k)) || "null");
const nav = (page, label) => page.click(`.nav button:has-text("${label}")`);
const H1 = (page) => page.textContent(".topbar h1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setRange = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
fs.mkdirSync("shots", { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"], acceptDownloads: true });
  await setup(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());

  /* ---------- T1 startup, models, auto gallery build ---------- */
  await page.goto(URL);
  await page.waitForSelector("[data-testid=app]");
  check("T1 app renders dark by default", (await page.getAttribute("[data-testid=app]", "class")) === "app dark");
  check("T1 default route is AI Scanner (nav active)", (await page.textContent(".nav button.active")).includes("AI Scanner"));
  check("T1 models-loading banner shown first", await page.locator(".banner-box", { hasText: "Loading the face-recognition models" }).count() === 1);
  await page.waitForSelector(".banner-box:has-text('Loading the face-recognition models')", { state: "detached", timeout: 10000 });
  check("T1 sidebar shows engine Online", (await page.textContent(".system-card")).includes("Online"));
  await page.waitForSelector("[data-testid=build-banner]", { timeout: 5000 });
  check("T1 first-visit gallery auto-build starts (banner)", true);
  await page.waitForSelector("[data-testid=build-banner]", { state: "detached", timeout: 60000 });
  let gal = await lsJSON(page, "cricketGalleryV1");
  const keys = Object.keys(gal || {});
  check("T1 gallery saved under ORIGINAL key cricketGalleryV1", keys.length === 74, "players=" + keys.length);
  const k0 = gal["Virat Kohli"];
  check("T1 gallery shape {name, samples:[128 numbers]}", k0 && k0.name === "Virat Kohli" && k0.samples.length === 1 && k0.samples[0].length === 128 && typeof k0.samples[0][0] === "number", JSON.stringify(k0).slice(0, 80));
  check("T1 parenthesised title keyed by wiki title, name stripped", gal["Mukesh Kumar (cricketer)"] && gal["Mukesh Kumar (cricketer)"].name === "Mukesh Kumar");
  check("T1 sidebar gallery count real", (await page.textContent(".system-card")).includes("74 players"));
  await page.screenshot({ path: "shots/scanner_empty_dark.png" });

  /* ---------- T2 navigation ---------- */
  const navs = [["Overview", "Workspace overview", "#/overview"], ["Player Library", "Player library", "#/library"], ["Recognition Log", "Recognition log", "#/log"], ["Data Sources", "Data sources", "#/data"], ["AI Scanner", "Player recognition", "#/scanner"]];
  for (const [label, h1, hash] of navs) {
    await page.click(`.nav button:has-text("${label}")`);
    check(`T2 nav "${label}" -> heading + hash`, (await page.textContent(".topbar h1")) === h1 && (await page.evaluate(() => location.hash)) === hash);
  }
  await page.goBack();
  check("T2 browser Back follows hash route", (await page.textContent(".topbar h1")) === "Data sources");
  await page.click('.nav button:has-text("AI Scanner")');

  /* ---------- T3 theme ---------- */
  await page.click('button[aria-label="Light theme"]');
  check("T3 light theme class applied", (await page.getAttribute("[data-testid=app]", "class")) === "app light");
  check("T3 light theme persisted (cricketThemeV1)", (await ls(page, "cricketThemeV1")) === "light");
  await sleep(500);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".app")).backgroundColor);
  check("T3 light theme changes real colours", bg === "rgb(242, 239, 232)", bg);
  await page.screenshot({ path: "shots/scanner_empty_light.png" });
  await page.reload(); await page.waitForSelector("[data-testid=app]");
  check("T3 theme survives reload", (await page.getAttribute("[data-testid=app]", "class")) === "app light");
  await page.click('button[aria-label="Dark theme"]');
  check("T3 back to dark", (await page.getAttribute("[data-testid=app]", "class")) === "app dark");
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  check("T3 reload did NOT rebuild gallery (existing data kept)", Object.keys(await lsJSON(page, "cricketGalleryV1")).length === 74 && (await page.locator("[data-testid=build-banner]").count()) === 0);

  /* ---------- T4 upload + verification ---------- */
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli", null, { timeout: 8000 });
  const dist = parseFloat(await page.textContent("[data-testid=distance]"));
  const conf = parseFloat(await page.textContent("[data-testid=confidence]"));
  check("T4 upload -> Virat Kohli verified", true);
  check("T4 distance ~0 and confidence ~100% (original formula)", dist < 0.05 && conf > 95, `dist=${dist} conf=${conf}`);
  check("T4 header says IDENTITY VERIFIED", (await page.textContent(".verification-head")).includes("IDENTITY VERIFIED"));
  check("T4 reference images = samples.length (1)", (await page.textContent(".match-data")).includes("Reference images1"));
  check("T4 thresholds row shows 0.55 / 60%", (await page.textContent("[data-testid=thresholds]")).replace(/\s+/g, " ") === "≤ 0.55 · ≥ 60%", await page.textContent("[data-testid=thresholds]"));
  check("T4 one face box overlay drawn", (await page.locator("[data-testid=face-box]").count()) === 1);
  const box = await page.locator("[data-testid=face-box]").boundingBox(), stage = await page.locator("[data-testid=stage]").boundingBox();
  check("T4 face box lies inside the stage", box.x >= stage.x && box.y >= stage.y && box.x + box.width <= stage.x + stage.width + 1 && box.y + box.height <= stage.y + stage.height + 1, JSON.stringify({ box, stage }));
  check("T4 portrait loads from Wikipedia summary", await page.waitForSelector(".portrait img", { timeout: 4000 }).then(() => true).catch(() => false));
  check("T4 role from infobox shown", (await page.textContent(".player-identity")).toUpperCase().includes("BATSMAN"));
  let hist = await lsJSON(page, "cricketHistoryV1");
  check("T4 history entry stored", hist.length === 1 && hist[0].title === "Virat Kohli" && hist[0].known === true && hist[0].source === "upload" && Math.abs(hist[0].limit - 0.55) < 1e-9, JSON.stringify(hist));
  check("T4 Recent activity row is the real scan", (await page.textContent(".activity-list")).includes("Virat Kohli") && (await page.textContent(".activity-list")).includes("Uploaded image"));
  await page.screenshot({ path: "shots/scanner_result_dark.png" });

  /* ---------- T5 threshold ---------- */
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli_d75.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=verification]")?.dataset.state === "no-match", null, { timeout: 8000 });
  const nm75 = await page.textContent("[data-testid=result-name]");
  const d75 = parseFloat(await page.textContent("[data-testid=distance]"));
  check("T5 distance 0.66 > limit 0.55 -> \"No registered Indian cricket player matched.\"", nm75 === "No registered Indian cricket player matched." && d75 > 0.55 && d75 < 0.8, `${nm75} d=${d75}`);
  check("T5 no-match header + disclaimer (database-based, not proof) + open-profile disabled", (await page.textContent(".verification-head")).includes("NO MATCH IN DATABASE") && (await page.textContent("[data-testid=prediction-note]")).includes("does not prove") && (await page.locator(".view-profile").isDisabled()));
  check("T5 no-match face box uses amber class", (await page.locator(".face-frame.is-unknown").count()) === 1);
  hist = await lsJSON(page, "cricketHistoryV1");
  check("T5 no-match logged as known=false with the closest player", hist.length === 2 && hist[0].known === false && hist[0].title === "Virat Kohli");
  await setRange(page, "#limit", 80);
  await sleep(300);
  check("T5 raising ONLY the distance limit to 0.80 does not force the 34%-confidence match (confidence floor 60% still applies)", (await page.textContent("[data-testid=result-name]")) === "No registered Indian cricket player matched.");
  await setRange(page, "#minconf", 30);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli");
  check("T5 lowering the confidence floor to 30% as well -> verified (both thresholds are live)", true);
  check("T5 both thresholds persisted (cricketLimitV1=80, cricketMinConfV1=30)", (await ls(page, "cricketLimitV1")) === "80" && (await ls(page, "cricketMinConfV1")) === "30");
  await setRange(page, "#minconf", 60);
  await setRange(page, "#limit", 30);
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli_d40.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "No registered Indian cricket player matched.", null, { timeout: 8000 });
  check("T5 limit 0.30: distance 0.35 is rejected (stricter)", true);
  await setRange(page, "#limit", 55);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli");
  check("T5 limit 0.55: distance 0.35 accepted", true);
  check("T5 slider label shows 0.55", (await page.textContent(".limit-bar b")) === "0.55");

  /* ---------- T6 no face + errors ---------- */
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/noface.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=verification]")?.dataset.state === "no-face");
  check("T6 no-face message (exact)", (await page.textContent("[data-testid=result-name]")) === "No face detected. Please upload a clear face image.");
  const before = (await lsJSON(page, "cricketHistoryV1")).length;
  check("T6 no-face is not logged", before === 3, "history=" + before);
  const badFile = require("path").join(__dirname, "bad.png"); fs.writeFileSync(badFile, "not an image");
  await page.setInputFiles("[data-testid=file-input]", badFile);
  await page.waitForFunction(() => /Could not read ".*" as an image/.test(document.querySelector(".scan-status")?.textContent || ""));
  check("T6 unreadable image message", true);

  /* ---------- T7 several faces: ask for a one-person photo, identify nobody ---------- */
  const h7 = (await lsJSON(page, "cricketHistoryV1")).length;
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/two.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=verification]")?.dataset.state === "multiple", null, { timeout: 8000 });
  check("T7 two faces -> asked to upload a one-person image (exact text)", (await page.textContent("[data-testid=result-name]")) === "2 faces detected. Please upload an image containing only one person.");
  check("T7 both faces boxed but nobody is named", (await page.locator("[data-testid=face-box]").count()) === 2 && !(await page.textContent(".camera-stage")).includes("KOHLI") && (await page.locator("[data-testid=candidate]").count()) === 0);
  check("T7 several faces: no profile opens, nothing logged", (await page.locator(".view-profile").isDisabled()) && (await lsJSON(page, "cricketHistoryV1")).length === h7);

  /* ---------- T8 candidates ---------- */
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli", null, { timeout: 8000 });
  check("T8 top 3 candidates", (await page.locator("[data-testid=candidate]").count()) === 3);
  await page.click(".candidate-head button");
  check("T8 View all -> 10 candidates", (await page.locator("[data-testid=candidate]").count()) === 10);
  await page.locator("[data-testid=candidate]").nth(1).click();
  await page.waitForSelector(".profile-head h2");
  check("T8 clicking the 2nd candidate opens THAT player's career record (not Kohli)", (await H1(page)) === "Player library" && (await page.textContent(".profile-head h2")) !== "Virat Kohli", await page.textContent(".profile-head h2"));
  await nav(page, "AI Scanner");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli");
  await page.click(".view-profile");
  await page.waitForSelector("[data-testid=profile]");
  check("T8 Open full player profile -> Library > Career records profile", (await page.textContent(".topbar h1")) === "Player library" && (await page.textContent("[data-testid=profile]")).includes("Virat Kohli"));
  await page.waitForSelector(".profile-head h2");
  await page.screenshot({ path: "shots/profile_dark.png", fullPage: true });
  await page.click('.nav button:has-text("AI Scanner")');
  check("T8 scan result survives navigating away and back", (await page.textContent("[data-testid=result-name]")) === "Virat Kohli");
  await page.click('button[aria-label="Clear result"]');
  check("T8 clear result resets panel", (await page.textContent("[data-testid=result-name]")) === "—" && (await page.locator("[data-testid=face-box]").count()) === 0);

  /* ---------- T14 camera (Chromium fake device) ---------- */
  await page.click('button[aria-label="Use camera"]');
  await page.waitForSelector(".camera-stage video");
  await page.waitForFunction(() => { const v = document.querySelector(".camera-stage video"); return v && v.videoWidth > 0; }, null, { timeout: 8000 });
  check("T14 camera starts: live <video> in stage", true);
  check("T14 LIVE badge in sidebar + real resolution", (await page.textContent(".nav")).includes("LIVE") && /\d+×\d+/.test(await page.textContent(".quality")), await page.textContent(".quality"));
  check("T14 capture enabled while camera is on", !(await page.locator(".capture").isDisabled()));
  await page.screenshot({ path: "shots/camera_dark.png" });
  await page.click(".capture");
  await page.waitForFunction(() => document.querySelector("[data-testid=face-box]"), null, { timeout: 8000 });
  check("T14 capture stops camera and analyses the frame", (await page.locator(".camera-stage video").count()) === 0 && (await page.locator("[data-testid=face-box]").count()) === 1);
  const stopped = await page.evaluate(() => navigator.mediaDevices.enumerateDevices().then(() => true));
  hist = await lsJSON(page, "cricketHistoryV1");
  check("T14 history source = camera", hist[0].source === "camera");
  check("T14 LIVE badge gone after capture", !(await page.textContent(".nav")).includes("LIVE"));
  check("T14 capture disabled when camera off", await page.locator(".capture").isDisabled());
  await page.click('button[aria-label="Use camera"]'); await page.waitForSelector(".camera-stage video");
  await page.click('.nav button:has-text("Overview")');
  check("T14 leaving the scanner releases the camera (LIVE badge off)", !(await page.textContent(".nav")).includes("LIVE"));
  await page.click('.nav button:has-text("AI Scanner")');
  check("T14 camera is off when returning", (await page.locator(".camera-stage video").count()) === 0);

  /* ---------- drag & drop ---------- */
  const dt = await page.evaluateHandle(async (b64) => { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); const d = new DataTransfer(); d.items.add(new File([arr], "drop.png", { type: "image/png" })); return d; }, fs.readFileSync(`${IMG}/ms_dhoni.png`).toString("base64"));
  await page.dispatchEvent("[data-testid=stage]", "drop", { dataTransfer: dt });
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "MS Dhoni", null, { timeout: 8000 });
  check("DnD dropping a photo on the stage identifies it", true);

  console.log("\nERRORS:", errors);
  fs.writeFileSync("results1.json", JSON.stringify(results, null, 1));
  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
