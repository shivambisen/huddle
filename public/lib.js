// Shared helpers and components.
import { Mic, transcribe, micDevices } from './mic.js';
import { browserSpeechWorks, voices, pickVoice, previewNatural } from './voice.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const initial = (s) => (s || '?').trim()[0]?.toUpperCase() || '?';
export const COLORS = ['#c2643d', '#3d7ac2', '#3d9c6a', '#8a5cc2', '#c23d7a', '#2f8f8f', '#b7791f', '#5c6bc2'];
export const PERMS = {
  plan: { label: 'Read only', hint: 'Can look at files and the web, changes nothing' },
  acceptEdits: { label: 'Can edit files', hint: 'Reads and writes files in the project folder' },
  bypassPermissions: { label: 'Full autonomy', hint: 'Also runs shell commands without asking' },
};

export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---------- provider logo ----------
export const providerMark = (p, size = 36) =>
  `<span class="pmark" style="width:${size}px;height:${size}px;background:${p.color}">${esc(p.label[0])}</span>`;

// ---------- connect card (used by onboarding and Connections) ----------
// Renders into `el` and keeps itself fresh. Returns { refresh, destroy }.
export function connectCards(el, { onChange = () => {} } = {}) {
  let status = null, pending = new Set(), testing = {}, results = {}, poll = null;

  const card = (p) => {
    const state = p.signedIn ? 'ok' : p.installed ? 'half' : 'no';
    const pill = p.signedIn ? '<span class="pill ok"><span class="dot"></span>Connected</span>'
      : p.installed ? '<span class="pill half"><span class="dot"></span>Needs sign-in</span>'
      : '<span class="pill no"><span class="dot"></span>Not set up</span>';
    const models = p.models?.length ? p.models : [{ id: 'default', label: 'Default' }];
    let actions = '';
    if (p.id === 'ollama') {
      actions = p.installed ? (p.signedIn ? '' : '<span class="small muted">Then run <code>ollama pull llama3.2</code> in Terminal.</span>')
        : `<button class="btn" data-act="login">Download Ollama</button>`;
    } else if (!p.installed) {
      actions = `<button class="btn primary" data-act="install">Install ${esc(p.product)}</button>`;
    } else if (!p.signedIn) {
      actions = `<button class="btn primary" data-act="login">Sign in with ${esc(p.label)}</button>`;
    }
    if (p.signedIn) {
      actions += `<select data-model class="sel-sm">${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select>
        <button class="btn" data-act="test" ${testing[p.id] ? 'disabled' : ''}>${testing[p.id] ? '<span class="spin dark"></span> Testing…' : 'Test'}</button>`;
    }
    const res = results[p.id];
    return `
    <div class="card connect ${state}" data-id="${p.id}">
      <div class="row">
        ${providerMark(p)}
        <div style="flex:1;min-width:0"><h3>${esc(p.label)} <span class="muted small">· ${esc(p.product)}</span></h3>
          <div class="small muted ellipsis">${esc(p.signedIn || p.installed ? p.detail : `Uses ${p.account}`)}</div></div>
        ${pill}
      </div>
      ${pending.has(p.id) ? `<div class="note small"><span class="spin dark"></span> ${p.id === 'ollama' ? 'Finish installing Ollama, then come back.' : `A Terminal window opened. Sign in there with ${esc(p.account)}${p.loginHint ? '. ' + esc(p.loginHint) : ''}. This card updates by itself.`}</div>` : ''}
      ${testing[p.id] === 'install' ? '<div class="note small"><span class="spin dark"></span> Installing with npm. This takes about a minute.</div>' : ''}
      ${res ? `<div class="test-result ${res.error ? 'bad' : ''}">${res.error ? '✕ ' + esc(res.error) : `✓ “${esc(res.reply)}” <span class="muted">${(res.ms / 1000).toFixed(1)}s</span>`}</div>` : ''}
      <div class="row actions">${actions}</div>
    </div>`;
  };

  const paint = () => {
    if (!status) { el.innerHTML = '<p class="muted"><span class="spin dark"></span> Looking for Claude, ChatGPT, Gemini and Ollama on this computer…</p>'; return; }
    el.innerHTML = Object.values(status).map(card).join('');
    el.querySelectorAll('.connect').forEach((c) => {
      const id = c.dataset.id;
      c.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(id, b.dataset.act, c)));
    });
  };

  const refresh = async () => {
    try {
      const next = await api('/providers');
      for (const id of pending) if (next[id]?.signedIn) { pending.delete(id); toast(`${next[id].label} connected`); }
      status = next;
      paint();
      onChange(status);
    } catch (e) { el.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
    clearTimeout(poll);
    poll = setTimeout(refresh, pending.size ? 2500 : 15000);
  };

  async function act(id, what, c) {
    try {
      if (what === 'login') {
        const r = await api(`/providers/${id}/login`, { method: 'POST' });
        if (!r.opened && r.command) { prompt('Run this in a terminal to sign in, then come back:', r.command); }
        pending.add(id); paint(); refresh();
      }
      if (what === 'install') {
        testing[id] = 'install'; paint();
        try { await api(`/providers/${id}/install`, { method: 'POST' }); toast('Installed. Now sign in.'); }
        finally { delete testing[id]; }
        refresh();
      }
      if (what === 'test') {
        const model = c.querySelector('[data-model]').value;
        testing[id] = true; delete results[id]; paint();
        try { results[id] = await api(`/providers/${id}/test`, { method: 'POST', body: { model } }); }
        catch (e) { results[id] = { error: e.message }; }
        delete testing[id]; paint();
      }
    } catch (e) { delete testing[id]; toast(e.message, 5000); paint(); }
  }

  paint();
  refresh();
  return { refresh, destroy: () => clearTimeout(poll), get status() { return status; } };
}

