# CreaseVision – premium UI + original functionality

Design source: the premium UI (`src/index.css` is unchanged). Logic source: `indian_face_recognition_.html`.

## Structure
- `src/lib/storage.ts` – LocalStorage layer (original keys + shapes)
- `src/lib/face.ts` – face-api detection/recognition (same library version, models, SSD options, distance + confidence maths)
- `src/lib/wikipedia.ts` – Wikipedia directory, summary, infobox, article (ported unchanged)
- `src/lib/popular.ts` – the original popular-player list
- `src/state.tsx` – app state: models, gallery, builder, scan, history, notes, routing, notifications
- `src/views/*` – Scanner, Overview, Library (enrolled faces / career records / profile+notes), Log, DataSources
- `src/app-extra.css` – styles for states/screens the mock-up did not have (index.css untouched)
- `index.html` – loads face-api 1.7.12 from jsDelivr exactly like the original

## LocalStorage
| Key | Status | Shape |
|---|---|---|
| `cricketGalleryV1` | ORIGINAL, unchanged | `{ [wikiTitle]: { name, samples: number[128][] } }` |
| `cricketDirV1` | ORIGINAL, unchanged | `string[]` |
| `cricketHistoryV1` | new | newest-first `HistoryEntry[]`, capped at 500 (no images stored) |
| `cricketNotesV1` | new | `{ [wikiTitle]: { text, updated } }` |
| `cricketThemeV1` / `cricketLimitV1` | new | `"dark"\|"light"` / `30..80` |

## Run
See `README.md` (Windows install/start, camera setup, commands, manual real-recognition check).

## Tests (tests/)
Playwright (`.cjs` files because package.json is `"type": "module"`) + a face-api test double (the neural nets cannot be downloaded offline). See tests/README.md.

## Prediction (final image logic)
`src/lib/predict.ts` is the single decision engine (pure, unit-tested); `src/lib/match.ts` holds the matching maths; the Scanner derives its
result from `predict(faces, gallery, thresholds)` so the sliders re-evaluate a scan live. New storage key: `cricketMinConfV1`.
See README.md, "How a photo is judged".
