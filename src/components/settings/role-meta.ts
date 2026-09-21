import {
  Briefcase,
  Crown,
  UserCog,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). Previously duplicated in both files; hoisted here so a label,
 * icon, or colour change lands once.
 *
 * `variant` drives the token-based <SettingsChip>; `className` is the
 * inline Tailwind string the Members tab applies to its own spans.
 */
export const ROLE_META: Record<
  AccountRole,
  { icon: LucideIcon; label: string; variant: ChipVariant; className: string }
> = {
  owner: {
    icon: Crown,
    label: 'owner',
    variant: 'owner',
    // 浅色主题下 `text-amber-300` 几乎看不见，必须补 `text-amber-700`；
    // 深色主题再切回亮色。边框/底色同步加深，保证对比度 ≥ 4.5:1。
    className:
      'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  },
  operator: {
    icon: Briefcase,
    label: 'operator',
    variant: 'operator',
    className:
      'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
  },
  agent: {
    icon: UserCog,
    label: 'agent',
    variant: 'muted',
    // 中性角色用 `text-foreground` 而不是 `text-muted-foreground`，
    // 否则灰底灰字在浅色主题下糊成一片。
    className: 'border-border bg-muted text-foreground',
  },
};
