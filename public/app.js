import { Voice } from './voice.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const toast = (msg, ms = 2600) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
};
const initial = (s) => (s || '?').trim()[0].toUpperCase();
const COLORS = ['#c2643d', '#3d7ac2', '#3d9c6a', '#8a5cc2', '#c23d7a', '#2f8f8f', '#b7791f', '#5c6bc2'];
const PERMS = { plan: 'Read-only (plan)', acceptEdits: 'Can edit files', bypassPermissions: 'Full autonomy (shell too)' };

let providers = null;
const loadProviders = async (force) => (providers = !force && providers ? providers : await api('/providers'));

let cleanup = null;
async function render() {
  cleanup?.(); cleanup = null;
  document.body.classList.remove('in-meeting');
  const [, a, b, c] = location.hash.split('/');
  try {
    if (a === 'connections') return await viewConnections();
    if (a === 'p' && c === 'meet') return await viewMeeting(b);
    if (a === 'p' && b) return await viewProject(b);
    return await viewHome();
  } catch (e) {
    $app.innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', render);
render();

// ---------------- home ----------------
async function viewHome() {
  const projects = await api('/projects');
  $app.innerHTML = `
  <div class="page">
    <section class="hero">
      <h1>Your AI team,<br/><em>on one call.</em></h1>
      <p>Give each agent a role, bring your own Claude Code, Codex, Gemini or local model, and talk to them like a meeting. Only the one you address answers.</p>
    </section>
    <div class="section-title"><h2>Projects</h2></div>
    <div class="grid">
      ${projects.map((p) => `
        <a class="card project-card" href="#/p/${p.id}">
          <div class="row spread"><h3>${esc(p.name)}</h3><span class="pill">${p.roles.length} agents</span></div>
          <div class="avatars">${p.roles.map((r) => `<span class="av" style="background:${r.color}" title="${esc(r.name)}">${initial(r.name)}</span>`).join('')}</div>
          <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.cwd)}</div>
        </a>`).join('')}
      <form class="card stack" id="new">
        <h3>New project</h3>
        <label class="field">Name<input type="text" name="name" placeholder="e.g. Launch site redesign" required /></label>
        <label class="field">Working folder <span class="hint">Agents read and edit files here.</span><input type="text" name="cwd" placeholder="/Users/you/code/my-app" /></label>
        <label class="field">Start with
          <select name="template"><option value="team">Strategist, Researcher, Developer, Intern</option><option value="blank">No roles</option></select>
        </label>
        <button class="btn primary">Create project</button>
      </form>
    </div>
  </div>`;
  document.getElementById('new').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const p = await api('/projects', { method: 'POST', body: { ...f, cwd: f.cwd || undefined } });
    location.hash = `#/p/${p.id}`;
  };
}

