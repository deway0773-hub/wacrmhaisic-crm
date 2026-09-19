import { describe, it, expect } from 'vitest'
import {
  buildCandidates,
  describePick,
  isAtCapacity,
  pickAssignee,
  type AssignmentCandidate,
} from './assignment'
import { OFFLINE_AFTER_MS } from '@/lib/presence'

const NOW = Date.parse('2025-06-01T12:00:00.000Z')

/** A fresh, online, uncapped candidate. Override per test. */
function candidate(over: Partial<AssignmentCandidate> = {}): AssignmentCandidate {
  return {
    userId: 'u1',
    fullName: 'Agent One',
    storedPresence: 'online',
    lastSeenAt: new Date(NOW - 1_000).toISOString(),
    dailyLimit: null,
    lastAssignedAt: null,
    assignedToday: 0,
    ...over,
  }
}

describe('isAtCapacity', () => {
  it('treats a null limit as unlimited', () => {
    expect(isAtCapacity(null, 0)).toBe(false)
    expect(isAtCapacity(null, 999)).toBe(false)
  })

  it('is false below the limit and true at/over it', () => {
    expect(isAtCapacity(10, 9)).toBe(false)
    expect(isAtCapacity(10, 10)).toBe(true)
    expect(isAtCapacity(10, 11)).toBe(true)
  })

  it('treats a limit of 0 as "takes no new chats"', () => {
    expect(isAtCapacity(0, 0)).toBe(true)
  })
})

describe('pickAssignee', () => {
  it('returns null when there are no candidates', () => {
    expect(pickAssignee([], NOW)).toEqual({ agentId: null, skipped: [] })
  })

  it('picks the only online, uncapped agent', () => {
    const res = pickAssignee([candidate({ userId: 'a' })], NOW)
    expect(res.agentId).toBe('a')
    expect(res.skipped).toEqual([])
  })

  it('skips offline agents and reports why', () => {
    const stale = new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString()
    const res = pickAssignee(
      [
        candidate({ userId: 'off', fullName: 'Offline', lastSeenAt: stale }),
        candidate({ userId: 'on', fullName: 'Online' }),
      ],
      NOW,
    )
    expect(res.agentId).toBe('on')
    expect(res.skipped).toEqual([
      { userId: 'off', fullName: 'Offline', reason: 'offline' },
    ])
  })

  it('treats a missing presence row as offline', () => {
    const res = pickAssignee(
      [candidate({ userId: 'ghost', storedPresence: null, lastSeenAt: null })],
      NOW,
    )
    expect(res.agentId).toBeNull()
    expect(res.skipped[0].reason).toBe('offline')
  })

  it('skips an agent who has hit their daily cap', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'full', fullName: 'Full', dailyLimit: 10, assignedToday: 10 }),
        candidate({ userId: 'free', fullName: 'Free', dailyLimit: 10, assignedToday: 3 }),
      ],
      NOW,
    )
    expect(res.agentId).toBe('free')
    expect(res.skipped).toEqual([
      { userId: 'full', fullName: 'Full', reason: 'at_capacity' },
    ])
  })

  it('leaves the conversation unassigned when everyone is offline', () => {
    const stale = new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString()
    const res = pickAssignee(
      [
        candidate({ userId: 'a', lastSeenAt: stale }),
        candidate({ userId: 'b', lastSeenAt: stale }),
      ],
      NOW,
    )
    expect(res.agentId).toBeNull()
    expect(res.skipped).toHaveLength(2)
    expect(res.skipped.every((s) => s.reason === 'offline')).toBe(true)
  })

  it('leaves the conversation unassigned when everyone is at capacity', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'a', dailyLimit: 5, assignedToday: 5 }),
        candidate({ userId: 'b', dailyLimit: 1, assignedToday: 9 }),
      ],
      NOW,
    )
    expect(res.agentId).toBeNull()
    expect(res.skipped.every((s) => s.reason === 'at_capacity')).toBe(true)
  })

  it('prefers the agent who has waited longest since their last assignment', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'recent', lastAssignedAt: NOW - 60_000 }),
        candidate({ userId: 'old', lastAssignedAt: NOW - 3_600_000 }),
        candidate({ userId: 'mid', lastAssignedAt: NOW - 600_000 }),
      ],
      NOW,
    )
    expect(res.agentId).toBe('old')
  })

  it('prefers a never-assigned agent over any previously assigned one', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'veteran', lastAssignedAt: NOW - 86_400_000 }),
        candidate({ userId: 'fresh', lastAssignedAt: null }),
      ],
      NOW,
    )
    expect(res.agentId).toBe('fresh')
  })

  it('breaks ties deterministically on user_id', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'zzz', lastAssignedAt: null }),
        candidate({ userId: 'aaa', lastAssignedAt: null }),
      ],
      NOW,
    )
    expect(res.agentId).toBe('aaa')
  })

  it('rotates: after assigning, the next pick goes to the other agent', () => {
    const roster = [
      candidate({ userId: 'a', lastAssignedAt: null }),
      candidate({ userId: 'b', lastAssignedAt: null }),
    ]
    const first = pickAssignee(roster, NOW)
    expect(first.agentId).toBe('a')

    // Simulate the write-back the helper performs.
    const after = roster.map((c) =>
      c.userId === first.agentId ? { ...c, lastAssignedAt: NOW } : c,
    )
    const second = pickAssignee(after, NOW)
    expect(second.agentId).toBe('b')
  })

  it('does not count an away agent as online', () => {
    // Presence is now derived from last_seen age: a heartbeat older
    // than the 5-minute online window reads as 'away', which is not
    // eligible for assignment.
    const res = pickAssignee(
      [
        candidate({
          userId: 'away',
          storedPresence: 'away',
          lastSeenAt: new Date(NOW - 10 * 60_000).toISOString(),
        }),
      ],
      NOW,
    )
    expect(res.agentId).toBeNull()
    expect(res.skipped[0].reason).toBe('offline')
  })
})

