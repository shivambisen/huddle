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

  // The Huddle row above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, live)
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))
    const inv = team?.invites?.[0]

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color="#c2643d">◐</Text>
        <Text bold>Huddle</Text>
        {!l && <Text dimColor>{(await read($, missingApp)) ? 'not installed' : 'starting…'}</Text>}
        {outdated(l) && <Text color="#b7791f">needs an update for this plugin</Text>}
        {outdated(l) && <Button key="huddle-update" variant="primary" label="Update Huddle" onPress={safe($, () => installApp($))} />}
        {l && team && (
          <Text dimColor wrap="truncate-end">
            {team.live ? '● ' : ''}
            {team.name} · {summary(team)}
          </Text>
        )}
        {l && !team && <Text dimColor>no team for this folder yet</Text>}
        {team && inv && <Button key="huddle-approve" label="Bring them in" onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/approve`, {}).then(() => refresh($)))} />}
        {team && <Button key="huddle-join" label={team.live ? 'Join call' : 'Start call'} onPress={safe($, () => join($, team))} />}
        {l && !team && <Button key="huddle-start" label="Start a team" onPress={safe($, () => $.ui.open({ id: PANE, title: 'Huddle' }))} />}
        {!l && <Button key="huddle-get" variant="primary" label="Install Huddle" onPress={safe($, () => installApp($))} />}
        <Button key="huddle-panel" label="Panel" onPress={safe($, () => $.ui.open({ id: PANE, title: 'Huddle' }))} />
        <Button key="huddle-hide" label="Hide" onPress={safe($, () => update($, isHidden, () => true))} />
      </Box>
    )
  })

  // The Huddle panel.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const l = await read($, live)
    const cwd = await read($, cwdAtom)
    const team = pickTeam(l, cwd, await read($, selected))
    const working = await read($, busy)

    if (working) return <Text dimColor>{working}</Text>

    if (!l) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{(await read($, missingApp)) ? "Huddle isn't installed yet." : "Huddle isn't running on this computer."}</Text>
          <Text dimColor>Huddle puts your AI teammates on a voice call, right next to Claude Code. Install it once; after that it starts by itself whenever you use Claude Code.</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="install" variant="primary" label="Install Huddle" onPress={safe($, () => installApp($))} />
            <Button key="start" label="Start Huddle" onPress={safe($, () => { void update($, launched, () => false); void wake($) })} />
            <Button key="site" label="About Huddle" onPress={safe($, () => openUrl($, SITE))} />
          </Box>
        </Box>
      )
    }

    if (outdated(l)) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Huddle needs an update</Text>
          <Text dimColor>You're running Huddle {l.version}. This plugin needs {MIN_VERSION} or newer for starting teams, invites and the floating call. Update Huddle installs the new version and restarts it.</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="update" variant="primary" label="Update Huddle" onPress={safe($, () => installApp($))} />
            <Button key="recheck" label="Check again" onPress={safe($, () => refresh($))} />
          </Box>
        </Box>
      )
    }

    if (working) return <Text dimColor>{working}</Text>

    // No team for this folder yet: three ways to start one.
    if (!team) {
      const pr = await read($, proposal)
      if (pr) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>{pr.summary || 'Your team'}</Text>
            <Box flexDirection="column">
              {pr.roles.map(r => (
                <Text wrap="wrap">
                  <Text bold>{r.name}</Text>
                  <Text dimColor> · {r.title} · {providerName(r.provider)}{r.skills?.length ? ` · skills: ${r.skills.join(', ')}` : ''}</Text>
                  {r.why ? <Text dimColor>{'\n'}  {r.why}</Text> : null}
                </Text>
              ))}
            </Box>
            <Box flexDirection="row" gap={1}>
              <Button key="accept" label="Start with this team" onPress={safe($, () => createTeam($, { mode: 'assembled', roles: pr.raw }))} />
              <Button key="again" label="Describe again" onPress={safe($, () => update($, proposal, () => null))} />
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Start a Huddle team for {folderName(cwd)}</Text>
          <Text dimColor>Your teammates work in this folder and talk to you like colleagues on a call.</Text>
          <Input
            key="describe"
            label="Describe the work"
            placeholder="e.g. A 2D drafting tool in the browser: lines, snapping, DXF export"
            submitLabel="assemble"
            rows={2}
            onSubmit={(value: string) => { if (value.trim()) void propose($, value.trim()) }}
          />
          <Text dimColor>Huddle invites only the people that work needs, each with matching Claude skills.</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="allrounder" label="Just an all-rounder" onPress={safe($, () => createTeam($, { mode: 'allrounder' }))} />
            <Button key="custom" label="Build it myself" onPress={safe($, () => openUrl($, 'huddle://new'))} />
          </Box>
          {l.teams.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>Or use a team from another folder</Text>
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {l.teams.slice(0, 4).map(t => <Button key={`team-${t.id}`} label={t.name} onPress={safe($, () => update($, selected, () => t.id))} />)}
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    const room = Math.max(3, Math.min(8, (e.viewport?.rows ?? 30) - 18))
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            {team.name} <Text dimColor>{team.live ? '● on a call' : 'not on a call'}</Text>
          </Text>
          <Text dimColor wrap="truncate-start">{team.cwd}</Text>
        </Box>
        {(team.invites ?? []).map(inv => (
          <Box flexDirection="column">
            <Text wrap="wrap">✋ <Text bold>{inv.from}</Text> wants to bring in a <Text bold>{inv.job}</Text>{inv.reason ? <Text dimColor>: {inv.reason}</Text> : null}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key={`yes-${inv.id}`} label="Bring them in" onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/approve`, {}).then(() => refresh($)))} />
              <Button key={`no-${inv.id}`} label="Not now" onPress={safe($, () => api($, `/api/projects/${team.id}/invites/${inv.id}/decline`, {}).then(() => refresh($)))} />
            </Box>
          </Box>
        ))}
        <Box flexDirection="column">
          {team.agents.map(a => (
            <Text wrap="truncate-end">
              <Text color={a.status === 'working' ? '#c2643d' : a.status === 'error' ? 'red' : undefined}>
                {a.status === 'working' ? '◉' : a.status === 'error' ? '✕' : '○'}
              </Text>{' '}
              {a.name}
              <Text dimColor>
                {' '}· {providerName(a.provider)}
                {a.status === 'working' && a.activity ? ` · ${a.activity}` : a.status === 'error' ? ` · ${a.activity}` : ''}
              </Text>
            </Text>
          ))}
        </Box>
        {team.recent.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Recent</Text>
            {team.recent.slice(-room).map(line => (
              <Text wrap="wrap" maxLines={3}>
                <Text bold>{line.from}</Text>
                <Text dimColor> → {line.to}: </Text>
                {line.text}
              </Text>
            ))}
          </Box>
        )}
        <Input
          key="huddle-message"
          label="Message"
          placeholder="Start with a name: Developer, run the tests. Or: bring in a designer"
          submitLabel="send"
          onSubmit={async (value: string) => {
            const text = value.trim()
            if (text) $.ui.toast(await say($, team, text))
          }}
        />
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="join" label={team.live ? 'Join call' : 'Start call'} onPress={safe($, () => join($, team))} />
          <Button key="refresh" label="Refresh" onPress={safe($, () => refresh($))} />
        </Box>
      </Box>
    )
  })
}
