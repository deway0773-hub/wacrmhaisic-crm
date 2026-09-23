'use client';

// ============================================================
// Global user store.
//
// The account name is edited in Settings → Profile, but it is also
// rendered in the header dropdown and the Settings overview card.
// Those three surfaces used to read `profile.email` (which stores
// `<account>@local.fake`) or hand-parse `localStorage`, so a rename
// only showed up after a full page reload.
//
// This store is the single reactive source for the *display* shape
// of the signed-in user. `setUser` updates the in-memory state (so
// every subscribed component re-renders immediately) and mirrors the
// value into `localStorage` under the legacy `user` key, so a hard
// refresh still paints the right name before Supabase resolves.
// ============================================================

import { create } from 'zustand';

/** localStorage key used by the legacy auth bootstrap. */
export const USER_STORAGE_KEY = 'user';

export interface UserState {
  /** Bare account name, e.g. `zhengjiabao`. Never `@local.fake`. */
  username: string;
  /**
   * Alias of `username`, kept so callers can write
   * `{ ...user, account: trimmed }` without losing the field.
   */
  account: string;
  /** Human-readable name shown next to the avatar. */
  displayName: string;
  /** Avatar URL, or `null` when the user has none. */
  avatar: string | null;
}

export const EMPTY_USER: UserState = {
  username: '',
  account: '',
  displayName: '',
  avatar: null,
};

/**
 * Strip the synthetic `@local.fake` domain from a stored account.
 *
 * The database keeps account names as `<account>@local.fake`, but the
 * UI must never show that domain. Anything that is not a `local.fake`
 * address is returned untouched.
 */
export function stripFakeEmail(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return trimmed;
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (domain === 'local.fake') return trimmed.slice(0, at);
  return trimmed;
}

interface UserStore {
  user: UserState;
  /** Replace the whole user object and persist it. */
  setUser: (user: UserState) => void;
  /** Merge a partial update into the current user and persist it. */
  patchUser: (patch: Partial<UserState>) => void;
  /** Reset to the empty user (used on sign-out). */
  clearUser: () => void;
}

/**
 * Read the persisted user from `localStorage`.
 *
 * Tolerates every shape we have written over time: the legacy
 * `{ full_name, email }` blob, the intermediate
 * `{ username, account, email }` blob, and the current
 * `{ username, displayName, avatar }` shape. Anything unparseable
 * degrades to `EMPTY_USER` rather than throwing.
 */
function readPersistedUser(): UserState {
  if (typeof window === 'undefined') return EMPTY_USER;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return EMPTY_USER;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY_USER;

    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };

    // `email` may hold the legacy `<account>@local.fake` value, so it
    // is cleaned before it can reach the UI.
    const username = stripFakeEmail(pick('username', 'account', 'email'));

    // The account name (`zhengjiabao`) is a login identifier, not a
    // name meant for humans. Never fall back to it: a persisted blob
    // written before the user set a display name would otherwise make
    // the header render the account name. An empty string lets the
    // caller fall through to `profile.full_name` instead.
    let displayName = pick('displayName', 'full_name', 'name');
    if (displayName && displayName === username) displayName = '';

    const avatarRaw = parsed.avatar ?? parsed.avatar_url;

    return {
      username,
      account: username,
      displayName,
      avatar: typeof avatarRaw === 'string' && avatarRaw ? avatarRaw : null,
    };
  } catch {
    // localStorage 不可用（隐私模式等）或内容损坏时静默降级。
    return EMPTY_USER;
  }
}

/** Mirror the user into `localStorage`, merging into any existing blob. */
function persistUser(user: UserState): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const base =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    // `username` / `account` / `email` all carry the bare account name
    // so legacy readers never see the synthetic `@local.fake` domain.
    const account = stripFakeEmail(user.username || user.account);

    // Guard the same invariant on the way out: a display name that is
    // really just the account name is not a display name. Persisting it
    // would poison the next `readPersistedUser()`.
    const displayName =
      user.displayName && user.displayName !== account ? user.displayName : '';

    window.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({
        ...base,
        username: account,
        account,
        email: account,
        displayName,
        full_name: displayName,
        avatar: user.avatar,
        avatar_url: user.avatar,
      }),
    );
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过。
  }
}

export const useUserStore = create<UserStore>((set, get) => ({
  // Start empty so server and first client render agree; the
  // `hydrateUser` call below fills it in before paint.
  user: EMPTY_USER,

  setUser: (user) => {
    // Keep `username` and `account` in lockstep no matter which one the
    // caller supplied, and never let `@local.fake` into the state.
    const account = stripFakeEmail(user.username || user.account);
    const next: UserState = { ...user, username: account, account };
    persistUser(next);
    set({ user: next });
  },

  patchUser: (patch) => {
    const merged = { ...get().user, ...patch };
    const account = stripFakeEmail(merged.username || merged.account);
    const next: UserState = { ...merged, username: account, account };
    persistUser(next);
    set({ user: next });
  },

  clearUser: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(USER_STORAGE_KEY);
      } catch {
        // 忽略：隐私模式下 removeItem 也可能抛错。
      }
    }
    set({ user: EMPTY_USER });
  },
}));

/**
 * Pull the persisted user into the store. Safe to call repeatedly —
 * call it from an effect once the component mounts.
 */
export function hydrateUserStore(): void {
  const persisted = readPersistedUser();
  if (
    persisted.username ||
    persisted.displayName ||
    persisted.avatar
  ) {
    useUserStore.setState({ user: persisted });
  }
}