describe('describePick', () => {
  const nameOf = (id: string) => ({ a: 'Alice', b: 'Bob' })[id] ?? id

  it('describes a successful pick', () => {
    expect(describePick({ agentId: 'a', skipped: [] }, nameOf)).toBe(
      'assigned to Alice',
    )
  })

  it('summarises skips alongside the winner', () => {
    const res = pickAssignee(
      [
        candidate({ userId: 'a', fullName: 'Alice' }),
        candidate({
          userId: 'b',
          fullName: 'Bob',
          lastSeenAt: new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString(),
        }),
        candidate({ userId: 'c', fullName: 'Cara', dailyLimit: 2, assignedToday: 2 }),
      ],
      NOW,
    )
    expect(describePick(res, nameOf)).toBe(
      'assigned to Alice (skipped 1 offline, 1 at capacity)',
    )
  })

  it('explains an empty pool', () => {
    expect(describePick({ agentId: null, skipped: [] }, nameOf)).toBe(
      'no agents available',
    )
  })

  it('explains an all-offline pool', () => {
    const stale = new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString()
    const res = pickAssignee([candidate({ userId: 'a', lastSeenAt: stale })], NOW)
    expect(describePick(res, nameOf)).toBe('no eligible agent (1 offline)')
  })
})

describe('buildCandidates', () => {
  it('joins profiles, presence and today counts', () => {
    const out = buildCandidates({
      profiles: [
        {
          user_id: 'u1',
          full_name: 'One',
          daily_conversation_limit: 10,
          last_assigned_at: '2025-06-01T10:00:00.000Z',
        },
      ],
      presence: [
        { user_id: 'u1', status: 'online', last_seen_at: '2025-06-01T11:59:00.000Z' },
      ],
      countsToday: new Map([['u1', 4]]),
    })
    expect(out).toEqual([
      {
        userId: 'u1',
        fullName: 'One',
        storedPresence: 'online',
        lastSeenAt: '2025-06-01T11:59:00.000Z',
        dailyLimit: 10,
        lastAssignedAt: Date.parse('2025-06-01T10:00:00.000Z'),
        assignedToday: 4,
      },
    ])
  })

  it('drops virtual members (null user_id)', () => {
    const out = buildCandidates({
      profiles: [
        {
          user_id: null,
          full_name: 'Virtual',
          daily_conversation_limit: null,
          last_assigned_at: null,
        },
      ],
      presence: [],
      countsToday: new Map(),
    })
    expect(out).toEqual([])
  })

  it('defaults missing presence and counts', () => {
    const out = buildCandidates({
      profiles: [
        {
          user_id: 'u2',
          full_name: null,
          daily_conversation_limit: null,
          last_assigned_at: null,
        },
      ],
      presence: [],
      countsToday: new Map(),
    })
    expect(out[0]).toMatchObject({
      userId: 'u2',
      fullName: 'u2',
      storedPresence: null,
      lastSeenAt: null,
      assignedToday: 0,
    })
  })
})