// ---------- mic check (used by onboarding and the lobby) ----------
export function micCheck(el, { engine = 'whisper', onEngine = () => {} } = {}) {
  let mic = null, testing = false, meterRaf = 0, level = 0, stt = null, sttPoll = 0;
  el.innerHTML = `
    <div class="mic-check">
      <div class="row">
        <label class="field" style="flex:1">Microphone<select id="mc-dev"><option value="">Default microphone</option></select></label>
        <label class="field" style="flex:1">Speech recognition
          <select id="mc-engine">
            <option value="whisper" ${engine === 'whisper' ? 'selected' : ''}>Local Whisper: private, any browser</option>
            <option value="browser" ${engine === 'browser' ? 'selected' : ''} ${browserSpeechWorks ? '' : 'disabled'}>Browser speech: live captions${browserSpeechWorks ? '' : ' (Chrome/Edge only)'}</option>
          </select></label>
      </div>
      <div class="meter"><i id="mc-level"></i></div>
      <div class="row">
        <button class="btn" id="mc-allow">Turn on microphone</button>
        <button class="btn primary" id="mc-test" disabled>Hold to test</button>
        <button class="btn" id="mc-spk">Play test voice</button>
        <span class="small muted" id="mc-stt"></span>
      </div>
      <div class="test-result" id="mc-out" hidden></div>
    </div>`;
  const $ = (id) => el.querySelector('#' + id);
  const setOut = (html, bad) => { const o = $('mc-out'); o.hidden = false; o.className = 'test-result' + (bad ? ' bad' : ''); o.innerHTML = html; };

  const meter = () => { $('mc-level').style.width = Math.min(100, level * 900) + '%'; meterRaf = requestAnimationFrame(meter); };
  meter();

  const fillDevices = async () => {
    const devs = await micDevices();
    const sel = $('mc-dev');
    const cur = localStorage.getItem('huddle.mic') || '';
    sel.innerHTML = '<option value="">Default microphone</option>' + devs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'Microphone')}</option>`).join('');
  };

  const start = async () => {
    try {
      mic = mic || new Mic({ deviceId: localStorage.getItem('huddle.mic') || '', onLevel: (l) => (level = l), onSegment: got });
      await mic.start();
      $('mc-allow').textContent = 'Microphone on';
      $('mc-allow').disabled = true;
      $('mc-test').disabled = false;
      fillDevices();
      return true;
    } catch (e) {
      setOut(e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Click the icon at the left of the address bar, allow the microphone, then try again.'
        : esc(e.message), true);
      return false;
    }
  };

  async function got(pcm) {
    if (!pcm) { setOut('Too short. Hold the button while you speak.', true); return; }
    setOut('<span class="spin dark"></span> Transcribing on this computer…');
    try {
      const t0 = Date.now();
      const text = await transcribe(pcm);
      setOut(text ? `✓ Heard: “${esc(text)}” <span class="muted">${((Date.now() - t0) / 1000).toFixed(1)}s</span>` : 'Heard only silence. Check the level bar moves when you talk.', !text);
    } catch (e) { setOut(esc(e.message), true); }
  }

  const sttState = async () => {
    try {
      stt = await api('/stt/status');
      $('mc-stt').innerHTML = stt.status === 'ready' ? '✓ Speech model ready'
        : stt.status === 'loading' ? `<span class="spin dark"></span> Downloading speech model (once): ${stt.progress || 0}%`
        : stt.status === 'error' ? `Speech model failed: ${esc(stt.error)}` : '';
      if (stt.status === 'loading') sttPoll = setTimeout(sttState, 800);
    } catch {}
  };
  if ($('mc-engine').value === 'whisper') api('/stt/warm', { method: 'POST', body: {} }).then(sttState);

  $('mc-allow').onclick = start;
  $('mc-dev').onchange = (e) => { localStorage.setItem('huddle.mic', e.target.value); mic?.setDevice(e.target.value); };
  $('mc-engine').onchange = (e) => onEngine(e.target.value);
  const down = async (e) => { e.preventDefault(); if (!mic?.running && !(await start())) return; testing = true; mic.begin(); setOut('🎙 Listening… say “Hey intern, what’s on the agenda?”'); };
  const up = () => { if (!testing) return; testing = false; mic.end(); };
  $('mc-test').onpointerdown = down;
  $('mc-test').onpointerup = up;
  $('mc-test').onpointerleave = up;
  $('mc-spk').onclick = async () => {
    const line = "Hi! I'm your intern. Each teammate on the call gets their own voice.";
    const b = $('mc-spk');
    b.disabled = true; b.innerHTML = '<span class="spin dark"></span> Preparing voice…';
    try { await previewNatural(line, 'af_heart'); }
    catch {
      const v = pickVoice(await voices(), null, 0);
      const u = new SpeechSynthesisUtterance(line);
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    }
    b.disabled = false; b.textContent = 'Play test voice';
  };
  api('/tts/warm', { method: 'POST', body: {} }).catch(() => {});
  // If permission was already granted, turn the mic on straight away.
  navigator.permissions?.query({ name: 'microphone' }).then((p) => p.state === 'granted' && start()).catch(() => {});

  return { destroy: () => { cancelAnimationFrame(meterRaf); clearTimeout(sttPoll); mic?.stop(); } };
}
