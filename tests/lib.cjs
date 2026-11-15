const fs = require("fs");
const path = require("path");
const IMG = path.join(__dirname, "img");
const slugs = JSON.parse(fs.readFileSync(IMG + "/slugs.json"));
const NO_THUMB = new Set(["Munaf Patel", "Murali Vijay"]);
const EXTRA_DIR = [];
for (let i = 1; i <= 30; i++) EXTRA_DIR.push("Zed Testman " + i);
const ALL = Object.keys(slugs);
const WIKITEXT = (n) => `{{Infobox cricketer
| name = ${n}
| full_name = ${n} Fullname
| birth_date = {{birth date and age|1988|11|5|df=y}}
| birth_place = [[Delhi]], India
| role = [[Batter|Batsman]]
| batting = Right-handed
| internationalspan = 2008–present
| column1 = [[Test cricket|Test]]
| matches1 = 113
| runs1 = 8848
| bat avg1 = 49.15
| wickets1 = 12
| column2 = [[One Day International|ODI]]
| matches2 = 295
| runs2 = 13906
}}
'''${n}''' is an Indian cricketer.`;
const EXTRACT = (n) => `${n} is an Indian international cricketer.\n== Early life ==\nBorn and raised in India.\n== International career ==\nDebuted for India and played many matches.\n== References ==\nsome refs`;

async function setup(context, opts = {}) {
  const hits = { wiki: 0 };
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const h = url.hostname;
    if (h === "localhost" || h === "127.0.0.1") return route.continue();
    if (h === "cdn.jsdelivr.net" && url.pathname.endsWith("face-api.js")) {
      if (opts.noLibrary) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "faceapi-mock.js")) });
    }
    if (h === "upload.wikimedia.org") {
      const m = url.pathname.match(/px-([a-z0-9_]+)\.png$/);
      const f = m && `${IMG}/${url.pathname.includes("/640px-") ? "" : "thumb_"}${m[1]}.png`;
      if (f && fs.existsSync(f)) return route.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) });
      return route.fulfill({ status: 404, body: "" });
    }
    if (h === "en.wikipedia.org") {
      hits.wiki++;
      if (opts.offlineWiki) return route.abort();
      const cors = { "access-control-allow-origin": "*" };
      const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
        const title = decodeURIComponent(url.pathname.split("/").pop()).replace(/_/g, " ");
        const base = title.replace(/\s*\(.*?\)\s*$/, "");
        if (!ALL.includes(title) && !ALL.includes(base) && !EXTRA_DIR.includes(title)) return json({}, 404);
        const s = { title, description: "Indian cricketer", extract: `${base} is an Indian international cricketer.`, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/" + title.replace(/ /g, "_") } } };
        const slug = slugs[title] || slugs[base];
        if (slug && !NO_THUMB.has(base)) s.thumbnail = { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${slug}.png/330px-${slug}.png` };
        return json(s);
      }
      const p = url.searchParams, action = p.get("action");
      if (action === "query" && p.get("list") === "search") {
        const q = (p.get("srsearch") || "").replace(/ Indian cricketer$/, "").toLowerCase();
        return json({ query: { search: [...ALL, ...EXTRA_DIR].filter((n) => n.toLowerCase().includes(q)).slice(0, 6).map((title) => ({ title })) } });
      }
      if (action === "query" && p.get("list") === "categorymembers") {
        const all = [...ALL, ...EXTRA_DIR], cont = p.get("cmcontinue");
        const half = Math.floor(all.length / 2);
        return cont ? json({ query: { categorymembers: all.slice(half).map((title) => ({ title })) } })
                    : json({ query: { categorymembers: all.slice(0, half).map((title) => ({ title })) }, continue: { cmcontinue: "next" } });
      }
      if (action === "parse") return json({ parse: { wikitext: { "*": WIKITEXT(p.get("page")) } } });
      if (action === "query" && p.get("prop") === "extracts") return json({ query: { pages: { 1: { extract: EXTRACT(p.get("titles")) } } } });
      return json({}, 404);
    }
    return route.abort(); // fonts, unsplash, anything else
  });
  return hits;
}
module.exports = { setup, IMG, ALL, EXTRA_DIR, NO_THUMB };
