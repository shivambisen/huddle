// A live meeting: one transcript, one floor, and an agent per role.
//
// What makes it feel like a meeting rather than a chat:
//  - Agents think out loud. Every "SAY:" line is sent to be spoken the moment
//    it's written, so you hear "Sure, let me check the repo" within a couple of
//    seconds, then progress, then the outcome.
//  - Claude agents keep one process open for the whole call (no boot per turn).
//  - If you keep talking before an agent has said anything, it drops its
//    half-formed reply and starts again with everything you said.
//  - Agents can say "PASS" when a group question has nothing for them.
//  - Hand-offs only happen when you asked for that teammate to be involved.
import fs from 'node:fs';
import path from 'node:path';
import { runTurn, findBin } from './providers.js';
import { ClaudeSession } from './claude-session.js';
import { SmartAddressing } from './addressing.js';
import { route, splitReply, aliasesFor } from './router.js';

const MAX_HANDOFF_DEPTH = 2;
const MERGE_WINDOW_MS = 20000;
let seq = Date.now();
const uid = () => (seq++).toString(36);
const SAY_RE = /^\s*(?:[-*]\s*)?\**SAY:?\**\s*:?\s*(.+)$/i;
const cleanSay = (s) => s.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
// No effort chosen: keep conversation snappy, give builders a little more thinking.
export const effortFor = (role) => role.effort || (role.permission === 'acceptEdits' || role.permission === 'bypassPermissions' ? 'medium' : 'low');

