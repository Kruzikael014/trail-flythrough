import { state } from './state.js';

export function loadFile(f, onDone) {
  if (!f) return;
  const r = new FileReader();
  r.onload = e => parseGPX(e.target.result, f.name, onDone);
  r.readAsText(f);
}

export function parseGPX(txt, fname, onDone) {
  const doc = new DOMParser().parseFromString(txt, 'text/xml');
  const nodes = [...doc.querySelectorAll('trkpt,wpt')];
  if (!nodes.length) { alert('No track points found in this GPX.'); return; }
  state.pts = nodes.map(n => ({
    lat: +n.getAttribute('lat'),
    lon: +n.getAttribute('lon'),
    ele: +(n.querySelector('ele')?.textContent || 0),
    time: n.querySelector('time') ? new Date(n.querySelector('time').textContent) : null,
  }));
  const name = doc.querySelector('name')?.textContent || fname.replace(/\.gpx$/i, '');
  onDone(name);
}
