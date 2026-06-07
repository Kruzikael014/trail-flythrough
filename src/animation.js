import { state } from './state.js';
import { haversine } from './utils.js';
import { updChart } from './chart.js';

export function getPosAt(t) {
  const n = state.pts.length;

  // Time-based mode: when first + last pts have timestamps, t maps linearly to time
  const t0 = state.pts[0]?.time, tn = state.pts[n - 1]?.time;
  if (t0 && tn) {
    const t0ms = t0.getTime(), tnms = tn.getTime();
    const totalMs = tnms - t0ms;
    if (totalMs > 0) {
      const targetMs = t0ms + t * totalMs;
      // Binary search: largest i where pts[i].time <= targetMs
      let lo = 0, hi = n - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const midMs = state.pts[mid].time?.getTime() ?? t0ms;
        if (midMs <= targetMs) lo = mid; else hi = mid - 1;
      }
      const i = lo;
      const iMs = state.pts[i].time?.getTime() ?? t0ms;
      const i1Ms = state.pts[i + 1].time?.getTime() ?? iMs;
      const segMs = i1Ms - iMs;
      const f = segMs > 0 ? (targetMs - iMs) / segMs : 0;
      return {
        lon: state.pts[i].lon + (state.pts[i + 1].lon - state.pts[i].lon) * f,
        lat: state.pts[i].lat + (state.pts[i + 1].lat - state.pts[i].lat) * f,
        ele: state.pts[i].ele + (state.pts[i + 1].ele - state.pts[i].ele) * f,
        i,
      };
    }
  }

  // Fallback: uniform distribution across point indices (no timestamps)
  const raw = t * (n - 1);
  const i = Math.min(n - 2, Math.floor(raw));
  const f = raw - i;
  return {
    lon: state.pts[i].lon + (state.pts[i + 1].lon - state.pts[i].lon) * f,
    lat: state.pts[i].lat + (state.pts[i + 1].lat - state.pts[i].lat) * f,
    ele: state.pts[i].ele + (state.pts[i + 1].ele - state.pts[i].ele) * f,
    i,
  };
}

export function getBearing(i) {
  // Look ahead proportionally (10–30 pts) for a stable, low-noise trail direction
  const lookAhead = Math.max(10, Math.min(30, Math.floor(state.pts.length / 40)));
  const j = Math.min(i + lookAhead, state.pts.length - 1);
  if (j === i) return state.camBear ?? (state.MAP?.getBearing() || 0);
  return (Math.atan2(state.pts[j].lon - state.pts[i].lon, state.pts[j].lat - state.pts[i].lat) * 180 / Math.PI + 360) % 360;
}

// Query terrain elevation at a [lng, lat] pair; returns null if unavailable
function elevAt(lng, lat) {
  try { return state.MAP.queryTerrainElevation([lng, lat]) ?? null; } catch { return null; }
}

// Look back up to 150 m along the route to compute a smooth slope grade.
// Returns rise/run ratio: positive = uphill, negative = downhill.
// Uses GPS elevation from pts[], so no extra terrain tile queries are needed.
function computeGrade(i) {
  if (state.pts.length < 2) return 0;
  let distM = 0, j = i;
  while (j > 0 && distM < 150) {
    distM += haversine(state.pts[j - 1], state.pts[j]) * 1000;
    j--;
  }
  if (distM < 5) return 0;
  return (state.pts[i].ele - state.pts[j].ele) / distM;
}

// Orbits 9 positions (every 45°) around the runner and picks the bearing offset
// where the camera sits on the lowest terrain relative to the runner.
//
// offsetPenalty controls how much we penalise being off-trail.
// Reduced when going steeply downhill so the camera willingly moves to the
// front/downhill side instead of staying behind (= inside the uphill slope).
//
// Returns { bestOffset, camRise }:
//   bestOffset — degrees to rotate viewing direction (−180..+180, 0 = normal behind)
//   camRise    — terrain height at the chosen camera position minus runner elevation
function findBestOrbitOffset(lon, lat, bearDeg, offsetPenalty = 0.4) {
  const runnerEle = elevAt(lon, lat);
  if (runnerEle === null) return { bestOffset: 0, camRise: 0 };
  const R = 6371000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const CAM_DIST = 280;

  let bestOffset = 0;
  let bestScore = Infinity;
  let bestCamRise = 0;

  for (let offset = -180; offset <= 135; offset += 45) {
    const camBearRad = ((bearDeg + offset + 180 + 720) % 360) * Math.PI / 180;
    const dLat = (CAM_DIST * Math.cos(camBearRad)) / R * (180 / Math.PI);
    const dLon = (CAM_DIST * Math.sin(camBearRad)) / R / cosLat * (180 / Math.PI);
    const camEle = elevAt(lon + dLon, lat + dLat);
    if (camEle === null) continue;

    const camRise = camEle - runnerEle;
    const score = Math.max(0, camRise) + Math.abs(offset) * offsetPenalty;
    if (score < bestScore) {
      bestScore   = score;
      bestOffset  = offset;
      bestCamRise = camRise;
    }
  }

  return { bestOffset, camRise: bestCamRise };
}

