import { defineConfig } from 'vite';

const coopHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  preview: { headers: coopHeaders },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  optimizeDeps: {
    // ffmpeg packages use dynamic workers — don't pre-bundle them
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
