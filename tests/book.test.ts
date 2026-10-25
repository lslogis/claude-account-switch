import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The terminal's account store (account-switch.json), which every terminal session writes:
// a token the session refreshed must reach it even when another window writes at the same moment.
// A terminal session syncs the store with the live login as it starts.

const HOME = 'C:/Users/me'
// Paths reach the host's fs in the platform's own form
const BOOK = 'C:\\Users\\me\\.claude\\account-switch.json'
const CRED = 'C:\\Users\\me\\.claude\\.credentials.json'
const STORED = JSON.stringify({
  accounts: { 'a@x.com': { email: 'a@x.com', plan: 'Pro', oauth: { accessToken: 'old', refreshToken: 'r1' }, savedAt: 1 } },
})

// A Windows home holding the store and a live login the session refreshed (same refresh token, new access token).
// afterWrite runs after each write of the store, as another window that writes right then.
function terminalHost(
  on: On,
  afterWrite: (files: Map<string, string>, writes: number) => void = () => undefined,
  stored = STORED,
) {
  const files = new Map([
    [BOOK, stored],
    [CRED, JSON.stringify({ claudeAiOauth: { accessToken: 'new', refreshToken: 'r1' } })],
  ])
  let writes = 0
  on('command.register', () => ({ value: { command: 'account' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    if (e.path === BOOK) afterWrite(files, ++writes)
    return { value: undefined }
  })
  return { files, writes: () => writes }
}

// Starts a terminal session and waits for its sync to finish.
async function start($: Engine, on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-20T12:00:00Z') })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const tokenIn = (files: Map<string, string>) => JSON.parse(files.get(BOOK) ?? '{}').accounts['a@x.com'].oauth.accessToken

test('a refreshed token is written to the store once when nobody else writes', async ($: Engine, on: On) => {
  const host = terminalHost(on)
  await start($, on)
  expect(tokenIn(host.files)).toBe('new')
  expect(host.writes()).toBe(1)
})

test('another window writing its older copy over ours right after: read back, written again', async ($: Engine, on: On) => {
  // The other window read the store before our write and writes what it read just after it.
  const host = terminalHost(on, (files, writes) => {
    if (writes === 1) files.set(BOOK, STORED)
  })
  await start($, on)
  expect(tokenIn(host.files)).toBe('new')
  expect(host.writes()).toBe(2)
})

test('a window that keeps writing over ours: three tries, then it stops', async ($: Engine, on: On) => {
  const host = terminalHost(on, files => files.set(BOOK, STORED))
  await start($, on)
  expect(host.writes()).toBe(3)
})

// The store with a second account, b@x.com, that another window removes while this one saves.
const WITH_B = JSON.stringify({
  accounts: {
    ...JSON.parse(STORED).accounts,
    'b@x.com': { email: 'b@x.com', plan: 'Max', oauth: { accessToken: 'b', refreshToken: 'rb' }, savedAt: 1 },
  },
})
const accountsIn = (files: Map<string, string>) => Object.keys(JSON.parse(files.get(BOOK) ?? '{}').accounts).sort()
const withoutB = (files: Map<string, string>) => {
  const book = JSON.parse(files.get(BOOK) ?? '{}')
  delete book.accounts['b@x.com']
  return JSON.stringify(book)
}

test('an account another window removed right after our write stays removed', async ($: Engine, on: On) => {
  // The other window read our write and wrote it back without b@x.com.
  const host = terminalHost(on, (files, writes) => {
    if (writes === 1) files.set(BOOK, withoutB(files))
  }, WITH_B)
  await start($, on)
  expect(accountsIn(host.files)).toEqual(['a@x.com'])
  expect(tokenIn(host.files)).toBe('new')
  expect(host.writes()).toBe(1)
})

test('written again over an older copy that also removed an account: ours kept, the removed one not put back', async ($: Engine, on: On) => {
  // The other window read the store before our write, removed b@x.com, and wrote just after us.
  const host = terminalHost(on, (files, writes) => {
    if (writes === 1) files.set(BOOK, STORED)
  }, WITH_B)
  await start($, on)
  expect(accountsIn(host.files)).toEqual(['a@x.com'])
  expect(tokenIn(host.files)).toBe('new')
  expect(host.writes()).toBe(2)
})
