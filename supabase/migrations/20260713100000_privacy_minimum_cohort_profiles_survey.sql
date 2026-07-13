BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Privacy minimums for shared community data. Raw cohort quotes remain
-- owner-only, price aggregates require five different people, public profile
-- reads expose only a pseudonymous author card, and the legacy survey cannot
-- retain contact or browser identifiers even from a stale service client.

LOCK TABLE public.cohort_contracts IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.community_profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.community_achievements IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.community_vendor_tags IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.customer_survey_responses IN ACCESS EXCLUSIVE MODE;

-- Table-level REVOKE does not remove a stale column-level grant. Clear every
-- existing column ACL on each relation whose privacy boundary is rebuilt below
-- before granting back the reviewed minimum. Discovering the columns from the
-- catalog also covers columns added by an already-applied compatible migration.
DO $$
DECLARE
  target_schema text;
  target_name text;
  target_columns text;
BEGIN
  FOR target_schema, target_name IN
    SELECT relation.schema_name, relation.relation_name
    FROM (VALUES
      ('public', 'cohort_contracts'),
      ('public', 'cohort_stats'),
      ('public', 'community_profiles'),
      ('public', 'community_achievements'),
      ('public', 'community_vendor_tags')
    ) AS relation(schema_name, relation_name)
  LOOP
    SELECT string_agg(
      pg_catalog.quote_ident(attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO target_columns
    FROM pg_catalog.pg_attribute attribute_row
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', target_schema, target_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF target_columns IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role',
        target_columns,
        target_schema,
        target_name
      );
    END IF;
  END LOOP;
END;
$$;

-- Bound new quote inputs without rewriting unexplained historical data. The
-- aggregate below independently excludes historical rows outside this range.
ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_base_price_range;
ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_base_price_range
  CHECK (
    base_price IS NULL
    OR (base_price >= 1 AND base_price <= 1000000)
  )
  NOT VALID;

ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_extra_price_range;
ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_extra_price_range
  CHECK (
    extra_price IS NULL
    OR (extra_price >= 0 AND extra_price <= 1000000)
  )
  NOT VALID;

ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_vendor_name_length;
ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_vendor_name_length
  CHECK (
    vendor_name = btrim(vendor_name)
    AND char_length(vendor_name) >= 1
    AND char_length(vendor_name) <= 200
  )
  NOT VALID;

ALTER TABLE public.cohort_contracts
  DROP CONSTRAINT IF EXISTS cohort_contracts_notes_length;
ALTER TABLE public.cohort_contracts
  ADD CONSTRAINT cohort_contracts_notes_length
  CHECK (notes IS NULL OR char_length(notes) <= 1000)
  NOT VALID;

-- Validation is a release gate, not a deferred cleanup promise. Any unexplained
-- legacy quote outside the reviewed bounds aborts this transaction before ACL
-- or anonymity changes can be partially published.
ALTER TABLE public.cohort_contracts
  VALIDATE CONSTRAINT cohort_contracts_base_price_range;
ALTER TABLE public.cohort_contracts
  VALIDATE CONSTRAINT cohort_contracts_extra_price_range;
ALTER TABLE public.cohort_contracts
  VALIDATE CONSTRAINT cohort_contracts_vendor_name_length;
ALTER TABLE public.cohort_contracts
  VALIDATE CONSTRAINT cohort_contracts_notes_length;

-- A direct PostgREST caller may see only their own quote rows. A write must
-- also remain attached to that caller and to an active membership in the room.
DROP POLICY IF EXISTS "cohort_contracts_select" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_select_own" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_insert" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_update" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_delete" ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_insert_active_member
  ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_update_active_member
  ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_delete_active_member
  ON public.cohort_contracts;
DROP POLICY IF EXISTS cohort_contracts_delete_own ON public.cohort_contracts;

CREATE POLICY cohort_contracts_select_own
  ON public.cohort_contracts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY cohort_contracts_insert_active_member
  ON public.cohort_contracts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );

CREATE POLICY cohort_contracts_update_active_member
  ON public.cohort_contracts
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_cohort_member(room_id)
  );

