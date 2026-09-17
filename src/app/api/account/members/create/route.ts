import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  ACCOUNT_NAME_RE,
  isEmailInput,
  normalizeAccountToEmail,
} from '@/lib/auth/account-name'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: Request) {
  try {
    // Only admins may create members. This route uses the service
    // role key (bypasses RLS), so the role check here is the real
    // gate — the UI hiding the button is not enough.
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json() as {
      display_name?: string
      name?: string
      account?: string
      email?: string
      password?: string
      role?: string
    }
    const displayName = (body.name ?? body.display_name ?? '').trim()
    // The form collects a plain "account" (e.g. `zheng00`), not an
    // email. Supabase Auth still requires an email-shaped identifier,
    // so a bare account name is mapped to `<account>@local.fake`.
    // A value that already contains `@` is treated as a real email.
    const rawAccount = (body.account ?? body.email ?? '').trim()
    const isEmail = isEmailInput(rawAccount)
    const email = normalizeAccountToEmail(rawAccount)
    const password = body.password || ''
    const role = body.role === '销售' ? 'agent' : body.role

    if (!displayName) {
      return NextResponse.json({ error: '姓名不能为空' }, { status: 400 })
    }
    if (!rawAccount) {
      return NextResponse.json({ error: '账号不能为空' }, { status: 400 })
    }
    if (!isEmail && !ACCOUNT_NAME_RE.test(rawAccount)) {
      return NextResponse.json(
        { error: '账号只能包含字母、数字、点、下划线或短横线，长度 3-32 位' },
        { status: 400 },
      )
    }
    if (role !== 'admin' && role !== 'agent') {
      return NextResponse.json({ error: '无效的成员角色' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少需要 6 位' }, { status: 400 })
    }

    const serviceSupabase = createServiceRoleClient()

    const { data, error } = await serviceSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, role },
    })

    if (error) {
      console.error('[POST /api/account/members/create] auth error:', error)
      // Map the common "already registered" case to a friendly
      // message; never leak the raw Supabase error to the client.
      const msg = error.message?.toLowerCase() ?? ''
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return NextResponse.json({ error: '该账号已存在' }, { status: 409 })
      }
      return NextResponse.json({ error: '创建成员失败' }, { status: 400 })
    }

    // The `on_auth_user_created` trigger (migration 017) bootstraps
    // every new auth user with their OWN personal account and an
    // 'owner' profile. That's right for self-signup but wrong here:
    // this member must join the CALLER's account, not get a fresh
    // one. Re-point the profile and drop the orphan account, mirroring
    // what redeem_invitation does. Service role is required because
    // the trigger's account is not visible to the caller's RLS.
    const newUserId = data.user.id

    const { data: newProfile, error: profileErr } = await serviceSupabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', newUserId)
      .maybeSingle()

    if (profileErr || !newProfile?.account_id) {
      console.error(
        '[POST /api/account/members/create] profile lookup failed:',
        profileErr,
      )
      // Roll back the half-created user so a retry with the same
      // account name doesn't hit "already exists".
      await serviceSupabase.auth.admin.deleteUser(newUserId)
      return NextResponse.json({ error: '创建成员失败' }, { status: 500 })
    }

    const orphanAccountId = newProfile.account_id as string

    const { error: moveErr } = await serviceSupabase
      .from('profiles')
      .update({ account_id: ctx.accountId, account_role: role })
      .eq('user_id', newUserId)

    if (moveErr) {
      console.error(
        '[POST /api/account/members/create] profile reassign failed:',
        moveErr,
      )
      await serviceSupabase.auth.admin.deleteUser(newUserId)
      return NextResponse.json({ error: '创建成员失败' }, { status: 500 })
    }

    // Housekeeping: the trigger's personal account is now empty (the
    // profile was its only reference), so deleting it fires no
    // cascades. Best-effort — a leftover empty account is harmless.
    if (orphanAccountId !== ctx.accountId) {
      const { error: delErr } = await serviceSupabase
        .from('accounts')
        .delete()
        .eq('id', orphanAccountId)
      if (delErr) {
        console.error(
          '[POST /api/account/members/create] orphan account cleanup failed:',
          delErr,
        )
      }
    }

    return NextResponse.json({ ok: true, user_id: newUserId })
  } catch (err) {
    return toErrorResponse(err)
  }
}