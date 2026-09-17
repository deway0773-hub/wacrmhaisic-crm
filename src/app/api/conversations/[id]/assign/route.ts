// ============================================================
// PATCH /api/conversations/[id]/assign
//
// Manual conversation assignment from the inbox dropdown.
//
// The inbox used to write `conversations.assigned_agent_id`
// straight from the browser. That bypassed the daily cap entirely,
// so an admin could hand an agent their 50th chat of the day even
// though the round-robin picker would have skipped them. This
// route is the single guarded entry point:
//
//   - caller must be a member of the conversation's account
//   - the target agent must be in the same account
//   - the target agent must be under their daily cap
//     (`daily_conversation_limit`, null = unlimited)
//
// Passing `agentId: null` unassigns — always allowed, and it does
// not consume anyone's capacity.
//
// The DB trigger from migration 043 logs the write and stamps
// `last_assigned_at`, so this route only has to do the guard.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canAgentTakeConversation } from "@/lib/account/assign-conversation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { agentId?: unknown }
      | null;

    if (!body || !("agentId" in body)) {
      return NextResponse.json(
        { error: "'agentId' is required (string or null)" },
        { status: 400 },
      );
    }

    const agentId = body.agentId;
    if (agentId !== null && typeof agentId !== "string") {
      return NextResponse.json(
        { error: "'agentId' must be a string or null" },
        { status: 400 },
      );
    }

    // Resolve the conversation and confirm the caller can see it.
    // RLS already scopes this to the caller's account, so a foreign
    // id simply comes back empty → 404.
    const { data: conversation, error: convErr } = await supabase
      .from("conversations")
      .select("id, account_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr) {
      console.error("[PATCH /api/conversations/:id/assign] read error:", convErr);
      return NextResponse.json(
        { error: "Failed to load conversation" },
        { status: 500 },
      );
    }
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // ---- capacity guard ------------------------------------
    if (agentId !== null) {
      const check = await canAgentTakeConversation(
        conversation.account_id,
        agentId,
      );
      if (!check.allowed) {
        return NextResponse.json(
          {
            error: "Agent has reached their daily assignment limit",
            code: "agent_at_capacity",
            limit: check.limit,
            assignedToday: check.assignedToday,
          },
          { status: 409 },
        );
      }
    }

    const { error: updateErr } = await supabase
      .from("conversations")
      .update({ assigned_agent_id: agentId })
      .eq("id", conversationId);

    if (updateErr) {
      console.error("[PATCH /api/conversations/:id/assign] update error:", updateErr);
      return NextResponse.json(
        { error: "Failed to update assignment" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, agentId });
  } catch (err) {
    console.error("[PATCH /api/conversations/:id/assign] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
