import { api, esc, toast, initial } from './lib.js';
import { Voice } from './voice.js';

const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-8 1.3-8 4v2h10v-2c0-1 .4-1.9 1.1-2.7A12 12 0 0 0 8 13Zm8 0c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Z"/></svg>',
  spk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12Zm10-12v12h2V6h-2Z"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.2.25-4.7.72v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41 0L.29 13.2a1 1 0 0 1 0-1.41C3.34 8.9 7.46 7 12 7s8.66 1.9 11.71 4.79a1 1 0 0 1 0 1.41l-2.38 2.37a1 1 0 0 1-1.41 0 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z"/></svg>',
};

export async function viewMeeting($app, pid, settings, onLeave) {
  const [p, status] = await Promise.all([api(`/projects/${pid}`), api('/providers')]);
  if (!p.roles.length) { location.hash = `#/p/${pid}`; return toast('Add a teammate first.'); }
  document.body.classList.add('in-meeting');
  const host = settings.hostName || 'You';
  const roles = Object.fromEntries(p.roles.map((r) => [r.id, r]));
  const st = { transcript: [], agents: {}, target: 'auto', panel: 'chat', speaking: null, queued: new Set(), cam: null, lastAddressed: null, level: 0 };
  const nameOf = (id) => (id === 'you' ? host : roles[id]?.name || id);

  const voice = new Voice({
    roles,
    engine: settings.speech?.engine,
    voices: settings.speech?.voices,
    onSpeaking: (id) => { st.speaking = id; paintTiles(); },
    onQueue: (ids) => { st.queued = new Set(ids); paintTiles(); },
    onCaption: (text, final) => paintCaption(text, final),
    onUtterance: (text) => send(text, 'voice'),
    onLevel: (l) => (st.level = l),
    onState: () => paintBar(),
    onError: (m) => toast(m, 5000),
  });

  const cols = p.roles.length + 1 <= 4 ? 2 : p.roles.length + 1 <= 9 ? 3 : 4;
  $app.innerHTML = `
  <div class="meet">
    <div class="meet-top"><span><b>${esc(p.name)}</b> · <span id="clock">0:00</span></span><span class="small" id="conn">Connecting…</span></div>
    <div class="stage" id="stage" style="--cols:${cols}"></div>
    <aside class="side" id="side">
      <div class="side-head">
        <div class="tabs"><button data-tab="chat" class="on">Chat</button><button data-tab="people">People</button></div>
        <button class="btn sm ghost" id="close-side">✕</button>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="people" id="people" hidden></div>
      <div class="compose">
        <div class="to-row">To <select id="to"><option value="auto">Whoever I name</option><option value="all">Everyone</option>${p.roles.map((r) => `<option value="${r.id}">${esc(r.name)} only</option>`).join('')}</select></div>
        <form id="form"><input type="text" id="input" placeholder="Message… (start with a name)" autocomplete="off" /><button class="btn primary sm">Send</button></form>
      </div>
    </aside>
    <div class="caption" id="caption"></div>
    <div class="bar">
      <div class="left small" id="hint"></div>
      <div class="center" id="controls"></div>
      <div class="row right"><button class="cbtn" data-c="chat" title="Chat">${ICON.chat}</button><button class="cbtn" data-c="people" title="People">${ICON.people}</button></div>
    </div>
  </div>`;
  const $ = (id) => document.getElementById(id);
  const t0 = Date.now();
  const clock = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);

  // Live mic level on your tile.
  let raf = 0;
  const lvl = () => { const t = document.querySelector('.tile[data-id=you]'); if (t) t.style.setProperty('--lvl', Math.min(1, st.level * 12).toFixed(2)); raf = requestAnimationFrame(lvl); };
  lvl();

  // ----- socket -----
  let ws, closed = false;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?project=${pid}`);
    ws.onopen = () => ($('conn').textContent = '● Live');
    ws.onclose = () => { if (closed) return; $('conn').textContent = 'Reconnecting…'; setTimeout(connect, 1200); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') { st.transcript = m.transcript; st.agents = m.agents; st.lastAddressed = m.lastAddressed; paintAll(); }
      if (m.type === 'agent') { st.agents[m.id] = { status: m.status, activity: m.activity, queued: m.queued }; paintTiles(); paintPeople(); }
      if (m.type === 'entry') {
        st.transcript.push(m.entry);
        if (m.entry.from === 'you' && Array.isArray(m.entry.to) && m.entry.to.length === 1) st.lastAddressed = m.entry.to[0];
        appendMsg(m.entry);
        if (m.entry.from === 'you') paintCaption(m.entry.text, true, m.entry.to);
        else if (m.entry.say && !m.entry.handoff) voice.speak(m.entry.from, m.entry.say);
        paintHint();
      }
    };
  };
  connect();
  const send = (text, via = 'chat') => {
    if (!text.trim()) return;
    if (ws.readyState !== 1) return toast('Not connected yet');
    const to = via === 'chat' ? $('to').value : st.target;
    ws.send(JSON.stringify({ type: 'say', text, to, via }));
  };

  // ----- tiles -----
  const paintTiles = () => {
    const you = `<div class="tile you ${voice.listening ? 'talking' : ''}" data-id="you">
      ${st.cam ? '<video autoplay muted playsinline></video>' : `<div class="face" style="background:#5f6368">${initial(host)}</div>`}
      <div class="label">${esc(host)} (you)</div></div>`;
    const tiles = p.roles.map((r) => {
      const a = st.agents[r.id] || {};
      const speaking = st.speaking === r.id;
      const working = a.status === 'working';
      const prov = status[r.provider];
      const badges = [
        speaking ? '<span><span class="bars"><i></i><i></i><i></i></span>Speaking</span>' : '',
        !speaking && st.queued.has(r.id) ? '<span>✋ Wants to speak</span>' : '',
        working ? `<span><span class="spin"></span>${a.queued ? 'Working · more queued' : 'Working'}</span>` : '',
        a.status === 'error' ? '<span class="err">Error</span>' : '',
        prov && !prov.signedIn ? '<span class="err">Not connected</span>' : '',
      ].join('');
      return `<div class="tile ${speaking ? 'speaking' : ''} ${st.target === r.id ? 'target' : ''}" data-id="${r.id}" title="Click to talk only to ${esc(r.name)}">
        ${working && a.activity ? `<div class="activity">${esc(a.activity)}</div>` : ''}
        <div class="badge">${badges}</div>
        <div class="face" style="background:${r.color}">${initial(r.name)}</div>
        <div class="label">${esc(r.name)} <span class="model">${esc(r.title || '')} · ${esc(prov?.label || r.provider)}${r.model && r.model !== 'default' ? ' ' + esc(r.model) : ''}</span></div>
        ${st.target === r.id ? '<div class="pin">Talking to</div>' : ''}
      </div>`;
    });
    const stage = $('stage');
    stage.innerHTML = you + tiles.join('');
    if (st.cam) stage.querySelector('video').srcObject = st.cam;
    stage.querySelectorAll('.tile[data-id]').forEach((t) => {
      if (t.dataset.id === 'you') return;
      t.onclick = () => { st.target = st.target === t.dataset.id ? 'auto' : t.dataset.id; paintTiles(); paintHint(); };
    });
  };

  const paintHint = () => {
    $('hint').innerHTML = st.target !== 'auto' ? `Talking only to <b class="blue">${esc(nameOf(st.target))}</b>. Click their tile again to stop.`
      : st.lastAddressed ? `With <b>${esc(nameOf(st.lastAddressed))}</b>. Say another name to switch.`
      : `Start with a name: “${esc(p.roles.at(-1).name)}, …” or “Everyone, …”`;
  };

  let capTimer;
  const paintCaption = (text, final, to) => {
    clearTimeout(capTimer);
    const target = to ? (to === 'all' ? 'Everyone' : [].concat(to).map(nameOf).join(', ')) : '';
    $('caption').innerHTML = text ? `${target ? `<span class="to">→ ${esc(target)}</span> ` : ''}${esc(text)}` : '';
    if (final) capTimer = setTimeout(() => ($('caption').textContent = ''), 6000);
  };

  // ----- controls -----
  const paintBar = () => {
    const v = voice;
    const ptt = v.mode === 'ptt';
    $('controls').innerHTML = `
      ${v.supported ? `
        <button class="cbtn mic ${v.listening ? 'live' : ptt || v.openOn ? '' : 'off'}" id="mic">${ICON.mic}<span class="hide-sm">${ptt ? (v.listening ? 'Listening…' : 'Hold to talk') : v.openOn ? (v.listening ? 'Listening…' : 'Mic on') : 'Mic off'}</span></button>
        <select id="mode" class="hide-sm" title="How the mic works"><option value="ptt" ${ptt ? 'selected' : ''}>Push to talk</option><option value="open" ${!ptt ? 'selected' : ''}>Open mic</option></select>`
        : '<span class="small grey">Use chat: this browser can\'t use the mic</span>'}
      <button class="cbtn ${st.cam ? 'on' : ''}" id="cam" title="Camera">${ICON.cam}</button>
      <button class="cbtn ${v.muted ? '' : 'on'}" id="spk" title="${v.muted ? 'Agents are muted' : 'Agents speak replies aloud'}">${ICON.spk}</button>
      <button class="cbtn" id="skip" title="Skip whoever is speaking">${ICON.skip}</button>
      <label class="cbtn hide-sm" title="With headphones, you can interrupt agents mid-sentence in open-mic mode"><input type="checkbox" id="hp" ${v.headphones ? 'checked' : ''}/> Headphones</label>
      <button class="cbtn red" id="leave" title="Leave call">${ICON.end}</button>`;
    const mic = $('mic');
    if (mic) {
      if (ptt) {
        mic.onpointerdown = (e) => { e.preventDefault(); mic.setPointerCapture?.(e.pointerId); v.pttStart(); };
        mic.onpointerup = mic.onpointercancel = () => v.pttEnd();
      } else mic.onclick = () => v.toggleOpen();
      $('mode').onchange = (e) => v.setMode(e.target.value);
    }
    $('spk').onclick = () => v.setMuted(!v.muted);
    $('skip').onclick = () => v.skip();
    $('hp').onchange = (e) => v.setHeadphones(e.target.checked);
    $('leave').onclick = () => (location.hash = `#/`);
    $('cam').onclick = async () => {
      if (st.cam) { st.cam.getTracks().forEach((t) => t.stop()); st.cam = null; localStorage.setItem('huddle.cam', '0'); }
      else { try { st.cam = await navigator.mediaDevices.getUserMedia({ video: true }); localStorage.setItem('huddle.cam', '1'); } catch { toast('Camera not available'); } }
      paintBar();
    };
    paintTiles();
  };

  // ----- side panel -----
  const fmt = (text) => esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  const msgHtml = (e) => {
    const toTxt = e.to === 'all' ? 'Everyone' : [].concat(e.to).map(nameOf).join(', ');
    const r = roles[e.from];
    return `<div class="msg ${e.from === 'you' ? 'you' : ''} ${e.handoff ? 'handoff' : ''} ${e.error ? 'error' : ''}">
      <div class="meta">${r ? `<span class="av xs" style="background:${r.color}">${initial(r.name)}</span>` : ''}<b>${esc(nameOf(e.from))}</b> → ${esc(toTxt)}
      ${e.via === 'voice' ? '· 🎙' : ''} · ${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      ${r && e.say ? `<button class="replay" data-replay="${e.id}" title="Play again">▶</button>` : ''}</div>
      <div class="text">${fmt(e.text)}</div></div>`;
  };
  const bindReplay = (root) => root.querySelectorAll('[data-replay]').forEach((b) => (b.onclick = () => {
    const e = st.transcript.find((x) => x.id === b.dataset.replay);
    if (e) voice.speak(e.from, e.say, true);
  }));
  const appendMsg = (e) => {
    const box = $('msgs');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.querySelector('.empty')?.remove();
    box.insertAdjacentHTML('beforeend', msgHtml(e));
    bindReplay(box.lastElementChild);
    if (near || e.from === 'you') box.scrollTop = box.scrollHeight;
  };
  const paintMsgs = () => {
    const box = $('msgs');
    box.innerHTML = st.transcript.length ? st.transcript.map(msgHtml).join('')
      : `<div class="empty muted small">Nothing yet. Hold <kbd>Space</kbd> and say “Everyone, introduce yourselves”, or type below.</div>`;
    bindReplay(box);
    box.scrollTop = box.scrollHeight;
  };
  const paintPeople = () => {
    $('people').innerHTML = `<div class="person"><span class="av" style="background:#5f6368">${initial(host)}</span><div class="grow"><b>${esc(host)}</b> <span class="muted small">(you, host)</span></div></div>` +
      p.roles.map((r) => {
        const a = st.agents[r.id] || {};
        return `<div class="person"><span class="av" style="background:${r.color}">${initial(r.name)}</span>
          <div class="grow"><div><b>${esc(r.name)}</b> <span class="muted small">${esc(r.title || '')}</span></div>
          <div class="act">${a.status === 'working' ? esc(a.activity || 'Working…') : a.status === 'error' ? 'Error: ' + esc(a.activity) : 'Idle'} · ${esc(status[r.provider]?.label || r.provider)}</div></div>
          ${a.status === 'working' ? `<button class="btn sm" data-stop="${r.id}">Stop</button>` : ''}</div>`;
      }).join('') + `<div class="row" style="padding:14px 0"><button class="btn sm ghost danger" id="clear">Clear meeting history</button></div>`;
    $('people').querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => ws.send(JSON.stringify({ type: 'stop', id: b.dataset.stop }))));
    $('clear').onclick = () => confirm('Clear the transcript and start every agent fresh?') && ws.send(JSON.stringify({ type: 'clear' }));
  };
  const setPanel = (tab) => {
    const side = $('side');
    if (tab === st.panel && !side.hidden) { side.hidden = true; return; }
    side.hidden = false;
    st.panel = tab;
    side.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.panel));
    $('msgs').hidden = st.panel !== 'chat';
    $('people').hidden = st.panel !== 'people';
    side.querySelector('.compose').hidden = st.panel !== 'chat';
  };
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => setPanel(b.dataset.tab)));
  document.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => setPanel(b.dataset.c)));
  $('close-side').onclick = () => ($('side').hidden = true);
  if (matchMedia('(max-width: 860px)').matches) $('side').hidden = true;
  $('form').onsubmit = (e) => { e.preventDefault(); send($('input').value); $('input').value = ''; };

  const paintAll = () => { paintTiles(); paintMsgs(); paintPeople(); paintHint(); };
  paintBar(); paintHint();
  if (localStorage.getItem('huddle.cam') === '1') $('cam').click();

  // Space = push to talk (when not typing).
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const kd = (e) => { if (e.code === 'Space' && !e.repeat && !typing() && voice.mode === 'ptt') { e.preventDefault(); voice.pttStart(); } };
  const ku = (e) => { if (e.code === 'Space' && !typing() && voice.mode === 'ptt') { e.preventDefault(); voice.pttEnd(); } };
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  onLeave(() => {
    closed = true; ws?.close(); clearInterval(clock); cancelAnimationFrame(raf); voice.destroy();
    st.cam?.getTracks().forEach((t) => t.stop());
    removeEventListener('keydown', kd); removeEventListener('keyup', ku);
  });
}
