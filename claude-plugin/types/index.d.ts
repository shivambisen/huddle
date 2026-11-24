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

export type Team = {
  id: string
  name: string
  cwd: string
  live: boolean
  lastActivity: number
  joinUrl: string
  agents: Agent[]
  recent: Line[]
}

export type Live = { app: 'huddle'; version: string; url: string; host: string; teams: Team[] }

declare module 'claude-code' {
  interface PluginState {
    huddle: {
      live: Shaped<Live | null>
      isHidden: boolean
      selected: string | null
      cwd: string
    }
  }
}
