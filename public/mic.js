// Microphone capture that works in every browser (Brave, Safari, Firefox, Chrome).
// Produces 16 kHz mono Float32 segments for the local Whisper server, plus a
// live level for meters. Two ways to cut segments:
//  - push to talk: begin() … end()
//  - open mic: a simple voice-activity detector starts a segment when you
//    speak and ends it after a short silence.
const TARGET_RATE = 16000;

export class Mic {
  constructor({ deviceId = '', onLevel = () => {}, onSpeechStart = () => {}, onSegment = () => {} } = {}) {
    Object.assign(this, { deviceId, onLevel, onSpeechStart, onSegment });
    this.vad = false;
    this.paused = false;
    this.recording = false;
    this.chunks = [];
    this.preroll = [];
    this.noise = 0.006;
  }

  get running() { return !!this.ctx; }

  async start() {
    if (this.ctx) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can\'t use the microphone on this page. Open Huddle at http://localhost in Chrome, Brave, Safari or Edge.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: this.deviceId ? { exact: this.deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but is the one capture path every browser still supports without extra files.
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => this.frame(e.inputBuffer.getChannelData(0));
    src.connect(proc);
    proc.connect(this.ctx.destination); // required for onaudioprocess to fire; output stays silent
    this.proc = proc;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.proc?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.proc = null;
    this.recording = false;
    this.onLevel(0);
  }

  async setDevice(deviceId) {
    this.deviceId = deviceId;
    if (this.ctx) { this.stop(); await this.start(); }
  }

  resample(input) {
    const ratio = this.ctx.sampleRate / TARGET_RATE;
    const n = Math.floor(input.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * ratio), e = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = s; j < e; j++) sum += input[j];
      out[i] = sum / Math.max(1, e - s);
    }
    return out;
  }

  frame(raw) {
    let sq = 0;
    for (let i = 0; i < raw.length; i++) sq += raw[i] * raw[i];
    const rms = Math.sqrt(sq / raw.length);
    this.onLevel(this.paused ? 0 : rms);
    if (this.paused) return;
    const pcm = this.resample(raw);
    const frameMs = (raw.length / this.ctx.sampleRate) * 1000;

    if (this.recording && !this.vad) { this.chunks.push(pcm); return; } // push to talk

    if (!this.vad) return;
    const threshold = Math.max(0.012, this.noise * 3);
    if (!this.recording) {
      this.preroll.push(pcm);
      if (this.preroll.length > 3) this.preroll.shift();
      if (rms > threshold) {
        this.loud = (this.loud || 0) + frameMs;
        if (this.loud >= 120) { this.recording = true; this.silence = 0; this.chunks = [...this.preroll]; this.preroll = []; this.onSpeechStart(); }
      } else {
        this.loud = 0;
        this.noise = this.noise * 0.95 + rms * 0.05; // track the room's background level
      }
      return;
    }
    this.chunks.push(pcm);
    this.silence = rms > threshold * 0.7 ? 0 : this.silence + frameMs;
    const len = this.chunks.reduce((a, c) => a + c.length, 0) / TARGET_RATE;
    if (this.silence > 850 || len > 28) this.finish();
  }

  // Push to talk
  begin() { this.chunks = []; this.recording = true; }
  end() { if (this.recording) this.finish(); }

  finish() {
    this.recording = false;
    this.loud = 0;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks = [];
    if (total > TARGET_RATE * 0.35) this.onSegment(out);
    else this.onSegment(null);
  }
}

export async function transcribe(pcm) {
  const r = await fetch('/api/stt/transcribe', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm.buffer })
    .catch(() => { throw new Error("Can't reach the Huddle server. Is it still running? Start it with: cd ~/huddle && npm start"); });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Transcription failed');
  return j.text;
}

export async function micDevices() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { return []; }
}
