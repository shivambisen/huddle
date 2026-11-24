// Provider adapters. Huddle never holds an API key: every agent runs through a
// tool the user has already signed in to on this machine (their Claude Code
// login, their ChatGPT login in Codex, their Google login in Gemini CLI) or a
// free local model in Ollama.
import { spawn, execFile } from 'node:child_process';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    models: ['default', 'opus', 'sonnet', 'haiku'],
    connect: [
      'Install: npm i -g @anthropic-ai/claude-code',
      'Sign in: run `claude` once and use /login with your Claude account (Pro/Max works, no API key).',
    ],
    sessions: true,
  },
  codex: {
    label: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    models: ['default', 'gpt-5', 'gpt-5-codex'],
    connect: [
      'Install: npm i -g @openai/codex',
      'Sign in: run `codex login` and choose "Sign in with ChatGPT".',
    ],
  },
  gemini: {
    label: 'Gemini CLI',
    vendor: 'Google',
    bin: 'gemini',
    models: ['default', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    connect: [
      'Install: npm i -g @google/gemini-cli',
      'Sign in: run `gemini` once and log in with Google (free tier).',
    ],
  },
  ollama: {
    label: 'Ollama',
    vendor: 'Local, free',
    models: [],
    connect: ['Install from ollama.com, then e.g. `ollama pull llama3.2`.'],
  },
};

const which = (bin) =>
  new Promise((res) =>
    execFile('/bin/sh', ['-lc', `command -v ${bin}`], (err, out) => res(err ? null : out.trim() || null)),
  );

export async function detectProviders() {
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.bin) {
      const path = await which(p.bin);
      out[id] = { ...p, id, available: !!path, path };
    } else {
      try {
        const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(800) });
        const j = await r.json();
        out[id] = { ...p, id, available: true, models: (j.models || []).map((m) => m.name) };
      } catch {
        out[id] = { ...p, id, available: false };
      }
    }
  }
  return out;
}

// Spawn a CLI and hand each stdout line to onLine. Resolves with the full stdout.
function runCli(bin, args, { cwd, signal, onLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let buf = '', all = '', err = '';
    const kill = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d) => {
      const s = d.toString();
      all += s;
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine?.(line);
      }
    });
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (buf.trim()) onLine?.(buf.trim());
      if (signal?.aborted) return reject(new Error('Stopped'));
      if (code !== 0 && !all.trim()) return reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${bin} exited ${code}`));
      resolve(all);
    });
  });
}

const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

const toolDetail = (input = {}) =>
  String(input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.description || '')
    .slice(0, 120);

/**
 * Run one turn for an agent.
 * ctx: { role, cwd, system, message, fullPrompt, history, state, onEvent, signal }
 *  - system: the role's standing instructions
 *  - message: what to send when the provider keeps its own session
 *  - fullPrompt: system + message, for providers without a system-prompt flag
 *  - state: per-agent mutable state (sessionId, history) kept by the meeting
 * Returns the reply text.
 */
export async function runTurn(ctx) {
  const { role, cwd, signal, onEvent, state } = ctx;
  const model = role.model && role.model !== 'default' ? role.model : null;
  const perm = role.permission || 'acceptEdits';

  if (role.provider === 'claude') {
    const args = ['-p', ctx.message, '--output-format', 'stream-json', '--verbose',
      '--append-system-prompt', ctx.system, '--permission-mode', perm];
    if (model) args.push('--model', model);
    if (state.sessionId) args.push('--resume', state.sessionId);
    let final = '', failed = '', texts = [];
    await runCli('claude', args, {
      cwd, signal,
      onLine: (line) => {
        const ev = tryJson(line);
        if (!ev) return;
        if (ev.session_id) state.sessionId = ev.session_id;
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content || []) {
            if (c.type === 'text' && c.text.trim()) { texts.push(c.text); onEvent({ kind: 'thinking', text: c.text }); }
            if (c.type === 'tool_use') onEvent({ kind: 'tool', name: c.name, detail: toolDetail(c.input) });
          }
        }
        if (ev.type === 'result') {
          if (ev.is_error) failed = ev.result || ev.subtype || 'Claude returned an error';
          else final = ev.result || texts.at(-1) || '';
        }
      },
    });
    if (failed && !final) throw new Error(failed);
    return final || texts.at(-1) || '';
  }

  if (role.provider === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (model) args.push('-m', model);
    if (perm === 'plan') args.push('--sandbox', 'read-only');
    else if (perm === 'bypassPermissions') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--full-auto');
    args.push(ctx.fullPrompt);
    let last = '';
    const raw = await runCli('codex', args, {
      cwd, signal,
      onLine: (line) => {
        const ev = tryJson(line);
        if (!ev) return;
        const item = ev.item || ev.msg || {};
        if (item.type === 'agent_message') { last = item.text || item.message || last; onEvent({ kind: 'thinking', text: last }); }
        if (item.type === 'command_execution' || item.type === 'exec_command_begin') onEvent({ kind: 'tool', name: 'shell', detail: String(item.command || '').slice(0, 120) });
        if (item.type === 'file_change') onEvent({ kind: 'tool', name: 'edit', detail: (item.changes || []).map((c) => c.path).join(', ').slice(0, 120) });
      },
    });
    return last || raw.trim();
  }

  if (role.provider === 'gemini') {
    const args = ['-p', ctx.fullPrompt];
    if (model) args.push('-m', model);
    if (perm === 'bypassPermissions') args.push('--yolo');
    const raw = await runCli('gemini', args, { cwd, signal, onLine: () => onEvent({ kind: 'tool', name: 'gemini', detail: 'working…' }) });
    return raw.trim();
  }

  if (role.provider === 'ollama') {
    state.history ||= [];
    state.history.push({ role: 'user', content: ctx.message });
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', signal,
      body: JSON.stringify({ model: model || 'llama3.2', stream: true, messages: [{ role: 'system', content: ctx.system }, ...state.history.slice(-30)] }),
    });
    if (!res.ok) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
    let text = '', buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = tryJson(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (ev?.message?.content) text += ev.message.content;
      }
    }
    state.history.push({ role: 'assistant', content: text });
    return text;
  }

  throw new Error(`Unknown provider: ${role.provider}`);
}
