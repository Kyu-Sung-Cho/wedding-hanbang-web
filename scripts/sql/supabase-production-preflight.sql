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
    -- 111410 intentionally changes expires_at to NOT NULL, so only its stable
    -- type is part of the 111350 creator contract.
    ('preregistration_expiry', 'preregistrations', 'expires_at', 'timestamp with time zone', NULL::boolean)
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
    ('account_deletion_jobs_base', 'account_deletion_jobs', 'updated_at', 'now()')
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
      '20260710010000', '20260711145000'),
    ('public.enforce_ai_interaction_retention()',
      'TABLE(redacted integer, deleted integer)',
      'search_path=public', '85cb9b5ccafca3cca9b3cdf74ee4eddc',
      '20260710010000', '20260711145000'),
    ('public.enforce_application_survey_retention()',
      'TABLE(preregistrations_deleted integer, survey_responses_deleted integer)',
      'search_path=public', 'bfd5bc045ed108c9d06eadbaa8493459',
      '20260711141000', '20260711145000'),
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
    ('public.request_account_deletion(uuid,text)', 'jsonb',
      'search_path=public, pg_temp', '23b1de98bf90bf1469bb3cc17775d255',
      '20260710070000', NULL::text),
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
    ('public.complete_account_deletion_job(uuid,uuid)', 'boolean',
      'search_path=public, pg_temp', 'd7ac53e76d1c8cf1b1e318a78d67a10a',
      '20260710070000', NULL::text),
    ('public.requeue_dead_account_deletion_job(uuid)', 'boolean',
      'search_path=public, pg_temp', '29fe1226857032d271e78f585f887956',
      '20260710070000', NULL::text),
    ('public.account_deletion_queue_health()', 'jsonb',
      'search_path=public, pg_temp', 'b0184ebdb2888d329ef714726d7f76f6',
      '20260710070000', NULL::text)
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
    ('public.enforce_application_survey_retention()',
      ARRAY['preregistrations_deleted', 'survey_responses_deleted']::text[]),
    ('public.delete_expired_rate_limit_buckets()', NULL::text[])
), dependency_service_denied_functions(signature) AS (
  VALUES
    ('public.guard_account_deletion_user_reference()'),
    ('public.guard_account_deletion_rate_limit_write()')
), dependency_function_status AS (
  SELECT required.signature,
         required.creator_version,
         required.forward_version,
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
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND procedure_row.proconfig @> ARRAY[required.expected_search_path]::text[]
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
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), required_client_denied_trigger_functions(
  signature, expected_source_md5, creator_version, forward_version
) AS (
  VALUES
    ('public.community_recalc_rank()', 'c742d9e87a9c815491d03c574690772c', '20260408000000', '20260711145000'),
    ('public.create_profile_on_signup()', '84a6f9f7f2c366bb87703fcc25cc2f22', '20260210000000', '20260711145000'),
    ('public.guard_amora_user_message_insert()', '3b3a72bfb77bfd27a0b7f43b718cb4c0', '20260710050000', '20260711145000'),
    ('public.guard_profile_self_insert()', 'e1a79bcb72eb8b1df1c5edb70f181e44', '20260710050000', '20260711145000'),
    ('public.prevent_cohort_membership_client_write()', '5947d166102367678683a8ae71c2b72d', '20260615090000', '20260711145000'),
    ('public.prevent_couple_ownership_self_change()', '697c40535a23d739a271b0b4e3b2ffbf', '20260612130000', '20260711145000'),
    ('public.prevent_couple_slot_self_change()', 'c795f37d371b8143d50b45d65de96411', '20260614110000', '20260711145000'),
    ('public.prevent_is_admin_self_change()', '9395ea55bfc5192e10ef000e0421d7b3', '20260612120000', '20260711145000')
), client_denied_trigger_function_status AS (
  SELECT required.signature,
         required.creator_version,
         required.forward_version,
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
           AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
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
      '20260612120000', '20260711148000')
), client_denied_trigger_binding_status AS (
  SELECT required.schema_name,
         required.table_name,
         required.trigger_name,
         required.creator_version,
         required.forward_version,
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
    ('enforce-application-survey-retention', '41 18 * * *',
      'SELECT public.enforce_application_survey_retention();', '20260711141000'),
    ('delete-expired-rate-limit-buckets', '47 18 * * *',
      'SELECT public.delete_expired_rate_limit_buckets();', '20260711141000')
), dependency_cron_status AS (
  SELECT required.job_name,
         required.creator_version,
         count(job_row.jobid) AS existing_count,
         count(job_row.jobid) <= 1 AS existing_replaceable,
         count(job_row.jobid) = 1 AND bool_and(
           job_row.schedule = required.expected_schedule
           AND job_row.command = required.expected_command
           AND job_row.active
         ) AS exact
  FROM required_dependency_crons required
  LEFT JOIN cron.job job_row ON job_row.jobname = required.job_name
  GROUP BY required.job_name, required.creator_version
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
    (SELECT jsonb_object_agg(
       status.job_name,
       to_jsonb(status) - 'job_name'
       ORDER BY status.job_name
     ) FROM dependency_cron_status status) AS dependency_cron_status,
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
      AS preregistration_expiry_contract_exact
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
    'legacy_rows_scrubbed', (SELECT count(*) FROM public.account_deletions
      WHERE user_id IS NOT NULL OR email IS NOT NULL OR reason IS NULL
         OR reason NOT IN ('unsatisfied', 'alternative', 'wedding_done', 'privacy', 'low_usage', 'other', 'unknown')),
    'guestbook_owners_over_498', (SELECT count(*) FROM (
      SELECT owner_id FROM public.guestbooks GROUP BY owner_id HAVING count(*) > 498
    ) x),
    'profiles_over_500_scopes', (SELECT count(*) FROM profile_inventory WHERE scope_count > 500),
    'storage_scopes_over_20000', (SELECT count(*) FROM storage_groups WHERE object_count > 20000),
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
