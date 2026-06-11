-- Decouple the Pre-Phone Email Sequence from Ollama (idempotent, safe to re-run).
--
-- Why: the Pre-Phone workflowVersion had an HTTP_REQUEST step ("AI: Personalize
-- opener via Ollama", id b1000001-0006-...0006) sitting between its IF_ELSE and
-- Touch 1. Twenty's engine does NOT honour continueOnFailure:true on
-- HTTP_REQUEST steps, so when the Ollama model was wiped (2026-06-10) the whole
-- enrollment failed and ZERO approvals were created. A slow CPU-only Ollama
-- could time out and kill enrollment the same way.
--
-- This migration makes enrollment pure CREATE_RECORD with no external call:
--   1. Rewire the IF_ELSE branchYes nextStepIds from [aiOpener] to [Touch 1].
--   2. Remove the aiOpener HTTP_REQUEST step from the steps array.
--   3. Strip the "{{<aiStepId>.response}}" line (and its trailing blank line)
--      from Touches 4, 5, 6 email bodies.
-- The AI opener is now generated lazily, best-effort, by the Command Center
-- backend during reconcile() (see tools/command-center/server.js).
--
-- Run: docker exec -i twenty-db-1 psql -U twenty -d default < decouple-prephone-from-ollama.sql
-- (or docker cp + psql -f). Idempotent: re-running after success is a no-op.

DO $$
DECLARE
  ws_schema     TEXT := 'workspace_arem42qbur9jiys0e9bx25k0f';
  version_id    TEXT := 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
  ai_step_id    TEXT := 'b1000001-0006-4000-8000-000000000006';
  touch1_id     TEXT := 'b1000001-1001-4000-8000-000000000001';
  steps_json    JSONB;
  new_steps     JSONB;
  marker        TEXT;
  ai_present    BOOLEAN;
BEGIN
  EXECUTE format('SELECT steps FROM %I."workflowVersion" WHERE id = %L', ws_schema, version_id)
    INTO steps_json;

  IF steps_json IS NULL THEN
    RAISE EXCEPTION 'Pre-Phone workflowVersion % not found in %', version_id, ws_schema;
  END IF;

  -- Is the AI step still present? If not, this migration already ran.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(steps_json) e WHERE e->>'id' = ai_step_id
  ) INTO ai_present;

  IF NOT ai_present THEN
    RAISE NOTICE 'AI step % already removed — nothing to do (idempotent no-op).', ai_step_id;
    RETURN;
  END IF;

  marker := '{{' || ai_step_id || '.response}}';

  -- Step 1+2+3 in one rebuild: iterate the array, drop the AI step, rewire the
  -- IF_ELSE branchYes, and clean the touch 4/5/6 bodies.
  SELECT jsonb_agg(
    CASE
      -- IF_ELSE: replace any branch nextStepIds entry equal to the AI step with Touch 1.
      WHEN elem->>'type' = 'IF_ELSE' THEN
        jsonb_set(
          elem,
          '{settings,input,branches}',
          (
            SELECT jsonb_agg(
              CASE
                WHEN br->'nextStepIds' @> to_jsonb(ai_step_id) THEN
                  jsonb_set(
                    br,
                    '{nextStepIds}',
                    (
                      SELECT jsonb_agg(
                        CASE WHEN nid = to_jsonb(ai_step_id) THEN to_jsonb(touch1_id) ELSE nid END
                      )
                      FROM jsonb_array_elements(br->'nextStepIds') nid
                    )
                  )
                ELSE br
              END
            )
            FROM jsonb_array_elements(elem->'settings'->'input'->'branches') br
          )
        )
      -- Touches 4/5/6: strip the AI marker line + trailing blank line from emailBody.
      WHEN elem->>'id' IN (
             'b1000001-1004-4000-8000-000000000004',
             'b1000001-1005-4000-8000-000000000005',
             'b1000001-1006-4000-8000-000000000006'
           ) THEN
        jsonb_set(
          elem,
          '{settings,input,objectRecord,emailBody}',
          to_jsonb(
            -- Remove "marker\n\n" first (the greeting case), then any bare marker
            -- left over, so the result is "Hi <first>,\n\n<rest>" with no double-strip.
            replace(
              regexp_replace(
                elem->'settings'->'input'->'objectRecord'->>'emailBody',
                regexp_replace(marker, '([\.\*\+\?\^\$\{\}\(\)\|\[\]\\])', '\\\1', 'g') || E'\\n\\n',
                '',
                'g'
              ),
              marker,
              ''
            )
          )
        )
      ELSE elem
    END
    ORDER BY ord
  )
  INTO new_steps
  FROM jsonb_array_elements(steps_json) WITH ORDINALITY AS t(elem, ord)
  WHERE elem->>'id' <> ai_step_id;  -- drop the AI step entirely

  EXECUTE format('UPDATE %I."workflowVersion" SET steps = %L::jsonb WHERE id = %L',
                 ws_schema, new_steps::text, version_id);

  RAISE NOTICE 'Pre-Phone decoupled from Ollama: AI step removed, branch rewired to Touch 1, touches 4-6 cleaned.';
END $$;
