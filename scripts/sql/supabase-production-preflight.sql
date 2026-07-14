-- Read-only production release gate. The ship script parses this single JSON
-- row and refuses any schema/data write while a hard blocker remains.
WITH orphan_slots AS (
  SELECT c.id AS couple_id, c.bride_id AS user_id, 'bride_private'::text AS visibility
  FROM public.couples c
  LEFT JOIN public.profiles p
    ON p.id = c.bride_id AND p.couple_id = c.id AND p.role::text = 'bride'
   AND (to_jsonb(p)->>'account_deleting_at') IS NULL
  WHERE c.bride_id IS NOT NULL AND p.id IS NULL
  UNION ALL
  SELECT c.id, c.groom_id, 'groom_private'
  FROM public.couples c
  LEFT JOIN public.profiles p
    ON p.id = c.groom_id AND p.couple_id = c.id AND p.role::text = 'groom'
   AND (to_jsonb(p)->>'account_deleting_at') IS NULL
  WHERE c.groom_id IS NOT NULL AND p.id IS NULL
), inconsistent AS (
  SELECT p.id AS user_id, p.couple_id
  FROM public.profiles p
  LEFT JOIN public.couples c ON c.id = p.couple_id
  WHERE p.couple_id IS NOT NULL
    AND (
      (to_jsonb(p)->>'account_deleting_at') IS NOT NULL
      OR NOT coalesce(
        (p.role::text = 'bride' AND c.bride_id = p.id)
        OR (p.role::text = 'groom' AND c.groom_id = p.id),
        false
      )
    )
), missing_scopes AS (
  SELECT c.id AS couple_id, 'bride_private'::text AS visibility
  FROM public.couples c
  LEFT JOIN public.profiles p
    ON p.id = c.bride_id AND p.couple_id = c.id AND p.role::text = 'bride'
   AND (to_jsonb(p)->>'account_deleting_at') IS NULL
  WHERE p.id IS NULL
  UNION ALL
  SELECT c.id, 'groom_private'
  FROM public.couples c
  LEFT JOIN public.profiles p
    ON p.id = c.groom_id AND p.couple_id = c.id AND p.role::text = 'groom'
   AND (to_jsonb(p)->>'account_deleting_at') IS NULL
  WHERE p.id IS NULL
), tainted_scopes AS (
  SELECT s.couple_id, s.visibility
  FROM missing_scopes s
  WHERE EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.couple_id = s.couple_id AND m.visibility::text = s.visibility
  ) OR EXISTS (
    SELECT 1 FROM public.ai_interactions_log l
    WHERE l.couple_id = s.couple_id AND l.metadata->>'visibility' = s.visibility
  ) OR EXISTS (
    SELECT 1 FROM public.chat_summaries x
    WHERE x.couple_id = s.couple_id AND x.visibility::text = s.visibility
  ) OR EXISTS (
    SELECT 1 FROM public.decision_nodes x
    WHERE x.couple_id = s.couple_id AND x.visibility::text = s.visibility
  ) OR EXISTS (
    SELECT 1 FROM public.amora_couple_profiles x
    WHERE x.couple_id = s.couple_id AND x.visibility::text = s.visibility
  )
  UNION
  SELECT DISTINCT m.couple_id, m.visibility::text
  FROM public.chat_messages m
  WHERE m.sender_id IS NOT NULL
    AND m.visibility::text IN ('bride_private', 'groom_private')
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.couples c ON c.id = p.couple_id
      WHERE p.id = m.sender_id AND p.couple_id = m.couple_id
        AND (to_jsonb(p)->>'account_deleting_at') IS NULL
        AND (
          (m.visibility::text = 'bride_private' AND p.role::text = 'bride' AND c.bride_id = p.id)
          OR (m.visibility::text = 'groom_private' AND p.role::text = 'groom' AND c.groom_id = p.id)
        )
    )
  UNION
  SELECT DISTINCT m.couple_id, m.visibility::text
  FROM public.chat_messages m
  WHERE m.sender_id IS NULL
    AND m.visibility::text IN ('bride_private', 'groom_private')
    AND (
      to_jsonb(m)->>'role' = 'user'
      OR to_jsonb(m)->>'sender_type' IN ('bride', 'groom')
      OR to_jsonb(m)->>'sender_role' IN ('bride', 'groom')
    )
), amora_metrics AS (
  SELECT
    (SELECT count(*) FROM orphan_slots) AS orphan,
    (SELECT count(*) FROM inconsistent) AS inconsistent,
    (SELECT count(*) FROM tainted_scopes) AS private_scopes,
    (SELECT count(*)
     FROM public.chat_messages m
     LEFT JOIN public.couples c ON c.id = m.couple_id
     WHERE m.visibility::text = 'shared'
       AND m.sender_id IS NOT NULL
       AND m.sender_id IS DISTINCT FROM c.bride_id
       AND m.sender_id IS DISTINCT FROM c.groom_id) AS stale_shared,
    (SELECT count(*)
     FROM public.chat_messages m
     WHERE m.visibility::text = 'shared'
       AND m.sender_id IS NULL
       AND (
         to_jsonb(m)->>'role' = 'user'
         OR to_jsonb(m)->>'sender_type' IN ('bride', 'groom')
         OR to_jsonb(m)->>'sender_role' IN ('bride', 'groom')
       )
       AND NOT (
         coalesce((to_jsonb(m)->'metadata')->>'membership_reset', 'false') = 'true'
         OR coalesce((to_jsonb(m)->'metadata')->>'orphan_membership_repaired', 'false') = 'true'
         OR coalesce((to_jsonb(m)->'metadata')->>'membership_repaired', 'false') = 'true'
       )) AS legacy_null_sender_shared,
    (SELECT count(*)
     FROM public.ai_interactions_log l
     WHERE l.interaction_type = 'chat_turn'
       AND l.metadata->>'visibility' IS NULL
       AND (l.user_input IS NOT NULL OR l.ai_output IS NOT NULL
         OR l.tool_input IS NOT NULL OR l.tool_output IS NOT NULL)) AS legacy_payloads,
    (SELECT count(*)
     FROM public.ai_interactions_log l
     WHERE l.interaction_type = 'chat_turn'
       AND l.user_id IS NULL AND l.couple_id IS NOT NULL
       AND (
         (l.user_input IS NOT NULL AND l.user_input !~ '^\[redacted_')
         OR (l.ai_output IS NOT NULL AND l.ai_output !~ '^\[redacted_')
         OR l.tool_input IS NOT NULL OR l.tool_output IS NOT NULL
         OR (l.error_message IS NOT NULL AND l.error_message !~ '^\[redacted_')
       )) AS detached_raw_audits,
    ((SELECT count(*)
      FROM public.ai_interactions_log l
      JOIN public.profiles p ON p.couple_id = l.couple_id
      WHERE (to_jsonb(p)->>'private_chat_cleared_at') IS NOT NULL
        AND (
          l.metadata->>'visibility' = CASE
            WHEN p.role::text = 'bride' THEN 'bride_private'
            WHEN p.role::text = 'groom' THEN 'groom_private'
          END
          OR (l.user_id = p.id AND l.metadata->>'endpoint' IN (
            'chat/summarize', 'chat/extract-decision',
            'chat/classify-excavation', 'chat/amora-profile'
          ))
        ))
      + (SELECT count(*) FROM public.chat_summaries x
         JOIN public.profiles p ON p.couple_id = x.couple_id
         WHERE (to_jsonb(p)->>'private_chat_cleared_at') IS NOT NULL
           AND x.visibility::text = CASE
             WHEN p.role::text = 'bride' THEN 'bride_private'
             WHEN p.role::text = 'groom' THEN 'groom_private'
           END)
      + (SELECT count(*) FROM public.decision_nodes x
         JOIN public.profiles p ON p.couple_id = x.couple_id
         WHERE (to_jsonb(p)->>'private_chat_cleared_at') IS NOT NULL
           AND x.visibility::text = CASE
             WHEN p.role::text = 'bride' THEN 'bride_private'
             WHEN p.role::text = 'groom' THEN 'groom_private'
           END)
      + (SELECT count(*) FROM public.amora_couple_profiles x
         JOIN public.profiles p ON p.couple_id = x.couple_id
         WHERE (to_jsonb(p)->>'private_chat_cleared_at') IS NOT NULL
           AND x.visibility::text = CASE
             WHEN p.role::text = 'bride' THEN 'bride_private'
             WHEN p.role::text = 'groom' THEN 'groom_private'
           END)) AS private_clear_artifacts,
    ((SELECT count(*) FROM public.chat_summaries
      WHERE visibility::text IN ('bride_private', 'groom_private'))
      + (SELECT count(*) FROM public.decision_nodes
         WHERE visibility::text IN ('bride_private', 'groom_private'))
      + (SELECT count(*) FROM public.amora_couple_profiles
         WHERE visibility::text IN ('bride_private', 'groom_private'))) AS unproven_private_derived,
    (SELECT count(*)
     FROM public.chat_feedback f
     WHERE f.message_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.chat_messages m WHERE m.id::text = f.message_id
       )) AS orphan_feedback,
    (SELECT count(*)
     FROM public.ai_interactions_log l
     WHERE l.couple_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.couples c WHERE c.id = l.couple_id
       )) AS ai_fk_orphans
), profile_inventory AS (
  SELECT p.id,
    2 + (SELECT count(*) FROM public.guestbooks g WHERE g.owner_id = p.id)
    + CASE WHEN (
        (p.role::text = 'bride' AND c.bride_id = p.id)
        OR (p.role::text = 'groom' AND c.groom_id = p.id)
      ) THEN 1 ELSE 0 END AS scope_count
  FROM public.profiles p
  LEFT JOIN public.couples c ON c.id = p.couple_id
), storage_groups AS (
  SELECT bucket_id, (storage.foldername(name))[1] AS prefix, count(*) AS object_count
  FROM storage.objects
  WHERE bucket_id IN (
    'community-images', 'community-videos', 'guestbook-uploads',
    'invitation-photos', 'chat-image'
  )
  GROUP BY 1, 2
), owned_storage_groups AS (
  SELECT lower(owner_id) AS owner_identity, count(*) AS object_count
  FROM storage.objects
  WHERE owner_id ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY lower(owner_id)
), post_rank AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY reporter_id, post_id
           ORDER BY created_at ASC NULLS LAST, id
         ) AS rn
  FROM public.community_reports
  WHERE post_id IS NOT NULL
), after_post AS (
  SELECT r.*
  FROM public.community_reports r
  WHERE NOT EXISTS (SELECT 1 FROM post_rank p WHERE p.id = r.id AND p.rn > 1)
), comment_rank AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY reporter_id, comment_id
           ORDER BY created_at ASC NULLS LAST, id
         ) AS rn
  FROM after_post
  WHERE comment_id IS NOT NULL
), report_delete_ids AS (
  SELECT id FROM post_rank WHERE rn > 1
  UNION
  SELECT id FROM comment_rank WHERE rn > 1
), prereg_before_retention AS (
  SELECT created_at,
    nullif(to_jsonb(p)->>'expires_at', '')::timestamptz AS old_exp,
    CASE
      -- 20260711135000 runs before 20260711141000. Model that first
      -- backfill so the ACK inventory reflects the actual sequential result.
      WHEN nullif(to_jsonb(p)->>'expires_at', '') IS NULL THEN least(
        coalesce(created_at + interval '180 days', now() + interval '30 days'),
        now() + interval '30 days'
      )
      ELSE nullif(to_jsonb(p)->>'expires_at', '')::timestamptz
    END AS after_consent_exp
  FROM public.preregistrations p
), prereg AS (
  SELECT created_at, old_exp, after_consent_exp,
    least(
      coalesce(after_consent_exp, coalesce(created_at, now()) + interval '180 days'),
      coalesce(created_at, now()) + interval '180 days'
    ) AS new_exp
  FROM prereg_before_retention
), survey AS (
  SELECT created_at,
    nullif(to_jsonb(s)->>'expires_at', '')::timestamptz AS old_exp,
    least(
      coalesce(
        nullif(to_jsonb(s)->>'expires_at', '')::timestamptz,
        coalesce(created_at, now()) + interval '365 days'
      ),
      coalesce(created_at, now()) + interval '365 days'
    ) AS new_exp,
    q23_contact,
    user_agent
  FROM public.customer_survey_responses s
), required_dynamic_columns(
  contract_name, table_name, column_name, data_type, not_null
) AS (
  VALUES
    ('wedding_base', 'wedding_code_responses', 'id', 'uuid', true),
    ('wedding_base', 'wedding_code_responses', 'created_at', 'timestamp with time zone', true),
    ('wedding_base', 'wedding_code_responses', 'form_version', 'text', true),
    ('wedding_base', 'wedding_code_responses', 'consent_at', 'timestamp with time zone', true),
    ('wedding_base', 'wedding_code_responses', 'participant_stage', 'text', true),
    ('wedding_base', 'wedding_code_responses', 'answering_mode', 'text', true),
    ('wedding_base', 'wedding_code_responses', 'quote_status', 'text', true),
    ('wedding_base', 'wedding_code_responses', 'parent_involvement', 'text', true),
    ('wedding_base', 'wedding_code_responses', 'biggest_concern', 'text[]', true),
    ('wedding_base', 'wedding_code_responses', 'biggest_concern_other', 'text', false),
    ('wedding_base', 'wedding_code_responses', 'answers', 'jsonb', true),
    ('wedding_base', 'wedding_code_responses', 'stage_flags', 'jsonb', true),
    ('wedding_base', 'wedding_code_responses', 'feedback', 'jsonb', true),
    ('wedding_base', 'wedding_code_responses', 'cta_interest', 'jsonb', true),
    ('wedding_base', 'wedding_code_responses', 'free_text', 'jsonb', true),
    ('wedding_base', 'wedding_code_responses', 'duration_ms', 'integer', false),
    ('wedding_base', 'wedding_code_responses', 'utm_source', 'text', false),
    ('wedding_base', 'wedding_code_responses', 'utm_medium', 'text', false),
    ('wedding_base', 'wedding_code_responses', 'utm_campaign', 'text', false),
    ('wedding_base', 'wedding_code_responses', 'utm_content', 'text', false),
    ('wedding_couple_token', 'wedding_code_responses', 'couple_token', 'uuid', false),
    ('wedding_submission_id', 'wedding_code_responses', 'submission_id', 'uuid', false),
    ('wedding_scoring_version', 'wedding_code_responses', 'scoring_version', 'text', false),
    ('amora_claims_base', 'amora_request_claims', 'request_key', 'text', true),
    ('amora_claims_base', 'amora_request_claims', 'request_hash', 'text', true),
    ('amora_claims_base', 'amora_request_claims', 'visibility', 'text', true),
    ('amora_claims_base', 'amora_request_claims', 'status', 'text', true),
    ('amora_claims_base', 'amora_request_claims', 'message_id', 'uuid', false),
    ('amora_claims_base', 'amora_request_claims', 'created_at', 'timestamp with time zone', true),
    ('amora_claims_base', 'amora_request_claims', 'updated_at', 'timestamp with time zone', true),
    ('amora_claim_lease', 'amora_request_claims', 'lease_expires_at', 'timestamp with time zone', true),
    ('amora_lifecycle', 'profiles', 'account_deleting_at', 'timestamp with time zone', false),
    ('amora_lifecycle', 'profiles', 'amora_membership_generation', 'bigint', true),
    ('amora_lifecycle', 'profiles', 'amora_membership_changed_at', 'timestamp with time zone', true),
    ('amora_lifecycle', 'profiles', 'private_chat_deleting_at', 'timestamp with time zone', false),
    ('amora_lifecycle', 'profiles', 'amora_membership_resetting_at', 'timestamp with time zone', false),
    ('amora_lifecycle', 'profiles', 'push_token', 'text', false),
    ('amora_lifecycle', 'couples', 'amora_shared_resetting_at', 'timestamp with time zone', false),
    ('amora_lifecycle', 'couples', 'amora_shared_resetting_user_id', 'uuid', false),
    ('amora_lifecycle', 'couples', 'amora_context_generation', 'bigint', true),
    ('amora_lifecycle', 'couples', 'amora_context_changed_at', 'timestamp with time zone', true),
    ('amora_lifecycle', 'couples', 'amora_replacement_blocked_at', 'timestamp with time zone', false),
    ('care_notifications', 'profiles', 'care_notifications_enabled', 'boolean', true),
    ('profile_phone', 'profiles', 'phone', 'text', false),
    ('profile_phone_care_consent', 'profiles', 'phone_care_consented_at', 'timestamp with time zone', false),
    ('profile_push_token', 'profiles', 'push_token', 'text', false),
    ('rate_limit_subject', 'rate_limit_buckets', 'subject_user_id', 'uuid', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'id', 'uuid', true),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'user_id', 'uuid', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'reason', 'text', true),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'status', 'text', true),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'attempts', 'integer', true),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'next_attempt_at', 'timestamp with time zone', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'lock_token', 'uuid', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'locked_until', 'timestamp with time zone', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'storage_inventory', 'jsonb', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'last_error_code', 'text', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'last_attempt_at', 'timestamp with time zone', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'dead_lettered_at', 'timestamp with time zone', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'completed_at', 'timestamp with time zone', false),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'created_at', 'timestamp with time zone', true),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'updated_at', 'timestamp with time zone', true),
    ('account_deletion_email_attestation', 'account_deletion_jobs', 'email_scopes', 'text[]', false),
    ('account_deletion_email_attestation', 'account_deletion_jobs', 'email_snapshot_at', 'timestamp with time zone', false),
    ('account_deletion_auth_ready', 'account_deletion_jobs', 'auth_delete_ready_until', 'timestamp with time zone', false),
    -- 111410 intentionally changes expires_at to NOT NULL, so only its stable
    -- type is part of the 111350 creator contract.
    ('preregistration_expiry', 'preregistrations', 'expires_at', 'timestamp with time zone', NULL::boolean),
    ('research_cohort_applications', 'research_cohort_applications', 'id', 'uuid', true),
    ('research_cohort_applications', 'research_cohort_applications', 'cohort_code', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'email', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'name', 'text', false),
    ('research_cohort_applications', 'research_cohort_applications', 'wedding_date', 'date', false),
    ('research_cohort_applications', 'research_cohort_applications', 'role', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'message', 'text', false),
    ('research_cohort_applications', 'research_cohort_applications', 'source', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'utm_source', 'text', false),
    ('research_cohort_applications', 'research_cohort_applications', 'utm_medium', 'text', false),
    ('research_cohort_applications', 'research_cohort_applications', 'utm_campaign', 'text', false),
    ('research_cohort_applications', 'research_cohort_applications', 'privacy_consent_at', 'timestamp with time zone', true),
    ('research_cohort_applications', 'research_cohort_applications', 'privacy_policy_version', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'email_verified_at', 'timestamp with time zone', false),
    ('research_cohort_applications', 'research_cohort_applications', 'receipt_email_status', 'text', true),
    ('research_cohort_applications', 'research_cohort_applications', 'receipt_email_attempted_at', 'timestamp with time zone', false),
    ('research_cohort_applications', 'research_cohort_applications', 'created_at', 'timestamp with time zone', true),
    ('research_cohort_applications', 'research_cohort_applications', 'expires_at', 'timestamp with time zone', true)
), actual_dynamic_columns AS (
  SELECT table_row.relname AS table_name,
         attribute_row.attname AS column_name,
         format_type(attribute_row.atttypid, attribute_row.atttypmod) AS data_type,
         attribute_row.attnotnull AS not_null
  FROM pg_catalog.pg_class table_row
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = table_row.oid
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
  WHERE namespace_row.nspname = 'public'
), dynamic_column_contracts AS (
  SELECT expected.contract_name,
         bool_and(actual.column_name IS NOT NULL) AS all_present,
         bool_and(
           actual.column_name IS NULL
           OR (
             actual.data_type IS NOT DISTINCT FROM expected.data_type
             AND (
               expected.not_null IS NULL
               OR actual.not_null IS NOT DISTINCT FROM expected.not_null
             )
           )
         ) AS existing_compatible,
         bool_and(
           actual.column_name IS NOT NULL
           AND actual.data_type IS NOT DISTINCT FROM expected.data_type
           AND (
             expected.not_null IS NULL
             OR actual.not_null IS NOT DISTINCT FROM expected.not_null
           )
         ) AS exact
  FROM required_dynamic_columns expected
  LEFT JOIN actual_dynamic_columns actual
    ON actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
  GROUP BY expected.contract_name
), required_dynamic_defaults(
  contract_name, table_name, column_name, expected_default
) AS (
  VALUES
    ('wedding_base', 'wedding_code_responses', 'id', 'gen_random_uuid()'),
    ('wedding_base', 'wedding_code_responses', 'created_at', 'now()'),
    ('wedding_base', 'wedding_code_responses', 'form_version', '''v0.3''::text'),
    ('wedding_base', 'wedding_code_responses', 'consent_at', 'now()'),
    ('wedding_base', 'wedding_code_responses', 'biggest_concern', '''{}''::text[]'),
    ('wedding_base', 'wedding_code_responses', 'stage_flags', '''{}''::jsonb'),
    ('wedding_base', 'wedding_code_responses', 'feedback', '''{}''::jsonb'),
    ('wedding_base', 'wedding_code_responses', 'cta_interest', '''{}''::jsonb'),
    ('wedding_base', 'wedding_code_responses', 'free_text', '''{}''::jsonb'),
    ('amora_claims_base', 'amora_request_claims', 'created_at', 'now()'),
    ('amora_claims_base', 'amora_request_claims', 'updated_at', 'now()'),
    ('amora_lifecycle', 'profiles', 'amora_membership_generation', '0'),
    ('amora_lifecycle', 'profiles', 'amora_membership_changed_at', 'now()'),
    ('amora_lifecycle', 'couples', 'amora_context_generation', '0'),
    ('amora_lifecycle', 'couples', 'amora_context_changed_at', 'now()'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'id', 'gen_random_uuid()'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'reason', '''unknown''::text'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'status', '''pending''::text'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'attempts', '0'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'created_at', 'now()'),
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'updated_at', 'now()'),
    ('account_deletion_auth_ready', 'account_deletion_jobs',
      'auth_delete_ready_until', NULL::text)
), actual_dynamic_defaults AS (
  SELECT table_row.relname AS table_name,
         attribute_row.attname AS column_name,
         pg_get_expr(default_row.adbin, default_row.adrelid) AS actual_default
  FROM pg_catalog.pg_class table_row
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = table_row.oid
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef default_row
    ON default_row.adrelid = table_row.oid
   AND default_row.adnum = attribute_row.attnum
  WHERE namespace_row.nspname = 'public'
), dynamic_default_contracts AS (
  SELECT expected.contract_name,
         bool_and(
           actual.column_name IS NULL
           OR actual.actual_default IS NOT DISTINCT FROM expected.expected_default
         ) AS existing_compatible,
         bool_and(
           actual.column_name IS NOT NULL
           AND actual.actual_default IS NOT DISTINCT FROM expected.expected_default
         ) AS exact
  FROM required_dynamic_defaults expected
  LEFT JOIN actual_dynamic_defaults actual
    ON actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
  GROUP BY expected.contract_name
), required_dependency_functions(
  signature, expected_result, expected_search_path, expected_source_md5,
  creator_version, forward_version
) AS (
  VALUES
    ('public.apply_journey_progress_patch(uuid,jsonb,text[])', 'jsonb',
      'search_path=public', '8fb08367706397c9a1d00e299a48e7d5',
      '20260611160000', NULL::text),
    ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)',
      'uuid', 'search_path=public', '3493fa940491a5a5efcce1bf1f6ac497',
      '20260517000000', '20260711138000'),
    ('public.check_rate_limit(text,integer,integer)',
      'TABLE(allowed boolean, retry_after_seconds integer)',
      'search_path=public', 'dbaddace99dcf6ddbe99da5eefe0797a',
      '20260615103000', '20260711147000'),
    ('public.check_rate_limit(text,integer,integer,uuid)',
      'TABLE(allowed boolean, retry_after_seconds integer)',
      'search_path=public', '7583f22c1daf9cebea4f7a847a6a507f',
      '20260711147000', NULL::text),
    ('public.reserve_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer)',
      'search_path=public', 'c9fb8a9c1170a3643fd3035422a6180e',
      '20260710040000', '20260711137000'),
    ('public.check_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer)',
      'search_path=public', '1a5fbd827bd8926a03798420f4c766e6',
      '20260711139000', NULL::text),
    ('public.reserve_amora_usage_v2(uuid,integer,integer,boolean,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '466ddd79bdaec3fba35454a4986d32b9',
      '20260711139000', NULL::text),
    ('public.mark_amora_provider_started(text,text,integer)', 'boolean',
      'search_path=public', 'aae3c73e3fd4b9e6b4b54440d7e688b6',
      '20260711139000', NULL::text),
    ('public.fail_amora_chat_request(text,text,text)',
      'TABLE(final_status text, message_id uuid, visible_refunded boolean)',
      'search_path=public', 'b3d3255b9b758387041938c3371616fa',
      '20260711139000', NULL::text),
    ('public.expire_stale_amora_chat_request(text,text)', 'boolean',
      'search_path=public', 'a8f07da1189b1cb3172f6fa1ae43b868',
      '20260711139000', NULL::text),
    ('public.reconcile_stale_amora_chat_requests(integer)', 'integer',
      'search_path=public', 'f5da3d6b4c7b0511856da991e59caee1',
      '20260711139000', NULL::text),
    ('public.complete_amora_chat_request(uuid,uuid,text,text,text,jsonb,text,text,text,timestamp with time zone,bigint,bigint,text,text,integer,text,integer,integer,numeric,jsonb)',
      'TABLE(message_id uuid, created_at timestamp with time zone)', 'search_path=public',
      'd647047288a7970a224acc624ffc2405', '20260710050000', NULL::text),
    ('public.acquire_amora_provider_lease(uuid,uuid,bigint,bigint,text,timestamp with time zone)',
      'uuid', 'search_path=public', '5317c379fef8569cd23356e541ec87c5',
      '20260710050000', NULL::text),
    ('public.release_amora_provider_lease(uuid)', 'void', 'search_path=public',
      '7860c39280199d718988cefeb446222d', '20260710050000', NULL::text),
    ('public.get_or_rotate_invite_code_safely(uuid,boolean)', 'jsonb', 'search_path=public',
      'b59b6d67618d1241ee6a155e08b51b04', '20260710050000', '20260711142000'),
    ('public.join_couple_server(uuid,text,text,date,text,numeric,jsonb,date)', 'jsonb',
      'search_path=public', 'ee8467fbf8f57cbd067e2685d25b153a',
      '20260710050000', '20260711142000'),
    ('public.restart_blocked_amora_couple_safely(uuid)', 'jsonb', 'search_path=public',
      '781faeb180024da7962356665c49ee33', '20260710050000', NULL::text),
    ('public.leave_amora_couple_safely(uuid,text)', 'jsonb', 'search_path=public',
      'd5ac8d47bd2e6caa5bbef9a33dc6e988', '20260710050000', NULL::text),
    ('public.create_amora_couple_safely(uuid,text,date,text,numeric,jsonb)', 'jsonb',
      'search_path=public', 'b5cd665ed905621cfebe74e5bd78a44a',
      '20260710050000', NULL::text),
    ('public.begin_amora_membership_reset(uuid)', 'jsonb', 'search_path=public',
      '5773439ce4fc5146794e5b127c53fbc9', '20260710050000', NULL::text),
    ('public.count_active_amora_provider_leases(uuid)', 'integer', 'search_path=public',
      'bf69f64824787e41e5c186993812c320', '20260710050000', NULL::text),
    ('public.count_active_amora_couple_provider_leases(uuid)', 'integer',
      'search_path=public', '38564f585b8754142855eecedf8816d0',
      '20260710050000', NULL::text),
    ('public.generate_invite_code()', 'text', 'search_path=public',
      'bbdbfa819d82e20868be4f69ef3257bc', '20260710050000', NULL::text),
    ('public.begin_account_deletion(uuid)', 'jsonb', 'search_path=public',
      '57a2cda57caef4083baab89ae619502d', '20260710050000', NULL::text),
    ('public.delete_private_amora_data(uuid,uuid,text)', 'integer', 'search_path=public',
      'a4d613928f6a67e966fa52bdb4e82bb6', '20260710050000', NULL::text),
    ('public.redact_user_ai_data(uuid)', 'integer', 'search_path=public',
      '7bef551a2dc6c927e7c95bd0d7c2ba3f', '20260710050000', NULL::text),
    ('public.redact_old_ai_interactions(interval)', 'integer',
      'search_path=public', '571f7b3674ee36b941bb19064f8b1cb0',
      '20260710010000', '20260714102000'),
    ('public.enforce_ai_interaction_retention()',
      'TABLE(redacted integer, deleted integer)',
      'search_path=pg_catalog, pg_temp', '806dc01af7ffe1047f9ffd381bf539c2',
      '20260710010000', '20260714102000'),
    ('public.enforce_application_survey_retention()',
      'TABLE(preregistrations_deleted integer, survey_responses_deleted integer)',
      'search_path=public', '04d9b06eedd9eec0c19cf29e5b1a9968',
      '20260711141000', '20260712100000'),
    ('public.delete_expired_rate_limit_buckets()', 'integer',
      'search_path=public', '667f711d08313c214c99cf4a8023b513',
      '20260711141000', '20260711145000'),
    ('public.prevent_profile_membership_self_change()', 'trigger', 'search_path=public',
      'e3c62718b1fbc242933e9d83acbbce1a', '20260710050000', NULL::text),
    ('public.insert_amora_user_message(uuid,uuid,text,text,text)', 'jsonb',
      'search_path=public', 'bb01ea6d87b3b1cf8e067f5ef24ce789',
      '20260710050000', NULL::text),
    ('public.reset_my_amora_chat_view(uuid,uuid,text)', 'timestamp with time zone',
      'search_path=public', '87cc1177d84600a1bf07a552cf6e51d6',
      '20260710050000', NULL::text),
    ('public.respond_amora_shared_clear_request(uuid,uuid,text)', 'jsonb',
      'search_path=public', '0e532efaf9160d49977badfe320b5d17',
      '20260710050000', NULL::text),
    ('public.begin_private_amora_delete(uuid,uuid,text)', 'jsonb',
      'search_path=public', '2d77bfe6a34abd0d578f295432991dd6',
      '20260710050000', NULL::text),
    ('public.count_active_amora_private_provider_leases(uuid,text)', 'integer',
      'search_path=public', '75074f443cf3c453790537156e1a188f',
      '20260710050000', NULL::text),
    ('public.apply_amora_budget_plan(uuid,uuid,numeric,jsonb)', 'jsonb',
      'search_path=public', '42e8ed79ef7f4d9376c1ad54051a3921',
      '20260710050000', NULL::text),
    ('public.save_amora_feedback(uuid,uuid,text,text,text)', 'uuid',
      'search_path=public', '17eee9cb5a76de4ba40262d90b7ab419',
      '20260710050000', NULL::text),
    ('public.delete_expired_amora_request_claims()', 'integer',
      'search_path=public', 'dce4955b686ff0f1386e1d9460324758',
      '20260710050000', '20260711144000'),
    ('public.guard_user_media_storage_write()', 'trigger',
      'search_path=public, storage, pg_temp', '2f2ef78416318e6dd8fbd66c3507a2f9',
      '20260710050000', '20260711146000'),
    ('public.count_active_community_upload_leases(uuid)', 'bigint',
      'search_path=public, pg_temp', 'b1594dc15e570d225357dd90e10930f2',
      '20260710080000', NULL::text),
    ('public.guard_account_deletion_user_reference()', 'trigger',
      'search_path=public, pg_temp', '0518d47d1da58e822a8b6ba662bd06eb',
      '20260710070000', NULL::text),
    ('public.guard_account_deletion_rate_limit_write()', 'trigger',
      'search_path=public, pg_temp', 'b8ebd5bbf8df5b250d36404f4d6f0a5c',
      '20260710070000', '20260711147000'),
    ('public.account_deletion_email_scopes_are_canonical(text[])', 'boolean',
      'search_path=pg_catalog, pg_temp', '221d594a0a3f55f12d8baf2d8b18ce91',
      '20260712101000', NULL::text),
    ('public.request_account_deletion(uuid,text)', 'jsonb',
      'search_path=public, pg_temp', 'd375108d46ea6663f58a7fbe80fa3d93',
      '20260710070000', '20260712104500'),
    ('public.claim_account_deletion_jobs(uuid,integer,integer)',
      'TABLE(job_id uuid, user_id uuid, reason text, attempts integer, storage_inventory jsonb)',
      'search_path=public, pg_temp', '2f21c2198582104158923a9726cf6d8f',
      '20260710070000', NULL::text),
    ('public.save_account_deletion_storage_inventory(uuid,uuid,jsonb)', 'boolean',
      'search_path=public, pg_temp', '14602d5c4e9ccc3eb90f4c5618549f9d',
      '20260710070000', '20260711143000'),
    ('public.fail_account_deletion_job(uuid,uuid,text)', 'text',
      'search_path=public, pg_temp', '9795091031826ac0a932ec01249834a8',
      '20260710070000', NULL::text),
    ('public.renew_account_deletion_job_lease(uuid,uuid,integer)', 'boolean',
      'search_path=public, pg_temp', 'ba6534442ff7bc582d4bdefc396bc841',
      '20260712101000', NULL::text),
    ('public.list_account_deletion_owned_storage_objects(uuid,uuid,text,text,integer)',
      'TABLE(bucket_id text, object_name text)',
      'search_path=pg_catalog, pg_temp', '4aee5587c9f133ff8e23609c23bfbd86',
      '20260712105000', NULL::text),
    ('public.mark_account_deletion_cleanup_ready(uuid,uuid,integer)', 'boolean',
      'search_path=pg_catalog, pg_temp', '2bed182fdddecbf115ecd0856e14aed7',
      '20260712105000', NULL::text),
    ('public.complete_account_deletion_job(uuid,uuid)', 'boolean',
      'search_path=public, pg_temp', 'b1e4030efdc81da7dcd4697206221ffc',
      '20260710070000', '20260712105000'),
    ('public.requeue_dead_account_deletion_job(uuid)', 'boolean',
      'search_path=public, pg_temp', '29fe1226857032d271e78f585f887956',
      '20260710070000', NULL::text),
    ('public.account_deletion_queue_health()', 'jsonb',
      'search_path=public, pg_temp', 'b0184ebdb2888d329ef714726d7f76f6',
      '20260710070000', NULL::text),
    ('public.settle_court_provider_failure_internal(uuid,text)', 'text',
      'search_path=pg_catalog, pg_temp', '7e2fb50315c4552e2048c0fe17db370a',
      '20260714100000', NULL::text),
    ('public.settle_court_provider_failure(uuid,text)', 'text',
      'search_path=pg_catalog, pg_temp', 'f31008554a1e23b840674bbcfd634a0a',
      '20260713110000', '20260714100000'),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '86f7199746ac3fb7d19b12c629b7c5e2', '20260714100000', NULL::text),
    ('public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '55e200a85ab23811e1de8ac0f699bb0f', '20260713110000', '20260714100000'),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      'df11c175cf296be4faeb8918eb5ba589', '20260714100000', NULL::text),
    ('public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      'c25632c52a04e56677ced9e0629f8c1e', '20260713110000', '20260714100000'),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '58e16d0d0323e86cb6b132f7fa7dc62e',
      '20260714100000', NULL::text),
    ('public.write_court_provider_audit(text,jsonb,numeric)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '4ee8cc03e1b68332882856c0ea2fb6e0',
      '20260713110000', '20260714100000'),
    ('public.finalize_court_provider_audit_live(uuid,text)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '179562b354f34b518327b1228d0baa1e',
      '20260714100000', NULL::text),
    ('public.finalize_court_provider_audit(uuid,text)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '948e284af8b1991a25c3eda178bed604',
      '20260713110000', '20260714100000'),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '41b7ea2a658a52bccb3e37795281128d',
      '20260714102000', NULL::text),
    ('public.claim_court_provider_audit_recovery(uuid,integer)', 'jsonb',
      'search_path=pg_catalog, pg_temp', '36340ba20f40fd6f8cab0491d03990ec',
      '20260713110000', '20260714102000'),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      'e01e0ecec59db41b376271c68973a312', '20260714102000', NULL::text),
    ('public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '4ad83a53a4a60dee093fab369d520c4f', '20260713110000', '20260714102000'),
    ('public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '7c774ec3289924fcae465251e8c18d0b', '20260714102000', NULL::text),
    ('public.enforce_court_provider_deletion_handoff_retention(integer)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '605f4f2ccf181a0de3861ad819a7dcb7', '20260714102000', NULL::text),
    ('public.enforce_ai_interaction_retention_live()',
      'TABLE(redacted integer, deleted integer)',
      'search_path=public', '85cb9b5ccafca3cca9b3cdf74ee4eddc',
      '20260714102000', NULL::text),
    ('public.list_court_provider_deletion_handoffs(uuid,integer)',
      'TABLE(verdict_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)',
      'search_path=pg_catalog, pg_temp', 'f3b9c678533ed27570420f01fb50d190',
      '20260714103000', NULL::text),
    ('public.list_court_provider_reconciliations(uuid,integer)',
      'TABLE(verdict_id uuid, provider_state text, started_at timestamp with time zone, failed_at timestamp with time zone, provider_error_code text, created_at timestamp with time zone, updated_at timestamp with time zone)',
      'search_path=pg_catalog, pg_temp', '6455d31459a942fce5bb88bcf35cb5bc',
      '20260714103000', NULL::text),
    ('public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '6a91b7a0a9c3a0191a7d87b7b5623d37', '20260714103000', NULL::text),
    ('public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)',
      'jsonb', 'search_path=pg_catalog, pg_temp',
      '658c9c2eadfc38e07fcbffc536a6c443', '20260714103000', NULL::text),
    ('public.enforce_court_provider_request_key_reveal_audit_retention(integer)',
      'integer', 'search_path=pg_catalog, pg_temp',
      'e87a1188dffd2880a2291c2e5005524b', '20260714103000', NULL::text)
), required_replaceable_argument_names(signature, expected_arg_names) AS (
  VALUES
    ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)',
      ARRAY['p_vendor_id', 'p_couple_id', 'p_booking_date', 'p_booking_time',
        'p_product_id', 'p_staff_id', 'p_booking_type', 'p_bride_name',
        'p_groom_name', 'p_contact_phone', 'p_amount', 'p_memo']::text[]),
    ('public.check_rate_limit(text,integer,integer)',
      ARRAY['p_key', 'p_max_requests', 'p_window_ms',
        'allowed', 'retry_after_seconds']::text[]),
    ('public.check_rate_limit(text,integer,integer,uuid)',
      ARRAY['p_key', 'p_max_requests', 'p_window_ms', 'p_subject_user_id',
        'allowed', 'retry_after_seconds']::text[]),
    ('public.reserve_amora_usage(uuid,integer,integer,boolean)',
      ARRAY['p_couple_id', 'p_couple_cap', 'p_global_provider_cap',
        'p_count_user_turn', 'allowed', 'reason', 'remaining']::text[]),
    ('public.get_or_rotate_invite_code_safely(uuid,boolean)',
      ARRAY['p_user_id', 'p_rotate']::text[]),
    ('public.join_couple_server(uuid,text,text,date,text,numeric,jsonb,date)',
      ARRAY['p_user_id', 'p_invite_code', 'p_role', 'p_wedding_date',
        'p_venue', 'p_total_budget', 'p_progress',
        'p_sanggyeonrye_date']::text[]),
    ('public.delete_expired_amora_request_claims()', NULL::text[]),
    ('public.guard_user_media_storage_write()', NULL::text[]),
    ('public.save_account_deletion_storage_inventory(uuid,uuid,jsonb)',
      ARRAY['p_job_id', 'p_worker_token', 'p_inventory']::text[]),
    ('public.redact_old_ai_interactions(interval)', ARRAY['p_retention']::text[]),
    ('public.enforce_ai_interaction_retention()',
      ARRAY['redacted', 'deleted']::text[]),
    ('public.settle_court_provider_failure_internal(uuid,text)',
      ARRAY['p_verdict_id', 'p_error_code']::text[]),
    ('public.settle_court_provider_failure(uuid,text)',
      ARRAY['p_verdict_id', 'p_error_code']::text[]),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      ARRAY['p_verdict_id', 'p_lease_token', 'p_input_hash', 'p_request_key',
        'p_audit_model', 'p_input_tokens', 'p_output_tokens',
        'p_cached_input_tokens', 'p_cache_write_input_tokens']::text[]),
    ('public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      ARRAY['p_verdict_id', 'p_lease_token', 'p_input_hash', 'p_request_key',
        'p_audit_model', 'p_input_tokens', 'p_output_tokens',
        'p_cached_input_tokens', 'p_cache_write_input_tokens']::text[]),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      ARRAY['p_verdict_id', 'p_user_id', 'p_lease_token', 'p_input_hash',
        'p_request_key', 'p_categories', 'p_audit_model', 'p_input_tokens',
        'p_output_tokens', 'p_cached_input_tokens',
        'p_cache_write_input_tokens']::text[]),
    ('public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      ARRAY['p_verdict_id', 'p_user_id', 'p_lease_token', 'p_input_hash',
        'p_request_key', 'p_categories', 'p_audit_model', 'p_input_tokens',
        'p_output_tokens', 'p_cached_input_tokens',
        'p_cache_write_input_tokens']::text[]),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)',
      ARRAY['p_request_key', 'p_audit_identity', 'p_cost_usd']::text[]),
    ('public.write_court_provider_audit(text,jsonb,numeric)',
      ARRAY['p_request_key', 'p_audit_identity', 'p_cost_usd']::text[]),
    ('public.finalize_court_provider_audit_live(uuid,text)',
      ARRAY['p_verdict_id', 'p_request_key']::text[]),
    ('public.finalize_court_provider_audit(uuid,text)',
      ARRAY['p_verdict_id', 'p_request_key']::text[]),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)',
      ARRAY['p_admin_user_id', 'p_lease_seconds']::text[]),
    ('public.claim_court_provider_audit_recovery(uuid,integer)',
      ARRAY['p_admin_user_id', 'p_lease_seconds']::text[]),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)',
      ARRAY['p_verdict_id', 'p_admin_user_id', 'p_recovery_lease_token',
        'p_error_code']::text[]),
    ('public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)',
      ARRAY['p_verdict_id', 'p_admin_user_id', 'p_recovery_lease_token',
        'p_error_code']::text[]),
    ('public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)',
      ARRAY['p_verdict_id', 'p_admin_user_id', 'p_action', 'p_confirmation',
        'p_audit_model', 'p_input_tokens', 'p_output_tokens',
        'p_cached_input_tokens', 'p_cache_write_input_tokens',
        'p_cost_usd']::text[]),
    ('public.enforce_court_provider_deletion_handoff_retention(integer)',
      ARRAY['p_batch_size']::text[]),
    ('public.enforce_ai_interaction_retention_live()',
      ARRAY['redacted', 'deleted']::text[]),
    ('public.list_court_provider_deletion_handoffs(uuid,integer)',
      ARRAY['p_actor_id', 'p_limit', 'verdict_id', 'created_at',
        'expires_at']::text[]),
    ('public.list_court_provider_reconciliations(uuid,integer)',
      ARRAY['p_actor_id', 'p_limit', 'verdict_id', 'provider_state',
        'started_at', 'failed_at', 'provider_error_code', 'created_at',
        'updated_at']::text[]),
    ('public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)',
      ARRAY['p_verdict_id', 'p_admin_user_id', 'p_confirmation']::text[]),
    ('public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)',
      ARRAY['p_verdict_id', 'p_admin_user_id', 'p_confirmation']::text[]),
    ('public.enforce_court_provider_request_key_reveal_audit_retention(integer)',
      ARRAY['p_batch_size']::text[]),
    ('public.enforce_application_survey_retention()',
      ARRAY['preregistrations_deleted', 'survey_responses_deleted']::text[]),
    ('public.delete_expired_rate_limit_buckets()', NULL::text[])
), dependency_service_denied_functions(signature) AS (
  VALUES
    ('public.guard_account_deletion_user_reference()'),
    ('public.guard_account_deletion_rate_limit_write()'),
    ('public.redact_old_ai_interactions(interval)'),
    ('public.settle_court_provider_failure_internal(uuid,text)'),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)'),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)'),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)'),
    ('public.finalize_court_provider_audit_live(uuid,text)'),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)'),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)'),
    ('public.enforce_ai_interaction_retention_live()')
), dependency_function_migration_requirements(
  signature, creator_requires_absence, forward_requires_presence,
  expected_pre_forward_source_md5, expected_pre_forward_search_path
) AS (
  VALUES
    ('public.settle_court_provider_failure_internal(uuid,text)',
      true, false, NULL::text, NULL::text),
    ('public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      true, false, NULL::text, NULL::text),
    ('public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      true, false, NULL::text, NULL::text),
    ('public.write_court_provider_audit_live(text,jsonb,numeric)',
      true, false, NULL::text, NULL::text),
    ('public.finalize_court_provider_audit_live(uuid,text)',
      true, false, NULL::text, NULL::text),
    ('public.claim_court_provider_audit_recovery_live(uuid,integer)',
      true, false, NULL::text, NULL::text),
    ('public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)',
      true, false, NULL::text, NULL::text),
    ('public.enforce_ai_interaction_retention_live()',
      true, false, NULL::text, NULL::text),
    ('public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)',
      true, false, NULL::text, NULL::text),
    ('public.enforce_court_provider_deletion_handoff_retention(integer)',
      true, false, NULL::text, NULL::text),
    ('public.list_court_provider_deletion_handoffs(uuid,integer)',
      true, false, NULL::text, NULL::text),
    ('public.list_court_provider_reconciliations(uuid,integer)',
      true, false, NULL::text, NULL::text),
    ('public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)',
      true, false, NULL::text, NULL::text),
    ('public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)',
      true, false, NULL::text, NULL::text),
    ('public.enforce_court_provider_request_key_reveal_audit_retention(integer)',
      true, false, NULL::text, NULL::text),
    ('public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)',
      false, true, '86f7199746ac3fb7d19b12c629b7c5e2',
      'search_path=pg_catalog, pg_temp'),
    ('public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)',
      false, true, 'df11c175cf296be4faeb8918eb5ba589',
      'search_path=pg_catalog, pg_temp'),
    ('public.write_court_provider_audit(text,jsonb,numeric)',
      false, true, '58e16d0d0323e86cb6b132f7fa7dc62e',
      'search_path=pg_catalog, pg_temp'),
    ('public.finalize_court_provider_audit(uuid,text)',
      false, true, '179562b354f34b518327b1228d0baa1e',
      'search_path=pg_catalog, pg_temp'),
    ('public.claim_court_provider_audit_recovery(uuid,integer)',
      false, true, '41b7ea2a658a52bccb3e37795281128d',
      'search_path=pg_catalog, pg_temp'),
    ('public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)',
      false, true, 'e01e0ecec59db41b376271c68973a312',
      'search_path=pg_catalog, pg_temp'),
    ('public.enforce_ai_interaction_retention()',
      false, true, '85cb9b5ccafca3cca9b3cdf74ee4eddc',
      'search_path=public'),
    ('public.redact_old_ai_interactions(interval)',
      false, true, '571f7b3674ee36b941bb19064f8b1cb0',
      'search_path=public')
), dependency_function_status AS (
  SELECT required.signature,
         required.creator_version,
         required.forward_version,
         coalesce(migration_requirement.creator_requires_absence, false)
           AS creator_requires_absence,
         coalesce(migration_requirement.forward_requires_presence, false)
           AS forward_requires_presence,
         procedure_row.oid IS NOT NULL AS present,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
         END AS service_role_execute,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
         END AS anon_execute,
         CASE WHEN procedure_row.oid IS NULL THEN false ELSE
           has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
         END AS authenticated_execute,
         procedure_row.oid IS NULL OR (
           pg_get_function_result(procedure_row.oid) = required.expected_result
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND (
             argument_contract.signature IS NULL
             OR procedure_row.proargnames IS NOT DISTINCT FROM
               argument_contract.expected_arg_names
           )
         ) AS existing_replaceable,
         CASE
           WHEN migration_requirement.expected_pre_forward_source_md5 IS NULL
             THEN true
           ELSE procedure_row.oid IS NOT NULL
             AND language_row.lanname = 'plpgsql'
             AND procedure_row.prokind = 'f'
             AND procedure_row.prosecdef
             AND procedure_row.provolatile = 'v'
             AND NOT procedure_row.proisstrict
             AND NOT procedure_row.proleakproof
             AND procedure_row.proparallel = 'u'
             AND procedure_row.proconfig IS NOT DISTINCT FROM ARRAY[
               migration_requirement.expected_pre_forward_search_path
             ]::text[]
             AND md5(replace(procedure_row.prosrc, chr(13), '')) =
               migration_requirement.expected_pre_forward_source_md5
         END AS pre_forward_exact,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY[required.expected_search_path]::text[]
           AND cardinality(procedure_row.proconfig) = 1
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE') =
             NOT EXISTS (
               SELECT 1 FROM dependency_service_denied_functions denied
               WHERE denied.signature = required.signature
             )
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
           AS exact
  FROM required_dependency_functions required
  LEFT JOIN required_replaceable_argument_names argument_contract
    ON argument_contract.signature = required.signature
  LEFT JOIN dependency_function_migration_requirements migration_requirement
    ON migration_requirement.signature = required.signature
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
  LEFT JOIN pg_catalog.pg_language language_row
    ON language_row.oid = procedure_row.prolang
), required_client_denied_trigger_functions(
  signature, expected_source_md5, expected_search_path,
  expected_service_role_execute, creator_version, forward_version
) AS (
  VALUES
    ('public.community_recalc_rank()', 'c742d9e87a9c815491d03c574690772c',
      'search_path=public', true, '20260408000000', '20260711145000'),
    ('public.create_profile_on_signup()', '84a6f9f7f2c366bb87703fcc25cc2f22',
      'search_path=public', true, '20260210000000', '20260711145000'),
    ('public.guard_amora_user_message_insert()', '3b3a72bfb77bfd27a0b7f43b718cb4c0',
      'search_path=public', true, '20260710050000', '20260711145000'),
    ('public.guard_profile_self_insert()', 'e1a79bcb72eb8b1df1c5edb70f181e44',
      'search_path=public', true, '20260710050000', '20260711145000'),
    ('public.prevent_cohort_membership_client_write()', '5947d166102367678683a8ae71c2b72d',
      'search_path=public', true, '20260615090000', '20260711145000'),
    ('public.prevent_couple_ownership_self_change()', '697c40535a23d739a271b0b4e3b2ffbf',
      'search_path=public', true, '20260612130000', '20260711145000'),
    ('public.prevent_couple_slot_self_change()', 'c795f37d371b8143d50b45d65de96411',
      'search_path=public', true, '20260614110000', '20260711145000'),
    ('public.prevent_is_admin_self_change()', '9395ea55bfc5192e10ef000e0421d7b3',
      'search_path=public', true, '20260612120000', '20260711145000'),
    ('public.lock_application_email_lifecycle_write()',
      '07ad809b73c9daac9ea0ebe7d90e2809',
      'search_path=pg_catalog, pg_temp', true,
      '20260712103000', '20260712103000'),
    ('public.block_auth_user_update_during_account_deletion()',
      '7ccae1027d97c12b32d9d04c92a54002',
      'search_path=pg_catalog, pg_temp', false,
      '20260712104000', '20260712104000'),
    ('public.block_storage_owner_write_during_account_deletion()',
      '32d02e88418f75f08d788ab5da07c9af',
      'search_path=pg_catalog, pg_temp', false,
      '20260712105000', '20260712105000'),
    ('public.block_auth_user_delete_until_account_cleanup_ready()',
      '868a650d26b5bf4aff730c73b99f009e',
      'search_path=pg_catalog, pg_temp', false,
      '20260712105000', '20260712105000'),
    ('public.handoff_court_provider_attempts_before_case_delete()',
      '4a60d39c0e0059451559e46d8bd9837b',
      'search_path=pg_catalog, pg_temp', false,
      '20260714100000', '20260714100000')
), client_denied_trigger_function_status AS (
  SELECT required.signature,
         required.creator_version,
         required.forward_version,
         required.signature =
           'public.handoff_court_provider_attempts_before_case_delete()'
           AS creator_requires_absence,
         procedure_row.oid IS NOT NULL AS present,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'trigger'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AS existing_compatible,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'trigger'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig
             @> ARRAY[required.expected_search_path]::text[]
           AND cardinality(procedure_row.proconfig) = 1
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) = required.expected_service_role_execute
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
           AS exact
  FROM required_client_denied_trigger_functions required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), required_client_denied_trigger_bindings(
  schema_name, table_name, trigger_name, function_signature, definition,
  creator_version, forward_version
) AS (
  VALUES
    ('public', 'community_profiles', 'trg_recalc_rank',
      'public.community_recalc_rank()',
      'CREATE TRIGGER trg_recalc_rank AFTER UPDATE OF post_count, comment_count, total_upvotes_received, wedding_completed ON community_profiles FOR EACH ROW EXECUTE FUNCTION community_recalc_rank()',
      '20260408000000', '20260711148000'),
    ('auth', 'users', 'on_auth_user_created',
      'public.create_profile_on_signup()',
      'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup()',
      '20260210000000', '20260711148000'),
    ('public', 'chat_messages', 'trg_guard_amora_user_message_insert',
      'public.guard_amora_user_message_insert()',
      'CREATE TRIGGER trg_guard_amora_user_message_insert BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION guard_amora_user_message_insert()',
      '20260710050000', '20260711148000'),
    ('public', 'profiles', 'trg_guard_profile_self_insert',
      'public.guard_profile_self_insert()',
      'CREATE TRIGGER trg_guard_profile_self_insert BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_self_insert()',
      '20260710050000', '20260711148000'),
    ('public', 'cohort_members', 'trg_prevent_cohort_membership_client_write',
      'public.prevent_cohort_membership_client_write()',
      'CREATE TRIGGER trg_prevent_cohort_membership_client_write BEFORE INSERT OR DELETE OR UPDATE ON cohort_members FOR EACH ROW EXECUTE FUNCTION prevent_cohort_membership_client_write()',
      '20260615090000', '20260711148000'),
    ('public', 'profiles', 'trg_prevent_couple_ownership_self_change',
      'public.prevent_couple_ownership_self_change()',
      'CREATE TRIGGER trg_prevent_couple_ownership_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_couple_ownership_self_change()',
      '20260612130000', '20260711148000'),
    ('public', 'couples', 'trg_prevent_couple_slot_self_change',
      'public.prevent_couple_slot_self_change()',
      'CREATE TRIGGER trg_prevent_couple_slot_self_change BEFORE UPDATE ON couples FOR EACH ROW EXECUTE FUNCTION prevent_couple_slot_self_change()',
      '20260614110000', '20260711148000'),
    ('public', 'profiles', 'trg_prevent_is_admin_self_change',
      'public.prevent_is_admin_self_change()',
      'CREATE TRIGGER trg_prevent_is_admin_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_change()',
      '20260612120000', '20260711148000'),
    ('public', 'preregistrations',
      'trg_lock_preregistration_email_lifecycle',
      'public.lock_application_email_lifecycle_write()',
      'CREATE TRIGGER trg_lock_preregistration_email_lifecycle BEFORE INSERT OR UPDATE ON preregistrations FOR EACH ROW EXECUTE FUNCTION lock_application_email_lifecycle_write()',
      '20260712103000', '20260712103000'),
    ('public', 'research_cohort_applications',
      'trg_lock_research_cohort_application_email_lifecycle',
      'public.lock_application_email_lifecycle_write()',
      'CREATE TRIGGER trg_lock_research_cohort_application_email_lifecycle BEFORE INSERT OR UPDATE ON research_cohort_applications FOR EACH ROW EXECUTE FUNCTION lock_application_email_lifecycle_write()',
      '20260712103000', '20260712103000'),
    ('auth', 'users',
      'trg_block_auth_user_update_during_account_deletion',
      'public.block_auth_user_update_during_account_deletion()',
      'CREATE TRIGGER trg_block_auth_user_update_during_account_deletion BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION block_auth_user_update_during_account_deletion()',
      '20260712104000', '20260712104000'),
    ('storage', 'objects',
      'trg_block_storage_owner_write_during_account_deletion',
      'public.block_storage_owner_write_during_account_deletion()',
      'CREATE TRIGGER trg_block_storage_owner_write_during_account_deletion BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION block_storage_owner_write_during_account_deletion()',
      '20260712105000', '20260712105000'),
    ('auth', 'users',
      'trg_block_auth_user_delete_until_account_cleanup_ready',
      'public.block_auth_user_delete_until_account_cleanup_ready()',
      'CREATE TRIGGER trg_block_auth_user_delete_until_account_cleanup_ready BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION block_auth_user_delete_until_account_cleanup_ready()',
      '20260712105000', '20260712105000'),
    ('public', 'court_cases',
      'court_case_provider_handoff_before_delete',
      'public.handoff_court_provider_attempts_before_case_delete()',
      'CREATE TRIGGER court_case_provider_handoff_before_delete BEFORE DELETE ON court_cases FOR EACH ROW EXECUTE FUNCTION handoff_court_provider_attempts_before_case_delete()',
      '20260714100000', '20260714100000')
), client_denied_trigger_binding_status AS (
  SELECT required.schema_name,
         required.table_name,
         required.trigger_name,
         required.creator_version,
         required.forward_version,
         required.schema_name = 'public'
           AND required.table_name = 'court_cases'
           AND required.trigger_name =
             'court_case_provider_handoff_before_delete'
           AS creator_requires_absence,
         trigger_row.oid IS NOT NULL AS present,
         to_regclass(required.schema_name || '.' || required.table_name)
           IS NOT NULL
           AND function_row.oid IS NOT NULL
           AND pg_get_function_result(function_row.oid) = 'trigger'
           AND pg_get_userbyid(function_row.proowner) = 'postgres'
           AS existing_replaceable,
         trigger_row.oid IS NOT NULL
           AND NOT trigger_row.tgisinternal
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgfoid = to_regprocedure(required.function_signature)
           AND pg_get_triggerdef(trigger_row.oid, true) = required.definition
           AS exact
  FROM required_client_denied_trigger_bindings required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass(
      required.schema_name || '.' || required.table_name
   )
   AND trigger_row.tgname = required.trigger_name
  LEFT JOIN pg_catalog.pg_proc function_row
    ON function_row.oid = to_regprocedure(required.function_signature)
), amora_reset_read_helper_status AS (
  SELECT procedure_row.oid IS NOT NULL AS present,
         procedure_row.oid IS NULL OR (
           procedure_row.prokind = 'f'
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
         ) AS existing_replaceable,
         procedure_row.oid IS NOT NULL
           AND procedure_row.prokind = 'f'
           AND language_row.lanname = 'sql'
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND procedure_row.prosecdef
           AND procedure_row.provolatile = 's'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY[
             'search_path=pg_catalog, pg_temp',
             'row_security=off'
           ]::text[]
           AND cardinality(procedure_row.proconfig) = 2
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             '668077b0545119cc3af092bbf4cb98ae'
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND NOT has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) AS exact
  FROM (SELECT to_regprocedure(
    'public.can_read_amora_couple_data(uuid,text)'
  ) AS oid) AS target
  LEFT JOIN pg_catalog.pg_proc AS procedure_row
    ON procedure_row.oid = target.oid
  LEFT JOIN pg_catalog.pg_language AS language_row
    ON language_row.oid = procedure_row.prolang
), required_amora_reset_read_policies(table_name, policy_name) AS (
  VALUES
    ('amora_couple_profiles', 'amora_couple_profiles_select_with_privacy'),
    ('chat_messages', 'chat_select_with_privacy'),
    ('chat_summaries', 'chat_summaries_select_with_privacy'),
    ('decision_nodes', 'decision_nodes_select_with_privacy')
), amora_reset_read_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL AS present,
         (
           SELECT count(*)
           FROM pg_catalog.pg_policies AS client_policy
           WHERE client_policy.schemaname = 'public'
             AND client_policy.tablename = required.table_name
             AND client_policy.cmd IN ('SELECT', 'ALL')
             AND EXISTS (
               SELECT 1
               FROM unnest(client_policy.roles) AS policy_role(role_name)
               WHERE CASE
                 WHEN policy_role.role_name = 'public'::name THEN true
                 ELSE pg_has_role(
                   'authenticated', policy_role.role_name, 'MEMBER'
                 )
               END
             )
         ) AS client_read_policy_count,
         (
           SELECT count(*)
           FROM pg_catalog.pg_policies AS client_policy
           WHERE client_policy.schemaname = 'public'
             AND client_policy.tablename = required.table_name
             AND client_policy.policyname <> required.policy_name
             AND client_policy.cmd IN ('SELECT', 'ALL')
             AND EXISTS (
               SELECT 1
               FROM unnest(client_policy.roles) AS policy_role(role_name)
               WHERE CASE
                 WHEN policy_role.role_name = 'public'::name THEN true
                 ELSE pg_has_role(
                   'authenticated', policy_role.role_name, 'MEMBER'
                 )
               END
             )
         ) AS unmanaged_client_read_policy_count,
         table_row.oid IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND has_table_privilege(
             'authenticated', format('public.%I', required.table_name), 'SELECT'
           )
           AND NOT has_table_privilege(
             'anon', format('public.%I', required.table_name), 'SELECT'
           )
           AND 0 = (
             SELECT count(*)
             FROM pg_catalog.pg_policies AS client_policy
             WHERE client_policy.schemaname = 'public'
               AND client_policy.tablename = required.table_name
               AND client_policy.policyname <> required.policy_name
               AND client_policy.cmd IN ('SELECT', 'ALL')
               AND EXISTS (
                 SELECT 1
                 FROM unnest(client_policy.roles) AS policy_role(role_name)
                 WHERE CASE
                   WHEN policy_role.role_name = 'public'::name THEN true
                   ELSE pg_has_role(
                     'authenticated', policy_role.role_name, 'MEMBER'
                   )
                 END
               )
           ) AS existing_replaceable,
         table_row.oid IS NOT NULL
           AND policy_row.policyname IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['authenticated'::name]
           AND policy_row.cmd = 'SELECT'
           AND policy_row.with_check IS NULL
           AND has_table_privilege(
             'authenticated', format('public.%I', required.table_name), 'SELECT'
           )
           AND NOT has_table_privilege(
             'anon', format('public.%I', required.table_name), 'SELECT'
           )
           AND coalesce((SELECT exact FROM amora_reset_read_helper_status), false)
           AND replace(replace(replace(
             regexp_replace(coalesce(policy_row.qual, ''), '[[:space:]]+', '', 'g'),
             '"', ''
           ), '(', ''), ')', '') ~ (
             '^(public\.)?can_read_amora_couple_data'
             || '((public\.)?' || required.table_name || '\.)?couple_id,'
             || '((public\.)?' || required.table_name || '\.)?visibility::text$'
           )
           AND 1 = (
             SELECT count(*)
             FROM pg_catalog.pg_policies AS client_policy
             WHERE client_policy.schemaname = 'public'
               AND client_policy.tablename = required.table_name
               AND client_policy.cmd IN ('SELECT', 'ALL')
               AND EXISTS (
                 SELECT 1
                 FROM unnest(client_policy.roles) AS policy_role(role_name)
                 WHERE CASE
                   WHEN policy_role.role_name = 'public'::name THEN true
                   ELSE pg_has_role(
                     'authenticated', policy_role.role_name, 'MEMBER'
                   )
                 END
               )
           ) AS exact
  FROM required_amora_reset_read_policies AS required
  LEFT JOIN pg_catalog.pg_class AS table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
   AND table_row.relkind = 'r'
  LEFT JOIN pg_catalog.pg_policies AS policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
), required_dependency_crons(
  job_name, expected_schedule, expected_command, creator_version
) AS (
  VALUES
    ('delete-expired-amora-request-claims', '29 18 * * *',
      'SELECT public.delete_expired_amora_request_claims();', '20260710050000'),
    ('reconcile-stale-amora-chat-requests', '*/5 * * * *',
      'SELECT public.reconcile_stale_amora_chat_requests(100);', '20260711139000'),
    ('enforce-ai-interaction-retention', '17 18 * * *',
      'SELECT public.enforce_ai_interaction_retention();', '20260710010000'),
    ('enforce-court-provider-deletion-handoff-retention', '7 * * * *',
      'SELECT public.enforce_court_provider_deletion_handoff_retention(1000);',
      '20260714102000'),
    ('enforce-court-provider-request-key-reveal-audit-retention', '37 * * * *',
      'SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);',
      '20260714103000'),
    ('enforce-application-survey-retention', '41 18 * * *',
      'SELECT public.enforce_application_survey_retention();', '20260711141000'),
    ('delete-expired-rate-limit-buckets', '47 18 * * *',
      'SELECT public.delete_expired_rate_limit_buckets();', '20260711141000')
), dependency_cron_status AS (
  SELECT required.job_name,
         required.creator_version,
         0::bigint AS existing_count,
         true AS existing_replaceable,
         false AS exact
  FROM required_dependency_crons required
), court_provider_required_columns(
  table_name, column_name, data_type, not_null, expected_default,
  introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'id', 'uuid', true,
      'gen_random_uuid()', '20260714100000'),
    ('court_provider_deletion_handoffs', 'request_key', 'text', true,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'verdict_id', 'uuid', true,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'lease_token', 'uuid', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'handoff_state', 'text', true,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_model', 'text', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_input_tokens', 'integer', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_output_tokens', 'integer', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_cached_input_tokens', 'integer', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_cache_write_input_tokens', 'integer', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_cost_usd', 'numeric(10,6)', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'paid_observed_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audit_pending_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'audited_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'resolved_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_lease_token', 'uuid', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_lease_expires_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_attempt_count', 'integer', true,
      '0', '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_last_error_code', 'text', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'recovery_last_error_at', 'timestamp with time zone', false,
      NULL::text, '20260714100000'),
    ('court_provider_deletion_handoffs', 'created_at', 'timestamp with time zone', true,
      'statement_timestamp()', '20260714100000'),
    ('court_provider_deletion_handoffs', 'expires_at', 'timestamp with time zone', true,
      '(statement_timestamp() + make_interval(days => 90))', '20260714100000'),
    ('court_provider_deletion_handoffs', 'provider_resolution_action', 'text', false,
      NULL::text, '20260714102000'),
    ('court_provider_deletion_handoffs', 'provider_resolution_at', 'timestamp with time zone', false,
      NULL::text, '20260714102000'),
    ('court_provider_deletion_handoffs', 'provider_reported_cost_usd', 'numeric(10,6)', false,
      NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'metric_day', 'date', true,
      NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'metric_code', 'text', true,
      NULL::text, '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'event_count', 'bigint', true,
      '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'tokens_input', 'bigint', true,
      '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'tokens_output', 'bigint', true,
      '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'cost_usd', 'numeric', true,
      '0', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'updated_at', 'timestamp with time zone', true,
      'statement_timestamp()', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'id', 'uuid', true,
      'gen_random_uuid()', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'target_scope', 'text', true,
      NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'target_id', 'uuid', true,
      NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'actor_admin_id', 'uuid', false,
      NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'action', 'text', true,
      NULL::text, '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'revealed_at', 'timestamp with time zone', true,
      'statement_timestamp()', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'expires_at', 'timestamp with time zone', true,
      '(statement_timestamp() + make_interval(years => 1))', '20260714103000')
), court_provider_required_named_constraints(
  table_name, constraint_name, introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_pkey', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_key', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_handoff_state_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_audit_model_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_input_tokens_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_output_tokens_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_cached_input_tokens_c', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_provider_cache_write_input_tok', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_audit_cost_usd_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_attempt_count_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_last_error_code_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_usage_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_lease_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_error_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_lifecycle_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_retention_check', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_verdict_id_key', '20260714102000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_resolution_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_pkey', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_metric_code_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_event_count_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_tokens_input_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_tokens_output_check', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_cost_usd_check', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_pkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_target_scope_check', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_actor_admin_id_fkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_action_check', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_retention_check', '20260714103000')
), court_provider_required_constraint_fragments(
  table_name, constraint_name, normalized_fragment, minimum_occurrences,
  introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs',
      'court_provider_deletion_handoffs_lifecycle_check',
      'audit_modelisnotnullandprovider_input_tokensisnotnullandprovider_output_tokensisnotnull',
      2, '20260714100000'),
    ('court_provider_deletion_handoffs',
      'court_provider_deletion_handoffs_resolution_check',
      'audit_modelisnotnullandprovider_input_tokensisnotnullandprovider_output_tokensisnotnull',
      1, '20260714102000')
), court_provider_required_named_indexes(
  table_name, index_name, introduced_version
) AS (
  VALUES
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_recovery_idx', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_expiry_idx', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_pkey', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_request_key_key', '20260714100000'),
    ('court_provider_deletion_handoffs', 'court_provider_deletion_handoffs_verdict_id_key', '20260714102000'),
    ('court_provider_deletion_handoff_metrics', 'court_provider_deletion_handoff_metrics_pkey', '20260714102000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_pkey', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_target_idx', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_actor_idx', '20260714103000'),
    ('court_provider_request_key_reveal_audits', 'court_provider_request_key_reveal_audits_expiry_idx', '20260714103000')
), court_provider_required_table_stages(
  stage_name, table_name, max_version, expected_column_count,
  expected_constraint_count, expected_index_count, expected_policy_count,
  expected_service_select, expected_comment
) AS (
  VALUES
    ('handoff_1000', 'court_provider_deletion_handoffs', '20260714100000',
      22, 17, 4, 0, false,
      'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('handoff_1020', 'court_provider_deletion_handoffs', '20260714102000',
      25, 19, 5, 0, false,
      'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('handoff_1030', 'court_provider_deletion_handoffs', '20260714102000',
      25, 19, 5, 0, false,
      'Service-only, payload-free attempt handoff after a Court graph is deleted. No subject, case, input, request, verdict payload, mission, mode, category, tone, or safety-category data is retained.'),
    ('metrics_1020', 'court_provider_deletion_handoff_metrics', '20260714102000',
      7, 6, 1, 0, true,
      'Two-year aggregate-only deletion-handoff cleanup metrics. Contains no identifiers, request keys, model names, free text, or payloads.'),
    ('reveal_audit_1030', 'court_provider_request_key_reveal_audits', '20260714103000',
      7, 5, 4, 1, true,
      'Append-only one-year administrator audit of individual live or deleted-subject provider-key reveals. Contains an opaque target scope/id, administrator actor, action, and timestamps only; never a request key, subject, case, payload, model, usage, cost, or free-form text.')
), court_provider_table_stage_status AS (
  SELECT stage.stage_name,
         stage.table_name,
         table_row.oid IS NOT NULL AS present,
         CASE WHEN table_row.oid IS NULL THEN false ELSE
           table_row.relkind = 'r'
           AND table_row.relpersistence = 'p'
           AND table_row.relrowsecurity
           AND NOT table_row.relforcerowsecurity
           AND pg_get_userbyid(table_row.relowner) = 'postgres'
           AND obj_description(table_row.oid, 'pg_class') = stage.expected_comment
           AND (SELECT count(*) FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid = table_row.oid
                  AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped)
             = stage.expected_column_count
           AND NOT EXISTS (
             SELECT 1
             FROM court_provider_required_columns expected
             LEFT JOIN pg_catalog.pg_attribute attribute_row
               ON attribute_row.attrelid = table_row.oid
              AND attribute_row.attname = expected.column_name
              AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
             LEFT JOIN pg_catalog.pg_attrdef default_row
               ON default_row.adrelid = attribute_row.attrelid
              AND default_row.adnum = attribute_row.attnum
             WHERE expected.table_name = stage.table_name
               AND expected.introduced_version <= stage.max_version
               AND (attribute_row.attname IS NULL
                 OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
                   IS DISTINCT FROM expected.data_type
                 OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
                 OR attribute_row.attidentity <> ''
                 OR attribute_row.attgenerated <> ''
                 OR pg_get_expr(default_row.adbin, default_row.adrelid)
                   IS DISTINCT FROM expected.expected_default)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
                WHERE constraint_row.conrelid = table_row.oid)
             = stage.expected_constraint_count
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_constraint constraint_row
             WHERE constraint_row.conrelid = table_row.oid
               AND NOT constraint_row.convalidated
           )
           AND NOT EXISTS (
             SELECT 1
             FROM court_provider_required_named_constraints expected
             LEFT JOIN pg_catalog.pg_constraint constraint_row
               ON constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = expected.constraint_name
             WHERE expected.table_name = stage.table_name
               AND expected.introduced_version <= stage.max_version
               AND constraint_row.oid IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM court_provider_required_constraint_fragments expected
             LEFT JOIN pg_catalog.pg_constraint constraint_row
               ON constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = expected.constraint_name
             CROSS JOIN LATERAL (
               SELECT regexp_replace(
                 lower(coalesce(pg_get_constraintdef(constraint_row.oid, true), '')),
                 '[[:space:]()"]+', '', 'g'
               ) AS definition
             ) normalized
             WHERE expected.table_name = stage.table_name
               AND expected.introduced_version <= stage.max_version
               AND (constraint_row.oid IS NULL OR (
                 length(normalized.definition) - length(replace(
                   normalized.definition, expected.normalized_fragment, ''
                 ))
               ) / length(expected.normalized_fragment)
                 < expected.minimum_occurrences)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_index index_row
                WHERE index_row.indrelid = table_row.oid)
             = stage.expected_index_count
           AND NOT EXISTS (
             SELECT 1
             FROM court_provider_required_named_indexes expected
             LEFT JOIN pg_catalog.pg_class index_class
               ON index_class.relnamespace = 'public'::regnamespace
              AND index_class.relname = expected.index_name
             LEFT JOIN pg_catalog.pg_index index_row
               ON index_row.indexrelid = index_class.oid
              AND index_row.indrelid = table_row.oid
             WHERE expected.table_name = stage.table_name
               AND expected.introduced_version <= stage.max_version
               AND (index_row.indexrelid IS NULL
                 OR NOT index_row.indisvalid OR NOT index_row.indisready)
           )
           AND (SELECT count(*) FROM pg_catalog.pg_policies policy_row
                WHERE policy_row.schemaname = 'public'
                  AND policy_row.tablename = stage.table_name)
             = stage.expected_policy_count
           AND (stage.table_name <> 'court_provider_request_key_reveal_audits'
             OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_policies policy_row
               WHERE policy_row.schemaname = 'public'
                 AND policy_row.tablename = stage.table_name
                 AND policy_row.policyname =
                   'court_provider_request_key_reveal_audits_service_select'
                 AND policy_row.permissive = 'PERMISSIVE'
                 AND policy_row.roles = ARRAY['service_role'::name]
                 AND policy_row.cmd = 'SELECT'
                 AND policy_row.qual = 'true'
                 AND policy_row.with_check IS NULL
             ))
           AND has_table_privilege('service_role', table_row.oid, 'SELECT')
             = stage.expected_service_select
           AND has_any_column_privilege(
             'service_role', table_row.oid, 'SELECT'
           ) = stage.expected_service_select
           AND NOT has_table_privilege(
             'service_role', table_row.oid,
             'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
           )
           AND NOT has_any_column_privilege(
             'service_role', table_row.oid, 'INSERT,UPDATE,REFERENCES'
           )
           AND NOT has_table_privilege(
             'anon', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
           )
           AND NOT has_table_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
           )
           AND NOT has_any_column_privilege(
             'anon', table_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
           )
           AND NOT has_any_column_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'
           )
         END AS exact
  FROM court_provider_required_table_stages stage
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || stage.table_name)
), required_lifecycle_functions(signature) AS (
  VALUES
    ('public.get_or_rotate_invite_code_safely(uuid,boolean)'),
    ('public.restart_blocked_amora_couple_safely(uuid)'),
    ('public.join_couple_server(uuid,text,text,date,text,numeric,jsonb,date)'),
    ('public.create_amora_couple_safely(uuid,text,date,text,numeric,jsonb)'),
    ('public.begin_amora_membership_reset(uuid)'),
    ('public.begin_account_deletion(uuid)'),
    ('public.leave_amora_couple_safely(uuid,text)')
), lifecycle_function_contract AS (
  SELECT bool_and(status.present) AS all_present,
         bool_and(status.existing_replaceable) AS existing_replaceable,
         bool_and(status.exact) AS exact
  FROM required_lifecycle_functions required
  JOIN dependency_function_status status USING (signature)
), privacy_required_constraints(
  table_name, constraint_name, expected_definition
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_base_price_range',
      'CHECK (base_price IS NULL OR base_price >= 1 AND base_price <= 1000000)'),
    ('cohort_contracts', 'cohort_contracts_extra_price_range',
      'CHECK (extra_price IS NULL OR extra_price >= 0 AND extra_price <= 1000000)'),
    ('cohort_contracts', 'cohort_contracts_vendor_name_length',
      'CHECK (vendor_name = btrim(vendor_name) AND char_length(vendor_name) >= 1 AND char_length(vendor_name) <= 200)'),
    ('cohort_contracts', 'cohort_contracts_notes_length',
      'CHECK (notes IS NULL OR char_length(notes) <= 1000)'),
    ('customer_survey_responses', 'customer_survey_q23_contact_is_null',
      'CHECK (q23_contact IS NULL)'),
    ('customer_survey_responses', 'customer_survey_user_agent_is_null',
      'CHECK (user_agent IS NULL)')
), privacy_constraint_status AS (
  SELECT required.table_name,
         required.constraint_name,
         constraint_row.oid IS NOT NULL
           AND constraint_row.contype = 'c'
           AND constraint_row.convalidated
           AND pg_get_constraintdef(constraint_row.oid, true) =
             required.expected_definition AS exact
  FROM privacy_required_constraints required
  LEFT JOIN pg_catalog.pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass('public.' || required.table_name)
   AND constraint_row.conname = required.constraint_name
), privacy_required_policies(
  table_name, policy_name, expected_roles, expected_command,
  expected_qual, expected_with_check
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_select_own',
      ARRAY['authenticated'::name], 'SELECT', 'user_id=auth.uid', NULL::text),
    ('cohort_contracts', 'cohort_contracts_insert_active_member',
      ARRAY['authenticated'::name], 'INSERT', NULL::text,
      'user_id=auth.uidandis_cohort_memberroom_id'),
    ('cohort_contracts', 'cohort_contracts_update_active_member',
      ARRAY['authenticated'::name], 'UPDATE',
      'user_id=auth.uidandis_cohort_memberroom_id',
      'user_id=auth.uidandis_cohort_memberroom_id'),
    ('cohort_contracts', 'cohort_contracts_delete_own',
      ARRAY['authenticated'::name], 'DELETE', 'user_id=auth.uid', NULL::text),
    ('community_profiles', 'community_profiles_select_public_card',
      ARRAY['anon'::name, 'authenticated'::name], 'SELECT', 'true', NULL::text),
    ('community_achievements', 'community_achievements_select_own',
      ARRAY['authenticated'::name], 'SELECT', 'user_id=auth.uid', NULL::text)
), privacy_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles @> required.expected_roles
           AND policy_row.roles <@ required.expected_roles
           AND cardinality(policy_row.roles) = cardinality(required.expected_roles)
           AND policy_row.cmd = required.expected_command
           AND replace(regexp_replace(
             lower(coalesce(policy_row.qual, '')),
             '[[:space:]()"]+', '', 'g'
           ), 'public.', '') IS NOT DISTINCT FROM
             coalesce(required.expected_qual, '')
           AND replace(regexp_replace(
             lower(coalesce(policy_row.with_check, '')),
             '[[:space:]()"]+', '', 'g'
           ), 'public.', '') IS NOT DISTINCT FROM
             coalesce(required.expected_with_check, '') AS exact
  FROM privacy_required_policies required
  LEFT JOIN pg_catalog.pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
),
-- PROVISIONAL_ACTIVE_ADMIN_POLICY_CANONICAL: the legacy strings below were
-- captured read-only from the linked production catalog. The active strings
-- are the reviewed PostgreSQL 15 deparse expected from migration
-- 20260713110100, but must be captured from an applied disposable database
-- before the protected-production hard stop in supabase-ship-safe is removed.
active_admin_policy_expressions AS (
  SELECT
    'existsselect1fromprofileswhereprofiles.id=auth.uidandprofiles.is_admin=true'::text
      AS legacy_admin,
    'existsselect1fromprofileswhereprofiles.id=auth.uidandprofiles.is_admin=trueorauth.role=''service_role''::text'::text
      AS legacy_admin_service,
    'existsselect1fromprofilesprofilewhereprofile.id=selectauth.uidasuidandprofile.is_admin=trueandprofile.account_deleting_atisnull'::text
      AS active_admin,
    'selectauth.roleasrole=''service_role''::textorexistsselect1fromprofilesprofilewhereprofile.id=selectauth.uidasuidandprofile.is_admin=trueandprofile.account_deleting_atisnull'::text
      AS active_admin_service
), required_active_admin_policies(
  table_name, policy_name, expected_command, qual_kind,
  legacy_with_check, active_with_check
) AS (
  VALUES
    ('settlements', '관리자: 전체 정산 관리', 'ALL', 'admin', false, true),
    ('vendor_leads', 'vendor_leads_admin_all', 'ALL', 'admin_service', true, true),
    ('amora_quote_checks', 'amora_quote_checks_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_personas', 'community_agent_personas_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_personas', 'community_agent_personas_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_activity_log', 'community_agent_activity_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_activity_log', 'community_agent_activity_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_write', 'ALL', 'admin', true, true),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_select', 'SELECT', 'admin', false, false),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_write', 'ALL', 'admin', true, true)
), required_active_admin_table_policy_allowlist(table_name, policy_name) AS (
  VALUES
    ('settlements', '관리자: 전체 정산 관리'),
    ('settlements', '서비스: 전체 관리'),
    ('settlements', '업체: 본인 정산 조회'),
    ('vendor_leads', 'vendor_leads_admin_all'),
    ('amora_quote_checks', 'amora_quote_checks_admin_select'),
    ('amora_quote_checks', 'amora_quote_checks_owner_select'),
    ('amora_quote_checks', 'amora_quote_checks_service_all'),
    ('community_agent_personas', 'community_agent_personas_admin_select'),
    ('community_agent_personas', 'community_agent_personas_admin_write'),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_select'),
    ('community_agent_content_drafts', 'community_agent_drafts_admin_write'),
    ('community_agent_activity_log', 'community_agent_activity_admin_select'),
    ('community_agent_activity_log', 'community_agent_activity_admin_write'),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_select'),
    ('community_agent_daily_state', 'community_agent_daily_state_admin_write'),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_select'),
    ('community_agent_automation_runs', 'community_agent_automation_runs_admin_write')
), active_admin_policy_allowlist_inventory AS (
  SELECT
    (SELECT count(*) FROM required_active_admin_table_policy_allowlist)
      AS expected_count,
    (
      SELECT count(*)
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required_table
          WHERE required_table.table_name = policy_row.tablename
        )
    ) AS actual_count,
    (
      SELECT count(*)
      FROM required_active_admin_table_policy_allowlist required
      LEFT JOIN pg_catalog.pg_policies policy_row
        ON policy_row.schemaname = 'public'
       AND policy_row.tablename = required.table_name
       AND policy_row.policyname = required.policy_name
      WHERE policy_row.policyname IS NULL
    ) AS missing_count,
    (
      SELECT count(*)
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required_table
          WHERE required_table.table_name = policy_row.tablename
        )
        AND NOT EXISTS (
          SELECT 1
          FROM required_active_admin_table_policy_allowlist required
          WHERE required.table_name = policy_row.tablename
            AND required.policy_name = policy_row.policyname
        )
    ) AS unexpected_count
), active_admin_policy_allowlist_status AS (
  SELECT inventory.*,
         inventory.expected_count = 17
           AND inventory.actual_count = 17
           AND inventory.missing_count = 0
           AND inventory.unexpected_count = 0 AS exact
  FROM active_admin_policy_allowlist_inventory inventory
), active_admin_policy_status AS (
  SELECT required.table_name,
         required.policy_name,
         policy_row.policyname IS NOT NULL AS present,
         table_row.oid IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['public'::name]
           AND policy_row.cmd = required.expected_command
           AND (
             (
               normalized.qual = CASE required.qual_kind
                 WHEN 'admin_service' THEN expressions.legacy_admin_service
                 ELSE expressions.legacy_admin
               END
               AND CASE required.legacy_with_check
                 WHEN true THEN normalized.with_check = CASE required.qual_kind
                   WHEN 'admin_service' THEN expressions.legacy_admin_service
                   ELSE expressions.legacy_admin
                 END
                 ELSE policy_row.with_check IS NULL
               END
             )
             OR (
               normalized.qual = CASE required.qual_kind
                 WHEN 'admin_service' THEN expressions.active_admin_service
                 ELSE expressions.active_admin
               END
               AND CASE required.active_with_check
                 WHEN true THEN normalized.with_check = CASE required.qual_kind
                   WHEN 'admin_service' THEN expressions.active_admin_service
                   ELSE expressions.active_admin
                 END
                 ELSE policy_row.with_check IS NULL
               END
             )
           ) AS existing_replaceable,
         table_row.oid IS NOT NULL
           AND table_row.relkind = 'r'
           AND table_row.relrowsecurity
           AND policy_row.policyname IS NOT NULL
           AND policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['public'::name]
           AND policy_row.cmd = required.expected_command
           AND normalized.qual = CASE required.qual_kind
             WHEN 'admin_service' THEN expressions.active_admin_service
             ELSE expressions.active_admin
           END
           AND CASE required.active_with_check
             WHEN true THEN normalized.with_check = CASE required.qual_kind
               WHEN 'admin_service' THEN expressions.active_admin_service
               ELSE expressions.active_admin
             END
             ELSE policy_row.with_check IS NULL
           END AS exact
  FROM required_active_admin_policies required
  CROSS JOIN active_admin_policy_expressions expressions
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || required.table_name)
  LEFT JOIN pg_catalog.pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = required.table_name
   AND policy_row.policyname = required.policy_name
  CROSS JOIN LATERAL (
    SELECT
      replace(regexp_replace(
        lower(coalesce(policy_row.qual, '')),
        '[[:space:]()"]+', '', 'g'
      ), 'public.', '') AS qual,
      replace(regexp_replace(
        lower(coalesce(policy_row.with_check, '')),
        '[[:space:]()"]+', '', 'g'
      ), 'public.', '') AS with_check
  ) normalized
), active_admin_policy_contract AS (
  SELECT count(*) = 13
           AND coalesce(bool_and(status.existing_replaceable), false)
           AND coalesce((
             SELECT exact FROM active_admin_policy_allowlist_status
           ), false) AS replacement_safe,
         count(*) = 13
           AND coalesce(bool_and(status.exact), false)
           AND coalesce((
             SELECT exact FROM active_admin_policy_allowlist_status
           ), false) AS exact
  FROM active_admin_policy_status status
), privacy_required_functions(
  signature, expected_result, expected_security_definer,
  expected_volatility, expected_config, expected_source_md5,
  expected_authenticated_execute
) AS (
  VALUES
    ('public.enforce_cohort_contract_server_fields()', 'trigger', false, 'v'::"char",
      ARRAY['search_path=pg_catalog, pg_temp']::text[],
      'c9b67618721a1503d4b5cde6ea80b49c', false),
    ('public.get_my_community_activity_stats()',
      'TABLE(post_count integer, comment_count integer, total_upvotes_received integer)',
      true, 's'::"char",
      ARRAY['search_path=pg_catalog, pg_temp', 'row_security=off']::text[],
      '24ea2a1c3be0546fc47e0a1e97af5c99', true),
    ('public.redact_customer_survey_identifiers()', 'trigger', false, 'v'::"char",
      ARRAY['search_path=pg_catalog, pg_temp']::text[],
      'e0861e3c38e6df56c87deafd2c799a19', false)
), privacy_function_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND procedure_row.prosecdef = required.expected_security_definer
           AND procedure_row.provolatile = required.expected_volatility
           AND procedure_row.prokind = 'f'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND coalesce(cardinality(procedure_row.proconfig), 0) =
             cardinality(required.expected_config)
           AND coalesce(
             procedure_row.proconfig @> required.expected_config,
             false
           )
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           ) = required.expected_authenticated_execute
           AND NOT has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) AS exact
  FROM privacy_required_functions required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), privacy_required_triggers(
  table_name, trigger_name, function_signature
) AS (
  VALUES
    ('cohort_contracts', 'cohort_contracts_enforce_server_fields',
      'public.enforce_cohort_contract_server_fields()'),
    ('customer_survey_responses', 'customer_survey_identifiers_are_redacted',
      'public.redact_customer_survey_identifiers()')
), privacy_trigger_status AS (
  SELECT required.table_name,
         required.trigger_name,
         trigger_row.oid IS NOT NULL
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgtype = 23
           AND octet_length(trigger_row.tgargs) = 0
           AND trigger_row.tgfoid =
             to_regprocedure(required.function_signature) AS exact
  FROM privacy_required_triggers required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass('public.' || required.table_name)
   AND trigger_row.tgname = required.trigger_name
   AND NOT trigger_row.tgisinternal
), privacy_required_view_columns(
  view_name, ordinal_position, column_name, expected_type
) AS (
  VALUES
    ('cohort_stats', 1, 'room_id', 'uuid'),
    ('cohort_stats', 2, 'category', 'text'),
    ('cohort_stats', 3, 'sample_size', 'bigint'),
    ('cohort_stats', 4, 'avg_base_price', 'integer'),
    ('cohort_stats', 5, 'avg_extra_price', 'integer'),
    ('cohort_stats', 6, 'avg_total', 'integer'),
    ('cohort_room_contributor_stats', 1, 'room_id', 'uuid'),
    ('cohort_room_contributor_stats', 2, 'contributor_count', 'bigint'),
    ('cohort_room_contributor_stats', 3, 'threshold_met', 'boolean')
), privacy_view_status AS (
  SELECT required_view.view_name,
         view_row.oid IS NOT NULL
           AND view_row.relkind = 'v'
           AND view_row.reloptions = ARRAY['security_invoker=true']::text[]
           AND pg_get_userbyid(view_row.relowner) = 'postgres'
           AND has_table_privilege(
             'service_role', view_row.oid, 'SELECT'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'INSERT'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'UPDATE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'DELETE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'TRUNCATE'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'REFERENCES'
           )
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'TRIGGER'
           )
           AND NOT has_any_column_privilege(
             'anon', view_row.oid, 'SELECT'
           )
           AND NOT has_any_column_privilege(
             'authenticated', view_row.oid, 'SELECT'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM privacy_required_view_columns expected
             LEFT JOIN pg_catalog.pg_attribute attribute_row
               ON attribute_row.attrelid = view_row.oid
              AND attribute_row.attnum = expected.ordinal_position
              AND attribute_row.attname = expected.column_name
              AND pg_catalog.format_type(
                attribute_row.atttypid, attribute_row.atttypmod
              ) = expected.expected_type
              AND NOT attribute_row.attisdropped
             WHERE expected.view_name = required_view.view_name
               AND attribute_row.attrelid IS NULL
           )
           AND (
             SELECT count(*)
             FROM pg_catalog.pg_attribute attribute_row
             WHERE attribute_row.attrelid = view_row.oid
               AND attribute_row.attnum > 0
               AND NOT attribute_row.attisdropped
           ) = required_view.expected_column_count
           AND CASE required_view.view_name
             WHEN 'cohort_stats' THEN
               strpos(required_view.normalized_definition,
                 'distinctoncontract.room_id,contract.category,contract.user_id') > 0
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thencount\*(elsenull::bigint)?endassample_size'
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thenroundavglatest\.base_price::integer(elsenull::integer)?endasavg_base_price'
               AND required_view.normalized_definition ~
                 'casewhencountlatest\.extra_price>=5andcountlatest\.extra_price=count\*thenroundavglatest\.extra_price::integer(elsenull::integer)?endasavg_extra_price'
               AND required_view.normalized_definition ~
                 'casewhencountlatest\.extra_price>=5andcountlatest\.extra_price=count\*thenroundavglatest\.base_price\+latest\.extra_pricefilterwherelatest\.extra_priceisnotnull::integer(elsenull::integer)?endasavg_total'
               AND strpos(required_view.normalized_definition,
                 'contract.base_price>=1') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.base_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_priceisnull') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price>=0') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'orderbycontract.room_id,contract.category,contract.user_id,contract.created_atdescnullslast,contract.iddesc') > 0
             WHEN 'cohort_room_contributor_stats' THEN
               strpos(required_view.normalized_definition,
                 'selectdistinctcontract.room_id,contract.user_id') > 0
               AND required_view.normalized_definition ~
                 'casewhencount\*>=5thencount\*(elsenull::bigint)?endascontributor_count'
               AND required_view.normalized_definition ~
                 'count\*>=5asthreshold_met'
               AND strpos(required_view.normalized_definition,
                 'contract.base_price>=1') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.base_price<=1000000') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_priceisnull') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price>=0') > 0
               AND strpos(required_view.normalized_definition,
                 'contract.extra_price<=1000000') > 0
             ELSE false
           END AS exact
  FROM (
    SELECT expected.view_name,
           count(*)::bigint AS expected_column_count,
           regexp_replace(
             lower(coalesce(pg_get_viewdef(
               to_regclass('public.' || expected.view_name), true
             ), '')),
             '[[:space:]()"]+', '', 'g'
           ) AS normalized_definition
    FROM privacy_required_view_columns expected
    GROUP BY expected.view_name
  ) required_view
  LEFT JOIN pg_catalog.pg_class view_row
    ON view_row.oid = to_regclass('public.' || required_view.view_name)
), privacy_expected_view_acl(
  view_name, grantee, expected_privileges
) AS (
  VALUES
    ('cohort_stats', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_stats', 'anon', ARRAY[]::text[]),
    ('cohort_stats', 'authenticated', ARRAY[]::text[]),
    ('cohort_stats', 'service_role', ARRAY['SELECT']::text[]),
    ('cohort_room_contributor_stats', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'anon', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'authenticated', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', 'service_role', ARRAY['SELECT']::text[])
), privacy_view_acl AS (
  SELECT coalesce(bool_and(
    coalesce((
      SELECT array_agg(
        privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      )
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = expected.view_name
        AND privilege_row.grantee = expected.grantee
    ), ARRAY[]::text[]) = expected.expected_privileges
  ), false) AS exact
  FROM privacy_expected_view_acl expected
), privacy_profile_column_acl AS (
  SELECT coalesce(bool_and(
    has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
    ) = (attribute_row.attname = ANY (
      ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']
    ))
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
    AND has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
    ) = (attribute_row.attname = ANY (
      ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']
    ))
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
  ), false) AS exact
  FROM pg_catalog.pg_attribute attribute_row
  WHERE attribute_row.attrelid = to_regclass('public.community_profiles')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped
), privacy_expected_table_acl(
  table_name, grantee, expected_privileges
) AS (
  VALUES
    ('cohort_contracts', 'PUBLIC', ARRAY[]::text[]),
    ('cohort_contracts', 'anon', ARRAY[]::text[]),
    ('cohort_contracts', 'authenticated',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('cohort_contracts', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_profiles', 'PUBLIC', ARRAY[]::text[]),
    ('community_profiles', 'anon', ARRAY[]::text[]),
    ('community_profiles', 'authenticated', ARRAY[]::text[]),
    ('community_profiles', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_achievements', 'PUBLIC', ARRAY[]::text[]),
    ('community_achievements', 'anon', ARRAY[]::text[]),
    ('community_achievements', 'authenticated', ARRAY['SELECT']::text[]),
    ('community_achievements', 'service_role',
      ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
    ('community_vendor_tags', 'PUBLIC', ARRAY[]::text[]),
    ('community_vendor_tags', 'anon', ARRAY[]::text[]),
    ('community_vendor_tags', 'authenticated', ARRAY[]::text[]),
    ('community_vendor_tags', 'service_role', ARRAY['SELECT']::text[])
), privacy_table_acl AS (
  SELECT coalesce(bool_and(
    coalesce((
      SELECT array_agg(
        privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      )
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = expected.table_name
        AND privilege_row.grantee = expected.grantee
    ), ARRAY[]::text[]) = expected.expected_privileges
  ), false) AS exact
  FROM privacy_expected_table_acl expected
), privacy_expected_effective_acl AS (
  SELECT
    expected.table_name AS object_name,
    expected.grantee,
    expected.expected_privileges AS expected_table_privileges,
    CASE
      WHEN expected.table_name = 'community_profiles'
        AND expected.grantee IN ('anon', 'authenticated')
      THEN ARRAY['SELECT']::text[]
      ELSE ARRAY(
        SELECT privilege
        FROM unnest(expected.expected_privileges) privilege
        WHERE privilege = ANY (
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]
        )
        ORDER BY privilege
      )
    END AS expected_column_privileges
  FROM privacy_expected_table_acl expected

  UNION ALL

  SELECT
    expected.view_name AS object_name,
    expected.grantee,
    expected.expected_privileges AS expected_table_privileges,
    ARRAY(
      SELECT privilege
      FROM unnest(expected.expected_privileges) privilege
      WHERE privilege = ANY (
        ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]
      )
      ORDER BY privilege
    ) AS expected_column_privileges
  FROM privacy_expected_view_acl expected
), privacy_effective_acl AS (
  SELECT coalesce(bool_and(
    CASE
      WHEN expected.grantee = 'PUBLIC' THEN
        cardinality(expected.expected_table_privileges) = 0
        AND cardinality(expected.expected_column_privileges) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.table_privileges privilege_row
          WHERE privilege_row.table_schema = 'public'
            AND privilege_row.table_name = expected.object_name
            AND privilege_row.grantee = 'PUBLIC'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.column_privileges privilege_row
          WHERE privilege_row.table_schema = 'public'
            AND privilege_row.table_name = expected.object_name
            AND privilege_row.grantee = 'PUBLIC'
        )
      ELSE
        coalesce((
          SELECT bool_and(
            pg_catalog.has_table_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              privilege
            ) = (privilege = ANY (expected.expected_table_privileges))
          )
          FROM unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER'
          ]::text[]) privilege
        ), false)
        AND coalesce((
          SELECT bool_and(
            pg_catalog.has_any_column_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              privilege
            ) = (privilege = ANY (expected.expected_column_privileges))
          )
          FROM unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          ]::text[]) privilege
        ), false)
    END
  ), false) AS exact
  FROM privacy_expected_effective_acl expected
), privacy_minimum_contract AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM privacy_constraint_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_policy_status
      WHERE exact IS DISTINCT FROM true
    )
    AND 6 = (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'cohort_contracts', 'community_profiles',
          'community_achievements', 'community_vendor_tags'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_function_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_trigger_status
      WHERE exact IS DISTINCT FROM true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_view_status
      WHERE exact IS DISTINCT FROM true
    )
    AND coalesce((SELECT exact FROM privacy_view_acl), false)
    AND coalesce((SELECT exact FROM privacy_profile_column_acl), false)
    AND coalesce((SELECT exact FROM privacy_table_acl), false)
    AND coalesce((SELECT exact FROM privacy_effective_acl), false)
    AND NOT has_any_column_privilege(
      'anon', 'public.cohort_contracts', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'anon', 'public.community_achievements', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'anon', 'public.community_vendor_tags', 'SELECT'
    )
    AND NOT has_any_column_privilege(
      'authenticated', 'public.community_vendor_tags', 'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class table_row
      WHERE table_row.oid IN (
        to_regclass('public.cohort_contracts'),
        to_regclass('public.community_profiles'),
        to_regclass('public.community_achievements'),
        to_regclass('public.community_vendor_tags')
      )
        AND (table_row.relkind <> 'r' OR NOT table_row.relrowsecurity)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_survey_responses
      WHERE q23_contact IS NOT NULL OR user_agent IS NOT NULL
    ) AS exact
), wedding_code_collection_retirement_inventory AS (
  SELECT
    table_row.oid IS NOT NULL AS table_present,
    table_row.oid IS NOT NULL
      AND table_row.relkind = 'r'
      AND table_row.relpersistence = 'p'
      AND table_row.relrowsecurity
      AND NOT table_row.relforcerowsecurity
      AND pg_get_userbyid(table_row.relowner) = 'postgres'
      AND obj_description(table_row.oid, 'pg_class') =
        'Retired WeddingCode collection. Historical rows are preserved; any deletion requires a separate approved retention/purge migration.'
      AS table_contract_exact,
    table_row.oid IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role'
      ]::text[]) AS application_role(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER'
      ]::text[]) AS table_privilege(privilege_name)
      WHERE has_table_privilege(
        application_role.role_name,
        table_row.oid,
        table_privilege.privilege_name
      )
    ) AS table_acl_closed,
    table_row.oid IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role'
      ]::text[]) AS application_role(role_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
      ]::text[]) AS column_privilege(privilege_name)
      WHERE has_any_column_privilege(
        application_role.role_name,
        table_row.oid,
        column_privilege.privilege_name
      )
    ) AS column_acl_closed,
    (SELECT count(*)
     FROM pg_catalog.pg_policy policy_row
     WHERE policy_row.polrelid = table_row.oid) AS policy_count,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_row.oid
        AND constraint_row.conname = 'wedding_code_collection_retired'
    ) AS constraint_present,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_row.oid
        AND constraint_row.conname = 'wedding_code_collection_retired'
        AND constraint_row.contype = 'c'
        AND NOT constraint_row.convalidated
        AND NOT constraint_row.condeferrable
        AND NOT constraint_row.condeferred
        AND NOT constraint_row.connoinherit
        AND constraint_row.conislocal
        AND constraint_row.coninhcount = 0
        AND pg_get_expr(
          constraint_row.conbin, constraint_row.conrelid, true
        ) IN ('false', '(false)')
        AND pg_get_constraintdef(constraint_row.oid, true) =
          'CHECK (false) NOT VALID'
        AND obj_description(constraint_row.oid, 'pg_constraint') =
          'Retirement fence: rejects every INSERT and UPDATE without scanning preserved historical rows. DELETE requires a separate approved purge migration.'
    ) AS constraint_exact,
    (SELECT count(*)
     FROM pg_catalog.pg_proc procedure_row
     JOIN pg_catalog.pg_namespace namespace_row
       ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname = 'insert_wedding_code_response')
      AS insert_rpc_overload_count,
    (SELECT count(*)
     FROM pg_catalog.pg_proc procedure_row
     JOIN pg_catalog.pg_namespace namespace_row
       ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname = 'pair_wedding_code_response')
      AS pair_rpc_overload_count
  FROM (SELECT
    to_regclass('public.wedding_code_responses') AS table_oid
  ) object_ids
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = object_ids.table_oid
), wedding_code_collection_retirement_modes AS (
  SELECT inventory.*,
         NOT inventory.table_present
           AND inventory.insert_rpc_overload_count = 0
           AND inventory.pair_rpc_overload_count = 0 AS absent_exact,
         inventory.table_contract_exact
           AND inventory.table_acl_closed
           AND inventory.column_acl_closed
           AND inventory.policy_count = 0
           AND inventory.constraint_exact
           AND inventory.insert_rpc_overload_count = 0
           AND inventory.pair_rpc_overload_count = 0 AS retired_exact
  FROM wedding_code_collection_retirement_inventory inventory
), wedding_code_collection_retirement_status AS (
  SELECT mode_row.*,
         CASE
           WHEN mode_row.absent_exact THEN 'absent'
           WHEN mode_row.retired_exact THEN 'retired'
           ELSE 'unsafe'
         END AS boundary_mode,
         mode_row.absent_exact OR mode_row.retired_exact AS exact
  FROM wedding_code_collection_retirement_modes mode_row
), schema_capabilities AS (
  SELECT
    to_regclass('public.wedding_code_responses') IS NOT NULL
      AS wedding_code_responses_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'wedding_base'), false)
      AND coalesce((SELECT exact FROM dynamic_default_contracts WHERE contract_name = 'wedding_base'), false)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.wedding_code_responses')
          AND table_row.relkind = 'r' AND table_row.relrowsecurity
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = to_regclass('public.wedding_code_responses')
          AND constraint_row.conname = 'wedding_code_responses_pkey'
          AND constraint_row.convalidated
          AND pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (id)'
      ) AS wedding_code_base_contract_exact,
    (SELECT to_jsonb(status_row)
     FROM wedding_code_collection_retirement_status status_row)
      AS wedding_code_collection_retirement_status,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'wedding_couple_token'), false)
      AS wedding_couple_token_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'wedding_couple_token'), false)
      AS wedding_couple_token_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'wedding_submission_id'), false)
      AS wedding_submission_id_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'wedding_submission_id'), false)
      AS wedding_submission_id_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'wedding_scoring_version'), false)
      AS wedding_scoring_version_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'wedding_scoring_version'), false)
      AS wedding_scoring_version_contract_exact,
    to_regclass('public.amora_request_claims') IS NOT NULL
      AS amora_request_claims_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'amora_claims_base'), false)
      AND coalesce((SELECT exact FROM dynamic_default_contracts WHERE contract_name = 'amora_claims_base'), false)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.amora_request_claims')
          AND table_row.relkind = 'r' AND table_row.relrowsecurity
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = to_regclass('public.amora_request_claims')
          AND constraint_row.conname = 'amora_request_claims_pkey'
          AND constraint_row.convalidated
          AND pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (request_key)'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('amora_request_claims_request_key_check',
            'CHECK (request_key ~ ''^[a-f0-9]{64}$''::text)'),
          ('amora_request_claims_request_hash_check',
            'CHECK (request_hash ~ ''^[a-f0-9]{64}$''::text)'),
          ('amora_request_claims_visibility_check',
            'CHECK (visibility = ANY (ARRAY[''shared''::text, ''bride_private''::text, ''groom_private''::text]))'),
          ('amora_request_claims_status_check',
            'CHECK (status = ANY (ARRAY[''in_progress''::text, ''completed''::text, ''failed''::text]))')
        ) expected(constraint_name, expected_definition)
        LEFT JOIN pg_catalog.pg_constraint constraint_row
          ON constraint_row.conrelid = to_regclass('public.amora_request_claims')
         AND constraint_row.conname = expected.constraint_name
        WHERE constraint_row.oid IS NULL
           OR NOT constraint_row.convalidated
           OR pg_get_constraintdef(constraint_row.oid, true)
             IS DISTINCT FROM expected.expected_definition
      ) AS amora_request_claims_base_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'amora_claim_lease'), false)
      AS amora_claim_lease_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'amora_claim_lease'), false)
      AS amora_claim_lease_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'amora_lifecycle'), false)
      AS amora_lifecycle_contract_present,
    coalesce((SELECT existing_compatible FROM dynamic_column_contracts WHERE contract_name = 'amora_lifecycle'), false)
      AND coalesce((SELECT existing_compatible FROM dynamic_default_contracts WHERE contract_name = 'amora_lifecycle'), false)
      AS amora_lifecycle_existing_compatible,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'amora_lifecycle'), false)
      AND coalesce((SELECT exact FROM dynamic_default_contracts WHERE contract_name = 'amora_lifecycle'), false)
      AS amora_lifecycle_contract_exact,
    (SELECT jsonb_object_agg(
       status.signature,
       to_jsonb(status) - 'signature'
       ORDER BY status.signature
     ) FROM dependency_function_status status) AS dependency_function_status,
    (SELECT jsonb_object_agg(
       status.signature,
       to_jsonb(status) - 'signature'
       ORDER BY status.signature
     ) FROM client_denied_trigger_function_status status)
      AS client_denied_trigger_function_status,
    (SELECT jsonb_object_agg(
       status.schema_name || '.' || status.table_name || '.' || status.trigger_name,
       to_jsonb(status) - 'schema_name' - 'table_name' - 'trigger_name'
       ORDER BY status.schema_name, status.table_name, status.trigger_name
     ) FROM client_denied_trigger_binding_status status)
      AS client_denied_trigger_binding_status,
    coalesce((SELECT present FROM amora_reset_read_helper_status), false)
      AS amora_reset_read_helper_present,
    coalesce((SELECT existing_replaceable FROM amora_reset_read_helper_status), false)
      AS amora_reset_read_helper_existing_replaceable,
    coalesce((SELECT exact FROM amora_reset_read_helper_status), false)
      AS amora_reset_read_helper_exact,
    NOT EXISTS (
      SELECT 1 FROM amora_reset_read_policy_status WHERE NOT existing_replaceable
    ) AS amora_reset_read_policy_replacement_safe,
    NOT EXISTS (
      SELECT 1 FROM amora_reset_read_policy_status WHERE NOT exact
    ) AS amora_reset_read_policies_exact,
    (SELECT jsonb_object_agg(
       status.table_name || '.' || status.policy_name,
       to_jsonb(status) - 'table_name' - 'policy_name'
       ORDER BY status.table_name, status.policy_name
     ) FROM amora_reset_read_policy_status status)
      AS amora_reset_read_policy_status,
    coalesce((
      SELECT replacement_safe FROM active_admin_policy_contract
    ), false) AS active_admin_policy_replacement_safe,
    coalesce((
      SELECT exact FROM active_admin_policy_contract
    ), false) AS active_admin_policies_exact,
    coalesce((
      SELECT exact FROM active_admin_policy_allowlist_status
    ), false) AS active_admin_policy_allowlist_exact,
    (SELECT to_jsonb(status)
     FROM active_admin_policy_allowlist_status status)
      AS active_admin_policy_allowlist_status,
    (SELECT jsonb_object_agg(
       status.table_name || '.' || status.policy_name,
       to_jsonb(status) - 'table_name' - 'policy_name'
       ORDER BY status.table_name, status.policy_name
     ) FROM active_admin_policy_status status)
      AS active_admin_policy_status,
    (SELECT jsonb_object_agg(
       status.job_name,
       to_jsonb(status) - 'job_name'
       ORDER BY status.job_name
     ) FROM dependency_cron_status status) AS dependency_cron_status,
    (SELECT jsonb_object_agg(
       status.stage_name,
       to_jsonb(status) - 'stage_name'
       ORDER BY status.stage_name
     ) FROM court_provider_table_stage_status status)
      AS court_provider_table_stage_status,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'care_notifications'), false)
      AS care_notifications_column_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'care_notifications'), false)
      AS care_notifications_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'profile_phone'), false)
      AS profile_phone_column_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'profile_phone'), false)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.profiles'::regclass
          AND constraint_row.conname = 'profiles_phone_format_check'
          AND constraint_row.convalidated
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'CHECK (phone IS NULL OR phone ~ ''^01[016789][0-9]{7,8}$''::text)'
      ) AS profile_phone_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'profile_phone_care_consent'), false)
      AS phone_care_consent_column_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'profile_phone_care_consent'), false)
      AS phone_care_consent_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'profile_push_token'), false)
      AS profile_push_token_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'profile_push_token'), false)
      AS profile_push_token_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'rate_limit_subject'), false)
      AS rate_limit_subject_column_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'rate_limit_subject'), false)
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        LEFT JOIN pg_catalog.pg_attrdef default_row
          ON default_row.adrelid = attribute_row.attrelid
         AND default_row.adnum = attribute_row.attnum
        WHERE attribute_row.attrelid = to_regclass('public.rate_limit_buckets')
          AND attribute_row.attname = 'subject_user_id'
          AND attribute_row.attidentity = ''
          AND attribute_row.attgenerated = ''
          AND default_row.oid IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = to_regclass('public.rate_limit_buckets')
          AND constraint_row.conname = 'rate_limit_buckets_subject_user_id_fkey'
          AND constraint_row.convalidated
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE CASCADE'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class index_class
        JOIN pg_catalog.pg_index index_row
          ON index_row.indexrelid = index_class.oid
        WHERE index_class.relnamespace = 'public'::regnamespace
          AND index_class.relname = 'idx_rate_limit_buckets_subject_user_id'
          AND index_row.indisvalid
          AND index_row.indisready
          AND pg_get_indexdef(index_class.oid) =
            'CREATE INDEX idx_rate_limit_buckets_subject_user_id ON public.rate_limit_buckets USING btree (subject_user_id) WHERE (subject_user_id IS NOT NULL)'
      )
      AND has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'DELETE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'INSERT'
      )
      AND NOT has_any_column_privilege(
        'service_role', 'public.rate_limit_buckets', 'INSERT'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'UPDATE'
      )
      AND NOT has_any_column_privilege(
        'service_role', 'public.rate_limit_buckets', 'UPDATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'TRUNCATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'REFERENCES'
      )
      AND NOT has_any_column_privilege(
        'service_role', 'public.rate_limit_buckets', 'REFERENCES'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'TRIGGER'
      ) AS rate_limit_subject_contract_exact,
    to_regclass('public.account_deletion_jobs') IS NOT NULL
      AS account_deletion_jobs_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'account_deletion_jobs_base'), false)
      AND coalesce((SELECT exact FROM dynamic_default_contracts WHERE contract_name = 'account_deletion_jobs_base'), false)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.account_deletion_jobs')
          AND table_row.relkind = 'r' AND table_row.relrowsecurity
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
          AND constraint_row.conname = 'account_deletion_jobs_pkey'
          AND constraint_row.convalidated
          AND pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY (id)'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('account_deletion_jobs_user_id_key',
            'UNIQUE (user_id)'),
          ('account_deletion_jobs_reason_check',
            'CHECK (reason = ANY (ARRAY[''unsatisfied''::text, ''alternative''::text, ''wedding_done''::text, ''privacy''::text, ''low_usage''::text, ''other''::text, ''unknown''::text]))'),
          ('account_deletion_jobs_status_check',
            'CHECK (status = ANY (ARRAY[''pending''::text, ''processing''::text, ''retry''::text, ''dead_letter''::text, ''completed''::text]))'),
          ('account_deletion_jobs_attempts_check',
            'CHECK (attempts >= 0 AND attempts <= 8)'),
          ('account_deletion_jobs_check',
            'CHECK ((status = ''completed''::text) = (completed_at IS NOT NULL))'),
          ('account_deletion_jobs_check1',
            'CHECK (status <> ''completed''::text OR user_id IS NULL)'),
          ('account_deletion_jobs_check2',
            'CHECK (status <> ''processing''::text OR lock_token IS NOT NULL AND locked_until IS NOT NULL)'),
          ('account_deletion_jobs_check3',
            'CHECK (status = ''processing''::text OR lock_token IS NULL AND locked_until IS NULL)'),
          ('account_deletion_jobs_last_error_code_check',
            'CHECK (last_error_code IS NULL OR last_error_code ~ ''^[A-Z0-9_]{1,64}$''::text)'),
          ('account_deletion_jobs_storage_inventory_check',
            'CHECK (storage_inventory IS NULL OR jsonb_typeof(storage_inventory) = ''array''::text)')
        ) expected(constraint_name, expected_definition)
        LEFT JOIN pg_catalog.pg_constraint constraint_row
          ON constraint_row.conrelid = to_regclass('public.account_deletion_jobs')
         AND constraint_row.conname = expected.constraint_name
        WHERE constraint_row.oid IS NULL
           OR NOT constraint_row.convalidated
           OR pg_get_constraintdef(constraint_row.oid, true)
             IS DISTINCT FROM expected.expected_definition
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('account_deletion_jobs_due_idx',
            'CREATE INDEX account_deletion_jobs_due_idx ON public.account_deletion_jobs USING btree (next_attempt_at, created_at) WHERE (status = ANY (ARRAY[''pending''::text, ''retry''::text]))'),
          ('account_deletion_jobs_stale_lock_idx',
            'CREATE INDEX account_deletion_jobs_stale_lock_idx ON public.account_deletion_jobs USING btree (locked_until) WHERE (status = ''processing''::text)'),
          ('account_deletion_jobs_dead_letter_idx',
            'CREATE INDEX account_deletion_jobs_dead_letter_idx ON public.account_deletion_jobs USING btree (dead_lettered_at DESC) WHERE (status = ''dead_letter''::text)')
        ) expected(index_name, expected_definition)
        LEFT JOIN pg_catalog.pg_class index_class
          ON index_class.relnamespace = 'public'::regnamespace
         AND index_class.relname = expected.index_name
        LEFT JOIN pg_catalog.pg_index index_row
          ON index_row.indexrelid = index_class.oid
        WHERE index_class.oid IS NULL
           OR NOT index_row.indisvalid
           OR NOT index_row.indisready
           OR pg_get_indexdef(index_class.oid)
             IS DISTINCT FROM expected.expected_definition
      ) AS account_deletion_jobs_base_contract_exact,
    (SELECT count(*)
     FROM pg_catalog.pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN (
         'vendor images own folder insert',
         'vendor licenses own folder insert'
       )) AS vendor_storage_policy_name_count,
    (SELECT count(*)
     FROM pg_catalog.pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN (
         '업체: 본인 이미지 업로드',
         '업체: 사업자등록증 업로드',
         'vendor images own folder insert',
         'vendor licenses own folder insert'
       )) AS vendor_storage_all_insert_policy_name_count,
    coalesce((
      SELECT count(*) = 2 AND bool_and(
        policy_row.permissive = 'PERMISSIVE'
        AND policy_row.roles::text = '{authenticated}'
        AND policy_row.cmd = 'INSERT'
        AND policy_row.qual IS NULL
        AND policy_row.with_check = CASE policy_row.policyname
          WHEN 'vendor images own folder insert' THEN
            '((bucket_id = ''vendor-images''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))'
          WHEN 'vendor licenses own folder insert' THEN
            '((bucket_id = ''vendor-licenses''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))'
        END
      )
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'storage'
        AND policy_row.tablename = 'objects'
        AND policy_row.policyname IN (
          'vendor images own folder insert',
          'vendor licenses own folder insert'
        )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies legacy_policy
        WHERE legacy_policy.schemaname = 'storage'
          AND legacy_policy.tablename = 'objects'
          AND legacy_policy.policyname IN (
            '업체: 본인 이미지 업로드',
            '업체: 사업자등록증 업로드'
          )
      )
    ), false) AS vendor_storage_policies_contract_exact,
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies policy_row
      WHERE policy_row.schemaname = 'storage'
        AND policy_row.tablename = 'objects'
        AND policy_row.policyname IN (
          '업체: 본인 이미지 업로드',
          '업체: 사업자등록증 업로드',
          'vendor images own folder insert',
          'vendor licenses own folder insert'
        )
    ) AS vendor_storage_uploads_disabled_contract_exact,
    (SELECT count(*)::bigint
     FROM storage.objects
     WHERE bucket_id = 'vendor-licenses') AS vendor_license_object_count,
    (SELECT count(*)::bigint
     FROM storage.objects
     WHERE bucket_id = 'vendor-images'
       AND (storage.foldername(name))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      AS vendor_uuid_image_object_count,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'preregistration_expiry'), false)
      AS preregistration_expiry_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'preregistration_expiry'), false)
      AS preregistration_expiry_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'account_deletion_email_attestation'), false)
      AS account_deletion_email_attestation_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'account_deletion_email_attestation'), false)
      AS account_deletion_email_attestation_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'account_deletion_auth_ready'), false)
      AS account_deletion_auth_ready_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'account_deletion_auth_ready'), false)
      AND coalesce((SELECT exact FROM dynamic_default_contracts WHERE contract_name = 'account_deletion_auth_ready'), false)
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        WHERE attribute_row.attrelid =
            to_regclass('public.account_deletion_jobs')
          AND attribute_row.attname = 'auth_delete_ready_until'
          AND attribute_row.attnum > 0
          AND NOT attribute_row.attisdropped
          AND attribute_row.attidentity = ''
          AND attribute_row.attgenerated = ''
      )
      AS account_deletion_auth_ready_contract_exact,
    coalesce((SELECT all_present FROM dynamic_column_contracts WHERE contract_name = 'research_cohort_applications'), false)
      AS research_cohort_applications_present,
    coalesce((SELECT exact FROM dynamic_column_contracts WHERE contract_name = 'research_cohort_applications'), false)
      AS research_cohort_applications_contract_exact,
    coalesce((SELECT exact FROM privacy_minimum_contract), false)
      AS privacy_minimum_contract_exact,
    (SELECT count(*)::bigint
     FROM public.cohort_contracts contract
     WHERE (contract.base_price IS NOT NULL AND (
              contract.base_price < 1 OR contract.base_price > 1000000
            ))
        OR (contract.extra_price IS NOT NULL AND (
              contract.extra_price < 0 OR contract.extra_price > 1000000
            ))
        OR contract.vendor_name <> btrim(contract.vendor_name)
        OR char_length(contract.vendor_name) < 1
        OR char_length(contract.vendor_name) > 200
        OR (contract.notes IS NOT NULL AND char_length(contract.notes) > 1000))
      AS privacy_minimum_invalid_cohort_rows
)
SELECT jsonb_build_object(
  'dynamic_sources', (SELECT to_jsonb(c) FROM schema_capabilities c),
  'invitation_retirement', jsonb_build_object(
    'visits_present', to_regclass('public.invitation_visits') IS NOT NULL,
    'guestbook_present', to_regclass('public.invitation_guestbook') IS NOT NULL,
    'rsvp_present', to_regclass('public.invitation_rsvp') IS NOT NULL,
    'accounts_present', to_regclass('public.invitation_accounts') IS NOT NULL,
    'photos_table_present', to_regclass('public.invitation_photos') IS NOT NULL,
    'invitations_present', to_regclass('public.invitations') IS NOT NULL,
    'templates_present', to_regclass('public.invitation_templates') IS NOT NULL,
    'ai_scripts_present', to_regclass('public.ai_scripts') IS NOT NULL,
    'photo_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'invitation-photos')
  ),
  'amora_legacy_gate', (
    SELECT to_jsonb(m) || jsonb_build_object(
      'gate_will_pass', orphan + inconsistent + private_scopes + stale_shared
        + legacy_null_sender_shared + legacy_payloads + detached_raw_audits
        + private_clear_artifacts + unproven_private_derived
        + orphan_feedback + ai_fk_orphans = 0
    )
    FROM amora_metrics m
  ),
  'account_deletion_gate', jsonb_build_object(
    'jobs_table_present', to_regclass('public.account_deletion_jobs') IS NOT NULL,
    'processing_jobs', (SELECT count(*)
      FROM public.account_deletion_jobs AS job
      WHERE job.status = 'processing'),
    'active_jobs_missing_auth_subject', (SELECT count(*)
      FROM public.account_deletion_jobs AS job
      LEFT JOIN auth.users AS auth_user ON auth_user.id = job.user_id
      WHERE job.status <> 'completed'
        AND (job.user_id IS NULL OR auth_user.id IS NULL)),
    'email_snapshot_backfills', (SELECT count(*)
      FROM public.account_deletion_jobs AS job
      WHERE job.status <> 'completed'
        AND to_jsonb(job)->>'email_snapshot_at' IS NULL),
    'legacy_rows_scrubbed', (SELECT count(*) FROM public.account_deletions
      WHERE user_id IS NOT NULL OR email IS NOT NULL OR reason IS NULL
         OR reason NOT IN ('unsatisfied', 'alternative', 'wedding_done', 'privacy', 'low_usage', 'other', 'unknown')),
    'guestbook_owners_over_498', (SELECT count(*) FROM (
      SELECT owner_id FROM public.guestbooks GROUP BY owner_id HAVING count(*) > 498
    ) x),
    'profiles_over_500_scopes', (SELECT count(*) FROM profile_inventory WHERE scope_count > 500),
    'storage_scopes_over_20000', (SELECT count(*) FROM storage_groups WHERE object_count > 20000),
    'owned_storage_owners_over_20000', (SELECT count(*)
      FROM owned_storage_groups WHERE object_count > 20000),
    'unattributed_chat_image_objects', (SELECT count(*)
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-image'
        AND COALESCE(object_row.owner_id, '') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    'orphaned_chat_image_objects', (SELECT count(*)
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-image'
        AND CASE
          WHEN COALESCE(object_row.owner_id, '') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN NOT EXISTS (
            SELECT 1
            FROM auth.users AS auth_owner
            WHERE auth_owner.id = object_row.owner_id::uuid
          )
          ELSE false
        END),
    'legacy_storage_objects', (SELECT count(*) FROM storage.objects
      WHERE bucket_id IN (
        'guestbook-images', 'cohort-images', 'vendor-images', 'vendor-licenses',
        'invitation-photos'
      ))
  ),
  'unique_blockers', jsonb_build_object(
    'tool_idempotency_groups', (SELECT count(*) FROM (
      SELECT 1 FROM public.ai_interactions_log
      WHERE interaction_type = 'tool_call' AND couple_id IS NOT NULL
        AND nullif(metadata->>'tool_idempotency_key', '') IS NOT NULL
      GROUP BY couple_id, metadata->>'tool_idempotency_key'
      HAVING count(*) > 1
    ) x),
    'active_booking_groups', (SELECT count(*) FROM (
      SELECT 1 FROM public.vendor_bookings
      WHERE status <> 'cancelled' AND couple_id IS NOT NULL
      GROUP BY couple_id, vendor_id, booking_date, booking_time,
        coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
      HAVING count(*) > 1
    ) x),
    -- These relations/columns can themselves be introduced by the pending
    -- suffix. The ship script fills these fail-closed placeholders only after
    -- checking dynamic_sources and issuing a relation-safe query.
    'wedding_pair_groups_over_two', NULL::bigint,
    'wedding_submission_groups', NULL::bigint
  ),
  'data_rewrites', jsonb_build_object(
    'vendor_demotions', (SELECT count(*) FROM public.vendors WHERE status = 'approved' AND owner_id IS NULL),
    'invalid_phones', (SELECT count(*) FROM public.profiles p
      WHERE nullif(to_jsonb(p)->>'phone', '') IS NOT NULL
        AND to_jsonb(p)->>'phone' !~ '^01[016789][0-9]{7,8}$'),
    'ai_redactions', (SELECT count(*) FROM public.ai_interactions_log
      WHERE created_at < now() - interval '90 days'
        AND coalesce(metadata->>'retention_policy', '') <> 'raw_payload_and_identifiers_90d'),
    'ai_deletes', (SELECT count(*) FROM public.ai_interactions_log WHERE created_at < now() - interval '1 year'),
    'feedback_pii_redactions', (SELECT count(*) FROM public.chat_feedback
      WHERE created_at < now() - interval '90 days'
        AND (user_id IS NOT NULL OR couple_id IS NOT NULL OR message_id IS NOT NULL
          OR correction IS NOT NULL OR message_content IS NOT NULL)),
    'feedback_deletes', (SELECT count(*) FROM public.chat_feedback WHERE created_at < now() - interval '1 year'),
    'wedding_tokens_to_null', NULL::bigint,
    'wedding_scoring_version_backfills', NULL::bigint,
    'amora_claim_lease_backfills', NULL::bigint,
    'push_tokens_to_null', (SELECT count(*) FROM public.profiles p WHERE nullif(to_jsonb(p)->>'push_token', '') IS NOT NULL),
    'quote_rows_forced_private', (SELECT count(*) FROM public.amora_quote_checks),
    'quote_leads_deleted', (SELECT count(*) FROM public.vendor_leads
      WHERE source = 'user_mention' AND source_place_id LIKE 'amora-quote:%'),
    'quote_leads_scrubbed', (SELECT count(*) FROM public.vendor_leads
      WHERE source_place_id LIKE 'amora-quote:%' AND source IS DISTINCT FROM 'user_mention'),
    'community_nickname_pseudonymizations', (SELECT count(*)
      FROM public.community_profiles community_profile
      JOIN public.profiles account_profile
        ON account_profile.id = community_profile.user_id
      WHERE nullif(btrim(account_profile.name), '') IS NOT NULL
        AND lower(regexp_replace(btrim(community_profile.nickname), '\s+', '', 'g')) =
            lower(regexp_replace(btrim(account_profile.name), '\s+', '', 'g'))),
    'prereg_expiry_backfill', (SELECT count(*) FROM public.preregistrations p WHERE to_jsonb(p)->>'expires_at' IS NULL),
    'care_consent_resets', (SELECT count(*) FROM public.profiles p
      CROSS JOIN schema_capabilities c
      WHERE NOT c.care_notifications_column_present
         OR coalesce((to_jsonb(p)->>'care_notifications_enabled')::boolean, false) IS DISTINCT FROM false
         OR to_jsonb(p)->>'phone_care_consented_at' IS NOT NULL)
  ),
  'community_guard', jsonb_build_object(
    'report_rows', (SELECT count(*) FROM public.community_reports),
    'reports_deleted', (SELECT count(*) FROM report_delete_ids),
    'posts_marked_under_review', (SELECT count(*) FROM public.community_posts p
      WHERE NOT coalesce(p.under_review, false)
        AND p.id IN (
          SELECT r.post_id FROM public.community_reports r
          WHERE r.post_id IS NOT NULL AND r.status = 'pending'
          GROUP BY r.post_id HAVING count(DISTINCT r.reporter_id) >= 3
        )),
    -- Before 111400 these names must be absent because CREATE POLICY has no
    -- IF NOT EXISTS. After 111400 they are the expected contract, not a
    -- conflict; exact roles/command/expressions are checked in dynamic_sources.
    'policy_name_conflicts', CASE WHEN EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20260711140000'
    ) THEN 0 ELSE (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN (
          'vendor images own folder insert',
          'vendor licenses own folder insert'
        )) END,
    'active_transactions', (SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL)
  ),
  'retention_rewrite', jsonb_build_object(
    'prereg_rows', (SELECT count(*) FROM prereg),
    'prereg_created_at_backfilled', (SELECT count(*) FROM prereg WHERE created_at IS NULL),
    -- The earlier consent migration fills a missing expiry before 111410.
    'prereg_expires_backfilled', (SELECT count(*) FROM prereg WHERE after_consent_exp IS NULL),
    'prereg_expiry_shortened', (SELECT count(*) FROM prereg WHERE after_consent_exp IS NOT NULL AND after_consent_exp > new_exp),
    'prereg_deleted_first_cron', (SELECT count(*) FROM prereg WHERE new_exp <= now()),
    'survey_rows', (SELECT count(*) FROM survey),
    'survey_expires_backfilled', (SELECT count(*) FROM survey WHERE old_exp IS NULL),
    'survey_expiry_shortened', (SELECT count(*) FROM survey WHERE old_exp IS NOT NULL AND old_exp > new_exp),
    'survey_pii_rows_scrubbed', (SELECT count(*) FROM survey WHERE q23_contact IS NOT NULL OR user_agent IS NOT NULL),
    'survey_deleted_first_cron', (SELECT count(*) FROM survey WHERE new_exp <= now()),
    'rate_limit_deleted_first_cron', (SELECT count(*) FROM public.rate_limit_buckets WHERE reset_at < now() - interval '1 day')
  )
) AS preflight;
