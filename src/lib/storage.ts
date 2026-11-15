/* LocalStorage layer.
 * KEY and DIRKEY are the ORIGINAL CreaseVision keys with their original data shapes.
 * The other keys are new and purely additive (the old app never reads or writes them). */
export const KEY = "cricketGalleryV1"; // { [wikiTitle]: { name, samples: number[128][] } }
export const DIRKEY = "cricketDirV1"; // string[] of Wikipedia page titles
export const THEMEKEY = "cricketThemeV1"; // "dark" | "light"
export const LIMITKEY = "cricketLimitV1"; // match distance limit x100 (30..80)
export const HISTKEY = "cricketHistoryV1"; // HistoryEntry[] (newest first)
export const NOTESKEY = "cricketNotesV1"; // { [wikiTitle]: { text, updated } }
export const MINCONFKEY = "cricketMinConfV1"; // minimum confidence in percent (30..95)

export interface GalleryPlayer {
  name: string;
  samples: number[][];
}
export type Gallery = Record<string, GalleryPlayer>;

export interface HistoryEntry {
  id: string;
  ts: number;
  source: "camera" | "upload";
  title: string; // best-matching gallery key
  name: string; // best-matching display name
  known: boolean; // dist <= limit at the time of the scan
  confidence: number; // 0..1, same formula as the original app
  dist: number;
  limit: number;
  face: number; // 1-based face index within the photo
  faces: number; // number of faces in the photo
}
export type Notes = Record<string, { text: string; updated: number }>;

export const HISTORY_CAP = 500;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadGallery = (): Gallery => {
  const g = readJSON<Gallery>(KEY, {});
  return g && typeof g === "object" && !Array.isArray(g) ? g : {};
};
export const saveGallery = (g: Gallery) => writeJSON(KEY, g);

export const loadDirectory = (): string[] => {
  const d = readJSON<string[]>(DIRKEY, []);
  return Array.isArray(d) ? d : [];
};
export const saveDirectory = (d: string[]) => writeJSON(DIRKEY, d);
export const clearDirectory = () => {
  try {
    localStorage.removeItem(DIRKEY);
  } catch {
    /* ignore */
  }
};

export const loadHistory = (): HistoryEntry[] => {
  const h = readJSON<HistoryEntry[]>(HISTKEY, []);
  return Array.isArray(h) ? h : [];
};
export const saveHistory = (h: HistoryEntry[]) =>
  writeJSON(HISTKEY, h.slice(0, HISTORY_CAP)) || writeJSON(HISTKEY, h.slice(0, 100)); // storage nearly full: keep the newest 100

export const loadNotes = (): Notes => {
  const n = readJSON<Notes>(NOTESKEY, {});
  return n && typeof n === "object" && !Array.isArray(n) ? n : {};
};
export const saveNotes = (n: Notes) => writeJSON(NOTESKEY, n);

export const loadTheme = (): "dark" | "light" => {
  try {
    return localStorage.getItem(THEMEKEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};
export const saveTheme = (t: "dark" | "light") => {
  try {
    localStorage.setItem(THEMEKEY, t);
  } catch {
    /* ignore */
  }
};

/* the original slider: min 30, max 80, default 55 */
export const LIMIT_MIN = 30;
export const LIMIT_MAX = 80;
export const LIMIT_DEFAULT = 55;
export const loadLimit = (): number => {
  try {
    const v = parseInt(localStorage.getItem(LIMITKEY) || "", 10);
    return v >= LIMIT_MIN && v <= LIMIT_MAX ? v : LIMIT_DEFAULT;
  } catch {
    return LIMIT_DEFAULT;
  }
};
export const saveLimit = (v: number) => {
  try {
    localStorage.setItem(LIMITKEY, String(v));
  } catch {
    /* ignore */
  }
};

/* minimum confidence (percent) a match must reach, in addition to the distance limit */
export const MINCONF_MIN = 30;
export const MINCONF_MAX = 95;
export const MINCONF_DEFAULT = 60;
export const loadMinConf = (): number => {
  try {
    const v = parseInt(localStorage.getItem(MINCONFKEY) || "", 10);
    return v >= MINCONF_MIN && v <= MINCONF_MAX ? v : MINCONF_DEFAULT;
  } catch {
    return MINCONF_DEFAULT;
  }
};
export const saveMinConf = (v: number) => {
  try {
    localStorage.setItem(MINCONFKEY, String(v));
  } catch {
    /* ignore */
  }
};

/** Validate an imported gallery file; keeps only well-formed players (128-number samples). */
export function parseGalleryImport(text: string): Gallery | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out: Gallery = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const p = v as GalleryPlayer;
    if (!p || typeof p.name !== "string" || !Array.isArray(p.samples)) continue;
    const samples = p.samples.filter(
      (s) => Array.isArray(s) && s.length === 128 && s.every((x) => typeof x === "number"),
    );
    if (samples.length) out[k] = { name: p.name, samples };
  }
  return Object.keys(out).length ? out : null;
}

/** Approximate stored size (characters) of every CreaseVision key, for the Data Sources page. */
export function storageReport() {
  const keys: [string, string][] = [
    [KEY, "Face gallery"],
    [DIRKEY, "Player directory cache"],
    [HISTKEY, "Recognition log"],
    [NOTESKEY, "Player notes"],
    [LIMITKEY, "Match distance limit"],
    [MINCONFKEY, "Minimum confidence"],
    [THEMEKEY, "Theme"],
  ];
  return keys.map(([key, label]) => {
    let size = 0;
    try {
      size = (localStorage.getItem(key) || "").length;
    } catch {
      /* ignore */
    }
    return { key, label, size };
  });
}
