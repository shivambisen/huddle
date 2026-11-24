// The call screen, modelled on Google Meet.
import { api, esc, toast, initial } from './lib.js';
import { Voice, naturalVoices, naturalVoiceFor, previewNatural, voices as systemVoices } from './voice.js';

const I = {
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/>',
  micOff: '<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM14.98 11.17c0-.06.02-.11.02-.17V5a3 3 0 0 0-6 0v.18l5.98 5.99ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52a5.3 5.3 0 0 1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3Z"/>',
  cam: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/>',
  camOff: '<path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5ZM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2Z"/>',
  cc: '<path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1Zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1Z"/>',
  vol: '<path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z"/>',
  volOff: '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63Zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3ZM12 4 9.91 6.09 12 8.18V4Z"/>',
  more: '<path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  end: '<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z"/>',
  info: '<path d="M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/>',
  people: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"/>',
  chat: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H6l-2 2V4h16v12Z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/>',
  send: '<path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2 .01 7Z"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  skip: '<path d="M6 18l8.5-6L6 6v12ZM16 6v12h2V6h-2Z"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${I[n]}</svg>`;
const EFFORT_LABEL = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' };

export async function viewMeeting($app, pid, settings, onLeave) {
  const [p, status, nlist, slist] = await Promise.all([api(`/projects/${pid}`), api('/providers'), naturalVoices(), systemVoices()]);
  if (!p.roles.length) { location.hash = `#/p/${pid}`; return toast('Add a teammate first.'); }
  document.body.classList.add('in-meeting');
  const host = settings.hostName || 'You';
  const roles = Object.fromEntries(p.roles.map((r) => [r.id, r]));
  const order = p.roles.map((r) => r.id);
  const st = {
    transcript: [], agents: {}, drafts: {}, target: 'auto', panel: localStorage.getItem('huddle.panel') ?? 'chat', speaking: null, queued: new Set(),
    cam: null, lastAddressed: null, level: 0, captions: localStorage.getItem('huddle.cc') !== '0', menu: null, routing: false,
  };
  const nameOf = (id) => (id === 'you' ? host : roles[id]?.name || id);
  const effortOf = (r) => r.effort || (r.permission === 'acceptEdits' || r.permission === 'bypassPermissions' ? 'medium' : 'low');
  const modelLabel = (r) => { const m = (status[r.provider]?.models || []).find((x) => x.id === (r.model || 'default')); return m ? m.label.replace(/ \(.*\)$/, '') : r.model || 'Default'; };

  // Like Meet: open mic by default (push to talk is in ⋮ More options).
  try { if (!localStorage.getItem('huddle.mode')) localStorage.setItem('huddle.mode', 'open'); } catch {}
  const voice = new Voice({
    roles,
    engine: settings.speech?.engine,
    voices: settings.speech?.voices,
    onSpeaking: (id, text) => { st.speaking = id; paintTiles(); if (id && text) caption(id, text); },
    onQueue: (ids) => { st.queued = new Set(ids); paintTiles(); },
    onCaption: (text, final) => { if (text) caption('you', text, !final); },
    onUtterance: (text) => send(text, 'voice'),
    onLevel: (l) => (st.level = l),
    onState: () => paintBar(),
    onError: (m) => toast(m, 5000),
  });

  $app.innerHTML = `
  <div class="gm" id="gm">
    <main class="gm-stage-wrap">
      <div class="gm-stage" id="stage"></div>
      <div class="gm-caption" id="caption" hidden></div>
    </main>
    <aside class="gm-panel" id="panel" hidden>
      <header><h2 id="panel-title">In-call messages</h2><button class="gm-icon" id="panel-close" title="Close">${svg('close')}</button></header>
      <div class="gm-panel-body" id="panel-body"></div>
      <form class="gm-compose" id="compose">
        <div class="gm-to">Send to <select id="to"><option value="auto">Whoever I name</option><option value="all">Everyone</option>${p.roles.map((r) => `<option value="${r.id}">${esc(r.name)} only</option>`).join('')}</select></div>
        <div class="gm-input"><input id="input" placeholder="Send a message" autocomplete="off" /><button class="gm-icon" title="Send">${svg('send')}</button></div>
      </form>
    </aside>
    <footer class="gm-bar">
      <div class="gm-left"><span id="clock"></span><span class="gm-sep">|</span><span class="gm-name">${esc(p.name)}</span></div>
      <div class="gm-center" id="controls"></div>
      <div class="gm-right">
        <button class="gm-icon" data-panel="info" title="Meeting details">${svg('info')}</button>
        <button class="gm-icon" data-panel="people" title="People">${svg('people')}<span class="gm-count">${p.roles.length + 1}</span></button>
        <button class="gm-icon" data-panel="chat" title="Chat with everyone">${svg('chat')}<span class="gm-dot" id="unread" hidden></span></button>
      </div>
    </footer>
    <div class="gm-menu" id="menu" hidden></div>
  </div>`;
  const $ = (id) => document.getElementById(id);
  const tick = () => ($('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  tick();
  const clock = setInterval(tick, 10000);

  // ----- socket -----
  let ws, closed = false;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?project=${pid}`);
    ws.onclose = () => { if (!closed) { toast('Reconnecting…'); setTimeout(connect, 1200); } };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') { st.transcript = m.transcript; st.agents = m.agents; st.lastAddressed = m.lastAddressed; paintTiles(); paintPanel(); }
      if (m.type === 'agent') { st.agents[m.id] = { status: m.status, activity: m.activity, queued: m.queued }; paintTiles(); if (st.panel === 'people') paintPanel(); }
      if (m.type === 'speech') voice.speak(m.id, m.text);
      if (m.type === 'routing') { st.routing = true; caption('you', m.text, false, 'Working out who you mean…'); }
      if (m.type === 'draft') { st.drafts[m.id] = m.text; paintDraft(m.id); }
      if (m.type === 'role') { Object.assign(roles[m.role.id], m.role); paintTiles(); if (st.panel === 'people') paintPanel(); if (st.menu === m.role.id) openMenu(m.role.id); }
      if (m.type === 'entry') {
        const e = m.entry;
        st.transcript.push(e);
        if (e.from !== 'you') { delete st.drafts[e.from]; paintDraft(e.from); }
        if (e.from === 'you') { st.routing = false; if (Array.isArray(e.to) && e.to.length === 1) st.lastAddressed = e.to[0]; caption('you', e.text, false, null, e.to); }
        else if (e.say && !e.spoken && !e.handoff) voice.speak(e.from, e.say); // older servers
        appendMsg(e);
      }
    };
  };
  connect();
  const send = (text, via = 'chat') => {
    if (!text.trim()) return;
    if (ws.readyState !== 1) return toast('Not connected yet');
    ws.send(JSON.stringify({ type: 'say', text, to: via === 'chat' ? $('to').value : st.target, via }));
  };
  const setRole = (id, patch) => { Object.assign(roles[id], patch); ws.send(JSON.stringify({ type: 'role', id, patch })); };

  // ----- tiles -----
  const layout = () => {
    const n = order.length + 1;
    const stage = $('stage');
    const W = stage.clientWidth, H = stage.clientHeight;
    let best = { cols: 1, size: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - (cols - 1) * 8) / cols, ((H - (rows - 1) * 8) / rows) * (16 / 9));
      if (w > best.size) best = { cols, size: w };
    }
    stage.style.setProperty('--cols', best.cols);
    stage.style.setProperty('--tile-w', Math.floor(best.size) + 'px');
  };
  const tileHtml = (id) => {
    if (id === 'you') {
      const muted = !voice.micActive;
      return `<div class="gm-tile ${voice.listening ? 'talking' : ''}" data-id="you">
        ${st.cam ? '<video autoplay muted playsinline></video>' : `<div class="gm-avatar" style="background:#5f6368">${initial(host)}</div>`}
        <div class="gm-badge ${muted ? 'muted' : voice.listening ? 'live' : ''}">${muted ? svg('micOff') : voice.listening ? '<span class="gm-bars"><i></i><i></i><i></i></span>' : ''}</div>
        <div class="gm-label">${esc(host)}</div></div>`;
    }
    const r = roles[id];
    const a = st.agents[id] || {};
    const speaking = st.speaking === id;
    const prov = status[r.provider];
    const chip = a.status === 'working' ? `<div class="gm-chip"><span class="gm-spin"></span>${esc(a.activity && !/^thinking/.test(a.activity) ? a.activity : 'Thinking')}</div>`
      : st.queued.has(id) ? '<div class="gm-chip">✋ Wants to speak</div>'
      : a.status === 'error' ? `<div class="gm-chip err" title="${esc(a.activity)}">Problem: ${esc(a.activity.slice(0, 60))}</div>`
      : prov && !prov.signedIn ? '<div class="gm-chip err">Not connected</div>' : '';
    return `<div class="gm-tile agent ${speaking ? 'speaking' : ''} ${st.target === id ? 'pinned' : ''}" data-id="${id}">
      ${chip}
      <div class="gm-avatar ${speaking ? 'pulse' : ''}" style="background:${r.color}">${initial(r.name)}</div>
      <div class="gm-badge ${speaking ? 'live' : ''}">${speaking ? '<span class="gm-bars"><i></i><i></i><i></i></span>' : ''}</div>
      <div class="gm-hover"><button class="gm-hbtn" data-act="talk" title="${st.target === id ? 'Stop talking only to' : 'Talk only to'} ${esc(r.name)}">${st.target === id ? 'Talking only to them' : 'Talk only to ' + esc(r.name)}</button><button class="gm-hbtn round" data-act="menu" title="Model, effort and voice">${svg('more')}</button></div>
      <div class="gm-label">${esc(r.name)}<span class="gm-sub">${esc(prov?.label || r.provider)} · ${esc(modelLabel(r))} · ${esc(EFFORT_LABEL[effortOf(r)] || effortOf(r))}</span></div>
    </div>`;
  };
  const paintTiles = () => {
    const stage = $('stage');
    stage.innerHTML = ['you', ...order].map(tileHtml).join('');
    if (st.cam) stage.querySelector('video').srcObject = st.cam;
    stage.querySelectorAll('.gm-tile.agent').forEach((t) => {
      const id = t.dataset.id;
      t.querySelector('[data-act=talk]').onclick = (e) => { e.stopPropagation(); st.target = st.target === id ? 'auto' : id; paintTiles(); toast(st.target === id ? `Only ${nameOf(id)} will hear you` : 'Talking to everyone again'); };
      t.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openMenu(id, e.currentTarget); };
    });
    layout();
  };

  // ----- per-agent settings menu (model / effort / voice), usable mid-call -----
  let menuAnchor = null;
  function openMenu(id, anchor = menuAnchor) {
    menuAnchor = anchor; st.menu = id;
    const r = roles[id];
    const prov = status[r.provider] || {};
    const models = prov.models?.length ? prov.models : [{ id: 'default', label: 'Default' }];
    const efforts = prov.efforts || [];
    const cur = effortOf(r);
    const nv = naturalVoiceFor(nlist, r, order.indexOf(id));
    const m = $('menu');
    m.innerHTML = `
      <div class="gm-menu-head"><span class="gm-mini" style="background:${r.color}">${initial(r.name)}</span><div><b>${esc(r.name)}</b><div class="gm-muted">${esc(r.title || '')} · ${esc(prov.label || r.provider)}</div></div></div>
      <label>Model<select data-k="model">${models.map((x) => `<option value="${esc(x.id)}" ${x.id === (r.model || 'default') ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      ${efforts.length ? `<label>Effort <span class="gm-muted">lower = faster replies</span><div class="gm-seg">${efforts.map((e) => `<button data-effort="${e}" class="${e === cur ? 'on' : ''}">${EFFORT_LABEL[e] || e}</button>`).join('')}</div></label>` : ''}
      <label>Voice<div class="gm-row"><select data-k="voice">
        <optgroup label="Natural">${nlist.map((v) => `<option value="${v.id}" ${v.id === nv && (!r.voice || r.voice === v.id) ? 'selected' : ''}>${esc(v.label)} · ${v.accent} ${v.gender}</option>`).join('')}</optgroup>
        <optgroup label="System">${slist.map((v) => `<option value="${esc(v.name)}" ${v.name === r.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>
      </select><button class="gm-pill" data-act="hear">Hear</button></div></label>
      <div class="gm-row end">${st.agents[id]?.status === 'working' ? `<button class="gm-pill" data-act="stop">${svg('stop')} Stop reply</button>` : ''}<button class="gm-pill" data-act="close">Done</button></div>
      <p class="gm-muted small">Changes apply from ${esc(r.name)}'s next reply. Their memory of the call is kept.</p>`;
    m.hidden = false;
    const rect = (anchor || $('stage')).getBoundingClientRect();
    const mw = 300;
    m.style.left = Math.max(12, Math.min(innerWidth - mw - 12, rect.right - mw)) + 'px';
    m.style.top = Math.max(12, Math.min(innerHeight - m.offsetHeight - 90, rect.bottom + 6)) + 'px';
    m.querySelectorAll('select[data-k]').forEach((s) => (s.onchange = () => { setRole(id, { [s.dataset.k]: s.value }); paintTiles(); toast(`${r.name}: ${s.dataset.k} updated`); }));
    m.querySelectorAll('[data-effort]').forEach((b) => (b.onclick = () => { setRole(id, { effort: b.dataset.effort }); openMenu(id); paintTiles(); }));
    m.querySelector('[data-act=hear]').onclick = async () => {
      const v = m.querySelector('[data-k=voice]').value;
      if (nlist.some((x) => x.id === v)) { try { await previewNatural(`Hi ${host}, this is how I'll sound.`, v); } catch { toast('Voice is still loading'); } }
      else { const u = new SpeechSynthesisUtterance(`Hi ${host}, this is how I'll sound.`); u.voice = slist.find((x) => x.name === v) || null; speechSynthesis.speak(u); }
    };
    const stopBtn = m.querySelector('[data-act=stop]');
    if (stopBtn) stopBtn.onclick = () => ws.send(JSON.stringify({ type: 'stop', id }));
    m.querySelector('[data-act=close]').onclick = closeMenu;
  }
  function closeMenu() { $('menu').hidden = true; st.menu = null; }
  const outside = (e) => { if (st.menu && !e.target.closest('#menu') && !e.target.closest('[data-act=menu]')) closeMenu(); };
  document.addEventListener('pointerdown', outside);

  // ----- captions -----
  let capTimer;
  function caption(id, text, live = false, note = null, to = null) {
    if (!st.captions) return;
    clearTimeout(capTimer);
    const c = $('caption');
    const r = roles[id];
    const toTxt = to ? (to === 'all' ? 'Everyone' : [].concat(to).map(nameOf).join(', ')) : '';
    c.hidden = false;
    c.innerHTML = `<span class="gm-mini" style="background:${r ? r.color : '#5f6368'}">${initial(nameOf(id))}</span>
      <div><div class="gm-cap-name">${esc(nameOf(id))}${toTxt ? ` <span class="gm-cap-to">→ ${esc(toTxt)}</span>` : ''}${note ? ` <span class="gm-cap-to">${esc(note)}</span>` : ''}</div><div class="gm-cap-text">${esc(text)}${live ? '…' : ''}</div></div>`;
    capTimer = setTimeout(() => (c.hidden = true), live ? 15000 : 7000);
  }

  // ----- bottom bar -----
  function paintBar() {
    const v = voice;
    const micOn = v.micActive;
    $('controls').innerHTML = `
      ${v.supported ? `<button class="gm-btn ${micOn ? '' : 'off'} ${v.listening ? 'live' : ''}" id="mic" title="${v.mode === 'ptt' ? 'Hold to talk (or hold Space)' : micOn ? 'Turn off microphone' : 'Turn on microphone'}">${svg(micOn ? 'mic' : 'micOff')}</button>` : ''}
      <button class="gm-btn ${st.cam ? '' : 'off'}" id="cam" title="${st.cam ? 'Turn off camera' : 'Turn on camera'}">${svg(st.cam ? 'cam' : 'camOff')}</button>
      <button class="gm-btn ${st.captions ? 'on' : ''}" id="cc" title="Captions">${svg('cc')}</button>
      <button class="gm-btn ${v.muted ? 'off' : ''}" id="spk" title="${v.muted ? 'Agents are muted' : 'Mute agents'}">${svg(v.muted ? 'volOff' : 'vol')}</button>
      <button class="gm-btn" id="skip" title="Skip whoever is speaking">${svg('skip')}</button>
      <button class="gm-btn" id="more" title="More options">${svg('more')}</button>
      <button class="gm-end" id="leave" title="Leave call">${svg('end')}</button>`;
    const mic = $('mic');
    if (mic) {
      if (v.mode === 'ptt') {
        mic.onpointerdown = (e) => { e.preventDefault(); mic.setPointerCapture?.(e.pointerId); v.pttStart(); };
        mic.onpointerup = mic.onpointercancel = () => v.pttEnd();
      } else mic.onclick = () => v.toggleOpen();
    }
    $('cam').onclick = async () => {
      if (st.cam) { st.cam.getTracks().forEach((t) => t.stop()); st.cam = null; localStorage.setItem('huddle.cam', '0'); }
      else { try { st.cam = await navigator.mediaDevices.getUserMedia({ video: true }); localStorage.setItem('huddle.cam', '1'); } catch { toast('Camera not available'); } }
      paintBar();
    };
    $('cc').onclick = () => { st.captions = !st.captions; localStorage.setItem('huddle.cc', st.captions ? '1' : '0'); if (!st.captions) $('caption').hidden = true; paintBar(); };
    $('spk').onclick = () => v.setMuted(!v.muted);
    $('skip').onclick = () => v.skip();
    $('leave').onclick = () => (location.hash = '#/');
    $('more').onclick = (e) => {
      const m = $('menu');
      m.innerHTML = `
        <label>Microphone mode<div class="gm-seg"><button data-mode="open" class="${v.mode === 'open' ? 'on' : ''}">Open mic</button><button data-mode="ptt" class="${v.mode === 'ptt' ? 'on' : ''}">Push to talk</button></div></label>
        <label class="gm-check"><input type="checkbox" id="hp" ${v.headphones ? 'checked' : ''}/> I'm wearing headphones <span class="gm-muted">(lets you talk over agents)</span></label>
        <div class="gm-row end"><button class="gm-pill" data-act="clear">Clear meeting history</button><button class="gm-pill" data-act="close">Done</button></div>`;
      m.hidden = false; st.menu = 'more';
      const rect = e.currentTarget.getBoundingClientRect();
      m.style.left = Math.max(12, rect.left - 120) + 'px';
      m.style.top = rect.top - m.offsetHeight - 10 + 'px';
      m.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { v.setMode(b.dataset.mode); closeMenu(); }));
      m.querySelector('#hp').onchange = (ev) => v.setHeadphones(ev.target.checked);
      m.querySelector('[data-act=clear]').onclick = () => { if (confirm('Clear the transcript and start every agent fresh?')) ws.send(JSON.stringify({ type: 'clear' })); closeMenu(); };
      m.querySelector('[data-act=close]').onclick = closeMenu;
    };
    paintTiles();
  }

  // ----- side panel: chat / people / info -----
  const fmt = (text) => esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  const msgHtml = (e) => {
    const toTxt = e.to === 'all' ? 'Everyone' : [].concat(e.to).map(nameOf).join(', ');
    const r = roles[e.from];
    return `<div class="gm-msg ${e.from === 'you' ? 'me' : ''} ${e.handoff ? 'handoff' : ''} ${e.error ? 'error' : ''}">
      <div class="gm-msg-meta"><b>${esc(e.from === 'you' ? 'You' : nameOf(e.from))}</b><span>to ${esc(toTxt)}${e.reason === 'guessed' ? ' (guessed)' : ''}</span><span>${new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${e.via === 'voice' ? '<span>🎙</span>' : ''}
      ${r && e.say ? `<button class="gm-replay" data-replay="${e.id}" title="Play again">▶</button>` : ''}</div>
      <div class="gm-msg-text">${fmt(e.text)}${e.interrupted ? ' <i class="gm-muted">(you kept talking)</i>' : ''}</div></div>`;
  };
  const bindReplay = (root) => root.querySelectorAll('[data-replay]').forEach((b) => (b.onclick = () => {
    const e = st.transcript.find((x) => x.id === b.dataset.replay);
    if (e) voice.speak(e.from, e.say, true);
  }));
  function appendMsg(e) {
    if (st.panel !== 'chat' || $('panel').hidden) { if (e.from !== 'you') $('unread').hidden = false; return; }
    const box = $('msgs');
    if (!box) return;
    box.querySelector('.gm-empty')?.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    // New messages go above any "is typing…" bubbles, which stay at the bottom.
    const firstDraft = box.querySelector('.gm-draft');
    if (firstDraft) firstDraft.insertAdjacentHTML('beforebegin', msgHtml(e));
    else box.insertAdjacentHTML('beforeend', msgHtml(e));
    bindReplay(box);
    if (near || e.from === 'you') box.scrollTop = box.scrollHeight;
  }
  function paintDraft(id) {
    const box = $('msgs');
    if (!box) return;
    let d = box.querySelector(`.gm-draft[data-id="${id}"]`);
    const text = st.drafts[id];
    if (!text) { d?.remove(); return; }
    if (!d) { box.insertAdjacentHTML('beforeend', `<div class="gm-msg gm-draft" data-id="${id}"><div class="gm-msg-meta"><b>${esc(nameOf(id))}</b><span>is typing…</span></div><div class="gm-msg-text"></div></div>`); d = box.lastElementChild; }
    d.querySelector('.gm-msg-text').textContent = text;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) box.scrollTop = box.scrollHeight;
  }
  function paintPanel() {
    const panel = $('panel');
    panel.hidden = !st.panel;
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === st.panel));
    if (!st.panel) { layout(); return; }
    $('compose').hidden = st.panel !== 'chat';
    const body = $('panel-body');
    if (st.panel === 'chat') {
      $('panel-title').textContent = 'In-call messages';
      $('unread').hidden = true;
      body.innerHTML = `<div class="gm-note">Start with a name to talk to one person, or say “Everyone”. Without a name, Huddle works out who you mean.</div>
        <div class="gm-msgs" id="msgs">${st.transcript.length ? st.transcript.map(msgHtml).join('') : '<div class="gm-empty">No messages yet</div>'}</div>`;
      bindReplay(body);
      for (const id of Object.keys(st.drafts)) paintDraft(id);
      const box = $('msgs'); box.scrollTop = box.scrollHeight;
    } else if (st.panel === 'people') {
      $('panel-title').textContent = 'People';
      body.innerHTML = `<div class="gm-group">In the meeting <span>${order.length + 1}</span></div>
        <div class="gm-person"><span class="gm-mini lg" style="background:#5f6368">${initial(host)}</span><div class="grow"><b>${esc(host)} (You)</b><div class="gm-muted">Meeting host</div></div></div>
        ${order.map((id) => {
          const r = roles[id]; const prov = status[r.provider] || {}; const a = st.agents[id] || {};
          return `<div class="gm-person col" data-id="${id}">
            <div class="gm-row"><span class="gm-mini lg" style="background:${r.color}">${initial(r.name)}</span>
              <div class="grow"><b>${esc(r.name)}</b><div class="gm-muted">${a.status === 'working' ? esc(a.activity || 'Working…') : esc(r.title || '')}</div></div>
              ${a.status === 'working' ? `<button class="gm-icon sm" data-stop="${id}" title="Stop this reply">${svg('stop')}</button>` : ''}</div>
            <div class="gm-row">
              <select data-k="model" title="Model">${(prov.models?.length ? prov.models : [{ id: 'default', label: 'Default' }]).map((x) => `<option value="${esc(x.id)}" ${x.id === (r.model || 'default') ? 'selected' : ''}>${esc(prov.label || '')} ${esc(x.label)}</option>`).join('')}</select>
              ${prov.efforts?.length ? `<select data-k="effort" title="Effort">${prov.efforts.map((e) => `<option value="${e}" ${e === effortOf(r) ? 'selected' : ''}>${EFFORT_LABEL[e] || e} effort</option>`).join('')}</select>` : ''}
            </div></div>`;
        }).join('')}`;
      body.querySelectorAll('.gm-person[data-id] select').forEach((s) => (s.onchange = () => { const id = s.closest('[data-id]').dataset.id; setRole(id, { [s.dataset.k]: s.value }); paintTiles(); toast(`${nameOf(id)} updated. Applies from their next reply.`); }));
      body.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => ws.send(JSON.stringify({ type: 'stop', id: b.dataset.stop }))));
    } else if (st.panel === 'info') {
      $('panel-title').textContent = 'Meeting details';
      body.innerHTML = `<div class="gm-info"><b>${esc(p.name)}</b><div class="gm-muted">Folder: ${esc(p.cwd)}</div>
        <h4>Talking to the team</h4><ul>
          <li>Start with a name: “${esc(p.roles.at(-1).name)}, …”, or several: “${esc(p.roles[0].name)} and ${esc(p.roles.at(-1).name)}, …”.</li>
          <li>“Everyone…”, “Does anyone…” or “Who here…” asks the whole team. Agents with nothing to add stay quiet.</li>
          <li>No name? Answers go to whoever just asked you something; otherwise Huddle guesses from context.</li>
          <li>Keep talking and an agent that hasn't started working yet will wait for you to finish.</li>
          <li>Hover a tile for “Talk only to…” and the ⋮ menu (model, effort, voice).</li></ul>
        <h4>Speed</h4><p class="gm-muted">Replies start within a couple of seconds on Sonnet or Haiku at Low effort. Higher effort and Opus think longer before speaking.</p></div>`;
    }
    layout();
  }
  document.querySelectorAll('[data-panel]').forEach((b) => (b.onclick = () => { st.panel = st.panel === b.dataset.panel ? null : b.dataset.panel; localStorage.setItem('huddle.panel', st.panel || ''); paintPanel(); }));
  $('panel-close').onclick = () => { st.panel = null; localStorage.setItem('huddle.panel', ''); paintPanel(); };
  $('compose').onsubmit = (e) => { e.preventDefault(); send($('input').value); $('input').value = ''; };
  if (matchMedia('(max-width: 860px)').matches) st.panel = null;

  paintBar();
  paintPanel();
  if (localStorage.getItem('huddle.cam') === '1') $('cam').click();
  if (voice.mode === 'open' && voice.supported && !voice.openOn && localStorage.getItem('huddle.micOn') !== '0') voice.toggleOpen();

  // Live mic level on your tile.
  let raf = 0;
  const lvl = () => { const t = document.querySelector('.gm-tile[data-id=you]'); if (t) t.style.setProperty('--lvl', Math.min(1, st.level * 14).toFixed(2)); raf = requestAnimationFrame(lvl); };
  lvl();
  const onResize = () => layout();
  addEventListener('resize', onResize);

  // Space = push to talk (in push-to-talk mode, when not typing).
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const kd = (e) => { if (e.code === 'Space' && !e.repeat && !typing() && voice.mode === 'ptt') { e.preventDefault(); voice.pttStart(); } if (e.key === 'Escape') closeMenu(); };
  const ku = (e) => { if (e.code === 'Space' && !typing() && voice.mode === 'ptt') { e.preventDefault(); voice.pttEnd(); } };
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  onLeave(() => {
    closed = true; ws?.close(); clearInterval(clock); cancelAnimationFrame(raf); voice.destroy();
    st.cam?.getTracks().forEach((t) => t.stop());
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', onResize);
    document.removeEventListener('pointerdown', outside);
  });
}
