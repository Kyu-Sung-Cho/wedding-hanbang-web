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
    ('public.mutate_journey_schedule_event(uuid,text,jsonb,text,text)', 'jsonb',
      'search_path=public', '217b8691f857b169fa8c314f38640bd6',
      '20260713103000', NULL::text),
    ('public.mutate_journey_budget_category(uuid,text,jsonb,text[],text)', 'jsonb',
      'search_path=public', 'fffd63cefb9c2060940e5609236edcb6',
      '20260713106000', '20260713111000'),
    ('public.mutate_journey_checklist_item(uuid,text,text,boolean,boolean,jsonb)', 'jsonb',
      'search_path=public', 'a32a763bd398ca9f867f500173c66e08',
      '20260713107000', NULL::text),
    ('public.patch_journey_preferences(uuid,jsonb)', 'jsonb',
      'search_path=public', '27ee61ddb94b4c726d010371c1b5c8d5',
      '20260713108000', NULL::text),
    ('public.community_soft_delete_comment(uuid,uuid)',
      'TABLE(comment_id uuid, post_id uuid, author_id uuid, deleted boolean)',
      'search_path=""', '1f94340d26771efa8d1fcf13e4eb875b',
      '20260713117000', NULL::text),
    ('public.community_hard_delete_post(uuid,uuid)',
      'TABLE(post_id uuid, author_id uuid, deleted boolean)',
      'search_path=""', '6aac47ba565ff0f44bed0466a6d7b5d0',
      '20260713119000', NULL::text),
    ('public.community_update_post(uuid,uuid,jsonb)',
      'TABLE(post_id uuid, updated boolean, viewer_is_author boolean)',
      'search_path=""', '0b72e707092ed3bc704bb19ff3df9aff',
      '20260713121000', NULL::text),
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
      'search_path=public', '018d1031722afb3dc806adbd4b569d3f',
      '20260710040000', '20260713101000'),
    ('public.reserve_amora_turn(uuid,integer,integer)',
      'TABLE(allowed boolean, reason text)',
      'search_path=public', '7bd558dfbfd475f3d1a2826d641aaf12',
      '20260704120000', '20260713101000'),
    ('public.check_amora_usage(uuid,integer,integer,boolean)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer)',
      'search_path=public', '8c93415f249a7cffb2708c90f6ea6977',
      '20260711139000', '20260713101000'),
    ('public.reserve_amora_usage_v2(uuid,integer,integer,boolean,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '1ac065d727628555b5722812b161991a',
      '20260711139000', '20260713101000'),
    ('public.reserve_amora_usage_unlimited_v1(uuid,text,text,integer)',
      'TABLE(allowed boolean, reason text, remaining integer, provider_remaining integer, reused boolean)',
      'search_path=public', '49059944da0d4e326cc4ab3d85565836',
      '20260713101000', NULL::text),
    ('public.meter_amora_provider_usage_unlimited_v1(uuid)', 'boolean',
      'search_path=public', '4f050e1d62e323fc8e64c5368bb0f55f',
      '20260713101000', NULL::text),
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
    ('public.reserve_amora_turn(uuid,integer,integer)',
      ARRAY['p_couple_id', 'p_couple_cap', 'p_global_cap',
        'allowed', 'reason']::text[]),
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
    ('public.delete_expired_rate_limit_buckets()', NULL::text[]),
    ('public.community_soft_delete_comment(uuid,uuid)',
      ARRAY[
        'p_actor_id', 'p_comment_id', 'comment_id', 'post_id', 'author_id',
        'deleted'
      ]::text[]),
    ('public.community_hard_delete_post(uuid,uuid)',
      ARRAY[
        'p_actor_id', 'p_post_id', 'post_id', 'author_id', 'deleted'
      ]::text[]),
    ('public.community_update_post(uuid,uuid,jsonb)',
      ARRAY[
        'p_actor_id', 'p_post_id', 'p_patch', 'post_id', 'updated',
        'viewer_is_author'
      ]::text[])
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
    ('public.sync_community_actor_identity()',
      '65e9cb5b5a27f8446bdfbe5153c74366',
      'search_path=""', false, '20260713118000', NULL::text),
    ('public.maintain_community_profile_post_count()',
      '728309d11c41d182e4b3fe827004e90c',
      'search_path=""', false, '20260713119000', NULL::text),
    ('public.maintain_community_counts_after_comment_delete()',
      'b322f9adb70968e2a4220f404d138b0b',
      'search_path=""', false, '20260713119000', NULL::text)
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
           AND procedure_row.proconfig
             @> ARRAY[required.expected_search_path]::text[]
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
    ('public', 'community_profiles', 'sync_community_profile_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_profile_actor_id BEFORE INSERT OR UPDATE OF public_actor_id ON community_profiles FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()',
      '20260713118000', NULL::text),
    ('public', 'community_posts', 'sync_community_post_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_post_actor_id BEFORE INSERT OR UPDATE OF author_id, author_public_id ON community_posts FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()',
      '20260713118000', NULL::text),
    ('public', 'community_comments', 'sync_community_comment_actor_id',
      'public.sync_community_actor_identity()',
      'CREATE TRIGGER sync_community_comment_actor_id BEFORE INSERT OR UPDATE OF author_id, author_public_id ON community_comments FOR EACH ROW EXECUTE FUNCTION sync_community_actor_identity()',
      '20260713118000', NULL::text),
    ('public', 'community_posts', 'maintain_community_profile_post_count',
      'public.maintain_community_profile_post_count()',
      'CREATE TRIGGER maintain_community_profile_post_count AFTER INSERT OR DELETE ON community_posts FOR EACH ROW EXECUTE FUNCTION maintain_community_profile_post_count()',
      '20260713119000', NULL::text),
    ('public', 'community_comments',
      'maintain_community_counts_after_comment_delete',
      'public.maintain_community_counts_after_comment_delete()',
      'CREATE TRIGGER maintain_community_counts_after_comment_delete AFTER DELETE ON community_comments REFERENCING OLD TABLE AS deleted_community_comments FOR EACH STATEMENT EXECUTE FUNCTION maintain_community_counts_after_comment_delete()',
      '20260713119000', NULL::text)
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
    ('enforce-application-survey-retention', '41 18 * * *',
      'SELECT public.enforce_application_survey_retention();', '20260711141000'),
    ('delete-expired-rate-limit-buckets', '47 18 * * *',
      'SELECT public.delete_expired_rate_limit_buckets();', '20260711141000'),
    ('enforce-raw-customer-tracking-retention', '23 18 * * *',
      'SELECT public.enforce_raw_customer_tracking_retention();',
      '20260713112000')
), dependency_cron_status AS (
  SELECT required.job_name,
         required.creator_version,
         0::bigint AS existing_count,
         true AS existing_replaceable,
         false AS exact
  FROM required_dependency_crons required
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
           AND 1 >= (
             SELECT count(*)
             FROM pg_catalog.aclexplode(view_row.relacl) privilege_row
             WHERE privilege_row.grantee = (
               SELECT role_row.oid FROM pg_catalog.pg_roles role_row
               WHERE role_row.rolname = 'service_role'
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(view_row.relacl) privilege_row
             JOIN pg_catalog.pg_roles grantor
               ON grantor.oid = privilege_row.grantor
             WHERE privilege_row.grantee = (
               SELECT role_row.oid FROM pg_catalog.pg_roles role_row
               WHERE role_row.rolname = 'service_role'
             )
               AND (
                 privilege_row.privilege_type <> 'SELECT'
                 OR privilege_row.is_grantable
                 OR grantor.rolname <> 'postgres'
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.pg_attribute attribute_row
             CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
               privilege_row
             WHERE attribute_row.attrelid = view_row.oid
               AND attribute_row.attnum > 0
               AND NOT attribute_row.attisdropped
               AND privilege_row.grantee = (
                 SELECT role_row.oid FROM pg_catalog.pg_roles role_row
                 WHERE role_row.rolname = 'service_role'
               )
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
           AND NOT has_table_privilege(
             'service_role', view_row.oid, 'MAINTAIN'
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
    OR (
      expected.grantee = 'service_role'
      AND coalesce((
        SELECT array_agg(
          privilege_row.privilege_type::text
          ORDER BY privilege_row.privilege_type::text
        )
        FROM information_schema.table_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = expected.view_name
          AND privilege_row.grantee = expected.grantee
      ), ARRAY[]::text[]) = ARRAY[]::text[]
    )
  ), false) AS exact
  FROM privacy_expected_view_acl expected
), privacy_profile_column_acl AS (
  SELECT coalesce(bool_and(
    NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'anon', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'INSERT'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'UPDATE'
    )
    AND NOT has_column_privilege(
      'authenticated', attribute_row.attrelid, attribute_row.attnum, 'REFERENCES'
    )
  ), false)
  AND (
    coalesce(bool_and(
      has_column_privilege(
        'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']::name[]
      ))
      AND has_column_privilege(
        'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['user_id', 'nickname', 'avatar_url', 'badge', 'rank']::name[]
      ))
    ), false)
    OR coalesce(bool_and(
      has_column_privilege(
        'anon', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['public_actor_id', 'nickname', 'avatar_url']::name[]
      ))
      AND has_column_privilege(
        'authenticated', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
      ) = (attribute_row.attname = ANY (
        ARRAY['public_actor_id', 'nickname', 'avatar_url']::name[]
      ))
    ), false)
  ) AS exact
  FROM pg_catalog.pg_attribute attribute_row
  WHERE attribute_row.attrelid = to_regclass('public.community_profiles')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped
), privacy_expected_table_acl(
  table_name, grantee, expected_privileges
) AS (
  VALUES
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
    actual.privileges = expected.expected_privileges
    OR actual.privileges = CASE
      WHEN expected.table_name = 'community_profiles'
        AND expected.grantee = 'service_role'
      THEN ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]
      WHEN expected.table_name IN (
        'community_achievements', 'community_vendor_tags'
      ) AND expected.grantee = 'service_role'
      THEN ARRAY[]::text[]
      ELSE NULL::text[]
    END
  ), false) AS exact
  FROM privacy_expected_table_acl expected
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(
      privilege_row.privilege_type::text
      ORDER BY privilege_row.privilege_type::text
    ), ARRAY[]::text[]) AS privileges
    FROM information_schema.table_privileges privilege_row
    WHERE privilege_row.table_schema = 'public'
      AND privilege_row.table_name = expected.table_name
      AND privilege_row.grantee = expected.grantee
  ) actual
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
      WHEN expected.grantee = 'service_role'
        AND expected.object_name = 'community_profiles' THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]) privilege
          WHERE NOT pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]) privilege
          WHERE NOT pg_catalog.has_any_column_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND NOT pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'REFERENCES'
        )
      WHEN expected.grantee = 'service_role'
        AND expected.object_name = 'community_achievements' THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND (
          (
            NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY[
                'SELECT', 'INSERT', 'UPDATE', 'DELETE'
              ]::text[]) privilege
              WHERE NOT pg_catalog.has_table_privilege(
                expected.grantee,
                pg_catalog.to_regclass('public.' || expected.object_name),
                privilege
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']::text[])
                privilege
              WHERE NOT pg_catalog.has_any_column_privilege(
                expected.grantee,
                pg_catalog.to_regclass('public.' || expected.object_name),
                privilege
              )
            )
          )
          OR (
            NOT has_table_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              'SELECT,INSERT,UPDATE,DELETE'
            )
            AND NOT has_any_column_privilege(
              expected.grantee,
              pg_catalog.to_regclass('public.' || expected.object_name),
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
        )
      WHEN expected.grantee = 'service_role'
        AND expected.object_name IN (
          'cohort_stats', 'cohort_room_contributor_stats',
          'community_vendor_tags'
        ) THEN
        NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]::text[]) privilege
          WHERE pg_catalog.has_table_privilege(
            expected.grantee,
            pg_catalog.to_regclass('public.' || expected.object_name),
            privilege
          )
        )
        AND pg_catalog.has_table_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'SELECT'
        ) = pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'SELECT'
        )
        AND NOT pg_catalog.has_any_column_privilege(
          expected.grantee,
          pg_catalog.to_regclass('public.' || expected.object_name),
          'INSERT,UPDATE,REFERENCES'
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
            'REFERENCES', 'TRIGGER', 'MAINTAIN'
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
    AND 2 = (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'community_profiles', 'community_achievements',
          'community_vendor_tags'
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
), vendor_catalog_relations(table_name) AS (
  VALUES
    ('vendors'),
    ('vendor_products'),
    ('vendor_images'),
    ('vendor_timeslots'),
    ('product_timeslots'),
    ('vendor_reviews'),
    ('vendor_staff'),
    ('staff_timeslots'),
    ('community_vendor_tags')
), vendor_service_acl_expected(table_name, privileges) AS (
  VALUES
    ('vendors', ARRAY['SELECT']::text[]),
    ('vendor_products', ARRAY['SELECT']::text[]),
    ('vendor_images', ARRAY[]::text[]),
    ('vendor_timeslots', ARRAY[]::text[]),
    ('product_timeslots', ARRAY[]::text[]),
    ('vendor_reviews', ARRAY['DELETE']::text[]),
    ('vendor_staff', ARRAY[]::text[]),
    ('staff_timeslots', ARRAY[]::text[]),
    ('community_vendor_tags', ARRAY[]::text[]),
    ('vendor_favorites', ARRAY['SELECT']::text[]),
    ('vendor_photo_likes', ARRAY['DELETE']::text[])
), vendor_catalog_legacy_policies(table_name, policy_name, command) AS (
  VALUES
    ('vendors', '공개: 승인 업체 조회', 'SELECT'),
    ('vendors', '업체: 본인 업체 조회', 'SELECT'),
    ('vendors', '업체: 본인 업체 수정', 'UPDATE'),
    ('vendors', '업체: 신규 등록', 'INSERT'),
    ('vendors', '서비스: vendors 전체 관리', 'ALL'),
    ('vendors', 'vendors_select_approved', 'SELECT'),
    ('vendor_products', '공개: 활성 상품 조회', 'SELECT'),
    ('vendor_products', '업체: 본인 상품 조회', 'SELECT'),
    ('vendor_products', '업체: 본인 상품 추가', 'INSERT'),
    ('vendor_products', '업체: 본인 상품 수정', 'UPDATE'),
    ('vendor_products', '업체: 본인 상품 삭제', 'DELETE'),
    ('vendor_products', '서비스: 상품 전체 관리', 'ALL'),
    ('vendor_products', 'vendor_products_select', 'SELECT'),
    ('vendor_products', 'vendor_products_insert', 'INSERT'),
    ('vendor_products', 'vendor_products_update', 'UPDATE'),
    ('vendor_products', 'vendor_products_delete', 'DELETE'),
    ('vendor_images', '공개: 승인 업체 이미지 조회', 'SELECT'),
    ('vendor_images', '업체: 본인 이미지 관리', 'ALL'),
    ('vendor_images', '서비스: 이미지 전체 관리', 'ALL'),
    ('vendor_timeslots', '공개: 승인 업체 타임슬롯 조회', 'SELECT'),
    ('vendor_timeslots', '업체: 본인 타임슬롯 관리', 'ALL'),
    ('vendor_timeslots', '서비스: 타임슬롯 전체 관리', 'ALL'),
    ('vendor_timeslots', 'vendor_timeslots_select', 'SELECT'),
    ('vendor_timeslots', 'vendor_timeslots_manage', 'ALL'),
    ('product_timeslots', '공개: 활성 상품 타임슬롯 조회', 'SELECT'),
    ('product_timeslots', '업체: 본인 상품 타임슬롯 관리', 'ALL'),
    ('product_timeslots', '서비스: 상품 타임슬롯 전체 관리', 'ALL'),
    ('product_timeslots', 'product_timeslots_select', 'SELECT'),
    ('product_timeslots', 'product_timeslots_manage', 'ALL'),
    ('vendor_reviews', '공개: 리뷰 조회', 'SELECT'),
    ('vendor_reviews', '고객: 리뷰 작성', 'INSERT'),
    ('vendor_reviews', '고객: 본인 리뷰 수정', 'UPDATE'),
    ('vendor_reviews', '업체: 본인 리뷰 조회', 'SELECT'),
    ('vendor_reviews', '업체: 리뷰 답변', 'UPDATE'),
    ('vendor_reviews', '서비스: 리뷰 전체 관리', 'ALL'),
    ('vendor_reviews', 'vendor_reviews_select', 'SELECT'),
    ('vendor_staff', 'Public can view active staff', 'SELECT'),
    ('vendor_staff', 'Vendor owners can manage staff', 'ALL'),
    ('staff_timeslots', 'Public can view staff timeslots', 'SELECT'),
    ('staff_timeslots', 'Vendor owners can manage staff timeslots', 'ALL')
), vendor_catalog_lockdown_status AS (
  SELECT
    (
      NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_legacy_policies expected
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = expected.table_name
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND (
        SELECT count(*) FROM vendor_catalog_legacy_policies
      ) = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            SELECT relation.table_name FROM vendor_catalog_relations relation
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        WHERE relation.table_name <> 'community_vendor_tags'
          AND NOT pg_catalog.has_any_column_privilege(
            client.role_name,
            to_regclass('public.' || relation.table_name),
            'SELECT'
          )
      )
      AND NOT pg_catalog.has_any_column_privilege(
        'anon', 'public.community_vendor_tags', 'SELECT'
      )
      AND NOT pg_catalog.has_any_column_privilege(
        'authenticated', 'public.community_vendor_tags', 'SELECT'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('vendor_favorites', 'vendor_favorites_select', 'SELECT'),
          ('vendor_favorites', 'vendor_favorites_manage', 'ALL'),
          ('vendor_photo_likes', 'vendor_photo_likes_owner_all', 'ALL')
        ) expected(table_name, policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = expected.table_name
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND 3 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'vendor_favorites', 'vendor_photo_likes'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'vendor_favorites'
          AND policy_row.policyname = 'vendor_favorites_select'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['public'::name]
          AND policy_row.cmd = 'SELECT'
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'userid=auth.uid'
          AND policy_row.with_check IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('vendor_favorites'), ('vendor_photo_likes'))
          AS relation(table_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE'
        ]::text[]) AS permission(privilege_name)
        WHERE NOT pg_catalog.has_table_privilege(
          'authenticated', to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND pg_catalog.has_column_privilege(
        'anon', 'public.community_posts', 'vendor_id', 'SELECT'
      )
      AND pg_catalog.has_column_privilege(
        'authenticated', 'public.community_posts', 'vendor_id', 'SELECT'
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'vendor-images' AND bucket_row.public = true
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'vendor-licenses' AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('공개: 업체 이미지 조회', 'SELECT'),
          ('업체: 본인 이미지 삭제', 'DELETE'),
          ('서비스: 사업자등록증 조회', 'SELECT')
        ) expected(policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'storage'
         AND policy_row.tablename = 'objects'
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND 3 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'vendor-(images|licenses)'
      )
    ) AS legacy_exact,
    (
      NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name,
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM vendor_catalog_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          client.role_name,
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM vendor_service_acl_expected relation
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role',
          to_regclass('public.' || relation.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(relation.privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            SELECT relation.table_name FROM vendor_catalog_relations relation
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('vendor_favorites', 'vendor_favorites_select_own'),
          ('vendor_photo_likes', 'vendor_photo_likes_select_own')
        ) expected(table_name, policy_name)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = expected.table_name
         AND policy_row.policyname = expected.policy_name
        WHERE policy_row.policyname IS NULL
           OR policy_row.permissive <> 'PERMISSIVE'
           OR policy_row.roles IS DISTINCT FROM ARRAY['authenticated'::name]
           OR policy_row.cmd <> 'SELECT'
           OR replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') <> 'userid=auth.uid'
           OR policy_row.with_check IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'vendor_favorites', 'vendor_photo_likes'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND (
            (policy_row.tablename, policy_row.policyname) NOT IN (
              ('vendor_favorites', 'vendor_favorites_select'),
              ('vendor_favorites', 'vendor_favorites_select_own'),
              ('vendor_photo_likes', 'vendor_photo_likes_select_own')
            )
            OR policy_row.permissive <> 'PERMISSIVE'
            OR policy_row.cmd <> 'SELECT'
            OR replace(regexp_replace(
                 lower(coalesce(policy_row.qual, '')),
                 '[[:space:]()"]+', '', 'g'
               ), 'public.', '') <> 'userid=auth.uid'
            OR policy_row.with_check IS NOT NULL
          )
      )
      AND (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'vendor_favorites', 'vendor_photo_likes'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      ) BETWEEN 2 AND 3
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('vendor_favorites'), ('vendor_photo_likes'))
          AS relation(table_name)
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']::text[])
          AS permission(privilege_name)
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name, to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
           OR pg_catalog.has_any_column_privilege(
                client.role_name,
                to_regclass('public.' || relation.table_name),
                permission.privilege_name
              )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('vendor_favorites'), ('vendor_photo_likes'))
          AS relation(table_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE'
        ]::text[]) AS permission(privilege_name)
        WHERE NOT pg_catalog.has_table_privilege(
          'service_role', to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND pg_catalog.has_column_privilege(
        'anon', 'public.community_posts', 'id', 'SELECT'
      )
      AND pg_catalog.has_column_privilege(
        'authenticated', 'public.community_posts', 'id', 'SELECT'
      )
      AND NOT pg_catalog.has_column_privilege(
        'anon', 'public.community_posts', 'vendor_id', 'SELECT'
      )
      AND NOT pg_catalog.has_column_privilege(
        'authenticated', 'public.community_posts', 'vendor_id', 'SELECT'
      )
      AND 2 = (
        SELECT count(*)
        FROM storage.buckets bucket_row
        WHERE bucket_row.id IN ('vendor-images', 'vendor-licenses')
          AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'vendor-(images|licenses)'
      )
    ) AS exact
), cohort_browser_relations(table_name, service_privileges) AS (
  VALUES
    ('cohort_rooms', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_members', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_messages', ARRAY[]::text[]),
    ('cohort_contracts', ARRAY[]::text[]),
    ('cohort_timeline_events', ARRAY[]::text[]),
    ('cohort_member_reports', ARRAY['SELECT', 'UPDATE']::text[]),
    ('cohort_stats', ARRAY[]::text[]),
    ('cohort_room_contributor_stats', ARRAY[]::text[])
), cohort_legacy_client_policies(table_name, policy_name, command) AS (
  VALUES
    ('cohort_rooms', 'cohort_rooms_select_all', 'SELECT'),
    ('cohort_members', 'cohort_members_select_room', 'SELECT'),
    ('cohort_messages', 'cohort_messages_select_room', 'SELECT'),
    ('cohort_messages', 'cohort_messages_insert_member', 'INSERT'),
    ('cohort_messages', 'cohort_messages_update_own', 'UPDATE'),
    ('cohort_messages', 'cohort_messages_delete_own', 'DELETE'),
    ('cohort_contracts', 'cohort_contracts_select_own', 'SELECT'),
    ('cohort_contracts', 'cohort_contracts_insert_active_member', 'INSERT'),
    ('cohort_contracts', 'cohort_contracts_update_active_member', 'UPDATE'),
    ('cohort_contracts', 'cohort_contracts_delete_own', 'DELETE'),
    ('cohort_timeline_events', 'cohort_timeline_select', 'SELECT'),
    ('cohort_timeline_events', 'cohort_timeline_insert', 'INSERT'),
    ('cohort_member_reports', 'cohort_member_reports_select_own', 'SELECT'),
    ('cohort_member_reports', 'cohort_member_reports_insert_own', 'INSERT')
), community_mutation_relations(table_name) AS (
  VALUES
    ('community_posts'),
    ('community_comments'),
    ('community_profiles'),
    ('community_votes'),
    ('community_bookmarks'),
    ('community_reports'),
    ('community_polls'),
    ('community_poll_options'),
    ('community_poll_votes'),
    ('community_xp_log'),
    ('community_streaks'),
    ('community_achievements')
), community_service_acl_expected(table_name, privileges) AS (
  VALUES
    (
      'community_posts',
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
    ),
    ('community_comments', ARRAY['SELECT']::text[]),
    ('community_profiles', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('community_votes', ARRAY['SELECT']::text[]),
    (
      'community_bookmarks',
      ARRAY['SELECT', 'INSERT', 'DELETE']::text[]
    ),
    (
      'community_reports',
      ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
    ),
    ('community_polls', ARRAY['SELECT']::text[]),
    ('community_poll_options', ARRAY['SELECT']::text[]),
    ('community_poll_votes', ARRAY['SELECT']::text[]),
    ('community_xp_log', ARRAY[]::text[]),
    ('community_streaks', ARRAY[]::text[]),
    ('community_achievements', ARRAY[]::text[])
), community_mutation_functions(signature, legacy_authenticated_execute) AS (
  VALUES
    ('public.community_vote_post(uuid,uuid,smallint)', true),
    ('public.community_vote_comment(uuid,uuid,smallint)', true),
    ('public.community_record_login(uuid)', true),
    ('public.community_cast_poll_vote(uuid,uuid,uuid)', false),
    ('public.community_increment_view(uuid)', false),
    ('public.community_update_bookmark_count(uuid)', false),
    ('public.community_increment_profile_count(uuid,text)', false),
    ('public.community_decrement_profile_count(uuid,text)', false),
    ('public.community_award_xp(uuid,text,integer,uuid)', false),
    ('public.community_unlock_achievement(uuid,text)', false),
    ('public.community_update_progress(uuid,integer,text,text)', false)
), community_legacy_mutation_policies(table_name, policy_name, command) AS (
  VALUES
    ('community_posts', 'cp_insert', 'INSERT'),
    ('community_posts', 'cp_update', 'UPDATE'),
    ('community_posts', 'cp_delete', 'DELETE'),
    ('community_comments', 'cc_insert', 'INSERT'),
    ('community_comments', 'cc_update', 'UPDATE'),
    ('community_comments', 'cc_delete', 'DELETE'),
    ('community_votes', 'cv_insert', 'INSERT'),
    ('community_votes', 'cv_update', 'UPDATE'),
    ('community_votes', 'cv_delete', 'DELETE'),
    ('community_bookmarks', 'cb_all', 'ALL'),
    ('community_reports', 'community_reports_insert_own', 'INSERT'),
    ('community_poll_votes', 'poll_votes_insert_own', 'INSERT'),
    ('community_poll_votes', 'poll_votes_delete_own', 'DELETE'),
    ('community_xp_log', 'xp_insert', 'INSERT'),
    ('community_streaks', 'streak_insert', 'INSERT')
), cohort_browser_lockdown_status AS (
  SELECT
    (
      NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_legacy_client_policies expected
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = expected.table_name
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND (
        SELECT count(*) FROM cohort_legacy_client_policies
      ) = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'cohort_rooms', 'cohort_members', 'cohort_messages',
            'cohort_contracts', 'cohort_timeline_events',
            'cohort_member_reports'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('cohort_rooms'), ('cohort_members'), ('cohort_messages'),
          ('cohort_contracts'), ('cohort_timeline_events'),
          ('cohort_member_reports')
        ) relation(table_name)
        WHERE NOT pg_catalog.has_table_privilege(
          'authenticated', to_regclass('public.' || relation.table_name),
          'SELECT'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('cohort_messages', 'INSERT'),
          ('cohort_messages', 'UPDATE'),
          ('cohort_messages', 'DELETE'),
          ('cohort_contracts', 'INSERT'),
          ('cohort_contracts', 'UPDATE'),
          ('cohort_contracts', 'DELETE'),
          ('cohort_timeline_events', 'INSERT'),
          ('cohort_member_reports', 'INSERT')
        ) expected(table_name, privilege_name)
        WHERE NOT pg_catalog.has_table_privilege(
          'authenticated', to_regclass('public.' || expected.table_name),
          expected.privilege_name
        )
      )
      AND pg_catalog.has_function_privilege(
        'service_role', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'cohort-images' AND bucket_row.public = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%cohort-images%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = 'cohort_messages'
      )
    ) AS legacy_exact,
    (
      NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name, to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          client.role_name, to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cohort_browser_relations relation
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', to_regclass('public.' || relation.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(relation.service_privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            'cohort_rooms', 'cohort_members', 'cohort_messages',
            'cohort_contracts', 'cohort_timeline_events',
            'cohort_member_reports'
          )
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND to_regprocedure('public.is_cohort_member(uuid)') IS NOT NULL
      AND pg_catalog.has_function_privilege(
        'service_role', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.is_cohort_member(uuid)', 'EXECUTE'
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'cohort-images' AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%cohort-images%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = 'cohort_messages'
      )
    ) AS exact
), journey_browser_lockdown_status AS (
  SELECT
    (
      to_regclass('public.wedding_journeys') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'SELECT'
      )
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'INSERT'
      )
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'UPDATE'
      )
      AND NOT pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'DELETE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'anon', 'public.wedding_journeys', permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          'anon', 'public.wedding_journeys', permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('journeys_select_couple', 'SELECT'),
          ('journeys_insert_couple', 'INSERT'),
          ('journeys_update_couple', 'UPDATE')
        ) expected(policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = 'wedding_journeys'
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles = ARRAY['authenticated'::name]
        WHERE policy_row.policyname IS NULL
      )
      AND 3 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.policyname = 'journeys_select_couple'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND policy_row.cmd = 'SELECT'
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'is_couple_membercouple_id'
          AND policy_row.with_check IS NULL
      )
    ) AS legacy_exact,
    (
      to_regclass('public.wedding_journeys') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.wedding_journeys', 'SELECT'
      )
      AND pg_catalog.has_any_column_privilege(
        'authenticated', 'public.wedding_journeys', 'SELECT'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
          'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'authenticated', 'public.wedding_journeys',
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']::text[])
          AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          'authenticated', 'public.wedding_journeys',
          permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'anon', 'public.wedding_journeys', permission.privilege_name
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_any_column_privilege(
          'anon', 'public.wedding_journeys', permission.privilege_name
        )
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.policyname = 'journeys_select_couple'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.cmd = 'SELECT'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'is_couple_membercouple_id'
          AND policy_row.with_check IS NULL
      )
      AND 1 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'wedding_journeys'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', 'public.wedding_journeys',
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(ARRAY['SELECT', 'UPDATE']::text[])
        )
      )
    ) AS exact
), chat_browser_lockdown_status AS (
  SELECT
    (
      to_regclass('public.chat_messages') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.chat_messages', 'SELECT'
      )
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.chat_messages', 'INSERT'
      )
      AND pg_catalog.has_any_column_privilege(
        'authenticated', 'public.chat_messages', 'INSERT'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('chat_select_with_privacy', 'SELECT'),
          ('chat_insert_couple', 'INSERT')
        ) expected(policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = 'chat_messages'
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles = ARRAY['authenticated'::name]
        WHERE policy_row.policyname IS NULL
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'chat-image' AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('chat-image couple folder write', 'INSERT'),
          ('chat-image couple folder update', 'UPDATE'),
          ('chat-image couple folder delete', 'DELETE')
        ) expected(policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'storage'
         AND policy_row.tablename = 'objects'
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND 3 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%chat-image%'
      )
    ) AS legacy_exact,
    (
      to_regclass('public.chat_messages') IS NOT NULL
      AND pg_catalog.has_table_privilege(
        'authenticated', 'public.chat_messages', 'SELECT'
      )
      AND NOT pg_catalog.has_table_privilege(
        'authenticated', 'public.chat_messages', 'INSERT'
      )
      AND NOT pg_catalog.has_any_column_privilege(
        'authenticated', 'public.chat_messages', 'INSERT'
      )
      AND NOT pg_catalog.has_table_privilege(
        'anon', 'public.chat_messages', 'INSERT'
      )
      AND NOT pg_catalog.has_any_column_privilege(
        'anon', 'public.chat_messages', 'INSERT'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.policyname = 'chat_select_with_privacy'
          AND policy_row.cmd = 'SELECT'
          AND policy_row.roles = ARRAY['authenticated'::name]
      )
      AND 1 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'chat_messages'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', 'public.chat_messages', permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(
            ARRAY['SELECT', 'INSERT', 'DELETE']::text[]
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM storage.buckets bucket_row
        WHERE bucket_row.id = 'chat-image' AND bucket_row.public = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) LIKE '%chat-image%'
      )
    ) AS exact
), community_browser_lockdown_status AS (
  SELECT
    (
      NOT EXISTS (
        SELECT 1 FROM community_mutation_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_legacy_mutation_policies expected
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'public'
         AND policy_row.tablename = expected.table_name
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles && ARRAY[
           'public'::name, 'anon'::name, 'authenticated'::name
         ]
        WHERE policy_row.policyname IS NULL
      )
      AND (
        SELECT count(*) FROM community_legacy_mutation_policies
      ) = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            SELECT relation.table_name FROM community_mutation_relations relation
          )
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_mutation_functions function_contract
        WHERE to_regprocedure(function_contract.signature) IS NULL
           OR NOT pg_catalog.has_function_privilege(
                'service_role', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'anon', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'authenticated', function_contract.signature, 'EXECUTE'
              ) IS DISTINCT FROM
                function_contract.legacy_authenticated_execute
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'community_bookmarks'
          AND policy_row.policyname = 'community_bookmarks_select_own'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('community-images own folder write', 'INSERT'),
          ('community-images own folder update', 'UPDATE'),
          ('community-images own folder delete', 'DELETE'),
          ('community-videos own folder write', 'INSERT'),
          ('community-videos own folder update', 'UPDATE'),
          ('community-videos own folder delete', 'DELETE')
        ) expected(policy_name, command)
        LEFT JOIN pg_catalog.pg_policies policy_row
          ON policy_row.schemaname = 'storage'
         AND policy_row.tablename = 'objects'
         AND policy_row.policyname = expected.policy_name
         AND policy_row.cmd = expected.command
         AND policy_row.roles = ARRAY['authenticated'::name]
        WHERE policy_row.policyname IS NULL
      )
      AND 6 = (
        SELECT count(*) FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'community-(images|videos)'
      )
    ) AS legacy_exact,
    (
      NOT EXISTS (
        SELECT 1 FROM community_mutation_relations relation
        WHERE to_regclass('public.' || relation.table_name) IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_mutation_relations relation
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          AS client(role_name)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[])
          AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          client.role_name, to_regclass('public.' || relation.table_name),
          permission.privilege_name
        )
           OR (
             permission.privilege_name IN ('INSERT', 'UPDATE')
             AND pg_catalog.has_any_column_privilege(
               client.role_name, to_regclass('public.' || relation.table_name),
               permission.privilege_name
             )
           )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_service_acl_expected relation
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) AS permission(privilege_name)
        WHERE pg_catalog.has_table_privilege(
          'service_role', to_regclass('public.' || relation.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(relation.privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN (
            SELECT relation.table_name FROM community_mutation_relations relation
          )
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_mutation_functions function_contract
        WHERE to_regprocedure(function_contract.signature) IS NULL
           OR NOT pg_catalog.has_function_privilege(
                'service_role', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'anon', function_contract.signature, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'authenticated', function_contract.signature, 'EXECUTE'
              )
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'community_bookmarks'
          AND policy_row.policyname = 'community_bookmarks_select_own'
          AND policy_row.permissive = 'PERMISSIVE'
          AND policy_row.roles = ARRAY['authenticated'::name]
          AND policy_row.cmd = 'SELECT'
          AND replace(regexp_replace(
                lower(coalesce(policy_row.qual, '')),
                '[[:space:]()"]+', '', 'g'
              ), 'public.', '') = 'userid=auth.uid'
          AND policy_row.with_check IS NULL
      )
      AND 1 = (
        SELECT count(*)
        FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'community_bookmarks'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'community-(images|videos)'
      )
    ) AS exact
), disabled_browser_write_lockdown_status AS (
  SELECT
    cohort_status.legacy_exact
      AND journey_status.legacy_exact
      AND chat_status.legacy_exact
      AND community_status.legacy_exact AS legacy_exact,
    cohort_status.exact AS cohort_exact,
    journey_status.exact AS journey_exact,
    chat_status.exact AS chat_exact,
    community_status.exact AS community_exact,
    cohort_status.exact
      AND journey_status.exact
      AND chat_status.exact
      AND community_status.exact AS exact
  FROM cohort_browser_lockdown_status cohort_status
  CROSS JOIN journey_browser_lockdown_status journey_status
  CROSS JOIN chat_browser_lockdown_status chat_status
  CROSS JOIN community_browser_lockdown_status community_status
), preview_smoke_function_arguments(signature, expected_arguments) AS (
  VALUES
    ('private.assert_preview_smoke_authorized(text)', 'p_project_ref text'),
    ('private.assert_preview_smoke_user(uuid)', 'p_user_id uuid'),
    ('public.assert_preview_smoke_ready(text)', 'p_project_ref text'),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      'p_project_ref text, p_operation text, p_user_id uuid, p_couple_id uuid'),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      'p_project_ref text, p_user_id uuid, p_couple_id uuid, p_client_request_id text'),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])',
      'p_project_ref text, p_user_ids uuid[]')
), trusted_beta_function_contracts(
  signature, expected_result, expected_language, expected_volatility,
  expected_security_definer, expected_proconfig, expected_source_md5,
  service_role_execute, anon_execute, authenticated_execute, creator_version
) AS (
  VALUES
    ('public.block_retired_raw_customer_tracking_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      'f031cc768a520d401c88ff041fe54f6a', true, false, false, '20260713112000'),
    ('public.enforce_raw_customer_tracking_retention()',
      'TABLE(customer_events_deleted integer, search_logs_deleted integer)',
      'plpgsql', 'v', true, 'search_path=pg_catalog',
      '54e4f6ece31461d0f63ffbcb1d15ee6e', true, false, false, '20260713112000'),
    ('public.get_my_partner_public()', 'TABLE(id uuid, name text, role text)',
      'sql', 's', true, 'search_path=pg_catalog',
      '4a127cecbf5bc39fed3ab8200e3ffaca', true, false, true, '20260713112500'),
    ('public.get_my_profile_safe()',
      'TABLE(id uuid, name text, role text, couple_id uuid, onboarding_completed boolean, onboarding_step integer, has_phone boolean)',
      'sql', 's', true, 'search_path=pg_catalog',
      '0663224c1e2322c2c02d39945cb1e659', true, false, true, '20260713112500'),
    ('public.get_my_chat_view_state()',
      'TABLE(shared_cleared_at timestamp with time zone, private_cleared_at timestamp with time zone)',
      'sql', 's', true, 'search_path=pg_catalog',
      '5caa2a873cc53ade8dd64ba5163e80a1', true, false, true, '20260713112500'),
    ('public.block_retired_community_media_object_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '49a00b8e5ed57e5ccc46d71edce8001d', true, false, false, '20260713113000'),
    ('public.block_retired_community_post_media_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '8154296e2bd4b97fb2ab8b52ead5b39e', true, false, false, '20260713113000'),
    ('public.block_retired_community_poll_writes()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '993ce2d6eac939878a835e4c39eb4749', true, false, false, '20260713113000'),
    ('public.reject_congratulatory_money_write()', 'trigger',
      'plpgsql', 'v', false, 'search_path=pg_catalog,public',
      '06a4a3cfd01028b6bc8efffe4d308c45', true, false, false, '20260713114000'),
    ('public.block_retired_community_structured_fields()', 'trigger',
      'plpgsql', 'v', false, 'search_path=""',
      '8b0a42a25c812f05ba84cc060dcfc24e', true, false, false, '20260713115000'),
    ('public.community_soft_delete_comment(uuid,uuid)',
      'TABLE(comment_id uuid, post_id uuid, author_id uuid, deleted boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '1f94340d26771efa8d1fcf13e4eb875b', true, false, false,
      '20260713117000'),
    ('public.sync_community_actor_identity()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '65e9cb5b5a27f8446bdfbe5153c74366', false, false, false,
      '20260713118000'),
    ('public.maintain_community_profile_post_count()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '728309d11c41d182e4b3fe827004e90c', false, false, false,
      '20260713119000'),
    ('public.maintain_community_counts_after_comment_delete()', 'trigger',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'b322f9adb70968e2a4220f404d138b0b', false, false, false,
      '20260713119000'),
    ('public.community_hard_delete_post(uuid,uuid)',
      'TABLE(post_id uuid, author_id uuid, deleted boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '6aac47ba565ff0f44bed0466a6d7b5d0', true, false, false,
      '20260713119000'),
    ('public.community_update_post(uuid,uuid,jsonb)',
      'TABLE(post_id uuid, updated boolean, viewer_is_author boolean)',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      '0b72e707092ed3bc704bb19ff3df9aff', true, false, false,
      '20260713121000'),
    ('private.assert_preview_smoke_authorized(text)', 'void',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'e4772be082666fdac6408bcc2dae4f42', false, false, false,
      '20260713123000'),
    ('private.assert_preview_smoke_user(uuid)', 'void',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'c08a3f7b64c7784a7c944212443cd162', false, false, false,
      '20260713123000'),
    ('public.assert_preview_smoke_ready(text)', 'jsonb',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'a0f9da46ab4f7e6a178efe06addd5d47', true, false, false,
      '20260713123000'),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      'jsonb', 'plpgsql', 'v', true,
      'search_path="",row_security=off',
      '907fd91bfaf189113890376f07ecaaae', true, false, false,
      '20260713123000'),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      'jsonb', 'plpgsql', 'v', true,
      'search_path="",row_security=off',
      'bd999b81c877d9f6bba03635df005e72', true, false, false,
      '20260713123000'),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])', 'jsonb',
      'plpgsql', 'v', true, 'search_path="",row_security=off',
      'fadd1a5db3bf53d0625b97eadb329c22', true, false, false,
      '20260713123000')
), trusted_beta_function_status AS (
  SELECT required.signature,
         required.creator_version,
         procedure_row.oid IS NULL OR (
           pg_get_function_result(procedure_row.oid) = required.expected_result
           AND (
             argument_contract.signature IS NULL
             OR pg_get_function_arguments(procedure_row.oid) =
               argument_contract.expected_arguments
           )
         )
           AS replaceable,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = required.expected_result
           AND (
             argument_contract.signature IS NULL
             OR pg_get_function_arguments(procedure_row.oid) =
               argument_contract.expected_arguments
           )
           AND language_row.lanname = required.expected_language
           AND procedure_row.provolatile = required.expected_volatility::"char"
           AND procedure_row.prosecdef = required.expected_security_definer
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND regexp_replace(
             coalesce(array_to_string(procedure_row.proconfig, ','), ''),
             '[[:space:]]+', '', 'g'
           ) = required.expected_proconfig
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             required.expected_source_md5
           AND has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           ) = required.service_role_execute
           AND has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           ) = required.anon_execute
           AND has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           ) = required.authenticated_execute
           AS exact
  FROM trusted_beta_function_contracts required
  LEFT JOIN preview_smoke_function_arguments argument_contract
    ON argument_contract.signature = required.signature
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
  LEFT JOIN pg_catalog.pg_language language_row
    ON language_row.oid = procedure_row.prolang
), trusted_beta_trigger_contracts(
  schema_name, table_name, trigger_name, function_signature, creator_version
) AS (
  VALUES
    ('public', 'customer_events', 'block_retired_customer_events_writes',
      'public.block_retired_raw_customer_tracking_writes()', '20260713112000'),
    ('public', 'search_logs', 'block_retired_search_logs_writes',
      'public.block_retired_raw_customer_tracking_writes()', '20260713112000'),
    ('storage', 'objects', 'block_retired_community_media_object_writes',
      'public.block_retired_community_media_object_writes()', '20260713113000'),
    ('public', 'community_posts', 'block_retired_community_post_media_writes',
      'public.block_retired_community_post_media_writes()', '20260713113000'),
    ('public', 'community_polls', 'block_retired_community_poll_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'community_poll_options',
      'block_retired_community_poll_option_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'community_poll_votes',
      'block_retired_community_poll_vote_writes',
      'public.block_retired_community_poll_writes()', '20260713113000'),
    ('public', 'congratulatory_money',
      'trg_reject_congratulatory_money_write',
      'public.reject_congratulatory_money_write()', '20260713114000'),
    ('public', 'community_posts',
      'block_retired_community_structured_fields',
      'public.block_retired_community_structured_fields()', '20260713115000')
), trusted_beta_trigger_status AS (
  SELECT required.trigger_name,
         required.creator_version,
         trigger_row.oid IS NOT NULL
           AND NOT trigger_row.tgisinternal
           AND trigger_row.tgenabled = 'O'
           AND trigger_row.tgtype = 23
           AND trigger_row.tgfoid = to_regprocedure(required.function_signature)
           AS exact
  FROM trusted_beta_trigger_contracts required
  LEFT JOIN pg_catalog.pg_trigger trigger_row
    ON trigger_row.tgrelid = to_regclass(
      required.schema_name || '.' || required.table_name
    )
   AND trigger_row.tgname = required.trigger_name
), trusted_beta_community_post_columns(column_name) AS (
  VALUES
    ('id'), ('author_id'), ('category'), ('title'), ('content'),
    ('visibility'), ('ad_disclosure'), ('sponsorship_detail'),
    ('is_resolved'), ('under_review'), ('upvote_count'), ('downvote_count'),
    ('comment_count'), ('view_count'), ('bookmark_count'), ('is_pinned'),
    ('is_weekly_best'), ('tags'), ('created_at'), ('updated_at')
), trusted_beta_function_acl_contracts(
  signature, allowed_roles, required_explicit_roles
) AS (
  VALUES
    ('public.community_author_is_muted(uuid)',
      ARRAY['postgres', 'anon', 'authenticated']::name[],
      ARRAY['anon', 'authenticated']::name[]),
    ('public.community_soft_delete_comment(uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.sync_community_actor_identity()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.maintain_community_profile_post_count()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.maintain_community_counts_after_comment_delete()',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.community_hard_delete_post(uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.community_update_post(uuid,uuid,jsonb)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.community_increment_profile_count(uuid,text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.community_decrement_profile_count(uuid,text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('private.assert_preview_smoke_authorized(text)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('private.assert_preview_smoke_user(uuid)',
      ARRAY['postgres']::name[], ARRAY[]::name[]),
    ('public.assert_preview_smoke_ready(text)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[]),
    ('public.cleanup_preview_smoke_fixture(text,uuid[])',
      ARRAY['postgres', 'service_role']::name[],
      ARRAY['service_role']::name[])
), trusted_beta_function_acl_status AS (
  SELECT required.signature,
         procedure_row.oid IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               procedure_row.proacl,
               pg_catalog.acldefault('f', procedure_row.proowner)
             )) privilege_row
             LEFT JOIN pg_catalog.pg_roles granted_role
               ON granted_role.oid = privilege_row.grantee
             WHERE privilege_row.privilege_type <> 'EXECUTE'
                OR privilege_row.grantee = 0
                OR NOT (
                  granted_role.rolname = ANY(required.allowed_roles)
                )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM unnest(required.required_explicit_roles)
               expected(role_name)
             WHERE NOT EXISTS (
               SELECT 1
               FROM pg_catalog.aclexplode(COALESCE(
                 procedure_row.proacl,
                 pg_catalog.acldefault('f', procedure_row.proowner)
               )) privilege_row
               JOIN pg_catalog.pg_roles granted_role
                 ON granted_role.oid = privilege_row.grantee
               JOIN pg_catalog.pg_roles grantor_role
                 ON grantor_role.oid = privilege_row.grantor
               WHERE granted_role.rolname = expected.role_name
                 AND grantor_role.rolname = 'postgres'
                 AND privilege_row.privilege_type = 'EXECUTE'
                 AND NOT privilege_row.is_grantable
             )
           ) AS exact
  FROM trusted_beta_function_acl_contracts required
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = to_regprocedure(required.signature)
), trusted_beta_mute_helper_status AS (
  SELECT procedure_row.oid IS NULL AS absent,
         procedure_row.oid IS NULL OR (
           pg_get_function_result(procedure_row.oid) = 'boolean'
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
         ) AS replaceable,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND pg_get_function_arguments(procedure_row.oid) = 'p_author_id uuid'
           AND language_row.lanname = 'sql'
           AND procedure_row.provolatile = 's'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND regexp_replace(
             coalesce(array_to_string(procedure_row.proconfig, ','), ''),
             '[[:space:]]+', '', 'g'
           ) = 'search_path=""'
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             '9a4ad31283eaa7f89e7e34fb58ea8687'
           AND coalesce((
             SELECT exact FROM trusted_beta_function_acl_status
             WHERE signature = 'public.community_author_is_muted(uuid)'
           ), false) AS legacy_exact,
         procedure_row.oid IS NOT NULL
           AND pg_get_function_result(procedure_row.oid) = 'boolean'
           AND pg_get_function_arguments(procedure_row.oid) =
             'p_author_public_id uuid'
           AND language_row.lanname = 'sql'
           AND procedure_row.provolatile = 's'
           AND procedure_row.prosecdef
           AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
           AND regexp_replace(
             coalesce(array_to_string(procedure_row.proconfig, ','), ''),
             '[[:space:]]+', '', 'g'
           ) = 'search_path="",row_security=off'
           AND md5(replace(procedure_row.prosrc, chr(13), '')) =
             '618d8f9a6968a99f285f4a09ab8da44e'
           AND coalesce((
             SELECT exact FROM trusted_beta_function_acl_status
             WHERE signature = 'public.community_author_is_muted(uuid)'
           ), false) AS opaque_exact
  FROM (SELECT to_regprocedure(
    'public.community_author_is_muted(uuid)'
  ) AS oid) target
  LEFT JOIN pg_catalog.pg_proc procedure_row
    ON procedure_row.oid = target.oid
  LEFT JOIN pg_catalog.pg_language language_row
    ON language_row.oid = procedure_row.prolang
), trusted_beta_mute_policy_rows AS (
  SELECT policy_row.policyname,
         replace(regexp_replace(
           lower(coalesce(policy_row.qual, '')),
           '[[:space:]"]+', '', 'g'
         ), 'public.', '') AS normalized_qual,
         policy_row.permissive = 'PERMISSIVE'
           AND policy_row.roles = ARRAY['public'::name]
           AND policy_row.cmd = 'SELECT'
           AND policy_row.with_check IS NULL AS common_exact
  FROM pg_catalog.pg_policies policy_row
  WHERE (policy_row.tablename, policy_row.policyname) IN (
    ('community_posts', 'cp_select_public'),
    ('community_posts', 'cp_select_members'),
    ('community_posts', 'cp_select_drafts'),
    ('community_comments', 'cc_select')
  )
    AND policy_row.schemaname = 'public'
), trusted_beta_mute_policy_status AS (
  SELECT count(*) = 4
    AND 4 = (
      SELECT count(*) FROM pg_catalog.pg_policies client_read_policy
      WHERE client_read_policy.schemaname = 'public'
        AND client_read_policy.tablename IN (
          'community_posts', 'community_comments'
        )
        AND client_read_policy.cmd IN ('SELECT', 'ALL')
        AND client_read_policy.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
    )
    AND bool_and(policy_row.common_exact)
    AND bool_and(CASE policy_row.policyname
      WHEN 'cp_select_public' THEN
        policy_row.normalized_qual LIKE '%visibility%''public''%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(author_id)%'
        AND policy_row.normalized_qual LIKE '%under_review%'
      WHEN 'cp_select_members' THEN
        policy_row.normalized_qual LIKE '%visibility%''members''%'
        AND policy_row.normalized_qual LIKE '%auth.role%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(author_id)%'
        AND policy_row.normalized_qual LIKE '%under_review%'
      WHEN 'cp_select_drafts' THEN
        policy_row.normalized_qual LIKE '%visibility%''draft''%'
        AND policy_row.normalized_qual LIKE '%author_id%auth.uid%'
        AND policy_row.normalized_qual NOT LIKE
          '%community_author_is_muted%'
      WHEN 'cc_select' THEN
        policy_row.normalized_qual LIKE
          '%community_author_is_muted(community_comments.author_id)%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(post.author_id)%'
        AND policy_row.normalized_qual LIKE '%post.visibility%'
        AND policy_row.normalized_qual LIKE '%post.under_review%'
      ELSE false
    END) AS legacy_exact,
    count(*) = 4
    AND 4 = (
      SELECT count(*) FROM pg_catalog.pg_policies client_read_policy
      WHERE client_read_policy.schemaname = 'public'
        AND client_read_policy.tablename IN (
          'community_posts', 'community_comments'
        )
        AND client_read_policy.cmd IN ('SELECT', 'ALL')
        AND client_read_policy.roles && ARRAY[
          'public'::name, 'anon'::name, 'authenticated'::name
        ]
    )
    AND bool_and(policy_row.common_exact)
    AND bool_and(CASE policy_row.policyname
      WHEN 'cp_select_public' THEN
        policy_row.normalized_qual LIKE '%visibility%''public''%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(author_public_id)%'
        AND policy_row.normalized_qual LIKE '%under_review%'
      WHEN 'cp_select_members' THEN
        policy_row.normalized_qual LIKE '%visibility%''members''%'
        AND policy_row.normalized_qual LIKE '%auth.role%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(author_public_id)%'
        AND policy_row.normalized_qual LIKE '%under_review%'
      WHEN 'cp_select_drafts' THEN
        policy_row.normalized_qual LIKE '%visibility%''draft''%'
        AND policy_row.normalized_qual LIKE '%author_id%auth.uid%'
        AND policy_row.normalized_qual NOT LIKE
          '%community_author_is_muted%'
      WHEN 'cc_select' THEN
        policy_row.normalized_qual LIKE
          '%community_author_is_muted(community_comments.author_public_id)%'
        AND policy_row.normalized_qual LIKE
          '%community_author_is_muted(post.author_public_id)%'
        AND policy_row.normalized_qual LIKE '%post.visibility%'
        AND policy_row.normalized_qual LIKE '%post.under_review%'
      ELSE false
    END) AS opaque_exact
  FROM trusted_beta_mute_policy_rows policy_row
), trusted_beta_actor_public_columns(table_name, column_name) AS (
  VALUES
    ('community_profiles', 'public_actor_id'),
    ('community_profiles', 'nickname'),
    ('community_profiles', 'avatar_url'),
    ('community_posts', 'id'),
    ('community_posts', 'author_public_id'),
    ('community_posts', 'category'),
    ('community_posts', 'title'),
    ('community_posts', 'content'),
    ('community_posts', 'visibility'),
    ('community_posts', 'ad_disclosure'),
    ('community_posts', 'sponsorship_detail'),
    ('community_posts', 'is_resolved'),
    ('community_posts', 'under_review'),
    ('community_posts', 'upvote_count'),
    ('community_posts', 'downvote_count'),
    ('community_posts', 'comment_count'),
    ('community_posts', 'view_count'),
    ('community_posts', 'bookmark_count'),
    ('community_posts', 'is_pinned'),
    ('community_posts', 'is_weekly_best'),
    ('community_posts', 'tags'),
    ('community_posts', 'created_at'),
    ('community_posts', 'updated_at'),
    ('community_comments', 'id'),
    ('community_comments', 'post_id'),
    ('community_comments', 'parent_id'),
    ('community_comments', 'author_public_id'),
    ('community_comments', 'content'),
    ('community_comments', 'upvote_count'),
    ('community_comments', 'is_deleted'),
    ('community_comments', 'created_at'),
    ('community_comments', 'updated_at')
), trusted_beta_actor_boundary_status AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles', 'public_actor_id'),
        ('community_posts', 'author_public_id'),
        ('community_comments', 'author_public_id')
      ) expected(table_name, column_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attname = expected.column_name
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
    )
    AND to_regprocedure('public.sync_community_actor_identity()') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger trigger_row
      WHERE (trigger_row.tgrelid, trigger_row.tgname) IN (
        (to_regclass('public.community_profiles'),
          'sync_community_profile_actor_id'),
        (to_regclass('public.community_posts'),
          'sync_community_post_actor_id'),
        (to_regclass('public.community_comments'),
          'sync_community_comment_actor_id')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conname IN (
        'community_profiles_public_actor_id_key',
        'community_profiles_public_nickname_nonempty',
        'community_profiles_public_avatar_emoji_only',
        'community_posts_author_public_id_fkey',
        'community_comments_author_public_id_fkey'
      )
    ) AS legacy_absent,
    3 = (
      SELECT count(*)
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      JOIN pg_catalog.pg_class table_row
        ON table_row.oid = to_regclass('public.' || expected.table_name)
      WHERE table_row.relkind = 'r'
        AND table_row.relrowsecurity
        AND pg_get_userbyid(table_row.relowner) = 'postgres'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles', 'public_actor_id',
          'uuid', true, 'extensions.gen_random_uuid()'),
        ('community_posts', 'author_public_id',
          'uuid', true, NULL::text),
        ('community_comments', 'author_public_id',
          'uuid', true, NULL::text)
      ) expected(
        table_name, column_name, data_type, not_null, expected_default
      )
      LEFT JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attname = expected.column_name
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef default_row
        ON default_row.adrelid = attribute_row.attrelid
       AND default_row.adnum = attribute_row.attnum
      WHERE attribute_row.attname IS NULL
         OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
            IS DISTINCT FROM expected.data_type
         OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
         OR pg_get_expr(default_row.adbin, default_row.adrelid)
            IS DISTINCT FROM expected.expected_default
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_nickname_nonempty'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) =
          'CHECK (btrim(nickname) <> ''''::text)'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_actor_id_key'
        AND constraint_row.contype = 'u'
        AND constraint_row.convalidated
        AND constraint_row.conkey = ARRAY[(
          SELECT attribute_row.attnum
          FROM pg_catalog.pg_attribute attribute_row
          WHERE attribute_row.attrelid =
              'public.community_profiles'::regclass
            AND attribute_row.attname = 'public_actor_id'
        )]::smallint[]
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid =
          'public.community_profiles'::regclass
        AND constraint_row.conname =
          'community_profiles_public_avatar_emoji_only'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url = btrim(avatar_url)%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%char_length(avatar_url)%BETWEEN 1 AND 8%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url ~%01F000%01FAFF%2600%27BF%'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE
          '%avatar_url !~%200D%FE0F%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_posts', 'community_posts_author_public_id_fkey'),
        ('community_comments', 'community_comments_author_public_id_fkey')
      ) expected(table_name, constraint_name)
      LEFT JOIN pg_catalog.pg_constraint constraint_row
        ON constraint_row.conrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND constraint_row.conname = expected.constraint_name
      WHERE constraint_row.oid IS NULL
         OR constraint_row.contype <> 'f'
         OR NOT constraint_row.convalidated
         OR constraint_row.confrelid <>
              'public.community_profiles'::regclass
         OR constraint_row.confupdtype <> 'r'
         OR constraint_row.confdeltype <> 'c'
         OR constraint_row.conkey <> ARRAY[(
              SELECT attribute_row.attnum
              FROM pg_catalog.pg_attribute attribute_row
              WHERE attribute_row.attrelid = to_regclass(
                  'public.' || expected.table_name
                )
                AND attribute_row.attname = 'author_public_id'
            )]::smallint[]
         OR constraint_row.confkey <> ARRAY[(
              SELECT attribute_row.attnum
              FROM pg_catalog.pg_attribute attribute_row
              WHERE attribute_row.attrelid =
                  'public.community_profiles'::regclass
                AND attribute_row.attname = 'public_actor_id'
            )]::smallint[]
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class index_class
      JOIN pg_catalog.pg_index index_row
        ON index_row.indexrelid = index_class.oid
      WHERE index_class.relnamespace = 'public'::regnamespace
        AND index_class.relname = 'idx_community_posts_author_public_id'
        AND index_row.indisvalid AND index_row.indisready
        AND pg_get_indexdef(index_class.oid) =
          'CREATE INDEX idx_community_posts_author_public_id ON public.community_posts USING btree (author_public_id, created_at DESC)'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class index_class
      JOIN pg_catalog.pg_index index_row
        ON index_row.indexrelid = index_class.oid
      WHERE index_class.relnamespace = 'public'::regnamespace
        AND index_class.relname =
          'idx_community_comments_author_public_id'
        AND index_row.indisvalid AND index_row.indisready
        AND pg_get_indexdef(index_class.oid) =
          'CREATE INDEX idx_community_comments_author_public_id ON public.community_comments USING btree (author_public_id, created_at)'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        client(role_name)
      WHERE has_table_privilege(
        client.role_name, 'public.' || expected.table_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
      ) OR has_any_column_privilege(
        client.role_name, 'public.' || expected.table_name,
        'INSERT,UPDATE,REFERENCES'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts'), ('community_comments')
      ) expected(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
        client(role_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      WHERE has_column_privilege(
        client.role_name, attribute_row.attrelid,
        attribute_row.attnum, 'SELECT'
      ) IS DISTINCT FROM EXISTS (
        SELECT 1 FROM trusted_beta_actor_public_columns allowed
        WHERE allowed.table_name = expected.table_name
          AND allowed.column_name = attribute_row.attname
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts')
      ) expected(table_name)
      WHERE NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'SELECT'
            )
         OR NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'INSERT'
            )
         OR NOT has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'UPDATE'
            )
         OR has_table_privilege(
              'service_role', 'public.' || expected.table_name, 'DELETE'
            ) IS DISTINCT FROM (
              expected.table_name = 'community_posts'
            )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'TRUNCATE'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'REFERENCES'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'TRIGGER'
         )
         OR has_table_privilege(
           'service_role', 'public.' || expected.table_name, 'MAINTAIN'
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        (
          'community_profiles',
          ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
        ),
        (
          'community_posts',
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
        ),
        ('community_comments', ARRAY['SELECT']::text[])
      ) expected(table_name, privileges)
      JOIN pg_catalog.pg_class table_row
        ON table_row.oid = to_regclass('public.' || expected.table_name)
      WHERE EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        WHERE privilege_row.grantee = 0
      )
      OR NOT coalesce((
        SELECT
          count(*) = cardinality(expected.privileges)
          AND coalesce(bool_and(
            privilege_row.privilege_type = ANY(expected.privileges)
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          ), true)
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
      ), false)
    )
    AND has_table_privilege(
      'service_role', 'public.community_comments', 'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'DELETE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'TRUNCATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'REFERENCES'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'TRIGGER'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.community_comments', 'MAINTAIN'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute attribute_row
      WHERE attribute_row.attrelid =
          'public.community_comments'::regclass
        AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        AND (
          has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'INSERT'
          )
          OR has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'REFERENCES'
          )
          OR has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum,
            'UPDATE'
          ) IS DISTINCT FROM (
            attribute_row.attname = ANY (
              ARRAY['content', 'updated_at']::name[]
            )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'), ('community_posts')
      ) expected(table_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
          'public.' || expected.table_name
        )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      WHERE has_column_privilege(
        'service_role', attribute_row.attrelid, attribute_row.attnum,
        'REFERENCES'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('community_profiles'),
        ('community_posts'),
        ('community_comments')
      ) expected(table_name)
      JOIN pg_catalog.pg_attribute attribute_row
        ON attribute_row.attrelid = to_regclass(
            'public.' || expected.table_name
          )
       AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        privilege_row
      LEFT JOIN pg_catalog.pg_roles grantor
        ON grantor.oid = privilege_row.grantor
      WHERE privilege_row.grantee = 0
         OR (
           privilege_row.grantee = (
             SELECT role_row.oid FROM pg_catalog.pg_roles role_row
             WHERE role_row.rolname = 'service_role'
           )
           AND (
             expected.table_name <> 'community_comments'
             OR attribute_row.attname <> ALL(
               ARRAY['content', 'updated_at']::name[]
             )
             OR privilege_row.privilege_type <> 'UPDATE'
             OR privilege_row.is_grantable
             OR grantor.rolname <> 'postgres'
           )
         )
    )
    AND 2 = (
      SELECT count(*)
      FROM pg_catalog.pg_attribute attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        privilege_row
      WHERE attribute_row.attrelid =
            'public.community_comments'::regclass
        AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        AND privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
    )
    AND coalesce((
      SELECT exact FROM privacy_policy_status
      WHERE table_name = 'community_profiles'
        AND policy_name = 'community_profiles_select_public_card'
    ), false)
    AND coalesce((
      SELECT opaque_exact FROM trusted_beta_mute_helper_status
    ), false)
    AND coalesce((
      SELECT opaque_exact FROM trusted_beta_mute_policy_status
    ), false)
    AND NOT EXISTS (
      SELECT 1 FROM trusted_beta_function_status status
      WHERE status.creator_version = '20260713118000' AND NOT status.exact
    )
    AND coalesce((
      SELECT exact FROM trusted_beta_function_acl_status
      WHERE signature = 'public.sync_community_actor_identity()'
    ), false)
    AND NOT EXISTS (
      SELECT 1 FROM client_denied_trigger_function_status status
      WHERE status.creator_version = '20260713118000' AND NOT status.exact
    )
    AND NOT EXISTS (
      SELECT 1 FROM client_denied_trigger_binding_status status
      WHERE status.creator_version = '20260713118000' AND NOT status.exact
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication publication_row
      WHERE publication_row.pubname = 'supabase_realtime'
        AND publication_row.puballtables
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
      WHERE publication_table.pubname = 'supabase_realtime'
        AND publication_table.schemaname = 'public'
        AND publication_table.tablename IN (
          'community_profiles', 'community_posts', 'community_comments'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_profiles community_profile
      LEFT JOIN public.profiles account_profile
        ON account_profile.id = community_profile.user_id
      WHERE to_jsonb(community_profile)->>'public_actor_id' IS NULL
         OR btrim(community_profile.nickname) = ''
         OR (
           account_profile.name IS NOT NULL
           AND btrim(community_profile.nickname) = btrim(account_profile.name)
         )
         OR community_profile.nickname ~ '^웨딩친구-[a-z0-9]{12}$'
         OR (
           community_profile.avatar_url IS NOT NULL
           AND (
             community_profile.avatar_url <>
               btrim(community_profile.avatar_url)
             OR char_length(community_profile.avatar_url) NOT BETWEEN 1 AND 8
             OR community_profile.avatar_url !~
               U&'[\+01F000-\+01FAFF\2600-\27BF]'
             OR community_profile.avatar_url ~
               U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]'
           )
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.community_profiles community_profile
      JOIN auth.users auth_user
        ON auth_user.id::text =
           to_jsonb(community_profile)->>'public_actor_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_posts post
      LEFT JOIN public.community_profiles profile
        ON profile.user_id = post.author_id
      WHERE to_jsonb(post)->>'author_public_id' IS NULL
         OR to_jsonb(post)->>'author_public_id' IS DISTINCT FROM
              to_jsonb(profile)->>'public_actor_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.community_comments comment_row
      LEFT JOIN public.community_profiles profile
        ON profile.user_id = comment_row.author_id
      WHERE to_jsonb(comment_row)->>'author_public_id' IS NULL
         OR to_jsonb(comment_row)->>'author_public_id' IS DISTINCT FROM
              to_jsonb(profile)->>'public_actor_id'
    ) AS exact
), research_consent_version_status AS (
  SELECT
    table_row.oid IS NULL OR (
      column_row.attname IS NOT NULL
      AND format_type(column_row.atttypid, column_row.atttypmod) = 'text'
      AND column_row.attnotnull
      AND constraint_row.oid IS NOT NULL
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) IN (
        'CHECK (privacy_policy_version = ''2026-07-12''::text)',
        'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))'
      )
    ) AS replaceable,
    table_row.oid IS NOT NULL
      AND column_row.attname IS NOT NULL
      AND format_type(column_row.atttypid, column_row.atttypmod) = 'text'
      AND column_row.attnotnull
      AND constraint_row.oid IS NOT NULL
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) =
        'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))'
      AS exact,
    NULL::bigint AS invalid_rows
  FROM (SELECT to_regclass(
    'public.research_cohort_applications'
  ) AS oid) table_target
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = table_target.oid
  LEFT JOIN pg_catalog.pg_attribute column_row
    ON column_row.attrelid = table_row.oid
   AND column_row.attname = 'privacy_policy_version'
   AND column_row.attnum > 0 AND NOT column_row.attisdropped
  LEFT JOIN pg_catalog.pg_constraint constraint_row
    ON constraint_row.conrelid = table_row.oid
   AND constraint_row.conname =
     'research_cohort_applications_privacy_policy_check'
), trusted_beta_surface_contract AS (
  SELECT
    (
      to_regclass('public.customer_events') IS NOT NULL
      AND to_regclass('public.search_logs') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112000'
          AND NOT status.replaceable
      )
    ) AS raw_tracking_retirement_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('public.' || expected.table_name)
        WHERE NOT table_row.relrowsecurity OR NOT table_row.relforcerowsecurity
      )
      AND 2 = (
        SELECT count(*)
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        WHERE to_regclass('public.' || expected.table_name) IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          client(role_name)
        WHERE has_table_privilege(
          client.role_name, to_regclass('public.' || expected.table_name),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, to_regclass('public.' || expected.table_name),
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename IN ('customer_events', 'search_logs')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('customer_events', ARRAY['SELECT', 'DELETE']::text[]),
          ('search_logs', ARRAY['DELETE']::text[])
        ) expected(table_name, privileges)
        CROSS JOIN unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) permission(privilege_name)
        WHERE has_table_privilege(
          'service_role', to_regclass('public.' || expected.table_name),
          permission.privilege_name
        ) IS DISTINCT FROM (
          permission.privilege_name = ANY(expected.privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('customer_events', ARRAY['SELECT', 'DELETE']::text[]),
          ('search_logs', ARRAY['DELETE']::text[])
        ) expected(table_name, privileges)
        JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('public.' || expected.table_name)
        WHERE EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
          WHERE privilege_row.grantee = 0
        )
        OR NOT coalesce((
          SELECT
            count(*) = cardinality(expected.privileges)
            AND coalesce(bool_and(
              privilege_row.privilege_type = ANY(expected.privileges)
              AND NOT privilege_row.is_grantable
              AND grantor.rolname = 'postgres'
            ), true)
          FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
          JOIN pg_catalog.pg_roles grantor
            ON grantor.oid = privilege_row.grantor
          WHERE privilege_row.grantee = (
            SELECT role_row.oid FROM pg_catalog.pg_roles role_row
            WHERE role_row.rolname = 'service_role'
          )
        ), false)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('customer_events'), ('search_logs')) expected(table_name)
        JOIN pg_catalog.pg_attribute attribute_row
          ON attribute_row.attrelid = to_regclass(
            'public.' || expected.table_name
          )
         AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE privilege_row.grantee = 0
           OR privilege_row.grantee = (
             SELECT role_row.oid FROM pg_catalog.pg_roles role_row
             WHERE role_row.rolname = 'service_role'
           )
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713112000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_events
        WHERE created_at < now() - interval '90 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.search_logs
        WHERE created_at < now() - interval '90 days'
      )
    ) AS raw_tracking_retirement_exact,
    (
      to_regclass('public.profiles') IS NOT NULL
      AND to_regclass('public.couples') IS NOT NULL
      AND to_regprocedure('public.can_read_profile(uuid)') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112500'
          AND NOT status.replaceable
      )
    ) AS profiles_direct_select_closure_replaceable,
    (
      to_regclass('public.profiles') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.profiles',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.profiles',
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = 'profiles'
          AND privilege_row.grantee = 'PUBLIC'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.column_privileges privilege_row
        WHERE privilege_row.table_schema = 'public'
          AND privilege_row.table_name = 'profiles'
          AND privilege_row.grantee = 'PUBLIC'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'profiles'
          AND policy_row.roles && ARRAY[
            'public'::name, 'anon'::name, 'authenticated'::name
          ]
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'INSERT'
      )
      AND has_table_privilege(
        'service_role', 'public.profiles', 'UPDATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'DELETE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'TRUNCATE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'REFERENCES'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'TRIGGER'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.profiles', 'MAINTAIN'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class table_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(table_row.relacl)
          privilege_row
        WHERE table_row.oid = 'public.profiles'::regclass
          AND privilege_row.grantee = 0
      )
      AND coalesce((
        SELECT
          count(*) = 3
          AND bool_and(
            privilege_row.privilege_type = ANY(
              ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
            )
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          )
        FROM pg_catalog.pg_class table_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(table_row.relacl)
          privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE table_row.oid = 'public.profiles'::regclass
          AND privilege_row.grantee = (
            SELECT role_row.oid FROM pg_catalog.pg_roles role_row
            WHERE role_row.rolname = 'service_role'
          )
      ), false)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE attribute_row.attrelid = 'public.profiles'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND (
            privilege_row.grantee = 0
            OR privilege_row.grantee = (
              SELECT role_row.oid FROM pg_catalog.pg_roles role_row
              WHERE role_row.rolname = 'service_role'
            )
          )
      )
      AND NOT has_function_privilege(
        'anon', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND has_function_privilege(
        'service_role', 'public.can_read_profile(uuid)', 'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713112500' AND NOT status.exact
      )
    ) AS profiles_direct_select_closure_exact,
    (
      to_regclass('storage.objects') IS NOT NULL
      AND to_regclass('public.community_posts') IS NOT NULL
      AND to_regclass('public.community_polls') IS NOT NULL
      AND to_regclass('public.community_poll_options') IS NOT NULL
      AND to_regclass('public.community_poll_votes') IS NOT NULL
      AND 2 = (
        SELECT count(*) FROM storage.buckets
        WHERE id IN ('community-images', 'community-videos')
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713113000'
          AND NOT status.replaceable
      )
    ) AS community_media_retirement_replaceable,
    (
      2 = (
        SELECT count(*) FROM storage.buckets
        WHERE id IN ('community-images', 'community-videos') AND NOT public
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'storage'
          AND policy_row.tablename = 'objects'
          AND concat_ws(
            ' ', coalesce(policy_row.qual, ''),
            coalesce(policy_row.with_check, '')
          ) ~ 'community-(images|videos)'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713113000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713113000' AND NOT status.exact
      )
    ) AS community_media_retirement_exact,
    (
      to_regclass('public.congratulatory_money') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713114000'
          AND NOT status.replaceable
      )
    ) AS congratulatory_money_retirement_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.congratulatory_money',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.congratulatory_money',
          'SELECT,INSERT,UPDATE,REFERENCES'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.tablename = 'congratulatory_money'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.congratulatory_money', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.congratulatory_money', 'DELETE'
      )
      AND NOT has_table_privilege(
        'service_role', 'public.congratulatory_money',
        'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        WHERE attribute_row.attrelid = 'public.congratulatory_money'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND has_column_privilege(
            'service_role', attribute_row.attrelid, attribute_row.attnum, 'SELECT'
          ) IS DISTINCT FROM (
            attribute_row.attname = ANY(
              ARRAY['id', 'owner_user_id', 'couple_id']::name[]
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713114000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713114000' AND NOT status.exact
      )
    ) AS congratulatory_money_retirement_exact,
    (
      to_regclass('public.community_posts') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713115000'
          AND NOT status.replaceable
      )
    ) AS community_text_only_boundary_replaceable,
    (
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
          client(role_name)
        WHERE attribute_row.attrelid = 'public.community_posts'::regclass
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND has_column_privilege(
            client.role_name, attribute_row.attrelid,
            attribute_row.attnum, 'SELECT'
          ) IS DISTINCT FROM EXISTS (
            SELECT 1 FROM trusted_beta_community_post_columns allowed
            WHERE allowed.column_name = attribute_row.attname
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated']::text[]) client(role_name)
        WHERE has_table_privilege(
          client.role_name, 'public.community_posts',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR has_any_column_privilege(
          client.role_name, 'public.community_posts',
          'INSERT,UPDATE,REFERENCES'
        )
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'SELECT'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'INSERT'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'UPDATE'
      )
      AND has_table_privilege(
        'service_role', 'public.community_posts', 'DELETE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = 'community_posts'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713115000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_trigger_status status
        WHERE status.creator_version = '20260713115000' AND NOT status.exact
      )
    ) AS community_text_only_boundary_exact,
    (
      (
        to_regclass('public.community_user_mutes') IS NULL
        AND coalesce((
          SELECT absent FROM trusted_beta_mute_helper_status
        ), false)
      )
      OR (
        SELECT count(*) = 1 AND bool_and(
          table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND table_row.relforcerowsecurity
          AND pg_get_userbyid(table_row.relowner) = 'postgres'
          AND coalesce((
            SELECT
              (helper.legacy_exact AND policy.legacy_exact)
              OR (helper.opaque_exact AND policy.opaque_exact)
            FROM trusted_beta_mute_helper_status helper
            CROSS JOIN trusted_beta_mute_policy_status policy
          ), false)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies policy_row
            WHERE policy_row.schemaname = 'public'
              AND policy_row.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(ARRAY['anon', 'authenticated']::text[])
              client(role_name)
            WHERE has_table_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
            ) OR has_any_column_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'SELECT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'INSERT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'DELETE'
          )
          AND NOT has_table_privilege(
            'service_role', table_row.oid,
            'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
          AND NOT has_any_column_privilege(
            'service_role', table_row.oid, 'UPDATE,REFERENCES'
          )
          AND 3 = (
            SELECT count(*) FROM pg_catalog.pg_attribute attribute_row
            WHERE attribute_row.attrelid = table_row.oid
              AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('muter_id', 'uuid', true, NULL::text),
              ('muted_user_id', 'uuid', true, NULL::text),
              ('created_at', 'timestamp with time zone', true, 'now()')
            ) expected(column_name, data_type, not_null, expected_default)
            LEFT JOIN pg_catalog.pg_attribute attribute_row
              ON attribute_row.attrelid = table_row.oid
             AND attribute_row.attname = expected.column_name
             AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef default_row
              ON default_row.adrelid = attribute_row.attrelid
             AND default_row.adnum = attribute_row.attnum
            WHERE attribute_row.attname IS NULL
               OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
                  IS DISTINCT FROM expected.data_type
               OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
               OR pg_get_expr(default_row.adbin, default_row.adrelid)
                  IS DISTINCT FROM expected.expected_default
          )
          AND 4 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_pkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'PRIMARY KEY (muter_id, muted_user_id)'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_no_self'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK (muter_id <> muted_user_id)'
          )
          AND 2 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'f'
              AND constraint_row.confrelid = 'auth.users'::regclass
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.convalidated
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muter_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muter_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muted_user_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class index_class
            JOIN pg_catalog.pg_index index_row
              ON index_row.indexrelid = index_class.oid
            WHERE index_class.relnamespace = 'public'::regnamespace
              AND index_class.relname = 'idx_community_user_mutes_muted_user'
              AND index_row.indrelid = table_row.oid
              AND index_row.indisvalid AND index_row.indisready
              AND regexp_replace(
                pg_get_indexdef(index_class.oid), '[[:space:]]+', ' ', 'g'
              ) = 'CREATE INDEX idx_community_user_mutes_muted_user ON public.community_user_mutes USING btree (muted_user_id, muter_id)'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
            WHERE publication_table.pubname = 'supabase_realtime'
              AND publication_table.schemaname = 'public'
              AND publication_table.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication publication_row
            WHERE publication_row.pubname = 'supabase_realtime'
              AND publication_row.puballtables
          )
        )
        FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.community_user_mutes')
      )
    ) AS community_user_mutes_replaceable,
    (
      to_regclass('public.community_user_mutes') IS NOT NULL
      AND (
        SELECT count(*) = 1 AND bool_and(
          table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND table_row.relforcerowsecurity
          AND pg_get_userbyid(table_row.relowner) = 'postgres'
          AND coalesce((
            SELECT
              (helper.legacy_exact AND policy.legacy_exact)
              OR (helper.opaque_exact AND policy.opaque_exact)
            FROM trusted_beta_mute_helper_status helper
            CROSS JOIN trusted_beta_mute_policy_status policy
          ), false)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies policy_row
            WHERE policy_row.schemaname = 'public'
              AND policy_row.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(ARRAY['anon', 'authenticated']::text[])
              client(role_name)
            WHERE has_table_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
            ) OR has_any_column_privilege(
              client.role_name, table_row.oid,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'SELECT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'INSERT'
          )
          AND has_table_privilege(
            'service_role', table_row.oid, 'DELETE'
          )
          AND NOT has_table_privilege(
            'service_role', table_row.oid,
            'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
          AND NOT has_any_column_privilege(
            'service_role', table_row.oid, 'UPDATE,REFERENCES'
          )
          AND 3 = (
            SELECT count(*) FROM pg_catalog.pg_attribute attribute_row
            WHERE attribute_row.attrelid = table_row.oid
              AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('muter_id', 'uuid', true, NULL::text),
              ('muted_user_id', 'uuid', true, NULL::text),
              ('created_at', 'timestamp with time zone', true, 'now()')
            ) expected(column_name, data_type, not_null, expected_default)
            LEFT JOIN pg_catalog.pg_attribute attribute_row
              ON attribute_row.attrelid = table_row.oid
             AND attribute_row.attname = expected.column_name
             AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef default_row
              ON default_row.adrelid = attribute_row.attrelid
             AND default_row.adnum = attribute_row.attnum
            WHERE attribute_row.attname IS NULL
               OR format_type(attribute_row.atttypid, attribute_row.atttypmod)
                  IS DISTINCT FROM expected.data_type
               OR attribute_row.attnotnull IS DISTINCT FROM expected.not_null
               OR pg_get_expr(default_row.adbin, default_row.adrelid)
                  IS DISTINCT FROM expected.expected_default
          )
          AND 4 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_pkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'PRIMARY KEY (muter_id, muted_user_id)'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname = 'community_user_mutes_no_self'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK (muter_id <> muted_user_id)'
          )
          AND 2 = (
            SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'f'
              AND constraint_row.confrelid = 'auth.users'::regclass
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.convalidated
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muter_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muter_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.conname =
                'community_user_mutes_muted_user_id_fkey'
              AND constraint_row.convalidated
              AND pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY (muted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class index_class
            JOIN pg_catalog.pg_index index_row
              ON index_row.indexrelid = index_class.oid
            WHERE index_class.relnamespace = 'public'::regnamespace
              AND index_class.relname = 'idx_community_user_mutes_muted_user'
              AND index_row.indrelid = table_row.oid
              AND index_row.indisvalid AND index_row.indisready
              AND regexp_replace(
                pg_get_indexdef(index_class.oid), '[[:space:]]+', ' ', 'g'
              ) = 'CREATE INDEX idx_community_user_mutes_muted_user ON public.community_user_mutes USING btree (muted_user_id, muter_id)'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication_tables publication_table
            WHERE publication_table.pubname = 'supabase_realtime'
              AND publication_table.schemaname = 'public'
              AND publication_table.tablename = 'community_user_mutes'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_publication publication_row
            WHERE publication_row.pubname = 'supabase_realtime'
              AND publication_row.puballtables
          )
        )
        FROM pg_catalog.pg_class table_row
        WHERE table_row.oid = to_regclass('public.community_user_mutes')
      )
    ) AS community_user_mutes_exact,
    (
      to_regclass('public.community_comments') IS NOT NULL
      AND to_regclass('public.community_posts') IS NOT NULL
      AND to_regclass('public.community_profiles') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713117000'
          AND NOT status.replaceable
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713117000'
          AND NOT status.existing_replaceable
      )
    ) AS community_comment_safety_replaceable,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713117000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713117000' AND NOT status.exact
      )
      AND coalesce((
        SELECT exact FROM trusted_beta_function_acl_status
        WHERE signature = 'public.community_soft_delete_comment(uuid,uuid)'
      ), false)
    ) AS community_comment_safety_exact,
    (
      (SELECT exact FROM trusted_beta_actor_boundary_status)
      OR (
        (SELECT legacy_absent FROM trusted_beta_actor_boundary_status)
        AND (
          (
            to_regclass('public.community_user_mutes') IS NULL
            AND (SELECT absent FROM trusted_beta_mute_helper_status)
          )
          OR (
            to_regclass('public.community_user_mutes') IS NOT NULL
            AND (SELECT legacy_exact FROM trusted_beta_mute_helper_status)
            AND (SELECT legacy_exact FROM trusted_beta_mute_policy_status)
          )
        )
      )
    ) AS community_opaque_actor_boundary_replaceable,
    coalesce((
      SELECT exact FROM trusted_beta_actor_boundary_status
    ), false) AS community_opaque_actor_boundary_exact,
    (
      to_regclass('public.community_posts') IS NOT NULL
      AND to_regclass('public.community_comments') IS NOT NULL
      AND to_regclass('public.community_profiles') IS NOT NULL
      AND to_regprocedure(
        'public.community_increment_profile_count(uuid,text)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.community_decrement_profile_count(uuid,text)'
      ) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'post_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'comment_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713119000'
          AND NOT status.replaceable
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713119000'
          AND NOT status.existing_replaceable
      )
    ) AS community_post_lifecycle_replaceable,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713119000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713119000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM client_denied_trigger_function_status status
        WHERE status.creator_version = '20260713119000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM client_denied_trigger_binding_status status
        WHERE status.creator_version = '20260713119000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('public.maintain_community_profile_post_count()'),
          ('public.maintain_community_counts_after_comment_delete()'),
          ('public.community_hard_delete_post(uuid,uuid)'),
          ('public.community_increment_profile_count(uuid,text)'),
          ('public.community_decrement_profile_count(uuid,text)')
        ) required(signature)
        LEFT JOIN trusted_beta_function_acl_status status
          ON status.signature = required.signature
        WHERE NOT coalesce(status.exact, false)
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        LEFT JOIN pg_catalog.pg_attrdef default_row
          ON default_row.adrelid = attribute_row.attrelid
         AND default_row.adnum = attribute_row.attnum
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'post_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND attribute_row.attnotnull
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
          AND pg_get_expr(default_row.adbin, default_row.adrelid) = '0'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute_row
        LEFT JOIN pg_catalog.pg_attrdef default_row
          ON default_row.adrelid = attribute_row.attrelid
         AND default_row.adnum = attribute_row.attnum
        WHERE attribute_row.attrelid =
            'public.community_profiles'::regclass
          AND attribute_row.attname = 'comment_count'
          AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
          AND attribute_row.attnotnull
          AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
            'integer'
          AND pg_get_expr(default_row.adbin, default_row.adrelid) = '0'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_posts post
        WHERE post.comment_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_comments comment_row
          WHERE comment_row.post_id = post.id
            AND NOT coalesce(comment_row.is_deleted, false)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_profiles profile
        WHERE profile.post_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_posts post
          WHERE post.author_id = profile.user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.community_profiles profile
        WHERE profile.comment_count IS DISTINCT FROM (
          SELECT count(*)::integer FROM public.community_comments comment_row
          WHERE comment_row.author_id = profile.user_id
            AND NOT coalesce(comment_row.is_deleted, false)
        )
      )
    ) AS community_post_lifecycle_exact,
    (
      to_regclass('public.community_posts') IS NOT NULL
      AND to_regclass('public.profiles') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713121000'
          AND NOT status.replaceable
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713121000'
          AND NOT status.existing_replaceable
      )
    ) AS community_post_update_replaceable,
    (
      NOT EXISTS (
        SELECT 1 FROM trusted_beta_function_status status
        WHERE status.creator_version = '20260713121000' AND NOT status.exact
      )
      AND NOT EXISTS (
        SELECT 1 FROM dependency_function_status status
        WHERE status.creator_version = '20260713121000' AND NOT status.exact
      )
      AND coalesce((
        SELECT exact FROM trusted_beta_function_acl_status
        WHERE signature = 'public.community_update_post(uuid,uuid,jsonb)'
      ), false)
    ) AS community_post_update_exact
), preview_smoke_required_columns(
  table_name, column_name, expected_type, expected_not_null, expected_default
) AS (
  VALUES
    ('preview_smoke_projects', 'project_ref', 'text', true, NULL::text),
    ('preview_smoke_projects', 'created_at',
      'timestamp with time zone', true, 'clock_timestamp()'),
    ('preview_smoke_projects', 'enabled_until',
      'timestamp with time zone', true, NULL::text),
    ('preview_smoke_projects', 'reason', 'text', true, NULL::text),
    ('preview_smoke_fixture_couples', 'couple_id', 'uuid', true, NULL::text),
    ('preview_smoke_fixture_couples', 'project_ref', 'text', true, NULL::text),
    ('preview_smoke_fixture_couples', 'owner_user_id', 'uuid', true, NULL::text),
    ('preview_smoke_fixture_couples', 'created_at',
      'timestamp with time zone', true, 'clock_timestamp()')
), preview_smoke_column_status AS (
  SELECT count(*) = 8
    AND bool_and(
      attribute_row.attname IS NOT NULL
      AND format_type(attribute_row.atttypid, attribute_row.atttypmod) =
        required.expected_type
      AND attribute_row.attnotnull = required.expected_not_null
      AND pg_get_expr(default_row.adbin, default_row.adrelid)
        IS NOT DISTINCT FROM required.expected_default
    )
    AND 8 = (
      SELECT count(*)
      FROM pg_catalog.pg_attribute actual_attribute
      WHERE actual_attribute.attrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
        AND actual_attribute.attnum > 0
        AND NOT actual_attribute.attisdropped
    ) AS exact
  FROM preview_smoke_required_columns required
  LEFT JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = to_regclass(
      'private.' || required.table_name
    )
   AND attribute_row.attname = required.column_name
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef default_row
    ON default_row.adrelid = attribute_row.attrelid
   AND default_row.adnum = attribute_row.attnum
), preview_smoke_catalog_status AS (
  SELECT
    namespace_row.oid IS NULL
      AND to_regclass('private.preview_smoke_projects') IS NULL
      AND to_regclass('private.preview_smoke_fixture_couples') IS NULL AS absent,
    namespace_row.oid IS NOT NULL
      AND pg_get_userbyid(namespace_row.nspowner) = 'postgres'
      AND NOT has_schema_privilege('anon', namespace_row.oid, 'USAGE,CREATE')
      AND NOT has_schema_privilege(
        'authenticated', namespace_row.oid, 'USAGE,CREATE'
      )
      AND NOT has_schema_privilege(
        'service_role', namespace_row.oid, 'USAGE,CREATE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(namespace_row.nspacl) privilege_row
        LEFT JOIN pg_catalog.pg_roles granted_role
          ON granted_role.oid = privilege_row.grantee
        JOIN pg_catalog.pg_roles grantor_role
          ON grantor_role.oid = privilege_row.grantor
        WHERE privilege_row.grantee = 0
           OR coalesce(granted_role.rolname, '') <> 'postgres'
           OR privilege_row.is_grantable
           OR grantor_role.rolname <> 'postgres'
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_class private_relation
        WHERE private_relation.relnamespace = namespace_row.oid
          AND private_relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_proc private_function
        WHERE private_function.pronamespace = namespace_row.oid
      )
      AND coalesce((SELECT exact FROM preview_smoke_column_status), false)
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('preview_smoke_projects'),
          ('preview_smoke_fixture_couples')
        ) expected(table_name)
        LEFT JOIN pg_catalog.pg_class table_row
          ON table_row.oid = to_regclass('private.' || expected.table_name)
        WHERE table_row.oid IS NULL
           OR table_row.relkind <> 'r'
           OR pg_get_userbyid(table_row.relowner) <> 'postgres'
           OR table_row.relrowsecurity
           OR table_row.relforcerowsecurity
           OR has_table_privilege(
             'anon', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
           )
           OR has_table_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
           )
           OR EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'SELECT', 'INSERT', 'UPDATE', 'DELETE',
               'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
             ]::text[]) forbidden(privilege_name)
             WHERE has_table_privilege(
               'service_role', table_row.oid, forbidden.privilege_name
             )
           )
           OR has_any_column_privilege(
             'anon', table_row.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
           )
           OR has_any_column_privilege(
             'authenticated', table_row.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'
           )
           OR EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
             ]::text[]) forbidden(privilege_name)
             WHERE has_any_column_privilege(
               'service_role', table_row.oid, forbidden.privilege_name
             )
           )
           OR EXISTS (
             SELECT 1 FROM pg_catalog.aclexplode(table_row.relacl) acl_row
             LEFT JOIN pg_catalog.pg_roles acl_grantee
               ON acl_grantee.oid = acl_row.grantee
             JOIN pg_catalog.pg_roles acl_grantor
               ON acl_grantor.oid = acl_row.grantor
             WHERE acl_row.grantee = 0
                OR coalesce(acl_grantee.rolname, '') <> 'postgres'
                OR acl_row.is_grantable
                OR acl_grantor.rolname <> 'postgres'
           )
           OR EXISTS (
             SELECT 1 FROM pg_catalog.pg_attribute acl_attribute
             CROSS JOIN LATERAL pg_catalog.aclexplode(acl_attribute.attacl)
               column_acl
             WHERE acl_attribute.attrelid = table_row.oid
               AND acl_attribute.attnum > 0
               AND NOT acl_attribute.attisdropped
           )
      )
      AND 10 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND constraint_row.convalidated
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND NOT constraint_row.convalidated
      )
      AND 5 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.contype = 'c'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('preview_smoke_projects_project_ref_check', ARRAY[
            'CHECKproject_ref~''^[a-z0-9]{8,64}$'''
          ]::text[]),
          ('preview_smoke_projects_reason_check', ARRAY[
            'CHECKchar_lengthbtrimreason>=8ANDchar_lengthbtrimreason<=200',
            'CHECKchar_lengthbtrimreasonBETWEEN8AND200'
          ]::text[]),
          ('preview_smoke_projects_check', ARRAY[
            'CHECKenabled_until>created_at'
          ]::text[]),
          ('preview_smoke_projects_check1', ARRAY[
            'CHECKenabled_until<=created_at+''24:00:00''',
            'CHECKenabled_until<=created_at+''1day''',
            'CHECKenabled_until<=created_at+''24hours'''
          ]::text[]),
          ('preview_smoke_projects_production_ref_check', ARRAY[
            'CHECKproject_ref<>ALLARRAY[''slrtobkksjmxgzatjyqb'']'
          ]::text[])
        ) expected(constraint_name, allowed_definitions)
        LEFT JOIN pg_catalog.pg_constraint constraint_row
          ON constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
         AND constraint_row.conname = expected.constraint_name
        WHERE constraint_row.oid IS NULL
           OR regexp_replace(
             regexp_replace(
               pg_get_constraintdef(constraint_row.oid, true),
               '[[:space:]()]', '', 'g'
             ),
             '::(text|interval)(\[\])?', '', 'g'
           ) <> ALL (expected.allowed_definitions)
      )
      AND 2 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid IN (
          to_regclass('private.preview_smoke_projects'),
          to_regclass('private.preview_smoke_fixture_couples')
        )
          AND constraint_row.contype = 'p'
      )
      AND 3 = (
        SELECT count(*) FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'f'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.conname =
            'preview_smoke_projects_production_ref_check'
          AND regexp_replace(
            regexp_replace(
              pg_get_constraintdef(constraint_row.oid, true),
              '[[:space:]]+', '', 'g'
            ),
            '::text(\[\])?', '', 'g'
          ) = ANY (ARRAY[
            'CHECK(project_ref<>ALL(ARRAY[''slrtobkksjmxgzatjyqb'']))',
            'CHECK((project_ref<>ALL(ARRAY[''slrtobkksjmxgzatjyqb''])))'
          ]::text[])
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_projects')
          AND constraint_row.contype = 'p'
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'PRIMARY KEY (project_ref)'
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'p'
          AND pg_get_constraintdef(constraint_row.oid, true) =
            'PRIMARY KEY (couple_id)'
      )
      AND 3 = (
        SELECT count(DISTINCT constraint_row.confrelid)
        FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid =
            to_regclass('private.preview_smoke_fixture_couples')
          AND constraint_row.contype = 'f'
          AND constraint_row.convalidated
          AND constraint_row.confrelid IN (
            to_regclass('public.couples'),
            to_regclass('private.preview_smoke_projects'),
            to_regclass('auth.users')
          )
          AND (
            (
              constraint_row.confrelid = to_regclass('public.couples')
              AND constraint_row.confdeltype = 'c'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'couple_id'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid = to_regclass('public.couples')
                  AND attribute_row.attname = 'id'
              )]::smallint[]
            )
            OR (
              constraint_row.confrelid =
                to_regclass('private.preview_smoke_projects')
              AND constraint_row.confdeltype = 'a'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'project_ref'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_projects')
                  AND attribute_row.attname = 'project_ref'
              )]::smallint[]
            )
            OR (
              constraint_row.confrelid = to_regclass('auth.users')
              AND constraint_row.confdeltype = 'a'
              AND constraint_row.conkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid =
                    to_regclass('private.preview_smoke_fixture_couples')
                  AND attribute_row.attname = 'owner_user_id'
              )]::smallint[]
              AND constraint_row.confkey = ARRAY[(
                SELECT attribute_row.attnum
                FROM pg_catalog.pg_attribute attribute_row
                WHERE attribute_row.attrelid = to_regclass('auth.users')
                  AND attribute_row.attname = 'id'
              )]::smallint[]
            )
          )
          AND constraint_row.confupdtype = 'a'
          AND constraint_row.confmatchtype = 's'
      ) AS exact
  FROM (SELECT true AS one_row) seed
  LEFT JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.nspname = 'private'
), preview_smoke_harness_status AS (
  SELECT
    (
      catalog_status.absent OR catalog_status.exact
    )
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(function_status.replaceable)
        FROM trusted_beta_function_status function_status
        WHERE function_status.creator_version = '20260713123000'
      ), false) AS replaceable,
    catalog_status.exact
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(function_status.exact)
        FROM trusted_beta_function_status function_status
        WHERE function_status.creator_version = '20260713123000'
      ), false)
      AND coalesce((
        SELECT count(*) = 6 AND bool_and(acl_status.exact)
        FROM trusted_beta_function_acl_status acl_status
        WHERE acl_status.signature = ANY (ARRAY[
          'private.assert_preview_smoke_authorized(text)',
          'private.assert_preview_smoke_user(uuid)',
          'public.assert_preview_smoke_ready(text)',
          'public.prepare_preview_lifecycle_smoke_fixture(text,text,uuid,uuid)',
          'public.inspect_preview_amora_smoke_turn(text,uuid,uuid,text)',
          'public.cleanup_preview_smoke_fixture(text,uuid[])'
        ]::text[])
      ), false) AS exact
  FROM preview_smoke_catalog_status catalog_status
), service_role_table_acl_expected(table_name, expected_privileges) AS (
  VALUES
    ('amora_turn_counters', ARRAY[]::text[]),
    ('amora_usage_reservations', ARRAY[]::text[]),
    ('rate_limit_buckets', ARRAY['SELECT', 'DELETE']::text[]),
    ('couples', ARRAY['SELECT']::text[]),
    ('account_deletions', ARRAY['UPDATE']::text[]),
    ('customer_survey_responses', ARRAY[]::text[]),
    ('chat_feedback', ARRAY['SELECT', 'DELETE']::text[]),
    ('chat_summaries', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('amora_actions', ARRAY[]::text[]),
    ('wedding_code_responses', ARRAY[]::text[]),
    ('community_upload_reservations', ARRAY[]::text[]),
    ('account_deletion_jobs', ARRAY['SELECT', 'UPDATE']::text[]),
    (
      'amora_request_claims',
      ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
    ),
    ('amora_provider_leases', ARRAY[]::text[])
), service_role_table_acl_status AS (
  SELECT
    count(*) = 14 AND bool_and(
      table_row.oid IS NOT NULL AND table_row.relkind = 'r'
    ) AS replaceable,
    count(*) = 14 AND bool_and(
      table_row.oid IS NOT NULL
      AND table_row.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE',
          'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[]) required(privilege_name)
        WHERE has_table_privilege(
          'service_role', table_row.oid, required.privilege_name
        ) IS DISTINCT FROM (
          required.privilege_name = ANY(expected.expected_privileges)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        WHERE privilege_row.grantee = 0
      )
      AND coalesce((
        SELECT
          count(*) = cardinality(expected.expected_privileges)
          AND coalesce(bool_and(
            privilege_row.privilege_type = ANY(
              expected.expected_privileges
            )
            AND NOT privilege_row.is_grantable
            AND grantor.rolname = 'postgres'
          ), true)
        FROM pg_catalog.aclexplode(table_row.relacl) privilege_row
        JOIN pg_catalog.pg_roles grantor
          ON grantor.oid = privilege_row.grantor
        WHERE privilege_row.grantee = (
          SELECT role_row.oid FROM pg_catalog.pg_roles role_row
          WHERE role_row.rolname = 'service_role'
        )
      ), false)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute attribute_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
          privilege_row
        WHERE attribute_row.attrelid = table_row.oid
          AND attribute_row.attnum > 0
          AND NOT attribute_row.attisdropped
          AND (
            privilege_row.grantee = 0
            OR privilege_row.grantee = (
              SELECT role_row.oid FROM pg_catalog.pg_roles role_row
              WHERE role_row.rolname = 'service_role'
            )
          )
      )
    ) AS exact
  FROM service_role_table_acl_expected expected
  LEFT JOIN pg_catalog.pg_class table_row
    ON table_row.oid = to_regclass('public.' || expected.table_name)
), schema_capabilities AS (
  SELECT
    coalesce((
      SELECT replaceable FROM preview_smoke_harness_status
    ), false) AS preview_smoke_harness_replaceable,
    coalesce((
      SELECT exact FROM preview_smoke_harness_status
    ), false) AS preview_smoke_harness_exact,
    coalesce((
      SELECT replaceable FROM service_role_table_acl_status
    ), false) AS service_role_table_acl_replaceable,
    coalesce((
      SELECT exact FROM service_role_table_acl_status
    ), false) AS service_role_table_acl_exact,
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
      )
      AND NOT has_table_privilege(
        'service_role', 'public.rate_limit_buckets', 'MAINTAIN'
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
    coalesce((
      SELECT replaceable FROM research_consent_version_status
    ), false) AS research_consent_version_replaceable,
    coalesce((
      SELECT exact FROM research_consent_version_status
    ), false) AS research_consent_version_exact,
    coalesce((
      SELECT invalid_rows FROM research_consent_version_status
    ), 0::bigint) AS research_consent_version_invalid_rows,
    coalesce((SELECT exact FROM privacy_minimum_contract), false)
      AS privacy_minimum_contract_exact,
    coalesce((
      SELECT count(*) = 2 AND bool_and(exact)
      FROM dependency_function_status
      WHERE signature IN (
        'public.mutate_journey_schedule_event(uuid,text,jsonb,text,text)',
        'public.mutate_journey_budget_category(uuid,text,jsonb,text[],text)'
      )
    ), false) AS atomic_journey_rpc_contract_exact,
    coalesce((
      SELECT legacy_exact FROM vendor_catalog_lockdown_status
    ), false) AS vendor_catalog_lockdown_legacy_exact,
    coalesce((
      SELECT exact FROM vendor_catalog_lockdown_status
    ), false) AS vendor_catalog_lockdown_exact,
    coalesce((
      SELECT legacy_exact FROM disabled_browser_write_lockdown_status
    ), false) AS disabled_browser_write_lockdown_legacy_exact,
    coalesce((
      SELECT cohort_exact FROM disabled_browser_write_lockdown_status
    ), false) AS cohort_browser_lockdown_exact,
    coalesce((
      SELECT journey_exact FROM disabled_browser_write_lockdown_status
    ), false) AS journey_browser_write_lockdown_exact,
    coalesce((
      SELECT chat_exact FROM disabled_browser_write_lockdown_status
    ), false) AS chat_browser_write_lockdown_exact,
    coalesce((
      SELECT community_exact FROM disabled_browser_write_lockdown_status
    ), false) AS community_browser_write_lockdown_exact,
    coalesce((
      SELECT exact FROM disabled_browser_write_lockdown_status
    ), false) AS disabled_browser_write_lockdown_exact,
    coalesce((
      SELECT raw_tracking_retirement_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS raw_tracking_retirement_replaceable,
    coalesce((
      SELECT raw_tracking_retirement_exact
      FROM trusted_beta_surface_contract
    ), false) AS raw_tracking_retirement_exact,
    coalesce((
      SELECT profiles_direct_select_closure_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS profiles_direct_select_closure_replaceable,
    coalesce((
      SELECT profiles_direct_select_closure_exact
      FROM trusted_beta_surface_contract
    ), false) AS profiles_direct_select_closure_exact,
    coalesce((
      SELECT community_media_retirement_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_media_retirement_replaceable,
    coalesce((
      SELECT community_media_retirement_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_media_retirement_exact,
    coalesce((
      SELECT congratulatory_money_retirement_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS congratulatory_money_retirement_replaceable,
    coalesce((
      SELECT congratulatory_money_retirement_exact
      FROM trusted_beta_surface_contract
    ), false) AS congratulatory_money_retirement_exact,
    coalesce((
      SELECT community_text_only_boundary_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_text_only_boundary_replaceable,
    coalesce((
      SELECT community_text_only_boundary_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_text_only_boundary_exact,
    coalesce((
      SELECT community_user_mutes_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_user_mutes_replaceable,
    coalesce((
      SELECT community_user_mutes_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_user_mutes_exact,
    coalesce((
      SELECT community_comment_safety_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_comment_safety_replaceable,
    coalesce((
      SELECT community_comment_safety_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_comment_safety_exact,
    coalesce((
      SELECT community_opaque_actor_boundary_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_opaque_actor_boundary_replaceable,
    coalesce((
      SELECT community_opaque_actor_boundary_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_opaque_actor_boundary_exact,
    coalesce((
      SELECT community_post_lifecycle_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_post_lifecycle_replaceable,
    coalesce((
      SELECT community_post_lifecycle_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_post_lifecycle_exact,
    coalesce((
      SELECT community_post_update_replaceable
      FROM trusted_beta_surface_contract
    ), false) AS community_post_update_replaceable,
    coalesce((
      SELECT community_post_update_exact
      FROM trusted_beta_surface_contract
    ), false) AS community_post_update_exact,
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
         OR to_jsonb(p)->>'phone_care_consented_at' IS NOT NULL),
    'raw_customer_events_expired', (SELECT count(*) FROM public.customer_events
      WHERE created_at < now() - interval '90 days'),
    'raw_search_logs_expired', (SELECT count(*) FROM public.search_logs
      WHERE created_at < now() - interval '90 days')
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
