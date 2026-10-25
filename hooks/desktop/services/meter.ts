import type { EngineInterface, SessionContextUsage, SessionRateLimit, UsageUnit } from 'claude-code'

import type { Limit, Meter } from '../../../types'
import { contextThresholds } from '../domain/context'
import { mergeLimits } from '../domain/limits'
import { bestEffort } from '../platform/log'
import { signedInAccount } from '../platform/env'
import { readMeter, updateMeter } from '../platform/state'
import { readSnapshot, rememberLimits } from './snapshots'

// The meter the band draws: the context figure and where it turns yellow and
// red, and the plan's limits, merged from a reply's headers and the poll. Every
// change is made inside the meter's updater, from the value it holds then, so
// a reply and a poll landing together never undo each other.

/** The engine's rate-limit windows as the band keeps them. */
function toLimits(limits: SessionRateLimit[]): Limit[] {
  return limits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
}

function toMeter(context: SessionContextUsage, limits: SessionRateLimit[]): Meter {
  return {
    contextPercent: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    contextAt: contextThresholds(context),
    limits: toLimits(limits),
  }
}

/** The status line's figures, which stand in before the first measurement this session: its limits when `withLimits`. */
async function statusMeter($: EngineInterface, withLimits: boolean) {
  const { context, rateLimits } = await $.session.usage()

  return toMeter(context, withLimits ? rateLimits : [])
}

/**
 * The meter a session starts from, before its first measurement: its context,
 * and the signed-in account's last known limits, so the first figures to come
 * (a poll older than them, say) merge into them rather than replace them.
 */
async function startMeter($: EngineInterface): Promise<Meter> {
  const [status, snapshot] = await Promise.all([statusMeter($, false), signedInAccount($).then(account => readSnapshot($, account))])

  return { ...status, limits: snapshot?.limits ?? [] }
}

/**
 * The meter, or the status line's figures until the first measurement this
 * session; while neither has limits (a session just started, its first poll
 * failed), the signed-in account's last known ones, which the band ages by
 * their reset times.
 */
export async function meterOrStatus($: EngineInterface): Promise<Meter> {
  const meter = (await readMeter($)) ?? (await statusMeter($, true))
  if (meter.limits.length) {
    return meter
  }
  const snapshot = await readSnapshot($, await signedInAccount($))

  return snapshot?.limits.length ? { ...meter, limits: snapshot.limits } : meter
}

/**
 * Where limits come from: `answered`, the kinds the source lists whenever they
 * exist (see mergeLimits; a reply's headers answer for none); `measuredAt`,
 * when the source measured them, now when not given; `isAnswer`, the source
 * answered for the account even with no limits (see rememberLimits).
 */
export type LimitsSource = { answered?: readonly string[]; measuredAt?: number; isAnswer?: boolean }

/**
 * Merges a source's limits into the meter and remembers the result for the
 * signed-in account. The same figures again change nothing, so nothing redraws.
 */
export async function applyLimits($: EngineInterface, limits: Limit[], { answered = [], measuredAt, isAnswer }: LimitsSource = {}) {
  const now = await $.clock.now()
  const known = (await readMeter($)) ?? (await startMeter($))
  const merge = (meter: Meter) => mergeLimits(meter.limits, limits, now, answered)
  if (JSON.stringify(merge(known)) === JSON.stringify(known.limits)) {
    await rememberLimits($, known.limits, { measuredAt, isAnswer })
    return
  }
  const after = await updateMeter($, current => {
    const meter = current ?? known

    return { ...meter, limits: merge(meter) }
  })
  await rememberLimits($, after?.limits ?? [], { measuredAt, isAnswer })
}

/**
 * What a reply measured, of what `changed`: its context, counted again with its
 * breakdown (no requests) for the real auto-compaction threshold, replaces the
 * meter's (the first measure always); its limits merge with the meter's. A
 * measure where only the cost moved does nothing here.
 */
export async function applyMeasure(
  $: EngineInterface,
  { context, rateLimits, changed }: { context: SessionContextUsage; rateLimits: SessionRateLimit[]; changed: readonly UsageUnit[] },
) {
  const start = (await readMeter($)) ? null : await startMeter($)
  if (start || changed.includes('context')) {
    const detailed = await bestEffort($, 'context breakdown', $.session.usage({ breakdown: 'summary' }))
    const measured = toMeter(detailed?.context ?? context, [])
    await updateMeter($, current => ({ ...measured, limits: current?.limits ?? start?.limits ?? [] }))
  }
  if (changed.includes('rateLimits') && rateLimits.length) {
    await applyLimits($, toLimits(rateLimits))
  }
}
