// ============================================================
// Account-name ↔ email mapping.
//
// Members sign in with a short account name (e.g. `zheng00`),
// but Supabase Auth only understands email-shaped identifiers.
// We therefore map a bare account name to `<account>@local.fake`
// and treat any value that already contains `@` as a real email.
//
// Both the create-member route and the login page MUST use the
// same normalization, otherwise a member created as `Zheng00`
// could never sign in as `zheng00` (or vice versa). Keeping the
// logic in one place makes that contract explicit.
// ============================================================

/** Domain used for account names that aren't real emails. */
export const LOCAL_ACCOUNT_DOMAIN = "local.fake";

/** Account names may only contain these characters. */
export const ACCOUNT_NAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

/**
 * Normalize a raw account/email input into the email-shaped
 * identifier Supabase Auth expects.
 *
 * - Trims surrounding whitespace.
 * - Lowercases the whole value so `Zheng00` and `zheng00` are the
 *   same account (Supabase Auth lowercases emails anyway, so this
 *   keeps our own comparisons consistent).
 * - A bare account name becomes `<name>@local.fake`.
 * - A value containing `@` is treated as a real email and used
 *   as-is (after lowercasing).
 *
 * Returns an empty string for empty input.
 */
export function normalizeAccountToEmail(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.includes("@") ? trimmed : `${trimmed}@${LOCAL_ACCOUNT_DOMAIN}`;
}

/** True when the raw input is a real email (contains `@`). */
export function isEmailInput(raw: string | null | undefined): boolean {
  return (raw ?? "").includes("@");
}

/**
 * Inverse of `normalizeAccountToEmail`, for display.
 *
 * The database stores account names as `<account>@local.fake`, but
 * users should never see that synthetic domain. Strip it so the
 * header, settings overview, and profile form all render the same
 * short account name (`zhengjiabao`). Real emails are returned
 * unchanged.
 */
export function toDisplayAccount(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const suffix = `@${LOCAL_ACCOUNT_DOMAIN}`;
  return trimmed.toLowerCase().endsWith(suffix)
    ? trimmed.slice(0, -suffix.length)
    : trimmed;
}