export class Meeting {
  constructor(project, dataDir, emit, opts = {}) {
    this.project = project;
    this.emit = emit;
    this.opts = opts; // { smartAddressing: () => bool }
    this.file = path.join(dataDir, `${project.id}.transcript.json`);
    // Each agent's Claude/Codex session id, kept across Huddle restarts so agents keep their memory
    // and you can open their real session in Claude Code or Codex.
    this.sessionsFile = path.join(dataDir, `${project.id}.sessions.json`);
    try { this.sessions = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8')); } catch { this.sessions = {}; }
    this.transcript = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.lastAddressed = null;
    this.agents = new Map();
    this.router = new SmartAddressing(project.cwd);
    this.syncRoles(project);
  }

  syncRoles(project) {
    this.project = project;
    for (const r of project.roles)
      if (!this.agents.has(r.id))
        this.agents.set(r.id, { status: 'idle', activity: '', pending: false, depth: 0, lastSeen: this.transcript.length, state: { sessionId: this.sessions[r.id]?.codex || null }, session: null, turn: null });
    for (const [id, a] of [...this.agents]) if (!project.roles.some((r) => r.id === id)) { a.session?.stop(); this.agents.delete(id); }
  }

  role(id) { return this.project.roles.find((r) => r.id === id); }
  host() { return this.project.hostName || 'You'; }
  name(id) { return id === 'you' ? this.host() : this.role(id)?.name || id; }

  snapshot() {
    return {
      transcript: this.transcript.slice(-300),
      agents: Object.fromEntries([...this.agents].map(([id, a]) => [id, { status: a.status, activity: a.activity }])),
      lastAddressed: this.lastAddressed,
    };
  }

  add(entry) {
    const e = { id: uid(), ts: Date.now(), ...entry };
    this.transcript.push(e);
    fs.writeFile(this.file, JSON.stringify(this.transcript.slice(-2000)), () => {});
    this.emit({ type: 'entry', entry: e });
    return e;
  }

  setStatus(id, status, activity = '') {
    const a = this.agents.get(id);
    if (!a) return;
    a.status = status;
    a.activity = activity;
    this.emit({ type: 'agent', id, status, activity, queued: a.pending });
  }

  // ---------- warm-up: open each Claude agent's process as the call starts ----------
  async warm() {
    if (!fs.existsSync(this.project.cwd)) {
      for (const r of this.project.roles) this.setStatus(r.id, 'error', `Team folder is missing: ${this.project.cwd}`);
      return;
    }
    this.router.cwd = this.project.cwd;
    if (this.opts.smartAddressing?.() !== false && this.project.roles.length > 1) this.router.warm().catch(() => {});
    for (const r of this.project.roles) if (r.provider === 'claude') this.ensureSession(r.id).catch((e) => this.setStatus(r.id, 'error', e.message));
  }

  checkFolder() {
    if (!fs.existsSync(this.project.cwd)) throw new Error(`This team's folder no longer exists (${this.project.cwd}). Change it in the team settings.`);
  }

  async ensureSession(id) {
    const a = this.agents.get(id);
    const role = this.role(id);
    if (!a || role?.provider !== 'claude') return null;
    this.checkFolder();
    if (!a.session) {
      const bin = await findBin('claude');
      if (!bin) throw new Error("Claude Code isn't installed. Connect it under Connections.");
      a.session = new ClaudeSession({ bin, label: role.name });
      a.session.sessionId = this.sessions[id]?.claude || null;
      a.session.onMissingSession = () => { delete this.sessions[id]; fs.writeFile(this.sessionsFile, JSON.stringify(this.sessions, null, 2), () => {}); setTimeout(() => this.ensureSession(id).catch(() => {}), 100); };
    }
    a.session.ensure({ cwd: this.project.cwd, system: this.systemPrompt(id), model: role.model, effort: effortFor(role), permission: role.permission, name: `Huddle · ${this.project.name} · ${role.name}` });
    return a.session;
  }

  // ---------- the host speaks ----------
  // Who did the host mean, when they didn't say a name?
  //  1. Still talking (within a few seconds of their last line): same people.
  //  2. An agent just asked them a question: that agent.
  //  3. Otherwise ask the fast router, falling back to whoever they last talked to.
  async resolveUnnamed(text, roles, fallback, prev) {
    if (prev && Date.now() - prev.ts < 6000) return { targets: await prev.targets, reason: 'continued' };
    const lastHost = this.transcript.findLastIndex((e) => e.from === 'you');
    const asker = this.transcript.slice(lastHost + 1).reverse().find((e) => e.from !== 'you' && !e.handoff && /\?\s*$/.test(e.say || e.text));
    if (asker && Date.now() - asker.ts < 120000 && roles.some((r) => r.id === asker.from)) return { targets: [asker.from], reason: 'answering' };
    if (roles.length > 1 && this.opts.smartAddressing?.() !== false) {
      this.emit({ type: 'routing', text });
      const recent = this.transcript.slice(-8).map((e) => `${this.name(e.from)} → ${e.to === 'all' ? 'everyone' : [].concat(e.to).map((t) => this.name(t)).join(', ')}: ${String(e.text).slice(0, 220)}`).join('\n');
      const picked = await this.router.pick({ roles, recent, text, host: this.host(), lastAddressed: this.lastAddressed, timeoutMs: 3000 });
      if (picked) return { targets: picked, reason: 'guessed' };
    }
    return fallback;
  }

  async say({ text, to = 'auto', via = 'chat' }) {
    text = String(text || '').trim();
    if (!text) return;
    const roles = this.project.roles;
    const prev = this.lastHostLine;
    let done;
    let delivered;
    const mine = { ts: Date.now(), targets: new Promise((r) => (done = r)), delivered: new Promise((r) => (delivered = r)) };
    this.lastHostLine = mine;
    let { targets, reason } = route(text, roles, { to, lastAddressed: this.lastAddressed, leadId: this.project.leadId });
    if (reason === 'continuing' || reason === 'lead') ({ targets, reason } = await this.resolveUnnamed(text, roles, { targets, reason }, prev));
    done(targets);
    if (prev) await prev.delivered; // keep the host's lines in order
    if (targets.length === 1) this.lastAddressed = targets[0];
    const toAll = targets.length === roles.length && roles.length > 1;
    const entry = this.add({ from: 'you', to: toAll ? 'all' : targets, text, via, reason });
    for (const id of targets) this.deliver(id, entry);
    delivered();
  }

  deliver(id, entry, depth = 0) {
    const a = this.agents.get(id);
    if (!a) return;
    a.depth = Math.max(a.depth, depth);
    if (a.status === 'working') {
      const t = a.turn;
      // You're still talking: restart a reply that hasn't said or done anything yet.
      if (t && entry.from === 'you' && !t.tools && Date.now() - t.startedAt < MERGE_WINDOW_MS) {
        if (t.spoken.length) this.add({ from: id, to: ['you'], text: t.spoken.join(' '), say: t.spoken.join(' '), spoken: true, interrupted: true });
        t.merged = true;
        a.lastSeen = t.fromIndex;
        a.pending = true;
        this.interrupt(id);
        return;
      }
      a.pending = true;
      this.emit({ type: 'agent', id, status: 'working', activity: a.activity, queued: true });
      return;
    }
    this.run(id);
  }

  interrupt(id) {
    const a = this.agents.get(id);
    if (!a?.turn) return;
    if (a.session?.turn) a.session.interrupt();
    a.turn.abort?.abort();
  }
  stop(id) { const a = this.agents.get(id); if (a?.turn) { a.pending = false; this.interrupt(id); } }

  // ---------- prompts ----------
  systemPrompt(id) {
    const role = this.role(id);
    const host = this.host();
    const roster = this.project.roles.map((r) => `- ${r.name}${r.title && r.title !== r.name ? ` (${r.title})` : ''}${r.id === id ? '  ← you' : ''}`).join('\n');
    return [
      `You are ${role.name}${role.title ? `, the ${role.title},` : ''} in a live voice meeting with ${host} about the "${this.project.name}" project. Your working folder is the project folder.`,
      `People on the call:\n- ${host} (the host)\n${roster}`,
      '',
      'HOW TO TALK. This is a spoken conversation, not a chat:',
      '- Lines that start with "SAY:" are read aloud right away. Everything else is shown in the chat as notes.',
      '- Start every reply with a SAY: line before doing anything else: a short, natural reaction or what you are about to do ("Sure, let me look at the code.").',
      '- If you work for a while (reading files, searching, coding), add a short SAY: progress line between steps now and then.',
      '- End with a SAY: line giving the answer or outcome in one or two sentences, the way a colleague would say it.',
      '- Each SAY: line is one or two plain spoken sentences: under 30 words, no markdown, no code, no lists.',
      `- Keep notes short too. No essays or long bullet lists unless ${host} asks for detail. Ask at most one question, and never re-ask something already answered.`,
      '',
      'WHEN TO SPEAK:',
      '- Act only on lines marked "(to you)" or "(to everyone)". Lines for teammates are context.',
      '- For a line to everyone where you have nothing useful to add, reply with exactly: PASS',
      '',
      'TEAMWORK:',
      `- ${host} makes the decisions and assigns the work. Recommend; don't decide for them.`,
      this.project.handoffs !== false
        ? `- Only pass work to a teammate when ${host} asks you to involve them. Then write a line "@Name: the request". Never hand off on your own initiative.`
        : '- Do not hand work to teammates.',
      role.prompt ? `\nYOUR ROLE:\n${role.prompt}` : '',
    ].filter((x) => x !== '').join('\n');
  }

  turnMessage(id, delta) {
    const role = this.role(id);
    const lines = delta.map((e) => {
      const forMe = e.to === 'all' || (Array.isArray(e.to) && e.to.includes(id));
      const tag = e.to === 'all' ? '(to everyone)' : forMe ? '(to you)' : `(to ${[].concat(e.to).map((t) => this.name(t)).join(', ')})`;
      return `${this.name(e.from)} ${tag}: ${e.text}`;
    });
    return `Meeting transcript since your last turn:\n${lines.join('\n') || '(nothing new)'}\n\nRespond now as ${role.name}. Start with a SAY: line.`;
  }

  // ---------- one agent turn ----------
  async run(id) {
    const a = this.agents.get(id);
    const role = this.role(id);
    if (!a || !role) return;
    const fromIndex = a.lastSeen;
    const delta = this.transcript.slice(fromIndex).filter((e) => e.from !== id);
    const hostLines = delta.filter((e) => e.from === 'you' && (e.to === 'all' || [].concat(e.to).includes(id)));
    const depth = a.depth;
    a.lastSeen = this.transcript.length;
    a.pending = false;
    a.depth = 0;
    const turn = (a.turn = { fromIndex, startedAt: Date.now(), spoken: [], tools: 0, text: '', streamed: false, merged: false, abort: new AbortController(), lastDraft: 0 });

    const speak = (line) => {
      const s = cleanSay(line);
      if (!s || turn.spoken.includes(s)) return;
      turn.spoken.push(s);
      this.emit({ type: 'speech', id, text: s });
      this.opts.onSpeech?.(this.project, id, s);
    };
    const scan = (final) => {
      const lines = turn.text.split('\n');
      for (const l of final ? lines : lines.slice(0, -1)) { const m = l.match(SAY_RE); if (m) speak(m[1]); }
    };
    const draft = () => {
      if (Date.now() - turn.lastDraft < 200) return;
      turn.lastDraft = Date.now();
      this.emit({ type: 'draft', id, text: turn.text.replace(/^\s*SAY:\s*/gim, '') });
    };
    const onEvent = (ev) => {
      if (turn.merged) return;
      if (ev.kind === 'delta') { turn.streamed = true; turn.text += ev.text; scan(false); draft(); }
      else if (ev.kind === 'blockEnd') { turn.text += '\n'; scan(false); }
      else if (ev.kind === 'text' && !turn.streamed) { turn.text += ev.text + '\n'; scan(true); draft(); }
      else if (ev.kind === 'tool') { turn.tools++; this.setStatus(id, 'working', `${ev.name}${ev.detail ? ': ' + ev.detail : ''}`); }
    };

    this.setStatus(id, 'working', 'thinking…');
    try {
      let reply;
      const message = this.turnMessage(id, delta);
      if (role.provider === 'claude') {
        const session = await this.ensureSession(id);
        reply = await session.send(message, onEvent);
      } else {
        this.checkFolder();
        const system = this.systemPrompt(id);
        reply = await runTurn({ role: { ...role, effort: effortFor(role) }, cwd: this.project.cwd, system, message, fullPrompt: `${system}\n\n---\n${message}`, state: a.state, signal: turn.abort.signal, onEvent });
      }
      if (turn.merged) throw new Error('Stopped');
      reply = String(reply || '').trim();
      if (/^PASS\.?$/i.test(reply) || (!reply && !turn.spoken.length)) {
        this.emit({ type: 'draft', id, text: '' });
        this.setStatus(id, 'idle');
        return;
      }
      // Remember the session only once it has a real turn in it (Claude writes the file then).
      if (role.provider === 'codex' && a.state.sessionId && a.state.sessionId !== this.sessions[id]?.codex) this.saveSession(id, 'codex', a.state.sessionId);
      if (role.provider === 'claude' && a.session?.sessionId && a.session.sessionId !== this.sessions[id]?.claude) this.saveSession(id, 'claude', a.session.sessionId);
      turn.text = reply;
      scan(true);
      if (!turn.spoken.length) speak(splitReply(reply).say); // the agent forgot SAY: lines
      const text = reply.split('\n').map((l) => { const m = l.match(SAY_RE); return m ? cleanSay(m[1]) : l; }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      this.add({ from: id, to: ['you'], text, say: turn.spoken.join(' '), spoken: true });
      this.setStatus(id, 'idle');
      if (this.project.handoffs !== false && depth < MAX_HANDOFF_DEPTH) this.handoffs(id, reply, depth + 1, hostLines);
    } catch (err) {
      this.emit({ type: 'draft', id, text: '' });
      if (err.message === 'Stopped') {
        if (!turn.merged) this.add({ from: id, to: ['you'], text: '(stopped)', stopped: true });
        this.setStatus(id, 'idle');
      } else {
        // Expired logins are the common case: say what to do, not the raw error.
        const signIn = /authenticat|oauth|not signed in|log ?in|unauthori[sz]ed|401/i.test(err.message);
        const account = role.provider === 'codex' ? 'ChatGPT' : role.provider === 'gemini' ? 'Google' : 'Claude';
        const text = signIn
          ? `⚠️ My ${account} sign-in on this computer has expired. Open Connections → Sign in with ${account === 'Google' ? 'Gemini' : account}, then ask me again.\n(${err.message})`
          : `⚠️ ${err.message}`;
        const spoken = signIn ? `I need you to sign in to ${account} again. Open Connections in Huddle.` : 'Sorry, I hit a problem.';
        this.add({ from: id, to: ['you'], text, say: spoken, error: true });
        this.emit({ type: 'speech', id, text: spoken });
        if (signIn) a.session?.stop(); // start a fresh process after you sign in
        this.setStatus(id, 'error', err.message);
      }
    } finally {
      if (a.turn === turn) a.turn = null;
      if (a.pending) setTimeout(() => this.run(id), 0);
    }
  }

  // "@Name: request" lines wake that teammate, but only when the host asked for them.
  handoffs(fromId, body, depth, hostLines) {
    const asked = (r) => hostLines.some((e) => aliasesFor(r).some((al) => e.text.toLowerCase().includes(al)));
    const alreadyTold = (r) => hostLines.some((e) => e.to === 'all' || [].concat(e.to).includes(r.id));
    const woken = new Set();
    for (const line of body.split('\n').filter((l) => /^\s*@[\w-]+/.test(l))) {
      const tag = line.trim().slice(1).split(/[:\s]/)[0].toLowerCase();
      const r = this.project.roles.find((x) => x.id !== fromId && aliasesFor(x).some((al) => al.replace(/ /g, '') === tag));
      if (!r || woken.has(r.id) || !asked(r) || alreadyTold(r)) continue;
      woken.add(r.id);
      const e = this.add({ from: fromId, to: [r.id], text: line.trim(), handoff: true });
      this.deliver(r.id, e, depth);
    }
  }

  saveSession(id, kind, sid) {
    this.sessions[id] = { ...(this.sessions[id] || {}), [kind]: sid };
    fs.writeFile(this.sessionsFile, JSON.stringify(this.sessions, null, 2), () => {});
  }

  // Where this agent's real session lives, for "Open in Claude Code / Codex".
  sessionInfo(id) {
    const role = this.role(id);
    const a = this.agents.get(id);
    const sid = role?.provider === 'claude' ? a?.session?.sessionId || this.sessions[id]?.claude : role?.provider === 'codex' ? a?.state?.sessionId || this.sessions[id]?.codex : null;
    return { provider: role?.provider, sessionId: sid || null, live: !!a?.session?.alive };
  }

  clear() {
    this.sessions = {};
    fs.writeFile(this.sessionsFile, '{}', () => {});
    this.transcript = [];
    for (const a of this.agents.values()) { a.lastSeen = 0; a.state = {}; if (a.session) { a.session.stop(); a.session.sessionId = null; } }
    fs.writeFile(this.file, '[]', () => {});
    this.emit({ type: 'state', ...this.snapshot() });
  }

  close() {
    for (const a of this.agents.values()) a.session?.stop();
    this.router.stop();
  }
}
