// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or daily assignment cap.
//            Admin+.
//   DELETE — remove a member.          Admin+.
//
// Role changes delegate to SECURITY DEFINER RPCs from migration
// 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
//
// The daily cap (`daily_conversation_limit`, migration 043) is a
// plain column write — it carries no privilege escalation, so it
// goes through the caller's RLS-scoped client rather than an RPC.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; daily_conversation_limit?: unknown }
      | null;

    const updates: Record<string, unknown> = {};

    // ---- role (optional) -----------------------------------
    if (body?.role !== undefined) {
      const role = body.role;
      if (!isAccountRole(role) || role === "owner") {
        return NextResponse.json(
          { error: "'role' must be one of admin, agent" },
          { status: 400 },
        );
      }
      updates.role = role;
      updates.account_role = role;
    }

    // ---- daily cap (optional) ------------------------------
    // Accepts a non-negative integer or null (= unlimited).
    if (body?.daily_conversation_limit !== undefined) {
      const raw = body.daily_conversation_limit;
      if (raw === null) {
        updates.daily_conversation_limit = null;
      } else if (
        typeof raw === "number" &&
        Number.isInteger(raw) &&
        raw >= 0
      ) {
        updates.daily_conversation_limit = raw;
      } else {
        return NextResponse.json(
          {
            error:
              "'daily_conversation_limit' must be a non-negative integer or null",
          },
          { status: 400 },
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase
      .from("profiles")
      .update(updates)
      .or(`id.eq.${userId},user_id.eq.${userId}`);

    if (error) {
      console.error("[PATCH /api/account/members/:id] update error:", error);
      return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { error } = await ctx.supabase
      .from("profiles")
      .delete()
      .or(`id.eq.${userId},user_id.eq.${userId}`);

    if (error) {
      console.error("[DELETE /api/account/members/:id] delete error:", error);
      return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
