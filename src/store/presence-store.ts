'use client';

// ============================================================
// Self-presence store.
//
// The `member_presence` table (migration 024) only stores what the
// active client reports: 'online' or 'away'. "Offline" is never
// stored — viewers derive it from staleness. That is fine for the
// automatic heartbeat, but the header now lets the signed-in user
// *manually* pick a status: 在线 / 忙碌 / 离线.
//
// This store is the single reactive source for that manual choice.
// It maps the three user-facing options onto the existing schema:
//
//   在线 (online)  → report 'online', keep heartbeating
//   忙碌 (busy)    → report 'away',   keep heartbeating
//   离线 (offline) → report 'away',   STOP heartbeating so the row
//                    goes stale and viewers derive 'offline'
//
// The choice is persisted to `localStorage` so a refresh keeps it.
// ============================================================

import { create } from 'zustand';

import type { StoredPresence } from '@/lib/presence';

/** localStorage key for the manual presence choice. */
export const PRESENCE_STORAGE_KEY = 'presence-status';

/** The three options the user can pick in the header switcher. */
export type SelfPresence = 'online' | 'busy' | 'offline';

export const SELF_PRESENCE_OPTIONS: SelfPresence[] = [
  'online',
  'busy',
  'offline',
];

/**
 * Map a user-facing choice onto the value the DB stores.
 *
 * Both 'busy' and 'offline' collapse to the stored 'away' — the
 * difference is behavioural: 'offline' additionally stops the
 * heartbeat (see `shouldHeartbeat`), so the row ages out and viewers
 * derive 'offline' from staleness.
 */
export function toStoredPresence(status: SelfPresence): StoredPresence {
  return status === 'online' ? 'online' : 'away';
}

/**
 * Whether the heartbeat should keep reporting while this status is
 * selected. 'offline' deliberately stops beating so the presence row
 * goes stale and resolves to 'offline' for everyone else.
 */
export function shouldHeartbeat(status: SelfPresence): boolean {
  return status !== 'offline';
}

function isSelfPresence(value: unknown): value is SelfPresence {
  return value === 'online' || value === 'busy' || value === 'offline';
}

/** Read the persisted choice, defaulting to 'online'. */
export function readPersistedPresence(): SelfPresence {
  if (typeof window === 'undefined') return 'online';
  try {
    const raw = window.localStorage.getItem(PRESENCE_STORAGE_KEY);
    return isSelfPresence(raw) ? raw : 'online';
  } catch {
    return 'online';
  }
}

interface PresenceStore {
  status: SelfPresence;
  /** Set the manual status and persist it. */
  setStatus: (status: SelfPresence) => void;
  /** Seed from `localStorage` on mount. */
  hydrate: () => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  status: 'online',
  setStatus: (status) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PRESENCE_STORAGE_KEY, status);
      } catch {
        // localStorage 不可用时静默降级，仅保留内存状态。
      }
    }
    set({ status });
  },
  hydrate: () => set({ status: readPersistedPresence() }),
}));
