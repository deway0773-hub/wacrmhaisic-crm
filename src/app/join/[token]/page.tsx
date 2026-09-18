'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'operator' | 'agent';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const ROLE_LABEL: Record<PeekOk['role'], string> = {
  admin: '管理员',
  operator: '运营',
  agent: '销售',
};

const FAIL_COPY: Record<PeekFail['reason'], { title: string; body: string }> = {
  not_found: {
    title: '未找到邀请',
    body: '该链接不是有效的邀请链接。请检查链接是否正确，或让邀请你的人重新发送一个。',
  },
  used: {
    title: '邀请已被使用',
    body: '该邀请已被接受。如果不是你操作的，请让管理员重新发送一个邀请链接。',
  },
  expired: {
    title: '邀请已过期',
    body: '该邀请已过期，请让管理员重新生成一个，几秒钟就能发好。',
  },
  server_error: {
    title: '出错了',
    body: '暂时无法验证该邀请，请稍后刷新重试。',
  },
};

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(undefined);
  const [accepting, setAccepting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      // 先拿邀请信息，不等登录状态
      const peekRes = await fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, { cache: 'no-store' });
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
    }

    // 登录状态单独拿，带超时，卡住也不影响页面
    try {
      const client = createClient();
      const authPromise = client.auth.getUser();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 3000));
      const authRes = (await Promise.race([authPromise, timeoutPromise])) as any;
      setAuthedUserId(authRes?.data?.user?.id ?? null);
    } catch (err) {
      console.warn('[join] auth timeout or error, treat as not logged in:', err);
      setAuthedUserId(null);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const peekRes = await fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, { cache: 'no-store' });
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
      }

      try {
        const client = createClient();
        const authPromise = client.auth.getUser();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 3000));
        const authRes = (await Promise.race([authPromise, timeoutPromise])) as any;
        if (cancelled) return;
        setAuthedUserId(authRes?.data?.user?.id ?? null);
      } catch (err) {
        console.warn('[join] auth error:', err);
        if (cancelled) return;
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    try {
      // The redeem RPC runs as the caller, so we must forward their
      // access token — the route no longer accepts email/password.
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) {
        toast.error('请先登录后再接受邀请');
        setAccepting(false);
        return;
      }
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/redeem`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 409) {
          setConflictMessage(payload.error || '你已经在其他团队中了，请使用其他邮箱登录来加入此团队。');
        } else {
          toast.error(payload.error || '接受邀请失败');
        }
        setAccepting(false);
        return;
      }
      toast.success('欢迎加入团队');
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error('无法连接到服务器');
      setAccepting(false);
    }
  }, [token]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error('退出失败，请刷新页面重试');
      setSigningOut(false);
    }
  }, []);

  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">正在验证邀请…</p>
        </CardContent>
      </Card>
    );
  }

  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{copy.title}</CardTitle>
          <CardDescription className="text-muted-foreground">{copy.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {peek.reason === 'server_error' ? (
            <>
              <Button onClick={loadPeekAndAuth} className="w-full">重试</Button>
              <Link href="/signup"><Button variant="outline" className="w-full">改为创建新账号</Button></Link>
            </>
          ) : (
            <>
              <Link href="/signup"><Button className="w-full">改为创建新账号</Button></Link>
              <Link href="/login"><Button variant="outline" className="w-full">去登录</Button></Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const inviteHeader = (
    <CardHeader className="items-center text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <UsersRound className="h-6 w-6 text-primary" />
      </div>
      <CardTitle className="text-xl text-foreground">你被邀请加入 <span className="text-primary">{peek.account_name}</span></CardTitle>
      <CardDescription className="text-muted-foreground">你将以 <span className="inline-flex items-center gap-1 text-foreground"><ShieldCheck className="size-3.5 text-primary" />{ROLE_LABEL[peek.role]}</span> 身份加入。链接有效期至 {new Date(peek.expires_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}。</CardDescription>
    </CardHeader>
  );

  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md border-border bg-card">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleAccept} disabled={accepting} className="w-full">{accepting ? <><Loader2 className="size-4 animate-spin" />正在接受…</> : <><CheckCircle className="size-4" />接受邀请</>}</Button>
            <p className="text-center text-xs text-muted-foreground">接受后，你的登录账号将移入 {peek.account_name}。</p>
          </CardContent>
        </Card>
        <Dialog open={conflictMessage !== null} onOpenChange={(open) => { if (!open) setConflictMessage(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-400" />无法使用当前账号加入 {peek.account_name}</DialogTitle>
              <DialogDescription>{conflictMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConflictMessage(null)}>保持登录</Button>
              <Button onClick={handleSignOutAndRetry} disabled={signingOut}>{signingOut ? <><Loader2 className="size-4 animate-spin" />正在退出…</> : '退出并使用其他邮箱'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Card className="w-full max-w-md border-border bg-card">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Link href={`/signup?invite=${encodeURIComponent(token!)}`}><Button className="w-full">创建账号并加入</Button></Link>
        <Link href={`/login?invite=${encodeURIComponent(token!)}`}><Button variant="outline" className="w-full">我已有账号，去登录</Button></Link>
      </CardContent>
    </Card>
  );
}
