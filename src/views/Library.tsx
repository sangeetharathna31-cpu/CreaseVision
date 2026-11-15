import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useGalleryStats } from "../state";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";
import {
  cricketSummary,
  disp,
  ensureDirectory,
  getDirectoryCache,
  wikiArticle,
  wikiInfobox,
  wikiSearch,
  type ArticleSection,
  type WikiSummary,
} from "../lib/wikipedia";
import { fullTime, pct } from "../lib/format";

/* ---------------- enrolled faces (the original "Face Gallery" tab) ---------------- */
function Enrolled() {
  const app = useApp();
  const { gallery } = app;
  const { players, samples } = useGalleryStats();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = Object.keys(gallery)
    .filter((k) => gallery[k]!.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !files.length) return;
    setBusy(true);
    setStatus("Processing photos…");
    const msg = await app.addPhotos(name.trim(), files);
    setStatus(msg.startsWith("Models") ? msg : "✔ " + msg);
    setBusy(false);
    setName("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <form className="panel pad block" onSubmit={submit} data-testid="add-form">
        <h3 className="panel-title">Improve accuracy – add more photos of a player</h3>
        <p className="hint">Use clear photos with only that player's face. 3–10 photos per player work best.</p>
        <div className="form-row">
          <input
            type="text"
            list="gnames"
            placeholder="Player name (e.g. Virat Kohli)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Player name"
            data-testid="pname"
          />
          <datalist id="gnames">
            {Object.keys(gallery).map((k) => (
              <option key={k} value={gallery[k]!.name} />
            ))}
          </datalist>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            required
            aria-label="Photos"
            data-testid="pphotos"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <button type="submit" className="primary-btn" disabled={busy}>
            <Icon name="plus" size={14} /> Add photos
          </button>
        </div>
        {status && (
          <div className="hint" data-testid="add-status">
            {status}
          </div>
        )}
      </form>

      <section className="panel pad block">
        <div className="block-head">
          <div>
            <h3 className="panel-title">Enrolled players</h3>
            <p className="hint">
              <b data-testid="gal-stats">
                {players} players, {samples} face samples
              </b>{" "}
              in the gallery.
            </p>
          </div>
          <div className="search-field">
            <Icon name="search" size={15} />
            <input type="search" placeholder="Filter players…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter players" />
          </div>
        </div>
        {!players && <div className="empty-note">The gallery is empty. Build it in Data Sources, or add photos above.</div>}
        <div className="lib-list" data-testid="gal-list">
          {list.slice(0, 300).map((k) => (
            <div className="lib-row" key={k}>
              <Avatar title={k} name={gallery[k]!.name} />
              <div className="lib-name">
                <b>{gallery[k]!.name}</b>
                <span>
                  {gallery[k]!.samples.length} sample{gallery[k]!.samples.length === 1 ? "" : "s"}
                  {app.notes[k] ? " · has notes" : ""}
                </span>
              </div>
              <div className="lib-actions">
                <button className="ghost" onClick={() => app.openProfile(k)}>
                  Record
                </button>
                <button className="ghost danger" onClick={() => app.deletePlayer(k)} aria-label={`Delete ${gallery[k]!.name}`}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        {list.length > 300 && <p className="hint">Showing 300 of {list.length} – refine the filter to see others.</p>}
      </section>
    </>
  );
}

/* ---------------- career record (the original openProfile) ---------------- */
const FACTS: [string, string][] = [["full_name", "Full name"], ["fullname", "Full name"], ["birth_date", "Born"], ["birth_place", "Birthplace"], ["nickname", "Nickname"],
  ["height", "Height"], ["role", "Role"], ["batting", "Batting"], ["bowling", "Bowling"], ["internationalspan", "International span"],
  ["international_span", "International span"], ["testdebutdate", "Test debut"], ["odidebutdate", "ODI debut"], ["t20idebutdate", "T20I debut"]];
const STAT_COLS: [string, string][] = [["matches", "Matches"], ["runs", "Runs"], ["bat avg", "Bat avg"], ["100s/50s", "100s/50s"], ["top score", "Top score"],
  ["deliveries", "Balls bowled"], ["wickets", "Wickets"], ["bowl avg", "Bowl avg"], ["fivefor", "5 wkts"], ["tenfor", "10 wkts"],
  ["best bowling", "Best bowling"], ["catches/stumpings", "Ct/St"]];

function Notes({ title }: { title: string }) {
  const app = useApp();
  const saved = app.notes[title];
  const [text, setText] = useState(saved?.text ?? "");
  useEffect(() => setText(app.notes[title]?.text ?? ""), [title]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = text !== (saved?.text ?? "");
  return (
    <div className="panel pad block notes">
      <h3 className="panel-title">
        <Icon name="note" size={15} /> Your notes
      </h3>
      <textarea
        value={text}
        placeholder="Scouting notes, observations, reminders about this player…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => dirty && app.setNote(title, text)}
        aria-label="Player notes"
        data-testid="notes"
        rows={4}
      />
      <div className="row-actions">
        <button className="primary-btn" disabled={!dirty} onClick={() => app.setNote(title, text)} data-testid="save-note">
          Save note
        </button>
        <span className="hint">{saved ? `Saved ${fullTime(saved.updated)}` : "Notes are stored only in this browser."}</span>
      </div>
    </div>
  );
}

function Profile({ title }: { title: string }) {
  const app = useApp();
  const { gallery, history, models } = app;
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [sum, setSum] = useState<WikiSummary | null>(null);
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  const [article, setArticle] = useState<ArticleSection[]>([]);
  const [addMsg, setAddMsg] = useState("");

  useEffect(() => {
    let live = true;
    setState("loading");
    Promise.all([cricketSummary(title).catch(() => null), wikiInfobox(title).catch(() => null), wikiArticle(title).catch(() => [] as ArticleSection[])])
      .then(([s, i, a]) => {
        if (!live) return;
        setSum(s);
        setInfo(i);
        setArticle(a);
        setState("ok");
      })
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [title]);

  const name = (sum && sum.title) || disp(title);
  const apiPage = sum?.content_urls?.desktop.page;
  const page = apiPage && /^https:\/\/[a-z.]*wikipedia\.org\//.test(apiPage) ? apiPage : "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  const key = gallery[name] ? name : gallery[title] ? title : null;
  const mine = history.filter((h) => h.known && (h.title === title || h.title === name));
  const rows: string[][] = [];
  if (info) for (let n = 1; n <= 10 && info["column" + n]; n++) rows.push([info["column" + n]!, ...STAT_COLS.map(([k]) => info[k + n] || "–")]);
  const facts: [string, string][] = [];
  if (info) {
    const seen = new Set<string>();
    FACTS.forEach(([k, label]) => {
      if (info[k] && !seen.has(label)) {
        seen.add(label);
        facts.push([label, info[k]!]);
      }
    });
  }

  return (
    <div className="profile-view" data-testid="profile">
      <button className="ghost back" onClick={() => app.setProfile(null)}>
        <Icon name="back" size={14} /> All players
      </button>
      {state === "loading" && <p className="hint">Loading career record from Wikipedia…</p>}
      {state === "error" && <div className="banner-box bad">⚠ {err} (internet connection needed)</div>}
      {state === "ok" && (
        <>
          <div className="panel pad profile-head">
            {sum?.thumbnail ? <img src={sum.thumbnail.source} alt={name} /> : <div className="mono-lg big">{name[0]}</div>}
            <div className="profile-text">
              <h2>{disp(name)}</h2>
              {sum?.description && <div className="hint">{sum.description}</div>}
              {sum?.extract && <p>{sum.extract}</p>}
              <div className="row-actions">
                <a className="ghost link" href={page} target="_blank" rel="noopener noreferrer">
                  <Icon name="link" size={14} /> Full article on Wikipedia
                </a>
                {key ? (
                  <span className="tag">In face gallery · {gallery[key]!.samples.length} sample{gallery[key]!.samples.length === 1 ? "" : "s"}</span>
                ) : (
                  models.state === "ready" && (
                    <button
                      className="ghost"
                      disabled={!!addMsg}
                      onClick={async () => {
                        setAddMsg("Adding…");
                        try {
                          setAddMsg((await app.addFromWiki(title)) ? "✔ Added" : "No usable face photo");
                        } catch {
                          setAddMsg("Failed");
                        }
                      }}
                    >
                      <Icon name="plus" size={14} /> {addMsg || "Add this player to the face gallery"}
                    </button>
                  )
                )}
              </div>
              {mine.length > 0 && (
                <p className="hint">
                  Recognised {mine.length} time{mine.length === 1 ? "" : "s"} in this browser · last {pct(mine[0]!.confidence)}% confidence, {fullTime(mine[0]!.ts)}.
                </p>
              )}
            </div>
          </div>

          <Notes title={key ?? title} />

          {facts.length > 0 && (
            <>
              <h3 className="sub">Personal details</h3>
              <div className="facts">
                {facts.map(([l, v]) => (
                  <div className="fact" key={l}>
                    <span>{l}</span>
                    {v}
                  </div>
                ))}
              </div>
            </>
          )}
          {info &&
            (rows.length ? (
              <>
                <h3 className="sub">Career statistics (international and domestic)</h3>
                <div className="panel scroll-x">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {["Format", ...STAT_COLS.map((c) => c[1])].map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint">Source: Wikipedia infobox (as published; may lag the latest matches).</p>
              </>
            ) : (
              <p className="hint">No statistics table found on this player's Wikipedia page.</p>
            ))}
          {article.length > 0 && (
            <>
              <h3 className="sub">Career story, important matches &amp; records</h3>
              {article.map((s, i) => (
                <details key={s.title} open={(/career|international|world cup|record|achievement|highlight|test|odi|twenty20|t20/i.test(s.title) || i === 0) && i < 3}>
                  <summary>{s.title}</summary>
                  {s.body.split(/\n+/).map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                </details>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- directory of Indian internationals (the original "Player Records" tab) ---------------- */
function Records() {
  const app = useApp();
  const { gallery, recQuery: q, setRecQuery: setQ, profile } = app;
  const [dir, setDir] = useState<string[]>(getDirectoryCache());
  const [msg, setMsg] = useState("");
  const [web, setWeb] = useState<string[]>([]);

  useEffect(() => {
    if (profile || dir.length) return;
    let live = true;
    setMsg("Loading the list of Indian internationals from Wikipedia…");
    ensureDirectory()
      .then((d) => live && (setDir(d), setMsg("")))
      .catch((e: Error) => live && setMsg("⚠ " + e.message + " (internet connection needed)"));
    return () => {
      live = false;
    };
  }, [profile, dir.length]);

  const s = q.trim().toLowerCase();
  const hits = useMemo(() => dir.filter((t) => t.toLowerCase().includes(s)), [dir, s]);
  useEffect(() => {
    setWeb([]);
    if (s.length > 2 && hits.length < 4) {
      const t = window.setTimeout(() => wikiSearch(s, 6).then(setWeb).catch(() => {}), 400);
      return () => window.clearTimeout(t);
    }
  }, [s, hits.length]);

  if (profile) return <Profile title={profile} />;
  return (
    <>
      <div className="search-field wide">
        <Icon name="search" size={15} />
        <input
          type="search"
          autoFocus={!!q}
          placeholder="Search any Indian cricketer (e.g. Kohli, Bumrah, Dhoni, Kapil Dev)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search players"
          data-testid="rec-search"
        />
      </div>
      <p className="hint" data-testid="rec-count">
        {msg || (dir.length ? `${hits.length} of ${dir.length} Indian international players` : "")}
      </p>
      <div className="rec-grid" data-testid="rec-grid">
        {hits.slice(0, 400).map((t) => (
          <button key={t} className="rec-card" onClick={() => app.openProfile(t)}>
            <b>{disp(t)}</b>
            {gallery[t] && <small>face in gallery</small>}
          </button>
        ))}
      </div>
      {web.length > 0 && (
        <>
          <p className="hint">Also found on Wikipedia:</p>
          <div className="rec-grid">
            {web.map((t) => (
              <button key={t} className="rec-card" onClick={() => app.openProfile(t)}>
                <b>{t}</b>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="hint">Career statistics and career stories come live from Wikipedia (all Indian Test, ODI and T20I players).</p>
    </>
  );
}

export function Library() {
  const app = useApp();
  const { libTab, setLibTab } = app;
  return (
    <>
      <section className="intro">
        <div>
          <h2>Player library</h2>
          <p>Faces the scanner knows, and the career records behind every player.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Library sections">
          <button role="tab" aria-selected={libTab === "enrolled"} className={libTab === "enrolled" ? "selected" : ""} onClick={() => setLibTab("enrolled")}>
            Enrolled faces
          </button>
          <button
            role="tab"
            aria-selected={libTab === "records"}
            className={libTab === "records" ? "selected" : ""}
            onClick={() => {
              setLibTab("records");
              app.setProfile(null);
            }}
          >
            Career records
          </button>
        </div>
      </section>
      {libTab === "enrolled" ? <Enrolled /> : <Records />}
    </>
  );
}
