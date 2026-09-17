import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashInviteToken } from '@/lib/auth/invitations';

export const dynamic = 'force-dynamic';

// SQLSTATE → HTTP status mapping for `redeem_invitation`.
//   22023 — invite invalid (not_found / used / expired)
//   42501 — caller not authenticated / has no profile
//   23505 — caller already in a shared account, or their account
//           holds data that joining would orphan
const SQLSTATE_STATUS: Record<string, number> = {
  '22023': 400,
  '42501': 401,
  '23505': 409,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const token = (await params)?.token;
  if (!token) {
    return NextResponse.json({ error: '邀请链接无效' }, { status: 400 });
  }

  // The caller must be signed in — `redeem_invitation` reads
  // auth.uid() to know whose profile to move. We forward the
  // caller's access token so the RPC runs as them, not as the
  // service role.
  const authHeader = req.headers.get('authorization') ?? '';
  const accessToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!accessToken) {
    return NextResponse.json({ error: '请先登录后再接受邀请' }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }
    );

    const { error } = await supabase.rpc('redeem_invitation', {
      p_token_hash: hashInviteToken(token),
    });

    if (error) {
      const status = SQLSTATE_STATUS[error.code ?? ''] ?? 500;
      // Map the RPC's refusal reasons to friendly, non-leaky copy.
      const message =
        status === 409
          ? '你已经在其他团队中，或当前账号已有数据。请使用其他账号登录后再加入此团队。'
          : status === 401
            ? '请先登录后再接受邀请'
            : status === 400
              ? '邀请链接无效、已过期或已被使用'
              : '接受邀请失败，请稍后重试';
      if (status === 500) {
        console.error('[POST /api/invitations/:token/redeem] rpc error:', error);
      }
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/invitations/:token/redeem] exception:', e);
    return NextResponse.json({ error: '接受邀请失败，请稍后重试' }, { status: 500 });
  }
}
