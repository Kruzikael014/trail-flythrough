import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { state } from './state.js';
import { styleUrl } from './utils.js';
import { doReset, tick, updateScene, fitAll } from './animation.js';
import { showKeySection } from './main.js';

// MapLibre v4 removed the 'sky' layer type — use setFog() for atmosphere instead
function addAtmosphere() {
  state.MAP.setFog({
    color: 'rgb(186, 210, 235)',
    'high-color': 'rgb(36, 92, 223)',
    'horizon-blend': 0.02,
    'space-color': 'rgb(11, 11, 25)',
    'star-intensity': 0.6,
  });
}

// Add (or update) the terrain DEM source without throwing if it already exists in the style
function ensureTerrainSource() {
  if (!state.MAP.getSource('maptiler-dem')) {
    state.MAP.addSource('maptiler-dem', {
      type: 'raster-dem',
      url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${state.KEY}`,
      tileSize: 256,
      encoding: 'mapbox',
    });
  }
  state.MAP.setTerrain({ source: 'maptiler-dem', exaggeration: 1.8 });
}

// Right-click drag rotate reimplemented at ~35% of default sensitivity.
// Sets state.userLastRotated so the follow-cam bearing pauses while the user is rotating.
function setupSlowRotate() {
  const canvas = state.MAP.getCanvas();
  let drag = null;

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 2) return;
    drag = { x: e.clientX, y: e.clientY, bearing: state.MAP.getBearing(), pitch: state.MAP.getPitch() };
    state.userLastRotated = Date.now();
    e.preventDefault();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    state.MAP.setBearing(drag.bearing + dx * 0.15);
    state.MAP.setPitch(Math.max(0, Math.min(85, drag.pitch - dy * 0.25)));
    state.userLastRotated = Date.now(); // keep suppressing bearing follow throughout drag
  });
  window.addEventListener('mouseup', () => { drag = null; });
}

export function initMap() {
  if (state.MAP) {
    if (state.markerObj) { try { state.markerObj.remove(); } catch (e) {} state.markerObj = null; }
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    state.MAP.remove();
    state.MAP = null;
    state.routeReady = false;
  }
  const lons = state.pts.map(p => p.lon);
  const lats = state.pts.map(p => p.lat);
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  state.MAP = new maplibregl.Map({
    container: 'map',
    style: styleUrl('satellite', state.KEY),
    center: [cx, cy],
    zoom: 13,
    pitch: 60,
    bearing: 0,
    antialias: true,
    maxPitch: 85,
    preserveDrawingBuffer: true,
  });
  state.MAP.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  state.MAP.dragPan.disable();
  state.MAP.dragPan.enable({ linearity: 0.1, maxSpeed: 280, deceleration: 3000 });
  state.MAP.scrollZoom.setWheelZoomRate(1 / 450);
  state.MAP.dragRotate.disable();
  setupSlowRotate();

  // Only prevent going underground at very extreme pitch+zoom combos
  state.MAP.on('pitchend', () => {
    if (state.MAP.getPitch() > 80 && state.MAP.getZoom() > 16.5) {
      state.MAP.easeTo({ zoom: 16.5, duration: 300 });
    }
  });

  // once — prevent onMapLoad firing again if setTerrain/setFog triggers a style reload
  state.MAP.once('load', onMapLoad);
  state.MAP.on('error', e => {
    if (!e?.error?.status) return;
    console.error(e);
    document.getElementById('map-loader').style.display = 'none';
    showKeySection('⚠ Map error — check API key & allowed origins (localhost)');
  });
}

function onMapLoad() {
  document.getElementById('map-loader').style.display = 'none';
  document.getElementById('pills').style.display = 'flex';
  try {
    ensureTerrainSource();
    addAtmosphere();
  } catch (e) {
    console.error('[onMapLoad] terrain/fog setup failed:', e);
  }
  addRouteLayers();
  fitAll();
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.lastTs = 0;
  state.rafId = requestAnimationFrame(tick);
  runIntro();
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function runIntro() {
  state.introRunning = true;
  const DURATION = 3500;
  const coords = state.pts.map(p => [p.lon, p.lat]);
  const start = performance.now();

  function skipIntro() {
    state.introRunning = false;
    state.MAP.off('click', skipIntro);
    doReset();
  }
  state.MAP.on('click', skipIntro);

  function frame(now) {
    if (!state.introRunning) return;
    const t = Math.min(1, (now - start) / DURATION);
    const eased = easeInOut(t);

    const endIdx = Math.min(coords.length - 1, Math.floor(eased * coords.length));
    const drawn = coords.slice(0, Math.max(2, endIdx + 1));

    if (state.MAP.getSource('done-route')) {
      state.MAP.getSource('done-route').setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: drawn },
      });
    }

    const tip = drawn[drawn.length - 1];
    if (state.markerObj) state.markerObj.setLngLat([tip[0], tip[1]]);

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.introRunning = false;
      state.MAP.off('click', skipIntro);
      setTimeout(doReset, 800);
    }
  }

  requestAnimationFrame(frame);
}

function addRouteLayers() {
  if (!state.MAP || state.routeReady) return;
  state.routeReady = true;

  // Remove any stale layers/sources (e.g. from a previous style load that didn't clean up)
  ['full-route-glow', 'full-route-line', 'done-route-line'].forEach(id => {
    try { if (state.MAP.getLayer(id)) state.MAP.removeLayer(id); } catch (e) {}
  });
  ['full-route', 'done-route'].forEach(id => {
    try { if (state.MAP.getSource(id)) state.MAP.removeSource(id); } catch (e) {}
  });

  // 2D coords — lines drape on terrain automatically; z-elevation would appear underground with exaggeration
  const coords = state.pts.map(p => [p.lon, p.lat]);

  try {
    state.MAP.addSource('full-route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    });
    state.MAP.addLayer({
      id: 'full-route-glow', type: 'line', source: 'full-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.15, 'line-blur': 4 },
    });
    state.MAP.addLayer({
      id: 'full-route-line', type: 'line', source: 'full-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7c6fff', 'line-width': 3, 'line-opacity': 0.7 },
    });
    state.MAP.addSource('done-route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [coords[0], coords[0]] } },
    });
    state.MAP.addLayer({
      id: 'done-route-line', type: 'line', source: 'done-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff9f5a', 'line-width': 4, 'line-opacity': 1 },
    });
  } catch (e) {
    console.error('[addRouteLayers] failed to add sources/layers:', e);
    state.routeReady = false;
    return;
  }

  if (state.markerObj) { try { state.markerObj.remove(); } catch (e) {} }
  const el = document.createElement('div');
  el.style.cssText = 'width:20px;height:20px;background:#ff9f5a;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 12px rgba(255,159,90,.6)';
  try {
    state.markerObj = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([state.pts[0].lon, state.pts[0].lat])
      .addTo(state.MAP);
  } catch (e) {
    console.error('[addRouteLayers] failed to create marker:', e);
  }
}

export function switchStyle(s) {
  ['sat', 'out', 'top'].forEach(k => document.getElementById('p-' + k).classList.remove('on'));
  const m = { satellite: 'p-sat', 'outdoor-v2': 'p-out', 'topo-v2': 'p-top' };
  if (m[s]) document.getElementById(m[s]).classList.add('on');
  state.MAP.setStyle(styleUrl(s, state.KEY));
  state.MAP.once('style.load', () => {
    try {
      ensureTerrainSource();
      addAtmosphere();
    } catch (e) {
      console.error('[switchStyle] terrain/fog failed:', e);
    }
    state.routeReady = false;
    addRouteLayers();
    updateScene(state.progress);
  });
}
