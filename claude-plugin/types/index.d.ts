// What Huddle's local server reports at GET http://127.0.0.1:4317/api/live.
export type Agent = {
  id: string
  name: string
  title: string
  provider: string
  model: string
  status: 'idle' | 'working' | 'error' | string
  activity: string
}

export type Line = { from: string; to: string; text: string; ts: number }

export type Invite = { id: string; from: string; job: string; reason: string }

export type Team = {
  id: string
  name: string
  cwd: string
  live: boolean
  lastActivity: number
  joinUrl: string
  mode?: string
  agents: Agent[]
  recent: Line[]
  invites?: Invite[]
}

export type Live = { app: 'huddle'; version: string; url: string; host: string; teams: Team[] }

// A team Huddle suggested from a description, not created yet.
export type Proposal = {
  summary: string
  roles: { name: string; title: string; why?: string; provider: string; skills?: string[] }[]
  raw: unknown[]
}

declare module 'claude-code' {
  interface PluginState {
    huddle: {
      live: Shaped<Live | null>
      isHidden: boolean
      selected: string | null
      cwd: string
      proposal: Shaped<Proposal | null>
      busy: string | null
      launched: boolean
      missingApp: boolean
      draft: string
    }
  }
}
