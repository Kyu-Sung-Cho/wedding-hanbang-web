-- Client telemetry is never evidence of a user decision, even when the request
-- carries a valid Auth session. Mark every historical row as unverified, admit
-- only low-signal browser events into the client lane, and make the demand
-- aggregate consume server-verified events exclusively.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $event_trust_preflight$
BEGIN
  IF to_regclass('public.events') IS NULL
     OR to_regclass('public.vendor_demand_daily') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.wedding_journeys') IS NULL THEN
    RAISE EXCEPTION 'EVENT_TRUST_PREREQUISITE_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'ingestion_trust'
  ) THEN
    RAISE EXCEPTION 'EVENT_TRUST_COLUMN_ALREADY_EXISTS'
      USING ERRCODE = '55000';
  END IF;
END;
$event_trust_preflight$;

-- Existing rows have no trustworthy provenance and must never be promoted by
-- inference. Drop the temporary backfill default immediately so every future
-- writer must explicitly declare its trust lane.
ALTER TABLE public.events
  ADD COLUMN ingestion_trust text NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE public.events
  ALTER COLUMN ingestion_trust DROP DEFAULT;

ALTER TABLE public.events
  ADD CONSTRAINT events_ingestion_trust_check
  CHECK (ingestion_trust IN (
    'client_untrusted',
    'server_verified',
    'legacy_unverified'
  ));

ALTER TABLE public.events
  ADD CONSTRAINT events_client_untrusted_low_signal_check
  CHECK (
    ingestion_trust <> 'client_untrusted'
    OR (
      event_type IN (
        'page_view',
        'vendor_impression',
        'vendor_card_click',
        'search',
        'filter_use'
      )
      AND weight BETWEEN 0 AND 1
      AND user_id IS NULL
    )
  );

CREATE INDEX events_server_verified_time_idx
  ON public.events (created_at DESC)
  WHERE ingestion_trust = 'server_verified';

-- Append the provenance column so existing view consumers keep their column
-- order while the trusted aggregate can enforce the new boundary.
CREATE OR REPLACE VIEW public.v_events_canonical
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  event_row.id,
  event_row.anon_id,
  event_row.user_id,
  event_row.session_id,
  event_row.vendor_id AS source_vendor_id,
  public.canonical_price_vendor_id(event_row.vendor_id) AS vendor_id,
  event_row.agency_id AS source_agency_id,
  public.canonical_price_agency_id(event_row.agency_id) AS agency_id,
  event_row.surface,
  event_row.event_type,
  event_row.metadata,
  event_row.context,
  event_row.weight,
  event_row.created_at,
  event_row.ingestion_trust
FROM public.events AS event_row;

ALTER VIEW public.v_events_canonical OWNER TO postgres;
REVOKE ALL ON TABLE public.v_events_canonical
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_events_canonical TO service_role;

CREATE OR REPLACE FUNCTION public.aggregate_vendor_demand_daily(
  p_day date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date - 1)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $aggregate_vendor_demand_daily$
DECLARE
  affected_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718, 20300);

  IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'VENDOR_DEMAND_DAY_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vendor_demand_daily (
    day,
    vendor_id,
    impressions,
    detail_views,
    wishlist_adds,
    combo_adds,
    quote_requests,
    weighted_score,
    qualified_score
  )
  SELECT
    p_day,
    event_row.vendor_id,
    count(*) FILTER (WHERE event_row.event_type = 'vendor_impression'),
    count(*) FILTER (WHERE event_row.event_type = 'vendor_detail_view'),
    count(*) FILTER (WHERE event_row.event_type = 'wishlist_add'),
    count(*) FILTER (WHERE event_row.event_type = 'combo_add'),
    count(*) FILTER (WHERE event_row.event_type = 'quote_request'),
    COALESCE(sum(event_row.weight), 0),
    COALESCE(sum(
      CASE WHEN event_row.user_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.wedding_journeys AS journey
          ON journey.couple_id = profile.couple_id
        WHERE profile.id = event_row.user_id
          AND journey.wedding_date IS NOT NULL
      ) THEN event_row.weight ELSE 0 END
    ), 0)
  FROM public.v_events_canonical AS event_row
  WHERE event_row.ingestion_trust = 'server_verified'
    AND event_row.vendor_id IS NOT NULL
    AND event_row.created_at >= (
      p_day::timestamp AT TIME ZONE 'Asia/Seoul'
    )
    AND event_row.created_at < (
      (p_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul'
    )
  GROUP BY event_row.vendor_id
  ON CONFLICT (day, vendor_id) DO UPDATE
  SET impressions = EXCLUDED.impressions,
      detail_views = EXCLUDED.detail_views,
      wishlist_adds = EXCLUDED.wishlist_adds,
      combo_adds = EXCLUDED.combo_adds,
      quote_requests = EXCLUDED.quote_requests,
      weighted_score = EXCLUDED.weighted_score,
      qualified_score = EXCLUDED.qualified_score;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END
$aggregate_vendor_demand_daily$;

ALTER FUNCTION public.aggregate_vendor_demand_daily(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aggregate_vendor_demand_daily(date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_vendor_demand_daily(date)
  TO service_role;

-- Historical demand rows mixed client claims with genuine behavior and cannot
-- be separated retroactively. Preserve their keys, but invalidate every metric
-- before the trusted-only aggregate becomes active.
UPDATE public.vendor_demand_daily
SET impressions = 0,
    detail_views = 0,
    wishlist_adds = 0,
    combo_adds = 0,
    quote_requests = 0,
    weighted_score = 0,
    qualified_score = 0
WHERE impressions <> 0
   OR detail_views <> 0
   OR wishlist_adds <> 0
   OR combo_adds <> 0
   OR quote_requests <> 0
   OR weighted_score <> 0
   OR qualified_score <> 0;

DO $event_trust_postcondition$
DECLARE
  aggregate_source text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'ingestion_trust'
      AND is_nullable = 'NO'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'EVENT_TRUST_COLUMN_CONTRACT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events
    WHERE ingestion_trust <> 'legacy_unverified'
  ) THEN
    RAISE EXCEPTION 'EVENT_TRUST_LEGACY_ROW_PROMOTED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_demand_daily
    WHERE impressions <> 0
       OR detail_views <> 0
       OR wishlist_adds <> 0
       OR combo_adds <> 0
       OR quote_requests <> 0
       OR weighted_score <> 0
       OR qualified_score <> 0
  ) THEN
    RAISE EXCEPTION 'EVENT_TRUST_HISTORICAL_AGGREGATE_STILL_TRUSTED'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.aggregate_vendor_demand_daily(date)'::regprocedure
  ) INTO aggregate_source;
  IF position(
    'event_row.ingestion_trust = ''server_verified''' IN aggregate_source
  ) = 0 THEN
    RAISE EXCEPTION 'EVENT_TRUST_AGGREGATE_FILTER_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$event_trust_postcondition$;

-- A bounded raw-event retention/purge job is intentionally not invented here:
-- the append-only audit trigger and product retention period require a reviewed
-- operational contract. Production release remains blocked until that separate
-- retention contract, schedule, and restore evidence are approved.

COMMIT;
