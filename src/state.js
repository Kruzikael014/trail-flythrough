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
  camBear: null,       // exponentially-smoothed follow-cam bearing
  camPitch: null,      // exponentially-smoothed terrain-aware pitch
  camFront: false,     // true when camera flips to face runner from front (terrain blocking from behind)
  blockScore: 0,       // seconds of sustained terrain blocking — drives front-cam switch
  userLastRotated: 0,  // timestamp of last manual rotation — pauses bearing/pitch follow
};
