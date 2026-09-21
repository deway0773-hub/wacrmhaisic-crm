'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';

const MIN_PASSWORD = 8;

export function PasswordForm() {
  const t = useTranslations('Settings.profile');
  const { profile } = useAuth();
  const supabase = createClient();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // 当前密码默认明文显示，方便用户核对；新密码/确认密码默认隐藏。
  const [showCurrent, setShowCurrent] = useState(true);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.email) {
      toast.error(t('cannotChangeNoEmail'));
      return;
    }
    if (next.length < MIN_PASSWORD) {
      setConfirmError(t('passwordTooShort', { min: MIN_PASSWORD }));
      return;
    }
    if (next !== confirm) {
      setConfirmError(t('passwordMismatch'));
      return;
    }
    setConfirmError(null);
    setSaving(true);

    try {
      // Supabase doesn't expose a "verify password without issuing a
      // session" API, so we re-authenticate with the provided current
      // password. If it matches, the session refreshes silently; if it
      // doesn't, we abort before calling updateUser.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (signInError) {
        toast.error(t('currentPasswordIncorrect'));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
      });
      if (updateError) {
        toast.error(t('passwordUpdateFailed', { message: updateError.message }));
        return;
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(t('passwordUpdated'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <KeyRound className="size-4 text-primary" />
          {t('passwordTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('passwordDesc', { min: MIN_PASSWORD })}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password" className="text-foreground">
              {t('currentPassword')}
            </Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? 'text' : 'password'}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                disabled={saving}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 border-0 bg-transparent p-0 text-gray-400 shadow-none transition-colors hover:text-gray-600 focus-visible:outline-none"
                aria-label={showCurrent ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                {showCurrent ? (
                  <EyeOff size={18} strokeWidth={1.5} />
                ) : (
                  <Eye size={18} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-foreground">
                {t('newPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNext ? 'text' : 'password'}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  disabled={saving}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNext((v) => !v)}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 border-0 bg-transparent p-0 text-gray-400 shadow-none transition-colors hover:text-gray-600 focus-visible:outline-none"
                  aria-label={showNext ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showNext ? (
                    <EyeOff size={18} strokeWidth={1.5} />
                  ) : (
                    <Eye size={18} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-foreground">
                {t('confirmPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  disabled={saving}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 border-0 bg-transparent p-0 text-gray-400 shadow-none transition-colors hover:text-gray-600 focus-visible:outline-none"
                  aria-label={showConfirm ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showConfirm ? (
                    <EyeOff size={18} strokeWidth={1.5} />
                  ) : (
                    <Eye size={18} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>
          </div>

          {confirmError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {confirmError}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving || !current || !next || !confirm}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('updating')}
                </>
              ) : (
                t('updatePassword')
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
