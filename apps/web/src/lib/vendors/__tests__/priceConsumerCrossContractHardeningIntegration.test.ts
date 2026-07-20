// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718203000_price_consumer_cross_contract_hardening.sql",
  ),
  "utf8",
);

const disclosureSemanticMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260720120000_disclosure_semantic_staging.sql",
  ),
  "utf8",
);

function readMigration(name: string) {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8",
  );
}

const orderedMigrations = [
  "20260718120000_vendor_public_column_privilege_hotfix.sql",
  "20260718130000_vendor_disclosure_foundation.sql",
  "20260718140000_disclosure_source_previews.sql",
  "20260718150000_price_snapshot_promotion.sql",
  "20260718160000_vendor_alias_proposals.sql",
  "20260718170000_admin_review_optimistic_concurrency.sql",
  "20260718180000_disclosure_storage_privacy_fence.sql",
  "20260718190000_price_consumer_contract.sql",
  "20260718200000_price_publication_immutability.sql",
  "20260718201000_admin_json_evidence.sql",
  "20260718202000_price_upload_confirmation_queue.sql",
] as const;

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000002";
const WINNER_VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const LOSER_VENDOR_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_VENDOR_ID = "20000000-0000-4000-8000-000000000003";
const WINNER_AGENCY_ID = "30000000-0000-4000-8000-000000000001";
const LOSER_AGENCY_ID = "30000000-0000-4000-8000-000000000002";
const VENDOR_CANDIDATE_ID = "40000000-0000-4000-8000-000000000001";
const AGENCY_CANDIDATE_ID = "40000000-0000-4000-8000-000000000002";
const EVENT_ID = "50000000-0000-4000-8000-000000000001";
const DISCLOSURE_DRAFT_SNAPSHOT_ID = "60000000-0000-4000-8000-000000000010";
const DISCLOSURE_OFFICIAL_PRICE_ID = "70000000-0000-4000-8000-000000000010";
const DISCLOSURE_PRICE_PARTNER_REF = "a".repeat(64);
const DISCLOSURE_POLICY_PARTNER_REF = "b".repeat(64);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false,
      couple_id uuid
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      wedding_date date
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid,
      name text NOT NULL,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      category text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      slug text,
      region_code text,
      website text,
      official_url text,
      instagram text,
      instagram_url text,
      naver_place_url text,
      attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      enrichment_status text NOT NULL DEFAULT 'pending',
      enriched_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_enrichment_private (
      vendor_id uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,
      price_band text,
      notes_internal text,
      enriched_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_dedupe_candidates (
      id uuid PRIMARY KEY,
      left_vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      right_vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      reason text,
      similarity numeric,
      status text NOT NULL DEFAULT 'pending',
      preserved_vendor_id uuid REFERENCES public.vendors(id),
      decided_by uuid,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (left_vendor_id, right_vendor_id)
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      normalized_name text,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      corporate_name text,
      region_code text,
      source_file text,
      merged_into_agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
      slug text NOT NULL,
      display_name text NOT NULL,
      homepage_url text,
      disclosure_url text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.agency_dedupe_candidates (
      id uuid PRIMARY KEY,
      left_agency_id uuid NOT NULL REFERENCES public.agencies(id),
      right_agency_id uuid NOT NULL REFERENCES public.agencies(id),
      reason text,
      similarity numeric,
      status text NOT NULL DEFAULT 'pending',
      preserved_agency_id uuid REFERENCES public.agencies(id),
      decided_by uuid,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (left_agency_id, right_agency_id)
    );
    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL,
      published_at date,
      is_current boolean NOT NULL DEFAULT false,
      published boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.guard_price_snapshot_publication_write()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NEW;
    END $$;
    CREATE TRIGGER price_snapshot_publication_write_fence
    BEFORE INSERT OR UPDATE OF published, published_at
    ON public.price_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_price_snapshot_publication_write();
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      vendor_id uuid REFERENCES public.vendors(id),
      agency_id uuid REFERENCES public.agencies(id),
      category text NOT NULL,
      item_name text NOT NULL,
      base_spec text,
      price_min_krw integer,
      price_max_krw integer,
      vat_note text,
      price_note text,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      source_record_key text,
      confidence numeric,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      agency_id uuid NOT NULL REFERENCES public.agencies(id),
      package_name text NOT NULL,
      category_scope text[] NOT NULL DEFAULT '{}'::text[],
      price_min_krw integer,
      price_max_krw integer,
      vat_note text,
      price_note text,
      options jsonb NOT NULL DEFAULT '[]'::jsonb,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE VIEW public.v_public_official_prices AS
      SELECT id AS snapshot_id, published_at
      FROM public.price_snapshots;
    CREATE VIEW public.v_public_agency_packages AS
      SELECT id AS snapshot_id, published_at
      FROM public.price_snapshots;
    CREATE VIEW public.v_public_prices AS
      SELECT id AS snapshot_id, published_at
      FROM public.price_snapshots;
    CREATE TABLE public.tags (
      id uuid PRIMARY KEY,
      slug text NOT NULL
    );
    CREATE TABLE public.vendor_tags (
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      tag_id uuid NOT NULL REFERENCES public.tags(id),
      source text NOT NULL DEFAULT 'team',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (vendor_id, tag_id)
    );
    CREATE TABLE public.events (
      id uuid PRIMARY KEY,
      anon_id text NOT NULL,
      user_id uuid REFERENCES auth.users(id),
      session_id text,
      vendor_id uuid REFERENCES public.vendors(id),
      agency_id uuid REFERENCES public.agencies(id),
      surface text NOT NULL,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      context jsonb NOT NULL DEFAULT '{}'::jsonb,
      weight integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.reject_event_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '42501';
    END $$;
    CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON public.events
      FOR EACH ROW EXECUTE FUNCTION public.reject_event_mutation();

    CREATE TABLE public.vendor_favorites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, vendor_id)
    );
    CREATE TABLE public.wishlists (
      user_id uuid NOT NULL REFERENCES auth.users(id),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, vendor_id)
    );
    ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wishlists FORCE ROW LEVEL SECURITY;
    CREATE POLICY price_consumer_owner_all ON public.wishlists
      FOR ALL TO authenticated
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TABLE public.price_alerts (
      user_id uuid NOT NULL REFERENCES auth.users(id),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, vendor_id)
    );
    CREATE TABLE public.combos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      name text NOT NULL DEFAULT 'test',
      selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      total_krw integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_demand_daily (
      day date NOT NULL,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      impressions integer NOT NULL DEFAULT 0,
      detail_views integer NOT NULL DEFAULT 0,
      wishlist_adds integer NOT NULL DEFAULT 0,
      combo_adds integer NOT NULL DEFAULT 0,
      quote_requests integer NOT NULL DEFAULT 0,
      weighted_score numeric NOT NULL DEFAULT 0,
      qualified_score numeric NOT NULL DEFAULT 0,
      PRIMARY KEY (day, vendor_id)
    );

    CREATE FUNCTION public.enforce_non_rejected_vendor_reference()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE target_status text;
    BEGIN
      IF NEW.vendor_id IS NULL THEN RETURN NEW; END IF;
      SELECT status INTO target_status FROM public.vendors
      WHERE id = NEW.vendor_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_REFERENCE_NOT_FOUND'; END IF;
      IF target_status = 'rejected' THEN
        RAISE EXCEPTION 'VENDOR_REFERENCE_REJECTED';
      END IF;
      RETURN NEW;
    END $$;
    CREATE FUNCTION public.enforce_active_agency_reference()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE merge_id uuid;
    BEGIN
      IF NEW.agency_id IS NULL THEN RETURN NEW; END IF;
      SELECT merged_into_agency_id INTO merge_id FROM public.agencies
      WHERE id = NEW.agency_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'AGENCY_REFERENCE_NOT_FOUND'; END IF;
      IF merge_id IS NOT NULL THEN RAISE EXCEPTION 'AGENCY_REFERENCE_MERGED'; END IF;
      RETURN NEW;
    END $$;

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlists TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_favorites TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.combos TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.vendors TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.agencies TO service_role;

    CREATE SCHEMA cron;
    CREATE TABLE cron.job (
      jobid bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      jobname text NOT NULL,
      schedule text NOT NULL,
      command text NOT NULL,
      nodename text NOT NULL DEFAULT 'localhost',
      nodeport integer NOT NULL DEFAULT 5432,
      database text NOT NULL DEFAULT current_database(),
      username text NOT NULL DEFAULT current_user,
      active boolean NOT NULL DEFAULT true
    );
    CREATE FUNCTION cron.schedule(job_name text, job_schedule text, job_command text)
    RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE result_id bigint;
    BEGIN
      INSERT INTO cron.job (jobname, schedule, command, active)
      VALUES (job_name, job_schedule, job_command, true)
      RETURNING jobid INTO result_id;
      RETURN result_id;
    END $$;
    CREATE FUNCTION cron.schedule_in_database(
      job_name text,
      job_schedule text,
      job_command text,
      job_database text,
      job_username text,
      job_active boolean
    ) RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE result_id bigint;
    BEGIN
      INSERT INTO cron.job (
        jobname, schedule, command, database, username, active
      ) VALUES (
        job_name, job_schedule, job_command, job_database, job_username,
        job_active
      ) RETURNING jobid INTO result_id;
      RETURN result_id;
    END $$;
    CREATE FUNCTION cron.unschedule(p_job_id bigint)
    RETURNS boolean LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM cron.job WHERE jobid = p_job_id;
      RETURN FOUND;
    END $$;
  `);
  return db;
}

async function seedMergeScenario(db: PGlite) {
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_ID}');
    INSERT INTO public.profiles (id, couple_id) VALUES ('${USER_ID}', NULL);
    INSERT INTO public.vendors (
      id, name, category, status, slug, region_code
    ) VALUES
      ('${WINNER_VENDOR_ID}', 'Winner Studio', 'studio', 'approved', 'winner-studio', '11'),
      ('${LOSER_VENDOR_ID}', 'Loser Studio', 'studio', 'approved', NULL, '11'),
      ('${OTHER_VENDOR_ID}', 'Other Studio', 'studio', 'approved', 'other-studio', '11');
    INSERT INTO public.agencies (
      id, name, normalized_name, region_code, slug, display_name
    ) VALUES
      ('${WINNER_AGENCY_ID}', 'Winner Agency', 'winner', '11', 'winner-agency', 'Winner Agency'),
      ('${LOSER_AGENCY_ID}', 'Loser Agency', 'loser', '11', 'loser-agency', 'Loser Agency');
    INSERT INTO public.price_snapshots (
      id, period_label, source, published_at, published
    ) VALUES (
      '60000000-0000-4000-8000-000000000001',
      '2026-Q2', 'test', '2026-06-30', true
    );
    INSERT INTO public.events (
      id, anon_id, user_id, vendor_id, agency_id, surface, event_type,
      weight, created_at
    ) VALUES (
      '${EVENT_ID}', 'anon-test', '${USER_ID}', '${LOSER_VENDOR_ID}',
      '${LOSER_AGENCY_ID}', 'price', 'vendor_detail_view', 2,
      date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
    );
    INSERT INTO public.wishlists (user_id, vendor_id, created_at) VALUES
      ('${USER_ID}', '${WINNER_VENDOR_ID}', '2026-07-02T00:00:00Z'),
      ('${USER_ID}', '${LOSER_VENDOR_ID}', '2026-07-01T00:00:00Z');
    INSERT INTO public.vendor_favorites (user_id, vendor_id, created_at) VALUES
      ('${USER_ID}', '${LOSER_VENDOR_ID}', '2026-07-01T00:00:00Z');
    INSERT INTO public.price_alerts (user_id, vendor_id, created_at) VALUES
      ('${USER_ID}', '${WINNER_VENDOR_ID}', '2026-07-02T00:00:00Z'),
      ('${USER_ID}', '${LOSER_VENDOR_ID}', '2026-07-01T00:00:00Z');
    INSERT INTO public.vendor_demand_daily (
      day, vendor_id, impressions, detail_views, weighted_score
    ) VALUES
      (CURRENT_DATE, '${WINNER_VENDOR_ID}', 2, 2, 4),
      (CURRENT_DATE, '${LOSER_VENDOR_ID}', 3, 3, 6);
    INSERT INTO public.combos (user_id, selections) VALUES (
      '${USER_ID}',
      jsonb_build_object(
        'studio', jsonb_build_object(
          'vendor_id', '${LOSER_VENDOR_ID}',
          'agency_id', '${LOSER_AGENCY_ID}'
        ),
        'dress', NULL,
        'makeup', NULL
      )
    );
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES
      ('vendor-demand-daily-kst', '5 5 * * *', 'SELECT 1', true),
      ('vendor-demand-daily-kst', '0 19 * * *', 'SELECT 1', false);
  `);
}

