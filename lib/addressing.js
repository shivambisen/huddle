// Smart addressing: when the host doesn't say a name, a small fast model reads
// the last few lines and decides who they meant, the way people in a room do
// ("whoever just asked me", "the person whose job this is", "everyone").
// Runs on the host's own Claude (Haiku, low effort) in a process kept warm for
// the call. If it's unavailable or slow, the caller falls back to the old rule
// (stay with whoever you last talked to).
import fs from 'node:fs';
import os from 'node:os';
import { ClaudeSession } from './claude-session.js';
import { findBin } from './providers.js';

const SYSTEM = 'You route lines in a live meeting to the right listener. You never use tools. You answer with one line of JSON only.';

export class SmartAddressing {
  constructor(cwd) {
    this.cwd = cwd;
    this.session = null;
    this.uses = 0;
    this.busy = Promise.resolve();
  }

  async warm() {
    const bin = await findBin('claude');
    if (!bin) return false;
    if (!fs.existsSync(this.cwd)) this.cwd = os.homedir(); // routing doesn't need the project folder
    if (!this.session || this.uses > 30) { this.session?.stop(); this.session = new ClaudeSession({ bin, label: 'router', persist: false }); this.uses = 0; }
    this.session.ensure({ cwd: this.cwd, system: SYSTEM, model: 'haiku', effort: 'low', permission: 'default' });
    return true;
  }

  // Returns role ids, or null to fall back.
  pick({ roles, recent, text, host, lastAddressed, timeoutMs = 4000 }) {
    const run = async () => {
      if (!(await this.warm())) return null;
      this.uses++;
      const roster = roles.map((r) => `- ${r.name}${r.title ? ` (${r.title})` : ''}`).join('\n');
      const last = roles.find((r) => r.id === lastAddressed)?.name;
      const prompt = [
        `Team in the meeting:\n${roster}`,
        `Recent conversation (oldest first):\n${recent || '(none yet)'}`,
        last ? `${host} was last talking with ${last}.` : '',
        `New line from ${host} (no name said): "${text}"`,
        `Who is ${host} talking to? Think like a person in the room: someone who just asked ${host} a question or is mid-conversation with them usually gets the answer; a request that clearly fits someone's job goes to them; a greeting or question for the whole group goes to everyone.`,
        'Reply with JSON only, e.g. {"to":["Developer"]} or {"to":"everyone"}.',
      ].filter(Boolean).join('\n\n');
      const reply = await this.session.send(prompt);
      const json = JSON.parse((reply.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      if (json.to === 'everyone' || json.to === 'all') return roles.map((r) => r.id);
      const names = [].concat(json.to || []).map((n) => String(n).toLowerCase().trim());
      const ids = roles.filter((r) => names.includes(r.name.toLowerCase())).map((r) => r.id);
      return ids.length ? ids : null;
    };
    // One question at a time; give up quickly so the meeting never stalls on routing.
    const full = this.busy.then(run).catch(() => null);
    this.busy = full.then(() => {}, () => {}); // the next question waits for this one to really finish
    return Promise.race([full, new Promise((res) => setTimeout(() => { this.session?.interrupt(); res(null); }, timeoutMs))]);
  }

  stop() { this.session?.stop(); }
}
