export const state = {
  MAP: null,
  pts: [],
  elevChart: null,
  playing: false,
  progress: 0,
  SPEED: 1,
  followMode: true,
  rafId: null,
  lastTs: 0,
  markerObj: null,
  routeReady: false,
  KEY: '',
  exportFormat: 'landscape',
  mediaRecorder: null,
  recChunks: [],
  isRecording: false,
  containerFormat: 'webm',
  introRunning: false,
  overlayTheme: 'default',
  totalDistKm: 1,       // total route distance in km — set by calcStats(); used for fixed-speed tick
  camBear: null,        // exponentially-smoothed follow-cam bearing
  camPitch: null,       // exponentially-smoothed terrain-aware pitch
  camZoom: null,        // smoothed zoom — pulls back when terrain is blocking
  camBearOffset: 0,     // smooth lateral nudge (degrees) to peek around left/right ridges
  blockScore: 0,        // seconds of sustained terrain blocking — drives pitch/zoom avoidance
  userLastRotated: 0,   // timestamp of last manual rotation — pauses bearing/pitch follow
  camEasing: false,     // true while the initial easeTo zoom-in is running — blocks per-frame jumpTo
};
