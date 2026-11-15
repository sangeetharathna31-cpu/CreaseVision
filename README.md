# CreaseVision

Cricket player face recognition: live camera or uploaded photos are matched against a face gallery, with player career
records from Wikipedia, recognition log, notes and data tools. Everything runs in the browser; photos are never uploaded.
Stack: React 19, TypeScript, Vite 8, face-api (loaded from the jsDelivr CDN, same version as the original app).

## Windows 10/11 – install (once)

1. Install **Node.js 22 LTS** (any version `^20.19` or `>=22.12`) from https://nodejs.org – tick the default options.
2. Open **PowerShell** (or Windows Terminal) and enable pnpm:
   ```powershell
   corepack enable
   corepack prepare pnpm@latest --activate
   ```
   If `corepack enable` says access is denied, either run PowerShell once as Administrator, or use `npm install -g pnpm` instead.
3. Extract the ZIP, then:
   ```powershell
   cd path\to\creasevision
   pnpm install
   ```

## Windows – start

```powershell
pnpm dev
```
Open **http://localhost:8443** in Chrome or Edge.
- The port is fixed to 8443. If it is busy: PowerShell `$env:PORT=3000; pnpm dev` / cmd `set PORT=3000 && pnpm dev`, then open that port.
- The server only listens on `localhost`, so Windows Firewall does not ask anything and nothing is exposed to your network.
- Production build: `pnpm build` then `pnpm preview` (also http://localhost:8443).
- Do **not** open `index.html` by double-clicking it: the module scripts, camera and LocalStorage need the `http://localhost` address.

First start needs **internet**: it downloads the face-api library and models (~10 MB) from jsDelivr and player data from
Wikipedia. On first visit the app builds the face gallery from Wikipedia photos automatically (~75 players, a few minutes);
you can keep using the app meanwhile. Data is stored in your browser (LocalStorage) – use *Data Sources > Export* to back it up.

## Camera on Windows
Use `http://localhost:8443` (camera is blocked on other addresses). Press **Allow** when the browser asks. If it was denied:
click the camera/lock icon in the address bar and allow it, and check *Windows Settings > Privacy & security > Camera*
("Camera access" and "Let desktop apps access your camera" must be On). Close other apps that use the camera (Teams, Zoom).

## Commands
| Command | What it does |
|---|---|
| `pnpm dev` | development server on http://localhost:8443 |
| `pnpm build` | production build into `dist/` |
| `pnpm preview` | serve the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:setup` | one-time download of Playwright's Chromium |
| `pnpm test` | build + end-to-end tests (see `tests/README.md`) |

## How a photo is judged (prediction rules)
The app never forces a name. One photo is turned into exactly one of these outcomes (`src/lib/predict.ts`):

| Photo | Result shown |
|---|---|
| No face found (blank image, landscape, logo...) | **No face detected. Please upload a clear face image.** |
| More than one face | **N faces detected. Please upload an image containing only one person.** (nobody is identified) |
| One face, but the detector is unsure (score < 70 %) | **A face was found but the detector is not confident enough (N% vs 70% needed)…** – the real score is shown |
| One face, but under 32 px in the **original** photo | **The face is too small to identify (N px in your photo; at least 32 px needed)…** – the measured size is shown |
| One face, 32–47 px, but blurry, dark, low-detail, cropped or without a valid embedding | **The small face is not clear enough for a reliable match…** – the failed quality check is shown |
| One clear face, closest registered player is **within both thresholds** and clearly ahead of the next player | The player's **name, profile image and confidence** |
| One clear face, but no registered player passes both thresholds | **No registered Indian cricket player matched.** + the closest candidate, its distance/confidence and the rejection reason |
| One clear face, but two different registered players are almost equally close | Inconclusive – no name is given |

**This is a database-based prediction, not proof.** "No registered Indian cricket player matched." only means *no registered cricketer matched with
sufficient confidence*. The person may still be a cricketer who is not registered, or may look different in this photo.
Only no-match / match / inconclusive results are written to the Recognition Log; "no face", "several faces" and "unclear" are not predictions.

**Two configurable thresholds** (sliders under the camera, also in Settings; both are saved in the browser):
- *Match distance limit* – 0.30–0.80, default **0.55** (face-api's usual cut-off is 0.6, so 0.55 is deliberately a little stricter). Lower = stricter.
- *Minimum confidence* – 30–95 %, default **60 %**. Confidence = (0.8 − distance) / 0.4, clamped to 0–100 % (it is a score derived
  from the distance, not a calibrated probability). A match must satisfy **both**; the stricter one wins.
- Fixed safety rules: detector score >= 0.70; faces under 48 px need a valid embedding and pass sharpness, contrast, exposure and image-edge checks; faces under 32 px are rejected. Faces under 80 px are flagged "low resolution" in diagnostics. The 0.03 distance margin to the next different player is unchanged.
- Tune them with your own photos: if known players are rejected, raise the distance limit / lower the floor a little; if strangers
  are matched, do the opposite. Wikipedia portraits are one photo per player, so adding 3–5 photos per player (Player Library) helps.

## How a photo is processed (image size / face size)
`src/lib/geometry.ts` + `src/lib/pipeline.ts`:
1. Images with any positive width and height can be analyzed; there is no fixed 32px/64px upload-size requirement. One uniform scale (aspect ratio kept, never stretched, never enlarged) gives a working canvas whose longest side is <= 1024 px; photos that are already that small go to the detector untouched. Large reductions are resampled in halving steps.
2. Faces are detected on that canvas. **Face size is judged in original-photo pixels**, not in the reduced canvas.
3. The detector and recognition model align each face and resize it to the model's standard input; this preserves proportions and does not create missing detail. A 32–47px face can proceed only when its original crop has enough sharpness, contrast, exposure and visible area, and the embedding contains 128 finite values.
4. If nothing clear is found in a reduced photo (a small face in a big picture), the original pixels are scanned in overlapping tiles.
5. For one face in a reduced photo, the descriptor is re-extracted from a crop of the original pixels.
6. Gallery reference photos go through the same pipeline, and a team photo is never enrolled (the dominant face must be >= 2x the area of the next).

The **Diagnostics** box under the result shows: original and processed image size, number of faces, each face's size (original px) and detector score, closest candidate (with its number of reference photos), distance and confidence, the final decision with the exact rule that decided it, how the photo was processed, and gallery health (players, samples, single-photo players, invalid samples that are ignored).

## Check real recognition by hand (the automated tests use a face-api test double)
1. `pnpm dev`, open http://localhost:8443, wait until the sidebar says **Recognition engine: Online**.
2. *Player Library > Enrolled faces*: add 3–5 clear photos of a **consenting** person under their name.
3. *AI Scanner*: start the camera (or upload a different photo of that person) and capture. Expect their name, profile image,
   a confidence figure and "Identity verified".
4. Try each outcome with real photos: a famous registered cricketer (name + profile image + confidence); a person who is not
   registered ("He is not a cricket player."); a blurry or very small face (unclear message); a landscape or logo (no face message);
   a group photo (asks for one person). Note which unregistered people, if any, are wrongly matched and tighten the thresholds.
5. Check *Recognition Log* and the Overview numbers.

## Storage keys
`cricketGalleryV1`, `cricketDirV1` (original app keys and shapes), plus `cricketHistoryV1`, `cricketNotesV1`,
`cricketThemeV1`, `cricketLimitV1`. See `INTEGRATION_NOTES.md`.

## Known limitations
- The automated tests run the real pipeline / prediction code against simulated detectors; **real recognition accuracy has not been measured** (needs the real models and real photos – see "Check real recognition by hand").
- Most Wikipedia references are one photo per player; accuracy is lowest for those players. Add 3–5 photos per player in Player Library.
- Needs internet for face-api/models (CDN) and Wikipedia; there is no offline mode.
- The face-api script is loaded from the CDN without a Subresource-Integrity hash.
- Desktop layout (minimum width 1180px); not designed for phones.
- Recognition accuracy depends on the reference photos; Wikipedia portraits are often a single small photo per player.
