import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppProvider, ROUTES, useApp, useGalleryStats, type Route } from "./state";
import { Icon, type IconName } from "./components/Icon";
import { LIMIT_MAX, LIMIT_MIN, MINCONF_MAX, MINCONF_MIN } from "./lib/storage";
import { timeAgo } from "./lib/format";
import { Overview } from "./views/Overview";
import { Scanner } from "./views/Scanner";
import { Library } from "./views/Library";
import { Log } from "./views/Log";
import { DataSources } from "./views/DataSources";

const NAV: Record<Route, [string, IconName]> = {
  overview: ["Overview", "grid"],
  scanner: ["AI Scanner", "scan"],
  library: ["Player Library", "users"],
  log: ["Recognition Log", "activity"],
  data: ["Data Sources", "database"],
};
const TITLES: Record<Route, string> = {
  overview: "Workspace overview",
  scanner: "Player recognition",
  library: "Player library",
  log: "Recognition log",
  data: "Data sources",
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Sidebar({ openHelp, openSettings }: { openHelp: () => void; openSettings: () => void }) {
  const app = useApp();
  const { players } = useGalleryStats();
  const m = app.models.state;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>CREASEVISION</strong>
          <small>PLAYER INTELLIGENCE</small>
        </div>
      </div>

      <nav className="nav">
        <p>WORKSPACE</p>
        {ROUTES.map((r) => (
          <button key={r} className={app.route === r ? "active" : ""} onClick={() => app.go(r)} aria-current={app.route === r ? "page" : undefined}>
            <Icon name={NAV[r][1]} size={18} />
            <span>{NAV[r][0]}</span>
            {r === "scanner" && app.cameraOn && <i>LIVE</i>}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="system-card">
          <div className="system-heading">
            <span className={`live-dot ${m}`} /> {m === "ready" ? "System operational" : m === "loading" ? "Starting up…" : "Engine offline"}
          </div>
          <div className="system-row">
            <span>Recognition engine</span>
            <b className={m}>{m === "ready" ? "Online" : m === "loading" ? "Loading" : "Offline"}</b>
          </div>
          <div className="system-row">
            <span>Model</span>
            <em>SSD MobileNet v1</em>
          </div>
          <div className="system-row">
            <span>Gallery</span>
            <em>{players} players</em>
          </div>
        </div>
        <button className="side-link" onClick={openHelp}>
          <Icon name="help" /> Help & support
        </button>
        <button className="side-link" onClick={openSettings}>
          <Icon name="settings" /> Settings
        </button>
        <div className="profile">
          <div className="avatar">CV</div>
          <div>
            <strong>Local workspace</strong>
            <span>Data stays in this browser</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ openHelp }: { openHelp: () => void }) {
  const app = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const unread = app.notices.some((n) => !n.read);

  useEffect(() => {
    if (!bell) return;
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [bell]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    app.setRecQuery(q.trim());
    app.setProfile(null);
    app.setLibTab("records");
    app.go("library");
    setSearchOpen(false);
    setQ("");
  };

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">
          INTELLIGENCE SUITE <span>/</span> {NAV[app.route][0].toUpperCase()}
        </p>
        <h1>{TITLES[app.route]}</h1>
      </div>
      <div className="top-actions">
        {searchOpen && (
          <form className="top-search" onSubmit={submit} role="search">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
              placeholder="Search any Indian cricketer…"
              aria-label="Search players"
              data-testid="top-search"
            />
          </form>
        )}
        <div className="mode-toggle" aria-label="Theme">
          <button className={!app.dark ? "selected" : ""} onClick={() => app.setDark(false)} title="Light theme" aria-label="Light theme" aria-pressed={!app.dark}>
            <Icon name="sun" size={16} />
          </button>
          <button className={app.dark ? "selected" : ""} onClick={() => app.setDark(true)} title="Dark theme" aria-label="Dark theme" aria-pressed={app.dark}>
            <Icon name="moon" size={16} />
          </button>
        </div>
        <button className="icon-button" aria-label="Search" title="Search players" onClick={() => setSearchOpen((v) => !v)}>
          <Icon name="search" />
        </button>
        <div className="bell-wrap" ref={bellRef}>
          <button
            className="icon-button notification"
            aria-label="Notifications"
            title="Notifications"
            onClick={() => {
              setBell((v) => !v);
              app.markNoticesRead();
            }}
          >
            <Icon name="bell" />
            {unread && <span />}
          </button>
          {bell && (
            <div className="popover panel" role="dialog" aria-label="Notifications">
              <div className="popover-head">
                <b>Notifications</b>
                {app.notices.length > 0 && <button onClick={app.clearNotices}>Clear</button>}
              </div>
              {app.notices.length ? (
                app.notices.map((n) => (
                  <div className={`notice ${n.kind}`} key={n.id}>
                    <span>{n.text}</span>
                    <small>{timeAgo(n.ts)}</small>
                  </div>
                ))
              ) : (
                <div className="empty-note small">Nothing new. Model, gallery and storage events appear here.</div>
              )}
            </div>
          )}
        </div>
        <button className="icon-button" aria-label="Help" title="Help" onClick={openHelp}>
          <Icon name="help" />
        </button>
      </div>
    </header>
  );
}

function StatusBanners() {
  const { models, build, startModels, stopBuild } = useApp();
  return (
    <>
      {models.state !== "ready" && (
        <div className={`banner-box ${models.state === "error" ? "bad" : ""}`} role="status">
          <span>{models.state === "loading" ? "⏳ " : "⚠ "}{models.message}</span>
          {models.state === "error" && (
            <button className="ghost" onClick={startModels}>
              Retry
            </button>
          )}
        </div>
      )}
      {build.running && (
        <div className="banner-box" role="status" data-testid="build-banner">
          <span>
            ⏳ Preparing the face gallery from Wikipedia photos… {build.done}/{build.total} (you can already try identifying)
          </span>
          <button className="ghost" onClick={stopBuild}>
            Stop
          </button>
        </div>
      )}
    </>
  );
}

function Shell() {
  const app = useApp();
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const view = {
    overview: <Overview />,
    scanner: <Scanner />,
    library: <Library />,
    log: <Log />,
    data: <DataSources />,
  }[app.route];

  return (
    <div className={app.dark ? "app dark" : "app light"} data-testid="app">
      <Sidebar openHelp={() => setHelp(true)} openSettings={() => setSettings(true)} />
      <main>
        <Topbar openHelp={() => setHelp(true)} />
        <div className="content">
          <StatusBanners />
          {view}
        </div>
      </main>

      {help && (
        <Modal title="Help & support" onClose={() => setHelp(false)}>
          <div className="modal-body">
            <p><b>AI Scanner</b> – upload or drop a photo, or start the camera and press the capture button. Every detected face is matched against the face gallery; click a face box or a candidate to inspect it.</p>
            <p><b>Prediction rules</b> – one clear face is compared with every registered player. It is a match only if the face distance is at or below the <b>distance limit</b> (0.30–0.80, default 0.55) AND the confidence reaches the <b>minimum confidence</b> (30–95%, default 60%) AND no other player is almost as close. Otherwise the app says "No registered Indian cricket player matched." – a database-based prediction (no registered match), never proof of who someone is or what they do. Photos with no face, several faces, or an unclear face are not identified.</p>
            <p><b>Player Library</b> – add more photos of a player to improve accuracy, browse every Indian international player, and keep notes on a player's career record.</p>
            <p><b>Data Sources</b> – build the face gallery from Wikipedia photos, export / import / clear it, and see what is stored in this browser.</p>
            <p>The face models and Wikipedia data need an internet connection. Your photos are analysed on this device and are never uploaded.</p>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal title="Settings" onClose={() => setSettings(false)}>
          <div className="modal-body">
            <label className="setting">
              <span>
                Match distance limit <b>{(app.limit / 100).toFixed(2)}</b>
              </span>
              <input type="range" min={LIMIT_MIN} max={LIMIT_MAX} value={app.limit} onChange={(e) => app.setLimit(+e.target.value)} aria-label="Match distance limit" />
              <small>A face is only a match if its distance to a registered player is at or below this. Lower = stricter. Default 0.55.</small>
            </label>
            <label className="setting">
              <span>
                Minimum confidence <b>{app.minConf}%</b>
              </span>
              <input type="range" min={MINCONF_MIN} max={MINCONF_MAX} value={app.minConf} onChange={(e) => app.setMinConf(+e.target.value)} aria-label="Minimum confidence" />
              <small>A match must also reach this confidence. Higher = stricter. Default 60%.</small>
            </label>
            <div className="setting">
              <span>Theme</span>
              <div className="seg">
                <button className={!app.dark ? "selected" : ""} onClick={() => app.setDark(false)}>
                  <Icon name="sun" size={14} /> Light
                </button>
                <button className={app.dark ? "selected" : ""} onClick={() => app.setDark(true)}>
                  <Icon name="moon" size={14} /> Dark
                </button>
              </div>
            </div>
            <div className="row-actions">
              <button
                className="ghost"
                onClick={() => {
                  app.setLimit(app.limitDefault);
                  app.setMinConf(app.minConfDefault);
                }}
              >
                Reset thresholds
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setSettings(false);
                  app.go("data");
                }}
              >
                <Icon name="database" size={14} /> Data sources
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