CREATE POLICY cohort_contracts_delete_own
  ON public.cohort_contracts
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.cohort_contracts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_contracts
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_cohort_contract_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := pg_catalog.statement_timestamp();
    ELSIF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.room_id IS DISTINCT FROM OLD.room_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'cohort_contract_identity_is_immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_cohort_contract_server_fields() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_cohort_contract_server_fields()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS cohort_contracts_enforce_server_fields
  ON public.cohort_contracts;
CREATE TRIGGER cohort_contracts_enforce_server_fields
  BEFORE INSERT OR UPDATE
  ON public.cohort_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cohort_contract_server_fields();

-- One prolific member must never satisfy the anonymity threshold. Keep only
-- that member's newest valid value in each room/category before aggregation.
-- sample_size is also hidden below five so callers cannot infer an exact small
-- cohort from an otherwise empty aggregate cell.
CREATE OR REPLACE VIEW public.cohort_stats
WITH (security_invoker = on) AS
WITH latest_per_member AS (
  SELECT DISTINCT ON (
    contract.room_id,
    contract.category,
    contract.user_id
  )
    contract.room_id,
    contract.category,
    contract.user_id,
    contract.base_price,
    contract.extra_price
  FROM public.cohort_contracts AS contract
  WHERE contract.base_price BETWEEN 1 AND 1000000
    AND (
      contract.extra_price IS NULL
      OR contract.extra_price BETWEEN 0 AND 1000000
    )
  ORDER BY
    contract.room_id,
    contract.category,
    contract.user_id,
    contract.created_at DESC NULLS LAST,
    contract.id DESC
)
SELECT
  latest.room_id,
  latest.category,
  CASE WHEN count(*) >= 5 THEN count(*) END AS sample_size,
  CASE
    WHEN count(*) >= 5 THEN round(avg(latest.base_price))::integer
  END AS avg_base_price,
  CASE
    WHEN count(latest.extra_price) >= 5
      AND count(latest.extra_price) = count(*)
      THEN round(avg(latest.extra_price))::integer
  END AS avg_extra_price,
  CASE
    WHEN count(latest.extra_price) >= 5
      AND count(latest.extra_price) = count(*)
      THEN round(
        avg(latest.base_price + latest.extra_price)
          FILTER (WHERE latest.extra_price IS NOT NULL)
      )::integer
  END AS avg_total
FROM latest_per_member AS latest
GROUP BY latest.room_id, latest.category;

REVOKE ALL ON TABLE public.cohort_stats
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cohort_stats TO service_role;

CREATE OR REPLACE VIEW public.cohort_room_contributor_stats
WITH (security_invoker = on) AS
WITH distinct_contributors AS (
  SELECT DISTINCT contract.room_id, contract.user_id
  FROM public.cohort_contracts AS contract
  WHERE contract.base_price BETWEEN 1 AND 1000000
    AND (
      contract.extra_price IS NULL
      OR contract.extra_price BETWEEN 0 AND 1000000
    )
)
SELECT
  contributor.room_id,
  CASE WHEN count(*) >= 5 THEN count(*) END AS contributor_count,
  count(*) >= 5 AS threshold_met
FROM distinct_contributors AS contributor
GROUP BY contributor.room_id;

-- The contributor view is new in this migration, so clear column ACLs after it
-- exists as well. This keeps reruns safe if the relation was created manually.
DO $$
DECLARE
  target_columns text;
BEGIN
  SELECT string_agg(
    pg_catalog.quote_ident(attribute_row.attname),
    ', ' ORDER BY attribute_row.attnum
  )
  INTO target_columns
  FROM pg_catalog.pg_attribute attribute_row
  WHERE attribute_row.attrelid =
      'public.cohort_room_contributor_stats'::pg_catalog.regclass
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped;

  EXECUTE pg_catalog.format(
    'REVOKE ALL (%s) ON TABLE public.cohort_room_contributor_stats FROM PUBLIC, anon, authenticated, service_role',
    target_columns
  );
END;
$$;

REVOKE ALL ON TABLE public.cohort_room_contributor_stats
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cohort_room_contributor_stats TO service_role;

-- The browser-facing relation is an author-card directory, not a public user
-- dossier. The only sensitive direct-client consumer needs three own activity
-- counters, exposed by the narrow UUID-bound RPC below. Current server APIs
-- continue to use service_role for authenticated owner workflows.
DROP POLICY IF EXISTS "community_profiles_select" ON public.community_profiles;
DROP POLICY IF EXISTS "community_profiles_insert" ON public.community_profiles;
DROP POLICY IF EXISTS "community_profiles_update" ON public.community_profiles;
DROP POLICY IF EXISTS community_profiles_select_public_card
  ON public.community_profiles;
