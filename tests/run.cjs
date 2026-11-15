/* `pnpm test` entry point. Cross-platform (Windows/macOS/Linux): builds the app with Vite, serves dist/ with a tiny Node
 * static server on a free port, and runs the Playwright end-to-end suites against it.
 * SERVE_DIR=<folder> skips the build and serves that folder instead. */
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".map": "application/json", ".woff2": "font/woff2" };

function run(cmd, args, opts = {}) {
  // shell:true so `pnpm` (pnpm.cmd on Windows) resolves; arguments here are constants, never user input
  return spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
}

(async () => {
  let dist = process.env.SERVE_DIR;
  if (!dist) {
    console.log("> building the app (vite build)");
    const b = run("pnpm", ["build"], { cwd: ROOT });
    if (b.status !== 0) { console.error("Build failed - tests not run."); process.exit(1); }
    dist = path.join(ROOT, "dist");
  }
  if (!fs.existsSync(path.join(__dirname, "img", "slugs.json"))) run(process.execPath, [path.join(__dirname, "gen-fixtures.cjs")]);

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(dist, path.normalize(rel));
    if (!file.startsWith(path.resolve(dist))) { res.writeHead(403).end(); return; } // no path traversal
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`; // 127.0.0.1, not "localhost": avoids IPv6/IPv4 resolution issues (notably on Windows); still a secure context for the camera
  console.log(`> serving ${dist} at ${url}`);

  // async spawn: the static server lives in THIS process, so the event loop must stay free while the tests run
  const runAsync = (file) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: __dirname, stdio: "inherit", env: { ...process.env, CV_URL: url } });
      child.on("exit", (code) => resolve(code));
      child.on("error", () => resolve(1));
    });
  let failed = 0;
  for (const t of (process.env.ONLY ? process.env.ONLY.split(",") : ["unit.cjs", "unit-reference.cjs", "t1.cjs", "t2.cjs", "t3.cjs", "t4.cjs"])) {
    console.log(`\n> running ${t}`);
    if ((await runAsync(t)) !== 0) failed++;
  }
  server.close();
  process.exit(failed ? 1 : 0);
})();
