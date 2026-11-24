// Huddle in Claude Code: a Huddle row above the prompt, a live panel, a status
// line entry and /huddle. It talks only to the Huddle app on this computer
// (http://127.0.0.1:4317) and opens calls in the Huddle app (huddle://) or the browser.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Live, Team } from '../types'

const HUDDLE = 'http://127.0.0.1:4317'
const SITE = 'https://huddle-seven-kappa.vercel.app'
const PANE = 'huddle'

// Bump the shape tag when Live's fields change: it declines what an older version stored.
const live = atom({ plugin: 'huddle', key: 'live' } as const, null, { shape: 'live-1' })
const isHidden = atom({ plugin: 'huddle', key: 'isHidden' } as const, false)
const selected = atom({ plugin: 'huddle', key: 'selected' } as const, null)
const cwdAtom = atom({ plugin: 'huddle', key: 'cwd' } as const, '')

const inFolder = (cwd: string, dir: string) => !!cwd && !!dir && (cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : dir + '/'))

// The team this session is about: one you picked, else the team for this folder, else a live call.
function pickTeam(l: Live | null, cwd: string, chosen: string | null): Team | null {
  const teams = l?.teams ?? []
  return (
    teams.find(t => t.id === chosen) ??
    teams.find(t => t.live && inFolder(cwd, t.cwd)) ??
    teams.find(t => inFolder(cwd, t.cwd)) ??
    teams.find(t => t.live) ??
    null
  )
}

function summary(team: Team): string {
  const working = team.agents.filter(a => a.status === 'working')
  const [only] = working
  if (only && working.length === 1) return `${only.name} is working`
  if (working.length > 1) return `${working.length} teammates working`
  const last = team.recent[team.recent.length - 1]
  if (last) return `${last.from}: ${last.text}`
  return team.live ? 'call in progress' : `${team.agents.length} teammates`
}

// Open a link with whatever this computer uses (macOS, Windows, Linux).
async function openUrl($: EngineInterface, url: string): Promise<boolean> {
  for (const argv of [['open', url], ['cmd', '/c', 'start', '', url], ['xdg-open', url]]) {
    try {
      const r = await $.process.run(argv)
      if (r.exitCode === 0) return true
    } catch {}
  }
  return false
}

async function refresh($: EngineInterface) {
  let next: Live | null = null
  try {
    const r = await $.http.fetch(`${HUDDLE}/api/live`)
    if (r.ok) {
      const body = JSON.parse(r.text)
      if (body?.app === 'huddle' && Array.isArray(body.teams)) next = body as Live
    }
  } catch {}
  await update($, live, () => next)
  const team = pickTeam(next, await read($, cwdAtom), await read($, selected))
  $.ui.status(team?.live ? `🎧 Huddle · ${team.name} · ${summary(team)}`.slice(0, 80) : undefined)
  return next
}

// Join in the Huddle app if it's installed, else in the browser.
async function join($: EngineInterface, team: Team | null) {
  if (team && (await openUrl($, `huddle://p/${team.id}/meet`))) return
  if (team && (await openUrl($, team.joinUrl))) return
  if (await openUrl($, 'huddle://')) return
  $.ui.toast(`Huddle isn't installed. Get it at ${SITE}`)
}

