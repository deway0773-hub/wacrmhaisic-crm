-- ============================================================
-- 047_operator_is_admin.sql
--
-- Promotes the 'operator' (运营) role to super-admin-equivalent
-- privileges for the settings-class tables.
--
-- Product decision: 运营 staff run the business day to day and
-- need the same administrative reach as the owner over the
-- workspace configuration — pipelines, stages, templates, tags,
-- custom fields, WhatsApp config — plus the ability to manage
-- teammates. The only things that stay owner-only are the
-- irreversible account-level operations (delete account,
-- transfer ownership).
--
-- The existing `is_account_member(account_id, min_role)` helper
-- already understands the 4-tier hierarchy (owner=4 > admin=3 >
-- operator=2 > agent=1) from migration 046, so "operator or
-- higher" is simply `is_account_member(account_id, 'operator')`.
-- No new helper is required — we just re-point the settings-class
-- policies at the 'operator' floor instead of 'admin'.
--
-- Scope of this migration:
--   1. pipelines         — insert / update / delete → operator+
--   2. pipeline_stages   — modify (ALL)             → operator+
--   3. message_templates — insert / update / delete → operator+
--   4. custom_fields     — insert / update / delete → operator+
--   5. whatsapp_config   — insert / update / delete → operator+
--   6. tags              — insert / update / delete → operator+
--   7. set_member_role / remove_account_member RPCs → operator+
--
-- SELECT policies are untouched — every member already reads
-- these tables.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- pipelines (settings-class) --------------------------------
DROP POLICY IF EXISTS pipelines_insert ON pipelines;
DROP POLICY IF EXISTS pipelines_update ON pipelines;
DROP POLICY IF EXISTS pipelines_delete ON pipelines;

CREATE POLICY pipelines_insert ON pipelines
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY pipelines_update ON pipelines
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY pipelines_delete ON pipelines
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- pipeline_stages (child of pipelines) ----------------------
DROP POLICY IF EXISTS pipeline_stages_modify ON pipeline_stages;

CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_stages.pipeline_id
      AND is_account_member(p.account_id, 'operator')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_stages.pipeline_id
      AND is_account_member(p.account_id, 'operator')
  )
);

-- ---- message_templates (settings-class) ------------------------
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
DROP POLICY IF EXISTS message_templates_update ON message_templates;
DROP POLICY IF EXISTS message_templates_delete ON message_templates;

CREATE POLICY message_templates_insert ON message_templates
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY message_templates_update ON message_templates
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY message_templates_delete ON message_templates
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- custom_fields (settings-class) ----------------------------
DROP POLICY IF EXISTS custom_fields_insert ON custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;

CREATE POLICY custom_fields_insert ON custom_fields
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY custom_fields_update ON custom_fields
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY custom_fields_delete ON custom_fields
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- whatsapp_config (settings-class) --------------------------
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_config;

CREATE POLICY whatsapp_config_insert ON whatsapp_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY whatsapp_config_update ON whatsapp_config
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY whatsapp_config_delete ON whatsapp_config
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- tags (settings-class) -------------------------------------
DROP POLICY IF EXISTS tags_insert ON tags;
DROP POLICY IF EXISTS tags_update ON tags;
DROP POLICY IF EXISTS tags_delete ON tags;

CREATE POLICY tags_insert ON tags
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY tags_update ON tags
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY tags_delete ON tags
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ============================================================
-- Member management RPCs — allow operator+ to change roles and
-- remove members, matching the elevated frontend capability.
--
-- Both RPCs currently gate on `v_caller_role NOT IN ('owner',
-- 'admin')`. Recreate them with 'operator' added so the
-- server-side check matches the UI. Everything else (self-guard,
-- owner-row guard, cross-account guard) is unchanged.
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be operator+ (owner / admin / operator).
  IF v_caller_role NOT IN ('owner', 'admin', 'operator') THEN
    RAISE EXCEPTION 'This action requires the operator role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be operator+ (owner / admin / operator).
  IF v_caller_role NOT IN ('owner', 'admin', 'operator') THEN
    RAISE EXCEPTION 'This action requires the operator role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;