// Pitch stays cinematic (60–68°) at all times.
// The orbit moves the camera to a clear position — pitch doesn't need to compensate.
// Block-score adds a small bonus only for flat-terrain ridge bumps.
function calcTargetPitch(grade, blockScore) {
  const t = Math.min(1, blockScore / 2);
  return 60 + t * 8;   // 60° … 68°
}

// Zoom stays close — orbit handles terrain avoidance, not zoom.
function calcZoomOffset(grade, blockScore) {
  return -Math.min(0.8, blockScore / 2.5);  // 0 … −0.8
}

// Compute a reasonable initial follow-cam zoom from route length.
// Prevents over-zoom on short trails and cross-platform inconsistency.
function defaultCamZoom() {
  const km = state.totalDistKm;
  if (km < 2)  return 15.5 + 0.8;
  if (km < 5)  return 15 + 0.8;
  if (km < 15) return 14.5 + 0.8;
  return 14 + 0.8;
}

// dt defaults to 1/60 for calls outside the rAF tick (scrub, reset, etc.)
export function updateScene(t, dt = 1 / 60) {
  if (!state.MAP || !state.pts.length || !state.markerObj) return;
  const { lon, lat, ele, i } = getPosAt(t);
  state.markerObj.setLngLat([lon, lat]);
  const done = state.pts.slice(0, i + 1).map(p => [p.lon, p.lat]);
  done.push([lon, lat]);
  if (state.MAP.getSource('done-route')) {
    state.MAP.getSource('done-route').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: done },
    });
  }

  if (state.followMode) {
    const targetBearing = getBearing(i);
    const isInit = state.camBear === null;
    if (isInit) {
      state.camBear = targetBearing;
      state.camPitch = 60;
      state.camZoom = defaultCamZoom();
      state.camBearOffset = 0;
      state.blockScore = 0;
      // Zoom-adaptive forward offset — keeps the runner ~5-7% below screen centre
      // at any zoom level. Formula: 40m at zoom 16.75, doubles per zoom level out.
      const initLookM = Math.min(150, 40 * Math.pow(2, 16.75 - state.camZoom));
      const initBearRad = state.camBear * Math.PI / 180;
      const initCosLat  = Math.cos(lat * Math.PI / 180);
      const initCLon = lon + (initLookM * Math.sin(initBearRad)) / 6371000 / initCosLat * (180 / Math.PI);
      const initCLat = lat + (initLookM * Math.cos(initBearRad)) / 6371000 * (180 / Math.PI);

      // Smooth zoom-in from the intro's 3D overview to the start point.
      // Uses the same offset as the per-frame jumpTo so there is no jitter when
      // camEasing clears and the follow-cam takes over.
      state.camEasing = true;
      setTimeout(() => { state.camEasing = false; }, 1200);
      state.MAP.easeTo({
        center: [initCLon, initCLat],
        bearing: state.camBear,
        pitch: state.camPitch,
        zoom: state.camZoom,
        duration: 1200,
        easing: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
      });
    }

    // Per-frame camera tracking only once the initial ease-in is done
    if (!state.camEasing) {
      const msSinceRotate = Date.now() - state.userLastRotated;
      if (msSinceRotate > 2500) {
        // ── Slope grade + blockScore → orbit offset penalty ────────────────────
        const grade = computeGrade(i);
        // gradeSteep: 0 at flat, 1 at 40%+ downhill (raised from 25% to avoid
        // triggering the orbit on mild slopes at the closer zoom the user prefers)
        const gradeSteep  = Math.min(1, Math.max(0, -grade) / 0.40);
        const blockBias   = Math.min(1, state.blockScore / 1.2);
        const orbitBias   = Math.max(gradeSteep, blockBias);
        // Penalty 0.4 (default) → 0.08 (strongly biased) — less aggressive than
        // before (was ×0.83) to reduce false-positive orbiting at close zoom
        const offsetPenalty = Math.max(0.08, 0.4 * (1 - orbitBias * 0.72));

        // ── Orbit: find the camera position with least terrain blocking ──────────
        const { bestOffset, camRise } = findBestOrbitOffset(lon, lat, targetBearing, offsetPenalty);

        // ── Temporal block score ─────────────────────────────────────────────────
        const riseThreshold = 35;
        state.blockScore = camRise > riseThreshold
          ? Math.min(2, state.blockScore + dt)
          : Math.max(0, state.blockScore - dt * 0.8);

        // ── Orbit offset smoothing ────────────────────────────────────────────────
        const offsetAlpha = 1 - Math.pow(0.90, dt * 60);
        const offsetDelta = ((bestOffset - state.camBearOffset) + 540) % 360 - 180;
        state.camBearOffset += offsetDelta * offsetAlpha;
        state.camBearOffset = ((state.camBearOffset + 180) % 360) - 180;

        const effectiveBearing = (targetBearing + state.camBearOffset + 360) % 360;

        // ── Bearing smoothing — frame-rate independent ────────────────────────────
        const bearAlpha = 1 - Math.pow(0.95, dt * 60);
        const bearDelta = ((effectiveBearing - state.camBear) + 540) % 360 - 180;
        const bearStep = Math.max(-200 * dt, Math.min(200 * dt, bearDelta * bearAlpha));
        state.camBear = (state.camBear + bearStep + 360) % 360;

        // ── Pitch smoothing ──────────────────────────────────────────────────────
        const tgtPitch = calcTargetPitch(grade, state.blockScore);
        const pitchAlpha = 1 - Math.pow(0.94, dt * 60);
        const pitchStep = Math.max(-40 * dt, Math.min(40 * dt, (tgtPitch - state.camPitch) * pitchAlpha));
        state.camPitch += pitchStep;

        // ── Zoom ─────────────────────────────────────────────────────────────────
        const baseZoom = defaultCamZoom();
        const targetZoom = baseZoom + calcZoomOffset(grade, state.blockScore);
        if (!state.camZoom) state.camZoom = baseZoom;
        const zoomAlpha = 1 - Math.pow(0.94, dt * 60);
        state.camZoom += (targetZoom - state.camZoom) * zoomAlpha;

        // Centre shifted ahead in bearing direction → runner sits ~5-7% below screen
        // centre. Formula doubles per zoom level so the visual offset stays consistent.
        const LOOK_M  = Math.min(150, 40 * Math.pow(2, 16.75 - state.camZoom));
        const bearRad = state.camBear * Math.PI / 180;
        const cosLat2 = Math.cos(lat * Math.PI / 180);
        const cLon = lon + (LOOK_M * Math.sin(bearRad)) / 6371000 / cosLat2 * (180 / Math.PI);
        const cLat = lat + (LOOK_M * Math.cos(bearRad)) / 6371000 * (180 / Math.PI);
        state.MAP.jumpTo({ center: [cLon, cLat], bearing: state.camBear, pitch: state.camPitch, zoom: state.camZoom });
      } else {
        // User recently rotated — follow center only, preserve their camera
        state.camBear  = state.MAP.getBearing();
        state.camPitch = state.MAP.getPitch();
        state.camZoom  = state.MAP.getZoom();
        state.MAP.jumpTo({ center: [lon, lat] });
      }
    }
  }

  document.getElementById('he').textContent = Math.round(ele);
  document.getElementById('prog').value = Math.round(t * 1000);
  updChart(Math.min(state.pts.length - 1, Math.round(t * (state.pts.length - 1))));
  if (i > 0 && state.pts[i].time && state.pts[i - 1].time) {
    const d = haversine(state.pts[i - 1], state.pts[i]);
    const dt_h = (state.pts[i].time - state.pts[i - 1].time) / 3600000;
    document.getElementById('hs').textContent =
      dt_h > 0 ? Math.round(Math.min(999, d / dt_h) * 10) / 10 : '—';
  }
}

