import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'huddle',
  component: 'Pane',
  requestId: 'huddle',
  props: {
    title: 'Huddle',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const team = {
  id: 't1', name: 'Browser CAD', cwd: '/proj', live: true, lastActivity: 1, joinUrl: 'http://localhost:4317/#/p/t1/meet', mode: 'assembled',
  agents: [
    { id: 'a1', name: 'Developer', title: 'Frontend developer', provider: 'claude', model: 'sonnet', status: 'working', activity: 'Bash: npm test' },
    { id: 'a2', name: 'Intern', title: 'Intern', provider: 'codex', model: 'default', status: 'idle', activity: '' },
  ],
  recent: [{ from: 'Developer', to: 'Shivam', text: 'Snapping works now.', ts: 2 }],
  invites: [{ id: 'i1', from: 'Developer', job: 'Designer', reason: 'the toolbar needs a visual pass' }],
}

// Stand in for the engine and for Huddle's local server.
function engine(on: any, teams: unknown[]) {
  const live = { app: 'huddle', version: '0.2.0', url: 'http://localhost:4317', host: 'Shivam', teams }
  on('command.register', () => ({ value: { command: 'huddle' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__huddle__huddle' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: {} }))
  on('ui.status', () => ({ value: null }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(live) } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
}

test('the panel shows the team, its people and an invite, on every surface', async ($, on) => {
  engine(on, [team])
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Browser CAD/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Developer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /wants to bring in a/ })).toBeDefined()
    expect(await ui.find({ key: 'join' })).toBeDefined()
    expect(await ui.find({ key: 'yes-i1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a folder without a team offers the three ways to start', async ($, on) => {
  engine(on, [{ ...team, cwd: '/elsewhere', name: 'todo app' }])
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /What are you working on/ })).toBeDefined()
    expect(await ui.find({ key: 'find' })).toBeDefined()
    expect(await ui.find({ key: 'allrounder' })).toBeDefined()
    expect(await ui.find({ key: 'team-t1' })).toBeDefined()
    await ui.unmount()
  }
})

test('the row above the prompt shows the team and its main action', async ($, on) => {
  engine(on, [team])
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'huddle', component: 'AbovePrompt', props: { hasSurvey: false } as any, surface })
    expect(await ui.find({ type: 'Text', text: /Browser CAD/ })).toBeDefined()
    expect(await ui.find({ key: 'huddle-approve' })).toBeDefined()
    expect(await ui.find({ key: 'huddle-hide' })).toBeDefined()
    await ui.unmount()
  }
})