async function installDisclosureObjectKeyGuard(db: PGlite) {
  await db.exec(`
    CREATE FUNCTION public.disclosure_object_keys_are_safe(p_object_keys text[])
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    AS $function$
      SELECT COALESCE(
        p_object_keys IS NOT NULL
        AND cardinality(p_object_keys) <= 100
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(p_object_keys) AS object_key(value)
          WHERE value IS NULL
            OR value !~ '^[0-9a-f]{64}\\.(xlsx|docx|hwp|pdf|png)$'
        ),
        false
      );
    $function$;
    GRANT EXECUTE ON FUNCTION public.disclosure_object_keys_are_safe(text[])
      TO service_role;
  `);
}

async function seedDisclosureSemanticMergeScenario(db: PGlite) {
  await seedMergeScenario(db);
  await db.exec(migration);
  await installDisclosureObjectKeyGuard(db);
  await db.exec(disclosureSemanticMigration);
  await db.exec(`
    UPDATE public.vendors SET status = 'pending'
    WHERE id = '${LOSER_VENDOR_ID}';
    INSERT INTO public.vendor_dedupe_candidates (
      id, left_vendor_id, right_vendor_id
    ) VALUES (
      '${VENDOR_CANDIDATE_ID}', '${WINNER_VENDOR_ID}', '${LOSER_VENDOR_ID}'
    );
    INSERT INTO public.price_snapshots (
      id, period_label, source, published_at, is_current, published
    ) VALUES (
      '${DISCLOSURE_DRAFT_SNAPSHOT_ID}', 'draft', 'test', NULL, false, false
    );
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, category, item_name
    ) VALUES (
      '${DISCLOSURE_OFFICIAL_PRICE_ID}', '${DISCLOSURE_DRAFT_SNAPSHOT_ID}',
      '${LOSER_VENDOR_ID}', 'studio', 'Draft package'
    );
    INSERT INTO public.disclosure_semantic_staging (
      snapshot_id, schema_version, unit_id, record_kind, semantic_type,
      subject_kind, subject_name, subject_normalized_name, vendor_category,
      region_code, title, content_verbatim, summary, partner_record_ref,
      partner_vendor_id, official_price_id, source_agency,
      partner_link_status, validation_issue_codes, source_file_ids,
      source_file, source_object_keys, source_preview_keys, source_quote,
      source_fingerprint, validation_fingerprint, confidence,
      source_record_key, content_fingerprint
    ) VALUES
      (
        '${DISCLOSURE_DRAFT_SNAPSHOT_ID}', 2, '${"1".repeat(64)}',
        'vendor_policy', 'refund', 'vendor', 'Loser Studio', 'loser studio',
        'studio', '11', NULL, 'Refund policy source text', NULL,
        '${DISCLOSURE_PRICE_PARTNER_REF}', '${LOSER_VENDOR_ID}',
        '${DISCLOSURE_OFFICIAL_PRICE_ID}', NULL, 'price_row_staged',
        '{}'::text[], ARRAY['${"2".repeat(64)}'], 'fixtures/price.xlsx',
        ARRAY['${"3".repeat(64)}.xlsx'], '{}'::text[],
        'Refund policy source text', '${"4".repeat(64)}', '${"5".repeat(64)}',
        1, '${"6".repeat(64)}', '${"7".repeat(64)}'
      ),
      (
        '${DISCLOSURE_DRAFT_SNAPSHOT_ID}', 2, '${"8".repeat(64)}',
        'vendor_policy', 'change', 'vendor', 'Loser Studio', 'loser studio',
        'studio', '11', NULL, 'Change policy source text', NULL,
        '${DISCLOSURE_POLICY_PARTNER_REF}', '${LOSER_VENDOR_ID}', NULL,
        NULL, 'policy_only_pending_identity', '{}'::text[],
        ARRAY['${"9".repeat(64)}'], 'fixtures/policy.pdf',
        ARRAY['${"a".repeat(64)}.pdf'], '{}'::text[],
        'Change policy source text', '${"b".repeat(64)}', '${"c".repeat(64)}',
        1, '${"d".repeat(64)}', '${"e".repeat(64)}'
      );
  `);
}

