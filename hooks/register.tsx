import type { EngineInterface, Register } from 'claude-code'

// One subscription login: the claudeAiOauth field of the live login (.credentials.json, or the Keychain on macOS), as is.
// The same document's mcpOAuth (MCP server logins) has nothing to do with the account and is left alone.
type Oauth = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  refreshTokenExpiresAt?: number
  scopes?: string[]
  subscriptionType?: string
}
type Account = { email: string; plan: string; oauth: Oauth; savedAt: number }
type Book = { accounts: Record<string, Account>; current?: string }
type Who = { email: string; plan: string }
// The server's verdict: ok says whose, revoked is a refused token (401/403), unknown is network or server trouble
type Probe = { kind: 'ok'; who: Who } | { kind: 'revoked' } | { kind: 'unknown' }

const PICK = 'account-pick'
const REMOVE = 'account-remove'
const DAY = 86_400_000
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const PROFILE_TIMEOUT = 8_000
const RETRY_AFTER = 5 * 60_000

// A failure meant for the person: its message is shown as is.
class Refusal extends Error {}

async function configDir($: EngineInterface): Promise<string> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) throw new Refusal('Could not find the home folder (USERPROFILE / HOME is empty)')
  return home.replace(/[\\/]+$/, '') + '/.claude'
}

const credPath = async ($: EngineInterface) => (await configDir($)) + '/.credentials.json'
const bookPath = async ($: EngineInterface) => (await configDir($)) + '/account-switch.json'
const isWindows = async ($: EngineInterface) => (await $.env.get('USERPROFILE')) !== undefined

let macCache: boolean | undefined
async function isMac($: EngineInterface): Promise<boolean> {
  if (macCache !== undefined) return macCache
  if (await isWindows($)) return (macCache = false)
  const r = await $.process.run(['uname', '-s']).catch(() => null)
  return (macCache = r?.stdout.trim() === 'Darwin')
}

