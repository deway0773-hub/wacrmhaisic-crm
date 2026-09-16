-- ============================================================
-- 036_profiles_virtual_members.sql
--
-- Allow profiles rows used as inbox assignees without an auth user.
-- The API still requires an authenticated admin to create them.
-- ============================================================

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT c.conname
    INTO fk_name
  FROM pg_constraint AS c
  JOIN pg_attribute AS a
    ON a.attrelid = c.conrelid
   AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.profiles'::regclass
    AND c.contype = 'f'
    AND a.attname = 'user_id'
    AND c.confrelid = 'auth.users'::regclass
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
