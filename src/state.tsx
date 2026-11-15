import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  HISTORY_CAP,
  LIMIT_DEFAULT,
  MINCONF_DEFAULT,
  loadGallery,
  loadHistory,
  loadLimit,
  loadMinConf,
  loadNotes,
  loadTheme,
  parseGalleryImport,
  saveGallery,
  saveHistory,
  saveLimit,
  saveMinConf,
  saveNotes,
  saveTheme,
  type Gallery,
  type HistoryEntry,
  type Notes,
} from "./lib/storage";
import {
  addPlayerFromWiki,
  descriptorFromImage,
  dist,
  detectImage,
  fileToImage,
  loadModels,
  type DetectedFace,
  type PipelineDiag,
} from "./lib/face";
import { planScale, scaledSize } from "./lib/geometry";
import { disp, ensureDirectory } from "./lib/wikipedia";
import { POPULAR } from "./lib/popular";
import { bestMatches, confidence, isValidDescriptor } from "./lib/match";
import { DEFAULT_CONFIG, MESSAGES, explain, makeConfig, predict } from "./lib/predict";

export type Route = "overview" | "scanner" | "library" | "log" | "data";
export const ROUTES: Route[] = ["overview", "scanner", "library", "log", "data"];

export interface Notice {
  id: number;
  ts: number;
  text: string;
  kind: "info" | "ok" | "warn";
  read: boolean;
}
export interface ScanState {
  status: "idle" | "scanning" | "done" | "error";
  message: string;
  previewUrl: string | null;
  source: "camera" | "upload" | null;
  size: { w: number; h: number } | null; // size of the working canvas (DetectedFace.box coordinates are in this space)
  origSize: { w: number; h: number } | null; // size of the photo as uploaded / captured (DetectedFace.origBox is in this space)
  diag: PipelineDiag | null; // how the photo was processed (scale, passes, timing) – shown in the scanner diagnostics
  faces: DetectedFace[];
}
export interface BuildState {
  running: boolean;
  done: number;
  total: number;
  text: string;
}
export type ModelStatus = { state: "loading" | "ready" | "error"; message: string };

const IDLE_SCAN: ScanState = { status: "idle", message: "", previewUrl: null, source: null, size: null, origSize: null, diag: null, faces: [] };

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(h) ? h : "scanner";
}

