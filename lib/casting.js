// Casting: who should be on this call?
//
// Not an orchestrator. A small, fast model is asked once, like sending calendar
// invites: "given this work, which people does it need?" It answers with the
// smallest team that fits, and then it's gone. Everyone on the call talks to the
// host directly. The same step designs one new teammate when someone asks to
// bring a specialist in.
import { runTurn } from './providers.js';

const COLORS = ['#c2643d', '#3d7ac2', '#3d9c6a', '#8a5cc2', '#c23d7a', '#2f8f8f', '#b7791f', '#5c6bc2'];

export const ALL_ROUNDER = {
  name: 'Generalist',
  title: 'All-rounder',
  aliases: ['all rounder', 'allrounder', 'general'],
  permission: 'acceptEdits',
  prompt: 'You can do a bit of everything: plan, research, write and code. Handle what you can yourself. When the work clearly needs a specialist you are not (a designer, a security reviewer, a data person...), ask the host to bring one in rather than doing it badly.',
};

// Quick, sensible model choices per account for a live call.
export function tune(provider, role) {
  const builder = role.permission === 'acceptEdits' || role.permission === 'bypassPermissions';
  if (provider === 'claude') return { model: builder ? 'sonnet' : /intern|assistant|note/i.test(role.name) ? 'haiku' : 'sonnet', effort: builder ? 'medium' : 'low' };
  if (provider === 'codex') return { model: 'default', effort: builder ? 'medium' : 'low' };
  return { model: 'default', effort: 'default' };
}

// Spread people across the accounts you've connected: builders on Claude when it's
// there, others alternate, so one plan doesn't carry the whole call.
export function assignProviders(roles, status) {
  const connected = Object.values(status).filter((p) => p.signedIn && p.id !== 'ollama').map((p) => p.id);
  const pool = connected.length ? connected : Object.values(status).filter((p) => p.signedIn).map((p) => p.id);
  if (!pool.length) return roles.map((r) => ({ ...r, provider: 'claude', ...tune('claude', r) }));
  let k = 0;
  return roles.map((r) => {
    const builder = r.permission === 'acceptEdits' || r.permission === 'bypassPermissions';
    const provider = builder && pool.includes('claude') ? 'claude' : pool[k++ % pool.length];
    return { ...r, provider, ...tune(provider, r) };
  });
}

function pickCaster(status) {
  if (status.claude?.signedIn) return { provider: 'claude', model: 'haiku', effort: 'low' };
  if (status.codex?.signedIn) return { provider: 'codex', model: 'default', effort: 'low' };
  if (status.gemini?.signedIn) return { provider: 'gemini', model: 'gemini-2.5-flash' };
  return null;
}

async function ask(status, cwd, instruction) {
  const caster = pickCaster(status);
  if (!caster) throw new Error('Connect Claude or ChatGPT first.');
  const reply = await runTurn({
    role: { ...caster, permission: 'plan' }, cwd, state: {},
    system: 'You assemble small teams of AI teammates for a voice call. You never use tools. You reply with JSON only.',
    message: instruction, fullPrompt: instruction,
  });
  const json = (String(reply).match(/\{[\s\S]*\}/) || [])[0];
  if (!json) throw new Error("Couldn't work out a team from that. Try describing the work in a sentence or two.");
  return JSON.parse(json);
}

const cleanRole = (r, i) => ({
  name: String(r.name || `Teammate${i + 1}`).replace(/[^A-Za-z ]/g, '').trim().split(/\s+/)[0].slice(0, 16) || `Teammate${i + 1}`,
  title: String(r.title || '').slice(0, 40),
  prompt: String(r.prompt || '').slice(0, 800),
  permission: r.permission === 'acceptEdits' ? 'acceptEdits' : 'plan',
  why: String(r.why || '').slice(0, 160),
  skills: Array.isArray(r.skills) ? r.skills.map(String).slice(0, 3) : undefined,
  color: COLORS[i % COLORS.length],
});

export async function proposeTeam({ description, status, cwd, skills = [] }) {
  const plan = await ask(status, cwd, `The host is starting a call about this work:
"""${String(description).slice(0, 1500)}"""

Propose the SMALLEST team that can do it well: usually 1 to 3 people, never more than 4. If one capable all-rounder is enough, propose just one. Do not add a lead, manager, coordinator or orchestrator: everyone works directly with the host. Do not add someone "just in case".

For each person give:
- name: the job itself as one plain, easy-to-say word (Developer, Designer, Researcher, Writer, Analyst, Tester, Reviewer). Never a human first name and never a fancy title like Artisan or Sentinel.
- title: a few words
- prompt: 2-3 sentences on how they think and work, written to them ("You ...")
- permission: "acceptEdits" if they will change files or write code, else "plan"
- why: one short line on why this task needs them
- skills: up to 3 ids from this skills library that would genuinely help them (or []):
${skills.map((x) => `  ${x.id}: ${x.description}`).join('\n') || '  (none available)'}

Reply as JSON: {"summary": "one sentence", "roles": [{"name": "...", "title": "...", "prompt": "...", "permission": "...", "why": "...", "skills": ["..."]}]}`);
  const seen = new Set();
  const roles = (Array.isArray(plan.roles) ? plan.roles : []).slice(0, 4).map(cleanRole).filter((r) => !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()));
  if (!roles.length) return { summary: 'One all-rounder can handle this.', roles: assignProviders([{ ...ALL_ROUNDER, color: COLORS[0], why: 'Handles the whole task and asks for help when needed.' }], status) };
  return { summary: String(plan.summary || '').slice(0, 200), roles: assignProviders(roles, status) };
}

// Someone on the call asked to bring in a specialist and the host said yes.
export async function designTeammate({ request, reason, existing, status, cwd, skills = [] }) {
  const plan = await ask(status, cwd, `A teammate on a call asked the host to bring in: "${String(request).slice(0, 80)}" because: "${String(reason).slice(0, 300)}".
People already on the call: ${existing.map((r) => `${r.name} (${r.title || 'no title'})`).join(', ') || 'none'}.

Skills library (pick up to 3 ids that would genuinely help them, or none):
${skills.map((x) => `  ${x.id}: ${x.description}`).join('\n') || '  (none available)'}

Describe that one new person as JSON: {"name": "one short, distinct word for the job, not a human first name and not already taken", "title": "a few words", "prompt": "2-3 sentences written to them", "permission": "acceptEdits or plan", "skills": ["..."]}`);
  const taken = new Set(existing.map((r) => r.name.toLowerCase()));
  const role = cleanRole(plan, existing.length);
  // Name them after the job that was asked for, so they're easy to call on out loud:
  // "a security reviewer" -> Reviewer (and "security reviewer" also works).
  const words = String(request).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w && !['a', 'an', 'the', 'someone', 'for', 'who', 'does'].includes(w));
  if (words.length) {
    role.name = words.at(-1)[0].toUpperCase() + words.at(-1).slice(1);
    role.aliases = [words.join(' ')];
    if (!role.title) role.title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  if (taken.has(role.name.toLowerCase())) role.name = `${role.name}2`;
  return assignProviders([role], status)[0];
}
