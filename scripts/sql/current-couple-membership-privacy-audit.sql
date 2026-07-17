-- READ ONLY. Counts and boolean gates only; emits no UUID, profile field, or content.
-- Run immediately before and after migration 20260716114000. Expected after:
-- stale/reverse/role/duplicate/same-role/direct-policy/unsealed/projected counts = 0;
-- all gates = true. Immediately before 1140, projected shells requiring seal = 33.
WITH slot_rows AS (
  SELECT couple.id AS couple_id, 'bride'::text AS slot_role, couple.bride_id AS user_id
  FROM public.couples AS couple
  WHERE couple.bride_id IS NOT NULL
  UNION ALL
  SELECT couple.id AS couple_id, 'groom'::text AS slot_role, couple.groom_id AS user_id
  FROM public.couples AS couple
  WHERE couple.groom_id IS NOT NULL
),
slot_audit AS (
  SELECT
    slot.couple_id,
    slot.slot_role,
    slot.user_id,
    profile.couple_id AS profile_couple_id,
    profile.role AS profile_role
  FROM slot_rows AS slot
  LEFT JOIN public.profiles AS profile ON profile.id = slot.user_id
),
policy_audit AS (
  SELECT count(*)::integer AS direct_authenticated_slot_policies
  FROM pg_policies AS policy
  WHERE ('authenticated' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
    AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
      ~ '(bride_id|groom_id)'
    AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
      ~ 'auth[.]uid'
),
core_policy_audit AS (
  SELECT count(*)::integer AS unexpected_core_authenticated_policies
  FROM pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'couples', 'profiles', 'wedding_journeys',
      'chat_messages', 'chat_summaries', 'decision_nodes'
    )
    AND ('authenticated' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
    AND NOT (
      (policy.tablename = 'couples'
        AND policy.policyname = 'couples_select_own')
      OR (policy.tablename = 'profiles'
        AND policy.policyname IN (
          'profiles_select_safe_related', 'profiles_insert_own', 'profiles_update_own'
        ))
      OR (policy.tablename = 'wedding_journeys'
        AND policy.policyname IN (
          'journeys_select_couple', 'journeys_insert_couple', 'journeys_update_couple'
        ))
      OR (policy.tablename = 'chat_messages'
        AND policy.policyname IN (
          'chat_select_with_privacy', 'chat_messages_insert_own_user'
        ))
      OR (policy.tablename = 'chat_summaries'
        AND policy.policyname = 'chat_summaries_select_with_privacy')
      OR (policy.tablename = 'decision_nodes'
        AND policy.policyname = 'decision_nodes_select_with_privacy')
    )
)
SELECT
  (SELECT count(*)::integer FROM public.profiles) AS profiles,
  (SELECT count(*)::integer FROM public.couples) AS couples,
  (SELECT count(*)::integer FROM public.couples
    WHERE bride_id IS NULL AND groom_id IS NULL) AS ownerless_couples,
  (SELECT count(*)::integer FROM public.couples
    WHERE bride_id IS NULL
      AND groom_id IS NULL
      AND membership_sealed_at IS NULL) AS ownerless_unsealed_couples,
  (SELECT count(*)::integer
    FROM public.couples AS couple
    WHERE (couple.bride_id IS NOT NULL OR couple.groom_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS bride
        WHERE bride.id = couple.bride_id
          AND bride.couple_id = couple.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS groom
        WHERE groom.id = couple.groom_id
          AND groom.couple_id = couple.id
      )) AS projected_new_ownerless_couples,
  (SELECT count(*)::integer
    FROM public.couples AS couple
    WHERE couple.membership_sealed_at IS NULL
      AND (couple.bride_id IS NOT NULL OR couple.groom_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS bride
        WHERE bride.id = couple.bride_id
          AND bride.couple_id = couple.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS groom
        WHERE groom.id = couple.groom_id
          AND groom.couple_id = couple.id
      )) AS projected_ownerless_shells_requiring_seal,
  (SELECT count(*)::integer FROM slot_audit
    WHERE slot_role = 'bride'
      AND profile_couple_id IS DISTINCT FROM couple_id) AS stale_bride_slots,
  (SELECT count(*)::integer FROM slot_audit
    WHERE slot_role = 'groom'
      AND profile_couple_id IS DISTINCT FROM couple_id) AS stale_groom_slots,
  (SELECT count(*)::integer FROM slot_audit
    WHERE profile_couple_id = couple_id
      AND profile_role IS DISTINCT FROM slot_role) AS canonical_role_mismatches,
  (SELECT count(*)::integer
    FROM public.profiles AS profile
    LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE profile.couple_id IS NOT NULL
      AND NOT (
        (
          profile.role IS NOT DISTINCT FROM 'bride'
          AND couple.bride_id IS NOT DISTINCT FROM profile.id
        )
        OR (
          profile.role IS NOT DISTINCT FROM 'groom'
          AND couple.groom_id IS NOT DISTINCT FROM profile.id
        )
      )) AS profile_links_without_matching_slot,
  (SELECT count(*)::integer
    FROM (
      SELECT user_id FROM slot_rows GROUP BY user_id HAVING count(*) > 1
    ) AS duplicate_member) AS users_in_multiple_slots,
  (SELECT count(*)::integer FROM public.couples
    WHERE bride_id IS NOT NULL AND bride_id = groom_id) AS same_user_both_roles,
  (SELECT direct_authenticated_slot_policies FROM policy_audit)
    AS direct_authenticated_slot_policies,
  (SELECT unexpected_core_authenticated_policies FROM core_policy_audit)
    AS unexpected_core_authenticated_policies,
  (SELECT count(*)::integer FROM public.chat_messages) AS chat_messages,
  (SELECT count(*)::integer FROM public.chat_summaries) AS chat_summaries,
  (SELECT count(*)::integer FROM public.decision_nodes) AS decision_nodes,
  (SELECT count(*)::integer FROM public.wedding_journeys) AS wedding_journeys,
  (SELECT count(*)::integer FROM public.ai_interactions_log) AS ai_interactions_log,
  (SELECT count(*)::integer FROM public.amora_couple_profiles) AS amora_couple_profiles,
  (SELECT count(*)::integer FROM public.amora_memory_settings) AS amora_memory_settings,
  (SELECT count(*)::integer FROM public.amora_memory_consents) AS amora_memory_consents,
  (SELECT count(*)::integer FROM public.amora_memory_jobs) AS amora_memory_jobs,
  (SELECT count(*)::integer FROM public.amora_mediation_acceptances)
    AS amora_mediation_acceptances,
  (
    to_regprocedure('public.is_current_couple_member(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.is_couple_member(uuid)') IS NOT NULL
    AND to_regprocedure('public.can_access_couple_visibility(uuid,text)') IS NOT NULL
    AND to_regprocedure('public.can_read_profile(uuid)') IS NOT NULL
    AND to_regprocedure('public.is_current_couple_path_member(text)') IS NOT NULL
  ) AS helper_functions_ready,
  (
    EXISTS (
      SELECT 1
      FROM pg_index AS index_record
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = index_record.indrelid
       AND attribute.attnum = index_record.indkey[0]
      WHERE index_record.indexrelid = to_regclass('public.couples_bride_id_current_unique_idx')
        AND index_record.indrelid = 'public.couples'::regclass
        AND index_record.indisunique
        AND index_record.indisvalid
        AND index_record.indnkeyatts = 1
        AND attribute.attname = 'bride_id'
        AND pg_get_expr(index_record.indpred, index_record.indrelid)
          = '(bride_id IS NOT NULL)'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_index AS index_record
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = index_record.indrelid
       AND attribute.attnum = index_record.indkey[0]
      WHERE index_record.indexrelid = to_regclass('public.couples_groom_id_current_unique_idx')
        AND index_record.indrelid = 'public.couples'::regclass
        AND index_record.indisunique
        AND index_record.indisvalid
        AND index_record.indnkeyatts = 1
        AND attribute.attname = 'groom_id'
        AND pg_get_expr(index_record.indpred, index_record.indrelid)
          = '(groom_id IS NOT NULL)'
    )
  ) AS unique_indexes_ready,
  (
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.profiles'::regclass
        AND tgname = 'trg_current_couple_profile_integrity'
        AND tgdeferrable AND tginitdeferred AND tgenabled <> 'D'
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.couples'::regclass
        AND tgname = 'trg_current_couple_row_integrity'
        AND tgdeferrable AND tginitdeferred AND tgenabled <> 'D'
    )
  ) AS deferred_integrity_triggers_ready,
  (
    NOT EXISTS (
      SELECT 1 FROM public.couples
      WHERE bride_id IS NULL
        AND groom_id IS NULL
        AND membership_sealed_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.couples'::regclass
        AND tgname = 'trg_enforce_couple_roster_epoch'
        AND tgenabled <> 'D'
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.couples'::regclass
        AND tgname = 'trg_seal_ownerless_couple_membership_epoch'
        AND tgenabled <> 'D'
    )
  ) AS ownerless_shell_reuse_fence_ready;
