import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { allStatus, providerStatus, openLogin, install, testProvider, PROVIDERS } from './lib/providers.js';
import { sttStatus, warm, transcribe } from './lib/stt.js';
import { NATURAL_VOICES, ttsStatus, warmTts, synth, sentences } from './lib/tts.js';
import { Meeting } from './lib/meeting.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.HUDDLE_DATA ? path.resolve(process.env.HUDDLE_DATA) : path.join(ROOT, 'data');
const MODEL_DIR = path.join(ROOT, 'data'); // speech model is shared, downloaded once
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1'; // agents can touch files: never listen beyond this machine
fs.mkdirSync(DATA, { recursive: true });

// ---------- store ----------
const file = (n) => path.join(DATA, n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
let projects = readJson('projects.json', []);
let settings = { hostName: '', onboarded: false, speech: { engine: 'whisper', quality: 'accurate', voices: 'natural' }, ...readJson('settings.json', {}) };
const saveProjects = () => fs.writeFileSync(file('projects.json'), JSON.stringify(projects, null, 2));
const saveSettings = () => fs.writeFileSync(file('settings.json'), JSON.stringify(settings, null, 2));
const id = () => Math.random().toString(36).slice(2, 10);

const TEMPLATES = {
  product: {
    label: 'Product team',
    blurb: 'Strategist, Researcher, Developer, Intern',
    roles: [
      { name: 'Strategist', title: 'Product strategist', prefer: ['claude', 'codex', 'gemini', 'ollama'], model: 'default', permission: 'plan', color: '#c2643d',
        prompt: 'You think about goals, users, scope and trade-offs. Push back on weak ideas, propose the smallest version worth building, and turn discussion into clear next steps.' },
      { name: 'Researcher', title: 'Researcher', prefer: ['gemini', 'claude', 'codex', 'ollama'], model: 'default', permission: 'plan', color: '#3d7ac2',
        prompt: 'You find facts: read the codebase, docs and the web. Cite where things come from and say plainly when you are unsure.' },
      { name: 'Developer', title: 'Senior developer', prefer: ['claude', 'codex', 'gemini', 'ollama'], model: 'default', permission: 'acceptEdits', color: '#3d9c6a',
        prompt: 'You write and change code in the project folder. Keep changes small and working, run what you can to check them, and report exactly what changed.' },
      { name: 'Intern', title: 'Intern', prefer: ['codex', 'claude', 'gemini', 'ollama'], model: 'default', permission: 'plan', color: '#8a5cc2',
        prompt: 'You take quick, well-defined tasks: summaries, checklists, drafting notes, small lookups. Be fast and ask when a task is unclear.' },
    ],
  },
  build: {
    label: 'Build squad',
    blurb: 'Architect, Developer, Reviewer',
    roles: [
      { name: 'Architect', title: 'Tech lead', prefer: ['claude', 'codex', 'gemini', 'ollama'], model: 'default', permission: 'plan', color: '#5c6bc2',
        prompt: 'You own the design. Break work into steps, choose the approach, and keep the team from over-building.' },
      { name: 'Developer', title: 'Developer', prefer: ['claude', 'codex', 'gemini', 'ollama'], model: 'default', permission: 'acceptEdits', color: '#3d9c6a',
        prompt: 'You implement. Make small, working changes, run them, and report what changed.' },
      { name: 'Reviewer', title: 'Code reviewer', prefer: ['codex', 'claude', 'gemini', 'ollama'], model: 'default', permission: 'plan', color: '#c23d7a',
        prompt: 'You review changes for bugs, security issues and missing tests. Be specific: file, line, problem, fix.' },
    ],
  },
  solo: {
    label: 'One assistant',
    blurb: 'Just one agent to start',
    roles: [
      { name: 'Assistant', title: 'Assistant', prefer: ['claude', 'codex', 'gemini', 'ollama'], model: 'default', permission: 'acceptEdits', color: '#c2643d',
        prompt: 'You help with whatever is asked: research, writing and code.' },
    ],
  },
};

function newProject(body = {}) {
  const roles = (body.roles || []).map((r) => ({ ...r, id: r.id || id() }));
  return {
    id: id(), name: body.name || 'Untitled project', cwd: body.cwd || os.homedir(), hostName: settings.hostName || 'You',
    handoffs: true, leadId: roles[0]?.id || null, roles, createdAt: Date.now(),
  };
}

// The natural voice a role speaks with: its pick, or a distinct default by position.
export const roleVoice = (project, roleId) => {
  const i = project.roles.findIndex((r) => r.id === roleId);
  const v = project.roles[i]?.voice;
  return NATURAL_VOICES.some((x) => x.id === v) ? v : NATURAL_VOICES[Math.max(0, i) % NATURAL_VOICES.length].id;
};

// ---------- meetings ----------
const meetings = new Map(); // projectId -> { meeting, sockets, idle }
function room(project) {
  let r = meetings.get(project.id);
  if (!r) {
    const sockets = new Set();
    const meeting = new Meeting(project, DATA, (msg) => {
      const s = JSON.stringify(msg);
      for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
    }, {
      smartAddressing: () => settings.smartAddressing !== false,
      // Render each spoken line the moment it's written, so audio is ready when the agent gets the floor.
      onSpeech: (proj, roleId, text) => {
        if (settings.speech.voices === 'system') return;
        const voice = roleVoice(proj, roleId);
        for (const part of sentences(text)) synth(part, voice, MODEL_DIR).catch(() => {});
      },
    });
    r = { meeting, sockets, idle: null };
    meetings.set(project.id, r);
  }
  return r;
}
const IDLE_MS = 10 * 60 * 1000; // close agent processes 10 minutes after everyone leaves

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const okOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; }
};
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const raw = (req, limit = 20 << 20) => new Promise((ok, bad) => {
  const chunks = []; let n = 0;
  req.on('data', (d) => { n += d.length; if (n > limit) { bad(new Error('Too large')); req.destroy(); } else chunks.push(d); });
  req.on('end', () => ok(Buffer.concat(chunks)));
});
const body = async (req) => { const b = await raw(req, 2 << 20); return b.length ? JSON.parse(b) : {}; };

