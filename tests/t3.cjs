/* Reliability suite: camera resource cleanup, camera error handling, duplicate enrollment, corrupt/blocked LocalStorage. */
const { chromium } = require("playwright");
const { setup, IMG } = require("./lib.cjs");
const fs = require("fs");
process.chdir(__dirname);
const URL = process.env.CV_URL || "http://localhost:8099/";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsJSON = async (page, k) => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), k)) || "null");
const nav = (page, label) => page.click(`.nav button:has-text("${label}")`);
const errors = [];
const mkpage = async (ctx) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("pageerror: " + e.message)); p.on("dialog", (d) => d.accept()); return p; };
const SEED = JSON.stringify({ "Seed Guy": { name: "Seed Guy", samples: [Array(128).fill(0.1)] } });
const online = (page) => page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));

(async () => {
  /* ---------- A. camera cleanup with Chromium's fake camera device ---------- */
  let browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
  await setup(ctx);
  await ctx.addInitScript((seed) => {
    if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("cricketGalleryV1", seed); }
    window.__streams = []; window.__gumDelay = 0;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { await new Promise((r) => setTimeout(r, window.__gumDelay)); const s = await orig(c); window.__streams.push(s); return s; };
  }, SEED);
  let page = await mkpage(ctx);
  const live = () => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);
  await page.goto(URL); await online(page);

  await page.click('button[aria-label="Use camera"]'); await page.waitForSelector(".camera-stage video");
  check("C1 camera start acquires exactly one live track", (await live()) === 1, String(await live()));
  await page.click('button[aria-label="Stop camera"]');
  check("C2 Stop camera ends the track (device released)", (await live()) === 0);
  await page.click('button[aria-label="Use camera"]'); await page.waitForSelector(".camera-stage video");
  await nav(page, "Overview");
  check("C3 leaving the scanner ends the track", (await live()) === 0);
  await nav(page, "AI Scanner");
  await page.click('button[aria-label="Use camera"]'); await page.waitForSelector(".camera-stage video");
  await page.waitForFunction(() => document.querySelector(".camera-stage video")?.videoWidth > 0);
  await page.click(".capture");
  await page.waitForSelector("[data-testid=face-box]");
  check("C4 capture ends the track", (await live()) === 0);
  await page.evaluate(() => (window.__gumDelay = 300));
  await page.dblclick('button[aria-label="Use camera"]'); // two permission requests in flight at once
  await page.waitForSelector(".camera-stage video"); await sleep(900);
  check("C5 rapid double-click: exactly one live track, the duplicate stream is released", (await live()) === 1, "live=" + (await live()) + " total=" + (await page.evaluate(() => window.__streams.length)));
  await page.click('button[aria-label="Stop camera"]');
  check("C5 and Stop releases it", (await live()) === 0);
  // race: permission prompt still open (simulated 1.2 s) while the user leaves the page
  await page.evaluate(() => (window.__gumDelay = 1200));
  await page.click('button[aria-label="Use camera"]');
  await nav(page, "Overview");
  await sleep(2000);
  check("C6 RACE: leaving while the permission prompt is open does not leak the camera", (await live()) === 0, "live=" + (await live()));
  await nav(page, "AI Scanner");
  check("C6 scanner is clean afterwards (camera off)", (await page.locator(".camera-stage video").count()) === 0);
  await page.evaluate(() => (window.__gumDelay = 0));

  /* ---------- B. duplicate enrollment ---------- */
  await nav(page, "Player Library");
  await page.fill("[data-testid=pname]", "Test Player");
  await page.setInputFiles("[data-testid=pphotos]", [`${IMG}/testplayer_0.png`, `${IMG}/testplayer_0.png`, `${IMG}/testplayer_1.png`]);
  await page.click("[data-testid=add-form] button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-testid=add-status]")?.textContent.includes("Added"));
  check("D1 same photo twice in one batch: 2 stored, 1 reported as already enrolled", (await page.textContent("[data-testid=add-status]")) === "✔ Added 2 photo(s) to Test Player, 1 skipped (already enrolled)", await page.textContent("[data-testid=add-status]"));
  await page.fill("[data-testid=pname]", "test player");
  await page.setInputFiles("[data-testid=pphotos]", [`${IMG}/testplayer_0.png`]);
  await page.click("[data-testid=add-form] button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-testid=add-status]")?.textContent.includes("test player"));
  const gal = await lsJSON(page, "cricketGalleryV1");
  check("D2 re-uploading an enrolled photo adds nothing (still 2 samples, single entry)", gal["Test Player"].samples.length === 2 && Object.keys(gal).filter((k) => /test player/i.test(k)).length === 1);
  await ctx.close(); await browser.close();

  /* ---------- C. camera denied / absent (no fake device, no permission) ---------- */
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: [] });
  await setup(ctx);
  await ctx.addInitScript((seed) => { localStorage.setItem("cricketGalleryV1", seed); }, SEED);
  page = await mkpage(ctx);
  await page.goto(URL); await online(page);
  await page.click('button[aria-label="Use camera"]');
  await page.waitForSelector(".scan-status.error", { timeout: 8000 });
  const msg = await page.textContent(".scan-status");
  check("E1 camera unavailable/denied -> clear message, no crash", /permission was denied|No camera was found|Camera not available/.test(msg), msg);
  console.log("     (browser reported: " + msg.slice(0, 90) + ")");
  check("E1 app still usable: camera off, upload still enabled", (await page.locator(".camera-stage video").count()) === 0 && !(await page.locator(".upload-btn").isDisabled()));
  await ctx.close();

  /* ---------- D. corrupt LocalStorage ---------- */
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx);
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("cricketGalleryV1", "{broken"); localStorage.setItem("cricketHistoryV1", "nope"); localStorage.setItem("cricketNotesV1", "[1,2]"); localStorage.setItem("cricketDirV1", "{}"); localStorage.setItem("cricketLimitV1", "9999"); localStorage.setItem("cricketThemeV1", "purple"); } });
  page = await mkpage(ctx);
  await page.goto(URL); await page.waitForSelector("[data-testid=app]");
  check("S1 corrupt LocalStorage values: app renders without crashing", true);
  check("S1 invalid theme/limit fall back to defaults (dark, 0.55)", (await page.getAttribute("[data-testid=app]", "class")) === "app dark" && (await page.textContent(".limit-bar b")) === "0.55");
  for (const r of ["Overview", "Player Library", "Recognition Log", "Data Sources", "AI Scanner"]) await nav(page, r);
  check("S1 every page opens with corrupt data", true);
  await ctx.close();

  /* ---------- E. storage blocked / full ---------- */
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx);
  await ctx.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("quota", "QuotaExceededError"); }; });
  page = await mkpage(ctx);
  await page.goto(URL); await online(page);
  await page.waitForSelector("[data-testid=build-banner]"); await page.waitForSelector("[data-testid=build-banner]", { state: "detached", timeout: 60000 });
  await page.click('button[aria-label="Notifications"]');
  check("S2 storage full/blocked: user is warned (bell) and the app keeps working in memory", (await page.textContent(".popover")).includes("storage is full or blocked") && (await page.textContent(".system-card")).includes("74 players"));
  await page.click(".topbar h1");
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli", null, { timeout: 8000 });
  check("S2 scanning still works with storage blocked", true);
  await ctx.close(); await browser.close();

  console.log("\nERRORS:", errors);
  fs.writeFileSync("results3.json", JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
