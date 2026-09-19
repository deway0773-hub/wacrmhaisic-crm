// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents see
// a read-only roster too).
//
// Virtual members (profiles rows with `user_id IS NULL`, created
// as inbox/pipeline assignees without a login) are EXCLUDED from
// this roster by default — they are not real teammates. Pass
// `?includeVirtual=1` to include them (used by pickers that assign
// work to them, e.g. the AI handoff target). They always stay in
// the database so assignment pickers keep working.
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  daily_conversation_limit: number | null;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine the caller's role so we can decide whether to
    // include the sensitive `email` field. Agents get names only.
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const callerRole = callerProfile?.role ?? "agent";
    const canSeeEmail = callerRole === "owner";

    const includeVirtual =
      new URL(request.url).searchParams.get("includeVirtual") === "1";

    let query = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!includeVirtual) {
      query = query.not("user_id", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    // Today's assignment counts, keyed by agent user_id. Derived from
    // the append-only log (migration 043) so it matches exactly what
    // the round-robin picker sees. Counts DISTINCT conversations so a
    // re-assignment doesn't inflate the number.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: todayRows } = await supabase
      .from("conversation_assignments")
      .select("agent_id, conversation_id")
      .gte("assigned_at", startOfDay.toISOString());

    const seenByAgent = new Map<string, Set<string>>();
    for (const row of todayRows ?? []) {
      if (!row.agent_id) continue;
      let set = seenByAgent.get(row.agent_id);
      if (!set) {
        set = new Set();
        seenByAgent.set(row.agent_id, set);
      }
      set.add(row.conversation_id);
    }
    const assignedToday = new Map<string, number>();
    for (const [agentId, set] of seenByAgent) {
      assignedToday.set(agentId, set.size);
    }

    const members = (data as ProfileRow[]).map((row) => ({
      id: row.id,
      user_id: row.user_id ?? row.id,
      full_name: row.full_name ?? "",
      // Email is owner-only; everyone else sees names only.
      email: canSeeEmail ? row.email : null,
      avatar_url: row.avatar_url,
      role: row.role === "owner" || row.role === "operator" || row.role === "agent"
        ? row.role
        : "agent",
      joined_at: row.created_at,
      // Daily new-conversation cap (null = unlimited) and how many
      // the agent has already taken today. The inbox uses these to
      // show "X/N today" and to disable capped agents in the
      // assign dropdown.
      daily_conversation_limit: row.daily_conversation_limit ?? null,
      assigned_today: assignedToday.get(row.user_id) ?? 0,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    console.error("[GET /api/account/members] unexpected error:", err);
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }
}
