import { state } from './state.js';
import { getPosAt, doReset, startPlay, stopPlay } from './animation.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setStatus(text) {
  document.getElementById('rec-status').textContent = text;
}

// ─── OVERLAY THEMES ───────────────────────────────────────────────────────────

function drawOverlayDefault(ctx, W, H, isPortrait, progress) {
  const p = getPosAt(progress);
  const bx = 24, by = H - 130, bw = isPortrait ? W - 48 : 400, bh = 110;

  // Gradient vignette
  const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
  grad.addColorStop(0, 'rgba(10,10,15,0)');
  grad.addColorStop(1, 'rgba(10,10,15,0.85)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Card
  ctx.fillStyle = 'rgba(10,10,15,0.6)';
  ctx.beginPath();
  roundRect(ctx, bx, by, bw, bh, 12);
  ctx.fill();

  // Trail name
  ctx.fillStyle = '#f0eeff';
  ctx.font = `700 ${isPortrait ? 28 : 22}px Syne,sans-serif`;
  const name = document.getElementById('tname').textContent;
  ctx.fillText(name.length > 30 ? name.slice(0, 30) + '…' : name, bx + 18, by + 36);

  // Stats line
  ctx.font = `400 ${isPortrait ? 20 : 15}px DM Mono,monospace`;
  ctx.fillStyle = '#6b6b8a';
  const distVal = document.getElementById('hd').textContent;
  const gainVal = document.getElementById('hg').textContent;
  ctx.fillText(
    `${distVal} km  ·  +${gainVal}m gain  ·  ${Math.round(p.ele || 0)}m elev`,
    bx + 18, by + 66,
  );

  // Progress bar
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, bx + 18, by + 82, bw - 36, 6, 3); ctx.fill();
  ctx.fillStyle = '#7c6fff';
  roundRect(ctx, bx + 18, by + 82, Math.max(6, (bw - 36) * progress), 6, 3); ctx.fill();

  // Watermark
  ctx.font = `600 ${isPortrait ? 16 : 13}px Syne,sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('Trail Flythrough', W - (isPortrait ? 160 : 140), H - 16);
}

function drawOverlayMinimal(ctx, W, H, isPortrait, progress) {
  // Thin bottom gradient only
  const grad = ctx.createLinearGradient(0, H * 0.8, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Trail name only
  const name = document.getElementById('tname').textContent;
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${isPortrait ? 24 : 18}px Syne,sans-serif`;
  ctx.fillText(name.length > 36 ? name.slice(0, 36) + '…' : name, 24, H - 40);

  // Thin progress bar at very bottom
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = '#7c6fff';
  ctx.fillRect(0, H - 6, W * progress, 6);
}

