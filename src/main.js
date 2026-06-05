import './style.css';
import { state } from './state.js';
import { haversine } from './utils.js';
import { loadFile } from './gpx.js';
import { buildChart } from './chart.js';
import { initMap, switchStyle } from './map.js';
import { togglePlay, doReset, onScrub, toggleFollow, fitAll } from './animation.js';
import { selectFormat, toggleRecord } from './recording.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW register failed:', err));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const envKey = import.meta.env.VITE_MAPTILER_KEY || '';

  if (envKey) {
    // Env key takes priority — use silently, sidebar stays hidden
    state.KEY = envKey;
  } else {
    // No env key — show sidebar so user can enter it
    showSidebar();
    const saved = localStorage.getItem('maptiler_key') || '';
    if (saved) {
      state.KEY = saved;
      document.getElementById('key-input').value = saved;
      // Key already saved — collapse the section so it's out of the way
      document.getElementById('key-section').classList.add('collapsed');
    }
  }

  bindEvents();
});

function showSidebar() {
  document.getElementById('app').classList.add('with-sidebar');
}

export function showKeySection(errorMsg) {
  showSidebar();
  const section = document.getElementById('key-section');
  section.classList.remove('collapsed'); // always expand for errors
  if (errorMsg) document.getElementById('key-err').textContent = errorMsg;
}

function saveKey() {
  const k = document.getElementById('key-input').value.trim();
  if (!k) { document.getElementById('key-err').textContent = 'Please enter your API key.'; return; }
  state.KEY = k;
  localStorage.setItem('maptiler_key', k);
  document.getElementById('key-err').textContent = '';
  document.getElementById('key-section').style.display = 'none';
}

function go(name) {
  if (!state.KEY) { showKeySection('Enter your API key first.'); return; }
  showSidebar();
  document.getElementById('drop-screen').style.display = 'none';
  document.getElementById('trail-info').style.display = 'block';
  document.getElementById('map-loader').style.display = 'flex';
  document.getElementById('tname').textContent = name;
  calcStats();
  buildChart();
  initMap();
}

function calcStats() {
  let d = 0, g = 0;
  for (let i = 1; i < state.pts.length; i++) {
    d += haversine(state.pts[i - 1], state.pts[i]);
    const dh = state.pts[i].ele - state.pts[i - 1].ele;
    if (dh > 0) g += dh;
  }
  state.totalDistKm = Math.max(0.1, d); // guard against zero-distance edge case
  document.getElementById('hd').textContent = d.toFixed(2);
  document.getElementById('hg').textContent = Math.round(g);
  const first = state.pts[0], last = state.pts[state.pts.length - 1];
  const dur = first?.time && last?.time
    ? ((last.time - first.time) / 3600000).toFixed(1) + 'h'
    : '—';
  document.getElementById('tsub').textContent = `${state.pts.length} points · ${dur}`;
}

function bindEvents() {
  const fileInput = document.getElementById('file-input');
  const fileInput2 = document.getElementById('file-input2');
  const dropBox = document.getElementById('drop-box');

  // Drop zone
  dropBox.addEventListener('click', () => fileInput.click());
  dropBox.addEventListener('dragover', e => { e.preventDefault(); dropBox.classList.add('drag'); });
  dropBox.addEventListener('dragleave', () => dropBox.classList.remove('drag'));
  dropBox.addEventListener('drop', e => {
    e.preventDefault();
    dropBox.classList.remove('drag');
    loadFile(e.dataTransfer.files[0], go);
  });

  document.getElementById('choose-gpx-btn').addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0], go));
  fileInput2.addEventListener('change', () => loadFile(fileInput2.files[0], go));

  // Key setup
  document.getElementById('save-key-btn').addEventListener('click', saveKey);
  document.getElementById('key-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });

  // Playback controls
  document.getElementById('bplay').addEventListener('click', togglePlay);
  document.getElementById('breset').addEventListener('click', doReset);
  document.getElementById('prog').addEventListener('input', e => onScrub(+e.target.value / 1000));
  document.getElementById('speed-select').addEventListener('change', e => { state.SPEED = +e.target.value; });
  document.getElementById('bcam').addEventListener('click', toggleFollow);
  document.getElementById('boverview').addEventListener('click', fitAll);
  document.getElementById('load-new-btn').addEventListener('click', () => fileInput2.click());

  // Map style pills
  document.querySelectorAll('.pill[data-style]').forEach(pill => {
    pill.addEventListener('click', () => switchStyle(pill.dataset.style));
  });

  // Export format buttons
  document.querySelectorAll('.format-btn[data-format]').forEach(btn => {
    btn.addEventListener('click', () => selectFormat(btn.dataset.format));
  });
  document.getElementById('container-format').addEventListener('change', e => {
    state.containerFormat = e.target.value;
  });
  document.getElementById('overlay-theme').addEventListener('change', e => {
    state.overlayTheme = e.target.value;
  });
  document.getElementById('rec-btn').addEventListener('click', toggleRecord);

  // Collapsible section toggles
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.collapsible-section').classList.toggle('collapsed');
    });
  });
}
