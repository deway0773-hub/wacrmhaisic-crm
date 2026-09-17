import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashInviteToken } from '@/lib/auth/invitations';

export const dynamic = 'force-dynamic';

interface PeekResult {
  ok: boolean;
  reason?: string;
  account_name?: string;
  role?: string;
  expires_at?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const token = (await params)?.token;
  if (!token) return NextResponse.json({ ok: false, reason: 'not_found' });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // The plaintext token never reaches the DB — hash it first and
    // let the SECURITY DEFINER RPC do the cross-RLS read.
    const { data, error } = await supabase.rpc('peek_invitation', {
      p_token_hash: hashInviteToken(token),
    });

    if (error) {
      console.error('[GET /api/invitations/:token/peek] rpc error:', error);
      return NextResponse.json({ ok: false, reason: 'server_error' });
    }

    return NextResponse.json(data as PeekResult);
  } catch (e) {
    console.error('[GET /api/invitations/:token/peek] exception:', e);
    return NextResponse.json({ ok: false, reason: 'server_error' });
  }
}
