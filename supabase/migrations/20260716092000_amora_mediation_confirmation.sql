-- Two-sided confirmation for Amora mediation proposals. A proposal becomes a
-- durable shared decision only after every currently linked partner accepts.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.amora_mediation_acceptances (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS amora_mediation_acceptances_couple_idx
  ON public.amora_mediation_acceptances(couple_id, accepted_at DESC);

ALTER TABLE public.amora_mediation_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_mediation_acceptances_select_couple
  ON public.amora_mediation_acceptances;
CREATE POLICY amora_mediation_acceptances_select_couple
  ON public.amora_mediation_acceptances
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

DROP POLICY IF EXISTS amora_mediation_acceptances_service_all
  ON public.amora_mediation_acceptances;
CREATE POLICY amora_mediation_acceptances_service_all
  ON public.amora_mediation_acceptances
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_mediation_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.amora_mediation_acceptances TO authenticated;
GRANT ALL ON TABLE public.amora_mediation_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.accept_amora_mediation(
  p_couple_id uuid,
  p_message_id uuid,
  p_user_id uuid,
  p_title text,
  p_resolution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_required integer;
  v_accepted integer;
  v_decision_id uuid;
BEGIN
  IF char_length(p_title) NOT BETWEEN 1 AND 80
     OR char_length(p_resolution) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-mediation:' || p_message_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
      AND (couple.bride_id = p_user_id OR couple.groom_id = p_user_id)
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    WHERE message.id = p_message_id
      AND message.couple_id = p_couple_id
      AND message.sender_type = 'ai'
      AND message.role = 'assistant'
      AND message.visibility = 'shared'
  ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.amora_mediation_acceptances(couple_id, message_id, user_id)
  VALUES (p_couple_id, p_message_id, p_user_id)
  ON CONFLICT (message_id, user_id) DO NOTHING;

  SELECT count(DISTINCT member_id)::integer INTO v_required
  FROM public.couples AS couple
  CROSS JOIN LATERAL (VALUES (couple.bride_id), (couple.groom_id)) AS members(member_id)
  WHERE couple.id = p_couple_id
    AND member_id IS NOT NULL;

  SELECT count(*)::integer INTO v_accepted
  FROM public.amora_mediation_acceptances AS acceptance
  JOIN public.couples AS couple ON couple.id = acceptance.couple_id
  WHERE acceptance.message_id = p_message_id
    AND acceptance.couple_id = p_couple_id
    AND acceptance.user_id IN (couple.bride_id, couple.groom_id);

  SELECT id INTO v_decision_id
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND category = 'conflict_resolution'
    AND source = 'chat'
    AND source_ref_id = p_message_id
  LIMIT 1;

  IF v_accepted >= v_required AND v_required > 0 AND v_decision_id IS NULL THEN
    INSERT INTO public.decision_nodes(
      couple_id, category, decision_type, title, chosen_value, reasoning,
      confidence, source, source_ref_id, visibility, decided_at, metadata
    ) VALUES (
      p_couple_id, 'conflict_resolution', 'decided', p_title,
      jsonb_build_object('value', p_resolution),
      CASE
        WHEN v_required > 1 THEN '두 파트너가 아모라 중재안에 직접 동의함'
        ELSE '현재 연결된 사용자가 아모라 중재안에 직접 동의함'
      END,
      1.00, 'chat', p_message_id, 'shared', now(),
      jsonb_build_object('confirmed_by_both', v_required > 1, 'acceptance_count', v_accepted)
    )
    RETURNING id INTO v_decision_id;
  END IF;

  RETURN jsonb_build_object(
    'accepted_count', v_accepted,
    'required_count', v_required,
    'completed', v_decision_id IS NOT NULL,
    'decision_node_id', v_decision_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text)
  TO service_role;

COMMENT ON TABLE public.amora_mediation_acceptances IS
  'Per-partner acceptance of an Amora mediation proposal; never implies mutual agreement from one click.';