async function apiRoute(req, res, parts) {
  const [, a, b, c] = parts; // api, a, b, c
  const M = req.method;

  if (a === 'settings') {
    if (M === 'GET') return send(res, 200, settings);
    if (M === 'PUT') {
      const x = await body(req);
      settings = { ...settings, ...x, speech: { ...settings.speech, ...(x.speech || {}) } };
      saveSettings();
      if ('hostName' in x) { projects.forEach((p) => (p.hostName = settings.hostName || 'You')); saveProjects(); }
      return send(res, 200, settings);
    }
  }

  if (a === 'templates') return send(res, 200, TEMPLATES);

  if (a === 'providers') {
    if (!b) return send(res, 200, await allStatus());
    if (!PROVIDERS[b]) return send(res, 404, { error: 'Unknown provider' });
    if (!c && M === 'GET') return send(res, 200, await providerStatus(b));
    if (c === 'login' && M === 'POST') return send(res, 200, await openLogin(b, DATA));
    if (c === 'install' && M === 'POST') {
      let log = '';
      await install(b, (s) => (log = (log + s).slice(-4000)));
      return send(res, 200, { ok: true, log, status: await providerStatus(b) });
    }
    if (c === 'test' && M === 'POST') {
      const { model, effort } = await body(req);
      return send(res, 200, await testProvider(b, model || 'default', DATA, effort));
    }
  }

  if (a === 'stt') {
    if (b === 'status') return send(res, 200, sttStatus());
    if (b === 'warm' && M === 'POST') { const { quality } = await body(req); warm(MODEL_DIR, quality || settings.speech.quality).catch(() => {}); return send(res, 200, sttStatus()); }
    if (b === 'transcribe' && M === 'POST') {
      const buf = await raw(req);
      if (buf.length < 16000 * 4 * 0.25) return send(res, 200, { text: '', ms: 0 }); // under 0.25 s
      const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
      return send(res, 200, await transcribe(pcm, MODEL_DIR));
    }
  }

  if (a === 'tts') {
    if (b === 'voices') return send(res, 200, NATURAL_VOICES);
    if (b === 'status') return send(res, 200, ttsStatus());
    if (b === 'warm' && M === 'POST') { warmTts(MODEL_DIR).catch(() => {}); return send(res, 200, ttsStatus()); }
    if (b === 'split' && M === 'POST') { const { text, voice } = await body(req); const parts = sentences(text); parts.forEach((x) => synth(x, voice, MODEL_DIR).catch(() => {})); return send(res, 200, { parts }); }
    if (b === 'say' && M === 'POST') {
      const { text, voice } = await body(req);
      const wav = await synth(String(text || '').slice(0, 600), voice, MODEL_DIR);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length });
      return res.end(wav);
    }
  }

  if (a === 'projects') {
    if (!b && M === 'GET') return send(res, 200, projects);
    if (!b && M === 'POST') { const p = newProject(await body(req)); projects.push(p); saveProjects(); return send(res, 200, p); }
    const p = projects.find((x) => x.id === b);
    if (!p) return send(res, 404, { error: 'No such project' });
    if (M === 'GET') return send(res, 200, p);
    if (M === 'PUT') {
      const x = await body(req);
      for (const k of ['name', 'cwd', 'handoffs', 'leadId']) if (k in x) p[k] = x[k];
      if (Array.isArray(x.roles)) p.roles = x.roles.map((r) => ({ ...r, id: r.id || id() }));
      if (!p.roles.some((r) => r.id === p.leadId)) p.leadId = p.roles[0]?.id || null;
      saveProjects();
      meetings.get(p.id)?.meeting.syncRoles(p);
      return send(res, 200, p);
    }
    if (M === 'DELETE') { projects = projects.filter((x) => x !== p); saveProjects(); meetings.get(p.id)?.meeting.close(); meetings.delete(p.id); return send(res, 200, { ok: true }); }
  }

  if (a === 'fs' && b === 'check' && M === 'POST') {
    const { dir, create } = await body(req);
    const d = path.resolve(String(dir || '').trim().replace(/^~(?=\/|$)/, os.homedir()));
    let ok = false; try { ok = fs.statSync(d).isDirectory(); } catch {}
    if (!ok && create) { fs.mkdirSync(d, { recursive: true }); ok = true; }
    return send(res, 200, { ok, path: d, home: os.homedir() });
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!okOrigin(req)) return send(res, 403, { error: 'Bad origin' });
      const ct = String(req.headers['content-type'] || '');
      // Non-simple content types force a CORS preflight, which this server never grants.
      if (req.method !== 'GET' && !ct.includes('application/json') && !ct.includes('application/octet-stream')) return send(res, 415, { error: 'JSON only' });
      return await apiRoute(req, res, url.pathname.split('/').filter(Boolean));
    }
    let f = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => okOrigin(req) });
