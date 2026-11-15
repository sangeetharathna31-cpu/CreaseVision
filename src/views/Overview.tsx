import { useApp, useGalleryStats } from "../state";
import { Icon } from "../components/Icon";
import { ActivityList } from "../components/ActivityList";
import { pct } from "../lib/format";

export function Overview() {
  const app = useApp();
  const { players, samples } = useGalleryStats();
  const { history, models, build } = app;
  const verified = history.filter((h) => h.known).length;
  const rate = history.length ? `${Math.round((verified * 100) / history.length)}%` : "—";
  const avg = verified ? `${pct(history.filter((h) => h.known).reduce((s, h) => s + h.confidence, 0) / verified)}%` : "—";
  const stats: [string, string, string][] = [
    ["Players in gallery", String(players), players ? "Faces the scanner can recognise" : "Build the gallery in Data Sources"],
    ["Face samples", String(samples), "Reference descriptors stored locally"],
    ["Recognitions logged", String(history.length), `${verified} verified · ${history.length - verified} no match`],
    ["Verified rate", rate, verified ? `Average confidence ${avg}` : "Appears after your first scan"],
  ];
  return (
    <>
      <section className="intro">
        <div>
          <h2>Workspace overview</h2>
          <p>A live summary of your face gallery and recognition activity, read from this browser's storage.</p>
        </div>
        <div className="heading-actions">
          <button className="primary-btn" onClick={() => app.go("scanner")}>
            <Icon name="scan" size={15} /> Open scanner
          </button>
        </div>
      </section>

      <section className="stat-grid">
        {stats.map(([label, value, sub]) => (
          <div className="stat panel" key={label}>
            <span>{label.toUpperCase()}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </section>

      <section className="two-col">
        <div className="panel pad">
          <h3 className="panel-title">Recognition engine</h3>
          <div className="kv">
            <span>Face models</span>
            <b className={models.state}>{models.state === "ready" ? "Ready" : models.state === "loading" ? "Loading…" : "Unavailable"}</b>
          </div>
          <div className="kv">
            <span>Detector</span>
            <b>SSD MobileNet v1 · 68-point landmarks · 128-d descriptors</b>
          </div>
          <div className="kv">
            <span>Match thresholds</span>
            <b>
              distance ≤ {(app.limit / 100).toFixed(2)} · confidence ≥ {app.minConf}%
            </b>
          </div>
          <div className="kv">
            <span>Gallery builder</span>
            <b>{build.running ? `Running – ${build.done}/${build.total}` : build.text || "Idle"}</b>
          </div>
          <div className="row-actions">
            <button className="ghost" onClick={() => app.go("data")}>
              <Icon name="database" size={14} /> Manage data sources
            </button>
            <button className="ghost" onClick={() => app.go("library")}>
              <Icon name="users" size={14} /> Open player library
            </button>
          </div>
        </div>
        <div className="panel pad">
          <h3 className="panel-title">Getting started</h3>
          <ol className="steps">
            <li className={players ? "done" : ""}>Build the face gallery (Data Sources) or add your own photos (Player Library).</li>
            <li className={history.length ? "done" : ""}>Upload a photo or use the camera in the AI Scanner.</li>
            <li className={Object.keys(app.notes).length ? "done" : ""}>Open a player's career record and keep notes on them.</li>
          </ol>
        </div>
      </section>

      <section className="activity-section">
        <div className="section-heading">
          <div>
            <h2>Recent recognition activity</h2>
            <p>Latest results from this browser, newest first.</p>
          </div>
          <div className="heading-actions">
            <button onClick={app.refreshHistory}>
              <Icon name="refresh" size={15} /> Refresh
            </button>
            <button onClick={() => app.go("log")}>
              View all <Icon name="chevron" size={13} />
            </button>
          </div>
        </div>
        <ActivityList entries={history.slice(0, 6)} onOpen={app.openProfile} empty="No recognitions yet. Run a scan in the AI Scanner." />
      </section>
    </>
  );
}
