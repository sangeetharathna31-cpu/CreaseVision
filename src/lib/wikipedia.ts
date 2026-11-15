/* Wikipedia access, ported from the original app. Logic and parsing are unchanged. */
import { DIRKEY, loadDirectory, saveDirectory } from "./storage";

export const disp = (t: string) => t.replace(/\s*\(.*?\)\s*$/, "");

export interface WikiSummary {
  title: string;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  content_urls?: { desktop: { page: string } };
}

function wapi(params: Record<string, string>) {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  Object.entries({ format: "json", origin: "*", ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
async function wjson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Wikipedia error " + r.status);
  return r.json();
}
const isCricket = (s: WikiSummary) => /cricket/i.test((s.description || "") + " " + (s.extract || ""));

export async function wikiSummary(title: string): Promise<WikiSummary> {
  return wjson("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")));
}
export async function wikiSearch(q: string, n = 5): Promise<string[]> {
  const d = await wjson(wapi({ action: "query", list: "search", srsearch: q + " Indian cricketer", srlimit: String(n) }));
  return d.query.search.map((h: { title: string }) => h.title);
}
/* a summary that is really about a cricketer (falls back to a search for ambiguous names) */
export async function cricketSummary(title: string): Promise<WikiSummary | null> {
  try {
    const s = await wikiSummary(title);
    if (isCricket(s)) return s;
  } catch {
    /* fall through to search */
  }
  for (const t of await wikiSearch(disp(title), 3)) {
    try {
      const s = await wikiSummary(t);
      if (isCricket(s)) return s;
    } catch {
      /* next */
    }
  }
  return null;
}

/* ---------- infobox parsing ---------- */
function clean(v: string) {
  if (!v) return "";
  return v
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\{\{\s*birth date[^}]*\}\}/gi, (m) => {
      const n = m.match(/\d+/g) || [];
      return n.length >= 3 ? `${n[2]}-${n[1]}-${n[0]}` : "";
    })
    .replace(/\{\{\s*(?:nowrap|nobr|small|nowrap begin)\s*\|([^{}]*)\}\}/gi, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&ndash;/g, (m) => (m === "&ndash;" ? "–" : " "))
    .replace(/\s+/g, " ")
    .trim();
}
export function parseInfobox(wikitext: string): Record<string, string> | null {
  const start = wikitext.search(/\{\{\s*Infobox cricketer/i);
  if (start < 0) return null;
  const out: Record<string, string> = {};
  let depth = 0;
  let cur: string | null = null;
  let started = false;
  for (const line of wikitext.slice(start).split("\n")) {
    if (depth <= 0 && cur === null && !/Infobox cricketer/i.test(line) && !/^\s*\|/.test(line) && started) break;
    const m = line.match(/^\s*\|\s*([^=|]+?)\s*=\s*(.*)$/);
    if (m && depth <= 1) {
      cur = m[1]!.trim().toLowerCase();
      out[cur] = m[2]!;
      started = true;
    } else if (cur && !/^\s*\}\}\s*$/.test(line) && depth >= 1) out[cur] += " " + line;
    depth += (line.match(/\{\{/g) || []).length - (line.match(/\}\}/g) || []).length;
    if (depth <= 0 && started) break;
  }
  Object.keys(out).forEach((k) => (out[k] = clean(out[k]!)));
  return out;
}
export async function wikiInfobox(title: string) {
  const d = await wjson(wapi({ action: "parse", page: title, prop: "wikitext", section: "0", redirects: "1" }));
  return parseInfobox(d.parse.wikitext["*"]);
}
export interface ArticleSection {
  title: string;
  body: string;
}
export async function wikiArticle(title: string): Promise<ArticleSection[]> {
  const d = await wjson(
    wapi({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", titles: title, redirects: "1" }),
  );
  const page = Object.values(d.query.pages)[0] as { extract?: string };
  const parts = (page.extract || "").split(/\n={2,}\s*([^=\n]+?)\s*={2,}\s*\n/);
  const skip = /^(references|external links|notes|see also|further reading|sources|bibliography|citations|footnotes)$/i;
  const sections: ArticleSection[] = [{ title: "Introduction", body: parts[0]!.trim() }];
  for (let i = 1; i < parts.length; i += 2) if (!skip.test(parts[i]!)) sections.push({ title: parts[i]!, body: (parts[i + 1] || "").trim() });
  return sections.filter((s) => s.body);
}

/* ---------- directory of all Indian internationals (cached under DIRKEY) ---------- */
let directory: string[] = [];
export const getDirectoryCache = () => directory;
export async function ensureDirectory(): Promise<string[]> {
  if (directory.length) return directory;
  directory = loadDirectory();
  if (directory.length) return directory;
  const cats = ["India Test cricketers", "India One Day International cricketers", "India Twenty20 International cricketers"];
  const all = new Set<string>();
  for (const c of cats) {
    let cont: string | null = null;
    do {
      const p: Record<string, string> = { action: "query", list: "categorymembers", cmtitle: "Category:" + c, cmlimit: "500", cmtype: "page" };
      if (cont) p.cmcontinue = cont;
      const d = await wjson(wapi(p));
      d.query.categorymembers.forEach((m: { title: string }) => all.add(m.title));
      cont = d.continue && d.continue.cmcontinue;
    } while (cont);
  }
  directory = [...all].sort();
  saveDirectory(directory);
  return directory;
}
export function resetDirectory() {
  directory = [];
  try {
    localStorage.removeItem(DIRKEY);
  } catch {
    /* ignore */
  }
}

/* ---------- cached lookups used for portraits / roles in the UI ---------- */
const summaryCache = new Map<string, Promise<WikiSummary | null>>();
export function getSummary(title: string): Promise<WikiSummary | null> {
  let p = summaryCache.get(title);
  if (!p) {
    p = cricketSummary(title).catch(() => null);
    summaryCache.set(title, p);
    p.then((v) => v === null && summaryCache.delete(title)); // allow a retry later (e.g. when back online)
  }
  return p;
}
const roleCache = new Map<string, Promise<string>>();
export function getRole(title: string): Promise<string> {
  let p = roleCache.get(title);
  if (!p) {
    p = wikiInfobox(title)
      .then((i) => (i && (i.role || i.batting)) || "")
      .catch(() => "");
    roleCache.set(title, p);
  }
  return p;
}
