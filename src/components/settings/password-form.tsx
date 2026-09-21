'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, KeyRound } from 'lucide-react';

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

/** heroicons v2 outline: eye */
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

/** 密码可见性切换按钮：全程只用同一个 Eye 图标，仅用 opacity 区分状态 */
function EyeToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={shown ? '点击隐藏' : '点击显示'}
      aria-label={shown ? '隐藏密码' : '显示密码'}
      tabIndex={-1}
      className={`absolute right-3 top-1/2 -translate-y-1/2 border-0 bg-transparent p-0 transition-opacity ${
        shown ? 'text-gray-700 opacity-100' : 'text-gray-400 opacity-40'
      }`}
    >
      <EyeIcon className="h-5 w-5" />
    </button>
  );
}

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

  // 回填当前密码：优先 localStorage，其次默认值。
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('crm.currentPassword');
      setCurrent(saved ?? '1233456');
    } catch {
      setCurrent('1233456');
    }
  }, []);

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
              <EyeToggle
                shown={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
              />
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
                <EyeToggle
                  shown={showNext}
                  onToggle={() => setShowNext((v) => !v)}
                />
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
                <EyeToggle
                  shown={showConfirm}
                  onToggle={() => setShowConfirm((v) => !v)}
                />
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
