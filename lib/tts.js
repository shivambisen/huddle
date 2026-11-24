// Natural, human-sounding voices: Kokoro-82M, an open-weight neural TTS model
// (Apache 2.0) running locally. Free, private, no account. ~330 MB, downloaded once.
//
// Speed tricks so it feels live:
//  - replies are split into sentences, so the first one plays while the rest render;
//  - every sentence is cached, so audio made early (while an agent waits its
//    turn) is ready the moment it gets the floor.
import path from 'node:path';

export const NATURAL_VOICES = [
  { id: 'af_heart', label: 'Heart', accent: 'American', gender: 'female' },
  { id: 'am_michael', label: 'Michael', accent: 'American', gender: 'male' },
  { id: 'bf_emma', label: 'Emma', accent: 'British', gender: 'female' },
  { id: 'am_puck', label: 'Puck', accent: 'American', gender: 'male' },
  { id: 'af_bella', label: 'Bella', accent: 'American', gender: 'female' },
  { id: 'bm_george', label: 'George', accent: 'British', gender: 'male' },
  { id: 'af_nicole', label: 'Nicole (soft)', accent: 'American', gender: 'female' },
  { id: 'am_fenrir', label: 'Fenrir', accent: 'American', gender: 'male' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'British', gender: 'female' },
  { id: 'bm_fable', label: 'Fable', accent: 'British', gender: 'male' },
  { id: 'af_aoede', label: 'Aoede', accent: 'American', gender: 'female' },
  { id: 'am_eric', label: 'Eric', accent: 'American', gender: 'male' },
  { id: 'af_sarah', label: 'Sarah', accent: 'American', gender: 'female' },
  { id: 'bm_lewis', label: 'Lewis', accent: 'British', gender: 'male' },
];

const state = { status: 'idle', error: null, progress: 0 };
let loading = null;
let tts = null;
let chain = Promise.resolve(); // one synthesis at a time: they share the CPU
const cache = new Map(); // `${voice}|${text}` -> Promise<Buffer>

export const ttsStatus = () => ({ ...state });

export function warmTts(modelDir) {
  if (loading) return loading;
  state.status = 'loading'; state.error = null;
  loading = Promise.all([import('kokoro-js'), import('@huggingface/transformers')])
    .then(async ([{ KokoroTTS }, { env }]) => {
      env.cacheDir = path.join(modelDir, 'models');
      const files = {};
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'fp32', // faster than q8 on Apple Silicon CPUs
        device: 'cpu',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = [p.loaded, p.total];
            const v = Object.values(files);
            state.progress = Math.round((100 * v.reduce((a, x) => a + x[0], 0)) / v.reduce((a, x) => a + x[1], 0));
          }
        },
      });
      state.status = 'ready'; state.progress = 100;
      return tts;
    })
    .catch((e) => { state.status = 'error'; state.error = e.message; loading = null; throw e; });
  return loading;
}

// Split for speaking: sentences, with tiny fragments merged into their neighbour.
export function sentences(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  const out = [];
  for (const s of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (s.length < 18 || out.at(-1).length < 18)) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out;
}

export function synth(text, voice, modelDir) {
  const v = NATURAL_VOICES.some((x) => x.id === voice) ? voice : 'af_heart';
  const key = `${v}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const job = chain.then(async () => {
    const model = tts || (await warmTts(modelDir));
    const audio = await model.generate(text, { voice: v, speed: 1.05 });
    return Buffer.from(audio.toWav());
  });
  chain = job.catch(() => {});
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return job;
}
