// Voice in the meeting room.
//
// Speech out: the browser's speechSynthesis (free, offline, a different voice per agent).
// Speech in, two engines:
//   - "whisper": your mic → local Whisper on the Huddle server. Works in every browser.
//   - "browser": Chrome/Edge's built-in recognizer (live captions; sends audio to Google).
//
// Floor rules that keep the room orderly:
//  - Only one agent speaks at a time; the rest wait in a queue (shown as ✋).
//  - When you start talking, whoever is speaking stops and the queue waits for you.
//  - With open mic and no headphones, the mic pauses while an agent talks so
//    it never hears (and answers) the agents' own voices.
import { Mic, transcribe } from './mic.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// Brave exposes the API but has no speech service behind it, so it always fails.
export const browserSpeechWorks = !!SR && !navigator.brave && /Chrome|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent);

const store = {
  get: (k, d) => { try { return localStorage.getItem('huddle.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('huddle.' + k, v); } catch {} },
};

export function voices() {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => res(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
}

export function pickVoice(list, role, index) {
  if (role?.voice) { const v = list.find((x) => x.name === role.voice); if (v) return v; }
  const lang = (navigator.language || 'en').slice(0, 2);
  const pool = list.filter((v) => v.lang?.startsWith(lang));
  // Prefer the nicer system voices when present.
  const good = pool.filter((v) => /Samantha|Daniel|Karen|Moira|Tessa|Alex|Google|Natural|Premium|Enhanced|Aaron|Nicky/i.test(v.name));
  const use = good.length >= 2 ? good : pool;
  return use.length ? use[(index * 2 + 1) % use.length] : null;
}

// Natural (Kokoro) voices served by the Huddle server.
let naturalList = null;
export async function naturalVoices() {
  if (naturalList) return naturalList;
  try { naturalList = await (await fetch('/api/tts/voices')).json(); } catch { naturalList = []; }
  return naturalList;
}
// Same rule as the server: the role's pick, or a distinct default by position.
export function naturalVoiceFor(list, role, index) {
  if (role?.voice && list.some((v) => v.id === role.voice)) return role.voice;
  return list.length ? list[Math.max(0, index) % list.length].id : 'af_heart';
}
async function fetchSpeech(text, voice) {
  const r = await fetch('/api/tts/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) });
  if (!r.ok) throw new Error('Voice unavailable');
  return URL.createObjectURL(await r.blob());
}
async function splitSpeech(text, voice) {
  const r = await fetch('/api/tts/split', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) });
  if (!r.ok) throw new Error('Voice unavailable');
  return (await r.json()).parts;
}
// Play one clip of natural speech (used by previews too).
export async function previewNatural(text, voice) {
  const url = await fetchSpeech(text, voice);
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  await a.play();
  return a;
}

export class Voice {
  constructor(cb) {
    this.cb = cb;
    this.roles = cb.roles;
    this.natural = cb.voices !== 'system';
    naturalVoices().then((l) => (this.naturalList = l));
    this.engine = cb.engine === 'browser' && browserSpeechWorks ? 'browser' : 'whisper';
    this.supported = this.engine === 'browser' || !!navigator.mediaDevices?.getUserMedia;
    this.mode = store.get('mode', 'ptt');
    this.muted = store.get('muted', '0') === '1';
    this.headphones = store.get('headphones', '0') === '1';
    this.listening = false; // mic is capturing your words right now
    this.openOn = false;
    this.userTalking = false;
    this.transcribing = false;
    this.queue = [];
    this.current = null;
    this.voiceList = [];
    voices().then((v) => (this.voiceList = v));
    if (this.engine === 'browser') this.setupRec();
    else this.mic = new Mic({
      deviceId: cb.deviceId || store.get('mic', ''),
      onLevel: (l) => cb.onLevel?.(l),
      onSpeechStart: () => { this.listening = true; this.bargeIn(); cb.onState(); cb.onCaption('Listening…', false); },
      onSegment: (pcm) => this.gotSegment(pcm),
    });
  }

  // ---------- speech out ----------
  speak(id, text, front = false) {
    if (!window.speechSynthesis || !text) return;
    if (this.muted && !front) return;
    const item = { id, text };
    const pick = this.roles[id]?.voice;
    const wantsSystem = pick && this.naturalList && !this.naturalList.some((v) => v.id === pick);
    if (this.natural && !wantsSystem) item.clips = this.prepare(id, text);
    front ? this.queue.unshift(item) : this.queue.push(item);
    this.cb.onQueue(this.queue.map((q) => q.id));
    this.next();
  }

  // Start rendering every sentence now, so it's ready when this agent gets the floor.
  prepare(id, text) {
    const ids = Object.keys(this.roles);
    const voice = naturalVoiceFor(this.naturalList || [], this.roles[id], ids.indexOf(id));
    return splitSpeech(text, voice).then((parts) => parts.map((p) => fetchSpeech(p, voice)));
  }

  async playNatural(item, token) {
    const clips = await item.clips;
    for (const clip of clips) {
      const url = await clip;
      if (this.current !== token) return true;
      await new Promise((resolve, reject) => {
        const a = (this.audio = new Audio(url));
        a.onended = () => { URL.revokeObjectURL(url); resolve(); };
        a.onerror = () => reject(new Error('playback failed'));
        a.onpause = () => { if (this.current !== token) resolve(); };
        a.play().catch(reject);
      });
      if (this.current !== token) return true;
    }
    return true;
  }

  next() {
    if (this.current || this.userTalking || this.transcribing || !this.queue.length) {
      if (!this.current && !this.queue.length) this.resumeMic();
      return;
    }
    const item = this.queue.shift();
    this.cb.onQueue(this.queue.map((q) => q.id));
    if (item.clips) {
      const token = (this.current = { ...item });
      this.pauseMicForSpeech();
      this.cb.onSpeaking(item.id);
      this.playNatural(item, token)
        .catch(() => { if (this.current === token) { this.current = null; this.queue.unshift({ id: item.id, text: item.text }); } }) // fall back to system voice
        .finally(() => {
          if (this.current === token) this.current = null;
          this.audio = null;
          this.cb.onSpeaking(null);
          setTimeout(() => this.next(), 200);
        });
      return;
    }
    const u = new SpeechSynthesisUtterance(item.text);
    const ids = Object.keys(this.roles);
    const v = pickVoice(this.voiceList, this.roles[item.id], ids.indexOf(item.id));
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.05;
    const token = (this.current = { ...item });
    const finish = () => {
      if (this.current !== token) return;
      this.current = null;
      this.cb.onSpeaking(null);
      setTimeout(() => this.next(), 250);
    };
    u.onend = finish;
    u.onerror = finish;
    this.pauseMicForSpeech();
    this.cb.onSpeaking(item.id);
    speechSynthesis.cancel(); // clears a stuck queue (Safari/Chrome quirk)
    speechSynthesis.speak(u);
  }

  stopSpeaking() {
    if (!this.current) return;
    this.current = null;
    this.audio?.pause();
    speechSynthesis.cancel();
    this.cb.onSpeaking(null);
  }

  skip() { this.stopSpeaking(); this.next(); }

  setMuted(m) {
    this.muted = m; store.set('muted', m ? '1' : '0');
    if (m) { this.queue = []; this.cb.onQueue([]); this.stopSpeaking(); }
    this.cb.onState();
  }

  // You started talking: whoever is speaking yields; the queue waits for you.
  bargeIn() {
    this.userTalking = true;
    this.stopSpeaking();
  }

  // ---------- speech in (Whisper) ----------
  async ensureMic() {
    if (this.engine !== 'whisper' || this.mic.running) return true;
    try { await this.mic.start(); return true; }
    catch (e) {
      this.cb.onError(e.name === 'NotAllowedError' ? 'Microphone access is blocked. Click the mic icon in the address bar to allow it, then try again.' : e.message);
      return false;
    }
  }

  async gotSegment(pcm) {
    this.listening = false;
    this.cb.onState();
    if (!pcm) { this.userTalking = false; this.cb.onCaption('', true); this.next(); return; }
    this.transcribing = true;
    this.cb.onCaption('Transcribing…', false);
    try {
      const text = await transcribe(pcm);
      if (text) { this.cb.onCaption(text, true); this.cb.onUtterance(text); }
      else this.cb.onCaption("Didn't catch that", true);
    } catch (e) {
      this.cb.onError(e.message);
    } finally {
      this.transcribing = false;
      this.userTalking = false;
      this.next();
    }
  }

  // ---------- speech in (browser recognizer) ----------
  setupRec() {
    const rec = (this.rec = new SR());
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    this.buf = ''; this.interim = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.buf += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      this.interim = interim;
      const text = (this.buf + interim).trim();
      if (text && !this.userTalking) this.bargeIn();
      this.cb.onCaption(text, false);
      if (this.mode === 'open') { clearTimeout(this.silence); this.silence = setTimeout(() => this.flushRec(), 1400); }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.openOn = false; this.cb.onError('Microphone access is blocked. Allow it from the address bar.'); }
      else if (e.error === 'network') this.cb.onError('Browser speech service is unavailable. Switch to Local Whisper in Settings.');
    };
    rec.onend = () => {
      this.running = false;
      if (this.mode === 'ptt') { this.listening = false; this.flushRec(); this.cb.onState(); }
      else if (this.openOn && !this.micPaused) this.startRec();
      else { this.listening = false; this.cb.onState(); }
    };
  }
  startRec() { if (this.running) return; try { this.rec.start(); this.running = true; this.listening = true; this.cb.onState(); } catch {} }
  flushRec() {
    clearTimeout(this.silence);
    const text = (this.buf + (this.mode === 'ptt' ? this.interim : '')).trim();
    this.buf = ''; this.interim = '';
    this.userTalking = false;
    if (text) { this.cb.onCaption(text, true); this.cb.onUtterance(text); } else this.cb.onCaption('', true);
    this.next();
  }

  // ---------- controls ----------
  async pttStart() {
    if (this.listening || this.held) return;
    this.held = true;
    this.bargeIn();
    if (this.engine === 'browser') { this.buf = ''; this.interim = ''; this.startRec(); return; }
    const ok = await this.ensureMic();
    if (!ok || !this.held) { this.held = false; this.userTalking = false; this.next(); return; } // released before the mic was ready
    this.mic.vad = false;
    this.mic.paused = false;
    this.mic.begin();
    this.listening = true;
    this.cb.onCaption('Listening…', false);
    this.cb.onState();
  }
  pttEnd() {
    this.held = false;
    if (!this.listening) return;
    if (this.engine === 'browser') { try { this.rec.stop(); } catch {} return; }
    this.listening = false;
    this.mic.end();
    this.cb.onState();
  }

  async toggleOpen() {
    this.openOn = !this.openOn;
    if (this.engine === 'browser') {
      if (this.openOn) { this.micPaused = false; this.startRec(); } else { try { this.rec.stop(); } catch {} this.listening = false; }
    } else if (this.openOn) {
      if (!(await this.ensureMic())) { this.openOn = false; }
      else { this.mic.vad = true; this.mic.paused = !!this.current && !this.headphones; }
    } else {
      this.mic.vad = false;
      if (this.mic.recording) this.mic.end();
      this.listening = false;
    }
    this.cb.onState();
  }

  setMode(m) {
    if (this.openOn) this.toggleOpen();
    this.mode = m; store.set('mode', m);
    this.listening = false;
    this.cb.onState();
  }

  setHeadphones(on) { this.headphones = on; store.set('headphones', on ? '1' : '0'); }

  // Without headphones the mic would hear the agent's voice, so mute it while they talk.
  pauseMicForSpeech() {
    if (this.mode !== 'open' || !this.openOn || this.headphones) return;
    this.micPaused = true;
    if (this.engine === 'browser') { try { this.rec.abort(); } catch {} }
    else this.mic.paused = true;
  }
  resumeMic() {
    if (!this.micPaused) return;
    this.micPaused = false;
    if (this.engine === 'browser') { if (this.openOn) this.startRec(); }
    else this.mic.paused = false;
  }

  destroy() {
    this.openOn = false;
    this.queue = [];
    try { this.rec?.abort(); } catch {}
    this.mic?.stop();
    this.current = null;
    this.audio?.pause();
    window.speechSynthesis?.cancel();
  }
}
