import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state";
import { Icon } from "../components/Icon";
import { ActivityList } from "../components/ActivityList";

const PAGE = 12;
type F<T> = [T, string][];

function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: F<T>; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} className={v === value ? "selected" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Log() {
  const app = useApp();
  const { history } = app;
  const [result, setResult] = useState<"all" | "known" | "unknown">("all");
  const [source, setSource] = useState<"all" | "camera" | "upload">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return history.filter(
      (h) =>
        (result === "all" || (result === "known") === h.known) &&
        (source === "all" || h.source === source) &&
        (!s || h.name.toLowerCase().includes(s)),
    );
  }, [history, result, source, q]);
  useEffect(() => setPage(0), [result, source, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);

  const exportLog = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(history, null, 1)], { type: "application/json" }));
    a.download = "creasevision_recognition_log.json";
    a.click();
  };

  return (
    <>
      <section className="intro">
        <div>
          <h2>Recognition log</h2>
          <p>
            Every face the scanner has processed in this browser ({history.length} stored, up to 500 kept). Photos themselves are never stored.
          </p>
        </div>
        <div className="heading-actions">
          <button className="ghost" onClick={exportLog} disabled={!history.length}>
            <Icon name="download" size={14} /> Export log
          </button>
          <button
            className="ghost danger"
            disabled={!history.length}
            onClick={() => window.confirm("Delete the whole recognition log?") && app.clearHistory()}
          >
            <Icon name="trash" size={14} /> Clear log
          </button>
        </div>
      </section>

      <div className="filter-bar">
        <div className="search-field">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Filter by player name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter log by player" />
        </div>
        <Chips label="Result" value={result} onChange={setResult} options={[["all", "All"], ["known", "Verified"], ["unknown", "No match"]]} />
        <Chips label="Source" value={source} onChange={setSource} options={[["all", "Any source"], ["camera", "Camera"], ["upload", "Upload"]]} />
        <button className="ghost" onClick={app.refreshHistory}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      <ActivityList
        entries={rows.slice(cur * PAGE, cur * PAGE + PAGE)}
        start={cur * PAGE}
        onOpen={app.openProfile}
        empty={history.length ? "No log entries match these filters." : "No recognitions yet. Run a scan in the AI Scanner."}
      />
      {rows.length > PAGE && (
        <div className="pager">
          <button className="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            <Icon name="back" size={14} /> Previous
          </button>
          <span>
            Page {cur + 1} of {pages} · {rows.length} entries
          </span>
          <button className="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            Next <Icon name="chevron" size={14} />
          </button>
        </div>
      )}
    </>
  );
}
