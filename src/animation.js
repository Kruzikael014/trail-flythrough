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

// Orbits 9 positions (every 45°) around the runner and picks the bearing offset
// where the camera sits on the lowest terrain relative to the runner.
// This handles cone/ridge mountains correctly — when behind the runner (uphill) is
// blocked, the camera naturally orbits to the front or side where terrain is lower.
//
// Returns { bestOffset, camRise }:
//   bestOffset — degrees to rotate viewing direction (−180..+180, 0 = normal behind)
//   camRise    — terrain height at the chosen camera position minus runner elevation
//                (negative = camera is above runner terrain, positive = inside mountain)
function findBestOrbitOffset(lon, lat, bearDeg) {
  const runnerEle = elevAt(lon, lat);
  if (runnerEle === null) return { bestOffset: 0, camRise: 0 };
  const R = 6371000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const CAM_DIST = 280; // approx camera-to-runner ground distance in metres

  let bestOffset = 0;
  let bestScore = Infinity;
  let bestCamRise = 0;

  for (let offset = -180; offset <= 135; offset += 45) {
    // Camera sits opposite to the viewing direction:
    // view direction = bearDeg + offset → camera at bearDeg + offset + 180
    const camBearRad = ((bearDeg + offset + 180 + 720) % 360) * Math.PI / 180;
    const dLat = (CAM_DIST * Math.cos(camBearRad)) / R * (180 / Math.PI);
    const dLon = (CAM_DIST * Math.sin(camBearRad)) / R / cosLat * (180 / Math.PI);
    const camEle = elevAt(lon + dLon, lat + dLat);
    if (camEle === null) continue;

    const camRise = camEle - runnerEle;
    // Score: penalise high camera terrain + penalise large angle deviations from trail
    const score = Math.max(0, camRise) + Math.abs(offset) * 0.4;
    if (score < bestScore) {
      bestScore  = score;
      bestOffset = offset;
      bestCamRise = camRise;
    }
  }

  return { bestOffset, camRise: bestCamRise };
}

// Maps blockScore (0–2 s) to a target pitch angle.
// Raises pitch slightly to help clear nearby terrain once orbiting has settled.
// blockScore 0 → 60°, fully blocked (2+) → 68°  (modest raise, orbit does the heavy lifting)
function pitchForBlock(blockScore) {
  const t = Math.min(1, blockScore / 2);
  return 60 + t * 8;   // 60° … 68°
}

// Maps blockScore to a zoom offset. Pulls back a little when terrain is high,
// then smoothly returns to default (0 offset = zoom 16) as blockScore drains.
function zoomOffsetForBlock(blockScore) {
  return -Math.min(0.8, blockScore / 2.5);  // 0 … −0.8
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
      state.camZoom = 16;
      state.camBearOffset = 0;
      state.blockScore = 0;
    }

    const msSinceRotate = Date.now() - state.userLastRotated;
    if (msSinceRotate > 2500) {
      // ── Orbit: find the camera position with least terrain blocking ──────────────
      // Checks the terrain at the actual camera position (not just behind the runner).
      // On a cone/ridge mountain, this naturally orbits to the front or side where
      // the camera sits on lower ground instead of inside the mountain slope.
      const { bestOffset, camRise } = findBestOrbitOffset(lon, lat, targetBearing);

      // ── Temporal block score ──────────────────────────────────────────────────
      // Builds when camera terrain > runner terrain (camera is inside the mountain).
      // Threshold is zoom-dependent: zoomed in close → smaller rises trigger avoidance.
      //   Zoom 14 → 90 m   Zoom 16 → 60 m   Zoom 18 → 30 m
      const currentZoom = state.camZoom ?? 16;
      const riseThreshold = Math.max(20, 60 - (currentZoom - 16) * 15);
      state.blockScore = camRise > riseThreshold
        ? Math.min(2, state.blockScore + dt)         // build up (max 2 s)
        : Math.max(0, state.blockScore - dt * 0.8);  // drains → pitch/zoom return to default

      // ── Orbit offset smoothing — short-path interpolation ────────────────────
      // camBearOffset smoothly tracks bestOffset; uses short-path arc so it always
      // takes the tightest rotation (never spins the wrong way around).
      const offsetAlpha = 1 - Math.pow(0.92, dt * 60);
      const offsetDelta = ((bestOffset - state.camBearOffset) + 540) % 360 - 180;
      state.camBearOffset += offsetDelta * offsetAlpha;
      // Keep in [−180, +180] for clean arithmetic
      state.camBearOffset = ((state.camBearOffset + 180) % 360) - 180;

      const effectiveBearing = (targetBearing + state.camBearOffset + 360) % 360;

      // ── Bearing smoothing — frame-rate independent ────────────────────────────
      // alpha = 1 - 0.95^(dt*60): identical convergence at 60 Hz and 120 Hz.
      const bearAlpha = 1 - Math.pow(0.95, dt * 60);
      const bearDelta = ((effectiveBearing - state.camBear) + 540) % 360 - 180;
      // Hard cap: max 90°/s — tighter than before since we no longer need 180° swings
      const bearStep = Math.max(-90 * dt, Math.min(90 * dt, bearDelta * bearAlpha));
      state.camBear = (state.camBear + bearStep + 360) % 360;

      // ── Pitch smoothing — peeks over terrain as blockScore rises ──────────────
      const targetPitch = pitchForBlock(state.blockScore);
      const pitchAlpha = 1 - Math.pow(0.94, dt * 60);
      // Hard cap: max 40°/s — smooth raises, no sudden snaps
      const pitchStep = Math.max(-40 * dt, Math.min(40 * dt, (targetPitch - state.camPitch) * pitchAlpha));
      state.camPitch += pitchStep;

      // ── Zoom — pull back slightly when heavily blocked ────────────────────────
      const baseZoom = 16;
      const targetZoom = baseZoom + zoomOffsetForBlock(state.blockScore);
      if (!state.camZoom) state.camZoom = baseZoom;
      const zoomAlpha = 1 - Math.pow(0.94, dt * 60);
      state.camZoom += (targetZoom - state.camZoom) * zoomAlpha;

      // jumpTo every rAF frame — no overlapping easeTo animations, true 60 fps
      state.MAP.jumpTo(isInit
        ? { center: [lon, lat], bearing: state.camBear, pitch: state.camPitch, zoom: state.camZoom }
        : { center: [lon, lat], bearing: state.camBear, pitch: state.camPitch, zoom: state.camZoom });
    } else {
      // User recently rotated — follow center only, preserve their bearing + pitch + zoom
      state.camBear   = state.MAP.getBearing();
      state.camPitch  = state.MAP.getPitch();
      state.camZoom   = state.MAP.getZoom();
      state.MAP.jumpTo({ center: [lon, lat] });
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
  state.camBear = null;        // re-init bearing + zoom + pitch on next updateScene
  state.camPitch = null;
  state.camZoom = null;
  state.camBearOffset = 0;
  state.blockScore = 0;
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
    state.camBear = null;        // re-init on re-enable
    state.camPitch = null;
    state.camZoom = null;
    state.camBearOffset = 0;
    state.blockScore = 0;
    if (state.pts.length) updateScene(state.progress);
  }
}

export function fitAll() {
  if (!state.MAP || !state.pts.length) return;
  const lons = state.pts.map(p => p.lon);
  const lats = state.pts.map(p => p.lat);
  state.MAP.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: 60, pitch: 50, bearing: 0, duration: 1200 },
  );
}
