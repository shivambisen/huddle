// Huddle in Claude Code. One install, and Huddle feels like part of Claude:
//  - it starts the Huddle app quietly in the background (no window, no Dock icon);
//  - a Huddle row above the prompt shows this folder's team and what they're doing;
//  - the Huddle panel starts a team (describe the work / one all-rounder / build it
//    yourself), answers "can I bring someone in?", and messages the team;
//  - Join opens the call as a small floating window in the corner of the screen;
//  - a `huddle` tool lets Claude itself ask the team and wait for the answer;
//  - /huddle opens the panel, /huddle <message> messages the team.
// It talks only to Huddle on this computer (http://127.0.0.1:4317).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Live, Proposal, Team } from '../types'

const HUDDLE = 'http://127.0.0.1:4317'
const SITE = 'https://huddle-seven-kappa.vercel.app'
const PANE = 'huddle'

// Bump a shape tag when that value's fields change: it declines what an older version stored.
const live = atom({ plugin: 'huddle', key: 'live' } as const, null, { shape: 'live-2' })
const isHidden = atom({ plugin: 'huddle', key: 'isHidden' } as const, false)
const selected = atom({ plugin: 'huddle', key: 'selected' } as const, null)
const cwdAtom = atom({ plugin: 'huddle', key: 'cwd' } as const, '')
const proposal = atom({ plugin: 'huddle', key: 'proposal' } as const, null, { shape: 'proposal-1' })
const busy = atom({ plugin: 'huddle', key: 'busy' } as const, null)
const launched = atom({ plugin: 'huddle', key: 'launched' } as const, false)
const missingApp = atom({ plugin: 'huddle', key: 'missingApp' } as const, false)
const draft = atom({ plugin: 'huddle', key: 'draft' } as const, '')

// The Huddle app this plugin needs at least (team set-up, invites, the floating call).
const MIN_VERSION = '0.2.0'
const older = (v: string, min: string) => {
  const a = String(v || '0').split('.').map(Number), b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0)
  return false
}
const outdated = (l: Live | null) => !!l && older(l.version, MIN_VERSION)
const DOWNLOAD = `${SITE}/#setup`

const inFolder = (cwd: string, dir: string) => !!cwd && !!dir && (cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : dir + '/'))
const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() || 'Project'

// The team this session is about: one you picked, else the team for this folder.
function pickTeam(l: Live | null, cwd: string, chosen: string | null): Team | null {
  const teams = l?.teams ?? []
  return teams.find(t => t.id === chosen) ?? teams.find(t => t.live && inFolder(cwd, t.cwd)) ?? teams.find(t => inFolder(cwd, t.cwd)) ?? null
}

function summary(team: Team): string {
  const inv = team.invites?.[0]
  if (inv) return `✋ ${inv.from} wants to bring in a ${inv.job}`
  const working = team.agents.filter(a => a.status === 'working')
  const [only] = working
  if (only && working.length === 1) return `${only.name} is working`
  if (working.length > 1) return `${working.length} teammates working`
  const last = team.recent[team.recent.length - 1]
  if (last) return `${last.from}: ${last.text}`
  return team.live ? 'call in progress' : `${team.agents.map(a => a.name).join(', ') || 'no one yet'}`
}

// Open a link with whatever this computer uses (macOS, Windows, Linux).
async function openUrl($: EngineInterface, url: string, background = false): Promise<boolean> {
  const tries = background ? [['open', '-g', url], ['cmd', '/c', 'start', '', url], ['xdg-open', url]] : [['open', url], ['cmd', '/c', 'start', '', url], ['xdg-open', url]]
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv)
      if (r.exitCode === 0) return true
    } catch {}
  }
  return false
}

