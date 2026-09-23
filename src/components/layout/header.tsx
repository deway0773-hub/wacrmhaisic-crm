"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  displayInitial,
  hydrateUserStore,
  resolveDisplayName,
  useUserStore,
} from "@/store/user-store";
import { LogOut, Menu, Settings as SettingsIcon, User } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { ROLE_META } from "@/components/settings/role-meta";
import { SettingsChip } from "@/components/settings/settings-chip";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/automations": "automations",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from "next-intl";

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const tRoles = useTranslations("Settings.roles");
  const pathname = usePathname();
  const { profile, signOut, accountRole } = useAuth();
  const titleKey = getPageTitleKey(pathname);

  // Reactive display identity. Reading from the store (instead of
  // parsing `localStorage` on every render) means a rename in
  // Settings → Profile repaints the header immediately — no reload.
  const storeUser = useUserStore((state) => state.user);

  // Seed the store from `localStorage` on mount so a hard refresh
  // paints the right name before Supabase resolves the profile.
  useEffect(() => {
    hydrateUserStore();
  }, []);

  // 显示名统一走 `resolveDisplayName`：优先 store（资料保存后即时同步），
  // 其次 `profiles.full_name`，最后才是 i18n 兜底文案。账号名
  // （`zhengjiabao`）和 `@local.fake` 邮箱是登录标识，绝不参与显示。
  const displayName = resolveDisplayName(
    storeUser.displayName,
    profile?.display_name || profile?.full_name,
    t("defaultUser"),
  );
  const avatarUrl = storeUser.avatar ?? profile?.avatar_url ?? null;

  const initial = displayInitial(displayName);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {t(titleKey as string)}
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <ModeToggle />

        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70"
          aria-label={t("openAccountMenu")}
        >
          <Avatar className="size-8">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={displayName} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          {/* 角色固定在头像旁边，随 `accountRole` 实时同步（资料保存后
              `refreshProfile()` 会更新 context，无需刷新页面）。 */}
          {accountRole ? (
            <SettingsChip
              variant={ROLE_META[accountRole].variant}
              className="hidden sm:inline-flex"
            >
              {tRoles(accountRole)}
            </SettingsChip>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-56 bg-popover text-popover-foreground ring-border"
        >
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <User className="size-4" />
            {t("menuProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=whatsapp"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
            {t("menuSettings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={signOut}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <LogOut className="size-4" />
            {t("menuSignOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