DROP POLICY IF EXISTS community_profiles_insert_own ON public.community_profiles;
DROP POLICY IF EXISTS community_profiles_update_own ON public.community_profiles;

CREATE POLICY community_profiles_select_public_card
  ON public.community_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.community_profiles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  user_id,
  nickname,
  avatar_url,
  badge,
  rank
) ON public.community_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_profiles
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_community_activity_stats()
RETURNS TABLE(
  post_count integer,
  comment_count integer,
  total_upvotes_received integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT
    profile.post_count,
    profile.comment_count,
    profile.total_upvotes_received
  FROM public.community_profiles AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.user_id = auth.uid();
$$;

ALTER FUNCTION public.get_my_community_activity_stats() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_community_activity_stats()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_community_activity_stats()
  TO authenticated;

-- Achievement keys are stable account-linked history, not a public directory.
DROP POLICY IF EXISTS "ach_select" ON public.community_achievements;
DROP POLICY IF EXISTS "ach_insert" ON public.community_achievements;
DROP POLICY IF EXISTS community_achievements_select_own
  ON public.community_achievements;
CREATE POLICY community_achievements_select_own
  ON public.community_achievements
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.community_achievements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_achievements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_achievements
  TO service_role;

-- Legacy vendor-tag averages have no contributor count, source, or period.
-- Keep them available to the minimizing server API but remove direct browser
-- and mobile Data API access.
DROP POLICY IF EXISTS "vendor_tags_select" ON public.community_vendor_tags;
DROP POLICY IF EXISTS community_vendor_tags_select_public
  ON public.community_vendor_tags;
REVOKE ALL ON TABLE public.community_vendor_tags
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_vendor_tags TO service_role;

-- Keep compatibility columns for rolling clients, but make persistence of a
-- direct identifier impossible at both trigger and CHECK-constraint layers.
CREATE OR REPLACE FUNCTION public.redact_customer_survey_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.q23_contact := NULL;
  NEW.user_agent := NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.redact_customer_survey_identifiers() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redact_customer_survey_identifiers()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS customer_survey_identifiers_are_redacted
  ON public.customer_survey_responses;
CREATE TRIGGER customer_survey_identifiers_are_redacted
  BEFORE INSERT OR UPDATE
  ON public.customer_survey_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.redact_customer_survey_identifiers();

UPDATE public.customer_survey_responses
SET q23_contact = NULL,
    user_agent = NULL
WHERE q23_contact IS NOT NULL
   OR user_agent IS NOT NULL;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_q23_contact_is_null;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_q23_contact_is_null
  CHECK (q23_contact IS NULL)
  NOT VALID;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_user_agent_is_null;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_user_agent_is_null
  CHECK (user_agent IS NULL)
  NOT VALID;

ALTER TABLE public.customer_survey_responses
  VALIDATE CONSTRAINT customer_survey_q23_contact_is_null;
ALTER TABLE public.customer_survey_responses
  VALIDATE CONSTRAINT customer_survey_user_agent_is_null;

COMMENT ON VIEW public.cohort_stats IS
  'Latest valid quote per distinct room member and category. Exact sample sizes and prices remain NULL until five different members contributed; service-only.';
COMMENT ON VIEW public.cohort_room_contributor_stats IS
  'Distinct room quote contributors. Exact counts remain NULL below five; service-only.';
COMMENT ON TABLE public.community_profiles IS
  'Pseudonymous community profiles. Direct public/authenticated reads expose only author-card columns; full rows are service-only and the owner RPC exposes only three activity counters.';
COMMENT ON TABLE public.community_achievements IS
  'Private account-linked achievements. Authenticated callers can read only their own rows.';
COMMENT ON TABLE public.community_vendor_tags IS
  'Service-only legacy mention aggregates without a verified contributor count, source, or measurement period.';
COMMENT ON COLUMN public.customer_survey_responses.q23_contact IS
  'Deprecated compatibility column. The database always stores NULL.';
COMMENT ON COLUMN public.customer_survey_responses.user_agent IS
  'Deprecated compatibility column. The database always stores NULL.';

COMMIT;
