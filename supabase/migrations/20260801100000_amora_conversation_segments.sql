BEGIN;

-- Additive foundation only. Existing clients may continue to write NULL
-- segment_id until server-issued segment dual-write is enabled.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.chat_messages, public.chat_summaries
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.conversation_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL
    REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text NOT NULL
    CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  owner_user_id uuid,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  started_by uuid NOT NULL,
  start_reason text NOT NULL
    CHECK (start_reason IN (
      'initial', 'user_started', 'migration', 'safe_compaction'
    )),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  previous_segment_id uuid
    REFERENCES public.conversation_segments(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_segments_scope_key
    UNIQUE (id, couple_id, visibility),
  CONSTRAINT conversation_segments_owner_shape_check CHECK (
    (visibility = 'shared' AND owner_user_id IS NULL)
    OR (
      visibility IN ('bride_private', 'groom_private')
      AND owner_user_id IS NOT NULL
    )
  ),
  CONSTRAINT conversation_segments_status_time_check CHECK (
    (status = 'active' AND closed_at IS NULL)
    OR (
      status = 'closed'
      AND closed_at IS NOT NULL
      AND closed_at >= started_at
    )
  ),
  CONSTRAINT conversation_segments_previous_not_self_check CHECK (
    previous_segment_id IS NULL OR previous_segment_id <> id
  ),
  CONSTRAINT conversation_segments_created_time_check CHECK (
    created_at <= started_at
  )
);

CREATE UNIQUE INDEX conversation_segments_one_active_shared
  ON public.conversation_segments (couple_id)
  WHERE status = 'active' AND visibility = 'shared';

CREATE UNIQUE INDEX conversation_segments_one_active_private_scope
  ON public.conversation_segments (couple_id, visibility)
  WHERE status = 'active' AND visibility IN (
    'bride_private', 'groom_private'
  );

CREATE UNIQUE INDEX conversation_segments_one_active_private_owner
  ON public.conversation_segments (owner_user_id)
  WHERE status = 'active' AND visibility IN (
    'bride_private', 'groom_private'
  );

CREATE INDEX conversation_segments_history
  ON public.conversation_segments (
    couple_id, visibility, started_at DESC
  );

CREATE OR REPLACE FUNCTION public.validate_amora_conversation_segment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_previous public.conversation_segments%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
       OR NEW.visibility IS DISTINCT FROM OLD.visibility
       OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.started_by IS DISTINCT FROM OLD.started_by
       OR NEW.start_reason IS DISTINCT FROM OLD.start_reason
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.previous_segment_id IS DISTINCT FROM OLD.previous_segment_id
       OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_IDENTITY_IMMUTABLE';
    END IF;

    IF OLD.status = 'closed'
       AND (
         NEW.status IS DISTINCT FROM OLD.status
         OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
       ) THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_CLOSED_IMMUTABLE';
    END IF;

    RETURN NEW;
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
   WHERE couple.id = NEW.couple_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_COUPLE_NOT_FOUND';
  END IF;

  IF NEW.started_by IS DISTINCT FROM v_bride_id
     AND NEW.started_by IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_STARTER_NOT_MEMBER';
  END IF;

  IF NEW.visibility = 'shared' THEN
    IF NEW.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_SHARED_OWNER_FORBIDDEN';
    END IF;
  ELSIF NEW.visibility = 'bride_private' THEN
    IF v_bride_id IS NULL
       OR NEW.owner_user_id IS DISTINCT FROM v_bride_id THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_OWNER_ROLE_MISMATCH';
    END IF;
  ELSIF NEW.visibility = 'groom_private' THEN
    IF v_groom_id IS NULL
       OR NEW.owner_user_id IS DISTINCT FROM v_groom_id THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_OWNER_ROLE_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'AMORA_SEGMENT_VISIBILITY_INVALID';
  END IF;

  IF NEW.previous_segment_id IS NOT NULL THEN
    SELECT segment.*
      INTO v_previous
      FROM public.conversation_segments AS segment
     WHERE segment.id = NEW.previous_segment_id;

    IF NOT FOUND
       OR v_previous.couple_id IS DISTINCT FROM NEW.couple_id
       OR v_previous.visibility IS DISTINCT FROM NEW.visibility
       OR v_previous.status <> 'closed'
       OR v_previous.started_at > NEW.started_at THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_PREVIOUS_SCOPE_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.validate_amora_conversation_segment()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_amora_conversation_segment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_amora_conversation_segment_row
  BEFORE INSERT OR UPDATE ON public.conversation_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_amora_conversation_segment();

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS segment_id uuid;

