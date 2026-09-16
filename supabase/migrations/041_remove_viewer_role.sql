-- ============================================================
-- 041_remove_viewer_role.sql
--
-- Removes the 'viewer' role from the account-role hierarchy.
--
-- The product decision is that every member of an account is at
-- least an 'agent' (operational access). The read-only 'viewer'
-- tier is gone, so:
--
--   1. Existing rows with account_role = 'viewer' are promoted to
--      'agent' (the new lowest role) so nobody loses access.
--   2. The account_role_enum type is recreated without 'viewer'.
--   3. is_account_member()'s CASE expression and its default
--      min_role are updated to the new 3-tier hierarchy
--      (owner=3 > admin=2 > agent=1).
--
-- The rank numbers shift down by one (owner 4→3, admin 3→2,
-- agent 2→1) to keep the mapping dense. This is safe because the
-- numbers are only ever compared to each other inside the helper.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. MIGRATE EXISTING VIEWER ROWS
--
-- Must run BEFORE the enum is recreated, otherwise the ALTER
-- COLUMN below would fail on the now-invalid 'viewer' value.
-- ============================================================
UPDATE profiles
  SET account_role = 'agent'
  WHERE account_role = 'viewer';

UPDATE account_invitations
  SET role = 'agent'
  WHERE role = 'viewer';

-- ============================================================
-- 2. SNAPSHOT DEPENDENT POLICIES
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
-- snapshot them here and rebuild them in section 6.
-- ============================================================
CREATE TEMP TABLE _viewer_role_policy_snapshot ON COMMIT DROP AS
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
-- 3. DROP THE DEPENDENT FUNCTIONS (AND THEIR POLICIES)
--
-- CASCADE removes the ~97 policies captured above. They are
-- recreated in section 6.
-- ============================================================
DROP FUNCTION IF EXISTS is_account_member(UUID, account_role_enum) CASCADE;
DROP FUNCTION IF EXISTS public.set_member_role(UUID, account_role_enum);

-- ============================================================
-- 4. RECREATE THE ENUM WITHOUT 'viewer'
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
  -- Only run the swap if the old enum still contains 'viewer'.
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_role_enum'
      AND e.enumlabel = 'viewer'
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

    CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent');

    ALTER TABLE profiles
      ALTER COLUMN account_role TYPE account_role_enum
      USING account_role::text::account_role_enum;

    ALTER TABLE account_invitations
      ALTER COLUMN role TYPE account_role_enum
      USING role::text::account_role_enum;

    DROP TYPE account_role_enum_old;

    -- Restore the defaults against the new enum. Any default that
    -- referenced the removed 'viewer' label is rewritten to 'agent'
    -- (the new floor) so the column stays valid. The captured
    -- expression is text, so cast it explicitly to the enum type.
    IF v_profiles_default IS NOT NULL THEN
      v_profiles_default := replace(v_profiles_default, '''viewer''', '''agent''');
      EXECUTE format(
        'ALTER TABLE profiles ALTER COLUMN account_role SET DEFAULT (%s)::account_role_enum',
        v_profiles_default
      );
    END IF;

    IF v_invitations_default IS NOT NULL THEN
      v_invitations_default := replace(v_invitations_default, '''viewer''', '''agent''');
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
-- 5. RECREATE THE MEMBERSHIP HELPER
--
-- New hierarchy: owner=3 > admin=2 > agent=1. The default
-- min_role moves from 'viewer' to 'agent' (the new floor), so
-- every `is_account_member(account_id)` call site keeps meaning
-- "any member of the account".
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
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'agent'  THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'agent'  THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- 6. RECREATE THE SNAPSHOTTED POLICIES
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
  FOR r IN SELECT * FROM _viewer_role_policy_snapshot LOOP
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
-- 7. RECREATE set_member_role AGAINST THE NEW ENUM
--
-- Dropped in section 3 because its signature referenced the old
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

-- ============================================================
-- 8. FINAL SAFETY SWEEP (idempotent)
--
-- Belt-and-braces: re-run the viewer→agent promotion in case any
-- row was inserted between section 1 and the enum swap above.
-- ============================================================
UPDATE profiles SET account_role = 'agent' WHERE account_role::text = 'viewer';
UPDATE account_invitations SET role = 'agent' WHERE role::text = 'viewer';