BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A handoff is a private, user-operated bridge to an approved vendor's
-- public contact path. It never means that Wedding Hanbang delivered a
-- message, that the vendor received it, or that a booking was confirmed.
CREATE TABLE public.vendor_inquiry_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE
    REFERENCES public.vendor_bookings(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_by_profile_id uuid NOT NULL,
  updated_by_profile_id uuid NOT NULL,
  contact_channel text NOT NULL CHECK (
    contact_channel IN ('website', 'instagram', 'naver_place')
  ),
  contact_target_snapshot text NOT NULL CHECK (
    char_length(contact_target_snapshot) BETWEEN 1 AND 500
  ),
  inquiry_message text NOT NULL CHECK (
    char_length(inquiry_message) BETWEEN 1 AND 2000
  ),
  provider_delivery_status text NOT NULL DEFAULT 'not_integrated' CHECK (
    provider_delivery_status = 'not_integrated'
  ),
  user_reported_sent_at timestamptz,
  user_reported_sent_by_profile_id uuid,
  user_reported_reply_at timestamptz,
  user_reported_reply_by_profile_id uuid,
  user_reported_outcome text CHECK (
    user_reported_outcome IS NULL
    OR user_reported_outcome IN (
      'available', 'unavailable', 'needs_follow_up', 'other'
    )
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_inquiry_handoff_sent_shape CHECK (
    (user_reported_sent_at IS NULL AND user_reported_sent_by_profile_id IS NULL)
    OR (user_reported_sent_at IS NOT NULL AND user_reported_sent_by_profile_id IS NOT NULL)
  ),
  CONSTRAINT vendor_inquiry_handoff_reply_shape CHECK (
    (
      user_reported_reply_at IS NULL
      AND user_reported_reply_by_profile_id IS NULL
      AND user_reported_outcome IS NULL
    )
    OR (
      user_reported_sent_at IS NOT NULL
      AND user_reported_reply_at IS NOT NULL
      AND user_reported_reply_by_profile_id IS NOT NULL
      AND user_reported_outcome IS NOT NULL
    )
  )
);

ALTER TABLE public.vendor_inquiry_handoffs OWNER TO postgres;
ALTER TABLE public.vendor_inquiry_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_inquiry_handoffs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendor_inquiry_handoffs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX vendor_inquiry_handoffs_couple_updated_idx
  ON public.vendor_inquiry_handoffs(couple_id, updated_at DESC);

COMMENT ON TABLE public.vendor_inquiry_handoffs IS
  'Private user-operated vendor inquiry handoffs. All send/reply/outcome states are user-reported; no provider transport exists.';
COMMENT ON COLUMN public.vendor_inquiry_handoffs.provider_delivery_status IS
  'Always not_integrated in this release. It must never be interpreted as provider delivery, receipt, or booking confirmation.';

CREATE FUNCTION public.resolve_vendor_inquiry_handoff_atomic(
  p_booking_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_expected_revision bigint DEFAULT NULL,
  p_contact_channel text DEFAULT NULL,
  p_user_reported_outcome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_booking public.vendor_bookings%ROWTYPE;
  v_vendor public.vendors%ROWTYPE;
  v_product_name text;
  v_handoff public.vendor_inquiry_handoffs%ROWTYPE;
  v_contact_target text;
  v_contact_options jsonb;
  v_official_url text;
  v_instagram_url text;
  v_naver_place_url text;
  v_message text;
  v_status text;
  v_decision_update_count integer := 0;
  v_idempotent boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_booking_id IS NULL
     OR p_actor_profile_id IS NULL
     OR p_action NOT IN ('inspect', 'prepare', 'mark_sent', 'record_reply')
     OR (p_action = 'inspect' AND p_expected_revision IS NOT NULL)
     OR (
       p_action <> 'inspect'
       AND (p_expected_revision IS NULL OR p_expected_revision < 0)
     )
     OR (
       p_action = 'prepare'
       AND p_contact_channel NOT IN ('website', 'instagram', 'naver_place')
     )
     OR (p_action <> 'prepare' AND p_contact_channel IS NOT NULL)
     OR (
       p_action = 'record_reply'
       AND p_user_reported_outcome NOT IN (
         'available', 'unavailable', 'needs_follow_up', 'other'
       )
     )
     OR (p_action <> 'record_reply' AND p_user_reported_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_INVALID_ARGS'
      USING ERRCODE = '22023';
  END IF;

  SELECT booking.* INTO v_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_booking.vendor_delivery_status <> 'not_sent'
     OR public.is_current_couple_member(
       p_actor_profile_id,
       v_booking.couple_id
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT vendor.* INTO v_vendor
  FROM public.vendors AS vendor
  WHERE vendor.id = v_booking.vendor_id
    AND vendor.status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_VENDOR_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  -- Contact paths come only from the disclosure pipeline's public view. Raw
  -- vendors.email/phone fields may belong to an owner account and are not a
  -- consumer-public contact contract.
  SELECT
    public_vendor.official_url,
    public_vendor.instagram_url,
    public_vendor.naver_place_url
    INTO v_official_url, v_instagram_url, v_naver_place_url
  FROM public.v_public_vendors AS public_vendor
  WHERE public_vendor.id = v_booking.vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_VENDOR_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.product_id IS NOT NULL THEN
    SELECT product.name INTO v_product_name
    FROM public.vendor_products AS product
    WHERE product.id = v_booking.product_id
      AND product.vendor_id = v_booking.vendor_id;
  END IF;
  v_product_name := COALESCE(
    NULLIF(btrim(v_booking.intent_product_name_snapshot), ''),
    NULLIF(btrim(v_product_name), '')
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'channel', option.channel,
      'label', option.label,
      'target', option.target
    ) ORDER BY option.position
  ), '[]'::jsonb)
  INTO v_contact_options
  FROM (
    SELECT * FROM (VALUES
      (
        1,
        'website'::text,
        '공식 웹사이트'::text,
        CASE
          WHEN btrim(COALESCE(v_official_url, '')) ~ '^https://[^[:space:]]+$'
            AND char_length(btrim(v_official_url)) <= 500
          THEN btrim(v_official_url)
        END
      ),
      (
        2,
        'instagram'::text,
        '인스타그램'::text,
        CASE
          WHEN btrim(COALESCE(v_instagram_url, '')) ~ '^https://(www[.])?instagram[.]com/[^[:space:]]+$'
            AND char_length(btrim(v_instagram_url)) <= 500
          THEN btrim(v_instagram_url)
        END
      ),
      (
        3,
        'naver_place'::text,
        '네이버 플레이스'::text,
        CASE
          WHEN btrim(COALESCE(v_naver_place_url, '')) ~ '^https://(m[.])?place[.]naver[.]com/[^[:space:]]+$'
            AND char_length(btrim(v_naver_place_url)) <= 500
          THEN btrim(v_naver_place_url)
        END
      )
    ) AS candidate(position, channel, label, target)
    WHERE candidate.target IS NOT NULL
  ) AS option;

  v_message :=
    '안녕하세요. ' ||
    COALESCE(
      NULLIF(btrim(v_booking.intent_vendor_name_snapshot), ''),
      NULLIF(btrim(v_vendor.name), ''),
      '업체'
    ) ||
    ' 상담 가능 여부를 문의드립니다.' ||
    CASE WHEN v_product_name IS NULL
      THEN ''
      ELSE E'\n문의 상품: ' || v_product_name
    END ||
    E'\n희망 일시: ' || v_booking.booking_date::text || ' ' ||
      to_char(v_booking.booking_time, 'HH24:MI') ||
    E'\n최종 금액, 포함·별도 항목, 취소·환불 조건을 서면으로 알려주세요.';

  SELECT handoff.* INTO v_handoff
  FROM public.vendor_inquiry_handoffs AS handoff
  WHERE handoff.booking_id = p_booking_id
  FOR UPDATE;

  IF p_action <> 'inspect' AND v_handoff.id IS NULL
     AND p_expected_revision <> 0 THEN
    RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  IF p_action = 'mark_sent' AND v_handoff.id IS NOT NULL THEN
    IF v_handoff.revision <> p_expected_revision THEN
      IF v_handoff.user_reported_sent_at IS NOT NULL THEN
        v_idempotent := true;
      ELSE
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT'
          USING ERRCODE = '40001';
      END IF;
    ELSIF v_handoff.user_reported_sent_at IS NOT NULL THEN
      v_idempotent := true;
    END IF;
  END IF;

  IF p_action = 'record_reply' AND v_handoff.id IS NOT NULL THEN
    IF v_handoff.revision <> p_expected_revision THEN
      IF v_handoff.user_reported_reply_at IS NOT NULL
         AND v_handoff.user_reported_outcome = p_user_reported_outcome THEN
        v_idempotent := true;
      ELSE
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT'
          USING ERRCODE = '40001';
      END IF;
    ELSIF v_handoff.user_reported_reply_at IS NOT NULL
       AND v_handoff.user_reported_outcome = p_user_reported_outcome THEN
      v_idempotent := true;
    END IF;
  END IF;

  IF p_action = 'prepare' THEN
    IF v_booking.status = 'cancelled' THEN
      RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_BOOKING_CANCELLED'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT option ->> 'target' INTO v_contact_target
    FROM jsonb_array_elements(v_contact_options) AS option
    WHERE option ->> 'channel' = p_contact_channel
    LIMIT 1;
    IF v_contact_target IS NULL THEN
      RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_CONTACT_UNAVAILABLE'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_handoff.id IS NOT NULL
       AND v_handoff.revision <> p_expected_revision THEN
      IF v_handoff.contact_channel = p_contact_channel
         AND v_handoff.contact_target_snapshot = v_contact_target
         AND v_handoff.inquiry_message = v_message THEN
        v_idempotent := true;
      ELSE
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT'
          USING ERRCODE = '40001';
      END IF;
    ELSIF v_handoff.id IS NOT NULL
       AND v_handoff.contact_channel = p_contact_channel
       AND v_handoff.contact_target_snapshot = v_contact_target
       AND v_handoff.inquiry_message = v_message THEN
      v_idempotent := true;
    END IF;

    IF v_handoff.id IS NOT NULL
       AND NOT v_idempotent
       AND v_handoff.user_reported_sent_at IS NOT NULL AND (
      v_handoff.contact_channel IS DISTINCT FROM p_contact_channel
      OR v_handoff.contact_target_snapshot IS DISTINCT FROM v_contact_target
      OR v_handoff.inquiry_message IS DISTINCT FROM v_message
    ) THEN
      RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_LOCKED_AFTER_SENT'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_idempotent THEN
      INSERT INTO public.vendor_inquiry_handoffs (
      booking_id,
      couple_id,
      vendor_id,
      created_by_profile_id,
      updated_by_profile_id,
      contact_channel,
      contact_target_snapshot,
      inquiry_message
    ) VALUES (
      v_booking.id,
      v_booking.couple_id,
      v_booking.vendor_id,
      p_actor_profile_id,
      p_actor_profile_id,
      p_contact_channel,
      v_contact_target,
      v_message
    )
    ON CONFLICT (booking_id) DO UPDATE SET
      contact_channel = EXCLUDED.contact_channel,
      contact_target_snapshot = EXCLUDED.contact_target_snapshot,
      inquiry_message = EXCLUDED.inquiry_message,
      updated_by_profile_id = EXCLUDED.updated_by_profile_id,
      revision = vendor_inquiry_handoffs.revision + CASE
        WHEN vendor_inquiry_handoffs.contact_channel IS DISTINCT FROM EXCLUDED.contact_channel
          OR vendor_inquiry_handoffs.contact_target_snapshot IS DISTINCT FROM EXCLUDED.contact_target_snapshot
          OR vendor_inquiry_handoffs.inquiry_message IS DISTINCT FROM EXCLUDED.inquiry_message
        THEN 1 ELSE 0
      END,
      updated_at = CASE
        WHEN vendor_inquiry_handoffs.contact_channel IS DISTINCT FROM EXCLUDED.contact_channel
          OR vendor_inquiry_handoffs.contact_target_snapshot IS DISTINCT FROM EXCLUDED.contact_target_snapshot
          OR vendor_inquiry_handoffs.inquiry_message IS DISTINCT FROM EXCLUDED.inquiry_message
        THEN now() ELSE vendor_inquiry_handoffs.updated_at
      END
      RETURNING * INTO v_handoff;

      UPDATE public.decision_nodes AS decision
    SET chosen_value = COALESCE(decision.chosen_value, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_status', 'prepared',
            'inquiry_contact_channel', v_handoff.contact_channel,
            'provider_delivery_status', 'not_integrated'
          ),
        metadata = COALESCE(decision.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_evidence', 'user_initiated',
            'provider_delivery_status', 'not_integrated'
          ),
        updated_at = now()
    WHERE decision.couple_id = v_booking.couple_id
      AND decision.source = 'vendor_booking'
      AND decision.source_ref_id = v_booking.id
      AND decision.decision_type = 'considering';
      GET DIAGNOSTICS v_decision_update_count = ROW_COUNT;
      IF v_decision_update_count <> 1 THEN
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_DECISION_AUDIT_MISSING'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF p_action = 'mark_sent' THEN
    IF v_handoff.id IS NULL THEN
      RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_NOT_PREPARED'
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_idempotent AND v_handoff.user_reported_sent_at IS NULL THEN
      UPDATE public.vendor_inquiry_handoffs AS handoff
      SET user_reported_sent_at = now(),
          user_reported_sent_by_profile_id = p_actor_profile_id,
          updated_by_profile_id = p_actor_profile_id,
          revision = handoff.revision + 1,
          updated_at = now()
      WHERE handoff.id = v_handoff.id
      RETURNING handoff.* INTO v_handoff;
    END IF;

    IF NOT v_idempotent THEN
      UPDATE public.decision_nodes AS decision
    SET chosen_value = COALESCE(decision.chosen_value, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_status', 'sent',
            'inquiry_contact_channel', v_handoff.contact_channel,
            'provider_delivery_status', 'not_integrated'
          ),
        metadata = COALESCE(decision.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_evidence', 'user_reported',
            'provider_delivery_status', 'not_integrated'
          ),
        updated_at = now()
    WHERE decision.couple_id = v_booking.couple_id
      AND decision.source = 'vendor_booking'
      AND decision.source_ref_id = v_booking.id
      AND decision.decision_type = 'considering';
      GET DIAGNOSTICS v_decision_update_count = ROW_COUNT;
      IF v_decision_update_count <> 1 THEN
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_DECISION_AUDIT_MISSING'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF p_action = 'record_reply' THEN
    IF v_handoff.id IS NULL OR v_handoff.user_reported_sent_at IS NULL THEN
      RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_SENT_REPORT_REQUIRED'
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_idempotent AND (
      v_handoff.user_reported_reply_at IS NULL
      OR v_handoff.user_reported_outcome IS DISTINCT FROM p_user_reported_outcome
    ) THEN
      UPDATE public.vendor_inquiry_handoffs AS handoff
      SET user_reported_reply_at = COALESCE(
            handoff.user_reported_reply_at,
            now()
          ),
          user_reported_reply_by_profile_id = p_actor_profile_id,
          user_reported_outcome = p_user_reported_outcome,
          updated_by_profile_id = p_actor_profile_id,
          revision = handoff.revision + 1,
          updated_at = now()
      WHERE handoff.id = v_handoff.id
      RETURNING handoff.* INTO v_handoff;
    END IF;

    IF NOT v_idempotent THEN
      UPDATE public.decision_nodes AS decision
    SET chosen_value = COALESCE(decision.chosen_value, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_status', 'replied',
            'inquiry_contact_channel', v_handoff.contact_channel,
            'inquiry_user_reported_outcome', v_handoff.user_reported_outcome,
            'provider_delivery_status', 'not_integrated'
          ),
        metadata = COALESCE(decision.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inquiry_handoff_evidence', 'user_reported',
            'provider_delivery_status', 'not_integrated'
          ),
        updated_at = now()
    WHERE decision.couple_id = v_booking.couple_id
      AND decision.source = 'vendor_booking'
      AND decision.source_ref_id = v_booking.id
      AND decision.decision_type = 'considering';
      GET DIAGNOSTICS v_decision_update_count = ROW_COUNT;
      IF v_decision_update_count <> 1 THEN
        RAISE EXCEPTION 'VENDOR_INQUIRY_HANDOFF_DECISION_AUDIT_MISSING'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF v_handoff.id IS NOT NULL THEN
    v_status := CASE
      WHEN v_handoff.user_reported_reply_at IS NOT NULL THEN 'replied'
      WHEN v_handoff.user_reported_sent_at IS NOT NULL THEN 'sent'
      ELSE 'prepared'
    END;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'bookingId', v_booking.id,
    'bookingStatus', v_booking.status,
    'vendorId', v_booking.vendor_id,
    'vendorName', COALESCE(
      NULLIF(btrim(v_booking.intent_vendor_name_snapshot), ''),
      NULLIF(btrim(v_vendor.name), ''),
      '업체'
    ),
    'productName', v_product_name,
    'bookingDate', v_booking.booking_date,
    'bookingTime', to_char(v_booking.booking_time, 'HH24:MI'),
    'contactOptions', v_contact_options,
    'contactSource', 'verified_public_vendor_view',
    'suggestedInquiryMessage', v_message,
    'providerDeliveryStatus', 'not_integrated',
    'handoff', CASE WHEN v_handoff.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_handoff.id,
      'status', v_status,
      'contactChannel', v_handoff.contact_channel,
      'contactTarget', v_handoff.contact_target_snapshot,
      'inquiryMessage', v_handoff.inquiry_message,
      'providerDeliveryStatus', v_handoff.provider_delivery_status,
      'userReportedSentAt', v_handoff.user_reported_sent_at,
      'userReportedReplyAt', v_handoff.user_reported_reply_at,
      'userReportedOutcome', v_handoff.user_reported_outcome,
      'revision', v_handoff.revision,
      'updatedAt', v_handoff.updated_at
    ) END
  );
END;
$function$;

ALTER FUNCTION public.resolve_vendor_inquiry_handoff_atomic(
  uuid, uuid, text, bigint, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_vendor_inquiry_handoff_atomic(
  uuid, uuid, text, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_vendor_inquiry_handoff_atomic(
  uuid, uuid, text, bigint, text, text
) TO service_role;

COMMENT ON FUNCTION public.resolve_vendor_inquiry_handoff_atomic(
  uuid, uuid, text, bigint, text, text
) IS
  'Inspects or CAS-mutates a private user-operated vendor contact handoff. Lost-response retries reconcile only when the requested outcome is already satisfied; divergent stale writes fail with a revision conflict. It has no provider transport and never claims delivery or confirmation.';

COMMIT;