function drawOverlayBold(ctx, W, H, isPortrait, progress) {
  const p = getPosAt(progress);
  const name = document.getElementById('tname').textContent;
  const distVal = document.getElementById('hd').textContent;
  const gainVal = document.getElementById('hg').textContent;
  const eleVal = Math.round(p.ele || 0);
  const padX = 32;

  // Full-width dark band at bottom
  const bandH = isPortrait ? 200 : 160;
  ctx.fillStyle = 'rgba(10,10,15,0.82)';
  ctx.fillRect(0, H - bandH, W, bandH);

  // Accent bar on left edge
  ctx.fillStyle = '#7c6fff';
  ctx.fillRect(0, H - bandH, 5, bandH);

  // Trail name — large
  ctx.fillStyle = '#f0eeff';
  ctx.font = `800 ${isPortrait ? 38 : 30}px Syne,sans-serif`;
  const displayName = name.length > 28 ? name.slice(0, 28) + '…' : name;
  ctx.fillText(displayName, padX + 16, H - bandH + (isPortrait ? 52 : 42));

  // Stats row — three pill boxes
  const stats = [
    { label: 'KM', value: distVal },
    { label: 'GAIN', value: `+${gainVal}m` },
    { label: 'ELEV', value: `${eleVal}m` },
  ];
  const pillW = isPortrait ? 140 : 110;
  const pillH = isPortrait ? 56 : 44;
  const pillY = H - bandH + (isPortrait ? 76 : 60);
  stats.forEach((s, idx) => {
    const px = padX + 16 + idx * (pillW + 12);
    ctx.fillStyle = 'rgba(124,111,255,0.18)';
    roundRect(ctx, px, pillY, pillW, pillH, 8); ctx.fill();
    ctx.fillStyle = '#7c6fff';
    ctx.font = `400 ${isPortrait ? 11 : 9}px DM Mono,monospace`;
    ctx.fillText(s.label, px + 10, pillY + (isPortrait ? 18 : 14));
    ctx.fillStyle = '#f0eeff';
    ctx.font = `700 ${isPortrait ? 22 : 17}px Syne,sans-serif`;
    ctx.fillText(s.value, px + 10, pillY + (isPortrait ? 44 : 34));
  });

  // Progress bar
  const barY = H - (isPortrait ? 28 : 22);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, padX + 16, barY, W - (padX + 16) * 2, isPortrait ? 8 : 6, 3); ctx.fill();
  ctx.fillStyle = '#ff9f5a';
  roundRect(ctx, padX + 16, barY, Math.max(6, (W - (padX + 16) * 2) * progress), isPortrait ? 8 : 6, 3); ctx.fill();

  // Watermark top-right
  ctx.font = `600 ${isPortrait ? 15 : 12}px Syne,sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('Trail Flythrough', W - (isPortrait ? 170 : 145), 28);
}

const overlayDrawers = {
  default: drawOverlayDefault,
  minimal: drawOverlayMinimal,
  bold: drawOverlayBold,
};

// ─── EXPORT FORMAT / RECORDING ────────────────────────────────────────────────

export function selectFormat(f) {
  state.exportFormat = f;
  document.getElementById('fmt-landscape').classList.toggle('selected', f === 'landscape');
  document.getElementById('fmt-portrait').classList.toggle('selected', f === 'portrait');
}

export function toggleRecord() {
  if (state.isRecording) stopRecording();
  else startRecording();
}

export function startRecording() {
  if (!state.pts.length) { alert('Load a GPX first.'); return; }
  if (!state.MAP) { alert('Map not ready.'); return; }

  const isPortrait = state.exportFormat === 'portrait';
  const W = isPortrait ? 720 : 1280, H = isPortrait ? 1280 : 720;
  const wantsMp4 = state.containerFormat === 'mp4';
  const drawOverlay = overlayDrawers[state.overlayTheme] || overlayDrawers.default;

  const recCanvas = document.getElementById('rec-canvas');
  recCanvas.width = W; recCanvas.height = H;
  const ctx = recCanvas.getContext('2d');

  if (!recCanvas.captureStream) {
    alert('Your browser does not support canvas recording. Use Chrome.');
    return;
  }

  const savedSpeed = state.SPEED;
  const savedFollow = state.followMode;

  doReset();
  state.followMode = true;
  state.SPEED = 1;

  // For portrait: resize MapLibre canvas off-screen to 720×1280, then restore after
  let savedMapColStyle = '';
  if (isPortrait) {
    const mapCol = document.getElementById('map-col');
    savedMapColStyle = mapCol.getAttribute('style') || '';
    Object.assign(mapCol.style, {
      position: 'fixed',
      top: '0',
      left: '-9999px',
      width: '720px',
      height: '1280px',
      zIndex: '0',
    });
    state.MAP.resize();
  }

  const stream = recCanvas.captureStream(30);
  state.recChunks = [];
  const preferredTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
  state.mediaRecorder = new MediaRecorder(stream, {
    ...(mimeType && { mimeType }),
    videoBitsPerSecond: 8000000,
  });
  state.mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) state.recChunks.push(e.data);
  };
  state.mediaRecorder.onstop = async () => {
    cancelAnimationFrame(recRafRef.id);

    if (isPortrait) {
      const mapCol = document.getElementById('map-col');
      mapCol.setAttribute('style', savedMapColStyle);
      state.MAP.resize();
    }

    state.SPEED = savedSpeed;
    state.followMode = savedFollow;
    document.getElementById('rec-btn').textContent = '⏺ Start Recording';
    document.getElementById('rec-btn').classList.remove('recording');
    state.isRecording = false;

    const webmBlob = new Blob(state.recChunks, { type: 'video/webm' });
    const baseName = `trail-${state.exportFormat}-${Date.now()}`;

    if (wantsMp4) {
      setStatus('Loading ffmpeg (first time may take a moment)…');
      try {
        const { webmToMp4 } = await import('./ffmpeg.js');
        const mp4Blob = await webmToMp4(webmBlob, ({ progress }) => {
          const pct = Math.round(progress * 100);
          setStatus(pct >= 0 && pct <= 100 ? `Converting to MP4… ${pct}%` : 'Converting to MP4…');
        });
        downloadBlob(mp4Blob, `${baseName}.mp4`);
        setStatus('✅ MP4 saved!');
      } catch (err) {
        console.error('MP4 conversion failed:', err);
        downloadBlob(webmBlob, `${baseName}.webm`);
        setStatus('⚠ MP4 failed — saved as WebM instead.');
      }
    } else {
      downloadBlob(webmBlob, `${baseName}.webm`);
      setStatus('✅ Video saved!');
    }
  };

  const recRafRef = { id: null };

  function drawFrame() {
    if (!state.isRecording) return;
    const mapCanvas = document.querySelector('#map canvas');
    if (!mapCanvas) { recRafRef.id = requestAnimationFrame(drawFrame); return; }

    ctx.clearRect(0, 0, W, H);
    try {
      ctx.drawImage(mapCanvas, 0, 0, W, H);
    } catch (e) { console.warn('[rec] drawImage failed:', e); }

    drawOverlay(ctx, W, H, isPortrait, state.progress);

    recRafRef.id = requestAnimationFrame(drawFrame);
  }

  state.mediaRecorder.start(100);
  state.isRecording = true;

  document.getElementById('rec-btn').textContent = '⏹ Stop Recording';
  document.getElementById('rec-btn').classList.add('recording');
  setStatus(`Recording ${W}×${H} (${state.overlayTheme} theme)…`);

  setTimeout(() => {
    drawFrame();
    startPlay();
  }, isPortrait ? 400 : 0);

  const checkDone = setInterval(() => {
    if (state.progress >= 0.999) { clearInterval(checkDone); setTimeout(stopRecording, 800); }
  }, 500);
}

export function stopRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;
  stopPlay();
  state.mediaRecorder.stop();
  setStatus('Processing video…');
}
