import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let instance = null;

// Lazily loads ffmpeg-core from CDN (only fetched when first MP4 export is triggered)
async function getFFmpeg(onProgress) {
  if (instance) return instance;
  instance = new FFmpeg();
  if (onProgress) instance.on('progress', onProgress);
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await instance.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return instance;
}

export async function webmToMp4(webmBlob, onProgress) {
  const ff = await getFFmpeg(onProgress);
  await ff.writeFile('input.webm', await fetchFile(webmBlob));
  await ff.exec([
    '-i', 'input.webm',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    'output.mp4',
  ]);
  const data = await ff.readFile('output.mp4');
  return new Blob([data.buffer], { type: 'video/mp4' });
}
