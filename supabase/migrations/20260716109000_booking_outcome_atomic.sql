BEGIN;

-- Atomic, idempotent booking outcome completion.
--
-- The previous HTTP flow updated the booking, review, and decision node in
-- three independent transactions. A process crash could therefore publish an
-- actual amount without its review/decision (or create duplicate reviews on a
-- retry). This migration establishes one service-only transaction boundary and
-- durable uniqueness for the two booking-owned child records.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Preserve duplicate review content, but detach and hide older duplicate rows
-- before enforcing the one-review-per-booking/customer identity. The newest
-- row remains canonical; no review body is deleted by this migration.
WITH ranked_reviews AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY booking_id, customer_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS position
  FROM public.vendor_reviews
  WHERE booking_id IS NOT NULL
    AND customer_id IS NOT NULL
)
UPDATE public.vendor_reviews AS review
SET booking_id = NULL,
    is_visible = false,
    updated_at = now()
FROM ranked_reviews AS ranked
WHERE ranked.id = review.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_reviews_booking_customer_unique
  ON public.vendor_reviews (booking_id, customer_id);

-- Retain older duplicate decision nodes as an auditable superseded history.
-- Clearing source_ref_id removes them from the canonical booking identity
-- without deleting their chosen value or reasoning.
WITH ranked_decisions AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY couple_id, source_ref_id, source, decision_type
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY couple_id, source_ref_id, source, decision_type
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS position
  FROM public.decision_nodes
  WHERE source = 'vendor_booking'
    AND decision_type = 'completed'
    AND source_ref_id IS NOT NULL
)
UPDATE public.decision_nodes AS decision
SET source_ref_id = NULL,
    superseded_at = COALESCE(decision.superseded_at, now()),
    superseded_by = ranked.canonical_id,
    metadata = COALESCE(decision.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'bookingOutcomeDuplicateRetired', true,
        'bookingOutcomeDuplicateRetiredAt', now()
      ),
    updated_at = now()
