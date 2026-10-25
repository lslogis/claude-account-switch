import type { EngineInterface, Register } from 'claude-code'

import {
  PICK,
  REMOVE,
  checkText,
  drawPick,
  drawRemove,
  findAccount,
  listText,
  messageOf,
  overrideNote,
  showStatus,
  switchTo,
  sync,
} from './cli/account'
import { isDesktopOnWindows } from './desktop/platform/env'
import { bestEffort } from './desktop/platform/log'
import { applyMeasure } from './desktop/services/meter'
import { pollLimits } from './desktop/services/poll'
import { ensureData, pruneToProfiles, startUpkeep } from './desktop/services/upkeep'
import { REFRESH_MS, drawStatus, recordCompaction, recordSpawn, recordStep, recordTurn, refresh } from './desktop/status'
import { drawAccounts } from './desktop/ui/accounts'
import { openAccounts } from './desktop/ui/actions'
import { drawBand } from './desktop/ui/band'
import { PANE } from './desktop/ui/ids'
import { scheduleTick } from './desktop/ui/tick'

// One plugin, two homes, kept apart:
//
//   terminal (Claude Code CLI)  hooks/cli/      /account switches the login inside the running session
//   Claude Desktop              hooks/desktop/  one band above the prompt: the status part (folder, git,
//                                               session, last turn, agents) and, on Windows, the account
//                                               part (context, plan limits, the account picker; a switch
//                                               restarts the app); /account opens the Accounts list
//
// Desktop hands its session the login itself, so nothing of hooks/cli runs there, and nothing of
// hooks/desktop runs in a terminal. This file only wires the hooks: each one asks where it runs.

let desktop: Promise<boolean> | null = null
function isDesktop($: EngineInterface) {
  desktop ??= $.env.get('CLAUDE_CODE_ENTRYPOINT').then(
    entrypoint => entrypoint === 'claude-desktop',
    () => {
      desktop = null // not known: asked again next time
      return false
    },
  )
  return desktop
}

/** The desktop account part's start: the data folder first, then the tick, the poll and the upkeep. */
async function startDesktopAccounts($: EngineInterface) {
  await bestEffort($, 'opening the data folder', ensureData($))
  void scheduleTick($)
  void pollLimits($)
  void bestEffort($, 'the upkeep at the session start', startUpkeep($).then(() => pruneToProfiles($)))
}

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the cache_ttl option): the status part marks the cache cold after it.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    // A failed registration costs /account alone, never the band or the terminal's sync
    await $.command
      .register({
        name: 'account',
        description: 'Switch your Claude subscription account (terminal: right away; Claude Desktop on Windows: the Accounts list)',
        argumentHint: '[remove | check | list | <email>]',
      })
      .catch(err => $.ui.toast(`/account could not be registered: ${messageOf(err)}`))
    if (!(await isDesktop($))) {
      void sync($)
        .then(({ book, current }) => showStatus($, book, current))
        .catch(err => $.ui.status(`● ${messageOf(err)}`))
      return next(e)
    }
    if (await isDesktopOnWindows($)) await startDesktopAccounts($)
    const started = await next(e)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return started
  })

  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const attached = await next(e)
    await refresh($)
    return attached
  })

  // Terminal: follow token refreshes and an outside /login on every message (two file reads when nothing changed)
  on('prompt.submit', async ($, e, next) => {
    if (!(await isDesktop($))) {
      void sync($, true)
        .then(({ book, current }) => showStatus($, book, current))
        .catch(() => undefined)
    }
    return next(e)
  }).catch((_, e, next) => next(e)) // If this hook fails, the message still goes through (an earlier next result is reused)

  // Terminal: /login typed by hand or started from /account saves the account before it and registers the one after
  on('command.run', { command: 'login' }, async ($, e, next) => {
    if (await isDesktop($)) return next(e)
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
  }).catch((_, e, next) => next(e)) // If the sync after login fails or overruns, /login does not run twice: the result it already had is returned

  on('command.run', { command: 'account' }, async ($, e) => {
    try {
      if (await isDesktop($)) {
        if (!(await isDesktopOnWindows($))) {
          return { text: 'Switching accounts in Claude Desktop works on Windows only.' }
        }
        const opened = await openAccounts($)
        return { text: opened.isPlaced ? '' : 'Could not open the Accounts list: use the account button on the band above the prompt.' }
      }

      const arg = (e.args ?? '').trim() // a caller may leave the arguments out
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

  // Terminal panes, opened by /account
  on('ui.render', { component: 'Pane', requestId: PICK }, async ($, e) => drawPick($, e))
  on('ui.render', { component: 'Pane', requestId: REMOVE }, async ($, e) => drawRemove($, e))

  // Desktop: the Accounts list, opened from the band's picker or by /account
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) =>
    e.surface !== 'desktop' || !(await isDesktopOnWindows($)) ? next(e) : drawAccounts($, e, 'pane'),
  )

  // Desktop: the one band above the prompt. The status part leaves out the context and limit
  // meters where the account part (Windows) shows them.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    const withAccounts = await isDesktopOnWindows($)
    const status = await drawStatus($, e, { cacheTtlMs, withMeters: !withAccounts })
    const accounts = withAccounts ? await drawBand($, e) : null
    if (!status && !accounts) return next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {status}
        {accounts}
      </Box>
    )
  })

  // Desktop: when Claude has answered, its cost is in the limits (poll now, then every five
  // minutes); the status part keeps the turn's figures. A subagent's turn ends inside the main one.
  on('turn.complete', async ($, e, next) => {
    if (!(await isDesktop($))) return next(e)
    if (e.agentId === undefined && (await isDesktopOnWindows($))) void pollLimits($, true)
    const completed = await next(e)
    await recordTurn($, e).catch(() => undefined) // the status part only: a failure costs its figures, never the turn
    return completed
  })

  // Desktop: pushed after each turn and whenever a limit window moves; both parts redraw from it.
  on('session.measure', async ($, e, next) => {
    if (!(await isDesktop($))) return next(e)
    if (await isDesktopOnWindows($)) await applyMeasure($, e.context, e.rateLimits)
    const measured = await next(e)
    await refresh($)
    return measured
  })

  // Desktop: a streaming event; forward the chunks untouched and read the step's server tools at the end.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (await isDesktop($)) recordStep(e, step)
    return step
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (e.workflow && spawned.agentId && (await isDesktop($))) {
      await recordSpawn($, e.workflow.runId, spawned.agentId).catch(() => undefined)
    }
    return spawned
  }).catch((_, e, next) => next(e))

  // Desktop: a spawned agent shows as running only once it has started; look again shortly after.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (await isDesktop($)) $.clock.after(2000, () => void refresh($))
    return next(e)
  }).catch((_, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger === 'precompute' || e.agentId || result.messages === undefined || !(await isDesktop($))) return result
    await recordCompaction($, result.tokensBefore ?? null, result.tokensAfter ?? null).catch(() => undefined)
    return result
  }).catch((_, e, next) => next(e)) // A failed count never stands in the way of the compaction
}