wss.on('error', () => {}); // listen errors are reported by server.on('error') below
wss.on('connection', (ws, req) => {
  const pid = new URL(req.url, 'http://x').searchParams.get('project');
  const project = projects.find((p) => p.id === pid);
  if (!project) return ws.close(4004, 'No such project');
  const r = room(project);
  clearTimeout(r.idle);
  r.sockets.add(ws);
  ws.send(JSON.stringify({ type: 'state', ...r.meeting.snapshot() }));
  r.meeting.warm(); // open each Claude agent's process now, not on the first question
  ws.on('message', (m) => {
    let x; try { x = JSON.parse(m); } catch { return; }
    if (x.type === 'say') r.meeting.say(x).catch((e) => console.error('say failed:', e.message));
    if (x.type === 'stop') r.meeting.stop(x.id);
    if (x.type === 'clear') r.meeting.clear();
    if (x.type === 'role') {
      // Change a teammate's model / effort / voice / permissions mid-call.
      const role = project.roles.find((q) => q.id === x.id);
      if (!role) return;
      for (const k of ['model', 'effort', 'voice', 'permission']) if (k in (x.patch || {})) role[k] = String(x.patch[k]);
      saveProjects();
      r.meeting.syncRoles(project);
      r.meeting.warm(); // restarts that agent's process with the new settings; its memory is kept
      const s = JSON.stringify({ type: 'role', role });
      for (const w of r.sockets) if (w.readyState === 1) w.send(s);
    }
  });
  ws.on('close', () => {
    r.sockets.delete(ws);
    if (!r.sockets.size) r.idle = setTimeout(() => { if (!r.sockets.size) { r.meeting.close(); meetings.delete(project.id); } }, IDLE_MS);
  });
});

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is already in use. Huddle may already be running at http://localhost:${PORT}\nUse another port with: PORT=4318 npm start`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Huddle running at http://localhost:${PORT}`);
  if (settings.onboarded && settings.speech.engine === 'whisper') warm(MODEL_DIR, settings.speech.quality).catch(() => {});
  if (settings.onboarded && settings.speech.voices !== 'system') warmTts(MODEL_DIR).catch(() => {});
});
