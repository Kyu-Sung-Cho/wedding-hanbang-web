-- Make the Auth deletion boundary executable for active couple/chat users.
--
-- The canonical 2026-02 schema created these three auth.users references with
-- PostgreSQL's default NO ACTION behavior. The account-deletion worker removes
-- Storage before calling Auth delete, so any blocking FK would otherwise leave
-- a partially completed job. Preserve couple/chat history for a surviving
-- partner while anonymizing the deleted user's identifiers.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- SET NULL is executable only when the child columns themselves are nullable.
-- Pin that storage contract explicitly instead of relying on the FK action,
-- which PostgreSQL permits even on a NOT NULL child until delete time.
ALTER TABLE public.couples ALTER COLUMN bride_id DROP NOT NULL;
ALTER TABLE public.couples ALTER COLUMN groom_id DROP NOT NULL;
ALTER TABLE public.chat_messages ALTER COLUMN sender_id DROP NOT NULL;

-- Validate each replacement before dropping its canonical predecessor. Every
-- statement is transactional, so validation or the final inventory assertion
-- rolls the complete migration back without weakening the existing FKs.
ALTER TABLE public.couples
  DROP CONSTRAINT IF EXISTS couples_bride_id_delete_set_null_fkey;
ALTER TABLE public.couples
  ADD CONSTRAINT couples_bride_id_delete_set_null_fkey
  FOREIGN KEY (bride_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.couples
  VALIDATE CONSTRAINT couples_bride_id_delete_set_null_fkey;
ALTER TABLE public.couples
  DROP CONSTRAINT IF EXISTS couples_bride_id_fkey;
ALTER TABLE public.couples
  RENAME CONSTRAINT couples_bride_id_delete_set_null_fkey
  TO couples_bride_id_fkey;

ALTER TABLE public.couples
  DROP CONSTRAINT IF EXISTS couples_groom_id_delete_set_null_fkey;
ALTER TABLE public.couples
  ADD CONSTRAINT couples_groom_id_delete_set_null_fkey
  FOREIGN KEY (groom_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.couples
  VALIDATE CONSTRAINT couples_groom_id_delete_set_null_fkey;
ALTER TABLE public.couples
  DROP CONSTRAINT IF EXISTS couples_groom_id_fkey;
ALTER TABLE public.couples
  RENAME CONSTRAINT couples_groom_id_delete_set_null_fkey
  TO couples_groom_id_fkey;

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_sender_id_delete_set_null_fkey;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_sender_id_delete_set_null_fkey
  FOREIGN KEY (sender_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.chat_messages
  VALIDATE CONSTRAINT chat_messages_sender_id_delete_set_null_fkey;
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;
ALTER TABLE public.chat_messages
  RENAME CONSTRAINT chat_messages_sender_id_delete_set_null_fkey
  TO chat_messages_sender_id_fkey;

-- Vendor ownership must remain a hard database blocker. The application and
-- prepare RPC can stop an owned-vendor account before Auth deletion, but this
-- explicit RESTRICT constraint is the final race-safe fail-closed boundary.
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_owner_id_delete_restrict_fkey;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_owner_id_delete_restrict_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id)
  ON DELETE RESTRICT
  NOT VALID;
ALTER TABLE public.vendors
  VALIDATE CONSTRAINT vendors_owner_id_delete_restrict_fkey;
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_owner_id_fkey;
ALTER TABLE public.vendors
  RENAME CONSTRAINT vendors_owner_id_delete_restrict_fkey
  TO vendors_owner_id_fkey;

DO $postcondition$
DECLARE
  expected_names text[] := ARRAY[
    'ai_interactions_log_user_id_fkey',
    'amora_actions_created_by_fkey',
    'amora_mediation_acceptances_user_id_fkey',
    'amora_memory_consents_user_id_fkey',
    'amora_memory_jobs_user_id_fkey',
    'amora_memory_settings_enabled_by_fkey',
    'amora_quote_checks_user_id_fkey',
    'chat_messages_sender_id_fkey',
    'chat_summaries_user_id_delete_cascade_fkey',
    'cohort_contracts_user_id_fkey',
    'cohort_member_reports_reported_user_id_fkey',
    'cohort_member_reports_reporter_id_fkey',
    'cohort_members_user_id_fkey',
    'cohort_messages_author_id_fkey',
    'cohort_timeline_events_user_id_fkey',
    'community_achievements_user_id_fkey',
    'community_agent_personas_backing_user_id_fkey',
    'community_bookmarks_user_id_fkey',
    'community_comments_author_id_fkey',
    'community_poll_votes_user_id_fkey',
    'community_posts_author_id_fkey',
    'community_profiles_user_id_fkey',
    'community_reports_reporter_id_fkey',
    'community_streaks_user_id_fkey',
    'community_upload_sessions_user_id_fkey',
    'community_votes_user_id_fkey',
    'community_xp_log_user_id_fkey',
    'couples_bride_id_fkey',
    'couples_groom_id_fkey',
    'customer_events_user_id_fkey',
    'fitting_requests_user_id_fkey',
    'fitting_usage_user_id_fkey',
    'guestbooks_owner_id_fkey',
    'messages_sender_id_fkey',
    'profiles_id_fkey',
    'search_logs_user_id_fkey',
    'submission_verifications_user_id_fkey',
    'user_fitting_photos_user_id_fkey',
    'user_trust_scores_user_id_fkey',
    'vendor_bookings_receipt_verified_by_fkey',
    'vendor_favorites_user_id_fkey',
    'vendor_messages_customer_id_fkey',
    'vendor_photo_likes_user_id_fkey',
    'vendor_reports_reporter_id_fkey',
    'vendor_reviews_customer_id_fkey',
    'vendor_submissions_user_id_fkey',
    'vendor_views_viewer_id_fkey',
    'vendors_owner_id_fkey'
  ]::text[];
  set_null_names text[] := ARRAY[
    'ai_interactions_log_user_id_fkey',
    'amora_actions_created_by_fkey',
    'amora_memory_jobs_user_id_fkey',
    'amora_memory_settings_enabled_by_fkey',
    'amora_quote_checks_user_id_fkey',
    'chat_messages_sender_id_fkey',
    'community_agent_personas_backing_user_id_fkey',
    'couples_bride_id_fkey',
    'couples_groom_id_fkey',
    'customer_events_user_id_fkey',
    'messages_sender_id_fkey',
    'search_logs_user_id_fkey',
    'vendor_bookings_receipt_verified_by_fkey',
    'vendor_reviews_customer_id_fkey',
    'vendor_views_viewer_id_fkey'
  ]::text[];
  nullable_cascade_names text[] := ARRAY[
    'chat_summaries_user_id_delete_cascade_fkey',
    'submission_verifications_user_id_fkey',
    'vendor_reports_reporter_id_fkey',
    'vendor_submissions_user_id_fkey'
  ]::text[];
  total_auth_fk_count bigint;
  compliant_names text[];
BEGIN
  SELECT count(*)
    INTO total_auth_fk_count
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
   WHERE constraint_record.contype = 'f'
     AND constraint_record.confrelid = 'auth.users'::regclass
     AND namespace_record.nspname = 'public';

  SELECT pg_catalog.array_agg(
           constraint_record.conname::text
           ORDER BY constraint_record.conname::text
         )
    INTO compliant_names
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    JOIN pg_catalog.pg_attribute AS column_record
      ON column_record.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[column_record.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[referenced_column.attnum]::smallint[]
   WHERE constraint_record.contype = 'f'
     AND constraint_record.confrelid = 'auth.users'::regclass
     AND namespace_record.nspname = 'public'
     AND referenced_column.attname = 'id'
     AND NOT referenced_column.attisdropped
     AND NOT column_record.attisdropped
     AND constraint_record.convalidated
     AND NOT constraint_record.condeferrable
     AND NOT constraint_record.condeferred
     AND constraint_record.confmatchtype = 's'
     AND constraint_record.confupdtype = 'a'
     AND constraint_record.conname = CASE
       WHEN relation_record.relname = 'chat_summaries'
        AND column_record.attname = 'user_id'
         THEN 'chat_summaries_user_id_delete_cascade_fkey'
       ELSE relation_record.relname || '_' || column_record.attname || '_fkey'
     END
     AND (
       (
         constraint_record.conname = ANY(set_null_names)
         AND constraint_record.confdeltype = 'n'
         AND NOT column_record.attnotnull
       )
       OR (
         constraint_record.conname = 'vendors_owner_id_fkey'
         AND constraint_record.confdeltype = 'r'
         AND NOT column_record.attnotnull
       )
       OR (
         constraint_record.conname = ANY(nullable_cascade_names)
         AND constraint_record.confdeltype = 'c'
         AND NOT column_record.attnotnull
       )
       OR (
         NOT (constraint_record.conname = ANY(set_null_names))
         AND constraint_record.conname <> 'vendors_owner_id_fkey'
         AND NOT (constraint_record.conname = ANY(nullable_cascade_names))
         AND constraint_record.confdeltype = 'c'
         AND column_record.attnotnull
       )
     );

  IF total_auth_fk_count <> pg_catalog.cardinality(expected_names)
     OR compliant_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_AUTH_FK_INVENTORY_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_record
    WHERE procedure_record.oid = pg_catalog.to_regprocedure(
      'public.prepare_account_deletion_auth_delete(uuid,uuid)'
    )
      AND procedure_record.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
      AND procedure_record.proconfig IS NOT DISTINCT FROM
        ARRAY['search_path=""']::text[]
      AND pg_catalog.md5(procedure_record.prosrc) =
        '02eb24e9ed4178f0034ac1cc36940775'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_VENDOR_REVIEW_GATE_INVALID';
  END IF;
END;
$postcondition$;

COMMENT ON CONSTRAINT couples_bride_id_fkey ON public.couples IS
  'Anonymizes the deleted Auth user while preserving a surviving couple.';
COMMENT ON CONSTRAINT couples_groom_id_fkey ON public.couples IS
  'Anonymizes the deleted Auth user while preserving a surviving couple.';
COMMENT ON CONSTRAINT chat_messages_sender_id_fkey ON public.chat_messages IS
  'Anonymizes retained couple chat history when its sender deletes Auth.';
COMMENT ON CONSTRAINT vendors_owner_id_fkey ON public.vendors IS
  'Blocks Auth deletion until vendor ownership and legal-retention review completes.';
