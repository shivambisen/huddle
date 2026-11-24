// One long-lived Claude Code process per agent for the whole call.
//
// Starting `claude -p` for every turn costs a few seconds (boot, plugins,
// reloading the session). Instead each agent keeps a process open in
// stream-json mode: new messages go in on stdin, tokens stream out as they're
// written. Changing model/effort/permissions restarts it with --resume, so the
// agent keeps its memory.
import { spawn } from 'node:child_process';

const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const toolDetail = (input = {}) =>
  String(input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.description || '').slice(0, 120);

export class ClaudeSession {
  constructor({ bin, label = 'agent', persist = true }) {
    this.bin = bin;
    this.label = label;
    this.persist = persist;
    this.proc = null;
    this.key = '';
    this.sessionId = null;
    this.turn = null;
    this.stderr = '';
  }

  get alive() { return !!this.proc && this.proc.exitCode === null; }

  // Start (or restart) the process if its settings changed.
  ensure({ cwd, system, model, effort, permission }) {
    const key = JSON.stringify([cwd, system, model, effort, permission]);
    if (this.alive && key === this.key) return;
    this.stop();
    this.key = key;
    // "Read only" = Claude's normal mode with nobody to approve edits or shell commands,
    // plus web lookups. (Plan mode makes agents talk about plans instead of answering.)
    const readOnly = !permission || permission === 'plan';
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--append-system-prompt', system, '--permission-mode', readOnly ? 'default' : permission];
    if (readOnly) args.push('--allowedTools', 'WebSearch', 'WebFetch');
    if (model && model !== 'default') args.push('--model', model);
    if (effort && effort !== 'default') args.push('--effort', effort);
    if (this.sessionId) args.push('--resume', this.sessionId);
    if (!this.persist) args.push('--no-session-persistence');
    const proc = spawn(this.bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    this.proc = proc;
    this.stderr = '';
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.handle(tryJson(line));
      }
    });
    proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    proc.stdin.on('error', () => {});
    // A failed launch (missing folder, missing binary) must never take the server down.
    proc.on('error', (err) => {
      console.error(`[${this.label}] could not start Claude: ${err.message}`);
      if (this.proc === proc) this.proc = null;
      const t = this.turn;
      this.turn = null;
      t?.reject(new Error(`Couldn't start Claude Code: ${err.code === 'ENOENT' ? 'the program or the team folder is missing' : err.message}`));
    });
    proc.on('close', (code) => {
      if (this.proc === proc) this.proc = null;
      if (code) console.error(`[${this.label}] Claude exited (${code}): ${this.stderr.trim().split('\n').slice(-3).join(' | ')}`);
      const t = this.turn;
      if (t) {
        this.turn = null;
        const err = this.stderr.trim().split('\n').slice(-2).join(' ');
        t.reject(new Error(t.interrupted ? 'Stopped' : /log ?in|auth/i.test(err) ? `Claude isn't signed in. ${err}` : err || `Claude exited (${code})`));
      }
    });
  }

  handle(ev) {
    if (!ev) return;
    if (ev.session_id) this.sessionId = ev.session_id;
    const t = this.turn;
    if (!t) return;
    if (ev.type === 'stream_event') {
      const e = ev.event || {};
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') t.onEvent({ kind: 'delta', text: e.delta.text });
      if (e.type === 'content_block_stop') t.onEvent({ kind: 'blockEnd' });
      return;
    }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content || []) if (c.type === 'tool_use') t.onEvent({ kind: 'tool', name: c.name, detail: toolDetail(c.input) });
      return;
    }
    if (ev.type === 'result') {
      this.turn = null;
      if (ev.subtype === 'success' && !ev.is_error) t.resolve(ev.result || '');
      else t.reject(new Error(t.interrupted ? 'Stopped' : ev.result || ev.subtype || 'Claude returned an error'));
    }
  }

  send(message, onEvent = () => {}) {
    if (!this.alive) return Promise.reject(new Error('Claude process is not running'));
    if (this.turn) return Promise.reject(new Error('Busy'));
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject, onEvent, interrupted: false };
      this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n');
    });
  }

  // Stop the current reply but keep the process (and its memory) alive.
  interrupt() {
    if (!this.turn || !this.alive) return;
    this.turn.interrupted = true;
    this.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: `i${Date.now()}`, request: { subtype: 'interrupt' } }) + '\n');
  }

  stop() {
    if (this.proc) { this.proc.removeAllListeners('close'); this.proc.kill('SIGTERM'); }
    if (this.turn) { const t = this.turn; this.turn = null; t.reject(new Error('Stopped')); }
    this.proc = null;
  }
}
