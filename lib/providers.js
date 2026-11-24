// Provider adapters. Huddle never holds an API key: every agent runs through a
// tool the user has already signed in to on this machine (their Claude login in
// Claude Code, their ChatGPT login in Codex, their Google login in Gemini CLI)
// or a free local model in Ollama.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

export const PROVIDERS = {
  claude: {
    label: 'Claude', product: 'Claude Code', vendor: 'Anthropic', color: '#d97757',
    bin: 'claude', extraPaths: [`${HOME}/.claude/local/claude`, `${HOME}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
      path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(APPDATA, 'npm', 'claude.cmd')],
    npm: '@anthropic-ai/claude-code',
    loginCmd: (bin) => `"${bin}" auth login`,
    account: 'your Claude account (Pro or Max plan)',
    models: [{ id: 'default', label: 'Your default' }, { id: 'opus', label: 'Opus (smartest)' }, { id: 'sonnet', label: 'Sonnet (balanced)' }, { id: 'haiku', label: 'Haiku (fastest)' }],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    fast: { model: 'sonnet', effort: 'low' },
  },
  codex: {
    label: 'ChatGPT', product: 'Codex', vendor: 'OpenAI', color: '#10a37f',
    bin: 'codex', extraPaths: ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
      path.join(APPDATA, 'npm', 'codex.cmd'), path.join(LOCALAPPDATA, 'Programs', 'ChatGPT', 'resources', 'codex-cli', 'bin', 'codex.exe')],
    npm: '@openai/codex',
    loginCmd: (bin) => `"${bin}" login`,
    account: 'your ChatGPT account (Plus, Pro or Team)',
    models: [{ id: 'default', label: 'Default' }],
    efforts: ['minimal', 'low', 'medium', 'high'],
    fast: { model: 'default', effort: 'low' },
  },
  gemini: {
    label: 'Gemini', product: 'Gemini CLI', vendor: 'Google', color: '#4b7bec',
    bin: 'gemini', extraPaths: ['/opt/homebrew/bin/gemini', '/usr/local/bin/gemini', path.join(APPDATA, 'npm', 'gemini.cmd')],
    npm: '@google/gemini-cli',
    loginCmd: (bin) => `"${bin}"`,
    loginHint: 'In the window that opens, choose "Login with Google", then type /quit.',
    account: 'your Google account (free tier works)',
    models: [{ id: 'default', label: 'Default' }, { id: 'gemini-2.5-pro', label: '2.5 Pro' }, { id: 'gemini-2.5-flash', label: '2.5 Flash (fast)' }],
  },
  ollama: {
    label: 'Local models', product: 'Ollama', vendor: 'Runs on this Mac, free', color: '#6b6b6b',
    download: 'https://ollama.com/download',
    account: 'nothing: models run on your computer',
    models: [],
  },
};

// ---------- helpers ----------
// How to start a program. On Windows, npm installs tools as .cmd wrapper scripts,
// which Node can't spawn directly (without a shell, which would mangle our prompts),
// so read the wrapper and run what it points at: a .exe, or a .js with Node.
export function launchOf(bin) {
  if (!isWin || !/\.(cmd|bat)$/i.test(bin)) return { file: bin, pre: [], env: process.env };
  try {
    const shim = fs.readFileSync(bin, 'utf8');
    // The target is the last quoted %dp0% path that isn't the wrapper's own node.exe check.
    const hits = [...shim.matchAll(/"%~?dp0%\\?([^"%]+\.(?:js|cjs|mjs|exe))"/gi)].map((x) => x[1]).filter((x) => !/(^|\\)node\.exe$/i.test(x));
    if (hits.length) {
      const target = path.join(path.dirname(bin), hits.at(-1));
      if (/\.exe$/i.test(target)) return { file: target, pre: [], env: process.env };
      // Inside the desktop app, Electron's own Node runs the script.
      const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
      return { file: process.execPath, pre: [target], env };
    }
  } catch {}
  return { file: bin, pre: [], env: process.env, shell: true };
}

// Open a visible terminal window running a short script (sign-in, opening a session).
async function openTerminal(name, lines, dataDir) {
  if (isMac) {
    const file = path.join(dataDir, `${name}.command`);
    fs.writeFileSync(file, `#!/bin/zsh -l\nclear\n${lines.join('\n')}\n`, { mode: 0o755 });
    const r = await sh('open', ['-a', 'Terminal', file]);
    if (!r.ok) throw new Error(r.err || 'Could not open Terminal');
    return true;
  }
  if (isWin) {
    const file = path.join(dataDir, `${name}.cmd`);
    fs.writeFileSync(file, ['@echo off', ...lines, 'echo.', 'pause'].join('\r\n'));
    const r = await sh('cmd.exe', ['/c', 'start', '""', file], { windowsVerbatimArguments: false });
    if (!r.ok) throw new Error(r.err || 'Could not open a command window');
    return true;
  }
  return false;
}

export function openUrl(url) {
  if (isMac) return sh('open', [url]);
  if (isWin) return sh('cmd.exe', ['/c', 'start', '""', url]);
  return sh('xdg-open', [url]);
}

const sh = (cmd, args, opts = {}) =>
  new Promise((res) => {
    const L = launchOf(cmd);
    execFile(L.file, [...L.pre, ...args], { timeout: 15000, maxBuffer: 1 << 20, env: L.env, shell: L.shell, ...opts }, (err, out, errOut) => res({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') }));
  });

const exists = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

// The login shell's PATH (so tools installed via nvm/homebrew are found even when
// Huddle was started from somewhere with a thinner PATH).
let shellPath = null;
async function loginPath() {
  if (shellPath !== null) return shellPath;
  if (isWin) return (shellPath = ''); // Windows apps already get the user's full PATH
  const r = await sh(process.env.SHELL || '/bin/zsh', ['-lc', 'echo $PATH']);
  shellPath = r.ok ? r.out.trim() : '';
  if (shellPath) process.env.PATH = [...new Set([...shellPath.split(':'), ...(process.env.PATH || '').split(':')])].join(':');
  return shellPath;
}

const binCache = {};
export async function findBin(id) {
  const p = PROVIDERS[id];
  if (!p.bin) return null;
  if (binCache[id] && exists(binCache[id])) return binCache[id];
  await loginPath();
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) { const c = path.join(dir, p.bin + ext); if (exists(c)) return (binCache[id] = c); }
  }
  for (const c of p.extraPaths || []) if (exists(c)) return (binCache[id] = c);
  return null;
}

function codexModels() {
  const cache = readJson(`${HOME}/.codex/models_cache.json`);
  const listed = (cache?.models || []).filter((m) => m.visibility === 'list').map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
  return listed;
}
function codexConfiguredModel() {
  try { return fs.readFileSync(`${HOME}/.codex/config.toml`, 'utf8').match(/^model\s*=\s*"([^"]+)"/m)?.[1] || null; } catch { return null; }
}
// Codex's own default can be a model the ChatGPT plan can't use; fall back to one it lists.
function codexEffectiveModel(model) {
  if (model && model !== 'default') return model;
  const listed = codexModels().map((m) => m.id);
  const conf = codexConfiguredModel();
  if (!listed.length || !conf || listed.includes(conf)) return null;
  return listed[0];
}

// ---------- status ----------
export async function providerStatus(id) {
  const p = PROVIDERS[id];
  const base = { id, label: p.label, product: p.product, vendor: p.vendor, color: p.color, account: p.account, models: p.models, efforts: p.efforts || [], fast: p.fast || null, loginHint: p.loginHint || null, canInstall: !!p.npm, download: p.download || null };

  if (id === 'ollama') {
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(800) });
      const j = await r.json();
      const models = (j.models || []).map((m) => ({ id: m.name, label: m.name }));
      return { ...base, installed: true, signedIn: models.length > 0, models, detail: models.length ? `${models.length} model${models.length > 1 ? 's' : ''} ready` : 'Running, but no models yet. Run: ollama pull llama3.2' };
    } catch {
      return { ...base, installed: false, signedIn: false, detail: 'Not running' };
    }
  }

  const bin = await findBin(id);
  if (!bin) return { ...base, installed: false, signedIn: false, detail: 'Not installed' };
  const out = { ...base, installed: true, path: bin };

  if (id === 'claude') {
    const r = await sh(bin, ['auth', 'status']);
    const j = tryJson(r.out.trim());
    if (j) return { ...out, signedIn: !!j.loggedIn, detail: j.loggedIn ? [j.email, j.orgName].filter(Boolean).join(' · ') || 'Signed in' : 'Not signed in' };
    return { ...out, signedIn: false, detail: 'Could not read sign-in status' };
  }
  if (id === 'codex') {
    const r = await sh(bin, ['login', 'status']);
    const text = (r.out + r.err).trim();
    const signedIn = r.ok && /logged in/i.test(text) && !/not logged in/i.test(text);
    const models = codexModels();
    return { ...out, signedIn, detail: signedIn ? text.split('\n')[0] : 'Not signed in', models: [{ id: 'default', label: 'Default' }, ...models] };
  }
  if (id === 'gemini') {
    const settings = readJson(`${HOME}/.gemini/settings.json`);
    const signedIn = fs.existsSync(`${HOME}/.gemini/oauth_creds.json`) || !!process.env.GEMINI_API_KEY || !!settings?.security?.auth?.selectedType || !!settings?.selectedAuthType;
    return { ...out, signedIn, detail: signedIn ? 'Signed in with Google' : 'Not signed in' };
  }
  return out;
}

