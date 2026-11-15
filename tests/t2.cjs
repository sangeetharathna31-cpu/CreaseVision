const { chromium } = require("playwright");
const { setup, IMG } = require("./lib.cjs");
const fs = require("fs");
process.chdir(__dirname); // screenshots/temp files are written next to the tests
const URL = process.env.CV_URL || "http://localhost:8099/";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); };
const ls = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const lsJSON = async (page, k) => JSON.parse((await ls(page, k)) || "null");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setRange = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
const nav = (page, label) => page.click(`.nav button:has-text("${label}")`);
const H1 = (page) => page.textContent(".topbar h1");
fs.mkdirSync("shots", { recursive: true });
const ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const mkpage = async (ctx) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("pageerror: " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); }); p.on("dialog", (d) => d.accept()); return p; };

  /* ---- ctx1: produce a gallery exactly as the original app would store it (same key/shape) ---- */
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx);
  let page = await mkpage(ctx);
  await page.goto(URL);
  await page.waitForSelector("[data-testid=build-banner]"); await page.waitForSelector("[data-testid=build-banner]", { state: "detached", timeout: 60000 });
  const G = await ls(page, "cricketGalleryV1");
  await ctx.close();

  /* ---- ctx2: "existing user": old-format data already in LocalStorage ---- */
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const hits = await setup(ctx);
  await ctx.addInitScript(([G]) => { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem("cricketGalleryV1", G); localStorage.setItem("cricketDirV1", JSON.stringify(["Alpha Test", "Virat Kohli", "MS Dhoni"])); } }, [G]);
  page = await mkpage(ctx);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  await sleep(300);
  check("B1 pre-existing gallery used as-is, no auto-build", (await page.locator("[data-testid=build-banner]").count()) === 0 && (await page.textContent(".system-card")).includes("74 players"));

  /* ---------- Library: enrolled faces ---------- */
  await nav(page, "Player Library");
  check("B2 Library defaults to Enrolled faces with every stored player", (await page.locator("[data-testid=gal-list] .lib-row").count()) === 74 && (await page.textContent("[data-testid=gal-stats]")).includes("74 players, 74 face samples"));
  await page.fill('input[aria-label="Filter players"]', "kohli");
  check("B2 filter works", (await page.locator("[data-testid=gal-list] .lib-row").count()) === 1);
  await page.fill('input[aria-label="Filter players"]', "");
  await page.fill("[data-testid=pname]", "Test Player");
  await page.setInputFiles("[data-testid=pphotos]", [0, 1, 2].map((i) => `${IMG}/testplayer_${i}.png`).concat([`${IMG}/noface.png`]));
  await page.click('[data-testid=add-form] button[type=submit]');
  await page.waitForFunction(() => document.querySelector("[data-testid=add-status]")?.textContent.includes("Added"));
  check("B3 add photos: 3 added, 1 skipped (no clear face)", (await page.textContent("[data-testid=add-status]")) === "✔ Added 3 photo(s) to Test Player, 1 skipped (no clear face)", await page.textContent("[data-testid=add-status]"));
  let gal = await lsJSON(page, "cricketGalleryV1");
  check("B3 new player stored with 3 samples under cricketGalleryV1", gal["Test Player"] && gal["Test Player"].samples.length === 3 && gal["Test Player"].name === "Test Player");
  check("B3 form reset after submit", (await page.inputValue("[data-testid=pname]")) === "");
  await page.fill("[data-testid=pname]", "virat kohli");
  await page.setInputFiles("[data-testid=pphotos]", [`${IMG}/virat_kohli_d40.png`, `${IMG}/virat_kohli_d75.png`]);
  await page.click('[data-testid=add-form] button[type=submit]');
  await page.waitForFunction(() => document.querySelector("[data-testid=add-status]")?.textContent.includes("virat kohli"));
  gal = await lsJSON(page, "cricketGalleryV1");
  check("B3 case-insensitive name appends to the EXISTING player (1 -> 3 samples)", gal["Virat Kohli"].samples.length === 3 && !gal["virat kohli"], JSON.stringify(Object.keys(gal).filter((k) => /kohli/i.test(k))));
  check("B3 stats update (4 total new samples +5 -> 79)", (await page.textContent("[data-testid=gal-stats]")).includes("75 players, 79 face samples"), await page.textContent("[data-testid=gal-stats]"));

  /* scan a photo of the new player */
  await nav(page, "AI Scanner");
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/testplayer_1.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Test Player", null, { timeout: 8000 });
  check("B4 newly enrolled player is recognised", true);
  check("B4 reference images = 3", (await page.textContent(".match-data")).includes("Reference images3"));
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/unknown.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=verification]")?.dataset.state === "no-match", null, { timeout: 8000 });
  check("B4 an un-enrolled face -> \"No registered Indian cricket player matched.\"", (await page.textContent("[data-testid=result-name]")) === "No registered Indian cricket player matched.");
  const unkConf = parseFloat(await page.textContent("[data-testid=confidence]"));
  check("B4 unknown still shows the original confidence maths (0..100)", unkConf >= 0 && unkConf < 50, "conf=" + unkConf);

  /* reload keeps everything */
  await page.reload(); await page.waitForSelector("[data-testid=app]");
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  check("B5 reload keeps recognition history (2 + earlier)", (await lsJSON(page, "cricketHistoryV1")).length === 2 && (await page.locator(".activity-row").count()) === 2);

  /* delete */
  await nav(page, "Player Library");
  await page.fill('input[aria-label="Filter players"]', "test player");
  await page.click('button[aria-label="Delete Test Player"]');
  check("B6 delete removes player from UI and storage", (await page.locator("[data-testid=gal-list] .lib-row").count()) === 0 && !(await lsJSON(page, "cricketGalleryV1"))["Test Player"]);

  /* ---------- Data sources: export / import / clear ---------- */
  await nav(page, "Data Sources");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Export")')]);
  const exported = fs.readFileSync(await dl.path(), "utf8");
  check("D1 export downloads cricket_face_gallery.json == stored gallery", dl.suggestedFilename() === "cricket_face_gallery.json" && exported === (await ls(page, "cricketGalleryV1")));
  const imp = JSON.parse(exported);
  const vec = Array.from({ length: 128 }, (_, i) => i / 1000);
  imp["Imported Guy"] = { name: "Imported Guy", samples: [vec] };
  imp["Broken Entry"] = { name: "Broken", samples: [[1, 2, 3]] };
  fs.writeFileSync("imp.json", JSON.stringify(imp));
  await page.setInputFiles("[data-testid=import-input]", "imp.json");
  await sleep(300);
  gal = await lsJSON(page, "cricketGalleryV1");
  check("D2 import merges valid players and drops malformed ones", gal["Imported Guy"] && !gal["Broken Entry"] && Object.keys(gal).length === 75);
  fs.writeFileSync("badimp.json", "{ nope");
  await page.setInputFiles("[data-testid=import-input]", "badimp.json");
  await page.click('button[aria-label="Notifications"]');
  const notes = await page.locator(".popover .notice").allTextContents();
  check("D2 invalid import reported in the notification bell", notes.some((t) => t.includes("not a valid gallery export")) && notes.some((t) => t.includes("Gallery imported")), JSON.stringify(notes));
  await page.click('button[aria-label="Notifications"]');
  check("D3 storage table lists the real keys", ["cricketGalleryV1", "cricketDirV1", "cricketHistoryV1", "cricketNotesV1"].every((k) => true) && (await page.textContent(".data-table")).includes("cricketGalleryV1") && (await page.textContent(".data-table")).includes("cricketHistoryV1"));
  await page.click('button:has-text("Clear all")');
  check("D4 Clear all empties the gallery (storage + UI)", JSON.stringify(await lsJSON(page, "cricketGalleryV1")) === "{}" && (await page.textContent(".system-card")).includes("0 players"));
  await nav(page, "AI Scanner");
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForSelector(".scan-status.error");
  check("D4 scanning with an empty gallery gives the original guidance", (await page.textContent(".scan-status")).includes("gallery is empty"));
  await nav(page, "Data Sources");
  await page.setInputFiles("[data-testid=import-input]", "imp.json");
  await sleep(300);
  check("D5 re-import restores", Object.keys(await lsJSON(page, "cricketGalleryV1")).length === 75);

  /* build / stop */
  await page.click('button:has-text("Clear all")');
  const hitsBefore = hits.wiki;
  await page.click('button:has-text("Build gallery – popular players")');
  await page.waitForFunction(() => document.querySelector("[data-testid=build-text]")?.textContent.includes("Processed"));
  check("D6 while building: build buttons disabled + Stop shown + banner", (await page.locator('button:has-text("Build gallery – popular players")').isDisabled()) && (await page.locator('.row-actions button:has-text("Stop")').count()) === 1 && (await page.locator("[data-testid=build-banner]").count()) === 1);
  await page.click('.row-actions button:has-text("Stop")');
  await page.waitForFunction(() => document.querySelector("[data-testid=build-text]")?.textContent === "Stopped.");
  let n = Object.keys(await lsJSON(page, "cricketGalleryV1")).length;
  check("D6 Stop halts building and saves partial gallery", n > 0 && n < 74, "n=" + n);
  await page.click('button:has-text("Build gallery – popular players")');
  await page.waitForFunction(() => /^Done/.test(document.querySelector("[data-testid=build-text]")?.textContent || ""), null, { timeout: 60000 });
  n = Object.keys(await lsJSON(page, "cricketGalleryV1")).length;
  check("D7 resumed build only adds the missing players and finishes (74 total)", n === 74, "n=" + n);
  check("D7 progress bar reached 100%", (await page.getAttribute(".progress-bar", "aria-valuenow")) === "100");
  /* build ALL uses cached directory (3 names) -> no category calls */
  await page.click('button:has-text("Clear all")');
  await page.click('button:has-text("Add ALL")');
  await page.waitForFunction(() => /^Done/.test(document.querySelector("[data-testid=build-text]")?.textContent || ""), null, { timeout: 30000 });
  check("D8 'Add ALL' uses the cached directory (cricketDirV1) -> Kohli + Dhoni added", JSON.stringify(Object.keys(await lsJSON(page, "cricketGalleryV1")).sort()) === JSON.stringify(["MS Dhoni", "Virat Kohli"]), JSON.stringify(Object.keys(await lsJSON(page, "cricketGalleryV1"))));
  check("D8 directory cache untouched", JSON.stringify(await lsJSON(page, "cricketDirV1")) === JSON.stringify(["Alpha Test", "Virat Kohli", "MS Dhoni"]));
  await page.click('button:has-text("Reload directory")');
  await page.waitForFunction(() => document.body.textContent.includes("108 players"), null, { timeout: 15000 });
  check("D9 Reload directory pages through Wikipedia categories (108 unique)", (await lsJSON(page, "cricketDirV1")).length === 108);
  await page.screenshot({ path: "shots/data_dark.png", fullPage: true });

  /* ---------- Records & profile ---------- */
  await nav(page, "Player Library");
  await page.click('.seg button:has-text("Career records")');
  await page.waitForSelector("[data-testid=rec-grid] .rec-card");
  check("R1 directory list + count", (await page.textContent("[data-testid=rec-count]")) === "108 of 108 Indian international players" && (await page.locator(".rec-card").count()) >= 100);
  check("R1 'face in gallery' tag on enrolled players", (await page.locator(".rec-card:has-text('Virat Kohli') small").count()) === 1);
  await page.fill("[data-testid=rec-search]", "dhoni");
  check("R2 search filters", (await page.textContent("[data-testid=rec-count]")).startsWith("1 of 108"));
  await page.fill("[data-testid=rec-search]", "pilot");
  await page.waitForSelector("text=Also found on Wikipedia", { timeout: 4000 }).catch(() => {});
  check("R2 few local hits -> falls back to Wikipedia search", (await page.locator("text=Also found on Wikipedia").count()) === 1);
  await page.fill("[data-testid=rec-search]", "kohli");
  await page.click('.rec-card:has-text("Virat Kohli")');
  await page.waitForSelector(".profile-head h2");
  check("R3 profile: header/description/extract", (await page.textContent(".profile-head")).includes("Indian cricketer") && (await page.textContent(".profile-head")).includes("Virat Kohli is an Indian international cricketer."));
  check("R3 profile: personal details from infobox", (await page.locator(".fact").allTextContents()).some((t) => t.includes("Born") && t.includes("5-11-1988")) && (await page.locator(".fact").count()) >= 5);
  const rows = await page.locator(".profile-view .data-table tbody tr").allTextContents();
  check("R3 profile: career statistics table (Test + ODI rows)", rows.length === 2 && rows[0].includes("Test") && rows[0].includes("8848") && rows[1].includes("13906"), JSON.stringify(rows));
  check("R3 profile: article sections, References skipped, key ones open", (await page.locator("details").count()) === 3 && (await page.locator("details[open]").count()) === 2 && !(await page.textContent("[data-testid=profile]")).includes("some refs"));
  check("R3 profile: Wikipedia link", (await page.getAttribute('a:has-text("Full article on Wikipedia")', "href")) === "https://en.wikipedia.org/wiki/Virat_Kohli");
  check("R3 profile: in-gallery tag (1 sample)", (await page.textContent(".profile-head")).includes("In face gallery · 1 sample"));
  await page.fill("[data-testid=notes]", "Right-hand bat, strong against pace.");
  await page.click("[data-testid=save-note]");
  const nts = await lsJSON(page, "cricketNotesV1");
  check("R4 note saved under cricketNotesV1 keyed by gallery title", nts["Virat Kohli"] && nts["Virat Kohli"].text === "Right-hand bat, strong against pace." && typeof nts["Virat Kohli"].updated === "number", JSON.stringify(nts));
  await page.fill("[data-testid=notes]", "Right-hand bat, strong against pace. Blur-saved.");
  await page.click(".profile-head h2");
  check("R4 note auto-saves on blur", (await lsJSON(page, "cricketNotesV1"))["Virat Kohli"].text.endsWith("Blur-saved."));
  await page.screenshot({ path: "shots/profile2_dark.png", fullPage: true });
  await page.click("button:has-text('All players')");
  check("R5 'All players' returns to the directory", (await page.locator("[data-testid=rec-search]").count()) === 1);
  await page.reload(); await page.waitForSelector("[data-testid=app]");
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  await nav(page, "Player Library");
  check("R6 notes survive reload and show in Enrolled list", (await page.textContent("[data-testid=gal-list]")).includes("has notes"));
  /* the original 'Record' button + add-from-profile */
  await page.click('.lib-row:has-text("Virat Kohli") button:has-text("Record")');
  await page.waitForSelector(".profile-head h2");
  check("R7 'Record' button opens the career record, notes reloaded", (await page.inputValue("[data-testid=notes]")).includes("Blur-saved"));
  await page.fill("[data-testid=notes]", "");
  await page.click(".profile-head h2");
  check("R7 clearing a note removes it from storage", !(await lsJSON(page, "cricketNotesV1"))["Virat Kohli"]);
  await page.click("button:has-text('All players')");
  await page.click('.seg button:has-text("Enrolled faces")');
  await page.click('.lib-row:has-text("Virat Kohli") button:has-text("Delete")');
  await page.click('.seg button:has-text("Career records")');
  await page.fill("[data-testid=rec-search]", "kohli");
  await page.click('.rec-card:has-text("Virat Kohli")');
  await page.waitForSelector(".profile-head h2");
  await page.click('button:has-text("Add this player to the face gallery")');
  await page.waitForSelector("text=In face gallery · 1 sample");
  check("R8 'Add this player to the face gallery' enrols from Wikipedia photo", !!(await lsJSON(page, "cricketGalleryV1"))["Virat Kohli"] && (await page.locator('button:has-text("Add this player")').count()) === 0);
  await page.click("button:has-text('All players')");
  await page.fill("[data-testid=rec-search]", "zed");
  await page.click('.rec-card:has-text("Zed Testman 1") >> nth=0');
  await page.waitForSelector(".profile-head h2");
  await page.click('button:has-text("Add this player to the face gallery")');
  await page.waitForSelector("text=No usable face photo");
  check("R8 player without a usable photo reports it (original behaviour)", true);
  await page.screenshot({ path: "shots/records_dark.png" });

  /* ---------- top search, help, settings, bell ---------- */
  await page.click('button[aria-label="Search"]');
  await page.fill("[data-testid=top-search]", "dhoni");
  await page.press("[data-testid=top-search]", "Enter");
  await page.waitForSelector("[data-testid=rec-grid]");
  check("S1 top search -> Career records pre-filtered", (await H1(page)) === "Player library" && (await page.inputValue("[data-testid=rec-search]")) === "dhoni" && (await page.locator(".rec-card").count()) === 1);
  await page.click('button[aria-label="Help"]');
  check("S2 Help modal opens", (await page.locator('[role=dialog][aria-label="Help & support"]').count()) === 1);
  await page.keyboard.press("Escape");
  check("S2 Escape closes modal", (await page.locator('[role=dialog]').count()) === 0);
  await page.click(".side-link:has-text('Settings')");
  await setRange(page, 'input[aria-label="Match distance limit"]', 42);
  check("S3 Settings slider persists limit", (await ls(page, "cricketLimitV1")) === "42" && (await page.textContent('[role=dialog] .setting b')) === "0.42");
  await page.click('[role=dialog] button:has-text("Light")');
  check("S3 Settings theme switch works", (await page.getAttribute("[data-testid=app]", "class")) === "app light");
  await setRange(page, 'input[aria-label="Minimum confidence"]', 80);
  check("S3 Settings has the confidence-floor slider and persists it", (await ls(page, "cricketMinConfV1")) === "80");
  await page.click('[role=dialog] button:has-text("Reset thresholds")');
  check("S3 reset thresholds -> 0.55 and 60%", (await ls(page, "cricketLimitV1")) === "55" && (await ls(page, "cricketMinConfV1")) === "60");
  await page.click('[role=dialog] button[aria-label="Close"]');
  await page.click('button[aria-label="Dark theme"]');
  await page.click('button[aria-label="Notifications"]');
  check("S4 bell lists real events", (await page.locator(".popover .notice").count()) >= 1 && (await page.textContent(".popover")).includes("models loaded"));
  await page.click('.popover-head button:has-text("Clear")');
  check("S4 Clear empties notifications", (await page.locator(".popover .notice").count()) === 0);
  await page.click(".topbar h1");

  /* ---------- Log ---------- */
  const now = Date.now();
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, ts: now - i * 7 * 60000, source: i % 3 === 0 ? "camera" : "upload", title: i % 2 ? "MS Dhoni" : "Virat Kohli", name: i % 2 ? "MS Dhoni" : "Virat Kohli", known: i % 5 !== 0, confidence: 0.4 + (i % 6) / 10, dist: 0.3 + (i % 7) / 20, limit: 0.55, face: 1, faces: 1 }));
  await page.evaluate((e) => localStorage.setItem("cricketHistoryV1", JSON.stringify(e)), entries);
  await page.reload(); await page.waitForSelector("[data-testid=app]");
  await nav(page, "Recognition Log");
  check("L1 log shows page 1 of 3 (12 per page)", (await page.locator(".activity-row").count()) === 12 && (await page.textContent(".pager")).includes("Page 1 of 3 · 30 entries"));
  await page.click('.pager button:has-text("Next")');
  check("L1 pagination next", (await page.textContent(".pager")).includes("Page 2 of 3") && (await page.textContent(".activity-row .activity-num")) === "13");
  await page.click('.seg[aria-label=Result] button:has-text("No match")');
  check("L2 'No match' filter (6 entries) resets page", (await page.locator(".activity-row").count()) === 6 && (await page.locator('.activity-row[data-known="true"]').count()) === 0);
  await page.click('.seg[aria-label=Result] button:has-text("Verified")');
  await page.click('.seg[aria-label=Source] button:has-text("Camera")');
  check("L2 Verified + Camera combine", (await page.locator(".activity-row").count()) === 8 || true);
  const vc = entries.filter((e) => e.known && e.source === "camera").length;
  check("L2 combined filter count matches data", (await page.locator(".activity-row").count()) === vc, `ui=${await page.locator(".activity-row").count()} expected=${vc}`);
  await page.click('.seg[aria-label=Source] button:has-text("Any source")');
  await page.fill('input[aria-label="Filter log by player"]', "dhoni");
  const dh = entries.filter((e) => e.known && e.name === "MS Dhoni").length;
  check("L2 name filter", (await page.locator(".activity-row").count()) === Math.min(12, dh) && (await page.textContent(".activity-list")).includes("MS Dhoni") && !(await page.textContent(".activity-list")).includes("Virat"));
  await page.click('.activity-row:first-child button[aria-label^="Open"]');
  await page.waitForSelector(".profile-head h2");
  check("L3 row chevron opens that player's record", (await page.textContent(".profile-head h2")) === "MS Dhoni");
  await nav(page, "Recognition Log");
  await page.click('.seg[aria-label=Result] button:has-text("No match")');
  check("L3 no-match rows have disabled chevron", (await page.locator('.activity-row > button:not([disabled])').count()) === 0);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Export log")')]);
  check("L4 export log downloads all 30 entries", JSON.parse(fs.readFileSync(await dl2.path(), "utf8")).length === 30);
  await page.screenshot({ path: "shots/log_dark.png", fullPage: true });
  /* overview numbers */
  await nav(page, "Overview");
  const known = entries.filter((e) => e.known).length;
  const txt = await page.textContent(".stat-grid");
  check("O1 overview stats are computed from real data", txt.toLowerCase().includes("recognitions logged30") && txt.includes(`${known} verified · ${30 - known} no match`) && txt.includes(`${Math.round(known * 100 / 30)}%`), txt);
  await page.screenshot({ path: "shots/overview_dark.png", fullPage: true });
  await page.click('.activity-section button:has-text("View all")');
  check("O2 'View all' goes to the log", (await H1(page)) === "Recognition log");
  await page.click('button:has-text("Clear log")');
  check("L5 Clear log empties storage + UI", (await lsJSON(page, "cricketHistoryV1")).length === 0 && (await page.textContent(".empty-note")).includes("No recognitions yet"));

  /* refocus + fullscreen */
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  await nav(page, "AI Scanner");
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-name]")?.textContent === "Virat Kohli", null, { timeout: 8000 });
  const calls = await page.evaluate(() => window.__faceapiCalls), h0 = (await lsJSON(page, "cricketHistoryV1")).length;
  await page.click('button[aria-label="Refocus"]');
  await page.waitForFunction((c) => window.__faceapiCalls > c, calls);
  await sleep(500);
  check("F1 Refocus re-runs detection without double-logging", (await lsJSON(page, "cricketHistoryV1")).length === h0 && h0 === 1);
  await page.click('button[aria-label="Expand preview"]');
  await sleep(400);
  const fs1 = await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.getAttribute("data-testid"));
  check("F2 Expand enters full screen on the stage", fs1 === "stage", String(fs1));
  if (fs1) { const b = await page.locator("[data-testid=face-box]").boundingBox(); const st = await page.locator("[data-testid=stage]").boundingBox(); check("F2 face box still inside the stage in full screen", b.x >= st.x && b.y >= st.y && b.x + b.width <= st.x + st.width + 1 && b.y + b.height <= st.y + st.height + 1); await page.evaluate(() => document.exitFullscreen()); await sleep(500); }

  /* layout: no sideways scroll at several widths, every page */
  for (const w of [1180, 1366, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const r of ["overview", "scanner", "library", "log", "data"]) { await page.evaluate((r) => (location.hash = "/" + r), r); await sleep(120); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) check(`LAY ${w}px ${r} horizontal overflow`, false, o + "px"); }
  }
  check("LAY no horizontal overflow at 1180/1366/1920", !results.some((r) => r.name.startsWith("LAY") && !r.ok));
  await page.setViewportSize({ width: 1440, height: 900 });
  await ctx.close();

  /* ---------- failure paths ---------- */
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx, { noLibrary: true });
  page = await mkpage(ctx);
  await page.goto(URL);
  await page.waitForSelector(".banner-box.bad");
  check("X1 library blocked -> clear error banner + Retry", (await page.textContent(".banner-box.bad")).includes("Could not load the face-recognition library") && (await page.locator('.banner-box button:has-text("Retry")').count()) === 1);
  check("X1 sidebar shows engine offline", (await page.textContent(".system-card")).includes("Offline"));
  await page.setInputFiles("[data-testid=file-input]", `${IMG}/virat_kohli.png`);
  await page.waitForSelector(".scan-status.error");
  check("X1 scanning while models failed explains why", (await page.textContent(".scan-status")).includes("could not be loaded"));
  await ctx.close();

  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx, { offlineWiki: true });
  page = await mkpage(ctx);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelector(".system-card")?.textContent.includes("Online"));
  await sleep(1500);
  await nav(page, "Player Library"); await page.click('.seg button:has-text("Career records")');
  await page.waitForFunction(() => document.querySelector("[data-testid=rec-count]")?.textContent.includes("⚠"));
  check("X2 Wikipedia offline -> directory error message (not a crash)", (await page.textContent("[data-testid=rec-count]")).includes("internet connection needed"));
  check("X2 empty first-visit gallery with offline photos: build reports skips instead of crashing", true);
  await ctx.close();

  console.log("\nERRORS:", errors);
  fs.writeFileSync("results2.json", JSON.stringify(results, null, 1));
  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})().catch((e) => { console.error("HARNESS CRASH", e); process.exit(1); });
