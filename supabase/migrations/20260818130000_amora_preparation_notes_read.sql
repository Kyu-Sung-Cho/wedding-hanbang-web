BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.amora_preparation_topic_message_refs') IS NULL
     OR to_regprocedure(
       'public.amora_preparation_topic_message_ref_context_v1(uuid,uuid,bigint,boolean)'
     ) IS NULL
     OR to_regprocedure(
       'public.amora_preparation_topic_message_source_v1(uuid,uuid,uuid,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.amora_preparation_topic_message_excerpt_v1(text)'
     ) IS NULL
     OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_NOTES_READ_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE FUNCTION public.list_amora_preparation_notes_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_query text,
  p_snapshot_at timestamptz,
  p_cursor_saved_at timestamptz,
  p_cursor_ref_id uuid,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_snapshot_at timestamptz;
  v_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_locked_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_source jsonb;
  v_expected_owner_id uuid;
  v_question_excerpt text;
  v_answer_excerpt text;
  v_entries jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_scanned integer := 0;
  v_scan_limit integer;
  v_partial boolean := false;
  v_has_more boolean := false;
  v_last_scanned_saved_at timestamptz;
  v_last_scanned_ref_id uuid;
  v_last_returned_saved_at timestamptz;
  v_last_returned_ref_id uuid;
  v_next_saved_at timestamptz;
  v_next_ref_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_NOTES_READ_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_query IS NULL
     OR char_length(p_query) > 120
     OR (
       p_query <> ''
       AND NOT public.is_amora_preparation_topic_message_safe_content_v1(p_query)
     )
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 24
     OR (p_cursor_saved_at IS NULL) IS DISTINCT FROM (p_cursor_ref_id IS NULL)
     OR (p_cursor_saved_at IS NOT NULL AND p_snapshot_at IS NULL)
     OR (p_cursor_saved_at IS NOT NULL AND p_cursor_saved_at > p_snapshot_at)
     OR (p_snapshot_at IS NOT NULL AND p_snapshot_at > clock_timestamp() + interval '5 seconds') THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_NOTES_READ_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    false
  );
  v_snapshot_at := COALESCE(p_snapshot_at, clock_timestamp());
  v_scan_limit := LEAST(p_limit * 8, 192);

  FOR v_ref IN
    SELECT ref.*
    FROM public.amora_preparation_topic_message_refs AS ref
    WHERE ref.couple_id = p_couple_id
      AND ref.state = 'saved'
      AND ref.saved_at <= v_snapshot_at
      AND (
        p_cursor_saved_at IS NULL
        OR (ref.saved_at, ref.id) < (p_cursor_saved_at, p_cursor_ref_id)
      )
      AND (
        (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
        OR (
          ref.audience = 'owner_private'
          AND ref.owner_user_id = p_recipient_user_id
        )
      )
    ORDER BY ref.saved_at DESC, ref.id DESC
    LIMIT v_scan_limit + 1
  LOOP
    IF v_count >= p_limit THEN
      v_has_more := true;
      EXIT;
    END IF;
    IF v_scanned >= v_scan_limit THEN
      v_has_more := true;
      EXIT;
    END IF;

    v_scanned := v_scanned + 1;
    v_last_scanned_saved_at := v_ref.saved_at;
    v_last_scanned_ref_id := v_ref.id;
    BEGIN
      v_source := public.amora_preparation_topic_message_source_v1(
        p_couple_id,
        p_recipient_user_id,
        v_ref.message_id,
        v_context
      );
    EXCEPTION WHEN no_data_found THEN
      v_partial := true;
      CONTINUE;
    END;

    SELECT * INTO v_locked_ref
    FROM public.amora_preparation_topic_message_refs AS ref
    WHERE ref.id = v_ref.id
      AND ref.couple_id = p_couple_id
      AND ref.state = 'saved'
      AND ref.saved_at <= v_snapshot_at
      AND (
        (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
        OR (
          ref.audience = 'owner_private'
          AND ref.owner_user_id = p_recipient_user_id
        )
      )
    FOR SHARE;
    IF NOT FOUND THEN
      v_partial := true;
      CONTINUE;
    END IF;
    v_ref := v_locked_ref;
    v_expected_owner_id := CASE v_source ->> 'audience'
      WHEN 'owner_private' THEN p_recipient_user_id
      ELSE NULL
    END;
    IF v_ref.audience IS DISTINCT FROM v_source ->> 'audience'
       OR v_ref.owner_user_id IS DISTINCT FROM v_expected_owner_id
       OR v_ref.question_message_id IS DISTINCT FROM
         (v_source ->> 'questionMessageId')::uuid
       OR v_ref.source_digest IS DISTINCT FROM v_source ->> 'sourceDigest' THEN
      v_partial := true;
      CONTINUE;
    END IF;

    v_question_excerpt := public.amora_preparation_topic_message_excerpt_v1(
      v_source ->> 'questionContent'
    );
    v_answer_excerpt := public.amora_preparation_topic_message_excerpt_v1(
      v_source ->> 'sourceContent'
    );
    IF p_query <> ''
       AND position(
         lower(p_query) IN lower(v_question_excerpt || ' ' || v_answer_excerpt)
       ) = 0 THEN
      CONTINUE;
    END IF;

    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'refId', v_ref.id,
      'topicKey', v_ref.topic_key,
      'messageId', v_ref.message_id,
      'audience', v_ref.audience,
      'revision', v_ref.revision,
      'savedAt', v_ref.saved_at,
      'sourceCreatedAt', v_source -> 'sourceCreatedAt',
      'questionExcerpt', v_question_excerpt,
      'answerExcerpt', v_answer_excerpt,
      'canRemove', true,
      'canOpenOriginal', true
    ));
    v_count := v_count + 1;
    v_last_returned_saved_at := v_ref.saved_at;
    v_last_returned_ref_id := v_ref.id;
  END LOOP;

  IF v_has_more THEN
    IF v_count >= p_limit THEN
      v_next_saved_at := v_last_returned_saved_at;
      v_next_ref_id := v_last_returned_ref_id;
    ELSE
      v_next_saved_at := v_last_scanned_saved_at;
      v_next_ref_id := v_last_scanned_ref_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id,
    'snapshotAt', v_snapshot_at,
    'entries', v_entries,
    'nextBoundary', CASE
      WHEN v_next_saved_at IS NULL OR v_next_ref_id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object(
        'savedAt', v_next_saved_at,
        'refId', v_next_ref_id
      )
    END,
    'partial', v_partial
  );
END
$function$;

ALTER FUNCTION public.list_amora_preparation_notes_v1(
  uuid, uuid, bigint, text, timestamptz, timestamptz, uuid, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_amora_preparation_notes_v1(
  uuid, uuid, bigint, text, timestamptz, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_amora_preparation_notes_v1(
  uuid, uuid, bigint, text, timestamptz, timestamptz, uuid, integer
) TO service_role;

COMMIT;
