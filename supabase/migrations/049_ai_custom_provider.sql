-- ============================================================
-- 049_ai_custom_provider.sql — custom OpenAI-compatible provider
--
-- Adds support for a third AI provider: `custom`, an OpenAI-compatible
-- endpoint (DeepSeek, Moonshot, Together, a self-hosted gateway, …).
--
-- Changes
--   - `ai_configs.base_url` — the endpoint root for the `custom`
--     provider, e.g. `https://api.deepseek.com` or
--     `https://api.moonshot.cn/v1`. The chat adapter appends
--     `/chat/completions`. NULL for the built-in openai / anthropic
--     providers (they use their hard-coded URLs).
--   - Widen the `provider` CHECK constraint to allow `'custom'`.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS base_url text;

-- The original CHECK was declared inline in 029, so Postgres named it
-- `ai_configs_provider_check`. Drop it (if present) and re-add with the
-- widened value set.
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'custom'));
