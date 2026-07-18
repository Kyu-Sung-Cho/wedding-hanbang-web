-- Consumer price-discovery persistence, publication, and analytics contract.
-- This migration deliberately extends the established vendor model instead of
-- replacing it. In this repository vendors.status='approved' is the canonical
-- equivalent of the final product spec's consumer-visible 'active' state.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The established portal uses pending/approved/rejected. Price ingestion also
-- needs a non-public draft state for unmatched manual uploads.
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_status_check;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'draft')) NOT VALID;
ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_status_check;

CREATE OR REPLACE FUNCTION public.normalize_price_vendor_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $normalize_price_vendor_name$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        COALESCE(p_name, ''),
        '\(구\.[^)]*\)',
        '',
        'g'
      ),
      '[[:space:][:punct:]]+',
      '',
      'g'
    )
  )
$normalize_price_vendor_name$;

CREATE OR REPLACE FUNCTION public.match_vendor_for_price_upload(
  p_name text,
  p_category text
)
RETURNS TABLE (
  vendor_id uuid,
  vendor_name text,
  vendor_slug text,
  aliases text[],
  similarity double precision,
  match_kind text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $match_vendor_for_price_upload$
  WITH input AS (
    SELECT
      public.normalize_price_vendor_name(p_name) AS normalized_name,
      CASE WHEN p_category = 'hall' THEN 'venue' ELSE p_category END
        AS normalized_category
  ), candidates AS (
    SELECT
      vendor.id,
      vendor.name,
      vendor.slug,
      vendor.aliases,
      public.normalize_price_vendor_name(vendor.name) = input.normalized_name
        AS exact_name,
      COALESCE(alias_score.exact_alias, false) AS exact_alias,
      GREATEST(
        similarity(
          public.normalize_price_vendor_name(vendor.name),
          input.normalized_name
        )::double precision,
        COALESCE(alias_score.best_similarity, 0::double precision)
      ) AS score
    FROM input
    JOIN public.vendors AS vendor
      ON vendor.category = input.normalized_category
     AND vendor.status IN ('pending', 'approved', 'draft')
    LEFT JOIN LATERAL (
      SELECT
        bool_or(
          public.normalize_price_vendor_name(alias_value)
            = input.normalized_name
        ) AS exact_alias,
        max(
          similarity(
            public.normalize_price_vendor_name(alias_value),
            input.normalized_name
          )
        )::double precision AS best_similarity
      FROM unnest(vendor.aliases) AS alias_value
    ) AS alias_score ON true
    WHERE input.normalized_name <> ''
  )
  SELECT
    candidate.id,
    candidate.name,
    candidate.slug,
    candidate.aliases,
    CASE
      WHEN candidate.exact_name OR candidate.exact_alias THEN 1::double precision
      ELSE candidate.score
    END,
    CASE
      WHEN candidate.exact_name THEN 'exact_name'
      WHEN candidate.exact_alias THEN 'exact_alias'
      ELSE 'similar'
    END
  FROM candidates AS candidate
  WHERE candidate.exact_name
     OR candidate.exact_alias
     OR candidate.score >= 0.6
  ORDER BY
    CASE
      WHEN candidate.exact_name THEN 0
      WHEN candidate.exact_alias THEN 1
      ELSE 2
    END,
    candidate.score DESC,
    candidate.id
  LIMIT 5
$match_vendor_for_price_upload$;

ALTER FUNCTION public.normalize_price_vendor_name(text) OWNER TO postgres;
ALTER FUNCTION public.match_vendor_for_price_upload(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.normalize_price_vendor_name(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_vendor_for_price_upload(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_vendor_for_price_upload(text, text)
  TO service_role;

-- Public agency identity. Existing reviewed rows receive deterministic private
-- slugs; no real agency names are embedded in source or seed data.
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS homepage_url text,
  ADD COLUMN IF NOT EXISTS disclosure_url text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.agencies
SET display_name = name
WHERE display_name IS NULL;

UPDATE public.agencies
SET slug = 'agency-' || replace(id::text, '-', '')
WHERE slug IS NULL;

ALTER TABLE public.agencies
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agencies_slug_unique_idx
  ON public.agencies (slug);

DO $agency_public_contracts$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.agencies'::regclass
      AND conname = 'agencies_slug_format_check'
  ) THEN
    ALTER TABLE public.agencies
      ADD CONSTRAINT agencies_slug_format_check
      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.agencies'::regclass
      AND conname = 'agencies_public_urls_check'
  ) THEN
    ALTER TABLE public.agencies
      ADD CONSTRAINT agencies_public_urls_check
      CHECK (
        (homepage_url IS NULL OR homepage_url ~ '^https://[^[:space:]]+$')
        AND (
          disclosure_url IS NULL
          OR disclosure_url ~ '^https://[^[:space:]]+$'
        )
      ) NOT VALID;
  END IF;
END
$agency_public_contracts$;

ALTER TABLE public.agencies VALIDATE CONSTRAINT agencies_slug_format_check;
ALTER TABLE public.agencies VALIDATE CONSTRAINT agencies_public_urls_check;

-- A snapshot can remain historically published after a newer snapshot becomes
-- current. This distinction is required for a trustworthy public price history.
ALTER TABLE public.price_snapshots
  ADD COLUMN IF NOT EXISTS source_note text,
  ADD COLUMN IF NOT EXISTS collected_at date,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

UPDATE public.price_snapshots
SET collected_at = COALESCE(published_at, created_at::date, CURRENT_DATE)
WHERE collected_at IS NULL;

UPDATE public.price_snapshots
SET published = true
WHERE is_current IS TRUE
   OR published_at IS NOT NULL;

ALTER TABLE public.price_snapshots
  ALTER COLUMN collected_at SET DEFAULT CURRENT_DATE,
  ALTER COLUMN collected_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS price_snapshots_period_source_unique_idx
  ON public.price_snapshots (period_label, source);

CREATE OR REPLACE FUNCTION public.mark_price_snapshot_published()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $mark_price_snapshot_published$
BEGIN
  IF NEW.is_current IS TRUE
    AND (
      TG_OP = 'INSERT'
      OR OLD.is_current IS DISTINCT FROM TRUE
    )
  THEN
    NEW.published := true;
    NEW.published_at := COALESCE(NEW.published_at, CURRENT_DATE);
  END IF;
  RETURN NEW;
END
$mark_price_snapshot_published$;

ALTER FUNCTION public.mark_price_snapshot_published() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_price_snapshot_published()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS price_snapshot_mark_published
  ON public.price_snapshots;
CREATE TRIGGER price_snapshot_mark_published
BEFORE INSERT OR UPDATE OF is_current
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.mark_price_snapshot_published();

CREATE OR REPLACE FUNCTION public.guard_price_snapshot_publication_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard_price_snapshot_publication_write$
DECLARE
  promotion_owner text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.published IS NOT DISTINCT FROM OLD.published
    AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW.published IS FALSE
    AND NEW.published_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO promotion_owner
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid =
    'public.promote_price_snapshot(uuid,uuid)'::regprocedure;

  IF promotion_owner IS NULL
    OR current_user::text IS DISTINCT FROM promotion_owner
  THEN
    RAISE EXCEPTION 'PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$guard_price_snapshot_publication_write$;

ALTER FUNCTION public.guard_price_snapshot_publication_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_price_snapshot_publication_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS price_snapshot_publication_write_fence
  ON public.price_snapshots;
CREATE TRIGGER price_snapshot_publication_write_fence
BEFORE INSERT OR UPDATE OF published, published_at
ON public.price_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_price_snapshot_publication_write();

-- Preserve option semantics required by the consumer calculator.
ALTER TABLE public.official_price_options
  ADD COLUMN IF NOT EXISTS is_effectively_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_note text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- The existing vendor_favorites relation remains live across older surfaces.
-- A synchronized spec-named table prevents two independent wishlist truths.
CREATE TABLE IF NOT EXISTS public.wishlists (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vendor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_favorites_user_vendor_unique_idx
  ON public.vendor_favorites (user_id, vendor_id);

INSERT INTO public.wishlists (user_id, vendor_id, created_at)
SELECT favorite.user_id, favorite.vendor_id, favorite.created_at
FROM public.vendor_favorites AS favorite
ON CONFLICT (user_id, vendor_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_price_wishlist_with_legacy_favorite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $sync_price_wishlist_with_legacy_favorite$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'wishlists' THEN
      INSERT INTO public.vendor_favorites (user_id, vendor_id, created_at)
      VALUES (NEW.user_id, NEW.vendor_id, NEW.created_at)
      ON CONFLICT (user_id, vendor_id) DO NOTHING;
    ELSE
      INSERT INTO public.wishlists (user_id, vendor_id, created_at)
      VALUES (NEW.user_id, NEW.vendor_id, NEW.created_at)
      ON CONFLICT (user_id, vendor_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'wishlists' THEN
    DELETE FROM public.vendor_favorites
    WHERE user_id = OLD.user_id
      AND vendor_id = OLD.vendor_id;
  ELSE
    DELETE FROM public.wishlists
    WHERE user_id = OLD.user_id
      AND vendor_id = OLD.vendor_id;
  END IF;
  RETURN OLD;
END
$sync_price_wishlist_with_legacy_favorite$;

ALTER FUNCTION public.sync_price_wishlist_with_legacy_favorite()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_price_wishlist_with_legacy_favorite()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS wishlists_sync_legacy_favorite ON public.wishlists;
CREATE TRIGGER wishlists_sync_legacy_favorite
AFTER INSERT OR DELETE ON public.wishlists
FOR EACH ROW
EXECUTE FUNCTION public.sync_price_wishlist_with_legacy_favorite();

DROP TRIGGER IF EXISTS vendor_favorites_sync_price_wishlist
  ON public.vendor_favorites;
CREATE TRIGGER vendor_favorites_sync_price_wishlist
AFTER INSERT OR DELETE ON public.vendor_favorites
FOR EACH ROW
EXECUTE FUNCTION public.sync_price_wishlist_with_legacy_favorite();

CREATE TABLE IF NOT EXISTS public.combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '내 조합',
  selections jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_krw integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT combos_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT combos_selections_object_check
    CHECK (
      jsonb_typeof(selections) = 'object'
      AND (
        selections - ARRAY['studio', 'dress', 'makeup']::text[]
      ) = '{}'::jsonb
    ),
  CONSTRAINT combos_total_nonnegative_check
    CHECK (total_krw IS NULL OR total_krw >= 0)
);

CREATE INDEX IF NOT EXISTS combos_user_created_idx
  ON public.combos (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.price_alerts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vendor_id)
);

DO $owned_price_relations$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['wishlists', 'combos', 'price_alerts']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS price_consumer_owner_all ON public.%I',
      relation_name
    );
    EXECUTE format(
      'CREATE POLICY price_consumer_owner_all ON public.%I '
      || 'FOR ALL TO authenticated '
      || 'USING (auth.uid() = user_id) '
      || 'WITH CHECK (auth.uid() = user_id)',
      relation_name
    );
  END LOOP;
END
$owned_price_relations$;

REVOKE ALL ON TABLE
  public.wishlists,
  public.combos,
  public.price_alerts
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.wishlists,
  public.combos,
  public.price_alerts
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.wishlists,
  public.combos,
  public.price_alerts
TO service_role;

-- Analytics values are determined on the server. The DB repeats the mapping so
-- even a compromised service caller cannot silently forge engagement weight.
CREATE OR REPLACE FUNCTION public.vendor_event_weight(p_event_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $vendor_event_weight$
  SELECT CASE p_event_type
    WHEN 'page_view' THEN 0
    WHEN 'vendor_impression' THEN 0
    WHEN 'vendor_card_click' THEN 1
    WHEN 'vendor_detail_view' THEN 2
    WHEN 'addon_expand' THEN 3
    WHEN 'search' THEN 1
    WHEN 'filter_use' THEN 1
    WHEN 'wishlist_add' THEN 5
    WHEN 'combo_add' THEN 8
    WHEN 'combo_save' THEN 10
    WHEN 'combo_share' THEN 6
    WHEN 'budget_search' THEN 4
    WHEN 'alert_subscribe' THEN 8
    WHEN 'quote_request' THEN 30
    ELSE NULL
  END
$vendor_event_weight$;

CREATE OR REPLACE FUNCTION public.vendor_event_context_is_safe(p_context jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $vendor_event_context_is_safe$
  SELECT
    p_context IS NOT NULL
    AND jsonb_typeof(p_context) = 'object'
    AND COALESCE(
      ARRAY(SELECT jsonb_object_keys(p_context)),
      '{}'::text[]
    ) <@ ARRAY[
      'region', 'category', 'surface', 'wedding_month', 'budget_band',
      'referrer_host', 'zero_result'
    ]::text[]
    AND (
      NOT (p_context ? 'zero_result')
      OR jsonb_typeof(p_context -> 'zero_result') = 'boolean'
    )
    AND (
      NOT (p_context ? 'wedding_month')
      OR (
        jsonb_typeof(p_context -> 'wedding_month') = 'string'
        AND p_context ->> 'wedding_month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      )
    )
    AND (
      NOT (p_context ? 'budget_band')
      OR p_context ->> 'budget_band' = ANY (
        ARRAY['under_200', '200_300', '300_400', 'over_400']::text[]
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_context) AS entry
      WHERE entry.key <> 'zero_result'
        AND jsonb_typeof(entry.value) <> 'string'
    )
$vendor_event_context_is_safe$;

ALTER FUNCTION public.vendor_event_weight(text) OWNER TO postgres;
ALTER FUNCTION public.vendor_event_context_is_safe(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vendor_event_weight(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_event_context_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_event_weight(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_event_context_is_safe(jsonb)
  TO service_role;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 0;

DO $event_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_known_type_weight_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_known_type_weight_check
      CHECK (
        public.vendor_event_weight(event_type) IS NOT NULL
        AND weight = public.vendor_event_weight(event_type)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_safe_context_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_safe_context_check
      CHECK (public.vendor_event_context_is_safe(context)) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_session_length_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_session_length_check
      CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 128)
      NOT VALID;
  END IF;
END
$event_constraints$;

-- The foundation events table is new and service-only. Any legacy-shaped rows
-- are normalized to their server mapping before validation.
UPDATE public.events
SET weight = public.vendor_event_weight(event_type)
WHERE public.vendor_event_weight(event_type) IS NOT NULL
  AND weight IS DISTINCT FROM public.vendor_event_weight(event_type);

-- Unknown historical event names, if any, remain untouched for audit. The
-- NOT VALID constraint still rejects every new unknown or misweighted row.
ALTER TABLE public.events VALIDATE CONSTRAINT events_safe_context_check;
ALTER TABLE public.events VALIDATE CONSTRAINT events_session_length_check;

CREATE INDEX IF NOT EXISTS events_vendor_time_idx
  ON public.events (vendor_id, created_at DESC)
  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_type_time_idx
  ON public.events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_time_idx
  ON public.events (created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $reject_event_mutation$
BEGIN
  RAISE EXCEPTION 'EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '42501';
END
$reject_event_mutation$;

ALTER FUNCTION public.reject_event_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS events_append_only ON public.events;
CREATE TRIGGER events_append_only
BEFORE UPDATE OR DELETE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.reject_event_mutation();

DROP TRIGGER IF EXISTS events_no_truncate ON public.events;
CREATE TRIGGER events_no_truncate
BEFORE TRUNCATE ON public.events
FOR EACH STATEMENT
EXECUTE FUNCTION public.reject_event_mutation();

DROP POLICY IF EXISTS vendor_disclosure_service_all ON public.events;
DROP POLICY IF EXISTS events_service_insert ON public.events;
DROP POLICY IF EXISTS events_service_select ON public.events;
CREATE POLICY events_service_insert ON public.events
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY events_service_select ON public.events
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.events TO service_role;

CREATE TABLE IF NOT EXISTS public.vendor_demand_daily (
  day date NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  impressions integer NOT NULL DEFAULT 0,
  detail_views integer NOT NULL DEFAULT 0,
  wishlist_adds integer NOT NULL DEFAULT 0,
  combo_adds integer NOT NULL DEFAULT 0,
  quote_requests integer NOT NULL DEFAULT 0,
  weighted_score numeric NOT NULL DEFAULT 0,
  qualified_score numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (day, vendor_id),
  CONSTRAINT vendor_demand_daily_nonnegative_check CHECK (
    impressions >= 0
    AND detail_views >= 0
    AND wishlist_adds >= 0
    AND combo_adds >= 0
    AND quote_requests >= 0
    AND weighted_score >= 0
    AND qualified_score >= 0
  )
);

ALTER TABLE public.vendor_demand_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_demand_daily FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_demand_daily_service_all
  ON public.vendor_demand_daily;
CREATE POLICY vendor_demand_daily_service_all
  ON public.vendor_demand_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.vendor_demand_daily
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vendor_demand_daily
  TO service_role;

CREATE OR REPLACE FUNCTION public.aggregate_vendor_demand_daily(
  p_day date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date - 1)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $aggregate_vendor_demand_daily$
DECLARE
  affected_count integer;
BEGIN
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
  FROM public.events AS event_row
  WHERE event_row.vendor_id IS NOT NULL
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

DO $schedule_vendor_demand$
DECLARE
  existing_count integer;
  exact_count integer;
  old_job_id bigint;
  scheduled_job_id bigint;
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
    IF pg_catalog.to_regprocedure(
      'cron.schedule_in_database(text,text,text,text,text,boolean)'
    ) IS NULL THEN
      RAISE EXCEPTION 'PRICE_DEMAND_INACTIVE_CRON_CAPABILITY_REQUIRED'
        USING ERRCODE = '55000';
    END IF;

    -- The production write fence requires zero active database cron jobs while
    -- the release is open. Normalize any pre-existing current-owner copy to an
    -- inactive row before inspecting or replacing it.
    EXECUTE $deactivate_jobs$
      UPDATE cron.job
      SET active = false
      WHERE jobname = 'vendor-demand-daily-kst'
        AND database = current_database()
        AND username = current_user::text
    $deactivate_jobs$;

    EXECUTE $inspect_jobs$
      SELECT
        count(*)::integer,
        count(*) FILTER (
          WHERE schedule = '0 19 * * *'
            AND command = 'SELECT public.aggregate_vendor_demand_daily()'
            AND active IS FALSE
        )::integer
      FROM cron.job
      WHERE jobname = 'vendor-demand-daily-kst'
        AND database = current_database()
        AND username = current_user::text
    $inspect_jobs$
    INTO existing_count, exact_count;

    IF existing_count <> 1 OR exact_count <> 1 THEN
      FOR old_job_id IN EXECUTE $stale_jobs$
        SELECT jobid
        FROM cron.job
        WHERE jobname = 'vendor-demand-daily-kst'
          AND database = current_database()
          AND username = current_user::text
        ORDER BY jobid
      $stale_jobs$
      LOOP
        IF pg_catalog.to_regprocedure('cron.unschedule(bigint)') IS NOT NULL
        THEN
          EXECUTE 'SELECT cron.unschedule($1)'
          USING old_job_id;
        ELSE
          EXECUTE 'DELETE FROM cron.job WHERE jobid = $1'
          USING old_job_id;
        END IF;
      END LOOP;

      -- The six-argument API validates the job while accepting active=false at
      -- creation time. Unlike cron.schedule(), it never creates an active row.
      EXECUTE
        'SELECT cron.schedule_in_database($1, $2, $3, $4, $5, $6)'
      INTO scheduled_job_id
      USING
        'vendor-demand-daily-kst',
        '0 19 * * *',
        'SELECT public.aggregate_vendor_demand_daily()',
        current_database(),
        current_user::text,
        false;

      IF scheduled_job_id IS NULL THEN
        RAISE EXCEPTION 'PRICE_DEMAND_CRON_INACTIVE_INSTALL_FAILED'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    EXECUTE $verify_jobs$
      SELECT
        count(*)::integer,
        count(*) FILTER (
          WHERE schedule = '0 19 * * *'
            AND command = 'SELECT public.aggregate_vendor_demand_daily()'
            AND active IS FALSE
        )::integer
      FROM cron.job
      WHERE jobname = 'vendor-demand-daily-kst'
        AND database = current_database()
        AND username = current_user::text
    $verify_jobs$
    INTO existing_count, exact_count;

    IF existing_count <> 1 OR exact_count <> 1 THEN
      RAISE EXCEPTION 'PRICE_DEMAND_CRON_INACTIVE_POSTCONDITION_FAILED'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$schedule_vendor_demand$;

-- Rebuild every legacy public projection with an explicit publication fence.
CREATE OR REPLACE VIEW public.v_public_official_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  price.id,
  price.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  snapshot.published_at,
  snapshot.is_current,
  price.vendor_id,
  vendor.slug AS vendor_slug,
  vendor.name AS vendor_name,
  vendor.category AS vendor_category,
  vendor.region_code,
  price.agency_id,
  agency.name AS agency_name,
  price.category AS price_category,
  price.item_name,
  price.base_spec,
  price.price_min_krw,
  price.price_max_krw,
  price.vat_note,
  price.price_note,
  price.source_quote,
  price.created_at,
  price.updated_at,
  vendor.aliases AS vendor_aliases,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
  snapshot.source_note,
  snapshot.published AS snapshot_published
FROM public.official_prices AS price
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
LEFT JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND (price.agency_id IS NULL OR agency.merged_into_agency_id IS NULL)
  AND (price.vendor_id IS NULL OR vendor.status = 'approved');

CREATE OR REPLACE VIEW public.v_public_official_price_options
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  option_row.id,
  option_row.official_price_id,
  option_row.name,
  option_row.price_min_krw,
  option_row.price_max_krw,
  option_row.unit,
  option_row.condition,
  option_row.raw_text,
  option_row.source_quote,
  option_row.created_at,
  option_row.is_effectively_mandatory,
  option_row.sort_order
FROM public.official_price_options AS option_row
JOIN public.official_prices AS price
  ON price.id = option_row.official_price_id
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
LEFT JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND cardinality(option_row.source_object_keys) > 0
  AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
  AND NULLIF(btrim(option_row.raw_text), '') IS NOT NULL
  AND option_row.confidence IS NOT NULL
  AND (price.agency_id IS NULL OR agency.merged_into_agency_id IS NULL)
  AND (price.vendor_id IS NULL OR vendor.status = 'approved');

CREATE OR REPLACE VIEW public.v_public_agency_packages
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  package_row.id,
  package_row.snapshot_id,
  snapshot.period_label,
  snapshot.source,
  snapshot.published_at,
  package_row.agency_id,
  agency.name AS agency_name,
  agency.region_code,
  package_row.package_name,
  package_row.category_scope,
  package_row.price_min_krw,
  package_row.price_max_krw,
  package_row.vat_note,
  package_row.price_note,
  package_row.options,
  package_row.source_quote,
  package_row.created_at,
  package_row.updated_at,
  agency.slug AS agency_slug,
  agency.display_name AS agency_display_name,
  snapshot.source_note,
  snapshot.published AS snapshot_published,
  snapshot.is_current
FROM public.official_agency_packages AS package_row
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = package_row.snapshot_id
JOIN public.agencies AS agency
  ON agency.id = package_row.agency_id
WHERE snapshot.published IS TRUE
  AND package_row.review_status = 'approved'
  AND package_row.needs_review = false
  AND cardinality(package_row.source_object_keys) > 0
  AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
  AND package_row.confidence IS NOT NULL
  AND agency.merged_into_agency_id IS NULL;

CREATE OR REPLACE VIEW public.v_public_vendors
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  vendor.id,
  vendor.slug,
  vendor.name,
  CASE WHEN vendor.category = 'venue' THEN 'hall' ELSE vendor.category END
    AS category,
  vendor.region_code,
  vendor.aliases,
  enrichment.official_url,
  enrichment.instagram_url,
  enrichment.naver_place_url,
  enrichment.attributes,
  enrichment.tags
FROM public.vendors AS vendor
JOIN public.v_public_vendor_enrichment AS enrichment
  ON enrichment.id = vendor.id
WHERE vendor.status = 'approved';

CREATE OR REPLACE VIEW public.v_public_prices
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  price.id AS official_price_id,
  vendor.id AS vendor_id,
  vendor.slug AS vendor_slug,
  vendor.name AS vendor_name,
  CASE WHEN vendor.category = 'venue' THEN 'hall' ELSE vendor.category END
    AS category,
  vendor.region_code,
  vendor.aliases,
  agency.id AS agency_id,
  agency.slug AS agency_slug,
  agency.display_name AS agency_name,
  price.item_name,
  price.price_min_krw,
  price.price_max_krw,
  price.price_note,
  price.base_spec,
  price.vat_note,
  price.source_quote,
  snapshot.period_label,
  snapshot.source,
  snapshot.source_note,
  snapshot.published_at,
  snapshot.is_current
FROM public.official_prices AS price
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND vendor.status = 'approved'
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND (agency.id IS NULL OR agency.merged_into_agency_id IS NULL);

CREATE OR REPLACE VIEW public.v_public_price_options
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  option_row.id,
  option_row.official_price_id,
  price.vendor_id,
  price.agency_id,
  option_row.name,
  option_row.price_min_krw,
  option_row.price_max_krw,
  option_row.unit,
  option_row.condition,
  option_row.raw_text,
  option_row.is_effectively_mandatory,
  option_row.sort_order
FROM public.official_price_options AS option_row
JOIN public.official_prices AS price
  ON price.id = option_row.official_price_id
JOIN public.price_snapshots AS snapshot
  ON snapshot.id = price.snapshot_id
JOIN public.vendors AS vendor
  ON vendor.id = price.vendor_id
LEFT JOIN public.agencies AS agency
  ON agency.id = price.agency_id
WHERE snapshot.published IS TRUE
  AND price.review_status = 'approved'
  AND price.needs_review = false
  AND vendor.status = 'approved'
  AND cardinality(price.source_object_keys) > 0
  AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
  AND price.confidence IS NOT NULL
  AND cardinality(option_row.source_object_keys) > 0
  AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
  AND NULLIF(btrim(option_row.raw_text), '') IS NOT NULL
  AND option_row.confidence IS NOT NULL
  AND (agency.id IS NULL OR agency.merged_into_agency_id IS NULL);

CREATE OR REPLACE FUNCTION public.lookup_public_price_vendors(
  p_query text,
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  vendor_id uuid,
  vendor_slug text,
  vendor_name text,
  vendor_category text,
  aliases text[],
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $lookup_public_price_vendors$
  WITH input AS (
    SELECT public.normalize_price_vendor_name(p_query) AS normalized_query
  ), published_vendors AS (
    SELECT DISTINCT
      price.vendor_id,
      price.vendor_slug,
      price.vendor_name,
      price.category,
      price.aliases
    FROM public.v_public_prices AS price
    WHERE price.is_current IS TRUE
      AND (
        p_category IS NULL
        OR p_category = ''
        OR price.category = CASE
          WHEN p_category = 'venue' THEN 'hall'
          ELSE p_category
        END
      )
  ), scored AS (
    SELECT
      vendor.*,
      GREATEST(
        similarity(
          public.normalize_price_vendor_name(vendor.vendor_name),
          input.normalized_query
        )::double precision,
        COALESCE(alias_score.best_similarity, 0::double precision)
      ) AS score
    FROM input
    JOIN published_vendors AS vendor ON input.normalized_query <> ''
    LEFT JOIN LATERAL (
      SELECT max(
        similarity(
          public.normalize_price_vendor_name(alias_value),
          input.normalized_query
        )
      )::double precision AS best_similarity
      FROM unnest(vendor.aliases) AS alias_value
    ) AS alias_score ON true
  )
  SELECT
    scored.vendor_id,
    scored.vendor_slug,
    scored.vendor_name,
    scored.category,
    scored.aliases,
    scored.score
  FROM scored
  WHERE scored.score >= 0.3
  ORDER BY scored.score DESC, scored.vendor_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3)
$lookup_public_price_vendors$;

ALTER FUNCTION public.lookup_public_price_vendors(text, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lookup_public_price_vendors(text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_public_price_vendors(text, text, integer)
  TO service_role;

ALTER VIEW public.v_public_official_prices OWNER TO postgres;
ALTER VIEW public.v_public_official_price_options OWNER TO postgres;
ALTER VIEW public.v_public_agency_packages OWNER TO postgres;
ALTER VIEW public.v_public_vendors OWNER TO postgres;
ALTER VIEW public.v_public_prices OWNER TO postgres;
ALTER VIEW public.v_public_price_options OWNER TO postgres;

REVOKE ALL ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_vendors,
  public.v_public_prices,
  public.v_public_price_options
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.v_public_official_prices,
  public.v_public_official_price_options,
  public.v_public_agency_packages,
  public.v_public_vendors,
  public.v_public_prices,
  public.v_public_price_options
TO anon, authenticated, service_role;

COMMIT;
