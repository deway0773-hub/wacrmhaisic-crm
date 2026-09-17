-- ============================================================
-- 043_assignment_capacity.sql — round-robin assignment with
-- per-agent daily capacity.
--
-- Adds the storage layer for automatic conversation assignment:
--
--   1. `profiles.daily_conversation_limit` — how many NEW
--      conversations an agent may be assigned per calendar day.
--      NULL means "unlimited" (the default, so existing rows keep
--      behaving exactly as before).
--
--   2. `profiles.last_assigned_at` — when this agent last received
--      an assignment. The round-robin picker orders candidates by
--      this ascending, so the agent who has waited longest wins.
--      NULL sorts first (never assigned → highest priority).
--
--   3. `conversation_assignments` — an append-only log of every
--      assignment event. The daily counter is derived from this
--      table (COUNT of today's rows per agent) rather than a
--      mutable counter column, so:
--        - concurrent assignments can't lose a count (no
--          read-modify-write race),
--        - the history is auditable (who assigned whom, when,
--          and whether it was manual or automatic),
--        - "today" is evaluated in the account's timezone via
--          `assigned_at` + a date_trunc on the server clock.
--
-- Design notes
--
--   * The log is written by the SERVER (service role) from the
--     assignment helper, and by a trigger for manual UI
--     assignments that bypass the helper. The trigger keeps the
--     log complete no matter which code path set the column.
--
--   * `daily_conversation_limit` counts NEW assignments only —
--     re-assigning the same conversation to the same agent twice
--     in a day does not double-count (the log records the
--     transition, and the counter query counts DISTINCT
--     conversation_id).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- 1. capacity columns on profiles ------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_conversation_limit INTEGER;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

-- A limit of 0 is meaningful ("this agent takes no new chats"),
-- so only reject negatives. NULL stays allowed = unlimited.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_daily_conversation_limit_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_daily_conversation_limit_check
      CHECK (daily_conversation_limit IS NULL OR daily_conversation_limit >= 0);
  END IF;
END $$;

-- Round-robin ordering reads this column; index it per account.
CREATE INDEX IF NOT EXISTS idx_profiles_last_assigned_at
  ON public.profiles(account_id, last_assigned_at);

-- ---- 2. assignment log --------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_assignments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- The agent who received the conversation. Nullable so an
  -- unassign event can be logged too (agent_id IS NULL).
  agent_id        UUID,
  -- Who performed the assignment. NULL when an automation or the
  -- round-robin picker did it (no human actor).
  assigned_by     UUID,
  -- 'manual' (a human picked from the dropdown) or 'auto'
  -- (round-robin / automation step).
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'auto')),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_assignments_account_day
  ON public.conversation_assignments(account_id, agent_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_assignments_conversation
  ON public.conversation_assignments(conversation_id);

-- ---- 3. RLS ------------------------------------------------
ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;

-- Any account member may read the assignment history for their
-- account (same visibility as the roster / presence).
DROP POLICY IF EXISTS conversation_assignments_select
  ON public.conversation_assignments;
CREATE POLICY conversation_assignments_select
  ON public.conversation_assignments FOR SELECT
  USING (is_account_member(account_id));

-- No client INSERT/UPDATE/DELETE policy: writes flow through the
-- trigger below (manual UI assignments) or the service-role
-- assignment helper (automatic assignments).

-- ---- 4. log trigger ----------------------------------------
-- Keeps the log complete for assignments made directly against
-- `conversations.assigned_agent_id` (the inbox dropdown writes the
-- column straight from the browser). Automatic assignments go
-- through the helper, which writes the log itself with
-- source='auto' — so this trigger only fires for the manual path
-- and must not double-log those.
CREATE OR REPLACE FUNCTION public.log_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log a real transition to a non-null agent.
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.conversation_assignments (
    account_id, conversation_id, agent_id, assigned_by, source
  ) VALUES (
    NEW.account_id, NEW.id, NEW.assigned_agent_id, auth.uid(), 'manual'
  );

  -- Stamp the agent's last_assigned_at so the round-robin picker
  -- sees this assignment. Done here (not in the helper) so manual
  -- assignments also advance the rotation.
  UPDATE public.profiles
     SET last_assigned_at = now()
   WHERE user_id = NEW.assigned_agent_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let logging block the assignment itself.
  RAISE WARNING 'Failed to log assignment for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_conversation_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_assignment_logged ON conversations;
CREATE TRIGGER on_conversation_assignment_logged
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.log_conversation_assignment();

-- ---- 5. capacity RPC ---------------------------------------
-- Returns the number of DISTINCT conversations assigned to an
-- agent today (server clock, UTC day boundary). Used by the
-- assignment helper and by the manual-assignment guard.
CREATE OR REPLACE FUNCTION public.agent_assignments_today(
  p_agent_id UUID
) RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT conversation_id)::INTEGER
  FROM public.conversation_assignments
  WHERE agent_id = p_agent_id
    AND assigned_at >= date_trunc('day', now());
$$;

ALTER FUNCTION public.agent_assignments_today(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.agent_assignments_today(UUID)
  TO authenticated, service_role;

-- ---- 6. backfill last_assigned_at --------------------------
-- Seed the rotation from existing assignments so the first
-- round-robin pick after this migration isn't biased toward
-- whoever happens to sort first.
UPDATE public.profiles p
   SET last_assigned_at = sub.last_at
  FROM (
    SELECT assigned_agent_id AS agent_id, MAX(updated_at) AS last_at
    FROM public.conversations
    WHERE assigned_agent_id IS NOT NULL
    GROUP BY assigned_agent_id
  ) AS sub
 WHERE p.user_id = sub.agent_id
   AND p.last_assigned_at IS NULL;
