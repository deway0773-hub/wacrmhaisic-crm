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
  /** Human-readable name shown next to the avatar. */
  displayName: string;
  /** Avatar URL, or `null` when the user has none. */
  avatar: string | null;
}

export const EMPTY_USER: UserState = {
  username: '',
  displayName: '',
  avatar: null,
};

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

    const username = pick('username', 'account', 'email');
    const displayName = pick('displayName', 'full_name', 'name') || username;
    const avatarRaw = parsed.avatar ?? parsed.avatar_url;

    return {
      username,
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
    window.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({
        ...base,
        username: user.username,
        account: user.username,
        email: user.username,
        displayName: user.displayName,
        full_name: user.displayName,
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
    persistUser(user);
    set({ user });
  },

  patchUser: (patch) => {
    const next = { ...get().user, ...patch };
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
