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

// Samples terrain at 80 m, 165 m, and 250 m behind the marker; returns the MAX rise in metres.
// Checking multiple distances catches ridges anywhere along the camera-to-runner corridor,
// not just at the far point. Returns null only if ALL samples are unavailable.
function riseBehind(lon, lat, bearDeg) {
  const myEle = elevAt(lon, lat);
  if (myEle === null) return null;
  const R = 6371000;
  const bearRad = ((bearDeg + 180) % 360) * Math.PI / 180;
  const cosLat = Math.cos(lat * Math.PI / 180);
  let maxRise = null;
  for (const dist of [80, 165, 250]) {
    const dLat = (dist * Math.cos(bearRad)) / R * (180 / Math.PI);
    const dLon = (dist * Math.sin(bearRad)) / R / cosLat * (180 / Math.PI);
    const ele = elevAt(lon + dLon, lat + dLat);
    if (ele !== null) {
      const rise = ele - myEle;
      maxRise = maxRise === null ? rise : Math.max(maxRise, rise);
    }
  }
  return maxRise;
}

// Maps terrain rise behind the camera to an ideal pitch angle.
function pitchForRise(rise) {
  if (rise === null || rise <= 40) return 60;
  if (rise <= 100) return 64;
  if (rise <= 200) return 70;
  return 76;
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
      state.camFront = false;
      state.blockScore = 0;
    }

    const msSinceRotate = Date.now() - state.userLastRotated;
    if (msSinceRotate > 2500) {
      // ── Temporal block score ──────────────────────────────────────────────────
      // Accumulates when terrain behind is blocking (rise > 60 m), drains when clear.
      // Camera only flips to front after 1.5 s of sustained blocking — brief bumps
      // never trigger a switch, so the threshold can be low without causing jitter.
      const rise = riseBehind(lon, lat, targetBearing);
      if (rise !== null) {
        state.blockScore = rise > 60
          ? Math.min(2, state.blockScore + dt)       // build up
          : Math.max(0, state.blockScore - dt * 0.8); // drain a bit faster than it builds
      }
      if (!state.camFront && state.blockScore > 1.5) state.camFront = true;
      if (state.camFront  && state.blockScore < 0.3) state.camFront = false;

      const effectiveBearing = state.camFront ? (targetBearing + 180) % 360 : targetBearing;

      // ── Bearing smoothing — frame-rate independent ────────────────────────────
      // 1 - 0.95^(dt*60): at 60 fps dt=1/60 → alpha≈0.05; at 120 fps dt=1/120 → alpha≈0.025
      // Same convergence per real second regardless of refresh rate.
      const bearAlpha = 1 - Math.pow(0.95, dt * 60);
      const bearDelta = ((effectiveBearing - state.camBear) + 540) % 360 - 180;
      // Hard cap: max 180°/s (= 3°/frame at 60 fps) so large swings (front-cam flip) feel orbital
      const bearStep = Math.max(-180 * dt, Math.min(180 * dt, bearDelta * bearAlpha));
      state.camBear = (state.camBear + bearStep + 360) % 360;

      // ── Pitch smoothing — frame-rate independent ──────────────────────────────
      const targetPitch = state.camFront ? 55 : pitchForRise(rise);
      const pitchAlpha = 1 - Math.pow(0.94, dt * 60);
      // Hard cap: max 60°/s so pitch never snaps suddenly
      const pitchStep = Math.max(-60 * dt, Math.min(60 * dt, (targetPitch - state.camPitch) * pitchAlpha));
      state.camPitch += pitchStep;

      // jumpTo every rAF frame — no overlapping easeTo animations, true 60 fps
      state.MAP.jumpTo(isInit
        ? { center: [lon, lat], bearing: state.camBear, pitch: state.camPitch, zoom: 16 }
        : { center: [lon, lat], bearing: state.camBear, pitch: state.camPitch });
    } else {
      // User recently rotated — follow center only, preserve their bearing + pitch
      state.camBear = state.MAP.getBearing();
      state.camPitch = state.MAP.getPitch();
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
  state.progress += dt * state.SPEED * (1 / Math.max(8, state.pts.length / 20));
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
  state.camBear = null;  // re-init bearing + zoom + pitch on next updateScene
  state.camPitch = null;
  state.camFront = false;
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
    state.camBear = null;  // re-init on re-enable
    state.camPitch = null;
    state.camFront = false;
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
