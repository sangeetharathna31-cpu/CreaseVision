import { useEffect, useState } from "react";
import { useApp, useGalleryStats } from "../state";
import { Icon } from "../components/Icon";
import { kb } from "../lib/format";
import { storageReport } from "../lib/storage";
import { ensureDirectory, getDirectoryCache, resetDirectory } from "../lib/wikipedia";

export function DataSources() {
  const app = useApp();
  const { players, samples } = useGalleryStats();
  const { build, models } = app;
  const [dirMsg, setDirMsg] = useState("");
  const [dirCount, setDirCount] = useState(getDirectoryCache().length);
  const [, rerender] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => rerender((n) => n + 1), 4000); // keep the storage sizes fresh while building
    return () => window.clearInterval(t);
  }, []);
  const pctDone = build.total ? Math.round((build.done * 100) / build.total) : 0;

  const reloadDir = async () => {
    resetDirectory();
    setDirMsg("Loading the list of Indian internationals from Wikipedia…");
    try {
      const d = await ensureDirectory();
      setDirCount(d.length);
      setDirMsg(`Loaded ${d.length} players.`);
    } catch (e) {
      setDirCount(0);
      setDirMsg("⚠ " + (e as Error).message + " (internet connection needed)");
    }
  };

  return (
    <>
      <section className="intro">
        <div>
          <h2>Data sources</h2>
          <p>Where CreaseVision gets its face models, reference photos and career records. Everything is stored in this browser.</p>
        </div>
      </section>

      <section className="two-col">
        <div className="panel pad">
          <h3 className="panel-title">Face-recognition models</h3>
          <div className="kv">
            <span>Status</span>
            <b className={models.state}>{models.state === "ready" ? "Ready" : models.state === "loading" ? "Loading…" : "Unavailable"}</b>
          </div>
          <div className="kv">
            <span>Library</span>
            <b>@vladmandic/face-api 1.7.12 (jsDelivr)</b>
          </div>
          <div className="kv">
            <span>Networks</span>
            <b>SSD MobileNet v1 · Face landmark 68 · Face recognition</b>
          </div>
          {models.state !== "ready" && <p className={`hint ${models.state === "error" ? "bad" : ""}`}>{models.message}</p>}
          <div className="row-actions">
            <button className="ghost" onClick={app.startModels} disabled={models.state === "loading"}>
              <Icon name="refresh" size={14} /> Reload models
            </button>
          </div>
        </div>

        <div className="panel pad">
          <h3 className="panel-title">Career records &amp; photos</h3>
          <div className="kv">
            <span>Source</span>
            <b>Wikipedia (live) – stats, stories, portraits</b>
          </div>
          <div className="kv">
            <span>Player directory cache</span>
            <b>{dirCount ? `${dirCount} players` : "Not loaded yet"}</b>
          </div>
          {dirMsg && <p className="hint">{dirMsg}</p>}
          <div className="row-actions">
            <button className="ghost" onClick={() => void reloadDir()}>
              <Icon name="refresh" size={14} /> Reload directory
            </button>
          </div>
        </div>
      </section>

      <section className="panel pad block">
        <div className="block-head">
          <div>
            <h3 className="panel-title">Face gallery builder</h3>
            <p className="hint">
              The app learns each player's face from their Wikipedia photo. {players} players and {samples} face samples are in the gallery.
            </p>
          </div>
        </div>
        <div className="row-actions">
          <button className="primary-btn" onClick={() => void app.buildPopular()} disabled={build.running}>
            Build gallery – popular players (~75)
          </button>
          <button className="ghost" onClick={() => void app.buildAll()} disabled={build.running}>
            Add ALL Indian Test/ODI/T20I players (long)
          </button>
          {build.running && (
            <button className="ghost danger" onClick={app.stopBuild}>
              <Icon name="stop" size={13} /> Stop
            </button>
          )}
        </div>
        <div className="progress-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pctDone}%` }} />
        </div>
        <div className="hint" data-testid="build-text">{build.text}</div>
      </section>

      <section className="panel pad block">
        <h3 className="panel-title">Gallery backup</h3>
        <p className="hint">Export the gallery to a JSON file, import one, or wipe it.</p>
        <div className="row-actions">
          <button className="ghost" onClick={app.exportGallery} disabled={!players}>
            <Icon name="download" size={14} /> Export
          </button>
          <label className="ghost file-label">
            <Icon name="upload" size={14} /> Import
            <input
              type="file"
              accept=".json,application/json"
              data-testid="import-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void app.importGallery(f);
                e.target.value = "";
              }}
              hidden
            />
          </label>
          <button
            className="ghost danger"
            disabled={!players}
            onClick={() => window.confirm("Delete the whole face gallery?") && app.clearGallery()}
          >
            <Icon name="trash" size={14} /> Clear all
          </button>
        </div>
      </section>

      <section className="panel pad block">
        <h3 className="panel-title">Browser storage</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Contents</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {storageReport().map((r) => (
              <tr key={r.key}>
                <td>
                  <code>{r.key}</code>
                </td>
                <td>{r.label}</td>
                <td>{r.size ? kb(r.size) : "empty"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
