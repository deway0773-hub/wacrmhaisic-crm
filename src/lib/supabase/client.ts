import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  // Both values are inlined at build time by Next.js, so they must be
  // referenced as full `process.env.NEXT_PUBLIC_*` expressions.
  //
  // NOTE: newer Supabase projects issue a *publishable* key
  // (`sb_publishable_...`) instead of the legacy JWT anon key (`eyJ...`).
  // Both work with `createBrowserClient`; the value just has to match what
  // the Dashboard → Project Settings → API shows for this project.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    // Fail loudly in the console instead of letting every query 401 with a
    // cryptic message. The UI keeps rendering (empty states) either way.
    console.error(
      '[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy them from Supabase Dashboard → Project Settings → API into .env.local and restart the dev server.'
    )
  }

  browserClient = createBrowserClient(url!, anonKey!)

  return browserClient
}

/**
 * Realtime connection states reported by `channel.subscribe(status => ...)`.
 * `SUBSCRIBED` is the only healthy one; the rest mean the websocket is
 * down, still connecting, or the server rejected the subscription.
 */
export type RealtimeStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR'

export function isRealtimeHealthy(status: RealtimeStatus): boolean {
  return status === 'SUBSCRIBED'
}

/**
 * Human-readable reason for a non-`SUBSCRIBED` status, used in console
 * warnings / toasts. Kept here so every channel reports the same wording.
 */
export function describeRealtimeStatus(status: RealtimeStatus): string {
  switch (status) {
    case 'SUBSCRIBED':
      return 'connected'
    case 'TIMED_OUT':
      return 'timed out — the websocket did not connect in time'
    case 'CLOSED':
      return 'closed — the websocket was closed'
    case 'CHANNEL_ERROR':
      return 'channel error — check that Realtime is enabled for this table in Supabase Dashboard → Database → Realtime'
    default:
      return String(status)
  }
}
