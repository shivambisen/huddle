// Free, private speech-to-text: Whisper running locally in Node (transformers.js +
// onnxruntime). Works no matter which browser you use (Brave, Safari, Firefox,
// Chrome). The model downloads once (~75 MB) into data/models.
import path from 'node:path';

const MODELS = {
  accurate: 'Xenova/whisper-base.en',
  fast: 'Xenova/whisper-tiny.en',
};

const state = { status: 'idle', model: null, error: null, progress: 0 };
let loading = null;
let asr = null;

// Whisper "hears" these in silence or noise.
const JUNK = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|okay\.?)$/i;

export function sttStatus() { return { ...state }; }

export function warm(dataDir, quality = 'accurate') {
  const name = MODELS[quality] || MODELS.accurate;
  if (state.model === name && (loading || asr)) return loading || Promise.resolve(asr);
  state.status = 'loading'; state.model = name; state.error = null; state.progress = 0;
  loading = import('@huggingface/transformers')
    .then(async ({ pipeline, env }) => {
      env.cacheDir = path.join(dataDir, 'models');
      const files = {};
      asr = await pipeline('automatic-speech-recognition', name, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = [p.loaded, p.total];
            const v = Object.values(files);
            state.progress = Math.round((100 * v.reduce((a, x) => a + x[0], 0)) / v.reduce((a, x) => a + x[1], 0));
          }
        },
      });
      state.status = 'ready'; state.progress = 100;
      return asr;
    })
    .catch((e) => { state.status = 'error'; state.error = e.message; loading = null; asr = null; throw e; });
  return loading;
}

// pcm: Float32Array, mono, 16 kHz
export async function transcribe(pcm, dataDir) {
  const model = asr || (await warm(dataDir));
  const t = Date.now();
  const out = await model(pcm);
  const text = String(out?.text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [BLANK_AUDIO], (music)
    .replace(/\s+/g, ' ')
    .trim();
  return { text: JUNK.test(text) ? '' : text, ms: Date.now() - t };
}