export async function allStatus() {
  const ids = Object.keys(PROVIDERS);
  const list = await Promise.all(ids.map((id) => providerStatus(id).catch((e) => ({ id, ...PROVIDERS[id], installed: false, signedIn: false, detail: e.message }))));
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

// ---------- connect actions ----------
// Sign-in needs a browser hand-off and sometimes a pasted code, so it runs in a
// real Terminal window. Huddle then polls the status until it flips.
export async function openLogin(id, dataDir) {
  const p = PROVIDERS[id];
  if (id === 'ollama') { await openUrl(p.download); return { opened: true, command: null }; }
  const bin = await findBin(id);
  if (!bin) throw new Error(`${p.product} isn't installed yet.`);
  const command = p.loginCmd(bin);
  const said = (t) => (isWin ? `echo ${t}` : `echo "${t}"`);
  const opened = await openTerminal(`connect-${id}`, [said(`Signing in to ${p.product} with ${p.account}.`), ...(p.loginHint ? [said(p.loginHint)] : []), isWin ? 'echo.' : 'echo', command, said('All set. You can close this window and go back to Huddle.')], dataDir);
  return { opened, command };
}

// Open an agent's real session in a Terminal window, in Claude Code or Codex.
// While the call is using it, Claude opens a copy (fork) so the two never write to the same session.
export async function openSession({ provider, sessionId, cwd, fork, title }, dataDir) {
  const bin = await findBin(provider);
  if (!bin) throw new Error(`${PROVIDERS[provider]?.product || provider} isn't installed.`);
  if (!sessionId) throw new Error("This teammate hasn't said anything yet, so there's no session to open.");
  if (!/^[\w-]+$/.test(sessionId)) throw new Error('Unexpected session id');
  const q = isWin ? (x) => `"${String(x).replace(/"/g, '')}"` : (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;
  const cd = isWin ? `cd /d ${q(cwd)}` : `cd ${q(cwd)}`;
  const command = provider === 'claude'
    ? `${cd} && ${q(bin)} --resume ${sessionId}${fork ? ' --fork-session' : ''}`
    : provider === 'codex' ? `${cd} && ${q(bin)} resume ${sessionId}` : null;
  if (!command) throw new Error('Only Claude and ChatGPT teammates have a session you can open.');
  const echo = (t) => (isWin ? `echo ${t}` : `echo ${q(t)}`);
  const opened = await openTerminal(`open-${sessionId}`, [echo(title || 'Huddle teammate'), ...(fork ? [echo('(a copy, because the call is still using the original)')] : []), command], dataDir);
  return { opened, command };
}

// ---------- Huddle inside Claude Code ----------
// The Huddle plugin for Claude Code lives in this repo's marketplace. Installing it
// adds a Huddle row above the prompt, a Huddle panel, a status line entry and /huddle.
const MARKETPLACE = 'shivambisen/huddle';
const PLUGIN_ID = 'huddle@huddle';

export async function claudeCodePluginStatus() {
  const bin = await findBin('claude');
  if (!bin) return { claude: false, installed: false };
  const r = await sh(bin, ['plugin', 'list', '--json'], { timeout: 30000 });
  const list = tryJson(r.out.trim()) || [];
  const mine = Array.isArray(list) ? list.find((x) => x.id === PLUGIN_ID) : null;
  return { claude: true, installed: !!mine, enabled: !!mine?.enabled, version: mine?.version || null };
}

export async function installClaudeCodePlugin() {
  const bin = await findBin('claude');
  if (!bin) throw new Error("Claude Code isn't installed. Connect Claude first.");
  const add = await sh(bin, ['plugin', 'marketplace', 'add', MARKETPLACE], { timeout: 120000 });
  if (!add.ok && !/already/i.test(add.out + add.err)) throw new Error(`Couldn't add the Huddle marketplace: ${(add.err || add.out).trim().split('\n').slice(-2).join(' ')}`);
  await sh(bin, ['plugin', 'marketplace', 'update', 'huddle'], { timeout: 120000 });
  const inst = await sh(bin, ['plugin', 'install', PLUGIN_ID, '--json'], { timeout: 120000 });
  if (!inst.ok) throw new Error(`Couldn't install the plugin: ${(inst.err || inst.out).trim().split('\n').slice(-2).join(' ')}`);
  return claudeCodePluginStatus();
}

export function install(id, onLog) {
  const p = PROVIDERS[id];
  if (!p.npm) return Promise.reject(new Error('Nothing to install with npm'));
  return new Promise((resolve, reject) => {
    loginPath().then(() => {
      const child = spawn(isWin ? 'npm.cmd' : 'npm', ['install', '-g', p.npm], { env: process.env, shell: isWin });
      const log = (d) => onLog(d.toString());
      child.stdout.on('data', log);
      child.stderr.on('data', log);
      child.on('error', reject);
      child.on('close', (code) => { delete binCache[id]; code === 0 ? resolve() : reject(new Error(`npm exited with ${code}`)); });
    });
  });
}

// ---------- running a turn ----------
function runCli(bin, args, { cwd, signal, onLine }) {
  return new Promise((resolve, reject) => {
    const L = launchOf(bin);
    const child = spawn(L.file, [...L.pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: L.env, shell: L.shell });
    let buf = '', all = '', err = '';
    const kill = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d) => {
      const s = d.toString();
      all += s; buf += s;
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

const toolDetail = (input = {}) =>
  String(input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.description || '').slice(0, 120);

// Pull the human part out of provider error JSON like {"error":{"message":"..."}}.
const humanError = (msg) => {
  const j = tryJson(msg);
  return j?.error?.message || j?.message || msg;
};

/**
 * Run one turn for an agent.
 * ctx: { role, cwd, system, message, fullPrompt, state, onEvent, signal }
 * Returns the reply text.
 */
export async function runTurn(ctx) {
  const { role, cwd, signal, onEvent = () => {}, state } = ctx;
  const model = role.model && role.model !== 'default' ? role.model : null;
  const perm = role.permission || 'acceptEdits';
  const p = PROVIDERS[role.provider];
  if (!p) throw new Error(`Unknown provider: ${role.provider}`);
  const bin = p.bin ? await findBin(role.provider) : null;
  if (p.bin && !bin) throw new Error(`${p.product} isn't installed. Connect it under Connections.`);

  if (role.provider === 'claude') {
    const args = ['-p', ctx.message, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', ctx.system, '--permission-mode', perm === 'plan' ? 'default' : perm];
    if (model) args.push('--model', model);
    if (role.effort && role.effort !== 'default') args.push('--effort', role.effort);
    if (state.sessionId) args.push('--resume', state.sessionId);
    let final = '', failed = '';
    const texts = [];
    await runCli(bin, args, {
      cwd, signal,
      onLine: (line) => {
        const ev = tryJson(line);
        if (!ev) return;
        if (ev.session_id) state.sessionId = ev.session_id;
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content || []) {
            if (c.type === 'text' && c.text.trim()) { texts.push(c.text); onEvent({ kind: 'text', text: c.text }); }
            if (c.type === 'tool_use') onEvent({ kind: 'tool', name: c.name, detail: toolDetail(c.input) });
          }
        }
        if (ev.type === 'result') {
          if (ev.is_error) failed = ev.result || ev.subtype || 'Claude returned an error';
          else final = ev.result || texts.at(-1) || '';
        }
      },
    });
    if (failed && !final) throw new Error(/log ?in|auth/i.test(failed) ? `Claude isn't signed in. ${failed}` : failed);
    return final || texts.at(-1) || '';
  }

  if (role.provider === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check'];
    const m = codexEffectiveModel(model);
    if (m) args.push('-m', m);
    if (role.effort && role.effort !== 'default') args.push('-c', `model_reasoning_effort="${role.effort}"`);
    if (perm === 'plan') args.push('-s', 'read-only');
    else if (perm === 'bypassPermissions') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('-s', 'workspace-write');
    // Codex has no system-prompt flag, so the role brief rides along on the first turn.
    if (state.sessionId) args.push('resume', state.sessionId, ctx.message);
    else args.push(ctx.fullPrompt);
    let last = '', failed = '';
    await runCli(bin, args, {
      cwd, signal,
      onLine: (line) => {
        const ev = tryJson(line);
        if (!ev) return;
        if (ev.type === 'thread.started' && ev.thread_id) state.sessionId = ev.thread_id;
        if (ev.type === 'turn.failed') failed = humanError(ev.error?.message || 'Codex failed');
        if (ev.type === 'error' && !failed) failed = humanError(ev.message || 'Codex error');
        const item = ev.item || {};
        if (item.type === 'agent_message') { last = item.text || last; onEvent({ kind: 'text', text: item.text || '' }); }
        if (item.type === 'command_execution') onEvent({ kind: 'tool', name: 'shell', detail: String(item.command || '').slice(0, 120) });
        if (item.type === 'file_change') onEvent({ kind: 'tool', name: 'edit', detail: (item.changes || []).map((c) => c.path).join(', ').slice(0, 120) });
        if (item.type === 'web_search') onEvent({ kind: 'tool', name: 'web', detail: String(item.query || '').slice(0, 120) });
      },
    });
    if (failed && !last) { state.sessionId = state.sessionId && !/not found|resume/i.test(failed) ? state.sessionId : null; throw new Error(failed); }
    return last;
  }

  if (role.provider === 'gemini') {
    const args = ['-p', ctx.fullPrompt];
    if (model) args.push('-m', model);
    if (perm === 'bypassPermissions') args.push('--yolo');
    onEvent({ kind: 'tool', name: 'gemini', detail: 'working…' });
    const raw = await runCli(bin, args, { cwd, signal });
    return raw.trim();
  }

  if (role.provider === 'ollama') {
    state.history ||= [];
    state.history.push({ role: 'user', content: ctx.message });
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', signal,
      body: JSON.stringify({ model: model || 'llama3.2', stream: true, messages: [{ role: 'system', content: ctx.system }, ...state.history.slice(-30)] }),
    }).catch(() => { throw new Error('Ollama isn\'t running. Open the Ollama app.'); });
    if (!res.ok) throw new Error(`Ollama: ${humanError(await res.text())}`);
    let text = '', buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = tryJson(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (ev?.message?.content) { text += ev.message.content; onEvent({ kind: 'delta', text: ev.message.content }); }
      }
    }
    state.history.push({ role: 'assistant', content: text });
    return text;
  }
}

// A tiny end-to-end check: does this provider + model actually answer?
export async function testProvider(id, model, cwd, effort) {
  const t = Date.now();
  const reply = await runTurn({
    role: { provider: id, model, effort, permission: 'plan' }, cwd, state: {},
    system: 'You are being connection-tested by the Huddle app.',
    message: 'Reply with one short friendly sentence confirming you are connected. No tools.',
    fullPrompt: 'Reply with one short friendly sentence confirming you are connected. No tools.',
  });
  return { reply: reply.trim().replace(/^SAY:\s*/i, ''), ms: Date.now() - t };
}
