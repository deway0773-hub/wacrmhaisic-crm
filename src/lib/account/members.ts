import type { AccountMember } from '@/types';

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Virtual members (profiles rows with no login) are excluded by
 * default — they are not real teammates. Pass `includeVirtual: true`
 * for pickers that assign work to them (e.g. the AI handoff target).
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(
  opts: { includeVirtual?: boolean } = {},
): Promise<AccountMember[]> {
  try {
    const qs = opts.includeVirtual ? '?includeVirtual=1' : '';
    const res = await fetch(`/api/account/members${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/**
 * Display label for a member: full name → raw id.
 *
 * The email is deliberately skipped — it holds the synthetic
 * `<account>@local.fake` address, which is a login identifier and must
 * never be rendered as a person's name.
 */
export function memberLabel(m: AccountMember): string {
  return m.full_name || m.user_id;
}
