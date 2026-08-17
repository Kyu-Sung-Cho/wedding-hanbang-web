SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF pg_catalog.to_regclass('public.couples') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.wedding_journeys') IS NULL
     OR pg_catalog.to_regclass('public.decision_nodes') IS NULL
     OR pg_catalog.to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.can_access_couple_visibility(uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_PRECONDITION_FAILED';
  END IF;
END
$preconditions$;

CREATE TABLE public.amora_preparation_catch_up_receipts (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  source_journey_revision bigint NOT NULL CHECK (source_journey_revision >= 0),
  privacy_epoch bigint NOT NULL CHECK (privacy_epoch >= 1),
  operation_digest text NOT NULL CHECK (operation_digest ~ '^[0-9a-f]{64}$'),
  operation_items jsonb NOT NULL CHECK (
    jsonb_typeof(operation_items) = 'array'
    AND jsonb_array_length(operation_items) BETWEEN 1 AND 3
  ),
  item_count smallint NOT NULL CHECK (item_count BETWEEN 1 AND 3),
  receipt jsonb NOT NULL,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (actor_user_id, request_id),
  UNIQUE (couple_id, actor_user_id)
);

CREATE TABLE public.amora_preparation_catch_up_items (
  receipt_id uuid NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  decision_id uuid NOT NULL UNIQUE REFERENCES public.decision_nodes(id) ON DELETE RESTRICT,
  topic_key text NOT NULL CHECK (topic_key IN (
    'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
    'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
    'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
  )),
  reported_state text NOT NULL CHECK (
    reported_state IN ('completed', 'in_progress', 'unknown', 'not_applicable')
  ),
  scope text NOT NULL CHECK (scope IN ('owner_private', 'couple_shared')),
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (receipt_id, ordinal),
  UNIQUE (receipt_id, topic_key),
  CONSTRAINT amora_preparation_catch_up_items_receipt_fkey
    FOREIGN KEY (receipt_id)
    REFERENCES public.amora_preparation_catch_up_receipts(id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX amora_preparation_catch_up_receipts_couple_actor_idx
  ON public.amora_preparation_catch_up_receipts(couple_id, actor_user_id, confirmed_at DESC);
CREATE INDEX amora_preparation_catch_up_items_couple_topic_idx
  ON public.amora_preparation_catch_up_items(couple_id, topic_key, confirmed_at DESC);

ALTER TABLE public.amora_preparation_catch_up_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_preparation_catch_up_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_preparation_catch_up_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_preparation_catch_up_items
  FROM PUBLIC, anon, authenticated, service_role;

-- Role-private visibility by itself follows the current bride/groom slot. A
-- later occupant of that slot must never inherit an earlier user's catch-up
-- record, so this writer-owned category also binds private reads to auth.uid().
DROP POLICY IF EXISTS decision_nodes_select_with_privacy ON public.decision_nodes;
CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
  FOR SELECT TO authenticated
  USING (
    public.can_access_couple_visibility(couple_id, visibility)
    AND (
      category IS DISTINCT FROM 'preparation_catch_up'
      OR (
        metadata ->> 'hook' = 'amora_preparation_catch_up_v1'
        AND (
          visibility = 'shared'
          OR (
            visibility IN ('bride_private', 'groom_private')
            AND metadata ->> 'actor_profile_id' = auth.uid()::text
          )
        )
      )
    )
  );

CREATE FUNCTION public.finalize_amora_preparation_catch_up_v1(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_privacy_epoch bigint,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_actor_role text;
  v_bride_id uuid;
  v_confirmed_at timestamptz;
  v_confirmed_at_text text;
  v_decision_id uuid;
  v_existing public.amora_preparation_catch_up_receipts%ROWTYPE;
  v_expected_receipt jsonb;
  v_groom_id uuid;
  v_has_external_record boolean := false;
  v_item jsonb;
  v_item_count integer;
  v_label text;
  v_member_count integer;
  v_operation_digest text;
  v_operation_items jsonb;
  v_ordinal integer := 0;
  v_private_visibility text;
  v_privacy_epoch bigint;
  v_receipt jsonb;
  v_receipt_id uuid;
  v_receipt_items jsonb := '[]'::jsonb;
  v_source_journey_revision bigint;
  v_state text;
  v_topic_key text;
  v_scope text;
  v_visibility text;
  v_journey public.wedding_journeys%ROWTYPE;
BEGIN
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_REQUEST_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS raw(value)
    WHERE jsonb_typeof(raw.value) <> 'object'
       OR NOT (raw.value ? 'topicKey' AND raw.value ? 'state' AND raw.value ? 'scope')
       OR (SELECT count(*) FROM jsonb_object_keys(raw.value)) <> 3
       OR jsonb_typeof(raw.value -> 'topicKey') <> 'string'
       OR jsonb_typeof(raw.value -> 'state') <> 'string'
       OR jsonb_typeof(raw.value -> 'scope') <> 'string'
       OR raw.value ->> 'topicKey' NOT IN (
         'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
         'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
         'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
       )
       OR raw.value ->> 'state' NOT IN (
         'completed', 'in_progress', 'unknown', 'not_applicable'
       )
       OR raw.value ->> 'scope' NOT IN ('owner_private', 'couple_shared')
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS raw(value)
    GROUP BY raw.value ->> 'topicKey'
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_ITEMS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'topicKey', raw.value ->> 'topicKey',
      'state', raw.value ->> 'state',
      'scope', raw.value ->> 'scope'
    )
    ORDER BY CASE raw.value ->> 'topicKey'
      WHEN 'meeting' THEN 1 WHEN 'venue' THEN 2 WHEN 'studio' THEN 3
      WHEN 'dress' THEN 4 WHEN 'makeup' THEN 5 WHEN 'ring' THEN 6
      WHEN 'hanbok' THEN 7 WHEN 'yedan' THEN 8 WHEN 'honeymoon' THEN 9
      WHEN 'houseware' THEN 10 WHEN 'housing' THEN 11 WHEN 'invitation' THEN 12
      WHEN 'snap' THEN 13 WHEN 'shoes' THEN 14 WHEN 'bouquet' THEN 15
      WHEN 'gift' THEN 16 WHEN 'mc' THEN 17 WHEN 'ham' THEN 18
      WHEN 'pyebaek' THEN 19 ELSE 99 END
  )
  INTO v_operation_items
  FROM jsonb_array_elements(p_items) AS raw(value);

  v_item_count := jsonb_array_length(v_operation_items);
  v_operation_digest := encode(digest(v_operation_items::text, 'sha256'), 'hex');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:amora-preparation-catch-up:'
        || p_couple_id::text || ':' || p_actor_user_id::text,
      0
    )
  );

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  SELECT profile.role
  INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id
    AND profile.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_actor_role NOT IN ('bride', 'groom')
     OR (v_actor_role = 'bride' AND v_bride_id IS DISTINCT FROM p_actor_user_id)
     OR (v_actor_role = 'groom' AND v_groom_id IS DISTINCT FROM p_actor_user_id)
     OR (v_bride_id = p_actor_user_id AND v_groom_id = p_actor_user_id) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED'
      USING ERRCODE = '40001';
  END IF;
  v_private_visibility := v_actor_role || '_private';
  v_member_count := (v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer;
  IF v_member_count NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  SELECT privacy.epoch
  INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS privacy
  WHERE privacy.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_PRIVACY_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  SELECT receipt.*
  INTO v_existing
  FROM public.amora_preparation_catch_up_receipts AS receipt
  WHERE receipt.actor_user_id = p_actor_user_id
    AND receipt.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.couple_id IS DISTINCT FROM p_couple_id
       OR v_existing.privacy_epoch IS DISTINCT FROM v_privacy_epoch
       OR v_existing.operation_digest IS DISTINCT FROM v_operation_digest
       OR v_existing.operation_items IS DISTINCT FROM v_operation_items
       OR v_existing.item_count IS DISTINCT FROM v_item_count THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_REPLAY_MISMATCH'
        USING ERRCODE = '55000';
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'decisionId', item.decision_id,
        'topicKey', item.topic_key,
        'state', item.reported_state,
        'scope', item.scope,
        'source', 'user_reported'
      ) ORDER BY item.ordinal
    )
    INTO v_receipt_items
    FROM public.amora_preparation_catch_up_items AS item
    WHERE item.receipt_id = v_existing.id
      AND item.couple_id = p_couple_id
      AND item.actor_user_id = p_actor_user_id;

    v_expected_receipt := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'receiptId', v_existing.id,
      'coupleId', p_couple_id,
      'requestId', p_request_id,
      'sourceJourneyRevision', v_existing.source_journey_revision,
      'confirmedAt', to_char(
        v_existing.confirmed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'reused', false,
      'items', COALESCE(v_receipt_items, '[]'::jsonb),
      'boundaries', jsonb_build_object(
        'checklistCompletionChanged', false,
        'vendorConfirmation', 'unconfirmed',
        'paymentEvidence', false
      ),
      'next', jsonb_build_object(
        'kind', 'recalculate_current_state',
        'route', '/schedule'
      )
    );
    IF v_existing.receipt IS DISTINCT FROM v_expected_receipt
       OR jsonb_array_length(COALESCE(v_receipt_items, '[]'::jsonb)) <> v_item_count
       OR EXISTS (
         SELECT 1
         FROM public.amora_preparation_catch_up_items AS item
         JOIN public.decision_nodes AS decision ON decision.id = item.decision_id
         WHERE item.receipt_id = v_existing.id
           AND (
             decision.couple_id IS DISTINCT FROM p_couple_id
             OR decision.category IS DISTINCT FROM 'preparation_catch_up'
             OR decision.decision_type IS DISTINCT FROM CASE item.reported_state
               WHEN 'completed' THEN 'completed'
               WHEN 'in_progress' THEN 'considering'
               WHEN 'unknown' THEN 'exploring'
               ELSE 'decided' END
             OR decision.chosen_value IS DISTINCT FROM jsonb_build_object(
               'topicKey', item.topic_key,
               'reportedState', item.reported_state,
               'scope', item.scope,
               'source', 'user_reported'
             )
             OR decision.source IS DISTINCT FROM 'onboarding'
             OR decision.source_ref_id IS DISTINCT FROM v_existing.id
             OR decision.source_actor_role IS DISTINCT FROM v_actor_role
             OR decision.user_confirmed_at IS DISTINCT FROM v_existing.confirmed_at
             OR decision.metadata IS DISTINCT FROM jsonb_build_object(
               'hook', 'amora_preparation_catch_up_v1',
               'receipt_id', v_existing.id,
               'request_id', p_request_id,
               'topic_key', item.topic_key,
               'reported_state', item.reported_state,
               'scope', item.scope,
               'source', 'user_reported',
               'actor_profile_id', p_actor_user_id,
               'source_journey_revision', v_existing.source_journey_revision,
               'privacy_epoch', v_existing.privacy_epoch,
               'checklist_completion_changed', false,
               'vendor_confirmation_status', 'unconfirmed',
               'payment_evidence', false
             )
             OR decision.visibility IS DISTINCT FROM CASE item.scope
               WHEN 'owner_private' THEN v_private_visibility
               ELSE 'shared' END
             OR decision.superseded_at IS NOT NULL
           )
       ) THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_RECEIPT_INVALID'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_expected_receipt || jsonb_build_object('reused', true);
  END IF;

  IF v_member_count = 2 AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_operation_items) AS item(value)
    WHERE item.value ->> 'scope' = 'couple_shared'
  ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_SHARED_APPROVAL_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT journey.*
  INTO v_journey
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_JOURNEY_MISSING'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_journey.state_revision < 0
     OR v_journey.wedding_date IS NOT NULL
     OR NULLIF(btrim(COALESCE(v_journey.venue, '')), '') IS NOT NULL
     OR COALESCE(v_journey.total_budget, 0) <> 0
     OR jsonb_typeof(COALESCE(v_journey.progress, '{}'::jsonb)) <> 'object'
     OR COALESCE(v_journey.progress, '{}'::jsonb) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS'
      USING ERRCODE = '23514';
  END IF;
  v_source_journey_revision := v_journey.state_revision;

  IF EXISTS (
    SELECT 1
    FROM public.decision_nodes AS decision
    WHERE decision.couple_id = p_couple_id
      AND decision.superseded_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.amora_preparation_catch_up_receipts AS receipt
    WHERE receipt.couple_id = p_couple_id
      AND receipt.actor_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS'
      USING ERRCODE = '23514';
  END IF;

  IF pg_catalog.to_regclass('public.amora_actions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.amora_actions WHERE couple_id = $1)'
      INTO v_has_external_record USING p_couple_id;
    IF v_has_external_record THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.vendor_bookings') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.vendor_bookings WHERE couple_id = $1)'
      INTO v_has_external_record USING p_couple_id;
    IF v_has_external_record THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_receipt_id := gen_random_uuid();
  v_confirmed_at := date_trunc('milliseconds', clock_timestamp());
  v_confirmed_at_text := to_char(
    v_confirmed_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_operation_items)
  LOOP
    v_ordinal := v_ordinal + 1;
    v_topic_key := v_item ->> 'topicKey';
    v_state := v_item ->> 'state';
    v_scope := v_item ->> 'scope';
    v_visibility := CASE
      WHEN v_scope = 'owner_private' THEN v_private_visibility
      ELSE 'shared'
    END;
    v_label := CASE v_topic_key
      WHEN 'meeting' THEN '부모님 첫 만남'
      WHEN 'venue' THEN '결혼식장'
      WHEN 'studio' THEN '웨딩 사진 촬영'
      WHEN 'dress' THEN '드레스·예식 정장'
      WHEN 'makeup' THEN '헤어·메이크업'
      WHEN 'ring' THEN '결혼반지·기념 선물'
      WHEN 'hanbok' THEN '한복'
      WHEN 'yedan' THEN '두 가족에게 드릴 선물'
      WHEN 'honeymoon' THEN '신혼여행'
      WHEN 'houseware' THEN '가전·가구·생활용품'
      WHEN 'housing' THEN '신혼집'
      WHEN 'invitation' THEN '종이·모바일 초대장'
      WHEN 'snap' THEN '결혼식 날 사진·영상'
      WHEN 'shoes' THEN '결혼식 신발'
      WHEN 'bouquet' THEN '손에 드는 꽃·꽃 장식'
      WHEN 'gift' THEN '결혼식에 온 분께 드릴 선물'
      WHEN 'mc' THEN '결혼식 진행·축하 노래'
      WHEN 'ham' THEN '가족에게 전하는 전통 혼례 선물'
      WHEN 'pyebaek' THEN '결혼식 뒤 전통 인사'
      ELSE NULL
    END;
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_TOPIC_INVALID'
        USING ERRCODE = '22023';
    END IF;

    v_decision_id := gen_random_uuid();
    INSERT INTO public.decision_nodes (
      id, couple_id, category, decision_type, title, chosen_value,
      options_considered, reasoning, confidence, stage_tag, decided_at,
      source, source_ref_id, source_message_id, memory_key,
      source_actor_role, user_confirmed_at, metadata, visibility,
      superseded_at, superseded_by, created_at, updated_at
    ) VALUES (
      v_decision_id,
      p_couple_id,
      'preparation_catch_up',
      CASE v_state
        WHEN 'completed' THEN 'completed'
        WHEN 'in_progress' THEN 'considering'
        WHEN 'unknown' THEN 'exploring'
        ELSE 'decided'
      END,
      v_label || ' 준비 상태 기록',
      jsonb_build_object(
        'topicKey', v_topic_key,
        'reportedState', v_state,
        'scope', v_scope,
        'source', 'user_reported'
      ),
      '[]'::jsonb,
      '사용자가 현재 준비 상태로 직접 확인한 기록입니다.',
      1.00,
      NULL,
      v_confirmed_at,
      'onboarding',
      v_receipt_id,
      NULL,
      NULL,
      v_actor_role,
      v_confirmed_at,
      jsonb_build_object(
        'hook', 'amora_preparation_catch_up_v1',
        'receipt_id', v_receipt_id,
        'request_id', p_request_id,
        'topic_key', v_topic_key,
        'reported_state', v_state,
        'scope', v_scope,
        'source', 'user_reported',
        'actor_profile_id', p_actor_user_id,
        'source_journey_revision', v_source_journey_revision,
        'privacy_epoch', v_privacy_epoch,
        'checklist_completion_changed', false,
        'vendor_confirmation_status', 'unconfirmed',
        'payment_evidence', false
      ),
      v_visibility,
      NULL,
      NULL,
      v_confirmed_at,
      v_confirmed_at
    );

    INSERT INTO public.amora_preparation_catch_up_items (
      receipt_id, couple_id, actor_user_id, ordinal, decision_id,
      topic_key, reported_state, scope, confirmed_at, created_at
    ) VALUES (
      v_receipt_id, p_couple_id, p_actor_user_id, v_ordinal, v_decision_id,
      v_topic_key, v_state, v_scope, v_confirmed_at, v_confirmed_at
    );

    v_receipt_items := v_receipt_items || jsonb_build_array(jsonb_build_object(
      'decisionId', v_decision_id,
      'topicKey', v_topic_key,
      'state', v_state,
      'scope', v_scope,
      'source', 'user_reported'
    ));
  END LOOP;

  v_receipt := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'receiptId', v_receipt_id,
    'coupleId', p_couple_id,
    'requestId', p_request_id,
    'sourceJourneyRevision', v_source_journey_revision,
    'confirmedAt', v_confirmed_at_text,
    'reused', false,
    'items', v_receipt_items,
    'boundaries', jsonb_build_object(
      'checklistCompletionChanged', false,
      'vendorConfirmation', 'unconfirmed',
      'paymentEvidence', false
    ),
    'next', jsonb_build_object(
      'kind', 'recalculate_current_state',
      'route', '/schedule'
    )
  );

  INSERT INTO public.amora_preparation_catch_up_receipts (
    id, couple_id, actor_user_id, request_id, source_journey_revision,
    privacy_epoch, operation_digest, operation_items, item_count,
    receipt, confirmed_at, created_at
  ) VALUES (
    v_receipt_id, p_couple_id, p_actor_user_id, p_request_id,
    v_source_journey_revision, v_privacy_epoch, v_operation_digest,
    v_operation_items, v_item_count, v_receipt, v_confirmed_at, v_confirmed_at
  );

  SELECT receipt.receipt
  INTO v_expected_receipt
  FROM public.amora_preparation_catch_up_receipts AS receipt
  WHERE receipt.id = v_receipt_id
    AND receipt.actor_user_id = p_actor_user_id
    AND receipt.operation_digest = v_operation_digest;
  IF NOT FOUND OR v_expected_receipt IS DISTINCT FROM v_receipt THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_CATCH_UP_RECEIPT_INVALID'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_expected_receipt;
END
$function$;

ALTER FUNCTION public.finalize_amora_preparation_catch_up_v1(
  uuid, uuid, uuid, bigint, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_amora_preparation_catch_up_v1(
  uuid, uuid, uuid, bigint, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_amora_preparation_catch_up_v1(
  uuid, uuid, uuid, bigint, jsonb
) TO service_role;

COMMENT ON FUNCTION public.finalize_amora_preparation_catch_up_v1(
  uuid, uuid, uuid, bigint, jsonb
) IS 'Atomically stores up to three explicitly confirmed, user-reported preparation states without changing checklist completion or asserting vendor/payment proof.';
