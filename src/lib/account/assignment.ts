/**
 * Round-robin conversation assignment with per-agent daily capacity.
 *
 * The rules, in the order they are applied:
 *
 *   1. Only **online** agents are candidates. Presence is derived
 *      from `member_presence` + `last_seen_at` via `derivePresence`
 *      (see `@/lib/presence`), so an agent whose heartbeat went
 *      stale counts as offline even if their stored row still says
 *      'online'.
 *   2. An agent whose `daily_conversation_limit` is reached is
 *      **skipped** — they stay in the rotation but receive nothing
 *      until the next day. A limit of `null` means unlimited.
 *   3. Among the remaining candidates the agent with the oldest
 *      `last_assigned_at` wins (never-assigned sorts first). Ties
 *      break on `user_id` so the result is deterministic.
 *   4. If **no** candidate survives, the caller gets `null` and the
 *      conversation stays in the unassigned pool.
 *
 * Everything here is pure except `pickAssignee`, which takes an
 * already-fetched roster so it can be unit-tested without a DB.
 */

import { derivePresence, type StoredPresence } from '@/lib/presence'

/** A `member_presence` row joined to its owner. */
export interface PresenceWithUser {
  user_id: string
  status: StoredPresence
  last_seen_at: string
}

/** A candidate as the picker sees them. */
export interface AssignmentCandidate {
  /** `profiles.user_id` — the value written to `assigned_agent_id`. */
  userId: string
  /** Display name, for logging / debugging only. */
  fullName: string
  /** Stored presence value from `member_presence` (may be absent). */
  storedPresence: StoredPresence | null
  /** `member_presence.last_seen_at` ISO string, or null if never seen. */
  lastSeenAt: string | null
  /** `profiles.daily_conversation_limit`; null = unlimited. */
  dailyLimit: number | null
  /** `profiles.last_assigned_at` as epoch ms; null = never assigned. */
  lastAssignedAt: number | null
  /** How many conversations this agent was assigned today. */
  assignedToday: number
}

export type SkipReason = 'offline' | 'at_capacity'

export interface SkippedCandidate {
  userId: string
  fullName: string
  reason: SkipReason
}

export interface PickResult {
  /** The chosen agent, or null when nobody is eligible. */
  agentId: string | null
  /** Why each non-chosen candidate was passed over (for logs / UI). */
  skipped: SkippedCandidate[]
}

/**
 * True when the agent has hit their daily cap. `null` limit means
 * unlimited; a limit of 0 means "takes no new chats today".
 */
export function isAtCapacity(
  dailyLimit: number | null,
  assignedToday: number,
): boolean {
  if (dailyLimit === null) return false
  return assignedToday >= dailyLimit
}

/**
 * Filter + order candidates, returning the winner and the reasons
 * the others were skipped. Pure — no I/O.
 */
export function pickAssignee(
  candidates: AssignmentCandidate[],
  now: number,
): PickResult {
  const skipped: SkippedCandidate[] = []
  const eligible: AssignmentCandidate[] = []

  for (const c of candidates) {
    const status = derivePresence(c.storedPresence ?? undefined, c.lastSeenAt, now)
    if (status !== 'online') {
      skipped.push({ userId: c.userId, fullName: c.fullName, reason: 'offline' })
      continue
    }
    if (isAtCapacity(c.dailyLimit, c.assignedToday)) {
      skipped.push({
        userId: c.userId,
        fullName: c.fullName,
        reason: 'at_capacity',
      })
      continue
    }
    eligible.push(c)
  }

  if (eligible.length === 0) {
    return { agentId: null, skipped }
  }

  // Oldest `last_assigned_at` first; never-assigned (null) wins.
  // `user_id` breaks ties so the pick is deterministic across runs.
  eligible.sort((a, b) => {
    const aTime = a.lastAssignedAt ?? -Infinity
    const bTime = b.lastAssignedAt ?? -Infinity
    if (aTime !== bTime) return aTime - bTime
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  })

  return { agentId: eligible[0].userId, skipped }
}

/**
 * Human-readable summary of a pick, for the automation log.
 * e.g. `assigned to 张三 (skipped 2: 1 offline, 1 at capacity)`.
 */
export function describePick(result: PickResult, nameOf: (id: string) => string): string {
  if (!result.agentId) {
    if (result.skipped.length === 0) return 'no agents available'
    const offline = result.skipped.filter((s) => s.reason === 'offline').length
    const capped = result.skipped.filter((s) => s.reason === 'at_capacity').length
    const parts: string[] = []
    if (offline) parts.push(`${offline} offline`)
    if (capped) parts.push(`${capped} at capacity`)
    return `no eligible agent (${parts.join(', ')})`
  }
  const base = `assigned to ${nameOf(result.agentId)}`
  if (result.skipped.length === 0) return base
  const offline = result.skipped.filter((s) => s.reason === 'offline').length
  const capped = result.skipped.filter((s) => s.reason === 'at_capacity').length
  const parts: string[] = []
  if (offline) parts.push(`${offline} offline`)
  if (capped) parts.push(`${capped} at capacity`)
  return `${base} (skipped ${parts.join(', ')})`
}

/**
 * Build the candidate list from raw DB rows. Kept separate from the
 * fetch so the mapping is testable and the query stays in one place.
 */
export function buildCandidates(input: {
  profiles: Array<{
    user_id: string | null
    full_name: string | null
    daily_conversation_limit: number | null
    last_assigned_at: string | null
  }>
  presence: PresenceWithUser[]
  countsToday: Map<string, number>
}): AssignmentCandidate[] {
  const presenceByUser = new Map<string, PresenceWithUser>()
  for (const row of input.presence) {
    presenceByUser.set(row.user_id, row)
  }

  const out: AssignmentCandidate[] = []
  for (const p of input.profiles) {
    // Virtual members (migration 040) have a null user_id and can
    // never be an assignee — `assigned_agent_id` references an auth
    // user.
    if (!p.user_id) continue
    const pres = presenceByUser.get(p.user_id)
    out.push({
      userId: p.user_id,
      fullName: p.full_name ?? p.user_id,
      storedPresence: pres?.status ?? null,
      lastSeenAt: pres?.last_seen_at ?? null,
      dailyLimit: p.daily_conversation_limit,
      lastAssignedAt: p.last_assigned_at ? Date.parse(p.last_assigned_at) : null,
      assignedToday: input.countsToday.get(p.user_id) ?? 0,
    })
  }
  return out
}
