import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { detectProviders } from './lib/providers.js';
import { Meeting } from './lib/meeting.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1'; // agents can touch files: never listen beyond this machine
fs.mkdirSync(DATA, { recursive: true });

// ---------- store ----------
const DB = path.join(DATA, 'projects.json');
const load = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : []);
let projects = load();
const save = () => fs.writeFileSync(DB, JSON.stringify(projects, null, 2));
const id = () => Math.random().toString(36).slice(2, 10);

const TEMPLATE_ROLES = [
  { name: 'Strategist', title: 'Product strategist', provider: 'claude', model: 'default', permission: 'plan', color: '#c2643d',
    prompt: 'You think about goals, users, scope and trade-offs. Push back on weak ideas, propose the smallest version worth building, and turn discussion into clear next steps.' },
  { name: 'Researcher', title: 'Researcher', provider: 'claude', model: 'default', permission: 'plan', color: '#3d7ac2',
    prompt: 'You find facts: read the codebase, docs and the web. Cite where things come from and say plainly when you are unsure.' },
  { name: 'Developer', title: 'Senior developer', provider: 'claude', model: 'default', permission: 'acceptEdits', color: '#3d9c6a',
    prompt: 'You write and change code in the project folder. Keep changes small and working, run what you can to check them, and report exactly what changed.' },
  { name: 'Intern', title: 'Intern', provider: 'claude', model: 'haiku', permission: 'plan', color: '#8a5cc2',
    prompt: 'You take quick, well-defined tasks: summaries, checklists, drafting notes, small lookups. Be fast and ask when a task is unclear.' },
];

function newProject(body = {}) {
  const roles = (body.roles?.length ? body.roles : body.template === 'blank' ? [] : TEMPLATE_ROLES).map((r) => ({ id: id(), ...r }));
  return {
    id: id(), name: body.name || 'Untitled project', cwd: body.cwd || os.homedir(), hostName: body.hostName || 'You',
    handoffs: true, leadId: roles[0]?.id || null, roles, createdAt: Date.now(),
  };
}

// ---------- meetings ----------
const meetings = new Map(); // projectId -> { meeting, sockets:Set }
function room(project) {
  let r = meetings.get(project.id);
  if (!r) {
    const sockets = new Set();
    const meeting = new Meeting(project, DATA, (msg) => {
      const s = JSON.stringify(msg);
      for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
    });
    r = { meeting, sockets };
    meetings.set(project.id, r);
  }
  return r;
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const okOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; }
};
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((ok, bad) => {
  let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!okOrigin(req)) return send(res, 403, { error: 'Bad origin' });
      if (req.method !== 'GET' && !String(req.headers['content-type']).includes('application/json')) return send(res, 415, { error: 'JSON only' });
      const parts = url.pathname.split('/').filter(Boolean); // api, projects, :id
      if (parts[1] === 'providers') return send(res, 200, await detectProviders());
      if (parts[1] === 'projects') {
        const pid = parts[2];
        if (!pid && req.method === 'GET') return send(res, 200, projects);
        if (!pid && req.method === 'POST') { const p = newProject(await body(req)); projects.push(p); save(); return send(res, 200, p); }
        const p = projects.find((x) => x.id === pid);
        if (!p) return send(res, 404, { error: 'No such project' });
        if (req.method === 'GET') return send(res, 200, p);
        if (req.method === 'PUT') {
          const b = await body(req);
          for (const k of ['name', 'cwd', 'hostName', 'handoffs', 'leadId']) if (k in b) p[k] = b[k];
          if (Array.isArray(b.roles)) p.roles = b.roles.map((r) => ({ ...r, id: r.id || id() }));
          if (!p.roles.some((r) => r.id === p.leadId)) p.leadId = p.roles[0]?.id || null;
          save();
          meetings.get(p.id)?.meeting.syncRoles(p);
          return send(res, 200, p);
        }
        if (req.method === 'DELETE') { projects = projects.filter((x) => x !== p); save(); meetings.delete(p.id); return send(res, 200, { ok: true }); }
      }
      return send(res, 404, { error: 'Not found' });
    }
    let file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => okOrigin(req) });
wss.on('connection', (ws, req) => {
  const pid = new URL(req.url, 'http://x').searchParams.get('project');
  const project = projects.find((p) => p.id === pid);
  if (!project) return ws.close(4004, 'No such project');
  const r = room(project);
  r.sockets.add(ws);
  ws.send(JSON.stringify({ type: 'state', ...r.meeting.snapshot() }));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'say') r.meeting.say(m);
    if (m.type === 'stop') r.meeting.stop(m.id);
    if (m.type === 'clear') r.meeting.clear();
  });
  ws.on('close', () => r.sockets.delete(ws));
});

server.listen(PORT, HOST, () => console.log(`Huddle running at http://localhost:${PORT}`));
