import { expect, mock, test } from 'claude-code/testing'

import { DESKTOP_ENV, USER, fakeHost, mountBand } from './support/host'

// What the merge itself must hold: the terminal and Claude Desktop kept apart, /account per home,
// and one band on desktop with the status part above the account part and no meter twice.

const statusAnswers = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('session.cwd', () => ({ value: 'C:/Users/me/work/shop' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.turns', () => ({ value: 3 }))
  on('agent.list', () => ({ value: [] }))
  on('ui.notify', () => ({ value: { isSent: true } }))
  on('command.register', () => ({ value: { command: 'account' } }))
}

test('desktop on Windows: one band, the status part above the account part, no meter twice', async ($, on) => {
  statusAnswers(on)
  fakeHost(on)
  await $.session.start({ cwd: USER, surface: 'desktop', isInteractive: true })
  const ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /📁 shop/ })).toBeDefined()
  expect(await ui.find({ key: 'account' })).toBeDefined() // the account picker
  expect(await ui.find({ type: 'Text', text: /^Context$/ })).toBeUndefined() // the status part's own meter left out
  expect(await ui.find({ type: 'Text', text: /^5-hour$/ })).toBeUndefined()
  await ui.unmount()
})

test('desktop: /account opens the Accounts list', async ($, on) => {
  statusAnswers(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  fakeHost(on)
  await $.session.start({ cwd: USER, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'account' })
  expect(opened).toEqual(['accounts'])
})

test('terminal: no band of ours, and /account opens the terminal picker', async ($, on) => {
  const TERMINAL_ENV = { USERPROFILE: USER } // no CLAUDE_CODE_ENTRYPOINT=claude-desktop
  on('command.register', () => ({ value: { command: 'account' } }))
  on('env.get', (_$, e) => ({ value: (TERMINAL_ENV as Record<string, string>)[e.name] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-20T12:00:00Z') })
  await $.session.start({ cwd: USER, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const r = await $.command.run({ command: 'account' })
  expect(r.text ?? '').toBe('')
  expect(opened).toEqual(['account-pick'])
  expect(DESKTOP_ENV.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
})