FROM ranked_decisions AS ranked
WHERE ranked.id = decision.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS decision_nodes_booking_outcome_unique
  ON public.decision_nodes (couple_id, source_ref_id, source, decision_type)
  WHERE source = 'vendor_booking'
    AND decision_type = 'completed'
    AND source_ref_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_vendor_booking_outcome(
  p_booking_id uuid,
  p_customer_id uuid,
  p_actual_amount numeric,
  p_contracted_amount numeric,
  p_rating integer,
  p_review text,
  p_share_public_review boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_couple_id uuid;
  v_booking public.vendor_bookings%ROWTYPE;
  v_review public.vendor_reviews%ROWTYPE;
  v_vendor_name text;
  v_vendor_category text;
  v_product_name text;
  v_decision_id uuid;
  v_baseline_amount numeric := 0;
  v_extra_amount numeric := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL
     OR p_customer_id IS NULL
     OR p_actual_amount IS NULL
     OR p_actual_amount < 0
     OR p_actual_amount > 1000000000
     OR trunc(p_actual_amount) <> p_actual_amount
     OR (
       p_contracted_amount IS NOT NULL
       AND (
         p_contracted_amount < 0
         OR p_contracted_amount > 1000000000
         OR trunc(p_contracted_amount) <> p_contracted_amount
       )
     )
     OR p_rating IS NULL
     OR p_rating NOT BETWEEN 1 AND 5
     OR char_length(COALESCE(p_review, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid_booking_outcome' USING ERRCODE = '22023';
  END IF;

  -- Hold the caller's couple membership stable until the booking outcome
  -- transaction commits. The API uses a service key, so this database check is
  -- the authorization boundary rather than an earlier HTTP snapshot.
  SELECT profile.couple_id
  INTO v_couple_id
  FROM public.profiles AS profile
  WHERE profile.id = p_customer_id
    AND profile.couple_id IS NOT NULL
  FOR SHARE;

  IF NOT FOUND OR v_couple_id IS NULL THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_booking
  FROM public.vendor_bookings
  WHERE id = p_booking_id
    AND couple_id = v_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT vendor.name, vendor.category, product.name
  INTO v_vendor_name, v_vendor_category, v_product_name
  FROM public.vendors AS vendor
  LEFT JOIN public.vendor_products AS product
    ON product.id = v_booking.product_id
   AND product.vendor_id = vendor.id
  WHERE vendor.id = v_booking.vendor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_outcome_context_missing' USING ERRCODE = 'P0002';
  END IF;

  v_baseline_amount := greatest(
    -- NULL means the caller intentionally supplied no contract amount. Falling
    -- back to the immutable quote keeps an exact retry deterministic even
    -- after contracted_amount has been cleared by the first successful call.
    COALESCE(p_contracted_amount, v_booking.amount, 0),
    0
  );
  v_extra_amount := greatest(p_actual_amount - v_baseline_amount, 0);

  -- The booking projection trigger records the desired actual-amount state in
  -- booking_projection_jobs inside this same transaction.
  UPDATE public.vendor_bookings
  SET actual_amount = p_actual_amount,
      contracted_amount = p_contracted_amount,
      status = 'completed',
      updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  INSERT INTO public.vendor_reviews (
    vendor_id,
    product_id,
    booking_id,
    customer_id,
    rating,
    content,
    is_visible
  ) VALUES (
    v_booking.vendor_id,
    v_booking.product_id,
    v_booking.id,
    p_customer_id,
    p_rating,
    NULLIF(btrim(COALESCE(p_review, '')), ''),
    COALESCE(p_share_public_review, false)
  )
  ON CONFLICT (booking_id, customer_id)
  DO UPDATE SET
    vendor_id = EXCLUDED.vendor_id,
    product_id = EXCLUDED.product_id,
    rating = EXCLUDED.rating,
    content = EXCLUDED.content,
    is_visible = EXCLUDED.is_visible,
    updated_at = now()
  RETURNING * INTO v_review;

  INSERT INTO public.decision_nodes (
    couple_id,
    category,
    decision_type,
    title,
    chosen_value,
    reasoning,
    confidence,
    decided_at,
    source,
    source_ref_id,
    metadata,
    visibility,
    superseded_at,
    superseded_by
  ) VALUES (
    v_couple_id,
    COALESCE(NULLIF(btrim(v_vendor_category), ''), 'vendor'),
    'completed',
    '완료: ' || COALESCE(NULLIF(btrim(v_vendor_name), ''), '업체'),
    jsonb_build_object(
      'booking_id', v_booking.id,
      'vendor_id', v_booking.vendor_id,
      'vendor_name', v_vendor_name,
      'product_id', v_booking.product_id,
      'product_name', v_product_name,
      'quoted_amount', v_booking.amount,
      'contracted_amount', p_contracted_amount,
      'actual_amount', p_actual_amount,
      'extra_amount', v_extra_amount,
      'rating', p_rating,
      'public_review', COALESCE(p_share_public_review, false)
    ),
    NULLIF(btrim(COALESCE(p_review, '')), ''),
    0.90,
    now(),
    'vendor_booking',
    v_booking.id,
    jsonb_build_object(
      'hook', 'booking_outcome',
      'review_id', v_review.id,
      'extra_amount', v_extra_amount
    ),
    'shared',
    NULL,
    NULL
  )
  ON CONFLICT (couple_id, source_ref_id, source, decision_type)
    WHERE source = 'vendor_booking'
      AND decision_type = 'completed'
      AND source_ref_id IS NOT NULL
  DO UPDATE SET
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    chosen_value = EXCLUDED.chosen_value,
    reasoning = EXCLUDED.reasoning,
    confidence = EXCLUDED.confidence,
    decided_at = EXCLUDED.decided_at,
    metadata = EXCLUDED.metadata,
    visibility = 'shared',
    superseded_at = NULL,
    superseded_by = NULL,
    updated_at = now()
  RETURNING id INTO v_decision_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'coupleId', v_couple_id,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'status', v_booking.status,
      'amount', v_booking.amount,
      'contractedAmount', v_booking.contracted_amount,
      'actualAmount', v_booking.actual_amount
    ),
    'review', jsonb_build_object(
      'id', v_review.id,
      'rating', v_review.rating,
      'content', v_review.content,
      'isVisible', COALESCE(v_review.is_visible, false)
    ),
    'decisionId', v_decision_id,
    'baselineAmount', v_baseline_amount,
    'extraAmount', v_extra_amount,
    'context', jsonb_build_object(
      'vendorId', v_booking.vendor_id,
      'vendorName', v_vendor_name,
      'vendorCategory', v_vendor_category,
      'productId', v_booking.product_id,
      'productName', v_product_name
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_vendor_booking_outcome(
  uuid, uuid, numeric, numeric, integer, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_vendor_booking_outcome(
  uuid, uuid, numeric, numeric, integer, text, boolean
) TO service_role;

COMMENT ON FUNCTION public.complete_vendor_booking_outcome(
  uuid, uuid, numeric, numeric, integer, text, boolean
) IS
  'Atomically completes an owned booking, upserts its single review and durable decision, and lets the booking trigger enqueue the exact projection state.';

COMMIT;