async function installInactiveCronWriteGuard(db: PGlite) {
  await db.exec(`
    CREATE FUNCTION cron.reject_active_vendor_demand_job()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.jobname = 'vendor-demand-daily-kst'
        AND NEW.database = current_database()
        AND NEW.username = current_user::text
        AND NEW.active IS TRUE
      THEN
        RAISE EXCEPTION 'TEST_VENDOR_DEMAND_CRON_MUST_STAY_INACTIVE';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_active_vendor_demand_job
    BEFORE INSERT OR UPDATE ON cron.job
    FOR EACH ROW EXECUTE FUNCTION cron.reject_active_vendor_demand_job();
  `);
}

async function createFullOrderDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE supabase_storage_admin NOLOGIN;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER SCHEMA storage OWNER TO supabase_storage_admin;
    ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false,
      couple_id uuid
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      wedding_date date
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid,
      name text NOT NULL,
      category text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      is_verified boolean NOT NULL DEFAULT false,
      website text,
      instagram text,
      bank_name text,
      account_number text,
      account_holder text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_category_check
      CHECK (category IN (
        'studio', 'dress', 'makeup', 'package', 'snap', 'dvd', 'hanbok',
        'suit', 'jewelry', 'invitation', 'venue', 'honeymoon', 'other'
      ));
    GRANT SELECT ON public.vendors TO anon, authenticated;

    CREATE TABLE public.vendor_favorites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, vendor_id)
    );
    GRANT SELECT, INSERT, DELETE ON public.vendor_favorites TO service_role;

    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      interaction_type text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_interactions_log_interaction_type_check
        CHECK (interaction_type IN (
          'chat_turn', 'tool_call', 'tool_result', 'amora_director',
          'vendor_recommendation', 'feedback', 'community_amora_comment',
          'community_agent_auto'
        ))
    );

    CREATE SCHEMA cron;
    CREATE TABLE cron.job (
      jobid bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      jobname text NOT NULL,
      schedule text NOT NULL,
      command text NOT NULL,
      nodename text NOT NULL DEFAULT 'localhost',
      nodeport integer NOT NULL DEFAULT 5432,
      database text NOT NULL DEFAULT current_database(),
      username text NOT NULL DEFAULT current_user,
      active boolean NOT NULL DEFAULT true
    );
    CREATE FUNCTION cron.schedule(job_name text, job_schedule text, job_command text)
    RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE result_id bigint;
    BEGIN
      INSERT INTO cron.job (jobname, schedule, command, active)
      VALUES (job_name, job_schedule, job_command, true)
      RETURNING jobid INTO result_id;
      RETURN result_id;
    END $$;
    CREATE FUNCTION cron.schedule_in_database(
      job_name text,
      job_schedule text,
      job_command text,
      job_database text,
      job_username text,
      job_active boolean
    ) RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE result_id bigint;
    BEGIN
      INSERT INTO cron.job (
        jobname, schedule, command, database, username, active
      ) VALUES (
        job_name, job_schedule, job_command, job_database, job_username,
        job_active
      ) RETURNING jobid INTO result_id;
      RETURN result_id;
    END $$;
    CREATE FUNCTION cron.unschedule(p_job_id bigint)
    RETURNS boolean LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM cron.job WHERE jobid = p_job_id;
      RETURN FOUND;
    END $$;
  `);

  for (const [index, name] of orderedMigrations.entries()) {
    let sql = readMigration(name);
    if (name === "20260718190000_price_consumer_contract.sql") {
      await db.exec(`
        CREATE FUNCTION public.similarity(left_value text, right_value text)
        RETURNS real LANGUAGE sql IMMUTABLE AS $$
          SELECT CASE WHEN left_value = right_value THEN 1::real ELSE 0::real END
        $$;
        INSERT INTO cron.job (jobname, schedule, command, active)
        VALUES ('vendor-demand-daily-kst', '5 5 * * *', 'SELECT 1', true);
      `);
      await installInactiveCronWriteGuard(db);
      sql = sql.replace(
        "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
        "-- pg_trgm supplied by the PGlite compatibility function",
      );
    }
    if (name === "20260718200000_price_publication_immutability.sql") {
      await db.exec(`
        CREATE FUNCTION extensions.similarity(text, text)
        RETURNS real LANGUAGE sql IMMUTABLE STRICT AS $$
          SELECT public.similarity($1, $2)
        $$;
        INSERT INTO pg_catalog.pg_extension (
          oid, extname, extowner, extnamespace, extrelocatable, extversion,
          extconfig, extcondition
        )
        SELECT
          900000, 'pg_trgm', role_row.oid, namespace_row.oid, true, 'test',
          NULL, NULL
        FROM pg_catalog.pg_roles AS role_row
        CROSS JOIN pg_catalog.pg_namespace AS namespace_row
        WHERE role_row.rolname = 'postgres'
          AND namespace_row.nspname = 'extensions';
      `);
    }
    await db.exec(sql).catch((error: unknown) => {
      throw new Error(`ordered migration ${index + 1} (${name}) failed`, {
        cause: error,
      });
    });
    if (name === "20260718190000_price_consumer_contract.sql") {
      await expectInactiveCurrentCronContract(db);
    }
  }
  await db.exec(migration);
  await expectInactiveCurrentCronContract(db);
  return db;
}

async function expectInactiveCurrentCronContract(db: PGlite) {
  const cron = await db.query<{
    active: boolean;
    command: string;
    schedule: string;
  }>(`
    SELECT schedule, command, active
    FROM cron.job
    WHERE jobname = 'vendor-demand-daily-kst'
      AND database = current_database()
      AND username = current_user::text
    ORDER BY jobid
  `);
  expect(cron.rows).toEqual([{
    schedule: "0 19 * * *",
    command: "SELECT public.aggregate_vendor_demand_daily()",
    active: false,
  }]);

  const activeCron = await db.query<{ count: number }>(`
    SELECT count(*)::integer AS count
    FROM cron.job
    WHERE active IS TRUE
  `);
  expect(activeCron.rows).toEqual([{ count: 0 }]);
}

describe("price consumer cross-contract hardening integration", () => {
  it("applies the complete disclosure migration order with exact postconditions", async () => {
    const db = await createFullOrderDatabase();
    try {
      const state = await db.query<{
        published_at_type: string;
        cron_count: number;
        cron_schedule: string;
        cron_command: string;
        cron_active: boolean;
        wishlist_update: boolean;
      }>(`
        SELECT
          (
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'price_snapshots'
              AND column_name = 'published_at'
          ) AS published_at_type,
          (
            SELECT count(*)::integer FROM cron.job
            WHERE jobname = 'vendor-demand-daily-kst'
          ) AS cron_count,
          (
            SELECT schedule FROM cron.job
            WHERE jobname = 'vendor-demand-daily-kst'
          ) AS cron_schedule,
          (
            SELECT command FROM cron.job
            WHERE jobname = 'vendor-demand-daily-kst'
          ) AS cron_command,
          (
            SELECT active FROM cron.job
            WHERE jobname = 'vendor-demand-daily-kst'
          ) AS cron_active,
          has_table_privilege(
            'authenticated', 'public.wishlists', 'UPDATE'
          ) AS wishlist_update
      `);
      expect(state.rows).toEqual([{
        published_at_type: "timestamp with time zone",
        cron_count: 1,
        cron_schedule: "0 19 * * *",
        cron_command: "SELECT public.aggregate_vendor_demand_daily()",
        cron_active: false,
        wishlist_update: false,
      }]);

      const definition = await db.query<{ source: string }>(`
        SELECT pg_get_functiondef(
          'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'::regprocedure
        ) AS source
      `);
      expect(definition.rows[0]?.source).not.toMatch(/UPDATE public\.events/iu);

      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${USER_ID}');
        INSERT INTO public.vendors (
          id, name, category, status, slug, region_code
        ) VALUES (
          '${WINNER_VENDOR_ID}', 'Canonical Studio', 'studio', 'approved',
          'canonical-studio', '11'
        );
        SELECT set_config('request.jwt.claim.sub', '${USER_ID}', false);
        SET ROLE authenticated;
        INSERT INTO public.combos (user_id, name, selections)
        VALUES (
          '${USER_ID}', 'Authenticated combo',
          jsonb_build_object(
            'studio', jsonb_build_object(
              'vendor_id', '${WINNER_VENDOR_ID}',
              'agency_id', NULL
            ),
            'dress', NULL,
            'makeup', NULL
          )
        );
        RESET ROLE;
      `);

      await db.exec(migration);
      await expectInactiveCurrentCronContract(db);

      const authenticatedCombo = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.combos
        WHERE user_id = '${USER_ID}'
      `);
      expect(authenticatedCombo.rows).toEqual([{ count: 1 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 60_000);

  it("fails closed when the exact daily scheduler capability is absent", async () => {
    const db = await createDatabase();
    try {
      await db.exec("DROP SCHEMA cron CASCADE;");
      await expect(db.exec(migration)).rejects.toThrow(
        /PRICE_DEMAND_CRON_EXTENSION_REQUIRED/u,
      );
      await db.exec("ROLLBACK;");

      const typeAfterRollback = await db.query<{ data_type: string }>(`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'price_snapshots'
          AND column_name = 'published_at'
      `);
      expect(typeAfterRollback.rows).toEqual([{ data_type: "date" }]);
    } finally {
      await db.close();
    }
  });

  it("repairs only the current database and owner cron contract", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO cron.job (
          jobname, schedule, command, database, username, active
        ) VALUES
          (
            'vendor-demand-daily-kst', '0 19 * * *',
            'SELECT public.aggregate_vendor_demand_daily()',
            'other_database', 'service_role', true
          ),
          (
            'vendor-demand-daily-kst', '5 5 * * *', 'SELECT 1',
            current_database(), current_user, true
          );
      `);
      await installInactiveCronWriteGuard(db);

      await db.exec(migration);

      const jobs = await db.query<{
        current_exact_count: number;
        current_active_count: number;
        foreign_count: number;
        current_stale_count: number;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE jobname = 'vendor-demand-daily-kst'
              AND database = current_database()
              AND username = current_user
              AND schedule = '0 19 * * *'
              AND command = 'SELECT public.aggregate_vendor_demand_daily()'
              AND active IS FALSE
          )::integer AS current_exact_count,
          count(*) FILTER (
            WHERE jobname = 'vendor-demand-daily-kst'
              AND database = current_database()
              AND username = current_user
              AND active IS TRUE
          )::integer AS current_active_count,
          count(*) FILTER (
            WHERE jobname = 'vendor-demand-daily-kst'
              AND database = 'other_database'
              AND username = 'service_role'
          )::integer AS foreign_count,
          count(*) FILTER (
            WHERE jobname = 'vendor-demand-daily-kst'
              AND database = current_database()
              AND username = current_user
              AND schedule = '5 5 * * *'
          )::integer AS current_stale_count
        FROM cron.job
      `);
      expect(jobs.rows).toEqual([{
        current_exact_count: 1,
        current_active_count: 0,
        foreign_count: 1,
        current_stale_count: 0,
      }]);
    } finally {
      await db.close();
    }
  });

  it("makes legacy favorites an insert/delete set with no UPDATE privilege", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      const privileges = await db.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_update: boolean;
        service_update: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.vendor_favorites', 'INSERT'
          ) AS authenticated_insert,
          has_table_privilege(
            'authenticated', 'public.vendor_favorites', 'DELETE'
          ) AS authenticated_delete,
          has_table_privilege(
            'authenticated', 'public.vendor_favorites', 'UPDATE'
          ) AS authenticated_update,
          has_table_privilege(
            'service_role', 'public.vendor_favorites', 'UPDATE'
          ) AS service_update
      `);
      expect(privileges.rows).toEqual([{
        authenticated_insert: true,
        authenticated_delete: true,
        authenticated_update: false,
        service_update: false,
      }]);

      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${USER_ID}');
        INSERT INTO public.vendors (
          id, name, category, status, slug, region_code
        ) VALUES (
          '${WINNER_VENDOR_ID}', 'Favorite Vendor', 'studio', 'approved',
          'favorite-vendor', '11'
        );
        SELECT set_config('request.jwt.claim.sub', '${USER_ID}', false);
        SET ROLE authenticated;
        INSERT INTO public.vendor_favorites (user_id, vendor_id)
        VALUES ('${USER_ID}', '${WINNER_VENDOR_ID}');
      `);
      await expect(db.exec(`
        UPDATE public.vendor_favorites
        SET created_at = now()
        WHERE user_id = '${USER_ID}'
          AND vendor_id = '${WINNER_VENDOR_ID}'
      `)).rejects.toThrow(/permission denied/iu);

      await db.exec("RESET ROLE;");

      const insertedFavorite = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.vendor_favorites
        WHERE user_id = '${USER_ID}'
          AND vendor_id = '${WINNER_VENDOR_ID}'
      `);
      expect(insertedFavorite.rows).toEqual([{ count: 1 }]);

      await db.exec(`
        SET ROLE authenticated;
        DELETE FROM public.vendor_favorites
        WHERE user_id = '${USER_ID}'
          AND vendor_id = '${WINNER_VENDOR_ID}';
        RESET ROLE;
      `);
      const deletedPair = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.vendor_favorites
      `);
      expect(deletedPair.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects direct merge-lineage inserts even when service_role preloads the private GUC", async () => {
    const db = await createDatabase();
    const insertedVendorId = "20000000-0000-4000-8000-000000000010";
    const insertedAgencyId = "30000000-0000-4000-8000-000000000010";
    try {
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, slug, region_code
        ) VALUES (
          '${WINNER_VENDOR_ID}', 'Canonical Vendor', 'studio', 'approved',
          'canonical-vendor', '11'
        );
        INSERT INTO public.agencies (
          id, name, normalized_name, region_code, slug, display_name
        ) VALUES (
          '${WINNER_AGENCY_ID}', 'Canonical Agency', 'canonical-agency', '11',
          'canonical-agency', 'Canonical Agency'
        );
      `);
      await db.exec(migration);
      await db.exec("SET ROLE service_role;");

      await db.query(
        "SELECT set_config('hanbang.vendor_dedupe_mapping', $1, false)",
        [`${insertedVendorId}:${WINNER_VENDOR_ID}`],
      );
      await expect(db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, slug, region_code, merged_into_vendor_id
        ) VALUES (
          '${insertedVendorId}', 'Injected Vendor', 'studio', 'pending',
          'injected-vendor', '11', '${WINNER_VENDOR_ID}'
        )
      `)).rejects.toThrow(/VENDOR_MERGE_MAPPING_RPC_REQUIRED/u);

      await db.query(
        "SELECT set_config('hanbang.agency_dedupe_mapping', $1, false)",
        [`${insertedAgencyId}:${WINNER_AGENCY_ID}`],
      );
      await expect(db.exec(`
        INSERT INTO public.agencies (
          id, name, normalized_name, region_code, slug, display_name,
          merged_into_agency_id
        ) VALUES (
          '${insertedAgencyId}', 'Injected Agency', 'injected-agency', '11',
          'injected-agency', 'Injected Agency', '${WINNER_AGENCY_ID}'
        )
      `)).rejects.toThrow(/AGENCY_MERGE_MAPPING_RPC_REQUIRED/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an inactive canonical agency in both dedupe and new event writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(`
        INSERT INTO public.agencies (
          id, name, normalized_name, region_code, slug, display_name, is_active
        ) VALUES
          (
            '${WINNER_AGENCY_ID}', 'Inactive Agency', 'inactive-agency', '11',
            'inactive-agency', 'Inactive Agency', false
          ),
          (
            '${LOSER_AGENCY_ID}', 'Active Duplicate', 'active-duplicate', '11',
            'active-duplicate', 'Active Duplicate', true
          );
        INSERT INTO public.agency_dedupe_candidates (
          id, left_agency_id, right_agency_id
        ) VALUES (
          '${AGENCY_CANDIDATE_ID}', '${WINNER_AGENCY_ID}', '${LOSER_AGENCY_ID}'
        );
        SET ROLE service_role;
      `);

      await expect(db.query(
        "SELECT public.decide_agency_dedupe_candidate($1, 'same', $2, $3)",
        [AGENCY_CANDIDATE_ID, WINNER_AGENCY_ID, ACTOR_ID],
      )).rejects.toThrow(/AGENCY_DEDUPE_PRESERVED_INACTIVE/u);

      await expect(db.exec(`
        INSERT INTO public.events (
          id, anon_id, agency_id, surface, event_type, weight
        ) VALUES (
          '50000000-0000-4000-8000-000000000010', 'inactive-agency-test',
          '${WINNER_AGENCY_ID}', 'price', 'vendor_impression', 1
        )
      `)).rejects.toThrow(/AGENCY_REFERENCE_INACTIVE/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("coalesces non-conflicting agency provenance into the canonical winner", async () => {
    const db = await createDatabase();
    try {
      await seedMergeScenario(db);
      await db.exec(migration);
      await db.exec(`
        UPDATE public.agencies
        SET corporate_name = NULL,
            source_file = NULL,
            homepage_url = NULL,
            disclosure_url = NULL
        WHERE id = '${WINNER_AGENCY_ID}';
        UPDATE public.agencies
        SET corporate_name = 'Duplicate Agency Co., Ltd.',
            source_file = 'agency/source-a.json',
            homepage_url = 'https://agency.example/home',
            disclosure_url = 'https://agency.example/disclosure',
            display_name = 'Duplicate Public Agency'
        WHERE id = '${LOSER_AGENCY_ID}';
        INSERT INTO public.agency_dedupe_candidates (
          id, left_agency_id, right_agency_id
        ) VALUES (
          '${AGENCY_CANDIDATE_ID}', '${WINNER_AGENCY_ID}', '${LOSER_AGENCY_ID}'
        );
        SET ROLE service_role;
      `);
      await db.query(
        "SELECT public.decide_agency_dedupe_candidate($1, 'same', $2, $3)",
        [AGENCY_CANDIDATE_ID, WINNER_AGENCY_ID, ACTOR_ID],
      );
      await db.exec("RESET ROLE;");

      const winner = await db.query<{
        aliases: string[];
        corporate_name: string;
        source_file: string;
        homepage_url: string;
        disclosure_url: string;
      }>(`
        SELECT aliases, corporate_name, source_file, homepage_url, disclosure_url
        FROM public.agencies
        WHERE id = '${WINNER_AGENCY_ID}'
      `);
      expect(winner.rows).toEqual([{
        aliases: ["Duplicate Public Agency", "Loser Agency"],
        corporate_name: "Duplicate Agency Co., Ltd.",
        source_file: "agency/source-a.json",
        homepage_url: "https://agency.example/home",
        disclosure_url: "https://agency.example/disclosure",
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back agency dedupe when canonical provenance conflicts", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(`
        INSERT INTO public.agencies (
          id, name, normalized_name, corporate_name, region_code,
          slug, display_name
        ) VALUES
          (
            '${WINNER_AGENCY_ID}', 'Winner Agency', 'winner-agency',
            'Winner Legal Name', '11', 'winner-agency', 'Winner Agency'
          ),
          (
            '${LOSER_AGENCY_ID}', 'Loser Agency', 'loser-agency',
            'Different Legal Name', '11', 'loser-agency', 'Loser Agency'
          );
        INSERT INTO public.agency_dedupe_candidates (
          id, left_agency_id, right_agency_id
        ) VALUES (
          '${AGENCY_CANDIDATE_ID}', '${WINNER_AGENCY_ID}', '${LOSER_AGENCY_ID}'
        );
        SET ROLE service_role;
      `);

      await expect(db.query(
        "SELECT public.decide_agency_dedupe_candidate($1, 'same', $2, $3)",
        [AGENCY_CANDIDATE_ID, WINNER_AGENCY_ID, ACTOR_ID],
      )).rejects.toThrow(/AGENCY_DEDUPE_CORPORATE_NAME_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const state = await db.query<{
        candidate_status: string;
        merged_into: string | null;
        corporate_name: string;
      }>(`
        SELECT
          candidate.status AS candidate_status,
          loser.merged_into_agency_id::text AS merged_into,
          winner.corporate_name
        FROM public.agency_dedupe_candidates AS candidate
        JOIN public.agencies AS winner ON winner.id = '${WINNER_AGENCY_ID}'
        JOIN public.agencies AS loser ON loser.id = '${LOSER_AGENCY_ID}'
        WHERE candidate.id = '${AGENCY_CANDIDATE_ID}'
      `);
      expect(state.rows).toEqual([{
        candidate_status: "pending",
        merged_into: null,
        corporate_name: "Winner Legal Name",
      }]);

      await db.exec(`
        UPDATE public.agencies
        SET corporate_name = 'Winner Legal Name'
        WHERE id = '${LOSER_AGENCY_ID}';
        ALTER TABLE public.agencies
          ADD COLUMN unclassified_provenance text;
        UPDATE public.agencies
        SET unclassified_provenance = 'must-not-be-dropped'
        WHERE id = '${LOSER_AGENCY_ID}';
        SET ROLE service_role;
      `);
      await expect(db.query(
        "SELECT public.decide_agency_dedupe_candidate($1, 'same', $2, $3)",
        [AGENCY_CANDIDATE_ID, WINNER_AGENCY_ID, ACTOR_ID],
      )).rejects.toThrow(
        /AGENCY_DEDUPE_UNMERGED_COLUMN_CONFLICT: unclassified_provenance/u,
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("moves price-backed and policy-only semantic links with an approved vendor merge", async () => {
    const db = await createDatabase();
    try {
      await seedDisclosureSemanticMergeScenario(db);
      await db.exec("SET ROLE service_role;");

      await db.query(
        "SELECT public.decide_vendor_dedupe_candidate($1, 'same', $2, $3)",
        [VENDOR_CANDIDATE_ID, WINNER_VENDOR_ID, ACTOR_ID],
      );
      await db.exec("RESET ROLE;");

      const links = await db.query<{
        official_price_id: string | null;
        partner_record_ref: string;
        partner_vendor_id: string;
      }>(`
        SELECT
          partner_record_ref,
          partner_vendor_id::text,
          official_price_id::text
        FROM public.disclosure_semantic_staging
        ORDER BY partner_record_ref
      `);
      expect(links.rows).toEqual([
        {
          partner_record_ref: DISCLOSURE_PRICE_PARTNER_REF,
          partner_vendor_id: WINNER_VENDOR_ID,
          official_price_id: DISCLOSURE_OFFICIAL_PRICE_ID,
        },
        {
          partner_record_ref: DISCLOSURE_POLICY_PARTNER_REF,
          partner_vendor_id: WINNER_VENDOR_ID,
          official_price_id: null,
        },
      ]);
      const price = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id::text FROM public.official_prices
        WHERE id = '${DISCLOSURE_OFFICIAL_PRICE_ID}'
      `);
      expect(price.rows).toEqual([{ vendor_id: WINNER_VENDOR_ID }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls price and semantic links back when a later vendor-merge step fails", async () => {
    const db = await createDatabase();
    try {
      await seedDisclosureSemanticMergeScenario(db);
      await db.exec(`
        CREATE FUNCTION public.reject_test_vendor_merge_late()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW.merged_into_vendor_id IS NOT NULL THEN
            RAISE EXCEPTION 'TEST_LATE_VENDOR_MERGE_FAILURE';
          END IF;
          RETURN NEW;
        END
        $function$;
        CREATE TRIGGER zz_reject_test_vendor_merge_late
        BEFORE UPDATE OF merged_into_vendor_id ON public.vendors
        FOR EACH ROW
        EXECUTE FUNCTION public.reject_test_vendor_merge_late();
        SET ROLE service_role;
      `);

      await expect(db.query(
        "SELECT public.decide_vendor_dedupe_candidate($1, 'same', $2, $3)",
        [VENDOR_CANDIDATE_ID, WINNER_VENDOR_ID, ACTOR_ID],
      )).rejects.toThrow(/TEST_LATE_VENDOR_MERGE_FAILURE/u);
      await db.exec("RESET ROLE;");

      const rolledBack = await db.query<{
        candidate_status: string;
        losing_merged_into: string | null;
        price_vendor_id: string;
        semantic_loser_count: number;
        semantic_preserved_count: number;
      }>(`
        SELECT
          (
            SELECT status FROM public.vendor_dedupe_candidates
            WHERE id = '${VENDOR_CANDIDATE_ID}'
          ) AS candidate_status,
          (
            SELECT merged_into_vendor_id::text FROM public.vendors
            WHERE id = '${LOSER_VENDOR_ID}'
          ) AS losing_merged_into,
          (
            SELECT vendor_id::text FROM public.official_prices
            WHERE id = '${DISCLOSURE_OFFICIAL_PRICE_ID}'
          ) AS price_vendor_id,
          (
            SELECT count(*)::integer FROM public.disclosure_semantic_staging
            WHERE partner_vendor_id = '${LOSER_VENDOR_ID}'
          ) AS semantic_loser_count,
          (
            SELECT count(*)::integer FROM public.disclosure_semantic_staging
            WHERE partner_vendor_id = '${WINNER_VENDOR_ID}'
          ) AS semantic_preserved_count
      `);
      expect(rolledBack.rows).toEqual([{
        candidate_status: "pending",
        losing_merged_into: null,
        price_vendor_id: LOSER_VENDOR_ID,
        semantic_loser_count: 2,
        semantic_preserved_count: 0,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps a linked semantic vendor in sync on a direct pending-price vendor move", async () => {
    const db = await createDatabase();
    try {
      await seedDisclosureSemanticMergeScenario(db);
      await db.exec(`
        GRANT ALL ON public.official_prices TO service_role;
        SET ROLE service_role;
        UPDATE public.official_prices
        SET vendor_id = '${WINNER_VENDOR_ID}'
        WHERE id = '${DISCLOSURE_OFFICIAL_PRICE_ID}';
        RESET ROLE;
      `);

      const linked = await db.query<{
        price_vendor_id: string;
        semantic_vendor_id: string;
      }>(`
        SELECT
          price.vendor_id::text AS price_vendor_id,
          semantic.partner_vendor_id::text AS semantic_vendor_id
        FROM public.official_prices AS price
        JOIN public.disclosure_semantic_staging AS semantic
          ON semantic.official_price_id = price.id
        WHERE price.id = '${DISCLOSURE_OFFICIAL_PRICE_ID}'
      `);
      expect(linked.rows).toEqual([{
        price_vendor_id: WINNER_VENDOR_ID,
        semantic_vendor_id: WINNER_VENDOR_ID,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects moving a linked pending price to a different snapshot", async () => {
    const db = await createDatabase();
    const otherDraftSnapshotId = "60000000-0000-4000-8000-000000000011";
    try {
      await seedDisclosureSemanticMergeScenario(db);
      await db.exec(`
        INSERT INTO public.price_snapshots (
          id, period_label, source, published_at, is_current, published
        ) VALUES (
          '${otherDraftSnapshotId}', 'other-draft', 'test', NULL, false, false
        );
        GRANT ALL ON public.official_prices TO service_role;
        SET ROLE service_role;
      `);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET snapshot_id = '${otherDraftSnapshotId}'
        WHERE id = '${DISCLOSURE_OFFICIAL_PRICE_ID}'
      `)).rejects.toThrow(/DISCLOSURE_SEMANTIC_PRICE_SNAPSHOT_IMMUTABLE/u);
      await db.exec("RESET ROLE;");

      const snapshots = await db.query<{
        price_snapshot_id: string;
        semantic_snapshot_id: string;
      }>(`
        SELECT
          price.snapshot_id::text AS price_snapshot_id,
          semantic.snapshot_id::text AS semantic_snapshot_id
        FROM public.official_prices AS price
        JOIN public.disclosure_semantic_staging AS semantic
          ON semantic.official_price_id = price.id
        WHERE price.id = '${DISCLOSURE_OFFICIAL_PRICE_ID}'
      `);
      expect(snapshots.rows).toEqual([{
        price_snapshot_id: DISCLOSURE_DRAFT_SNAPSHOT_ID,
        semantic_snapshot_id: DISCLOSURE_DRAFT_SNAPSHOT_ID,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("preserves raw events while unioning and canonicalizing both merge identities", async () => {
    const db = await createDatabase();
    try {
      await seedMergeScenario(db);
      await db.exec(migration);

      await db.exec(`
        UPDATE public.vendors SET status = 'pending'
        WHERE id = '${LOSER_VENDOR_ID}';
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id
        ) VALUES (
          '${VENDOR_CANDIDATE_ID}', '${WINNER_VENDOR_ID}', '${LOSER_VENDOR_ID}'
        );
        INSERT INTO public.agency_dedupe_candidates (
          id, left_agency_id, right_agency_id
        ) VALUES (
          '${AGENCY_CANDIDATE_ID}', '${WINNER_AGENCY_ID}', '${LOSER_AGENCY_ID}'
        );
      `);

      await db.exec("SET ROLE service_role;");
      await db.query(
        "SELECT public.decide_vendor_dedupe_candidate($1, 'same', $2, $3)",
        [VENDOR_CANDIDATE_ID, WINNER_VENDOR_ID, ACTOR_ID],
      );
      await db.query(
        "SELECT public.decide_agency_dedupe_candidate($1, 'same', $2, $3)",
        [AGENCY_CANDIDATE_ID, WINNER_AGENCY_ID, ACTOR_ID],
      );

      const event = await db.query<{
        source_vendor_id: string;
        vendor_id: string;
        source_agency_id: string;
        agency_id: string;
      }>(`
        SELECT source_vendor_id, vendor_id, source_agency_id, agency_id
        FROM public.v_events_canonical WHERE id = '${EVENT_ID}'
      `);
      expect(event.rows).toEqual([{
        source_vendor_id: LOSER_VENDOR_ID,
        vendor_id: WINNER_VENDOR_ID,
        source_agency_id: LOSER_AGENCY_ID,
        agency_id: WINNER_AGENCY_ID,
      }]);

      await db.exec("RESET ROLE;");

      const references = await db.query<{
        wishlist_count: number;
        legacy_count: number;
        alert_count: number;
        demand_score: string;
        combo_vendor_id: string;
        combo_agency_id: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.wishlists) AS wishlist_count,
          (SELECT count(*)::int FROM public.vendor_favorites) AS legacy_count,
          (SELECT count(*)::int FROM public.price_alerts) AS alert_count,
          (SELECT weighted_score::text FROM public.vendor_demand_daily
           WHERE vendor_id = '${WINNER_VENDOR_ID}' AND day = CURRENT_DATE) AS demand_score,
          (SELECT selections -> 'studio' ->> 'vendor_id' FROM public.combos LIMIT 1)
            AS combo_vendor_id,
          (SELECT selections -> 'studio' ->> 'agency_id' FROM public.combos LIMIT 1)
            AS combo_agency_id
      `);
      expect(references.rows[0]).toEqual({
        wishlist_count: 1,
        legacy_count: 1,
        alert_count: 1,
        demand_score: "10",
        combo_vendor_id: WINNER_VENDOR_ID,
        combo_agency_id: WINNER_AGENCY_ID,
      });

      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        UPDATE public.events SET vendor_id = '${WINNER_VENDOR_ID}'
        WHERE id = '${EVENT_ID}'
      `)).rejects.toThrow(/EVENTS_ARE_APPEND_ONLY/u);
      await expect(db.exec(`
        SELECT set_config(
          'hanbang.vendor_dedupe_mapping',
          '${OTHER_VENDOR_ID}:${WINNER_VENDOR_ID}', false
        );
        UPDATE public.vendors
        SET merged_into_vendor_id = '${WINNER_VENDOR_ID}'
        WHERE id = '${OTHER_VENDOR_ID}'
      `)).rejects.toThrow(/VENDOR_MERGE_MAPPING_RPC_REQUIRED/u);
      await expect(db.exec(`
        INSERT INTO public.wishlists (user_id, vendor_id)
        VALUES ('${USER_ID}', '${LOSER_VENDOR_ID}')
      `)).rejects.toThrow(/VENDOR_REFERENCE_REJECTED/u);

      await db.exec("RESET ROLE;");
      const cron = await db.query<{
        schedule: string;
        command: string;
        active: boolean;
      }>(`
        SELECT schedule, command, active FROM cron.job
        WHERE jobname = 'vendor-demand-daily-kst'
      `);
      expect(cron.rows).toEqual([{
        schedule: "0 19 * * *",
        command: "SELECT public.aggregate_vendor_demand_daily()",
        active: false,
      }]);

      const published = await db.query<{ value: string }>(`
        SELECT (published_at AT TIME ZONE 'UTC')::text AS value
        FROM public.price_snapshots LIMIT 1
      `);
      expect(published.rows[0]?.value).toBe("2026-06-30 00:00:00");
      const wishlistUpdate = await db.query<{ allowed: boolean }>(`
        SELECT has_table_privilege(
          'authenticated', 'public.wishlists', 'UPDATE'
        ) AS allowed
      `);
      expect(wishlistUpdate.rows).toEqual([{ allowed: false }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed when a losing vendor owns published price history", async () => {
    const db = await createDatabase();
    try {
      await seedMergeScenario(db);
      await db.exec(migration);
      await db.exec(`
        UPDATE public.vendors SET status = 'pending'
        WHERE id = '${LOSER_VENDOR_ID}';
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id
        ) VALUES (
          '${VENDOR_CANDIDATE_ID}', '${WINNER_VENDOR_ID}', '${LOSER_VENDOR_ID}'
        );
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, category, item_name,
          review_status, needs_review, edited_by_admin, review_version
        ) VALUES (
          '70000000-0000-4000-8000-000000000001',
          '60000000-0000-4000-8000-000000000001',
          '${LOSER_VENDOR_ID}', 'studio', 'Historical',
          'approved', false, true, 1
        );
        SET ROLE service_role;
      `);
      await expect(db.query(
        "SELECT public.decide_vendor_dedupe_candidate($1, 'same', $2, $3)",
        [VENDOR_CANDIDATE_ID, WINNER_VENDOR_ID, ACTOR_ID],
      )).rejects.toThrow(/VENDOR_DEDUPE_PRICE_REFERENCE_REQUIRES_NEW_SNAPSHOT/u);

      await db.exec("RESET ROLE;");
      const state = await db.query<{ status: string; mapped: string | null }>(`
        SELECT status, merged_into_vendor_id::text AS mapped
        FROM public.vendors WHERE id = '${LOSER_VENDOR_ID}'
      `);
      expect(state.rows).toEqual([{ status: "pending", mapped: null }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
