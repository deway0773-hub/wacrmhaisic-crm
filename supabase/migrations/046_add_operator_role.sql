-- ============================================================
-- 046_add_operator_role.sql
--
-- Adds a fourth account role, 'operator' (运营), between 'admin'
-- and 'agent'.
--
-- The product decision is that operations staff need to work the
-- inbox, contacts, pipelines and broadcasts — but must NOT be
-- able to administer the account (invite/remove members, change
-- roles, edit account-wide settings). That is exactly the gap
-- between 'admin' and 'agent', so a new tier is inserted there.
--
--   1. The account_role_enum type is recreated with 'operator'.
--   2. is_account_member()'s CASE expression is updated to the
--      new 4-tier hierarchy (owner=4 > admin=3 > operator=2 >
--      agent=1).
--   3. Dependent policies and functions (peek_invitation,
--      redeem_invitation, set_member_role) are recreated against
--      the new type.
--
-- The rank numbers shift up by one (owner 3→4, admin 2→3,
-- agent 1→2) to keep the mapping dense. This is safe because the
-- numbers are only ever compared to each other inside the helper.
--
-- NOTE: unlike 041 there is no data migration step — no existing
-- row can hold 'operator' yet, so nothing needs promoting.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. SNAPSHOT DEPENDENT POLICIES
--
-- `is_account_member(UUID, account_role_enum)` takes the enum as
-- a parameter type, so it is a hard dependency of the old type.
-- Renaming the type would leave the function bound to
-- `account_role_enum_old`, and the ALTER COLUMN ... USING casts
-- below would then fail with "operator does not exist:
-- account_role_enum <> account_role_enum_old".
--
-- The function must therefore be dropped and recreated against
-- the new type. But ~97 RLS policies depend on it, so dropping
-- it requires dropping and recreating those policies too. We
-- snapshot them here and rebuild them in section 5.
-- ============================================================
CREATE TEMP TABLE _operator_role_policy_snapshot ON COMMIT DROP AS
SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.qual LIKE '%is_account_member%'
   OR p.with_check LIKE '%is_account_member%';

-- ============================================================
-- 2. DROP THE DEPENDENT FUNCTIONS (AND THEIR POLICIES)
--
-- CASCADE removes the ~97 policies captured above. They are
-- recreated in section 5.
--
-- peek_invitation / redeem_invitation are dropped too: they
-- reference `account_invitations%ROWTYPE` and
-- `profiles.account_role`, both of which are bound to the old
-- enum type. They are recreated in section 6.
-- ============================================================
DROP FUNCTION IF EXISTS is_account_member(UUID, account_role_enum) CASCADE;
DROP FUNCTION IF EXISTS public.set_member_role(UUID, account_role_enum);
DROP FUNCTION IF EXISTS public.peek_invitation(TEXT);
DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);

-- ============================================================
-- 3. RECREATE THE ENUM WITH 'operator'
--
-- The `account_invitations_role_check` constraint embeds the enum
-- type in its expression (`role <> 'owner'::account_role_enum`),
-- so it must be dropped before the swap and recreated after —
-- otherwise the retype fails with "operator does not exist:
-- account_role_enum <> account_role_enum_old".
-- ============================================================
ALTER TABLE account_invitations
  DROP CONSTRAINT IF EXISTS account_invitations_role_check;

DO $$
DECLARE
  v_profiles_default TEXT;
  v_invitations_default TEXT;
