'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, CircleAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  normalizeAccountToEmail,
  toDisplayAccount,
} from '@/lib/auth/account-name';
import { useUserStore } from '@/store/user-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// 账号名不再强制邮箱格式：只要求 3 个字符以上，允许字母/数字/._-
// （与 `ACCOUNT_NAME_RE` 保持一致）。
const ACCOUNT_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function ProfileForm() {
  const t = useTranslations('Settings.profile');
  const { user, profile, refreshProfile } = useAuth();
  const setUser = useUserStore((state) => state.setUser);
  const storeUser = useUserStore((state) => state.user);
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [account, setAccount] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed form state once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setAccount(toDisplayAccount(profile.email));
  }, [profile]);

  // Cleanup object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar ? profile?.avatar_url ?? null : null);

  const initial = (fullName || profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(t('unsupportedImage'), {
        description: t('unsupportedImageDesc'),
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('imageTooLarge'), {
        description: t('imageTooLargeDesc'),
      });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error(t('nameRequired'));
      return;
    }
    const trimmedAccount = account.trim();
    if (!ACCOUNT_RE.test(trimmedAccount)) {
      toast.error(t('invalidAccount'));
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext =
          pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(t('uploadFailed', { message: uploadError.message }));
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('avatars').getPublicUrl(path);
        nextAvatarUrl = publicUrl;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // 账号名不强制邮箱格式：统一存成 `<account>@local.fake`，
      // 与登录页的 `normalizeAccountToEmail` 保持同一套映射，
      // 这样用户填 `zhengjiabao` 也能保存并用于登录。
      const nextAccountEmail = normalizeAccountToEmail(trimmedAccount);

      // Persist name + account + avatar to profiles.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          email: nextAccountEmail,
          avatar_url: nextAvatarUrl,
        })
        .eq('user_id', user.id);
      if (updateError) {
        throw new Error(t('saveFailed', { message: updateError.message }));
      }

      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();

      // 同步到全局 store：`setUser` 会同时写入 localStorage，
      // 右上角头像菜单和设置总览卡片订阅了同一个 store，
      // 因此会立即重渲染，无需 `window.location.reload()`。
      // `username` / `account` 都写纯账号名，绝不带 `@local.fake`。
      setUser({
        ...storeUser,
        username: trimmedAccount,
        account: trimmedAccount,
        displayName: trimmedName,
        avatar: nextAvatarUrl,
      });

      toast.success(t('profileSaved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      account.trim().toLowerCase() !==
        toDisplayAccount(profile.email).toLowerCase() ||
      pendingAvatar !== null ||
      removeAvatar);

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  // The legacy `profiles.role` column is free-form text, so map the
  // known values to localized labels and fall back to the raw value
  // for anything unexpected.
  const roleLabel = (() => {
    switch (profile?.role) {
      case 'owner':
        return t('roleOwner');
      case 'operator':
        return t('roleOperator');
      case 'agent':
        return t('roleAgent');
      case 'user':
        return t('roleUser');
      default:
        return profile?.role ?? t('roleUser');
    }
  })();

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardContent className="space-y-6">
          {/* Avatar row */}
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {currentAvatar ? (
                <AvatarImage src={currentAvatar} alt={fullName || '头像'} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-base text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Upload className="size-4" />
                {currentAvatar ? t('changePhoto') : t('uploadPhoto')}
              </Button>
              {currentAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onRemoveAvatar}
                  disabled={saving}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                  {t('remove')}
                </Button>
              )}
              <p className="w-full text-xs text-muted-foreground">
                {t('photoHint')}
              </p>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-full-name" className="text-foreground">
              {t('displayName')}
            </Label>
            <Input
              id="profile-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
                  placeholder="例如：李明"
              maxLength={120}
              disabled={saving}
              required
            />
          </div>

          {/* Account */}
          <div className="space-y-2">
            <Label htmlFor="profile-account" className="text-foreground">
              {t('account')}
            </Label>
            <Input
              id="profile-account"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t('accountPlaceholder')}
              maxLength={32}
              disabled={saving}
              required
            />
            <p className="text-xs text-muted-foreground">
              {t('accountHint')}
            </p>
          </div>

          {/* Read-only block */}
          <div className="rounded-lg border border-border bg-muted p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('accountDetails')}
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('role')}</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {roleLabel}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('joined')}</dt>
                <dd className="mt-0.5 text-foreground">{joined}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t('userId')}</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                  {user?.id ?? '—'}
                </dd>
              </div>
            </dl>
          </div>

          {!profile && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleAlert className="size-4" />
              {t('loading')}
            </p>
          )}

        </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !dirty || !profile}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('saveChanges')
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
