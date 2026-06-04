# Trail Flythrough

A 3D trail flythrough visualizer inspired by the trail preview feature on [AllTrails](https://www.alltrails.com). Upload any GPX file and watch your route come to life as a cinematic animated flythrough on real satellite and terrain maps.

Built as a PWA — no backend, no server, runs entirely in your browser and is installable as a local app.

---

## Features

- **GPX upload** — drag & drop or file picker; parses track points and waypoints
- **Real 3D terrain** — MapLibre GL JS + Maptiler satellite/outdoor/topo tiles with terrain exaggeration
- **Intro animation** — route draws itself on load before the flythrough begins
- **Follow-cam** — camera tracks the marker along the trail, smoothly matching trail direction
- **Elevation profile** — live Chart.js chart with position dot
- **HUD stats** — distance, elevation, total gain, speed
- **Playback controls** — play/pause, reset, scrub slider, speed selector (0.25×–1.5×)
- **Map styles** — Satellite, Outdoor, Topo
- **Video export** — landscape 1280×720 (YouTube/Reels) or portrait 720×1280 (IG Story/TikTok)
  - 3 overlay themes: Default, Minimal, Bold
  - Export as `.webm` or `.mp4` (via ffmpeg.wasm)
- **PWA** — installable as a local app via browser "Install" prompt

---

## Stack

- [Vite](https://vitejs.dev/) — build tool / dev server
- [MapLibre GL JS](https://maplibre.org/) `v4.7.1` — 3D map rendering
- [Maptiler Cloud](https://www.maptiler.com/) — satellite tiles + terrain DEM
- [Chart.js](https://www.chartjs.org/) — elevation profile chart
- [@ffmpeg/ffmpeg](https://ffmpegwasm.netlify.app/) — client-side MP4 conversion
- Pure vanilla JS, ES modules, no framework

---

## Getting Started

### 1. Get a free Maptiler API key

Sign up at [cloud.maptiler.com](https://cloud.maptiler.com/account/keys) and create a free key.

In your key's **Allowed HTTP Origins**, add:
```
localhost
127.0.0.1
```

### 2. Clone and install

```bash
git clone https://github.com/Kruzikael014/trail-flythrough.git
cd trail-flythrough
npm install
```

### 3. Set your API key

```bash
cp .env.example .env
# Edit .env and set: VITE_MAPTILER_KEY=your_key_here
```

Or just paste it into the UI when the app asks — it saves to `localStorage`.

### 4. Run

```bash
npm run dev
# → http://localhost:5173
```

---

## Build for Production

```bash
npm run build
npm run preview
```

---

## Known Issues / Areas for Improvement

The camera system works well on open terrain, but there are some rough edges that would benefit from contributions:

- **Camera blocking** — ridges, hills, and higher ground can still obscure the view even with the current front-cam flip logic. A better terrain-aware camera that smoothly repositions itself around obstacles would be a great improvement.
- **Camera smoothness** — transitions, especially during sharp turns or the front-cam flip, could be smoother. Better interpolation or a proper camera spline would help a lot.
- `.webm` export is Chrome-only — Firefox MediaRecorder can produce broken output
- MP4 conversion via ffmpeg.wasm is slow (WASM overhead)
- Speed stat shows `—` when GPX has no timestamps
- No multi-track support (one GPX at a time)

---

## Contributing

Contributions are very welcome! Especially:

- Fixing or improving the **camera angle** so ridges and hills don't block the view
- Improving **camera smoothness** during turns and terrain transitions
- Any other improvements, bug fixes, or new features

Just open a pull request. No strict process — if it improves the project, it's welcome.

---

## License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).