BEGIN
  -- Only run the swap if the enum does not yet contain 'operator'.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_role_enum'
      AND e.enumlabel = 'operator'
  ) THEN
    -- A column DEFAULT that references the enum type blocks the
    -- retype ("default for column ... cannot be cast automatically
    -- to type account_role_enum"). Capture and drop any defaults
    -- first, then restore them against the new type afterwards.
    SELECT pg_get_expr(d.adbin, d.adrelid)
      INTO v_profiles_default
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON c.oid = d.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'profiles'
       AND a.attname = 'account_role';

    SELECT pg_get_expr(d.adbin, d.adrelid)
      INTO v_invitations_default
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON c.oid = d.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'account_invitations'
       AND a.attname = 'role';

    ALTER TABLE profiles ALTER COLUMN account_role DROP DEFAULT;
    ALTER TABLE account_invitations ALTER COLUMN role DROP DEFAULT;

    ALTER TYPE account_role_enum RENAME TO account_role_enum_old;

    CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'operator', 'agent');

    ALTER TABLE profiles
      ALTER COLUMN account_role TYPE account_role_enum
      USING account_role::text::account_role_enum;

    ALTER TABLE account_invitations
      ALTER COLUMN role TYPE account_role_enum
      USING role::text::account_role_enum;

    DROP TYPE account_role_enum_old;

    -- Restore the defaults against the new enum. The captured
    -- expression is text, so cast it explicitly to the enum type.
    IF v_profiles_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE profiles ALTER COLUMN account_role SET DEFAULT (%s)::account_role_enum',
        v_profiles_default
      );
    END IF;

    IF v_invitations_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE account_invitations ALTER COLUMN role SET DEFAULT (%s)::account_role_enum',
        v_invitations_default
      );
    END IF;
  END IF;
END $$;

-- Recreate the invitation role guard against the new enum.
ALTER TABLE account_invitations
  ADD CONSTRAINT account_invitations_role_check
  CHECK (role <> 'owner'::account_role_enum);

-- ============================================================
-- 4. RECREATE THE MEMBERSHIP HELPER
--
-- New hierarchy: owner=4 > admin=3 > operator=2 > agent=1. The
-- default min_role stays 'agent' (the floor), so every
-- `is_account_member(account_id)` call site keeps meaning "any
-- member of the account".
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'agent'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'    THEN 4
            WHEN 'admin'    THEN 3
            WHEN 'operator' THEN 2
            WHEN 'agent'    THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'    THEN 4
            WHEN 'admin'    THEN 3
            WHEN 'operator' THEN 2
            WHEN 'agent'    THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- 5. RECREATE THE SNAPSHOTTED POLICIES
--
-- Rebuild each policy verbatim from the snapshot. The stored
-- expressions still say `'agent'::account_role_enum`, which now
-- resolves to the new type — exactly what we want.
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_roles TEXT;
  v_sql TEXT;
BEGIN
  FOR r IN SELECT * FROM _operator_role_policy_snapshot LOOP
    -- pg_policies.roles is a name[]; render it as a comma list.
    SELECT string_agg(quote_ident(role_name), ', ')
      INTO v_roles
      FROM unnest(r.roles) AS role_name;

    v_sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      r.policyname, r.schemaname, r.tablename,
      r.permissive, r.cmd, v_roles
    );

    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', r.qual);
    END IF;

    IF r.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', r.with_check);
    END IF;

    EXECUTE v_sql;
  END LOOP;
END $$;

-- ============================================================
-- 6. RECREATE THE INVITATION RPCs AGAINST THE NEW ENUM
--
-- Dropped in section 2 because their bodies reference the old
-- enum type. Bodies are unchanged from 019_invitation_rpcs.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION public.peek_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
-- `anon` so the /join/<token> page can call this before the user
-- signs in; `authenticated` so the same page works when already
-- signed in (e.g. existing user clicks a forwarded link).
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ============================================================
-- 7. RECREATE set_member_role AGAINST THE NEW ENUM
--
-- Dropped in section 2 because its signature referenced the old
-- type. Body is unchanged from 018_account_member_rpcs.sql — it
-- only ever compares against 'owner' / 'admin', both of which
-- still exist, so no logic change is needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Can't change own role via this endpoint.
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target.
  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  -- Target must be in caller's account.
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Owner role changes go through transfer_account_ownership.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;