ALTER TABLE public.chat_summaries
  ADD COLUMN IF NOT EXISTS segment_id uuid;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_segment_scope_present_check
  CHECK (
    segment_id IS NULL
    OR (couple_id IS NOT NULL AND visibility IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.chat_summaries
  ADD CONSTRAINT chat_summaries_segment_scope_present_check
  CHECK (
    segment_id IS NULL
    OR (couple_id IS NOT NULL AND visibility IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_segment_scope_fk
  FOREIGN KEY (segment_id, couple_id, visibility)
  REFERENCES public.conversation_segments(id, couple_id, visibility)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public.chat_summaries
  ADD CONSTRAINT chat_summaries_segment_scope_fk
  FOREIGN KEY (segment_id, couple_id, visibility)
  REFERENCES public.conversation_segments(id, couple_id, visibility)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public.chat_messages
  VALIDATE CONSTRAINT chat_messages_segment_scope_present_check;

ALTER TABLE public.chat_summaries
  VALIDATE CONSTRAINT chat_summaries_segment_scope_present_check;

CREATE INDEX chat_messages_segment_created_at
  ON public.chat_messages (segment_id, created_at)
  WHERE segment_id IS NOT NULL;

CREATE INDEX chat_summaries_segment_created_at
  ON public.chat_summaries (segment_id, created_at)
  WHERE segment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.start_amora_conversation_segment(
  p_couple_id uuid,
  p_visibility text,
  p_expected_segment_id uuid,
  p_operation_key uuid,
  p_start_reason text DEFAULT 'user_started'
)
RETURNS TABLE (
  segment_id uuid,
  previous_segment_id uuid,
  started_at timestamptz,
  segment_status text,
  current_active_segment_id uuid,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_bride_id uuid;
  v_groom_id uuid;
  v_owner_user_id uuid;
  v_existing public.conversation_segments%ROWTYPE;
  v_active public.conversation_segments%ROWTYPE;
  v_new public.conversation_segments%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_operation_key IS NULL
     OR p_visibility IS NULL
     OR p_start_reason IS NULL
     OR p_visibility NOT IN (
       'shared', 'bride_private', 'groom_private'
     )
     OR p_start_reason NOT IN ('initial', 'user_started') THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_REQUEST_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- The couple row is the serialization boundary for every lane transition.
  -- This is intentionally coarser than one lock per visibility: correctness is
  -- preferred over extra concurrency for a user-triggered, rare operation.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
   WHERE couple.id = p_couple_id
   FOR UPDATE;

  IF NOT FOUND
     OR (
       v_actor_id IS DISTINCT FROM v_bride_id
       AND v_actor_id IS DISTINCT FROM v_groom_id
     )
     OR NOT public.can_access_couple_visibility(
       p_couple_id,
       p_visibility
     ) THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_MEMBERSHIP_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_visibility = 'bride_private' THEN
    IF v_actor_id IS DISTINCT FROM v_bride_id THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_PRIVATE_SCOPE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    v_owner_user_id := v_actor_id;
  ELSIF p_visibility = 'groom_private' THEN
    IF v_actor_id IS DISTINCT FROM v_groom_id THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_PRIVATE_SCOPE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    v_owner_user_id := v_actor_id;
  ELSE
    v_owner_user_id := NULL;
  END IF;

  -- Idempotency is checked before expected-segment freshness. After a first
  -- success, the caller's expected id is necessarily stale; the same operation
  -- must return its durable receipt instead of creating another boundary.
  SELECT segment.*
    INTO v_existing
    FROM public.conversation_segments AS segment
   WHERE segment.operation_key = p_operation_key;

  IF FOUND THEN
    IF v_existing.couple_id IS DISTINCT FROM p_couple_id
       OR v_existing.visibility IS DISTINCT FROM p_visibility
       OR v_existing.owner_user_id IS DISTINCT FROM v_owner_user_id
       OR v_existing.started_by IS DISTINCT FROM v_actor_id
       OR v_existing.start_reason IS DISTINCT FROM p_start_reason THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_OPERATION_SCOPE_MISMATCH'
        USING ERRCODE = '22023';
    END IF;

    segment_id := v_existing.id;
    previous_segment_id := v_existing.previous_segment_id;
    started_at := v_existing.started_at;
    segment_status := v_existing.status;
    SELECT segment.id
      INTO current_active_segment_id
      FROM public.conversation_segments AS segment
     WHERE segment.couple_id = p_couple_id
       AND segment.visibility = p_visibility
       AND segment.status = 'active';
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT segment.*
    INTO v_active
    FROM public.conversation_segments AS segment
   WHERE segment.couple_id = p_couple_id
     AND segment.visibility = p_visibility
     AND segment.status = 'active'
   FOR UPDATE;

  IF FOUND
     AND v_active.owner_user_id IS DISTINCT FROM v_owner_user_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_ACTIVE_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF v_active.id IS DISTINCT FROM p_expected_segment_id THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_STALE_EXPECTED'
      USING ERRCODE = '40001';
  END IF;

  IF p_start_reason = 'initial' AND v_active.id IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_SEGMENT_INITIAL_ALREADY_EXISTS'
      USING ERRCODE = '22023';
  END IF;

  IF v_active.id IS NOT NULL THEN
    UPDATE public.conversation_segments AS segment
       SET status = 'closed',
           closed_at = v_now
     WHERE segment.id = v_active.id
       AND segment.status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_SEGMENT_CONCURRENT_TRANSITION'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.conversation_segments (
    couple_id,
    visibility,
    owner_user_id,
    status,
    started_by,
    start_reason,
    started_at,
    closed_at,
    previous_segment_id,
    operation_key,
    created_at
  ) VALUES (
    p_couple_id,
    p_visibility,
    v_owner_user_id,
    'active',
    v_actor_id,
    p_start_reason,
    v_now,
    NULL,
    v_active.id,
    p_operation_key,
    v_now
  )
  RETURNING * INTO v_new;

  segment_id := v_new.id;
  previous_segment_id := v_new.previous_segment_id;
  started_at := v_new.started_at;
  segment_status := v_new.status;
  current_active_segment_id := v_new.id;
  replayed := false;
  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.start_amora_conversation_segment(
  uuid, text, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_amora_conversation_segment(
  uuid, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_amora_conversation_segment(
  uuid, text, uuid, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.start_amora_conversation_segment(
  uuid, text, uuid, uuid, text
) IS
  'Returns an idempotent operation receipt. segment_status describes that receipt; current_active_segment_id separately identifies the lane active after replay.';

ALTER TABLE public.conversation_segments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversation_segments
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.conversation_segments TO authenticated;
GRANT ALL ON TABLE public.conversation_segments TO service_role;

CREATE POLICY conversation_segments_select_scope
  ON public.conversation_segments
  FOR SELECT TO authenticated
  USING (
    public.can_access_couple_visibility(couple_id, visibility)
    AND (
      visibility = 'shared'
      OR owner_user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.conversation_segments IS
  'Raw Amora context boundary. Canonical decisions remain in decision_nodes and are not owned by a segment.';
COMMENT ON COLUMN public.conversation_segments.owner_user_id IS
  'Immutable private-lane owner snapshot, derived and role-checked at creation; shared segments require NULL.';
COMMENT ON COLUMN public.conversation_segments.operation_key IS
  'Client UUID idempotency receipt key. Reuse with another actor or scope fails closed.';
COMMENT ON COLUMN public.chat_messages.segment_id IS
  'Nullable during mixed-client rollout. When present, scope must match the referenced conversation segment.';
COMMENT ON COLUMN public.chat_summaries.segment_id IS
  'Nullable during mixed-client rollout. Summary scope must match the referenced conversation segment.';

COMMIT;