// Claude Code's keychain item on macOS: "Claude Code-credentials", plus a hash of the config folder
// when CLAUDE_CONFIG_DIR (or CLAUDE_SECURESTORAGE_CONFIG_DIR) points elsewhere.
async function keychainService($: EngineInterface): Promise<string> {
  const base = 'Claude Code-credentials'
  const secure = await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR')
  const dir = secure !== undefined ? secure : await $.env.get('CLAUDE_CONFIG_DIR')
  if (!dir) return base
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dir.normalize('NFC')))
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${base}-${hex.slice(0, 8)}`
}

// security prints a password that is not plain text as hex
function fromSecurity(out: string): string {
  const t = out.trim()
  if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) {
    const bytes = new Uint8Array(t.match(/../g)!.map(h => parseInt(h, 16)))
    return new TextDecoder().decode(bytes)
  }
  return t
}

// Where Claude keeps the live login: the macOS Keychain, else .credentials.json
async function slotName($: EngineInterface): Promise<string> {
  return (await isMac($)) ? `macOS Keychain (${await keychainService($)})` : await credPath($)
}

async function readSlot($: EngineInterface): Promise<string | null> {
  if (!(await isMac($))) {
    const path = await credPath($)
    return (await $.fs.exists(path)) ? await $.fs.read(path) : null
  }
  const r = await $.process.run(['security', 'find-generic-password', '-s', await keychainService($), '-w'])
  if (r.exitCode === 44) return null
  if (r.exitCode !== 0) throw new Refusal(`Could not read the macOS Keychain (security exited ${r.exitCode}) — is it locked?`)
  return fromSecurity(r.stdout)
}

async function writeSlot($: EngineInterface, text: string) {
  if (!(await isMac($))) return $.fs.write(await credPath($), text)
  const service = await keychainService($)
  // Keep the item's own account name: it differs between Claude Code versions
  const info = await $.process.run(['security', 'find-generic-password', '-s', service])
  const account = /"acct"<blob>="([^"]*)"/.exec(info.stdout)?.[1] ?? 'claude-code-user'
  const r = await $.process.run(['security', 'add-generic-password', '-U', '-a', account, '-s', service, '-w', text])
  if (r.exitCode !== 0) throw new Refusal(`Could not write the macOS Keychain (security exited ${r.exitCode})`)
  // A running session decides whether to read its login again by the modification time of
  // .credentials.json, even on macOS: touch it (contents untouched) so the session notices.
  const path = await credPath($)
  if (await $.fs.exists(path)) await $.process.run(['touch', path]).catch(() => undefined)
}

// Missing (null) and broken (throw) are kept apart: reading a broken file as empty and writing it back loses tokens
async function readJson<T>($: EngineInterface, path: string): Promise<T | null> {
  if (!(await $.fs.exists(path))) return null
  const text = await $.fs.read(path)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Refusal(`${path} is broken (not JSON)`)
  }
}

function isBook(v: unknown): v is Book {
  return typeof v === 'object' && v !== null && typeof (v as Book).accounts === 'object' && (v as Book).accounts !== null
}

async function loadBook($: EngineInterface): Promise<Book> {
  const path = await bookPath($)
  for (const p of [path, path + '.bak']) {
    let raw: unknown
    try {
      raw = await readJson<Book>($, p)
    } catch {
      continue
    }
    if (raw === null) {
      if (p === path) return { accounts: {} }
      continue
    }
    if (!isBook(raw)) continue
    if (p !== path) $.ui.toast('The account store was broken; read its backup (account-switch.json.bak)')
    return { accounts: raw.accounts, current: raw.current }
  }
  throw new Refusal(
    `The account store ${path} and its backup are both broken — stopping without writing. Check or delete them, then log in again`,
  )
}

// Other windows use the same store: read it again right before writing and keep the newer entry per account.
// The current content goes to .bak first, so a write cut short can fall back one step.
async function saveBook($: EngineInterface, book: Book, removed?: string) {
  const path = await bookPath($)
  const disk = await loadBook($)
  for (const [email, theirs] of Object.entries(disk.accounts)) {
    if (email === removed) continue
    const mine = book.accounts[email]
    if (!mine || theirs.savedAt > mine.savedAt) book.accounts[email] = theirs
  }
  const hasOld = await $.fs.exists(path)
  if (hasOld) await $.fs.write(path + '.bak', JSON.stringify(disk, null, 2))
  await $.fs.write(path, JSON.stringify(book, null, 2))
  // Both files hold tokens: owner-only on Unix (Windows follows the user folder's permissions)
  if (!(await isWindows($))) {
    const files = hasOld ? [path, path + '.bak'] : [path]
    await $.process.run(['chmod', '600', ...files]).catch(() => undefined)
  }
}

function planOf(type?: string): string {
  const t = (type ?? '').replace(/^claude_/, '')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '?'
}

// Asks the server whose token this is, without waiting long.
async function probe($: EngineInterface, oauth: Oauth): Promise<Probe> {
  try {
    const r = await Promise.race([
      $.http.fetch(PROFILE_URL, {
        headers: { Authorization: 'Bearer ' + oauth.accessToken, 'Content-Type': 'application/json' },
      }),
      $.clock.sleep(PROFILE_TIMEOUT).then(() => null),
    ])
    if (!r) return { kind: 'unknown' }
    if (r.status === 401 || r.status === 403) return { kind: 'revoked' }
    if (!r.ok) return { kind: 'unknown' }
    const j = JSON.parse(r.text)
    const email = j?.account?.email
    if (typeof email !== 'string') return { kind: 'unknown' }
    return {
      kind: 'ok',
      who: { email, plan: planOf(oauth.subscriptionType ?? j?.organization?.organization_type) },
    }
  } catch {
    return { kind: 'unknown' }
  }
}

async function readLive($: EngineInterface): Promise<{ file: Record<string, unknown> | null; oauth?: Oauth }> {
  const text = await readSlot($)
  if (text === null) return { file: null }
  let file: Record<string, unknown>
  try {
    file = JSON.parse(text)
  } catch {
    throw new Refusal(`The login in ${await slotName($)} is broken (not JSON)`)
  }
  const oauth = file?.claudeAiOauth as Oauth | undefined
  return { file, oauth: oauth && typeof oauth.accessToken === 'string' ? oauth : undefined }
}

// A token the server did not answer for is not asked about again for a while (no wait on every message offline)
let unknownToken: { token: string; at: number } | undefined

// Brings the store in line with the live login (.credentials.json, or the Keychain on macOS).
// A token the session refreshed, or a new account /login put there, is followed into the store here.
// isSettled false: whose the live token is could not be confirmed, and the store was left untouched.
// isQuiet: the background check (every message), which skips a token the server just failed to answer for.
async function syncNow(
  $: EngineInterface,
  isQuiet = false,
): Promise<{ book: Book; current?: string; isSettled: boolean }> {
  const book = await loadBook($)
  const { oauth: live } = await readLive($)
  if (!live) {
    book.current = undefined
    return { book, isSettled: true }
  }

  const all = Object.values(book.accounts)
  const same = all.find(a => a.oauth.accessToken === live.accessToken)
  if (same) {
    book.current = same.email
    return { book, current: same.email, isSettled: true }
  }

  // The same refresh token is surely a refresh of the same account; otherwise ask the server.
  let who: Who | undefined
  const byRefresh = live.refreshToken ? all.find(a => a.oauth.refreshToken === live.refreshToken) : undefined
  if (byRefresh) {
    who = { email: byRefresh.email, plan: byRefresh.plan }
  } else {
    const isRecent =
      isQuiet && unknownToken?.token === live.accessToken && Date.now() - unknownToken.at < RETRY_AFTER
    if (!isRecent) {
      const answer = await probe($, live)
      if (answer.kind === 'ok') who = answer.who
      else unknownToken = { token: live.accessToken, at: Date.now() }
    }
  }
  // Never file a token of unknown owner under some account by guess
  if (!who) return { book, current: book.current, isSettled: false }

  const prev = book.accounts[who.email]
  book.accounts[who.email] = {
    email: who.email,
    plan: who.plan !== '?' ? who.plan : (prev?.plan ?? planOf(live.subscriptionType)),
    oauth: live,
    savedAt: Date.now(),
  }
  book.current = who.email
  await saveBook($, book)
  return { book, current: who.email, isSettled: true }
}

// Reads and writes of the two files run one at a time
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

const sync = ($: EngineInterface, isQuiet = false) => serial(() => syncNow($, isQuiet))

function messageOf(err: unknown): string {
  if (err instanceof Refusal) return err.message
  return `account-switch error: ${err instanceof Error ? err.message : String(err)}`
}

// A refresh token lives a fixed time from login (refreshing does not extend it): warn before it ends
function isExpired(a: Account): boolean {
  const until = a.oauth.refreshTokenExpiresAt
  return until !== undefined && until < Date.now()
}

function expiry(a: Account): string {
  const until = a.oauth.refreshTokenExpiresAt
  if (!until) return ''
  if (isExpired(a)) return '  ⚠ login expired — log in again'
  const days = Math.floor((until - Date.now()) / DAY)
  return days <= 3 ? `  ⚠ login expires in ${days}d` : ''
}

function showStatus($: EngineInterface, book: Book, current?: string) {
  const a = current ? book.accounts[current] : undefined
  $.ui.status(a ? `● ${a.email} · ${a.plan}${expiry(a)}` : '● No account — log in from /account')
}

// With these set, Claude does not use .credentials.json, so a switch has no effect
async function overrideNote($: EngineInterface): Promise<string | undefined> {
  if (await $.env.get('ANTHROPIC_API_KEY')) return 'ANTHROPIC_API_KEY is set, so an API key is used instead of the subscription — switching has no effect'
  if (await $.env.get('CLAUDE_CODE_OAUTH_TOKEN')) return 'CLAUDE_CODE_OAUTH_TOKEN is set, so that token is used — switching has no effect'
  return undefined
}

async function switchTo($: EngineInterface, email: string): Promise<string> {
  return serial(async () => {
    const note = await overrideNote($)
    if (note) throw new Refusal(note)

    const { book, current, isSettled } = await syncNow($)
    const target = book.accounts[email]
    if (!target) throw new Refusal(`Not a saved account: ${email}`)
    if (current === email && isSettled) return `Already on ${email}`
    // Leaving the slot before its token is saved loses that account's latest token
    if (!isSettled) throw new Refusal("Could not confirm the current account's token (network?) — try again in a moment")
    if (isExpired(target)) throw new Refusal(`The login for ${email} has expired — pick it in /account to log in again`)

    // An access token still alive is checked first (revoked after a logout elsewhere)
    if ((target.oauth.expiresAt ?? 0) > Date.now() + 60_000) {
      const answer = await probe($, target.oauth)
      if (answer.kind === 'revoked') {
        throw new Refusal(`The token for ${email} was refused (logged out elsewhere?) — log in to that account again`)
      }
      if (answer.kind === 'ok' && answer.who.email !== email) {
        throw new Refusal(`The saved token for ${email} actually belongs to ${answer.who.email} — log in to that account again`)
      }
    }

    const { file } = await readLive($)
    await writeSlot($, JSON.stringify({ ...(file ?? {}), claudeAiOauth: target.oauth }))

    // If the session wrote a refreshed token in the same instant, this write lost: read back to be sure
    const after = await readLive($)
    if (after.oauth?.accessToken !== target.oauth.accessToken) {
      throw new Refusal('The session rewrote the login file right after the switch — try once more')
    }

    book.current = email
    await saveBook($, book)
    showStatus($, book, email)
    return `Switched to ${email} (${target.plan}) — your next message uses it`
  })
}

async function removeAccount($: EngineInterface, email: string): Promise<string> {
  return serial(async () => {
    const { book, current } = await syncNow($)
    if (!book.accounts[email]) throw new Refusal(`Not a saved account: ${email}`)
    if (current === email) throw new Refusal('The account in use cannot be removed — switch to another one first')
    delete book.accounts[email]
    await saveBook($, book, email)
    return `Removed ${email} (from this list only — its login on the server stays)`
  })
}

function startLogin($: EngineInterface) {
  // /login runs once the session is idle: hand it off without waiting. The login hook below saves the account.
  void $.command.run({ command: 'login' }).catch(err => $.ui.toast(`Could not start login: ${messageOf(err)}`))
}

function listText(book: Book, current?: string): string {
  const rows = Object.values(book.accounts).map(a =>
    a.email === current
      ? `● ${a.email} · ${a.plan}   ← in use${expiry(a)}`
      : `  ${a.email} · ${a.plan}${expiry(a)}`,
  )
  if (!rows.length) rows.push('No saved accounts — log in with /login and it is saved automatically')
  rows.push('', '/account pick or add · /account <email> switch · /account remove · /account check')
  return rows.join('\n')
}

// The exact email, else a prefix that matches only one
function findAccount(book: Book, query: string): { email?: string; error?: string } {
  const q = query.toLowerCase()
  const emails = Object.keys(book.accounts)
  const exact = emails.find(e => e.toLowerCase() === q)
  if (exact) return { email: exact }
  const hits = emails.filter(e => e.toLowerCase().startsWith(q))
  if (hits.length === 1) return { email: hits[0] }
  if (hits.length > 1) return { error: `Several accounts match: ${hits.join(', ')} — type more of it` }
  return { error: `No such account: ${query}` }
}

async function checkText($: EngineInterface): Promise<string> {
  const lines: string[] = []
  const dir = await configDir($)
  lines.push(`Config folder  ${dir}${(await $.env.get('CLAUDE_CONFIG_DIR')) ? ' (CLAUDE_CONFIG_DIR)' : ''}`)
  const note = await overrideNote($)
  if (note) lines.push(`⚠ ${note}`)
  const { oauth } = await readLive($)
  lines.push(`Login slot     ${await slotName($)} — ${oauth ? 'subscription login present' : 'no subscription login'}`)
  const { book, current, isSettled } = await sync($)
  lines.push(`Account store  ${await bookPath($)} — ${Object.keys(book.accounts).length} account(s)`)
  lines.push(`In use         ${current ?? 'none'}${isSettled ? '' : ' (could not confirm the live token with the server)'}`)
  if (oauth) {
    const answer = await probe($, oauth)
    lines.push(
      `Server says    ${answer.kind === 'ok' ? answer.who.email : answer.kind === 'revoked' ? 'token refused — the session refreshes it soon, or log in again' : 'no answer (network?)'}`,
    )
  }
  for (const a of Object.values(book.accounts)) {
    const until = a.oauth.refreshTokenExpiresAt
    lines.push(`  ${a.email} · ${a.plan} — login expires ${until ? new Date(until).toISOString().slice(0, 10) : 'unknown'}${expiry(a)}`)
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'account',
      description: 'Pick a Claude subscription account and switch to it right away',
      argumentHint: '[remove | check | <email>]',
    })
    void sync($)
      .then(({ book, current }) => showStatus($, book, current))
      .catch(err => $.ui.status(`● ${messageOf(err)}`))
    return next(e)
  })

  // Follow token refreshes and an outside /login on every message (two file reads when nothing changed)
  on('prompt.submit', async ($, e, next) => {
    void sync($, true)
      .then(({ book, current }) => showStatus($, book, current))
      .catch(() => undefined)
    return next(e)
  })

  // /login typed by hand or started from /account: save the account before it, register the one after
  on('command.run', { command: 'login' }, async ($, e, next) => {
    const before = await sync($).catch(() => undefined)
    const result = await next(e)
    try {
      const { book, current } = await sync($)
      showStatus($, book, current)
      if (current && current !== before?.current) $.ui.toast(`Account saved: ${current}`)
    } catch (err) {
      $.ui.toast(messageOf(err))
    }
    return result
  })

  on('command.run', { command: 'account' }, async ($, e) => {
    try {
      const arg = e.args.trim()
      const sub = arg.toLowerCase()

      if (sub === 'check') return { text: await checkText($) }

      const { book, current } = await sync($)
      showStatus($, book, current)
      const note = await overrideNote($)
      const prefix = note ? `⚠ ${note}\n\n` : ''

      if (sub === 'list') return { text: prefix + listText(book, current) }

      if (sub === 'remove') {
        const opened = await $.ui.open({ id: REMOVE, title: 'Remove account', focus: true, closeOnEscape: true })
        return { text: opened.isPlaced ? prefix : prefix + listText(book, current) + '\n(could not open the panel; showing the list)' }
      }

      if (arg) {
        const found = findAccount(book, arg)
        if (!found.email) return { text: prefix + `${found.error}\n\n` + listText(book, current) }
        return { text: await switchTo($, found.email) }
      }

      const opened = await $.ui.open({ id: PICK, title: 'Accounts', focus: true, closeOnEscape: true })
      return { text: opened.isPlaced ? prefix : prefix + listText(book, current) }
    } catch (err) {
      return { text: messageOf(err) }
    }
  })

  // A list of plain Buttons rather than a Select: each row is drawn in one color, so its focused
  // (inverted) bar is that color.
  on('ui.render', { component: 'Pane', requestId: PICK }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    let book: Book
    try {
      book = await loadBook($)
    } catch (err) {
      return <Text color="error">{messageOf(err)}</Text>
    }
    const now = book.current ? book.accounts[book.current] : undefined
    const others = Object.values(book.accounts).filter(a => a.email !== book.current)

    const pick = async (email: string) => {
      await $.ui.close({ id: PICK }).catch(() => undefined)
      const picked = book.accounts[email]
      if (picked && isExpired(picked)) {
        $.ui.toast(`The login for ${email} has expired — log in to it again`)
        return startLogin($)
      }
      $.ui.toast(await switchTo($, email).catch(messageOf))
    }
    const login = async () => {
      await $.ui.close({ id: PICK }).catch(() => undefined)
      startLogin($)
    }

    return (
      <Box flexDirection="column">
        {now ? (
          <Box borderStyle="round" borderColor="success" paddingX={1}>
            <Text color="success" bold>
              {'● IN USE  '}
              <Text color="text">{now.email}</Text>
              {` · ${now.plan}`}
              <Text color="warning">{expiry(now)}</Text>
            </Text>
          </Box>
        ) : (
          <Box borderStyle="round" borderColor="warning" paddingX={1}>
            <Text color="warning" bold>
              ● NOT LOGGED IN
            </Text>
          </Box>
        )}
        <Box flexDirection="column">
          <Text dimColor>Switch to — ↑↓/Tab then Enter · Esc closes</Text>
          <Text> </Text>
          {others.map((a, i) => (
            <Button key={`acct:${a.email}`} plain autoFocus={i === 0 ? true : undefined} onPress={() => pick(a.email)}>
              <Text color="suggestion">{`○ ${a.email} · ${a.plan}${expiry(a)}`}</Text>
            </Button>
          ))}
          <Text> </Text>
          <Button key="login" plain autoFocus={others.length === 0 ? true : undefined} onPress={login}>
            <Text color="claude">{'+ Log in to another account'}</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: REMOVE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    let book: Book
    try {
      book = await loadBook($)
    } catch (err) {
      return <Text color="error">{messageOf(err)}</Text>
    }
    const others = Object.values(book.accounts).filter(a => a.email !== book.current)
    if (!others.length) {
      return <Text dimColor>No account to remove (the one in use cannot be removed) · Esc closes</Text>
    }
    const remove = async (email: string) => {
      await $.ui.close({ id: REMOVE }).catch(() => undefined)
      const answer = await $.ui.ask(`Remove ${email} from the list?`, ['Remove', 'Cancel']).catch(() => 'Cancel')
      if (answer === 'Remove') $.ui.toast(await removeAccount($, email).catch(messageOf))
    }
    return (
      <Box flexDirection="column">
        <Text dimColor>Remove which? — ↑↓/Tab then Enter · Esc closes (the one in use is not listed)</Text>
        {others.map((a, i) => (
          <Button key={`rm:${a.email}`} plain autoFocus={i === 0 ? true : undefined} onPress={() => remove(a.email)}>
            <Text color="error">{'✕ '}</Text>
            {`${a.email} · ${a.plan}`}
            <Text color="warning">{expiry(a)}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
