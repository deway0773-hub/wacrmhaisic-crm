-- ============================================================
-- 050_profiles_display_name.sql — explicit display name column
--
-- Why
--   `profiles.full_name` doubles as the *display* name and as the
--   value the profile form writes. Historically some surfaces fell
--   back to the login identifier (`zhengjiabao`) or the synthetic
--   email (`zhengjiabao@local.fake`) when `full_name` was blank,
--   which leaked the account name into the UI.
--
--   This migration adds an explicit `display_name` column so the
--   display identity has a single, unambiguous home. It is
--   back-filled from `full_name` and kept in sync by a trigger, so
--   existing code that only writes `full_name` keeps working.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Back-fill from `full_name` for every row that has no display name
-- yet. `full_name` is NOT NULL, so this always yields a value.
UPDATE profiles
   SET display_name = full_name
 WHERE display_name IS NULL
    OR display_name = '';

-- Keep `display_name` in step with `full_name` whenever a writer
-- only touches `full_name` (the profile form, the signup trigger,
-- the MCP server, …). An explicit `display_name` in the same
-- statement always wins.
CREATE OR REPLACE FUNCTION profiles_sync_display_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.display_name IS NULL OR NEW.display_name = '' THEN
    NEW.display_name := NEW.full_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_display_name ON profiles;
CREATE TRIGGER profiles_sync_display_name
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION profiles_sync_display_name();