function useAppState() {
  /* ---------- theme ---------- */
  const [dark, setDark] = useState(() => loadTheme() === "dark");
  useEffect(() => {
    saveTheme(dark ? "dark" : "light");
    document.body.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  /* ---------- notifications (bell) ---------- */
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const notify = useCallback((text: string, kind: Notice["kind"] = "info") => {
    setNotices((n) => [{ id: ++noticeId.current, ts: Date.now(), text, kind, read: false }, ...n].slice(0, 30));
  }, []);
  const markNoticesRead = () => setNotices((n) => n.map((x) => ({ ...x, read: true })));
  const clearNotices = () => setNotices([]);

  /* ---------- routing ---------- */
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [libTab, setLibTab] = useState<"enrolled" | "records">("enrolled");
  const [profile, setProfile] = useState<string | null>(null);
  const [recQuery, setRecQuery] = useState("");
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((r: Route) => {
    if (window.location.hash !== `#/${r}`) window.location.hash = `/${r}`;
    setRoute(r);
  }, []);
  const openProfile = useCallback(
    (title: string) => {
      setProfile(title);
      setLibTab("records");
      go("library");
    },
    [go],
  );

  /* ---------- match limit (the original slider, 30..80 => 0.30..0.80) ---------- */
  const [limit, setLimitState] = useState(loadLimit);
  const limitRef = useRef(limit);
  const setLimit = (v: number) => {
    limitRef.current = v;
    setLimitState(v);
    saveLimit(v);
  };

  /* ---------- minimum confidence (new; works together with the distance limit) ---------- */
  const [minConf, setMinConfState] = useState(loadMinConf);
  const minConfRef = useRef(minConf);
  const setMinConf = (v: number) => {
    minConfRef.current = v;
    setMinConfState(v);
    saveMinConf(v);
  };

  /* ---------- gallery (mutable store, same cadence of saving as the original) ---------- */
  const galleryRef = useRef<Gallery>(loadGallery());
  const [gver, setGver] = useState(0);
  const touch = () => setGver((v) => v + 1);
  const persist = () => {
    const ok = saveGallery(galleryRef.current);
    if (!ok) notify("Browser storage is full or blocked – the gallery will be lost when you close this page (use Export).", "warn");
    return ok;
  };
  const gallery = galleryRef.current;

  /* ---------- history + notes (new keys) ---------- */
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const refreshHistory = () => setHistory(loadHistory());
  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };
  const [notes, setNotes] = useState<Notes>(loadNotes);
  const setNote = (title: string, text: string) => {
    setNotes((n) => {
      const next = { ...n };
      if (text.trim()) next[title] = { text, updated: Date.now() };
      else delete next[title];
      saveNotes(next);
      return next;
    });
  };

  /* ---------- models ---------- */
  const [models, setModels] = useState<ModelStatus>({ state: "loading", message: "Loading the face-recognition models (about 10 MB, first time only)…" });
  const modelsReady = useRef(false);
  const modelsFailed = useRef(false);
  const modelsStarted = useRef(false);
  const startModels = useCallback(() => {
    modelsReady.current = false;
    modelsFailed.current = false;
    setModels({ state: "loading", message: "Loading the face-recognition models (about 10 MB, first time only)…" });
    loadModels()
      .then(() => {
        modelsReady.current = true;
        setModels({ state: "ready", message: "Models ready" });
        notify("Face-recognition models loaded.", "ok");
        if (!Object.keys(galleryRef.current).length) runBuildRef.current(POPULAR); // first visit: prepare the gallery automatically
      })
      .catch((e: Error) => {
        modelsFailed.current = true;
        setModels({ state: "error", message: e.message + " This app needs an internet connection the first time – check it and retry." });
      });
  }, [notify]);
  useEffect(() => {
    if (modelsStarted.current) return;
    modelsStarted.current = true;
    startModels();
  }, [startModels]);

  /* ---------- gallery builder ---------- */
  const [build, setBuild] = useState<BuildState>({ running: false, done: 0, total: 0, text: "" });
  const building = useRef(false);
  const stopFlag = useRef(false);
  const runBuild = async (titles: string[]) => {
    if (building.current) return;
    if (!modelsReady.current) {
      setBuild((b) => ({ ...b, text: "Models are still loading – try again in a moment." }));
      return;
    }
    building.current = true;
    stopFlag.current = false;
    const g = galleryRef.current;
    const known = new Set(Object.values(g).map((p) => p.name.toLowerCase()));
    const todo = titles.filter((t) => !known.has(disp(t).toLowerCase()));
    let done = 0,
      ok = 0,
      fail = 0;
    setBuild({ running: true, done: 0, total: todo.length, text: `Starting… ${todo.length} players to add` });
    for (const t of todo) {
      if (stopFlag.current) break;
      try {
        (await addPlayerFromWiki(t, g)) ? ok++ : fail++;
      } catch {
        fail++;
      }
      done++;
      if (done % 5 === 0) {
        persist();
        touch();
      }
      setBuild({ running: true, done, total: todo.length, text: `Processed ${done}/${todo.length} – added ${ok}, no usable face photo for ${fail}` });
    }
    persist();
    touch();
    building.current = false;
    const stopped = stopFlag.current;
    setBuild({ running: false, done, total: todo.length, text: stopped ? "Stopped." : `Done – added ${ok}, skipped ${fail}.` });
    notify(stopped ? "Gallery building stopped." : `Face gallery ready: ${Object.keys(g).length} players.`, stopped ? "info" : "ok");
  };
  const runBuildRef = useRef(runBuild);
  runBuildRef.current = runBuild;
  const buildPopular = () => runBuild(POPULAR);
  const buildAll = async () => {
    setBuild((b) => ({ ...b, text: "Loading the list of all Indian internationals from Wikipedia…" }));
    try {
      const dir = await ensureDirectory();
      await runBuild(dir);
    } catch (e) {
      setBuild((b) => ({ ...b, text: "⚠ " + (e as Error).message }));
    }
  };
  const stopBuild = () => {
    stopFlag.current = true;
  };

  /* ---------- gallery editing ---------- */
  const addPhotos = async (name: string, files: File[]): Promise<string> => {
    if (!modelsReady.current) return "Models are still loading…";
    const g = galleryRef.current;
    const key = Object.keys(g).find((k) => g[k]!.name.toLowerCase() === name.toLowerCase() || k.toLowerCase() === name.toLowerCase()) || name;
    let added = 0,
      skipped = 0,
      duplicates = 0;
    for (const f of files) {
      try {
        const d = await descriptorFromImage(await fileToImage(f));
        if (d) {
          const entry = (g[key] ||= { name: disp(name), samples: [] });
          if (entry.samples.some((x) => dist(x, d) < 0.002)) duplicates++; // the very same photo again
          else {
            entry.samples.push(d);
            added++;
          }
        } else skipped++;
      } catch {
        skipped++;
      }
    }
    persist();
    touch();
    return (
      `Added ${added} photo(s) to ${name}` +
      (skipped ? `, ${skipped} skipped (no single clear, usable face; small, blurred, or cropped faces may be rejected)` : "") +
      (duplicates ? `, ${duplicates} skipped (already enrolled)` : "")
    );
  };
  const deletePlayer = (title: string) => {
    delete galleryRef.current[title];
    persist();
    touch();
  };
  const clearGallery = () => {
    galleryRef.current = {};
    persist();
    touch();
  };
  const addFromWiki = async (title: string): Promise<boolean> => {
    const ok = await addPlayerFromWiki(title, galleryRef.current);
    persist();
    touch();
    return ok;
  };
  const exportGallery = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(galleryRef.current)], { type: "application/json" }));
    a.download = "cricket_face_gallery.json";
    a.click();
  };
  const importGallery = async (file: File): Promise<boolean> => {
    const parsed = parseGalleryImport(await file.text());
    if (!parsed) {
      notify("That file is not a valid gallery export.", "warn");
      return false;
    }
    Object.assign(galleryRef.current, parsed);
    persist();
    touch();
    notify(`Gallery imported (${Object.keys(parsed).length} players).`, "ok");
    return true;
  };

  /* ---------- scanner ---------- */
  const [scan, setScan] = useState<ScanState>(IDLE_SCAN);
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const runId = useRef(0);
  const lastInput = useRef<{ source: CanvasImageSource; w: number; h: number; kind: "camera" | "upload" } | null>(null); // the ORIGINAL pixels, so "Refocus" re-runs on full detail

  const swapPreview = (next: string | null) => {
    const old = scanRef.current.previewUrl;
    if (old && old !== next && old.startsWith("blob:")) URL.revokeObjectURL(old);
  };

  const analyse = async (
    source: CanvasImageSource,
    w: number,
    h: number,
    kind: "camera" | "upload",
    previewUrl: string | null,
    log = true,
  ) => {
    const id = ++runId.current;
    swapPreview(previewUrl);
    const base: ScanState = { ...IDLE_SCAN, previewUrl, source: kind };
    if (!modelsReady.current)
      return setScan({
        ...base,
        status: "error",
        message: modelsFailed.current
          ? "The face models could not be loaded – open Data Sources to retry."
          : "The face models are still loading – please wait a moment.",
      });
    if (!Object.keys(galleryRef.current).length)
      return setScan({ ...base, status: "error", message: MESSAGES.emptyGallery });
    lastInput.current = { source, w, h, kind };
    // the working canvas is made inside the pipeline; its size is known up front (one uniform scale, aspect ratio kept)
    const size = scaledSize(w, h, planScale(w, h));
    const origSize = { w, h };
    setScan({ ...base, status: "scanning", message: "Detecting faces…", size, origSize });
    let faces: DetectedFace[];
    let diag: PipelineDiag;
    try {
      ({ faces, diag } = await detectImage(source, w, h, makeConfig(limitRef.current, minConfRef.current).minDetectionScore));
    } catch (e) {
      // PipelineError messages are already readable ("image only 20x20px", "Face detection failed: ..."); anything else is wrapped
      const msg = e instanceof Error && e.message ? e.message : String(e);
      if (id === runId.current) setScan({ ...base, status: "error", message: /^(The image|Face detection failed)/.test(msg) ? msg : `Face detection failed: ${msg}`, size, origSize });
      return;
    }
    if (id !== runId.current) return; // a newer scan started
    setScan({ ...base, status: "done", message: "", size, origSize, diag, faces }); // the outcome (incl. "no face") is derived from faces + thresholds
    const config = makeConfig(limitRef.current, minConfRef.current);
    const prediction = predict(faces, galleryRef.current, config);
    if (import.meta.env.DEV) {
      const currentGallery = galleryRef.current;
      const galleryHealth = Object.values(currentGallery).reduce(
        (counts, player) => {
          const samples = Array.isArray(player?.samples) ? player.samples : [];
          const validSamples = samples.filter(isValidDescriptor).length;
          return {
            validSamples: counts.validSamples + validSamples,
            invalidSamples: counts.invalidSamples + samples.length - validSamples,
            playersWithoutValidSamples: counts.playersWithoutValidSamples + (validSamples ? 0 : 1),
          };
        },
        { validSamples: 0, invalidSamples: 0, playersWithoutValidSamples: 0 },
      );
      const firstFace = faces[0];
      const closest = firstFace ? bestMatches(currentGallery, firstFace.descriptor, 1)[0] : undefined;
      console.info("[CreaseVision scan diagnostics]", {
        image: { source: kind, width: w, height: h, processedSize: diag.processedSize, scale: diag.scale },
        faceDetection: {
          detected: faces.length > 0,
          count: faces.length,
          faces: faces.map((face) => ({
            score: face.score,
            originalSize: { width: face.origBox.width, height: face.origBox.height },
            descriptorValid: isValidDescriptor(face.descriptor),
            quality: face.quality ?? null,
          })),
        },
        gallery: {
          loadedPlayers: Object.keys(currentGallery).length,
          validSamples: galleryHealth.validSamples,
          invalidSamples: galleryHealth.invalidSamples,
          playersWithoutValidSamples: galleryHealth.playersWithoutValidSamples,
        },
        matching: {
          metric: "Euclidean distance (smaller is closer)",
          configuredDistanceLimit: config.limit,
          configuredMinConfidence: config.minConfidence,
          effectiveDistanceLimit: Math.min(config.limit, 0.8 - config.minConfidence * 0.4),
          closestCandidate: closest
            ? {
                id: closest.title,
                name: closest.name,
                idExistsInGallery: Object.prototype.hasOwnProperty.call(currentGallery, closest.title),
                validSamples: closest.samples,
                distance: closest.dist,
                confidence: confidence(closest.dist),
              }
            : null,
        },
        decision: { result: prediction.kind, reason: explain(prediction, config) },
      });
    }
    if (log) {
      // only a real single-face prediction is logged; "no face", "several faces" and "unclear" are not predictions
      const pred = prediction;
      const picked = pred.kind === "match" ? pred.best : pred.kind === "no-match" ? pred.closest : pred.kind === "ambiguous" ? pred.best : null;
      if (picked && (pred.kind === "match" || pred.kind === "no-match" || pred.kind === "ambiguous")) {
        const ts = Date.now();
        const entry: HistoryEntry = {
          id: `${ts}-0-${Math.random().toString(36).slice(2, 7)}`,
          ts,
          source: kind,
          title: picked.title,
          name: picked.name,
          known: pred.kind === "match",
          confidence: pred.confidence,
          dist: picked.dist,
          limit: limitRef.current / 100,
          face: 1,
          faces: 1,
        };
        setHistory((h) => {
          const next = [entry, ...h].slice(0, HISTORY_CAP);
          saveHistory(next);
          return next;
        });
      }
    }
  };
  const identifyFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    let img: HTMLImageElement;
    try {
      img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("unreadable"));
        i.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      setScan((s) => ({ ...s, status: "error", message: `Could not read "${file.name}" as an image (${file.type || "unknown type"}). Use a JPEG, PNG or WebP photo.` }));
      return;
    }
    // naturalWidth/Height are the EXIF-corrected pixel size of the file; drawImage uses the same orientation
    try {
      await analyse(img, img.naturalWidth, img.naturalHeight, "upload", url);
    } catch (e) {
      setScan((s) => ({ ...s, status: "error", message: `Analysis failed: ${(e as Error).message || e}` }));
    }
  };
  const reanalyse = () => {
    const last = lastInput.current;
    if (!last) return;
    void analyse(last.source, last.w, last.h, last.kind, scanRef.current.previewUrl, false);
  };
  const setScanMessage = (message: string) => setScan((s) => ({ ...s, status: "error", message }));
  const clearScan = () => {
    runId.current++;
    swapPreview(null);
    lastInput.current = null;
    setScan(IDLE_SCAN);
  };

  /* camera state is shown in the sidebar badge, owned here so it survives re-renders */
  const [cameraOn, setCameraOn] = useState(false);

  return {
    dark, setDark,
    route, go, libTab, setLibTab, profile, setProfile, openProfile, recQuery, setRecQuery,
    notices, notify, markNoticesRead, clearNotices,
    limit, setLimit, limitDefault: LIMIT_DEFAULT, minConf, setMinConf, minConfDefault: MINCONF_DEFAULT,
    gallery, gver, models, startModels,
    build, buildPopular, buildAll, stopBuild,
    addPhotos, deletePlayer, clearGallery, addFromWiki, exportGallery, importGallery,
    history, refreshHistory, clearHistory, notes, setNote,
    scan, analyse, identifyFile, reanalyse, setScanMessage, clearScan, cameraOn, setCameraOn,
  };
}

export type AppState = ReturnType<typeof useAppState>;
const Ctx = createContext<AppState | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

/* gallery-derived stats (recomputed when the gallery version changes) */
export function useGalleryStats() {
  const { gallery, gver } = useApp();
  return useMemo(() => {
    const names = Object.keys(gallery);
    return { players: names.length, samples: names.reduce((n, k) => n + gallery[k]!.samples.length, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gver, gallery]);
}