async function api($: EngineInterface, path: string, body?: unknown): Promise<any> {
  const r = await $.http.fetch(`${HUDDLE}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = r.text ? JSON.parse(r.text) : {}
  if (r.status === 404 && data?.error === 'Not found') throw new Error(`Your Huddle app is too old for this. Update it from ${SITE}`)
  if (!r.ok) throw new Error(data?.error || `Huddle said ${r.status}`)
  return data
}

async function refresh($: EngineInterface) {
  let next: Live | null = null
  try {
    const body = await api($, '/api/live')
    if (body?.app === 'huddle' && Array.isArray(body.teams)) next = body as Live
  } catch {}
  await update($, live, () => next)
  const team = pickTeam(next, await read($, cwdAtom), await read($, selected))
  $.ui.status(team?.live || team?.invites?.length ? `🎧 Huddle · ${team.name} · ${summary(team)}`.slice(0, 90) : undefined)
  return next
}

// Start the Huddle app quietly (no window) once per session, then say hello to it.
async function wake($: EngineInterface) {
  if (await refresh($)) return true
  if (!(await read($, launched))) {
    await update($, launched, () => true)
    if (!(await openUrl($, 'huddle://background', true))) { await update($, missingApp, () => true); return false }
    await update($, missingApp, () => false)
  }
  for (let i = 0; i < 10; i++) {
    await $.clock.sleep(1500)
    if (await refresh($)) break
  }
  const l = await read($, live)
  if (!l) return false
  let host = ''
  try { host = (await $.process.run(['git', 'config', 'user.name'])).stdout.trim() } catch {}
  try { await api($, '/api/quickstart', { cwd: await read($, cwdAtom), hostName: host }) } catch {}
  return true
}

// Join in the Huddle app: it opens as a small floating window in the corner.
async function join($: EngineInterface, team: Team | null) {
  if (team && (await openUrl($, `huddle://p/${team.id}/meet`, true))) return
  if (team && (await openUrl($, team.joinUrl))) return
  $.ui.toast(`Huddle isn't installed. Get it at ${SITE}`)
}

async function say($: EngineInterface, team: Team | null, text: string): Promise<string> {
  if (!team) return "There's no Huddle team for this folder yet. Open the Huddle panel (/huddle) to start one."
  try {
    await api($, `/api/projects/${team.id}/say`, { text })
    void refresh($)
    return `Sent to ${team.name}. Replies show in the Huddle panel.`
  } catch (e) {
    return `Couldn't reach Huddle: ${(e as Error).message}`
  }
}

async function createTeam($: EngineInterface, body: Record<string, unknown>) {
  const cwd = await read($, cwdAtom)
  await update($, busy, () => 'Setting up your team…')
  try {
    const p = await api($, '/api/projects', { name: folderName(cwd), cwd, ...body })
    await update($, proposal, () => null)
    await update($, selected, () => p.id)
    await refresh($)
    $.ui.toast(`Your Huddle team is ready: ${p.roles.map((r: { name: string }) => r.name).join(', ')}`)
  } catch (e) {
    $.ui.toast(`Couldn't create the team: ${(e as Error).message}`)
  } finally {
    await update($, busy, () => null)
  }
}

async function propose($: EngineInterface, description: string) {
  await update($, busy, () => 'Working out who you need…')
  try {
    const pr = await api($, '/api/teams/propose', { description, cwd: await read($, cwdAtom) })
    const roles = Array.isArray(pr.roles) ? pr.roles : []
    const next: Proposal = { summary: String(pr.summary || ''), roles: roles.map((r: any) => ({ name: r.name, title: r.title, why: r.why, provider: r.provider, skills: r.skills })), raw: roles }
    await update($, proposal, () => next)
  } catch (e) {
    $.ui.toast(`Couldn't put a team together: ${(e as Error).message}`)
  } finally {
    await update($, busy, () => null)
  }
}

const providerName = (p: string) => (p === 'codex' ? 'ChatGPT' : p === 'claude' ? 'Claude' : p === 'gemini' ? 'Gemini' : p)

// ---------- drawing helpers ----------
// The same orbs as the call screen: a glowing sphere in each AI's colours that swirls
// faster while its teammate works. SVG on the desktop app; a coloured dot in a terminal.
const ORB: Record<string, [string, string, string]> = {
  claude: ['#fde8d6', '#f0a978', '#c2643d'],
  codex: ['#e3fff4', '#49c89c', '#0b7d60'],
  gemini: ['#f6c6dc', '#9a6fd0', '#3f5fe0'],
  ollama: ['#f3f4f5', '#a3a9b1', '#50555c'],
}
function orbSource(provider: string, index: number, state: string): string {
  const [c, b, a] = ORB[provider] ?? ORB.claude!
  const id = `o${provider}${index}${state}`
  const spin = state === 'working' ? 3 : 14
  const shift = ((index * 29) % 26) - 13
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><radialGradient id="g${id}" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="${c}"/><stop offset=".38" stop-color="${b}"/><stop offset=".78" stop-color="${a}"/><stop offset="1" stop-color="${a}" stop-opacity=".85"/></radialGradient>
<filter id="b${id}"><feGaussianBlur stdDeviation="3"/></filter><clipPath id="c${id}"><circle cx="32" cy="32" r="30"/></clipPath></defs>
<g style="filter:hue-rotate(${shift}deg)"${state === 'error' ? ' opacity=".5"' : ''}>
<circle cx="32" cy="32" r="30" fill="url(#g${id})"/>
<g clip-path="url(#c${id})" filter="url(#b${id})" opacity=".75"><ellipse cx="32" cy="14" rx="20" ry="7" fill="${c}"><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="${spin}s" repeatCount="indefinite"/></ellipse>
<ellipse cx="32" cy="50" rx="16" ry="6" fill="${b}"><animateTransform attributeName="transform" type="rotate" from="180 32 32" to="540 32 32" dur="${spin * 1.3}s" repeatCount="indefinite"/></ellipse></g>
<ellipse cx="24" cy="19" rx="11" ry="7" fill="#fff" opacity=".55" filter="url(#b${id})"/></g></svg>`
}
function orb($: EngineInterface, e: { surface: string | null }, provider: string, index: number, state: string, size: number) {
  const ui = $.ui.resolve(e as any) as any
  if (e.surface === 'desktop' || e.surface === 'mobile') return <ui.Svg source={orbSource(provider, index, state)} alt={`${providerName(provider)} teammate`} width={size} height={size} />
  const [, , a] = ORB[provider] ?? ORB.claude!
  return <ui.Text color={a}>{state === 'working' ? '◉' : '●'}</ui.Text>
}
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#141414"/><path d="M16 2a14 14 0 0 1 0 28z" fill="#c2643d"/></svg>`
function logo($: EngineInterface, e: { surface: string | null }, size = 16) {
  const ui = $.ui.resolve(e as any) as any
  if (e.surface === 'desktop' || e.surface === 'mobile') return <ui.Svg source={LOGO} alt="Huddle" width={size} height={size} />
  return <ui.Text color="#c2643d">◐</ui.Text>
}

// Text sizes and weights only where the surface supports them; a terminal gets bold instead.
function styles(e: { surface: string | null }) {
  const rich = e.surface === 'desktop' || e.surface === 'mobile'
  return {
    small: {} as any,
    head: { bold: true } as any,
    clamp: {} as any, // the panel doesn't take maxLines
    strong: { bold: true } as any,
    medium: { bold: true } as any,
    plain: { bold: false } as any,
  }
}

// Install or update the Huddle app from Claude Code, in one click. On a Mac this runs the
// same one-line installer as the website (a curl download isn't quarantined, so macOS
// doesn't block the unsigned app); on Windows it installs silently for this user.
const INSTALL_MAC = `curl -fsSL ${SITE}/install.sh | bash`
const INSTALL_WIN = "$f = Join-Path $env:TEMP 'HuddleSetup.exe'; curl.exe -fsSL -o $f https://github.com/shivambisen/huddle/releases/latest/download/Huddle-win-x64.exe; if ($LASTEXITCODE) { exit 1 }; Start-Process $f -ArgumentList '/S' -Wait; Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\\Huddle\\Huddle.exe') -ArgumentList '--background'"

async function installApp($: EngineInterface) {
  await update($, busy, () => 'Installing Huddle… (about a minute)')
  $.ui.toast('Installing Huddle…')
  try {
    let isMac = true
    try { isMac = (await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin' } catch { isMac = false }
    const r = isMac
      ? await $.process.run(['bash', '-c', INSTALL_MAC], { timeoutMs: 600000 })
      : await $.process.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_WIN], { timeoutMs: 600000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-1)[0] || 'the installer failed')
    await update($, missingApp, () => false)
    await update($, launched, () => true)
    for (let i = 0; i < 15 && !(await refresh($)); i++) await $.clock.sleep(1500)
    const l = await read($, live)
    $.ui.toast(l ? `Huddle ${l.version} is installed and running.` : 'Huddle is installed. It will start with your next Claude Code session.')
    if (l) { try { await api($, '/api/quickstart', { cwd: await read($, cwdAtom) }) } catch {} }
  } finally {
    await update($, busy, () => null)
  }
}

// Every button goes through this: a failure shows as a toast instead of silently doing nothing.
function safe($: EngineInterface, work: () => Promise<unknown> | unknown) {
  return async () => {
    try {
      if ((await work()) === false) $.ui.toast("Huddle: that didn't open. Is the Huddle app installed?")
    } catch (e) { $.ui.toast(`Huddle: ${(e as Error).message || e}`) }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, cwdAtom, () => e.cwd)
    await update($, launched, () => false)
    await $.command.register({ name: 'huddle', description: 'Open the Huddle panel, or message your AI team: /huddle Developer, run the tests' })
    await $.tool.register({
      name: 'huddle',
      isDeferred: false,
      description:
        "Message the user's Huddle team: AI teammates (each its own Claude Code or Codex session, with a role like Developer or Researcher) working in this project with the user, like colleagues on a call. " +
        "Use it when the user asks you to ask, tell, check with or involve a teammate (\"ask the researcher…\", \"get the team's take\"). Start the message with the teammate's name, or \"Everyone,\". " +
        'By default it waits for the first reply and returns it; set wait to false to just send.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'What to say, starting with a teammate name, e.g. "Researcher, which DXF libraries are maintained?"' },
          wait: { type: 'boolean', description: 'Wait for the first reply (default true, up to about a minute)' },
        },
        required: ['message'],
      },
    })
    void wake($)
    $.clock.every(4000, () => refresh($))
    return next(e)
  })

  // Claude asks the team (and usually waits for the answer).
  // Answered at tool.call: the tool is this mod's own, so there's nothing further to run.
  on('tool.call', { tool: 'mcp__huddle__huddle' as never }, async ($, e) => {
    const input = e as unknown as { message?: string; wait?: boolean }
    const message = String(input.message || '').trim()
    if (!message) return { result: 'Nothing to send.' }
    if (!(await wake($))) return { result: `Huddle isn't running and couldn't be started. The user can install it from ${SITE}.` }
    const team = pickTeam(await read($, live), await read($, cwdAtom), await read($, selected))
    if (!team) return { result: "This folder has no Huddle team yet. Tell the user they can start one from the Huddle panel (/huddle)." }
    const host = (await read($, live))?.host || 'You'
    const since = Date.now()
    const sent = await say($, team, message)
    if (input.wait === false || !sent.startsWith('Sent')) return { result: sent }
    for (let i = 0; i < 30; i++) {
      await $.clock.sleep(2000)
      const l = await refresh($)
      const t = l?.teams.find(x => x.id === team.id)
      const replies = (t?.recent ?? []).filter(x => x.ts > since && x.from !== host)
      if (replies.length) return { result: replies.map(x => `${x.from}: ${x.text}`).join('\n') }
    }
    return { result: `Sent to ${team.name}. No reply within a minute; it will show in the Huddle panel when it comes.` }
  })

  on('command.run', { command: 'huddle' }, async ($, e) => {
    const text = e.args.trim()
    const l = (await read($, live)) ?? ((await wake($)) ? await read($, live) : null)
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))
    if (text) return { text: await say($, team, text) }
    await update($, isHidden, () => false)
    await $.ui.open({ id: PANE, title: 'Huddle' })
    return { text: l ? 'Huddle panel opened.' : "Huddle isn't running yet. Install it from " + SITE }
  })

  // The Huddle row above the prompt: logo, one line of status, one main action.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const st = styles(e)
    const l = await read($, live)
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))
    const inv = team?.invites?.[0]
    const missing = await read($, missingApp)
    const status = !l ? (missing ? 'not installed' : 'starting…') : outdated(l) ? 'needs an update' : team ? summary(team) : 'no team for this folder yet'

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {logo($, e)}
        <Text {...st.strong}>Huddle</Text>
        {team && <Text {...st.medium}>{team.name}</Text>}
        {team?.live && <Text color="success">● live</Text>}
        <Text dimColor wrap="truncate-end">{status}</Text>
        {!l && <Button key="huddle-install" variant="primary" label={missing ? 'Install Huddle' : 'Start Huddle'} onPress={safe($, () => (missing ? installApp($) : (update($, launched, () => false), wake($))))} />}
        {outdated(l) && <Button key="huddle-update" variant="primary" label="Update" onPress={safe($, () => installApp($))} />}
        {l && !outdated(l) && inv && team && <Button key="huddle-approve" variant="primary" label={`Bring in ${inv.job}`} onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/approve`, {}).then(() => refresh($)))} />}
        {l && !outdated(l) && !inv && team && <Button key="huddle-join" variant="primary" label={team.live ? 'Join call' : 'Start call'} onPress={safe($, () => join($, team))} />}
        {l && !outdated(l) && !team && <Button key="huddle-start" variant="primary" label="Start a team" onPress={safe($, () => $.ui.open({ id: PANE, title: 'Huddle' }))} />}
        <Button key="huddle-panel" plain label="Open panel" onPress={safe($, () => $.ui.open({ id: PANE, title: 'Huddle' }))} />
        <Button key="huddle-hide" plain role="dismiss" label="✕" onPress={safe($, () => update($, isHidden, () => true))} />
      </Box>
    )
  })

  // The Huddle panel.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Progress, Text } = $.ui.resolve(e)
    const st = styles(e)
    const l = await read($, live)
    const cwd = await read($, cwdAtom)
    const team = pickTeam(l, cwd, await read($, selected))
    const working = await read($, busy)
    const missing = await read($, missingApp)

    const Section = ({ title, children }: { title: string; children?: unknown }) => (
      <Box flexDirection="column" gap={1}>
        <Text {...st.small} {...st.strong} dimColor>{title.toUpperCase()}</Text>
        {children as any}
      </Box>
    )
    const Card = ({ tone, children }: { tone?: string; children?: unknown }) => (
      <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={tone || 'subtle'}>
        {children as any}
      </Box>
    )
    const header = (title: string, sub?: string, chip?: unknown) => (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {logo($, e, 22)}
          <Text {...st.head} wrap="truncate-end">{title}</Text>
          {chip as any}
        </Box>
        {sub ? <Text dimColor {...st.small} wrap="truncate-start">{sub}</Text> : null}
      </Box>
    )

    if (working) {
      return (
        <Box flexDirection="column" gap={2}>
          {header('Huddle')}
          <Progress label={working} color="claude" />
        </Box>
      )
    }

    if (!l) {
      return (
        <Box flexDirection="column" gap={2}>
          {header('Huddle', 'Your AI team, on one call')}
          <Card tone="claude">
            <Text {...st.strong}>{missing ? 'Install Huddle to get started' : "Huddle isn't running"}</Text>
            <Text dimColor>Huddle puts AI teammates (on your Claude or ChatGPT plan) on a voice call right beside Claude Code. Install it once; it then starts by itself whenever you use Claude Code.</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="install" variant="primary" label={missing ? 'Install Huddle' : 'Reinstall Huddle'} onPress={safe($, () => installApp($))} />
              {!missing && <Button key="start" label="Start Huddle" onPress={safe($, () => { void update($, launched, () => false); void wake($) })} />}
              <Button key="site" plain label="What is Huddle?" onPress={safe($, () => openUrl($, SITE))} />
            </Box>
          </Card>
        </Box>
      )
    }

    if (outdated(l)) {
      return (
        <Box flexDirection="column" gap={2}>
          {header('Huddle')}
          <Card tone="warning">
            <Text {...st.strong}>Huddle needs an update</Text>
            <Text dimColor>You have Huddle {l.version}; starting teams, invites and the floating call need {MIN_VERSION} or newer. Updating takes about a minute and keeps your teams.</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="update" variant="primary" label="Update Huddle" onPress={safe($, () => installApp($))} />
              <Button key="recheck" plain label="Check again" onPress={safe($, () => refresh($))} />
            </Box>
          </Card>
        </Box>
      )
    }

    // No team for this folder yet: three ways to start one.
    if (!team) {
      const pr = await read($, proposal)
      if (pr) {
        return (
          <Box flexDirection="column" gap={2}>
            {header('Your team', pr.summary || undefined)}
            <Box flexDirection="column" gap={1}>
              {pr.roles.map((r, i) => (
                <Card>
                  <Box flexDirection="row" alignItems="center" gap={1}>
                    {orb($, e, r.provider, i, '', 30)}
                    <Box flexDirection="column" flexGrow={1}>
                      <Text {...st.strong}>{r.name} <Text dimColor {...st.plain}>· {r.title}</Text></Text>
                      <Text dimColor {...st.small}>{providerName(r.provider)}{r.skills?.length ? ` · skills: ${r.skills.join(', ')}` : ''}</Text>
                    </Box>
                  </Box>
                  {r.why ? <Text dimColor {...st.small}>{r.why}</Text> : null}
                </Card>
              ))}
            </Box>
            <Box flexDirection="row" gap={1}>
              <Button key="accept" variant="primary" label={pr.roles.length === 1 ? 'Start with them' : `Start with these ${pr.roles.length}`} onPress={safe($, () => createTeam($, { mode: 'assembled', roles: pr.raw }))} />
              <Button key="again" label="Describe again" onPress={safe($, () => update($, proposal, () => null))} />
            </Box>
          </Box>
        )
      }
      const others = l.teams.slice(0, 5)
      return (
        <Box flexDirection="column" gap={2}>
          {header('Start a team', `for ${folderName(cwd)}`)}
          <Card tone="claude">
            <Text {...st.strong}>What are you working on?</Text>
            <Text dimColor {...st.small}>Huddle invites only the teammates this needs, each with matching Claude skills. They work in this folder and talk to you like colleagues on a call.</Text>
            <Input
              key="describe"
              placeholder="e.g. A 2D drafting tool in the browser: lines, snapping and DXF export"
              rows={3}
              submitLabel="find my team"
              onInput={(value: string) => { void update($, draft, () => value) }}
              onSubmit={(value: string) => { if (value.trim()) void propose($, value.trim()) }}
            />
            <Box flexDirection="row">
              <Button key="find" variant="primary" label="Find my team" onPress={safe($, async () => {
                const text = (await read($, draft)).trim()
                if (!text) return $.ui.toast('Describe the work first.')
                return propose($, text)
              })} />
            </Box>
          </Card>
          <Section title="Or">
            <Box flexDirection="row" alignItems="center" gap={1}>
              {orb($, e, 'claude', 0, '', 26)}
              <Box flexDirection="column" flexGrow={1}>
                <Text {...st.medium}>One all-rounder</Text>
                <Text dimColor {...st.small}>Starts small and asks before bringing anyone in.</Text>
              </Box>
              <Button key="allrounder" label="Start" onPress={safe($, () => createTeam($, { mode: 'allrounder' }))} />
            </Box>
            <Box flexDirection="row" alignItems="center" gap={1}>
              {orb($, e, 'codex', 1, '', 26)}
              <Box flexDirection="column" flexGrow={1}>
                <Text {...st.medium}>Pick teammates yourself</Text>
                <Text dimColor {...st.small}>Choose each one's AI, model, voice and skills in Huddle.</Text>
              </Box>
              <Button key="custom" label="Open" onPress={safe($, () => openUrl($, 'huddle://new'))} />
            </Box>
          </Section>
          {others.length > 0 && (
            <Section title="Your other teams">
              {others.map(t => (
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Box flexDirection="column" flexGrow={1}>
                    <Text {...st.medium}>{t.live ? <Text color="success">● </Text> : null}{t.name}</Text>
                    <Text dimColor {...st.small} wrap="truncate-start">{t.agents.map(a => a.name).join(', ') || 'no one yet'} · {folderName(t.cwd)}</Text>
                  </Box>
                  <Button key={`team-${t.id}`} plain label="Use here" onPress={safe($, () => update($, selected, () => t.id))} />
                </Box>
              ))}
            </Section>
          )}
        </Box>
      )
    }

    const room = Math.max(3, Math.min(8, (e.viewport?.rows ?? 30) - 18))
    const chip = team.live ? <Text color="success" {...st.small} {...st.strong}>● LIVE</Text> : <Text dimColor {...st.small}>not on a call</Text>
    return (
      <Box flexDirection="column" gap={2}>
        {header(team.name, team.cwd, chip)}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="join" variant="primary" label={team.live ? 'Join call' : 'Start call'} onPress={safe($, () => join($, team))} />
          <Button key="refresh" plain label="Refresh" onPress={safe($, () => refresh($))} />
          {(await read($, selected)) && !inFolder(cwd, team.cwd) && <Button key="unpick" plain label="Back to this folder" onPress={safe($, () => update($, selected, () => null))} />}
        </Box>
        {(team.invites ?? []).map(inv => (
          <Card tone="warning">
            <Text>✋ <Text {...st.strong}>{inv.from}</Text> wants to bring in a <Text {...st.strong}>{inv.job}</Text></Text>
            {inv.reason ? <Text dimColor {...st.small}>{inv.reason}</Text> : null}
            <Box flexDirection="row" gap={1}>
              <Button key={`yes-${inv.id}`} variant="primary" label="Bring them in" onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/approve`, {}).then(() => refresh($)))} />
              <Button key={`no-${inv.id}`} label="Not now" onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/decline`, {}).then(() => refresh($)))} />
            </Box>
          </Card>
        ))}
        <Section title={`People · ${team.agents.length}`}>
          {team.agents.length === 0 && <Text dimColor>No one on this team yet. Say “bring in a developer” below.</Text>}
          {team.agents.map((a, i) => (
            <Box flexDirection="row" alignItems="center" gap={1}>
              {orb($, e, a.provider, i, a.status === 'working' ? 'working' : a.status === 'error' ? 'error' : '', 30)}
              <Box flexDirection="column" flexGrow={1}>
                <Text {...st.strong} wrap="truncate-end">{a.name} <Text dimColor {...st.plain}>· {a.title || providerName(a.provider)}</Text></Text>
                <Text {...st.small} wrap="truncate-end" color={a.status === 'working' ? 'claude' : a.status === 'error' ? 'error' : undefined} dimColor={a.status !== 'working' && a.status !== 'error'}>
                  {a.status === 'working' ? (a.activity && !/^thinking/.test(a.activity) ? a.activity : 'Thinking…') : a.status === 'error' ? a.activity : `${providerName(a.provider)}${a.model && a.model !== 'default' ? ` · ${a.model}` : ''}`}
                </Text>
              </Box>
            </Box>
          ))}
        </Section>
        {team.recent.length > 0 && (
          <Section title="Recent">
            {team.recent.slice(-room).map(line => (
              <Box flexDirection="column">
                <Text {...st.small}><Text {...st.strong}>{line.from}</Text><Text dimColor> → {line.to}</Text></Text>
                <Text wrap="wrap" {...st.clamp}>{line.text}</Text>
              </Box>
            ))}
          </Section>
        )}
        <Input
          key="huddle-message"
          placeholder="Message the team: start with a name, or “bring in a designer”"
          submitLabel="send"
          onSubmit={async (value: string) => {
            const text = value.trim()
            if (text) $.ui.toast(await say($, team, text))
          }}
        />
      </Box>
    )
  })
}
