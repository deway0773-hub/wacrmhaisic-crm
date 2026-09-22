-- ============================================================
-- 048_ai_configs_operator.sql
--
-- Completes the operator elevation started in 047_operator_is_admin.sql.
--
-- 047 promoted the 'operator' (运营) role to super-admin-equivalent
-- privileges for the settings-class tables, but it MISSED the AI
-- configuration tables. As a result an operator could open the
-- /agents → 设置 tab (the API route already allows `requireRole('operator')`)
-- but the underlying RLS still required 'admin' for INSERT / UPDATE /
-- DELETE, so saving the AI config silently failed at the database layer.
--
-- This migration re-points the write policies on:
--   1. ai_configs            — insert / update / delete → operator+
--   2. ai_knowledge_documents — insert / update / delete → operator+
--   3. ai_knowledge_chunks    — insert / update / delete → operator+
--
-- SELECT policies are untouched — every member already reads these
-- tables via `is_account_member(account_id)` (the 'agent' floor).
--
-- The `is_account_member(account_id, min_role)` helper already
-- understands the 4-tier hierarchy (owner=4 > admin=3 > operator=2 >
-- agent=1) from migration 046, so "operator or higher" is simply
-- `is_account_member(account_id, 'operator')`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- ai_configs (settings-class) -------------------------------
DROP POLICY IF EXISTS ai_configs_insert ON ai_configs;
DROP POLICY IF EXISTS ai_configs_update ON ai_configs;
DROP POLICY IF EXISTS ai_configs_delete ON ai_configs;

CREATE POLICY ai_configs_insert ON ai_configs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY ai_configs_update ON ai_configs
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY ai_configs_delete ON ai_configs
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- ai_knowledge_documents (settings-class) -------------------
DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents
  FOR DELETE USING (is_account_member(account_id, 'operator'));

-- ---- ai_knowledge_chunks (child of ai_knowledge_documents) -----
DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_update ON ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_insert ON ai_knowledge_chunks
  FOR INSERT WITH CHECK (is_account_member(account_id, 'operator'));
CREATE POLICY ai_knowledge_chunks_update ON ai_knowledge_chunks
  FOR UPDATE USING (is_account_member(account_id, 'operator'));
CREATE POLICY ai_knowledge_chunks_delete ON ai_knowledge_chunks
  FOR DELETE USING (is_account_member(account_id, 'operator'));
