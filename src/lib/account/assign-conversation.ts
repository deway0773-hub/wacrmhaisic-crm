/**
 * Server-side conversation assignment.
 *
 * Wraps the pure picker in `./assignment` with the DB reads and
 * writes it needs:
 *
 *   - load the account roster (profiles) + presence + today's counts
 *   - pick an eligible agent (online, under cap, longest idle)
 *   - write `conversations.assigned_agent_id`
 *   - append to `conversation_assignments` with source='auto'
 *   - stamp `profiles.last_assigned_at`
 *
 * The manual path (the inbox dropdown) writes the column directly
 * from the browser; the DB trigger in migration 043 logs that and
 * stamps `last_assigned_at`, so both paths keep the rotation and
 * the daily counter honest.
 */

import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  buildCandidates,
  describePick,
  pickAssignee,
  type PickResult,
  type PresenceWithUser,
} from './assignment'

export interface AssignOptions {
  accountId: string
  conversationId: string
  /** Who triggered this (automation author / API caller). Null = system. */
  assignedBy?: string | null
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: number
}

export interface AssignOutcome extends PickResult {
  /** Human-readable summary suitable for an automation log. */
  message: string
  /** True when the conversation row was actually updated. */
  assigned: boolean
}

/**
 * Load the roster, pick an agent, and assign the conversation.
 *
 * Returns `assigned: false` (with a reason in `message`) when no
 * agent is eligible — the conversation is left in the unassigned
 * pool, which is the desired behaviour when everyone is offline or
 * at capacity.
 */
export async function assignConversation(
  opts: AssignOptions,
): Promise<AssignOutcome> {
  const db = supabaseAdmin()
  const now = opts.now ?? Date.now()

  // ---- 1. roster -------------------------------------------
  const { data: profiles, error: profileErr } = await db
    .from('profiles')
    .select('user_id, full_name, daily_conversation_limit, last_assigned_at')
    .eq('account_id', opts.accountId)
    .not('user_id', 'is', null)

  if (profileErr) {
    throw new Error(`Failed to load roster: ${profileErr.message}`)
  }
  if (!profiles || profiles.length === 0) {
    return {
      agentId: null,
      skipped: [],
      assigned: false,
      message: 'no agents available',
    }
  }

  const userIds = profiles
    .map((p) => p.user_id)
    .filter((id): id is string => Boolean(id))

  // ---- 2. presence -----------------------------------------
  const { data: presenceRows } = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at')
    .in('user_id', userIds)

  // ---- 3. today's counts -----------------------------------
  // One query for the whole roster rather than N per-agent RPCs.
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const { data: todayRows } = await db
    .from('conversation_assignments')
    .select('agent_id, conversation_id')
    .eq('account_id', opts.accountId)
    .gte('assigned_at', startOfDay.toISOString())
    .in('agent_id', userIds)

  const countsToday = new Map<string, number>()
  const seen = new Map<string, Set<string>>()
  for (const row of todayRows ?? []) {
    if (!row.agent_id) continue
    let set = seen.get(row.agent_id)
    if (!set) {
      set = new Set()
      seen.set(row.agent_id, set)
    }
    set.add(row.conversation_id)
  }
  for (const [agentId, set] of seen) {
    countsToday.set(agentId, set.size)
  }

  // ---- 4. pick ---------------------------------------------
  const candidates = buildCandidates({
    profiles,
    presence: (presenceRows ?? []) as PresenceWithUser[],
    countsToday,
  })

  const result = pickAssignee(candidates, now)
  const nameOf = (id: string) =>
    candidates.find((c) => c.userId === id)?.fullName ?? id
  const message = describePick(result, nameOf)

  if (!result.agentId) {
    return { ...result, assigned: false, message }
  }

  // ---- 5. write --------------------------------------------
  const { error: updateErr } = await db
    .from('conversations')
    .update({ assigned_agent_id: result.agentId })
    .eq('id', opts.conversationId)
    .eq('account_id', opts.accountId)

  if (updateErr) {
    throw new Error(`Failed to assign conversation: ${updateErr.message}`)
  }

  // The trigger in migration 043 logs manual assignments; automatic
  // ones are logged here so the row carries source='auto' and the
  // real actor. `last_assigned_at` is stamped by the same trigger,
  // but we set it explicitly too so the rotation advances even if
  // the trigger is ever disabled.
  await db.from('conversation_assignments').insert({
    account_id: opts.accountId,
    conversation_id: opts.conversationId,
    agent_id: result.agentId,
    assigned_by: opts.assignedBy ?? null,
    source: 'auto',
  })

  await db
    .from('profiles')
    .update({ last_assigned_at: new Date(now).toISOString() })
    .eq('user_id', result.agentId)

  return { ...result, assigned: true, message }
}

/**
 * Check whether a specific agent may take another conversation
 * today. Used by the manual-assignment API to reject a pick that
 * would exceed the agent's cap.
 */
export async function canAgentTakeConversation(
  accountId: string,
  agentId: string,
  now: number = Date.now(),
): Promise<{ allowed: boolean; limit: number | null; assignedToday: number }> {
  const db = supabaseAdmin()

  const { data: profile } = await db
    .from('profiles')
    .select('daily_conversation_limit')
    .eq('account_id', accountId)
    .eq('user_id', agentId)
    .maybeSingle()

  const limit = profile?.daily_conversation_limit ?? null
  if (limit === null) {
    return { allowed: true, limit: null, assignedToday: 0 }
  }

  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const { data: rows } = await db
    .from('conversation_assignments')
    .select('conversation_id')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)
    .gte('assigned_at', startOfDay.toISOString())

  const assignedToday = new Set((rows ?? []).map((r) => r.conversation_id)).size
  return { allowed: assignedToday < limit, limit, assignedToday }
}
