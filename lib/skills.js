// Skills for teammates, from Anthropic's public skills library (github.com/anthropics/skills).
//
// The library is downloaded once (and refreshed weekly) into Huddle's data folder.
// Each teammate gets up to three skills that fit its job, copied into a private
// plugin folder that only that teammate's Claude Code session loads (--plugin-dir).
// The user's own Claude Code setup is never changed.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const REPO = 'https://github.com/anthropics/skills';
const TARBALL = 'https://codeload.github.com/anthropics/skills/tar.gz/refs/heads/main';
const WEEK = 7 * 24 * 3600 * 1000;
// Skills that are about Claude itself or this repo, not a teammate's job.
const SKIP = new Set(['skill-creator', 'academy-guide', 'discernment-nudge', 'template']);

const run = (cmd, args, opts = {}) => new Promise((res) => execFile(cmd, args, { timeout: 120000, ...opts }, (err, out, errOut) => res({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') })));

let loading = null;

function libraryDir(dataDir) { return path.join(dataDir, 'skills-library'); }

// Download (or refresh) the library. Git if available, else the release tarball.
export function ensureLibrary(dataDir) {
  const dir = libraryDir(dataDir);
  const stamp = path.join(dir, '.huddle-fetched');
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(stamp).mtimeMs < WEEK; } catch {}
  if (fresh && fs.existsSync(path.join(dir, 'skills'))) return Promise.resolve(dir);
  if (loading) return loading;
  loading = (async () => {
    const tmp = `${dir}.tmp-${Date.now()}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    let ok = (await run('git', ['clone', '--depth', '1', '--quiet', `${REPO}.git`, tmp])).ok;
    if (!ok) {
      fs.mkdirSync(tmp, { recursive: true });
      const r = await fetch(TARBALL);
      if (!r.ok) throw new Error(`Couldn't download the skills library (${r.status})`);
      const tgz = path.join(tmp, 'skills.tgz');
      fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
      ok = (await run('tar', ['-xzf', tgz, '-C', tmp, '--strip-components', '1'])).ok;
      fs.rmSync(tgz, { force: true });
      if (!ok) throw new Error("Couldn't unpack the skills library");
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    fs.writeFileSync(stamp, new Date().toISOString());
    return dir;
  })().finally(() => { loading = null; });
  return loading;
}

function frontmatter(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const get = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
    return { name: get('name'), description: get('description') };
  } catch { return {}; }
}

// [{ id, name, description }]
export async function catalog(dataDir) {
  const dir = await ensureLibrary(dataDir);
  const root = path.join(dir, 'skills');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP.has(d.name) && fs.existsSync(path.join(root, d.name, 'SKILL.md')))
    .map((d) => ({ id: d.name, ...frontmatter(path.join(root, d.name, 'SKILL.md')) }))
    .map((s) => ({ id: s.id, name: s.name || s.id, description: (s.description || '').slice(0, 220) }));
}

// A sensible default from the job, when nobody picked skills for it.
const RULES = [
  [/front ?end|web|ui|ux|react|css|developer|engineer|coder|programmer|full ?stack/i, ['frontend-design', 'webapp-testing', 'web-artifacts-builder']],
  [/design|brand|visual|graphic|illustrat|art/i, ['frontend-design', 'canvas-design', 'brand-guidelines']],
  [/qa|test|quality|review/i, ['webapp-testing']],
  [/writ|doc|content|copy|editor|communicat|pr\b|comms/i, ['doc-coauthoring', 'docx', 'internal-comms']],
  [/analy|data|finance|account|spreadsheet|excel|metric/i, ['xlsx', 'pdf']],
  [/research|investigat|scholar|legal|paper/i, ['pdf', 'docx']],
  [/present|pitch|sales|market|slides|deck/i, ['pptx', 'brand-guidelines']],
  [/integrat|mcp|api|backend|platform|ai engineer|llm/i, ['mcp-builder', 'claude-api']],
];
export function suggestSkills(role, available) {
  const text = `${role.name} ${role.title || ''} ${role.prompt || ''}`;
  const ids = new Set(available.map((s) => s.id));
  const out = [];
  for (const [re, skills] of RULES) if (re.test(text)) for (const s of skills) if (ids.has(s) && !out.includes(s)) out.push(s);
  return out.slice(0, 3);
}

// Give a teammate its skills: a private plugin folder its Claude session loads.
// Sets role.skills (ids) and role.pluginDir. Codex/Gemini/Ollama teammates have no
// Claude skills, so they're left as they are.
export async function equipRole(role, dataDir, { skills } = {}) {
  // Skills are Claude Code skills: only Claude teammates can load them.
  if (role.provider !== 'claude') { delete role.skills; delete role.pluginDir; return role; }
  const available = await catalog(dataDir);
  const ids = new Set(available.map((s) => s.id));
  // An explicit list (even an empty one) is respected; suggestions only for a teammate never given any.
  const explicit = Array.isArray(skills) ? skills : Array.isArray(role.skills) ? role.skills : null;
  const pick = explicit ? explicit.filter((s) => ids.has(s)).slice(0, 5) : suggestSkills(role, available);
  const dir = path.join(dataDir, 'agents', role.id);
  fs.rmSync(dir, { recursive: true, force: true });
  role.skills = pick;
  if (!pick.length) { delete role.pluginDir; return role; }
  const lib = path.join(libraryDir(dataDir), 'skills');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: `huddle-${role.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-skills`,
    version: '1.0.0',
    description: `Skills Huddle gave ${role.name}, from Anthropic's skills library`,
  }, null, 2));
  for (const s of pick) fs.cpSync(path.join(lib, s), path.join(dir, 'skills', s), { recursive: true });
  role.pluginDir = dir;
  return role;
}