export function tick(ts) {
  state.rafId = requestAnimationFrame(tick);
  if (!state.playing || state.introRunning) return;
  if (state.lastTs === 0) { state.lastTs = ts; return; }
  const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
  state.lastTs = ts;
  // Fixed-speed playback: ~12 s/km at SPEED=1× (a 10 km trail takes ~2 min).
  // Completely independent of GPS point density or recorded pace data.
  // SPEED multiplier (0.25×–1.5×) scales this linearly; user can tune later.
  const SECS_PER_KM = 4;
  state.progress += dt * state.SPEED / (state.totalDistKm * SECS_PER_KM);
  if (state.progress >= 1) { state.progress = 1; stopPlay(); }
  updateScene(state.progress, dt);
}

export function togglePlay() { state.playing ? stopPlay() : startPlay(); }

export function startPlay() {
  state.introRunning = false;
  if (state.progress >= 0.999) doReset();
  state.playing = true;
  state.lastTs = 0;
  document.getElementById('bplay').textContent = '⏸';
}

export function stopPlay() {
  state.playing = false;
  document.getElementById('bplay').textContent = '▶';
}

export function doReset() {
  stopPlay();
  state.progress = 0;
  state.camBear = null;
  state.camPitch = null;
  state.camZoom = null;
  state.camBearOffset = 0;
  state.blockScore = 0;
  state.camEasing = false;     // cancel any in-progress ease so isInit can re-trigger it
  document.getElementById('prog').value = 0;
  if (state.pts.length) updateScene(0);
}

export function onScrub(t) {
  state.progress = t;
  updateScene(t);
}

export function toggleFollow() {
  state.followMode = !state.followMode;
  document.getElementById('bcam').classList.toggle('on', state.followMode);
  if (state.followMode) {
    state.camBear = null;
    state.camPitch = null;
    state.camZoom = null;
    state.camBearOffset = 0;
    state.blockScore = 0;
    state.camEasing = false;
    if (state.pts.length) updateScene(state.progress);
  }
}

export function fitAll() {
  if (!state.MAP || !state.pts.length) return;
  const lons = state.pts.map(p => p.lon);
  const lats = state.pts.map(p => p.lat);
  state.MAP.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: 90, pitch: 0, bearing: 0, duration: 1200, maxZoom: 13 },
  );
}
