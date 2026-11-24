// Free, keyless voice: the browser's own SpeechRecognition (speech-to-text) and
// speechSynthesis (text-to-speech).
//
// The "floor" rules that keep the room orderly:
//  - Only one agent speaks at a time; the rest wait in a queue (shown as ✋).
//  - When you start talking, whoever is speaking stops and the queue pauses
//    until you finish.
//  - In open-mic mode without headphones, the mic is paused while an agent
//    talks, so the agents never hear (and answer) each other's voices.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const store = {
  get: (k, d) => { try { return localStorage.getItem('huddle.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('huddle.' + k, v); } catch {} },
};

export class Voice {
  static voices() {
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

  constructor(cb) {
    this.cb = cb;
    this.roles = cb.roles;
    this.supported = !!SR;
    this.mode = store.get('mode', 'ptt');
    this.muted = store.get('muted', '0') === '1';
    this.headphones = store.get('headphones', '0') === '1';
    this.listening = false;
    this.openOn = false;
    this.userTalking = false;
    this.queue = [];
    this.current = null;
    this.buf = '';
    this.interim = '';
    this.voiceList = [];
    Voice.voices().then((v) => (this.voiceList = v));
    if (this.supported) this.setupRec();
  }

  // ---------- speech out ----------
  pickVoice(id) {
    const role = this.roles[id];
    const list = this.voiceList;
    if (role?.voice) { const v = list.find((x) => x.name === role.voice); if (v) return v; }
    const lang = (navigator.language || 'en').slice(0, 2);
    const pool = list.filter((v) => v.lang?.startsWith(lang)).filter((v) => !/Google.*(UK|US) English$/.test(v.name) || true);
    if (!pool.length) return null;
    const ids = Object.keys(this.roles);
    return pool[(ids.indexOf(id) * 3 + 1) % pool.length];
  }

  speak(id, text, front = false) {
    if (!window.speechSynthesis || !text) return;
    if (this.muted && !front) return;
    const item = { id, text };
    front ? this.queue.unshift(item) : this.queue.push(item);
    this.cb.onQueue(this.queue.map((q) => q.id));
    this.next();
  }

  next() {
    if (this.current || this.userTalking || !this.queue.length) {
      if (!this.current && !this.queue.length) this.resumeMic();
      return;
    }
    const item = this.queue.shift();
    this.cb.onQueue(this.queue.map((q) => q.id));
    const u = new SpeechSynthesisUtterance(item.text);
    const v = this.pickVoice(item.id);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.05;
    const token = (this.current = { ...item, u });
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
    speechSynthesis.speak(u);
  }

  stopSpeaking() {
    if (!this.current) return;
    const id = this.current;
    this.current = null;
    speechSynthesis.cancel();
    this.cb.onSpeaking(null);
    return id;
  }

  skip() { this.stopSpeaking(); this.next(); }

  setMuted(m) {
    this.muted = m; store.set('muted', m ? '1' : '0');
    if (m) { this.queue = []; this.cb.onQueue([]); this.stopSpeaking(); }
    this.cb.onState();
  }

  // ---------- speech in ----------
  setupRec() {
    const rec = (this.rec = new SR());
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.buf += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      this.interim = interim;
      const text = (this.buf + interim).trim();
      if (text) this.bargeIn();
      this.cb.onCaption(text, false);
      if (this.mode === 'open') {
        clearTimeout(this.silence);
        this.silence = setTimeout(() => this.flush(), 1400);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.openOn = false; this.cb.onError('Microphone permission was blocked.'); }
      else if (e.error === 'network') this.cb.onError('Speech recognition needs an internet connection in this browser.');
    };
    rec.onend = () => {
      this.running = false;
      if (this.mode === 'ptt') { this.listening = false; this.flush(); this.cb.onState(); }
      else if (this.openOn && !this.micPaused) this.startRec();
      else { this.listening = false; this.cb.onState(); }
    };
  }

  startRec() {
    if (this.running) return;
    try { this.rec.start(); this.running = true; this.listening = true; this.cb.onState(); } catch {}
  }

  // You started talking: whoever is speaking yields, and the queue waits for you.
  bargeIn() {
    if (this.userTalking) return;
    this.userTalking = true;
    this.stopSpeaking(); // the interrupted line is dropped; the rest of the queue waits
  }

  flush() {
    clearTimeout(this.silence);
    const text = (this.buf + (this.mode === 'ptt' ? this.interim : '')).trim();
    this.buf = ''; this.interim = '';
    this.userTalking = false;
    if (text) { this.cb.onCaption(text, true); this.cb.onUtterance(text); }
    else this.cb.onCaption('', true);
    this.next();
  }

  pttStart() {
    if (!this.supported || this.running) return;
    this.userTalking = true;
    this.stopSpeaking();
    this.buf = ''; this.interim = '';
    this.startRec();
  }
  pttEnd() { try { this.rec.stop(); } catch {} }

  toggleOpen() {
    this.openOn = !this.openOn;
    if (this.openOn) { this.micPaused = false; this.startRec(); }
    else { try { this.rec.stop(); } catch {} this.listening = false; }
    this.cb.onState();
  }

  setMode(m) {
    this.mode = m; store.set('mode', m);
    this.openOn = false;
    try { this.rec.abort(); } catch {}
    this.listening = false;
    this.cb.onState();
  }

  setHeadphones(on) { this.headphones = on; store.set('headphones', on ? '1' : '0'); }

  // Without headphones the mic would hear the agent's voice, so mute it while they talk.
  pauseMicForSpeech() {
    if (this.mode !== 'open' || !this.openOn || this.headphones) return;
    this.micPaused = true;
    try { this.rec.abort(); } catch {}
  }
  resumeMic() {
    if (!this.micPaused) return;
    this.micPaused = false;
    if (this.openOn) this.startRec();
  }

  destroy() {
    this.openOn = false;
    this.queue = [];
    try { this.rec?.abort(); } catch {}
    window.speechSynthesis?.cancel();
  }
}
