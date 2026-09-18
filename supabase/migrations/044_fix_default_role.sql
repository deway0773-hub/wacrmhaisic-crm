-- ============================================================
-- 044_fix_default_role.sql
--
-- Fixes the default value of `profiles.role`.
--
-- Background
--   `001_initial_schema.sql` created `profiles.role TEXT DEFAULT
--   'user'`. That column is the LEGACY free-form role from before
--   account sharing (017) introduced the typed `account_role`
--   enum. It is still read in a few places (the members roster
--   API, the profile settings card), so a brand-new profile that
--   relies on the column default would show up as `user` — a
--   label that is not part of the role vocabulary the app uses
--   (`owner` / `admin` / `agent`).
--
--   The signup trigger `handle_new_user()` (last redefined in
--   017_account_sharing.sql) inserts into `profiles` WITHOUT
--   naming `role`, so every new signup silently picked up the
--   `'user'` default. This migration:
--     1. changes the column default to `'owner'`, and
--     2. redefines `handle_new_user()` to set `role = 'owner'`
--        explicitly, so the value is correct even if the column
--        default is changed again later.
--
--   `001_initial_schema.sql` is intentionally left untouched —
--   migrations are append-only once applied.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. COLUMN DEFAULT
-- ============================================================
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'owner';

-- ============================================================
-- 2. SIGNUP TRIGGER
--
-- Same body as 017_account_sharing.sql, with `role` added to the
-- profiles INSERT. `account_role` stays 'owner' — the two columns
-- must agree for a freshly bootstrapped account owner.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner', 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