// ---------------- connections ----------------
async function viewConnections() {
  $app.innerHTML = `<div class="page"><p class="muted">Checking what's installed…</p></div>`;
  const prov = await loadProviders(true);
  $app.innerHTML = `
  <div class="page">
    <div class="section-title"><div><h2>Connections</h2><p class="muted" style="margin:6px 0 0">Huddle never asks for an API key. Each agent runs through a tool you've already signed in to on this computer, so it uses your own plan.</p></div>
      <button class="btn" id="refresh">Check again</button></div>
    <div class="grid">
      ${Object.values(prov).map((p) => `
        <div class="card provider-card">
          <div class="row spread"><h3>${esc(p.label)} <span class="muted small">· ${esc(p.vendor)}</span></h3>
            <span class="pill ${p.available ? 'ok' : 'no'}"><span class="dot"></span>${p.available ? 'Connected' : 'Not found'}</span></div>
          ${p.available && p.id === 'ollama' ? `<p class="small muted">Models: ${esc(p.models.join(', ') || 'none pulled yet')}</p>` : ''}
          ${p.available && p.path ? `<p class="small muted"><code>${esc(p.path)}</code></p>` : ''}
          <ol>${p.connect.map((s) => `<li>${esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ol>
        </div>`).join('')}
    </div>
    <div class="section-title"><h2>Voice</h2></div>
    <div class="card small">
      Voice uses your browser's built-in speech: free and with no key. Recognition needs <b>Chrome or Edge</b>; Safari and Firefox can still use chat and hear replies.
      Each agent gets its own voice from those installed on your system (pick one per role in the project setup).
    </div>
  </div>`;
  document.getElementById('refresh').onclick = () => render();
}

// ---------------- project setup ----------------
async function viewProject(pid) {
  const [p, prov] = await Promise.all([api(`/projects/${pid}`), loadProviders()]);
  const voices = await Voice.voices();
  const draft = structuredClone(p);

  const roleCard = (r, i) => {
    const pv = prov[r.provider];
    const models = pv?.models?.length ? pv.models : ['default'];
    return `
    <div class="card role-card" data-i="${i}">
      <div class="role-head">
        <span class="av" style="background:${r.color}">${initial(r.name)}</span>
        <div style="flex:1"><h3>${esc(r.name || 'New role')}</h3><div class="small muted">${esc(r.title || '')}</div></div>
        ${draft.leadId === r.id ? '<span class="pill">Lead</span>' : `<button class="btn sm" data-act="lead">Make lead</button>`}
        <button class="btn sm danger" data-act="del">Remove</button>
      </div>
      <div class="fields">
        <label class="field">Name <span class="hint">What you call them out loud</span><input type="text" data-k="name" value="${esc(r.name)}" /></label>
        <label class="field">Job title<input type="text" data-k="title" value="${esc(r.title)}" /></label>
        <label class="field">Runs on
          <select data-k="provider">${Object.values(prov).map((x) => `<option value="${x.id}" ${x.id === r.provider ? 'selected' : ''}>${esc(x.label)}${x.available ? '' : ' (not connected)'}</option>`).join('')}</select>
        </label>
        <label class="field">Model
          <input type="text" data-k="model" list="models-${i}" value="${esc(r.model || 'default')}" />
          <datalist id="models-${i}">${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
        </label>
        <label class="field">Can do
          <select data-k="permission">${Object.entries(PERMS).map(([k, v]) => `<option value="${k}" ${k === (r.permission || 'acceptEdits') ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
        <label class="field">Voice
          <select data-k="voice"><option value="">Automatic</option>${voices.map((v) => `<option value="${esc(v.name)}" ${v.name === r.voice ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('')}</select>
        </label>
        <label class="field">Nicknames <span class="hint">Comma-separated, for speech slips</span><input type="text" data-k="aliases" value="${esc((r.aliases || []).join(', '))}" placeholder="dev, coder" /></label>
        <label class="field">Colour<input type="color" data-k="color" value="${r.color}" style="height:40px;padding:2px;border-radius:10px;border:1px solid var(--line)" /></label>
      </div>
      <label class="field">Instructions <span class="hint">The role's system prompt. Meeting etiquette (only answer when addressed, short spoken summary) is added automatically.</span>
        <textarea data-k="prompt">${esc(r.prompt)}</textarea></label>
    </div>`;
  };

  const paint = () => {
    $app.innerHTML = `
    <div class="page">
      <div class="row spread">
        <div><a href="#/" class="small muted" style="text-decoration:none">← Projects</a><h1 style="font-size:48px;margin-top:6px">${esc(draft.name)}</h1></div>
        <div class="row"><button class="btn" id="save">Save</button><button class="btn primary" id="join">Start meeting →</button></div>
      </div>
      <div class="card fields" style="margin-top:28px">
        <label class="field">Project name<input type="text" id="pname" value="${esc(draft.name)}" /></label>
        <label class="field">Working folder<input type="text" id="pcwd" value="${esc(draft.cwd)}" /></label>
        <label class="field">Your name <span class="hint">How agents refer to you</span><input type="text" id="phost" value="${esc(draft.hostName)}" /></label>
        <label class="field">Hand-offs <span class="hint">Agents can pass work with "@Name:"</span>
          <select id="phand"><option value="1" ${draft.handoffs !== false ? 'selected' : ''}>Allowed (max 3 hops)</option><option value="0" ${draft.handoffs === false ? 'selected' : ''}>Off</option></select></label>
      </div>
      <div class="section-title"><h2>Team</h2><button class="btn" id="add">+ Add role</button></div>
      <div class="stack" id="roles">${draft.roles.map(roleCard).join('') || '<p class="muted">No roles yet.</p>'}</div>
      <div class="row" style="margin-top:28px;justify-content:flex-end"><button class="btn danger" id="delete">Delete project</button></div>
    </div>`;

    const bindTop = (id, k, map = (v) => v) => (document.getElementById(id).oninput = (e) => (draft[k] = map(e.target.value)));
    bindTop('pname', 'name'); bindTop('pcwd', 'cwd'); bindTop('phost', 'hostName'); bindTop('phand', 'handoffs', (v) => v === '1');
    $app.querySelectorAll('.role-card').forEach((card) => {
      const r = draft.roles[card.dataset.i];
      card.querySelectorAll('[data-k]').forEach((el) => {
        el.oninput = el.onchange = () => {
          const k = el.dataset.k;
          r[k] = k === 'aliases' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value;
          if (k === 'provider') { r.model = 'default'; paint(); }
          if (k === 'color') card.querySelector('.av').style.background = el.value;
        };
      });
      card.querySelector('[data-act=del]').onclick = () => { draft.roles.splice(card.dataset.i, 1); paint(); };
      const lead = card.querySelector('[data-act=lead]');
      if (lead) lead.onclick = () => { draft.leadId = r.id; paint(); };
    });
    document.getElementById('add').onclick = () => {
      draft.roles.push({ id: Math.random().toString(36).slice(2, 10), name: '', title: '', provider: 'claude', model: 'default', permission: 'plan', color: COLORS[draft.roles.length % COLORS.length], prompt: '' });
      paint();
      $app.querySelector('.role-card:last-child [data-k=name]').focus();
    };
    const save = async () => {
      if (draft.roles.some((r) => !r.name.trim())) throw new Error('Every role needs a name.');
      Object.assign(draft, await api(`/projects/${pid}`, { method: 'PUT', body: draft }));
    };
    document.getElementById('save').onclick = () => save().then(() => toast('Saved'), (e) => toast(e.message));
    document.getElementById('join').onclick = () => save().then(() => (location.hash = `#/p/${pid}/meet`), (e) => toast(e.message));
    document.getElementById('delete').onclick = async () => {
      if (!confirm(`Delete "${draft.name}" and its meeting history?`)) return;
      await api(`/projects/${pid}`, { method: 'DELETE' });
      location.hash = '#/';
    };
  };
  paint();
}

// ---------------- meeting ----------------
const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-8 1.3-8 4v2h10v-2c0-1 .4-1.9 1.1-2.7A12 12 0 0 0 8 13Zm8 0c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Z"/></svg>',
  spk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12Zm10-12v12h2V6h-2Z"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.2.25-4.7.72v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41 0L.29 13.2a1 1 0 0 1 0-1.41C3.34 8.9 7.46 7 12 7s8.66 1.9 11.71 4.79a1 1 0 0 1 0 1.41l-2.38 2.37a1 1 0 0 1-1.41 0 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z"/></svg>',
};

async function viewMeeting(pid) {
  const p = await api(`/projects/${pid}`);
  if (!p.roles.length) { location.hash = `#/p/${pid}`; return toast('Add at least one role first.'); }
  document.body.classList.add('in-meeting');
  const roles = Object.fromEntries(p.roles.map((r) => [r.id, r]));
  const st = { transcript: [], agents: {}, target: 'auto', panel: 'chat', speaking: null, queued: new Set(), cam: null, lastAddressed: null };
  const nameOf = (id) => (id === 'you' ? p.hostName || 'You' : roles[id]?.name || id);
  const voice = new Voice({
    roles,
    onSpeaking: (id) => { st.speaking = id; paintTiles(); },
    onQueue: (ids) => { st.queued = new Set(ids); paintTiles(); },
    onCaption: (text, final) => paintCaption(text, final),
    onUtterance: (text) => send(text, 'voice'),
    onState: () => paintBar(),
    onError: (m) => toast(m, 4000),
  });

  $app.innerHTML = `
  <div class="meet">
    <div class="meet-top"><span><b>${esc(p.name)}</b> · <span id="clock"></span></span><span class="small" id="conn">Connecting…</span></div>
    <div class="stage" id="stage" style="--cols:${p.roles.length + 1 <= 2 ? 2 : p.roles.length + 1 <= 4 ? 2 : 3}"></div>
    <aside class="side" id="side">
      <div class="side-head">
        <div class="tabs"><button data-tab="chat" class="on">Chat</button><button data-tab="people">People</button></div>
        <button class="btn sm" id="close-side">✕</button>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="people" id="people" hidden></div>
      <div class="compose">
        <div class="to-row">To <select id="to"><option value="auto">Whoever I name (auto)</option><option value="all">Everyone</option>${p.roles.map((r) => `<option value="${r.id}">${esc(r.name)} only</option>`).join('')}</select></div>
        <form id="form"><input type="text" id="input" placeholder="Message… (start with a name, e.g. “Intern, …”)" autocomplete="off" /><button class="btn primary sm">Send</button></form>
      </div>
    </aside>
    <div class="caption" id="caption"></div>
    <div class="bar">
      <div class="left small" style="color:#aaa;min-width:180px" id="hint"></div>
      <div class="center" id="controls"></div>
      <div class="row"><button class="cbtn" data-c="chat" title="Chat">${ICON.chat}</button><button class="cbtn" data-c="people" title="People">${ICON.people}</button></div>
    </div>
  </div>`;
  const $ = (id) => document.getElementById(id);
  const t0 = Date.now();
  const clock = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);

  // ----- socket -----
  let ws, closed = false;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?project=${pid}`);
    ws.onopen = () => ($('conn').textContent = 'Live');
    ws.onclose = () => { $('conn').textContent = 'Reconnecting…'; if (!closed) setTimeout(connect, 1200); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') { st.transcript = m.transcript; st.agents = m.agents; st.lastAddressed = m.lastAddressed; paintAll(); }
      if (m.type === 'agent') { st.agents[m.id] = { status: m.status, activity: m.activity, queued: m.queued }; paintTiles(); paintPeople(); }
      if (m.type === 'entry') {
        st.transcript.push(m.entry);
        if (m.entry.from === 'you' && m.entry.to.length === 1 && m.entry.to !== 'all') st.lastAddressed = m.entry.to[0];
        appendMsg(m.entry);
        if (m.entry.from === 'you') paintCaption(`${m.entry.text}`, true, m.entry.to);
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
    const you = `<div class="tile ${voice.listening ? 'speaking' : ''}" data-id="you">
      ${st.cam ? '<video autoplay muted playsinline></video>' : `<div class="face" style="background:#5f6368">${initial(p.hostName)}</div>`}
      <div class="label">${esc(p.hostName || 'You')} (you)</div></div>`;
    const tiles = p.roles.map((r) => {
      const a = st.agents[r.id] || {};
      const speaking = st.speaking === r.id;
      const working = a.status === 'working';
      const badges = [
        speaking ? '<span><span class="bars"><i></i><i></i><i></i></span>Speaking</span>' : '',
        !speaking && st.queued.has(r.id) ? '<span>✋ Waiting to speak</span>' : '',
        working ? `<span><span class="spin"></span>${a.queued ? 'Working · more queued' : 'Working'}</span>` : '',
        a.status === 'error' ? '<span style="color:#f28b82">Error</span>' : '',
      ].join('');
      return `<div class="tile ${speaking ? 'speaking' : ''} ${st.target === r.id ? 'target' : ''}" data-id="${r.id}" title="Click to talk only to ${esc(r.name)}">
        ${working && a.activity ? `<div class="activity">${esc(a.activity)}</div>` : ''}
        <div class="badge">${badges}</div>
        <div class="face" style="background:${r.color}">${initial(r.name)}</div>
        <div class="label">${esc(r.name)}${r.title ? ` <span class="model">${esc(r.title)}</span>` : ''} <span class="model">· ${esc(r.provider)}${r.model && r.model !== 'default' ? ' ' + esc(r.model) : ''}</span></div>
      </div>`;
    });
    const stage = $('stage');
    const video = stage.querySelector('video');
    stage.innerHTML = you + tiles.join('');
    if (st.cam) { const v = stage.querySelector('video'); v.srcObject = st.cam; }
    void video;
    stage.querySelectorAll('.tile[data-id]').forEach((t) => {
      if (t.dataset.id === 'you') return;
      t.onclick = () => { st.target = st.target === t.dataset.id ? 'auto' : t.dataset.id; paintTiles(); paintHint(); };
    });
  };

  const paintHint = () => {
    const h = st.target !== 'auto' ? `Talking only to <b style="color:#8ab4f8">${esc(nameOf(st.target))}</b> · click the tile again to release`
      : st.lastAddressed ? `Say a name to switch · now with <b style="color:#fff">${esc(nameOf(st.lastAddressed))}</b>`
      : 'Start with a name: “Intern, …” or “Everyone, …”';
    $('hint').innerHTML = h;
  };

  let capTimer;
  const paintCaption = (text, final, to) => {
    clearTimeout(capTimer);
    const target = to ? (to === 'all' ? 'Everyone' : [].concat(to).map(nameOf).join(', ')) : '';
    $('caption').innerHTML = text ? `${target ? `<span class="to">→ ${esc(target)}</span> ` : ''}${esc(text)}${final ? '' : ' …'}` : '';
    if (final) capTimer = setTimeout(() => ($('caption').textContent = ''), 5000);
  };

  // ----- controls -----
  const paintBar = () => {
    const v = voice;
    $('controls').innerHTML = `
      ${v.supported ? `
        <button class="cbtn ${v.listening ? 'live' : ''}" id="mic" title="${v.mode === 'ptt' ? 'Hold to talk (or hold Space)' : 'Mic on/off'}">${ICON.mic}${v.mode === 'ptt' ? '<span class="hide-sm">Hold to talk</span>' : v.listening ? '<span class="hide-sm">Listening</span>' : '<span class="hide-sm">Mic off</span>'}</button>
        <select id="mode" class="hide-sm" title="How the mic works"><option value="ptt" ${v.mode === 'ptt' ? 'selected' : ''}>Push to talk</option><option value="open" ${v.mode === 'open' ? 'selected' : ''}>Open mic</option></select>`
        : '<span class="small" style="color:#aaa">Voice input needs Chrome or Edge, so use chat</span>'}
      <button class="cbtn ${st.cam ? '' : ''}" id="cam" title="Camera">${ICON.cam}</button>
      <button class="cbtn ${v.muted ? '' : 'on'}" id="spk" title="Agents speak replies aloud">${ICON.spk}</button>
      <button class="cbtn" id="skip" title="Skip whoever is speaking">${ICON.skip}</button>
      <label class="cbtn hide-sm" title="With headphones on, you can interrupt agents mid-sentence"><input type="checkbox" id="hp" ${v.headphones ? 'checked' : ''}/> Headphones</label>
      <button class="cbtn red" id="leave" title="Leave">${ICON.end}</button>`;
    const mic = $('mic');
    if (mic) {
      if (v.mode === 'ptt') {
        mic.onpointerdown = (e) => { e.preventDefault(); v.pttStart(); };
        mic.onpointerup = mic.onpointerleave = () => v.listening && v.pttEnd();
      } else mic.onclick = () => v.toggleOpen();
      $('mode').onchange = (e) => v.setMode(e.target.value);
    }
    $('spk').onclick = () => v.setMuted(!v.muted);
    $('skip').onclick = () => v.skip();
    $('hp').onchange = (e) => v.setHeadphones(e.target.checked);
    $('leave').onclick = () => (location.hash = `#/p/${pid}`);
    $('cam').onclick = async () => {
      if (st.cam) { st.cam.getTracks().forEach((t) => t.stop()); st.cam = null; }
      else { try { st.cam = await navigator.mediaDevices.getUserMedia({ video: true }); } catch { toast('Camera not available'); } }
      paintTiles();
    };
    paintTiles();
  };

  // ----- side panel -----
  const fmt = (text) => esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, '<pre>$1</pre>');
  const msgHtml = (e) => {
    const toTxt = e.to === 'all' ? 'Everyone' : [].concat(e.to).map(nameOf).join(', ');
    const r = roles[e.from];
    return `<div class="msg ${e.from === 'you' ? 'you' : ''} ${e.handoff ? 'handoff' : ''} ${e.error ? 'error' : ''}">
      <div class="meta">${r ? `<span class="av" style="width:18px;height:18px;font-size:10px;border:0;background:${r.color}">${initial(r.name)}</span>` : ''}<b>${esc(nameOf(e.from))}</b> → ${esc(toTxt)}
      ${e.via === 'voice' ? '· 🎙' : ''} · ${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      ${r && e.say ? `<button class="btn sm" data-replay="${e.id}" style="padding:0 8px;margin-left:auto">▶</button>` : ''}</div>
      <div class="text">${fmt(e.text)}</div></div>`;
  };
  const bindReplay = (root) => root.querySelectorAll('[data-replay]').forEach((b) => (b.onclick = () => {
    const e = st.transcript.find((x) => x.id === b.dataset.replay);
    if (e) voice.speak(e.from, e.say, true);
  }));
  const appendMsg = (e) => {
    const box = $('msgs');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.querySelector('p.muted')?.remove();
    box.insertAdjacentHTML('beforeend', msgHtml(e));
    bindReplay(box.lastElementChild);
    if (near || e.from === 'you') box.scrollTop = box.scrollHeight;
  };
  const paintMsgs = () => {
    const box = $('msgs');
    box.innerHTML = st.transcript.length ? st.transcript.map(msgHtml).join('') : `<p class="muted small">Nothing yet. Try: “Researcher, what does this project do?” or “Everyone, introduce yourselves.”</p>`;
    bindReplay(box);
    box.scrollTop = box.scrollHeight;
  };
  const paintPeople = () => {
    $('people').innerHTML = p.roles.map((r) => {
      const a = st.agents[r.id] || {};
      return `<div class="person"><span class="av" style="background:${r.color}">${initial(r.name)}</span>
        <div class="grow"><div><b>${esc(r.name)}</b> <span class="muted small">${esc(r.title || '')}</span></div>
        <div class="act">${a.status === 'working' ? esc(a.activity || 'Working…') : a.status === 'error' ? 'Error: ' + esc(a.activity) : 'Idle'} · ${esc(r.provider)} ${esc(r.model || '')}</div></div>
        ${a.status === 'working' ? `<button class="btn sm" data-stop="${r.id}">Stop</button>` : ''}</div>`;
    }).join('') + `<div class="row" style="padding:14px 0"><button class="btn sm danger" id="clear">Clear meeting history</button></div>`;
    $('people').querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => ws.send(JSON.stringify({ type: 'stop', id: b.dataset.stop }))));
    $('clear').onclick = () => confirm('Clear the transcript and start every agent fresh?') && ws.send(JSON.stringify({ type: 'clear' }));
  };
  const setPanel = (tab) => {
    const side = $('side');
    if (tab === st.panel && !side.hidden && tab !== undefined) { side.hidden = true; return; }
    side.hidden = false;
    st.panel = tab || st.panel;
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

  // Space = push to talk (when not typing).
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const kd = (e) => { if (e.code === 'Space' && !e.repeat && !typing() && voice.mode === 'ptt') { e.preventDefault(); voice.pttStart(); } };
  const ku = (e) => { if (e.code === 'Space' && !typing() && voice.mode === 'ptt' && voice.listening) { e.preventDefault(); voice.pttEnd(); } };
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  cleanup = () => {
    closed = true; ws?.close(); clearInterval(clock); voice.destroy();
    st.cam?.getTracks().forEach((t) => t.stop());
    removeEventListener('keydown', kd); removeEventListener('keyup', ku);
  };
}
