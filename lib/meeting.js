// A live meeting: one transcript, one floor, and an agent per role.
// Each agent runs one turn at a time; messages that arrive while it is busy are
// picked up in its next turn (it sees everything since it last spoke).
import fs from 'node:fs';
import path from 'node:path';
import { runTurn } from './providers.js';
import { route, splitReply, aliasesFor } from './router.js';

const MAX_HANDOFF_DEPTH = 3;
let seq = Date.now();
const uid = () => (seq++).toString(36);

export class Meeting {
  constructor(project, dataDir, emit) {
    this.project = project;
    this.emit = emit;
    this.file = path.join(dataDir, `${project.id}.transcript.json`);
    this.transcript = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.lastAddressed = null;
    this.agents = new Map();
    this.syncRoles(project);
  }

  syncRoles(project) {
    this.project = project;
    for (const r of project.roles)
      if (!this.agents.has(r.id))
        this.agents.set(r.id, { status: 'idle', activity: '', pending: false, depth: 0, lastSeen: this.transcript.length, state: {}, abort: null });
    for (const id of [...this.agents.keys()]) if (!project.roles.some((r) => r.id === id)) this.agents.delete(id);
  }

  role(id) { return this.project.roles.find((r) => r.id === id); }
  name(id) { return id === 'you' ? this.project.hostName || 'You' : this.role(id)?.name || id; }

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
    this.emit({ type: 'agent', id, status, activity });
  }

  // From the host (voice or chat).
  say({ text, to = 'auto', via = 'chat' }) {
    text = String(text || '').trim();
    if (!text) return;
    const roles = this.project.roles;
    const { targets, reason } = route(text, roles, { to, lastAddressed: this.lastAddressed, leadId: this.project.leadId });
    if (targets.length === 1) this.lastAddressed = targets[0];
    const toAll = targets.length === roles.length && roles.length > 1;
    this.add({ from: 'you', to: toAll ? 'all' : targets, text, via, reason });
    targets.forEach((id, i) => this.wake(id, 0, toAll ? i : 0));
  }

  wake(id, depth = 0) {
    const a = this.agents.get(id);
    if (!a) return;
    a.depth = Math.max(a.depth, depth);
    if (a.status === 'working') { a.pending = true; this.emit({ type: 'agent', id, status: 'working', activity: a.activity, queued: true }); return; }
    this.run(id);
  }

  stop(id) {
    const a = this.agents.get(id);
    a?.abort?.abort();
  }

  buildPrompt(id) {
    const role = this.role(id);
    const a = this.agents.get(id);
    const host = this.name('you');
    const roster = this.project.roles.map((r) => `- ${r.name}${r.title && r.title !== r.name ? ` (${r.title})` : ''}${r.id === id ? ' ← you' : ''}`).join('\n');
    const system = [
      `You are ${role.name}${role.title ? `, the ${role.title}` : ''}, a member of the "${this.project.name}" team, in a live voice meeting run by ${host}.`,
      `Team in the room:\n${roster}`,
      'Meeting rules:',
      '- Only act on messages marked "(to you)" or "(to everyone)". Other lines are context; never answer on behalf of a teammate.',
      `- Your reply is read aloud. Start with ONE line "SAY: ..." of at most two short spoken sentences for ${host}. Put any detail (code, lists, links) after it; that part is shown in chat, not spoken.`,
      '- If you do real work (research, code, files), do it first, then report the outcome briefly.',
      this.project.handoffs !== false ? '- To hand something to a teammate, write a line "@Name: request". Only do this when it is genuinely theirs.' : '',
      role.prompt ? `\nYour role instructions:\n${role.prompt}` : '',
    ].filter(Boolean).join('\n');

    const delta = this.transcript.slice(a.lastSeen).filter((e) => e.from !== id);
    const lines = delta.map((e) => {
      const forMe = e.to === 'all' || (Array.isArray(e.to) && e.to.includes(id));
      const tag = e.to === 'all' ? '(to everyone)' : forMe ? '(to you)' : `(to ${[].concat(e.to).map((t) => this.name(t)).join(', ')})`;
      return `${this.name(e.from)} ${tag}: ${e.text}`;
    });
    const message = `Meeting transcript since your last turn:\n${lines.join('\n') || '(nothing new)'}\n\nRespond now as ${role.name}.`;
    return { system, message };
  }

  async run(id) {
    const a = this.agents.get(id);
    const role = this.role(id);
    if (!a || !role) return;
    const { system, message } = this.buildPrompt(id);
    const depth = a.depth;
    a.lastSeen = this.transcript.length;
    a.pending = false;
    a.depth = 0;
    a.abort = new AbortController();
    this.setStatus(id, 'working', 'thinking…');
    try {
      const reply = await runTurn({
        role, cwd: this.project.cwd || process.cwd(), system, message, fullPrompt: `${system}\n\n---\n${message}`,
        state: a.state, signal: a.abort.signal,
        onEvent: (ev) => this.setStatus(id, 'working', ev.kind === 'tool' ? `${ev.name}${ev.detail ? ': ' + ev.detail : ''}` : 'writing…'),
      });
      const { say, body } = splitReply(reply);
      this.add({ from: id, to: ['you'], text: body === say ? say : `${say}\n\n${body}`, say });
      this.setStatus(id, 'idle');
      if (this.project.handoffs !== false && depth < MAX_HANDOFF_DEPTH) this.handoffs(id, body, depth + 1);
    } catch (err) {
      this.add({ from: id, to: ['you'], text: `⚠️ ${err.message}`, say: `${role.name} hit an error.`, error: true });
      this.setStatus(id, 'error', err.message);
    } finally {
      a.abort = null;
      a.lastSeen = Math.min(a.lastSeen, this.transcript.length);
      if (a.pending) this.run(id);
    }
  }

  // "@Name: request" lines in an agent reply wake that teammate.
  handoffs(fromId, body, depth) {
    const lines = body.split('\n').filter((l) => /^\s*@[\w-]+/.test(l));
    const woken = new Set();
    for (const line of lines) {
      const tag = line.trim().slice(1).split(/[:\s]/)[0].toLowerCase();
      const r = this.project.roles.find((x) => x.id !== fromId && aliasesFor(x).some((a) => a.replace(/ /g, '') === tag));
      if (!r || woken.has(r.id)) continue;
      woken.add(r.id);
      this.add({ from: fromId, to: [r.id], text: line.trim(), handoff: true });
      this.wake(r.id, depth);
    }
  }

  clear() {
    this.transcript = [];
    for (const a of this.agents.values()) { a.lastSeen = 0; a.state = {}; }
    fs.writeFile(this.file, '[]', () => {});
    this.emit({ type: 'state', ...this.snapshot() });
  }
}
