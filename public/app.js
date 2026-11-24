import { api, esc, toast, initial, COLORS, PERMS, connectCards, micCheck, providerMark, claudeCodeCard, orb } from './lib.js';
import { voices, naturalVoices, naturalVoiceFor, previewNatural } from './voice.js';
import { viewMeeting } from './meeting.js';

const $app = document.getElementById('app');
let settings = null;
let cleanup = [];
const onLeave = (fn) => cleanup.push(fn);

async function render() {
  cleanup.forEach((f) => { try { f(); } catch {} });
  cleanup = [];
  document.body.classList.remove('in-meeting', 'wizard');
  settings ||= await api('/settings');
  const [, a, b, c] = location.hash.split('/');
  if (!settings.onboarded && a !== 'welcome') { location.hash = '#/welcome/1'; return; }
  document.querySelectorAll('.nav nav a').forEach((l) => l.classList.toggle('on', l.getAttribute('href') === `#/${a || ''}`));
  try {
    if (a === 'welcome') return await viewWelcome(Number(b) || 1);
    if (a === 'connections') return await viewConnections();
    if (a === 'new') return await viewNewTeam();
    if (a === 'settings') return await viewSettings();
    if (a === 'p' && c === 'meet') return await viewMeeting($app, b, settings, onLeave);
    if (a === 'p' && c === 'mini') return await viewMeeting($app, b, settings, onLeave, { mini: true });
    if (a === 'p' && c === 'lobby') return await viewLobby(b);
    if (a === 'p' && b) return await viewProject(b);
    return await viewHome();
  } catch (e) {
    $app.innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', render);
render();

// Meeting-friendly defaults: quick models, low effort for talkers, a bit more for builders.
const tune = (provider, r) => {
  const builder = r.permission === 'acceptEdits' || r.permission === 'bypassPermissions';
  if (provider === 'claude') return { model: /intern|assistant/i.test(r.name) && !builder ? 'haiku' : 'sonnet', effort: builder ? 'medium' : 'low' };
  if (provider === 'codex') return { model: 'default', effort: builder ? 'medium' : 'low' };
  return { model: 'default', effort: 'default' };
};
const saveSettings = async (x) => (settings = await api('/settings', { method: 'PUT', body: x }));
const connected = (status) => Object.values(status || {}).filter((p) => p.signedIn);

// ======================= onboarding =======================
const STEPS = ['You', 'Connect AI', 'Voice', 'Your team'];
async function viewWelcome(step) {
  document.body.classList.add('wizard');
  const progress = `<ol class="steps">${STEPS.map((s, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><span>${i + 1 < step ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>`;
  const shell = (inner, foot) => `<div class="page narrow">${progress}<div class="wizard-body">${inner}</div><div class="wizard-foot">${foot}</div></div>`;
  const go = (n) => (location.hash = `#/welcome/${n}`);

  if (step === 1) {
    $app.innerHTML = shell(`
      <h1>Your AI team,<br/><em>on one call.</em></h1>
      <p class="lead">Huddle puts your AI agents in a meeting room. Give each one a job, talk to them out loud, and only the one you call on answers. It runs on the Claude or ChatGPT plan you already have: no API keys, nothing to pay us.</p>
      <label class="field big">What should your team call you?<input type="text" id="name" placeholder="Your first name" value="${esc(settings.hostName)}" autofocus /></label>`,
      `<span></span><button class="btn primary lg" id="next">Continue →</button>`);
    const next = async () => {
      const name = document.getElementById('name').value.trim();
      if (!name) return toast('Tell us your name first');
      await saveSettings({ hostName: name });
      go(2);
    };
    document.getElementById('next').onclick = next;
    // Returning false from an on* handler cancels the key, so never return the comparison.
    document.getElementById('name').onkeydown = (e) => { if (e.key === 'Enter') next(); };
    return;
  }

  if (step === 2) {
    $app.innerHTML = shell(`
      <h2>Connect your AI</h2>
      <p class="lead">Sign in with the accounts you already pay for. Huddle drives the official Claude Code and Codex tools on this computer, so it uses your plan and never sees a password or key. Connect at least one.</p>
      <div class="stack" id="cards"></div>`,
      `<button class="btn" id="back">← Back</button><button class="btn primary lg" id="next" disabled>Continue →</button>`);
    const cards = connectCards(document.getElementById('cards'), {
      onChange: (s) => { const n = connected(s).length; const b = document.getElementById('next'); b.disabled = !n; b.textContent = n ? `Continue with ${n} connected →` : 'Connect one to continue'; },
    });
    onLeave(cards.destroy);
    document.getElementById('back').onclick = () => go(1);
    document.getElementById('next').onclick = () => go(3);
    return;
  }

  if (step === 3) {
    $app.innerHTML = shell(`
      <h2>Check your voice</h2>
      <p class="lead">Speech is free and stays on this computer: a local Whisper model turns your voice into text, and a local neural voice model gives every teammate a natural, human-sounding voice. Hold the button and say something.</p>
      <div class="card" id="mc"></div>`,
      `<button class="btn" id="back">← Back</button><div class="row"><button class="btn" id="skip">Skip for now</button><button class="btn primary lg" id="next">Continue →</button></div>`);
    const mc = micCheck(document.getElementById('mc'), { engine: settings.speech.engine, onEngine: (e) => saveSettings({ speech: { engine: e } }) });
    onLeave(mc.destroy);
    document.getElementById('back').onclick = () => go(2);
    document.getElementById('skip').onclick = document.getElementById('next').onclick = () => go(4);
    return;
  }

  if (step === 4) {
    await newTeamFlow((inner, foot) => { $app.innerHTML = shell(inner, foot); }, { back: () => go(3), first: true });
  }
}

// ======================= new team: three ways to start =======================
// 1. Describe the work -> only the people it needs (one quick model call, not a lead).
// 2. Just an all-rounder -> it asks to bring specialists in when it needs them.
// 3. Build it myself -> pick people by hand.
async function newTeamFlow(render, { back, first = false } = {}) {
  const status = await api('/providers');
  const conn = connected(status);
  if (!conn.length) { toast('Connect Claude or ChatGPT first'); location.hash = first ? '#/welcome/2' : '#/connections'; return; }
  const st = { mode: 'describe', name: '', cwd: '', description: '', proposal: null, busy: false, error: '' };
  const MODES = [
    ['describe', 'Describe the work', 'Say what you’re doing and Huddle invites only the people it needs.'],
    ['allrounder', 'Just an all-rounder', 'Start with one capable teammate. It asks to bring in specialists when it needs them.'],
    ['custom', 'Build it myself', 'Pick each teammate, their AI, model and skills by hand.'],
  ];
  const paint = () => {
    const pr = st.proposal;
    render(`
      <h2>${first ? 'Start your first team' : 'New team'}</h2>
      <p class="lead">A team works in one folder. Pick how it comes together; you can bring people in or let them drop off during any call.</p>
      <div class="tpl-grid">${MODES.map(([k, t, d]) => `<button class="tpl ${k === st.mode ? 'on' : ''}" data-mode="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      <div class="fields two" style="margin-top:20px">
        <label class="field">Team name<input type="text" id="pname" placeholder="e.g. Website relaunch" value="${esc(st.name)}" /></label>
        <label class="field">Folder <span class="hint">Where they read and write files</span><input type="text" id="pcwd" placeholder="~/projects/website" value="${esc(st.cwd)}" /></label>
      </div>
      ${st.mode === 'describe' ? `
        <label class="field" style="margin-top:16px">What are you working on?
          <textarea id="desc" placeholder="e.g. A 2D drafting tool in the browser, just for me: lines, circles, snapping, export to DXF.">${esc(st.description)}</textarea></label>
        ${st.error ? `<div class="test-result bad" style="margin-top:10px">✕ ${esc(st.error)}</div>` : ''}
        ${pr ? `<h3 class="sub">${esc(pr.summary || 'Your team')}</h3>
          <div class="team-preview">${pr.roles.map((r, i) => `
            <div class="tp-row">${orb(r.provider, i, { size: 'sm' })}
              <div class="grow"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.title)}</span>
                <div class="small muted">${esc(r.why || '')}</div>
                ${r.skills?.length ? `<div class="chips">${r.skills.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}</div>
              <select data-i="${i}" class="sel-sm">${conn.map((p) => `<option value="${p.id}" ${p.id === r.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
              <button class="btn sm ghost" data-del="${i}" title="Not needed">✕</button>
            </div>`).join('')}</div>` : ''}` : ''}`,
      `<button class="btn" id="back">← Back</button><div class="row">
        ${st.mode === 'describe' && pr ? '<button class="btn" id="again">Describe again</button>' : ''}
        <button class="btn primary lg" id="go" ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spin dark"></span> Working out who you need…'
          : st.mode === 'describe' ? (pr ? 'Start the call →' : 'Assemble the team →') : st.mode === 'allrounder' ? 'Start the call →' : 'Create and add people →'}</button></div>`);
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { st.mode = b.dataset.mode; paint(); }));
    $('pname').oninput = (e) => (st.name = e.target.value);
    $('pcwd').oninput = (e) => (st.cwd = e.target.value);
    if ($('desc')) $('desc').oninput = (e) => (st.description = e.target.value);
    document.querySelectorAll('select[data-i]').forEach((x) => (x.onchange = () => { const r = st.proposal.roles[x.dataset.i]; r.provider = x.value; Object.assign(r, tune(x.value, r)); paint(); }));
    document.querySelectorAll('[data-del]').forEach((x) => (x.onclick = () => { st.proposal.roles.splice(+x.dataset.del, 1); if (!st.proposal.roles.length) st.proposal = null; paint(); }));
    $('back').onclick = back || (() => history.back());
    if ($('again')) $('again').onclick = () => { st.proposal = null; paint(); };
    $('go').onclick = go;
  };
  const folder = async () => {
    const name = st.name.trim() || (st.cwd.trim() ? st.cwd.trim().split('/').filter(Boolean).pop() : '');
    if (!name) throw new Error('Give the team a name (or pick a folder)');
    const dir = st.cwd.trim() || `~/huddle-projects/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const r = await api('/fs/check', { method: 'POST', body: { dir, create: true } });
    return { name, cwd: r.path };
  };
  async function go() {
    st.error = '';
    try {
      if (st.mode === 'describe' && !st.proposal) {
        if (!st.description.trim()) return toast('Describe the work first');
        st.busy = true; paint();
        const where = st.cwd.trim() ? await api('/fs/check', { method: 'POST', body: { dir: st.cwd } }).catch(() => null) : null;
        st.proposal = await api('/teams/propose', { method: 'POST', body: { description: st.description, cwd: where?.ok ? where.path : undefined } });
        if (!st.name.trim()) st.name = st.description.split(/[.,:;\n]/)[0].split(' ').slice(0, 4).join(' ');
        st.busy = false; paint(); return;
      }
      st.busy = true; paint();
      const f = await folder();
      const body = st.mode === 'describe' ? { ...f, mode: 'assembled', roles: st.proposal.roles.map(({ why, ...r }) => r) }
        : st.mode === 'allrounder' ? { ...f, mode: 'allrounder' } : { ...f, mode: 'custom', roles: [] };
      const p = await api('/projects', { method: 'POST', body });
      if (first) await saveSettings({ onboarded: true });
      location.hash = st.mode === 'custom' ? `#/p/${p.id}` : `#/p/${p.id}/lobby`;
    } catch (e) { st.busy = false; st.error = e.message; toast(e.message, 5000); paint(); }
  }
  paint();
}

async function viewNewTeam() {
  await newTeamFlow((inner, foot) => { $app.innerHTML = `<div class="page narrow">${inner}<div class="wizard-foot">${foot}</div></div>`; }, { back: () => (location.hash = '#/') });
}

// ======================= home =======================
async function viewHome() {
  const [projects, status] = await Promise.all([api('/projects'), api('/providers')]);
  const conn = connected(status);
  $app.innerHTML = `
  <div class="page">
    <section class="hero">
      <h1>Good to see you, ${esc(settings.hostName || 'there')}.</h1>
      <p>Pick a team and jump on a call, or start something new.</p>
      <div class="row center">${Object.values(status).map((p) => `<a href="#/connections" class="chip ${p.signedIn ? 'ok' : ''}">${providerMark(p, 18)} ${esc(p.label)} ${p.signedIn ? '✓' : '·'}</a>`).join('')}</div>
    </section>
    <div class="section-title"><h2>Your teams</h2><button class="btn primary" id="new">+ New team</button></div>
    <div class="grid">
      ${projects.map((p) => `
        <div class="card project-card">
          <a href="#/p/${p.id}" class="stretch"><div class="row spread"><h3>${esc(p.name)}</h3><span class="pill">${p.roles.length} agent${p.roles.length === 1 ? '' : 's'}</span></div></a>
          <div class="avatars">${p.roles.map((r, i) => `<span title="${esc(r.name)} · ${esc(status[r.provider]?.label || r.provider)}">${orb(r.provider, i, { size: 'xs' })}</span>`).join('')}</div>
          <div class="small muted ellipsis">${esc(p.cwd)}</div>
          <div class="row"><a class="btn primary sm" href="#/p/${p.id}/lobby">Join call</a><a class="btn sm" href="#/p/${p.id}">Edit team</a></div>
        </div>`).join('') || '<p class="muted">No teams yet.</p>'}
    </div>
  </div>`;
  document.getElementById('new').onclick = () => {
    if (!conn.length) { toast('Connect Claude or ChatGPT first'); location.hash = '#/connections'; return; }
    location.hash = '#/new';
  };
}

// ======================= connections =======================
async function viewConnections() {
  $app.innerHTML = `
  <div class="page narrow">
    <h2>Connections</h2>
    <p class="lead">Each agent runs on an AI account you already have. Huddle uses the official tools on this computer (Claude Code, Codex, Gemini CLI, Ollama), so your plan pays and no API key is stored here.</p>
    <div class="stack" id="cards"></div>
    <h3 class="sub">Use Huddle from Claude Code</h3>
    <div id="cc"></div>
  </div>`;
  claudeCodeCard(document.getElementById('cc'));
  const cards = connectCards(document.getElementById('cards'));
  onLeave(cards.destroy);
}

// ======================= settings =======================
async function viewSettings() {
  $app.innerHTML = `
  <div class="page narrow">
    <h2>Settings</h2>
    <div class="card stack" style="margin-top:20px">
      <label class="field">Your name<input type="text" id="name" value="${esc(settings.hostName)}" /></label>
      <label class="field">Agent voices
        <select id="voicestyle"><option value="natural" ${settings.speech.voices !== 'system' ? 'selected' : ''}>Natural: human-sounding, runs locally (Kokoro)</option><option value="system" ${settings.speech.voices === 'system' ? 'selected' : ''}>System voices: instant, more robotic</option></select></label>
      <label class="field">Speech recognition quality <span class="hint">For Local Whisper</span>
        <select id="quality"><option value="accurate" ${settings.speech.quality !== 'fast' ? 'selected' : ''}>Accurate (base, ~75 MB)</option><option value="fast" ${settings.speech.quality === 'fast' ? 'selected' : ''}>Fast (tiny, ~40 MB)</option><option value="best" ${settings.speech.quality === 'best' ? 'selected' : ''}>Best (small, ~250 MB, slower)</option></select></label>
      <div class="row"><button class="btn primary" id="save">Save</button></div>
    </div>
    <h3 class="sub">Microphone & speech</h3>
    <div class="card" id="mc"></div>
    <h3 class="sub">Start over</h3>
    <div class="card row spread"><span class="small muted">Run the welcome steps again. Your teams are kept.</span><button class="btn" id="redo">Run setup again</button></div>
  </div>`;
  const mc = micCheck(document.getElementById('mc'), { engine: settings.speech.engine, onEngine: (e) => saveSettings({ speech: { engine: e } }) });
  onLeave(mc.destroy);
  document.getElementById('save').onclick = async () => {
    const quality = document.getElementById('quality').value;
    await saveSettings({ hostName: document.getElementById('name').value.trim(), speech: { quality, voices: document.getElementById('voicestyle').value } });
    api('/stt/warm', { method: 'POST', body: { quality } });
    toast('Saved');
  };
  document.getElementById('redo').onclick = async () => { await saveSettings({ onboarded: false }); location.hash = '#/welcome/1'; };
}

// ======================= team setup =======================
async function viewProject(pid) {
  const [p, status, vlist, nlist, skillLib] = await Promise.all([api(`/projects/${pid}`), api('/providers'), voices(), naturalVoices(), api('/skills').catch(() => [])]);
  const draft = structuredClone(p);
  const tests = {};
  let dirty = false;

  const roleCard = (r, i) => {
    const prov = status[r.provider];
    const models = prov?.models?.length ? prov.models : [{ id: 'default', label: 'Default' }];
    const hasModel = models.some((m) => m.id === (r.model || 'default'));
    const t = tests[r.id];
    return `
    <div class="card role-card" data-i="${i}">
      <div class="role-head">
        ${orb(r.provider, i, { size: 'md' })}
        <div class="grow"><h3>${esc(r.name || 'New teammate')}</h3><div class="small muted">${esc(r.title || '')}${prov ? ` · runs on ${esc(prov.label)}` : ''}</div></div>
        ${draft.leadId === r.id ? '<span class="pill" title="Answers when you haven\'t named anyone yet">Lead</span>' : `<button class="btn sm ghost" data-act="lead">Make lead</button>`}
        <button class="btn sm" data-act="test" ${t === 'run' ? 'disabled' : ''}>${t === 'run' ? '<span class="spin dark"></span> Testing' : 'Test'}</button>
        <button class="btn sm ghost danger" data-act="del" title="Remove">✕</button>
      </div>
      ${prov && !prov.signedIn ? `<div class="note small">${esc(prov.label)} isn't connected. <a href="#/connections">Connect it</a> or pick another.</div>` : ''}
      ${t && t !== 'run' ? `<div class="test-result ${t.error ? 'bad' : ''}">${t.error ? '✕ ' + esc(t.error) : `✓ ${esc(r.name)}: “${esc(t.reply)}”`}</div>` : ''}
      <div class="fields">
        <label class="field">Name <span class="hint">What you call them out loud</span><input type="text" data-k="name" value="${esc(r.name)}" placeholder="e.g. Intern" /></label>
        <label class="field">Job title<input type="text" data-k="title" value="${esc(r.title)}" placeholder="e.g. Research intern" /></label>
        <label class="field">AI account
          <select data-k="provider">${Object.values(status).map((x) => `<option value="${x.id}" ${x.id === r.provider ? 'selected' : ''} ${x.signedIn || x.id === r.provider ? '' : 'disabled'}>${esc(x.label)} · ${esc(x.product)}${x.signedIn ? '' : ' (not connected)'}</option>`).join('')}</select></label>
        <label class="field">Model
          <select data-k="model">${models.map((m) => `<option value="${esc(m.id)}" ${m.id === (r.model || 'default') ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}${hasModel ? '' : `<option selected value="${esc(r.model)}">${esc(r.model)}</option>`}</select></label>
        ${prov?.efforts?.length ? `<label class="field">Effort <span class="hint">Lower answers faster in calls</span>
          <select data-k="effort">${prov.efforts.map((e) => `<option value="${e}" ${e === (r.effort || ((r.permission === 'acceptEdits' || r.permission === 'bypassPermissions') ? 'medium' : 'low')) ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}</select></label>` : ''}
        <label class="field">Allowed to
          <select data-k="permission">${Object.entries(PERMS).map(([k, v]) => `<option value="${k}" ${k === (r.permission || 'acceptEdits') ? 'selected' : ''} title="${esc(v.hint)}">${v.label}</option>`).join('')}</select></label>
        <label class="field">Voice
          <div class="row nowrap"><select data-k="voice">
            <optgroup label="Natural voices (recommended)">${nlist.map((v) => `<option value="${v.id}" ${v.id === naturalVoiceFor(nlist, r, i) ? 'selected' : ''}>${esc(v.label)} · ${v.accent} ${v.gender}</option>`).join('')}</optgroup>
            <optgroup label="System voices (robotic)">${vlist.map((v) => `<option value="${esc(v.name)}" ${v.name === r.voice ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('')}</optgroup>
          </select><button class="btn sm" data-act="hear" title="Hear this voice">▶</button></div></label>
        <label class="field">Also answers to <span class="hint">Nicknames, comma-separated</span><input type="text" data-k="aliases" value="${esc((r.aliases || []).join(', '))}" placeholder="dev, coder" /></label>
        <label class="field">Colour<input type="color" data-k="color" value="${r.color}" class="color" /></label>
      </div>
      ${r.provider === 'claude' ? `<div class="field">Skills <span class="hint">From Anthropic's skills library, loaded only into this teammate's Claude Code session</span>
        <div class="chips big">${(r.skills || []).map((k) => `<span>${esc(k)} <button data-unskill="${esc(k)}" title="Remove">✕</button></span>`).join('') || '<span class="muted">Picked automatically when you save</span>'}
          <select data-addskill class="sel-sm"><option value="">+ Add a skill</option>${skillLib.filter((k) => !(r.skills || []).includes(k.id)).map((k) => `<option value="${esc(k.id)}" title="${esc(k.description)}">${esc(k.id)}</option>`).join('')}</select></div></div>` : ''}
      <label class="field">Instructions <span class="hint">How this teammate should think and work. Meeting manners (answer only when called on, short spoken summary) are added for you.</span>
        <textarea data-k="prompt" placeholder="e.g. You research competitors and summarise findings with sources.">${esc(r.prompt)}</textarea></label>
    </div>`;
  };

  const paint = () => {
    $app.innerHTML = `
    <div class="page">
      <div class="row spread">
        <div><a href="#/" class="small muted plain">← Teams</a><h1 class="title">${esc(draft.name)}</h1></div>
        <div class="row"><span class="small muted" id="dirty">${dirty ? 'Unsaved changes' : ''}</span><button class="btn" id="save">Save</button><button class="btn primary" id="join">Join call →</button></div>
      </div>
      <div class="card fields" style="margin-top:24px">
        <label class="field">Team name<input type="text" id="pname" value="${esc(draft.name)}" /></label>
        <label class="field">Folder <span class="hint">Agents work in here</span><input type="text" id="pcwd" value="${esc(draft.cwd)}" /></label>
        <label class="field">Agents can pass work <span class="hint">With a line like "@Developer: …"</span>
          <select id="phand"><option value="1" ${draft.handoffs !== false ? 'selected' : ''}>Yes (up to 3 hand-offs)</option><option value="0" ${draft.handoffs === false ? 'selected' : ''}>No</option></select></label>
      </div>
      <div class="section-title"><h2>Teammates</h2><button class="btn" id="add">+ Add teammate</button></div>
      <div class="stack" id="roles">${draft.roles.map(roleCard).join('') || '<div class="card muted">No teammates yet. Add one to get started.</div>'}</div>
      <div class="row" style="margin-top:28px;justify-content:flex-end"><button class="btn ghost danger" id="delete">Delete team</button></div>
    </div>`;
    const $ = (id) => document.getElementById(id);
    const touch = () => { dirty = true; $('dirty').textContent = 'Unsaved changes'; };
    $('pname').oninput = (e) => { draft.name = e.target.value; touch(); };
    $('pcwd').oninput = (e) => { draft.cwd = e.target.value; touch(); };
    $('phand').onchange = (e) => { draft.handoffs = e.target.value === '1'; touch(); };
    $app.querySelectorAll('.role-card').forEach((card) => {
      const r = draft.roles[card.dataset.i];
      card.querySelectorAll('[data-k]').forEach((el) => {
        el.oninput = el.onchange = () => {
          const k = el.dataset.k;
          r[k] = k === 'aliases' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value;
          touch();
          if (k === 'provider') { Object.assign(r, tune(r.provider, r)); paint(); }
          if (k === 'color') card.querySelector('.av')?.style.setProperty('background', el.value);
          if (k === 'name') card.querySelector('h3').textContent = el.value || 'New teammate';
        };
      });
      card.querySelectorAll('[data-unskill]').forEach((b) => (b.onclick = () => { r.skills = (r.skills || []).filter((k) => k !== b.dataset.unskill); touch(); paint(); }));
      const add = card.querySelector('[data-addskill]');
      if (add) add.onchange = () => { if (add.value) { r.skills = [...(r.skills || []), add.value]; touch(); paint(); } };
      card.querySelector('[data-act=del]').onclick = () => { if (confirm(`Remove ${r.name || 'this teammate'}?`)) { draft.roles.splice(card.dataset.i, 1); touch(); paint(); } };
      const lead = card.querySelector('[data-act=lead]');
      if (lead) lead.onclick = () => { draft.leadId = r.id; touch(); paint(); };
      card.querySelector('[data-act=hear]').onclick = async (e) => {
        const b = e.currentTarget; const v = card.querySelector('[data-k=voice]').value;
        if (!nlist.some((x) => x.id === v)) { const u = new SpeechSynthesisUtterance(`Hi, I'm ${r.name || 'your teammate'}.`); u.voice = vlist.find((x) => x.name === v) || null; speechSynthesis.speak(u); return; }
        b.innerHTML = '<span class="spin dark"></span>';
        try { await previewNatural(`Hi ${settings.hostName || 'there'}, I'm ${r.name || 'your new teammate'}. Ready when you are.`, v); }
        catch { toast('Voice model is still downloading. Try again in a moment.'); }
        b.textContent = '▶';
      };
      card.querySelector('[data-act=test]').onclick = async () => {
        tests[r.id] = 'run'; paint();
        try { tests[r.id] = await api(`/providers/${r.provider}/test`, { method: 'POST', body: { model: r.model, effort: r.effort } }); }
        catch (e) { tests[r.id] = { error: e.message }; }
        paint();
      };
    });
    $('add').onclick = () => {
      const prov = Object.values(status).find((x) => x.signedIn)?.id || 'claude';
      draft.roles.push({ id: Math.random().toString(36).slice(2, 10), name: '', title: '', provider: prov, ...tune(prov, { name: '', permission: 'plan' }), permission: 'plan', color: COLORS[draft.roles.length % COLORS.length], prompt: '' });
      touch(); paint();
      $app.querySelector('.role-card:last-child [data-k=name]').focus();
    };
    $('save').onclick = () => save().then(() => toast('Saved'), (e) => toast(e.message));
    $('join').onclick = () => save().then(() => (location.hash = `#/p/${pid}/lobby`), (e) => toast(e.message));
    $('delete').onclick = async () => {
      if (!confirm(`Delete "${draft.name}" and its meeting history? Files in the folder are not touched.`)) return;
      await api(`/projects/${pid}`, { method: 'DELETE' });
      location.hash = '#/';
    };
  };
  const save = async () => {
    if (draft.roles.some((r) => !r.name.trim())) throw new Error('Every teammate needs a name.');
    const names = draft.roles.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('Two teammates share a name. Give each a different one so you can call on them.');
    Object.assign(draft, await api(`/projects/${pid}`, { method: 'PUT', body: draft }));
    dirty = false;
  };
  paint();
}

// ======================= lobby (pre-join) =======================
async function viewLobby(pid) {
  const [p, status] = await Promise.all([api(`/projects/${pid}`), api('/providers')]);
  if (!p.roles.length) { toast('Add a teammate first'); location.hash = `#/p/${pid}`; return; }
  const missing = [...new Set(p.roles.filter((r) => !status[r.provider]?.signedIn).map((r) => status[r.provider]?.label || r.provider))];
  const folder = await api('/fs/check', { method: 'POST', body: { dir: p.cwd } });
  $app.innerHTML = `
  <div class="page lobby">
    <div class="lobby-left">
      <div class="preview" id="preview"><div class="face big" style="background:#5f6368">${initial(settings.hostName)}</div><video autoplay muted playsinline hidden></video>
        <button class="cbtn" id="cam" title="Camera">📷</button></div>
      <div class="card" id="mc"></div>
    </div>
    <div class="lobby-right">
      <h2>Ready to join?</h2>
      <p class="muted">${esc(p.name)}</p>
      <div class="team-preview">${p.roles.map((r, i) => `
        <div class="tp-row">${orb(r.provider, i, { size: 'sm' })}
          <div class="grow"><b>${esc(r.name)}</b><div class="small muted">${esc(r.title || '')}</div></div>
          <span class="pill ${status[r.provider]?.signedIn ? 'ok' : 'no'}">${esc(status[r.provider]?.label || r.provider)}</span></div>`).join('')}</div>
      ${folder.ok ? '' : `<div class="note small">This team's folder doesn't exist any more: <code>${esc(p.cwd)}</code>. Agents can't work until you <a href="#/p/${pid}">pick another folder</a>.</div>`}
      ${missing.length ? `<div class="note small">${esc(missing.join(', '))} ${missing.length > 1 ? 'aren\'t' : 'isn\'t'} connected, so those teammates can't answer. <a href="#/connections">Connect</a></div>` : ''}
      <div class="tips small muted">
        <b>How to talk to them</b>
        <ul><li>Start with a name: “<i>${esc(p.roles.at(-1).name)}, can you…</i>”</li><li>“<i>Everyone, …</i>” asks the whole team; they answer one at a time.</li>
        <li>Hold <kbd>Space</kbd> to talk. Click a tile to talk to just that person.</li></ul>
      </div>
      <div class="row"><button class="btn primary lg" id="join">Join now</button><a class="btn lg" href="#/p/${pid}">Edit team</a></div>
    </div>
  </div>`;
  const mc = micCheck(document.getElementById('mc'), { engine: settings.speech.engine, onEngine: (e) => saveSettings({ speech: { engine: e } }) });
  onLeave(mc.destroy);
  let cam = null;
  const v = document.querySelector('#preview video');
  document.getElementById('cam').onclick = async () => {
    if (cam) { cam.getTracks().forEach((t) => t.stop()); cam = null; v.hidden = true; localStorage.setItem('huddle.cam', '0'); return; }
    try { cam = await navigator.mediaDevices.getUserMedia({ video: true }); v.srcObject = cam; v.hidden = false; localStorage.setItem('huddle.cam', '1'); }
    catch { toast('Camera not available'); }
  };
  onLeave(() => cam?.getTracks().forEach((t) => t.stop()));
  document.getElementById('join').onclick = () => (location.hash = `#/p/${pid}/meet`);
}