async function say($: EngineInterface, team: Team | null, text: string): Promise<string> {
  if (!team) return "There's no Huddle team for this folder yet. Open Huddle to create one."
  try {
    const r = await $.http.fetch(`${HUDDLE}/api/projects/${team.id}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!r.ok) return `Huddle said no: ${r.text.slice(0, 120)}`
    void refresh($)
    return `Sent to ${team.name}. Replies show in the Huddle panel.`
  } catch {
    return "Couldn't reach Huddle. Is the app running?"
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, cwdAtom, () => e.cwd)
    await $.command.register({
      name: 'huddle',
      description: 'Open the Huddle panel, or message your AI team: /huddle Developer, run the tests',
    })
    await refresh($)
    $.clock.every(4000, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'huddle' }, async ($, e) => {
    const text = e.args.trim()
    const l = (await read($, live)) ?? (await refresh($))
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))
    if (text) return { text: await say($, team, text) }
    await update($, isHidden, () => false)
    await $.ui.open({ id: PANE, title: 'Huddle' })
    return { text: l ? 'Huddle panel opened.' : "Huddle isn't running. Press Start Huddle in the panel." }
  })

  // The Huddle row above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, live)
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color="#c2643d">◐</Text>
        <Text bold>Huddle</Text>
        {!l && <Text dimColor>not running</Text>}
        {l && team && (
          <Text dimColor wrap="truncate-end">
            {team.live ? '● ' : ''}
            {team.name} · {summary(team)}
          </Text>
        )}
        {l && !team && <Text dimColor>no team for this folder</Text>}
        <Button
          key="huddle-join"
          label={!l ? 'Start Huddle' : team?.live ? 'Join call' : team ? 'Start call' : 'Open Huddle'}
          onPress={() => join($, team)}
        />
        <Button key="huddle-panel" label="Panel" onPress={() => $.ui.open({ id: PANE, title: 'Huddle' })} />
        <Button key="huddle-hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  // The Huddle panel: who's on the call, what they're doing, what was said, and a message box.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const l = await read($, live)
    const team = pickTeam(l, await read($, cwdAtom), await read($, selected))

    if (!l) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Huddle isn't running on this computer.</Text>
          <Text dimColor>Huddle puts your AI agents on a voice call. Start it, then come back here.</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="start" label="Start Huddle" onPress={() => join($, null)} />
            <Button key="site" label="Get Huddle" onPress={() => openUrl($, SITE)} />
          </Box>
        </Box>
      )
    }

    const others = l.teams.filter(t => t.id !== team?.id).slice(0, 4)
    const room = Math.max(3, Math.min(8, (e.viewport?.rows ?? 30) - 18))

    return (
      <Box flexDirection="column" gap={1}>
        {!team && <Text dimColor>No Huddle team yet. Open Huddle to create one.</Text>}
        {team && (
          <Box flexDirection="column">
            <Text bold>
              {team.name} <Text dimColor>{team.live ? '● live call' : 'not on a call'}</Text>
            </Text>
            <Text dimColor wrap="truncate-start">{team.cwd}</Text>
          </Box>
        )}
        {team && (
          <Box flexDirection="column">
            {team.agents.map(a => (
              <Text wrap="truncate-end">
                <Text color={a.status === 'working' ? '#c2643d' : a.status === 'error' ? 'red' : undefined}>
                  {a.status === 'working' ? '◉' : a.status === 'error' ? '✕' : '○'}
                </Text>{' '}
                {a.name}
                <Text dimColor>
                  {' '}
                  · {a.provider === 'codex' ? 'ChatGPT' : a.provider === 'claude' ? 'Claude' : a.provider}
                  {a.status === 'working' && a.activity ? ` · ${a.activity}` : a.status === 'error' ? ` · ${a.activity}` : ''}
                </Text>
              </Text>
            ))}
          </Box>
        )}
        {team && team.recent.length > 0 && (
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
        {team && (
          <Input
            key="huddle-message"
            label="Message"
            placeholder="Start with a name: Developer, run the tests"
            submitLabel="send"
            onSubmit={async (value: string) => {
              const text = value.trim()
              if (!text) return
              $.ui.toast(await say($, team, text))
            }}
          />
        )}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {team && <Button key="join" label={team.live ? 'Join call' : 'Start call'} onPress={() => join($, team)} />}
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {others.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Other teams</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {others.map(t => (
                <Button key={`team-${t.id}`} label={`${t.live ? '● ' : ''}${t.name}`} onPress={() => update($, selected, () => t.id)} />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
