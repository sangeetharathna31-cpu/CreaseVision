import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state";
import { confidence, galleryHealth } from "../lib/match";
import { MESSAGES, explain, makeConfig, predict, type Prediction } from "../lib/predict";
import { LIMIT_MAX, LIMIT_MIN, MINCONF_MAX, MINCONF_MIN } from "../lib/storage";
import { pct } from "../lib/format";
import { Icon } from "../components/Icon";
import { Avatar, useRole, useSummary } from "../components/Avatar";
import { ActivityList } from "../components/ActivityList";

const HERO =
  "https://images.unsplash.com/photo-1776229705264-6b437229654b?auto=format&fit=crop&w=1100&q=88";

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const quality = (s: number) => (s >= 0.9 ? "Excellent" : s >= 0.75 ? "Good" : "Fair");
const tier = (c: number) => (c >= 0.8 ? "High confidence match" : c >= 0.6 ? "Good confidence match" : "Acceptable confidence match");

export function Scanner() {
  const app = useApp();
  const { scan, gallery, gver, limit, minConf, history, cameraOn, setCameraOn } = app;
  const lim = limit / 100;

  /* ---------- camera (original getUserMedia flow) ---------- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camRes, setCamRes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCamRes("");
  };
  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("this browser or connection does not allow camera access (use https or localhost).");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!mounted.current) {
        // the user left the scanner while the permission prompt was open: release the camera immediately
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setElapsed(0);
      setCameraOn(true);
    } catch (e) {
      const name = (e as DOMException).name;
      app.setScanMessage(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access for this site in the browser's address bar (or Windows Settings > Privacy > Camera) and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : name === "NotReadableError"
              ? "The camera is in use by another application. Close it and try again."
              : "Camera not available: " + (e as Error).message,
      );
    }
  };
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOn]);
  useEffect(() => {
    if (!cameraOn) return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [cameraOn]);
  useEffect(() => () => stopCamera(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const w = v.videoWidth,
      h = v.videoHeight;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d")!.drawImage(v, 0, 0);
    const url = tmp.toDataURL("image/jpeg", 0.92);
    stopCamera();
    await app.analyse(tmp, w, h, "camera", url);
  };

  /* ---------- upload / drop ---------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const onFile = (f?: File) => {
    if (!f) return;
    if (cameraOn) stopCamera();
    void app.identifyFile(f);
  };

  /* ---------- overlay geometry (matches object-fit: cover; object-position: center 24%) ---------- */
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useSize(stageRef);
  const geo = useMemo(() => {
    if (!scan.size || !stage.w) return null;
    const s = Math.max(stage.w / scan.size.w, stage.h / scan.size.h);
    return { s, ox: (stage.w - scan.size.w * s) * 0.5, oy: (stage.h - scan.size.h * s) * 0.24 };
  }, [scan.size, stage]);

  /* ---------- the prediction: derived from the detected faces + current thresholds, so sliders re-evaluate live ---------- */
  const cfg = useMemo(() => makeConfig(limit, minConf), [limit, minConf]);
  const pred: Prediction | null = useMemo(
    () => (scan.status === "done" ? predict(scan.faces, gallery, cfg, 10) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan.status, scan.faces, gver, cfg],
  );
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [scan.faces]);

  const cand = pred?.kind === "match" ? pred.best : pred?.kind === "no-match" ? pred.closest : pred?.kind === "ambiguous" ? pred.best : null;
  const hasNumbers = cand !== null; // true exactly for match / no-match / ambiguous
  const candidates =
    pred && (pred.kind === "match" || pred.kind === "no-match" || pred.kind === "ambiguous") ? pred.candidates : [];
  const isMatch = pred?.kind === "match";
  const conf = cand ? confidence(cand.dist) : 0;
  const face = scan.faces[0];
  const health = useMemo(() => galleryHealth(gallery), [gallery, gver]); // eslint-disable-line react-hooks/exhaustive-deps
  const faceW = (f: (typeof scan.faces)[number]) => Math.round(f.origBox.width);
  const faceH = (f: (typeof scan.faces)[number]) => Math.round(f.origBox.height);
  const decision: Record<string, string> = {
    match: "MATCH",
    "no-match": "NO REGISTERED PLAYER MATCHED",
    ambiguous: "INCONCLUSIVE (two similar players)",
    unclear: "REJECTED – face unusable",
    multiple: "REJECTED – several faces",
    "no-face": "NO FACE FOUND",
    "empty-gallery": "NO USABLE GALLERY",
  };
  const summary = useSummary(isMatch ? cand!.title : null);
  const role = useRole(isMatch ? cand!.title : null);

  const expand = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const scanning = scan.status === "scanning";
  /* one place that decides every word shown for an outcome */
  const view = ((): { state: string; title: string; sub: string; headline: string; note: string } => {
    if (scanning) return { state: "scanning", title: "ANALYSING", sub: "Detecting faces…", headline: "—", note: "" };
    if (scan.status === "error") return { state: "error", title: "NO RESULT", sub: scan.message, headline: "—", note: "" };
    if (!pred) return { state: "idle", title: "AWAITING INPUT", sub: "Upload a photo or use the camera", headline: "—", note: "" };
    switch (pred.kind) {
      case "match":
        return { state: "match", title: "IDENTITY VERIFIED", sub: tier(pred.confidence), headline: pred.best.name, note: "" };
      case "no-match":
        return {
          state: "no-match",
          title: "NO MATCH IN DATABASE",
          sub: pred.why === "distance" ? "Face distance is above the limit" : "Confidence is below the minimum",
          headline: MESSAGES.noMatch,
          note: `${MESSAGES.disclaimer} Closest gallery entry: ${pred.closest.name} (distance ${pred.closest.dist.toFixed(3)} vs limit ${cfg.limit.toFixed(2)}; confidence ${pct(pred.confidence)}% vs minimum ${pct(cfg.minConfidence)}%).`,
        };
      case "ambiguous":
        return {
          state: "ambiguous",
          title: "INCONCLUSIVE",
          sub: "Two registered players look similar",
          headline: MESSAGES.ambiguous,
          note: `Closest: ${pred.best.name} (${pct(pred.confidence)}%) and ${pred.runnerUp.name} – too close to call, so no name is given.`,
        };
      case "no-face":
        return { state: "no-face", title: "NO FACE DETECTED", sub: "Nothing to identify", headline: MESSAGES.noFace, note: "Use a front-facing, well-lit photo in which the face is clearly visible." };
      case "multiple":
        return {
          state: "multiple",
          title: "MULTIPLE FACES",
          sub: `${pred.count} faces found`,
          headline: MESSAGES.multiple(pred.count),
          note: "Crop the photo, or upload another one in which only one face is visible.",
        };
      case "unclear":
        return {
          state: "unclear",
          title: "FACE UNCLEAR",
          sub:
            pred.reason === "small-face"
              ? "Face is too small"
              : pred.reason === "low-quality"
                ? "Small face quality is too low"
                : pred.reason === "invalid-embedding"
                  ? "Face features could not be measured"
                  : "Face is not clear enough",
          headline:
            pred.reason === "small-face"
              ? MESSAGES.smallFace(pred.sizePx, cfg.minFacePx)
              : pred.reason === "low-detection"
                ? MESSAGES.lowScore(pred.score, cfg.minDetectionScore)
                : pred.reason === "low-quality"
                  ? MESSAGES.lowQuality(pred.qualityIssues || [])
                  : MESSAGES.invalidEmbedding,
          note:
            pred.reason === "small-face"
              ? `Measured on your original photo (${scan.origSize ? `${scan.origSize.w}×${scan.origSize.h}` : "?"}): the face's shorter side is ${Math.round(pred.sizePx)}px; at least ${cfg.minFacePx}px is needed.`
              : pred.reason === "low-quality"
                ? `A small face needs a sharp, detailed, well-exposed crop that is not cut off. Quality checks: ${(pred.qualityIssues || []).join("; ")}.`
                : pred.reason === "invalid-embedding"
                  ? "The face was detected, but the recognition model did not return 128 finite face features."
                  : `Detector confidence ${pct(pred.score)}% (at least ${pct(cfg.minDetectionScore)}% is needed). Blur, strong shadows, a turned head, a cap/helmet or sunglasses lower it.`,
        };
      case "empty-gallery":
        return { state: "error", title: "NO RESULT", sub: MESSAGES.emptyGallery, headline: "—", note: "" };
    }
  })();

  const inputLabel = cameraOn ? "CAMERA" : scan.source === "upload" ? "UPLOAD" : scan.source === "camera" ? "CAPTURE" : "IDLE";
  const quality2 = cameraOn ? camRes || "STARTING…" : scan.size ? `${scan.size.w}×${scan.size.h}` : "NO SIGNAL";
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const shown = showAll ? candidates : candidates.slice(0, 3);
  const faceLabel = (i: number) =>
    !pred
      ? ""
      : pred.kind === "match"
        ? `${pred.best.name.toUpperCase()} · ${pct(pred.confidence)}%`
        : pred.kind === "no-match"
          ? `NO MATCH · ${pct(pred.confidence)}%`
          : pred.kind === "ambiguous"
            ? "INCONCLUSIVE"
            : pred.kind === "unclear"
              ? "UNCLEAR"
              : pred.kind === "multiple"
                ? `FACE ${i + 1}`
                : "";

  return (
    <>
      <section className="intro">
        <div>
          <h2>AI face scanner</h2>
          <p>Identify players from live camera or uploaded photos. Face matching runs entirely in your browser.</p>
        </div>
        <div className="secure">
          <span>
            <Icon name="check" size={11} />
          </span>{" "}
          ON-DEVICE ANALYSIS
        </div>
      </section>

      <section className="workspace">
        <div className="scanner-card panel">
          <div className="panel-top">
            <div>
              <span className="camera-dot" /> INPUT <b>{inputLabel}</b>
            </div>
            <div className="quality">
              <span /> {quality2}
            </div>
          </div>
          <div
            ref={stageRef}
            className={`camera-stage ${drag ? "drag" : ""}`}
            data-testid="stage"
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onFile(e.dataTransfer.files[0]);
            }}
          >
            {cameraOn ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) => setCamRes(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
              />
            ) : scan.previewUrl ? (
              <img src={scan.previewUrl} alt="Image being analysed" data-testid="preview" />
            ) : (
              <>
                <img src={HERO} alt="" className="idle-hero" onError={(e) => (e.currentTarget.style.display = "none")} />
                <div className="stage-empty">
                  <Icon name="scan" size={30} />
                  <b>No image loaded</b>
                  <span>Drop a photo here, upload an image, or start the camera.</span>
                  <button className="ghost" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={14} /> Choose a photo
                  </button>
                </div>
              </>
            )}
            <div className="cinema-overlay" />
            <div className="top-meta">
              <span>{cameraOn ? "LIVE FEED" : scan.previewUrl ? "STILL IMAGE" : "NO INPUT"}</span>
              <b>{cameraOn ? `${hh}:${mm}:${ss}` : scan.size ? `${scan.faces.length} FACE${scan.faces.length === 1 ? "" : "S"}` : "--:--:--"}</b>
            </div>
            <button className="expand" aria-label="Expand preview" title="Full screen" onClick={expand}>
              <Icon name="expand" size={16} />
            </button>

            {scanning && (
              <div className="face-frame is-scanning">
                <i className="c1" />
                <i className="c2" />
                <i className="c3" />
                <i className="c4" />
                <div className="target">
                  <span />
                  <span />
                </div>
                <small>ANALYSING BIOMETRICS</small>
              </div>
            )}
            {scanning && <div className="scan-line" />}
            {!cameraOn &&
              geo &&
              scan.status === "done" &&
              scan.faces.map((f, i) => (
                <div
                  key={i}
                  className={`face-frame real ${isMatch ? "" : "is-unknown"} sel`}
                  style={{
                    left: f.box.x * geo.s + geo.ox,
                    top: f.box.y * geo.s + geo.oy,
                    width: f.box.width * geo.s,
                    height: f.box.height * geo.s,
                    transform: "none",
                  }}
                  data-testid="face-box"
                >
                  <i className="c1" />
                  <i className="c2" />
                  <i className="c3" />
                  <i className="c4" />
                  <small>{faceLabel(i)}</small>
                </div>
              ))}

            <div className="camera-caption">
              <div>
                <span className={`status-dot ${cameraOn ? "" : "off"}`} /> {cameraOn ? "Camera active" : "Camera off"}
              </div>
              <span>
                Source: {cameraOn ? "Camera" : scan.source === "upload" ? "Uploaded image" : scan.source === "camera" ? "Camera capture" : "none"}
              </span>
            </div>
          </div>
          <div className="controls">
            <div className="control-group">
              <button
                className={cameraOn ? "round active" : "round"}
                onClick={() => (cameraOn ? stopCamera() : void startCamera())}
                title={cameraOn ? "Stop camera" : "Use camera"}
                aria-label={cameraOn ? "Stop camera" : "Use camera"}
                aria-pressed={cameraOn}
              >
                <Icon name="video" />
              </button>
              <button
                className="round"
                onClick={app.reanalyse}
                disabled={cameraOn || !scan.previewUrl || scanning}
                title="Refocus – run detection again on the current image"
                aria-label="Refocus"
              >
                <Icon name="focus" />
              </button>
            </div>
            <button
              className="capture"
              onClick={() => void capture()}
              disabled={!cameraOn}
              aria-label="Capture and identify"
              title={cameraOn ? "Capture & identify" : "Start the camera to capture"}
            >
              <span>
                <Icon name="camera" size={22} />
              </span>
            </button>
            <div className="control-group right">
              <button className="upload-btn" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={16} /> Upload image
              </button>
              <input ref={fileRef} type="file" accept="image/*" data-testid="file-input" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} hidden />
            </div>
          </div>
          <div className="limit-bars">
            <div className="limit-bar">
              <label htmlFor="limit">MATCH DISTANCE LIMIT</label>
              <input id="limit" type="range" min={LIMIT_MIN} max={LIMIT_MAX} value={limit} onChange={(e) => app.setLimit(+e.target.value)} />
              <b data-testid="limit-value">{lim.toFixed(2)}</b>
              <em>lower = stricter</em>
            </div>
            <div className="limit-bar">
              <label htmlFor="minconf">MINIMUM CONFIDENCE</label>
              <input id="minconf" type="range" min={MINCONF_MIN} max={MINCONF_MAX} value={minConf} onChange={(e) => app.setMinConf(+e.target.value)} />
              <b data-testid="minconf-value">{minConf}%</b>
              <em>higher = stricter</em>
            </div>
          </div>
          {scan.message && scan.status === "error" && (
            <div className="scan-status error" role="status">
              {scan.message}
            </div>
          )}
        </div>

        <aside className="verification panel" data-state={view.state} data-testid="verification">
          <div className="verification-head">
            <div>
              <span className={`verified-icon ${isMatch ? "" : "pending"}`}>
                <Icon name={isMatch || view.state === "idle" || view.state === "scanning" ? "check" : "alert"} size={14} />
              </span>
              <div>
                <b>{view.title}</b>
                <small title={view.sub}>{view.sub}</small>
              </div>
            </div>
            {scan.status !== "idle" && (
              <button aria-label="Clear result" title="Clear result" onClick={app.clearScan}>
                <Icon name="x" size={15} />
              </button>
            )}
          </div>

          <div className="player-identity">
            <div className={`portrait ${isMatch ? "" : "empty"}`}>
              {isMatch && summary?.thumbnail ? (
                <img src={summary.thumbnail.source} alt={`Profile of ${cand!.name}`} data-testid="profile-image" />
              ) : (
                <div className="mono-lg">
                  {isMatch ? cand!.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("") : view.state === "idle" || view.state === "scanning" ? <Icon name="scan" size={26} /> : <Icon name="alert" size={24} />}
                </div>
              )}
              {isMatch && (
                <span>
                  <Icon name="check" size={11} />
                </span>
              )}
            </div>
            <p>{isMatch ? (summary?.description ? summary.description.toUpperCase() : `${cand!.samples} REFERENCE SAMPLE${cand!.samples === 1 ? "" : "S"}`) : view.state === "idle" ? "NO PLAYER SELECTED" : "NO PLAYER IDENTIFIED"}</p>
            <h3 className={isMatch || view.headline === "—" ? "" : "msg"} data-testid="result-name">
              {view.headline}
            </h3>
            {isMatch && role && <span className="role">{role.toUpperCase()}</span>}
            {view.note && (
              <div className="prediction-note" data-testid="prediction-note">
                {view.note}
              </div>
            )}
          </div>

          <div className="confidence-block">
            <div className={`ring ${hasNumbers && !isMatch ? "warn" : ""}`}>
              <svg viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" />
                <circle className="progress" cx="40" cy="40" r="34" style={{ strokeDasharray: `${(conf * 213.6).toFixed(1)} 214` }} />
              </svg>
              <div>
                <strong data-testid="confidence">{hasNumbers ? (conf * 100).toFixed(1) : "—"}</strong>
                <span>{hasNumbers ? "%" : ""}</span>
                <small>CONFIDENCE</small>
              </div>
            </div>
            <div className="match-data">
              <div>
                <span>{hasNumbers && !isMatch ? "Closest distance" : "Match distance"}</span>
                <b data-testid="distance">{hasNumbers ? cand!.dist.toFixed(4) : "—"}</b>
              </div>
              <div>
                <span>Thresholds</span>
                <b data-testid="thresholds">
                  ≤ {lim.toFixed(2)} · ≥ {minConf}%
                </b>
              </div>
              <div>
                <span>Detection quality</span>
                <b>{face ? `${quality(face.score)} · ${pct(face.score)}%` : "—"}</b>
              </div>
              <div>
                <span>Reference images</span>
                <b>{hasNumbers ? cand!.samples : "—"}</b>
              </div>
            </div>
          </div>

          <div className="candidate-head">
            <span>{isMatch ? "TOP CANDIDATES" : "CLOSEST REGISTERED PLAYERS"}</span>
            {candidates.length > 3 && (
              <button onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show less" : "View all"} <Icon name="chevron" size={13} />
              </button>
            )}
          </div>
          <div className={`candidates ${isMatch ? "" : "muted"}`}>
            {shown.length ? (
              shown.map((m, i) => (
                <button className={i === 0 && isMatch ? "selected" : ""} key={m.title} onClick={() => app.openProfile(m.title)} title="Open career record" data-testid="candidate">
                  <Avatar title={m.title} name={m.name} />
                  <span>
                    <b>{m.name}</b>
                    <small>
                      distance {m.dist.toFixed(2)} · {m.samples} sample{m.samples === 1 ? "" : "s"}
                    </small>
                  </span>
                  <em>{pct(confidence(m.dist))}%</em>
                </button>
              ))
            ) : (
              <div className="empty-note small">{hasNumbers ? "" : "Candidates appear here after a scan with one clear face."}</div>
            )}
          </div>
          {scan.status !== "idle" && scan.status !== "scanning" && (
            <details className="diag" data-testid="diagnostics" open>
              <summary>Diagnostics</summary>
              <dl>
                <div><dt>Original image</dt><dd data-testid="diag-original">{scan.origSize ? `${scan.origSize.w} × ${scan.origSize.h} px` : "—"}</dd></div>
                <div>
                  <dt>Processed image</dt>
                  <dd data-testid="diag-processed">
                    {scan.diag ? (scan.diag.scale === 1 ? `${scan.diag.processedSize.w} × ${scan.diag.processedSize.h} px (not resized)` : `${scan.diag.processedSize.w} × ${scan.diag.processedSize.h} px (×${scan.diag.scale.toFixed(3)}, aspect ratio kept)`) : "—"}
                  </dd>
                </div>
                <div><dt>Faces detected</dt><dd data-testid="diag-faces">{scan.status === "done" ? scan.faces.length : "—"}</dd></div>
                {scan.faces.map((f, i) => (
                  <div key={i}>
                    <dt>{scan.faces.length > 1 ? `Face ${i + 1} (original px)` : "Face size (original px)"}</dt>
                    <dd data-testid="diag-face">
                      {faceW(f)} × {faceH(f)} px · detector {pct(f.score)}%
                      {pred && "lowRes" in pred && pred.lowRes && scan.faces.length === 1 ? " · low resolution, reliability reduced" : ""}
                    </dd>
                  </div>
                ))}
                <div><dt>Closest candidate</dt><dd data-testid="diag-closest">{cand ? `${cand.name} · ${cand.samples} reference photo${cand.samples === 1 ? "" : "s"}` : "—"}</dd></div>
                <div><dt>Distance / confidence</dt><dd data-testid="diag-distance">{cand ? `${cand.dist.toFixed(4)} · ${(conf * 100).toFixed(1)}% (limits ≤ ${lim.toFixed(2)}, ≥ ${minConf}%)` : "—"}</dd></div>
                <div><dt>Decision</dt><dd data-testid="diag-decision">{scan.status === "error" ? "NO RESULT (analysis could not run)" : pred ? decision[pred.kind] : "—"}</dd></div>
                <div><dt>Reason</dt><dd data-testid="diag-reason">{scan.status === "error" ? scan.message : pred ? explain(pred, cfg) : "—"}</dd></div>
                {scan.diag && (
                  <div>
                    <dt>Processing</dt>
                    <dd>{scan.diag.passes.join(" → ")} · {scan.diag.ms} ms</dd>
                  </div>
                )}
                <div>
                  <dt>Gallery</dt>
                  <dd data-testid="diag-gallery">
                    {health.players} players · {health.samples} samples · {health.singleSample} with a single photo
                    {health.invalidSamples ? ` · ${health.invalidSamples} invalid samples ignored` : ""}
                    {health.unusablePlayers ? ` · ${health.unusablePlayers} players unusable` : ""}
                  </dd>
                </div>
              </dl>
            </details>
          )}
          <button className="view-profile" disabled={!isMatch} onClick={() => cand && app.openProfile(cand.title)}>
            {isMatch ? "Open full player profile" : "No verified match to open"} <Icon name="chevron" size={14} />
          </button>
        </aside>
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
        <ActivityList entries={history.slice(0, 4)} onOpen={app.openProfile} empty="No recognitions yet. Upload a photo or use the camera and your results will be logged here." />
      </section>
    </>
  );
}
