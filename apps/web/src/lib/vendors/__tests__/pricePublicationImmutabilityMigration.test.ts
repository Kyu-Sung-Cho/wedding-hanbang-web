// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const publicationImmutabilityMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718200000_price_publication_immutability.sql"
  ),
  "utf8"
);

const PUBLISHED_SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";
const DRAFT_SNAPSHOT_ID = "10000000-0000-4000-8000-000000000002";
const CLEANUP_DRAFT_SNAPSHOT_ID = "10000000-0000-4000-8000-000000000003";
const PUBLISHED_PRICE_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_PRICE_ID = "20000000-0000-4000-8000-000000000002";
const REVIEWED_DRAFT_PRICE_ID = "20000000-0000-4000-8000-000000000004";
const PUBLISHED_OPTION_ID = "60000000-0000-4000-8000-000000000001";
const DRAFT_OPTION_ID = "60000000-0000-4000-8000-000000000002";
const PUBLISHED_PACKAGE_ID = "70000000-0000-4000-8000-000000000001";
const DRAFT_PACKAGE_ID = "70000000-0000-4000-8000-000000000002";
const REVIEWED_DRAFT_PACKAGE_ID = "70000000-0000-4000-8000-000000000004";

type LegacyPublicationTrigger =
  | "price_snapshot_current_write_fence"
  | "price_snapshot_publication_write_fence"
  | "price_snapshot_mark_published";

async function createDatabase(options: {
  invalidPublishedVendorSlug?: boolean;
  legacySource?: string;
  missingLegacyTrigger?: LegacyPublicationTrigger;
} = {}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.similarity(text, text)
    RETURNS real
    LANGUAGE sql
    IMMUTABLE
    STRICT
    AS $similarity$
      WITH padded AS (
        SELECT
          '  ' || lower($1) || ' ' AS left_value,
          '  ' || lower($2) || ' ' AS right_value
      ), left_trigrams AS (
        SELECT DISTINCT substr(left_value, position, 3) AS trigram
        FROM padded
        CROSS JOIN LATERAL generate_series(
          1,
          greatest(char_length(left_value) - 2, 1)
        ) AS position
      ), right_trigrams AS (
        SELECT DISTINCT substr(right_value, position, 3) AS trigram
        FROM padded
        CROSS JOIN LATERAL generate_series(
          1,
          greatest(char_length(right_value) - 2, 1)
        ) AS position
      ), counts AS (
        SELECT
          (SELECT count(*) FROM left_trigrams) AS left_count,
          (SELECT count(*) FROM right_trigrams) AS right_count,
          (
            SELECT count(*)
            FROM left_trigrams
            INNER JOIN right_trigrams USING (trigram)
          ) AS shared_count
      )
      SELECT (
        shared_count::double precision
        / greatest(left_count, right_count, 1)
      )::real
      FROM counts
    $similarity$;
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

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      slug text,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      category text NOT NULL,
      status text NOT NULL,
      region_code text
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      slug text,
      display_name text,
      region_code text,
      is_active boolean NOT NULL DEFAULT true,
      merged_into_agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT
    );
    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL,
      source_url text,
      source_note text,
      published_at date,
      collected_at timestamptz,
      is_current boolean NOT NULL DEFAULT false,
      published boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL
        REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
      agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
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
      source_preview_keys text[] NOT NULL DEFAULT '{}'::text[],
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
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL
        REFERENCES public.official_prices(id) ON DELETE CASCADE,
      name text NOT NULL,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      is_effectively_mandatory boolean NOT NULL DEFAULT false,
      ai_note text,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL
        REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      agency_id uuid NOT NULL
        REFERENCES public.agencies(id) ON DELETE RESTRICT,
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
      source_preview_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.test_public_prices_data (
      official_price_id uuid,
      vendor_id uuid,
      vendor_slug text,
      vendor_name text,
      category text,
      region_code text,
      aliases text[],
      agency_id uuid,
      agency_slug text,
      agency_name text,
      item_name text,
      price_min_krw integer,
      price_max_krw integer,
      price_note text,
      base_spec text,
      vat_note text,
      source_quote text,
      period_label text,
      source text,
      source_note text,
      published_at date,
      is_current boolean
    );
    CREATE VIEW public.v_public_prices AS
    SELECT * FROM public.test_public_prices_data;

    CREATE FUNCTION public.normalize_price_vendor_name(p_name text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path = public, pg_temp
    AS $normalize$
      SELECT lower(regexp_replace(COALESCE(p_name, ''),
        '[[:space:][:punct:]]+', '', 'g'))
    $normalize$;

    CREATE FUNCTION public.guard_official_review_parent_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $guard$
    DECLARE
      old_is_virgin_pending boolean := false;
      new_is_virgin_pending boolean := false;
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        old_is_virgin_pending :=
          OLD.review_status = 'pending'
          AND OLD.edited_by_admin = false
          AND OLD.reviewed_by IS NULL
          AND OLD.reviewed_at IS NULL
          AND OLD.review_action IS NULL
          AND OLD.review_version = 0;
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_is_virgin_pending :=
          NEW.review_status = 'pending'
          AND NEW.edited_by_admin = false
          AND NEW.reviewed_by IS NULL
          AND NEW.reviewed_at IS NULL
          AND NEW.review_action IS NULL
          AND NEW.review_version = 0;
      END IF;
      IF TG_OP = 'INSERT' AND new_is_virgin_pending THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE'
        AND old_is_virgin_pending
        AND new_is_virgin_pending
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED'
        USING ERRCODE = '42501';
    END
    $guard$;

    GRANT ALL ON TABLE
      public.vendors,
      public.agencies,
      public.price_snapshots,
      public.official_prices,
      public.official_price_options,
      public.official_agency_packages,
      public.test_public_prices_data
    TO service_role;
    GRANT SELECT ON public.v_public_prices TO service_role;

    INSERT INTO public.vendors (id, name, slug, category, status)
    VALUES
      (
        '30000000-0000-4000-8000-000000000001',
        'Sample Studio', 'sample-studio', 'studio', 'approved'
      ),
      (
        '30000000-0000-4000-8000-000000000002',
        'Other Studio', 'other-studio', 'studio', 'approved'
      );
    INSERT INTO public.test_public_prices_data (
      vendor_id, vendor_slug, vendor_name, category, aliases, is_current
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      'sample-studio', 'Sample Studio', 'studio',
      ARRAY['Sample Alias'], true
    );
    INSERT INTO public.agencies (id, name, slug, display_name)
    VALUES
      (
        '40000000-0000-4000-8000-000000000001',
        'Sample Agency', 'sample-agency', 'Sample Agency'
      ),
      (
        '40000000-0000-4000-8000-000000000002',
        'Other Agency', 'other-agency', 'Other Agency'
      );
    INSERT INTO public.price_snapshots (
      id, period_label, source, published_at, is_current, published
    ) VALUES
      (
        '${PUBLISHED_SNAPSHOT_ID}', '2026-Q2', 'kca_tprice',
        '2026-06-30', true, true
      ),
      (
        '${DRAFT_SNAPSHOT_ID}', '2026-Q3', 'kca_tprice',
        NULL, false, false
      ),
      (
        '${CLEANUP_DRAFT_SNAPSHOT_ID}', '2026-Q4', 'kca_tprice',
        NULL, false, false
      );
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, agency_id, category, item_name,
      review_status, needs_review, source_file, source_quote,
      source_object_keys, confidence, edited_by_admin, reviewed_by,
      reviewed_at, review_action, review_version
    ) VALUES
      (
        '${PUBLISHED_PRICE_ID}', '${PUBLISHED_SNAPSHOT_ID}',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'studio', 'Published price', 'approved', false,
        'source.pdf', 'published evidence', ARRAY['raw/source.pdf'], 0.95,
        true, '50000000-0000-4000-8000-000000000001', now(),
        'approve', 1
      ),
      (
        '${DRAFT_PRICE_ID}', '${DRAFT_SNAPSHOT_ID}',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'studio', 'Draft price', 'pending', true,
        NULL, NULL, '{}', NULL, false, NULL, NULL, NULL, 0
      ),
      (
        '${REVIEWED_DRAFT_PRICE_ID}', '${DRAFT_SNAPSHOT_ID}',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'studio', 'Reviewed draft price', 'approved', false,
        'source.pdf', 'reviewed evidence', ARRAY['raw/source.pdf'], 0.9,
        true, '50000000-0000-4000-8000-000000000001', now(),
        'approve', 1
      ),
      (
        '20000000-0000-4000-8000-000000000005',
        '${CLEANUP_DRAFT_SNAPSHOT_ID}', NULL, NULL,
        'studio', 'Cleanup draft price', 'pending', true,
        NULL, NULL, '{}', NULL, false, NULL, NULL, NULL, 0
      ),
      (
        '20000000-0000-4000-8000-000000000006',
        '${PUBLISHED_SNAPSHOT_ID}',
        '30000000-0000-4000-8000-000000000002', NULL,
        'studio', 'Direct published price', 'approved', false,
        'direct.pdf', 'direct evidence', ARRAY['raw/direct.pdf'], 0.9,
        true, '50000000-0000-4000-8000-000000000001', now(),
        'approve', 1
      );
    INSERT INTO public.official_price_options (
      id, official_price_id, name, source_quote, source_object_keys, confidence
    ) VALUES
      (
        '${PUBLISHED_OPTION_ID}', '${PUBLISHED_PRICE_ID}',
        'Published option', 'published option evidence',
        ARRAY['raw/source.pdf'], 0.95
      ),
      (
        '${DRAFT_OPTION_ID}', '${DRAFT_PRICE_ID}',
        'Draft option', NULL, '{}', NULL
      ),
      (
        '60000000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000005',
        'Cleanup draft option', NULL, '{}', NULL
      ),
      (
        '60000000-0000-4000-8000-000000000006',
        '20000000-0000-4000-8000-000000000006',
        'Direct published option', 'direct option evidence',
        ARRAY['raw/direct.pdf'], 0.9
      );
    UPDATE public.official_price_options
    SET raw_text = CASE id
      WHEN '${PUBLISHED_OPTION_ID}' THEN 'published option raw text'
      ELSE 'direct option raw text'
    END
    WHERE id IN (
      '${PUBLISHED_OPTION_ID}',
      '60000000-0000-4000-8000-000000000006'
    );
    INSERT INTO public.official_agency_packages (
      id, snapshot_id, agency_id, package_name,
      review_status, needs_review, source_file, source_quote,
      source_object_keys, confidence, edited_by_admin, reviewed_by,
      reviewed_at, review_action, review_version
    ) VALUES
      (
        '${PUBLISHED_PACKAGE_ID}', '${PUBLISHED_SNAPSHOT_ID}',
        '40000000-0000-4000-8000-000000000001', 'Published package',
        'approved', false, 'source.pdf', 'published package evidence',
        ARRAY['raw/source.pdf'], 0.95, true,
        '50000000-0000-4000-8000-000000000001', now(), 'approve', 1
      ),
      (
        '${DRAFT_PACKAGE_ID}', '${DRAFT_SNAPSHOT_ID}',
        '40000000-0000-4000-8000-000000000001', 'Draft package',
        'pending', true, NULL, NULL, '{}', NULL, false,
        NULL, NULL, NULL, 0
      ),
      (
        '${REVIEWED_DRAFT_PACKAGE_ID}', '${DRAFT_SNAPSHOT_ID}',
        '40000000-0000-4000-8000-000000000001', 'Reviewed draft package',
        'approved', false, 'source.pdf', 'reviewed package evidence',
        ARRAY['raw/source.pdf'], 0.9, true,
        '50000000-0000-4000-8000-000000000001', now(), 'approve', 1
      ),
      (
        '70000000-0000-4000-8000-000000000005',
        '${CLEANUP_DRAFT_SNAPSHOT_ID}',
        '40000000-0000-4000-8000-000000000001', 'Cleanup draft package',
        'pending', true, NULL, NULL, '{}', NULL, false,
        NULL, NULL, NULL, 0
      );

    CREATE TRIGGER official_prices_parent_review_write_fence
    BEFORE INSERT OR UPDATE OF item_name OR DELETE
    ON public.official_prices
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_official_review_parent_write();

    CREATE TRIGGER official_agency_packages_parent_review_write_fence
    BEFORE INSERT OR UPDATE OF package_name OR DELETE
    ON public.official_agency_packages
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_official_review_parent_write();
  `);
  await db.exec(`
    CREATE FUNCTION public.promote_price_snapshot(
      p_snapshot_id uuid,
      p_actor_id uuid
    )
    RETURNS public.price_snapshots
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $promote$
    DECLARE
      target_source text;
      promoted public.price_snapshots%ROWTYPE;
    BEGIN
      SELECT source
      INTO target_source
      FROM public.price_snapshots
      WHERE id = p_snapshot_id
      FOR UPDATE;

      IF target_source IS NULL THEN
        RAISE EXCEPTION 'PRICE_SNAPSHOT_NOT_FOUND';
      END IF;

      UPDATE public.price_snapshots
      SET is_current = false
      WHERE source = target_source
        AND id <> p_snapshot_id
        AND is_current IS TRUE;

      UPDATE public.price_snapshots
      SET is_current = true
      WHERE id = p_snapshot_id
      RETURNING * INTO promoted;

      RETURN promoted;
    END
    $promote$;
    REVOKE ALL ON FUNCTION public.promote_price_snapshot(uuid, uuid)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.promote_price_snapshot(uuid, uuid)
      TO service_role;

    CREATE FUNCTION public.guard_price_snapshot_current_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $guard_current$
    DECLARE
      promotion_owner text;
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.is_current IS FALSE THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' AND OLD.is_current IS FALSE THEN
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE'
        AND NEW.is_current IS NOT DISTINCT FROM OLD.is_current
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
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END
    $guard_current$;
    REVOKE ALL ON FUNCTION public.guard_price_snapshot_current_write()
      FROM PUBLIC, anon, authenticated, service_role;

    CREATE FUNCTION public.mark_price_snapshot_published()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $mark_published$
    BEGIN
      IF NEW.is_current IS TRUE
        AND (TG_OP = 'INSERT' OR OLD.is_current IS DISTINCT FROM TRUE)
      THEN
        NEW.published := true;
        NEW.published_at := COALESCE(NEW.published_at, CURRENT_DATE);
      END IF;
      RETURN NEW;
    END
    $mark_published$;
    REVOKE ALL ON FUNCTION public.mark_price_snapshot_published()
      FROM PUBLIC, anon, authenticated, service_role;

    CREATE FUNCTION public.guard_price_snapshot_publication_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $guard_publication$
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
    $guard_publication$;
    REVOKE ALL ON FUNCTION public.guard_price_snapshot_publication_write()
      FROM PUBLIC, anon, authenticated, service_role;

    CREATE TRIGGER price_snapshot_current_write_fence
    BEFORE INSERT OR UPDATE OF is_current, source OR DELETE
    ON public.price_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_price_snapshot_current_write();

    CREATE TRIGGER price_snapshot_mark_published
    BEFORE INSERT OR UPDATE OF is_current
    ON public.price_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION public.mark_price_snapshot_published();

    CREATE TRIGGER price_snapshot_publication_write_fence
    BEFORE INSERT OR UPDATE OF published, published_at
    ON public.price_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_price_snapshot_publication_write();
  `);
  if (options.invalidPublishedVendorSlug) {
    await db.exec(`
      UPDATE public.vendors
      SET slug = 'Invalid Published Slug'
      WHERE id = '30000000-0000-4000-8000-000000000001'
    `);
  }
  if (options.missingLegacyTrigger) {
    await db.exec(`
      DROP TRIGGER ${options.missingLegacyTrigger}
      ON public.price_snapshots
    `);
  }
  if (options.legacySource) {
    await db.exec(`
      INSERT INTO public.price_snapshots (
        id, period_label, source, published, is_current
      ) VALUES (
        '10000000-0000-4000-8000-000000000099', 'legacy-source',
        '${options.legacySource.replaceAll("'", "''")}', false, false
      )
    `);
  }
  try {
    await db.exec(publicationImmutabilityMigration);
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}

describe("published price snapshot immutability", () => {
  it("rejects an in-place update to a historical published price", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        UPDATE public.official_prices
        SET item_name = 'tampered'
        WHERE id = '${PUBLISHED_PRICE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects every direct mutation and cross-snapshot move of published options", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        INSERT INTO public.official_price_options (
          id, official_price_id, name
        ) VALUES (
          '60000000-0000-4000-8000-000000000003',
          '${PUBLISHED_PRICE_ID}', 'Injected option'
        )
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_price_options
        SET name = 'tampered'
        WHERE id = '${PUBLISHED_OPTION_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_price_options
        SET official_price_id = '${DRAFT_PRICE_ID}'
        WHERE id = '${PUBLISHED_OPTION_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_price_options
        SET official_price_id = '${PUBLISHED_PRICE_ID}'
        WHERE id = '${DRAFT_OPTION_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        DELETE FROM public.official_price_options
        WHERE id = '${PUBLISHED_OPTION_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects inserts, updates, deletes, and both move directions for published parents", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, agency_id, package_name
        ) VALUES (
          '70000000-0000-4000-8000-000000000003',
          '${PUBLISHED_SNAPSHOT_ID}',
          '40000000-0000-4000-8000-000000000001', 'Injected package'
        )
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET package_name = 'tampered'
        WHERE id = '${PUBLISHED_PACKAGE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET snapshot_id = '${DRAFT_SNAPSHOT_ID}'
        WHERE id = '${PUBLISHED_PACKAGE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET snapshot_id = '${PUBLISHED_SNAPSHOT_ID}'
        WHERE id = '${DRAFT_PACKAGE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        DELETE FROM public.official_agency_packages
        WHERE id = '${PUBLISHED_PACKAGE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name
        ) VALUES (
          '20000000-0000-4000-8000-000000000003',
          '${PUBLISHED_SNAPSHOT_ID}', 'studio', 'Injected price'
        )
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET snapshot_id = '${DRAFT_SNAPSHOT_ID}'
        WHERE id = '${PUBLISHED_PRICE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET snapshot_id = '${PUBLISHED_SNAPSHOT_ID}'
        WHERE id = '${DRAFT_PRICE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
      await expect(db.exec(`
        DELETE FROM public.official_prices
        WHERE id = '${PUBLISHED_PRICE_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_CHILD_IMMUTABLE/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("makes publication history monotonic", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.price_snapshots
        ADD COLUMN future_evidence_note text
      `);
      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET published = false
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(
        /PRICE_SNAPSHOT_(?:PUBLISHED_IMMUTABLE|PROMOTION_RPC_REQUIRED)/u
      );
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET published_at = '2026-07-01'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(
        /PRICE_SNAPSHOT_(?:PUBLISHED_IMMUTABLE|PROMOTION_RPC_REQUIRED)/u
      );
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET period_label = 'tampered-period'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET source_note = 'tampered source note'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET source_url = 'https://invalid.example/tampered'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET collected_at = now()
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET created_at = created_at + interval '1 second'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET future_evidence_note = 'tampered future column'
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PUBLISHED_IMMUTABLE/u);
      await expect(db.exec(`
        DELETE FROM public.price_snapshots
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(
        /PRICE_SNAPSHOT_(?:PUBLISHED_IMMUTABLE|PROMOTION_RPC_REQUIRED)/u
      );

    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps publication fenced even if every legacy publication trigger drifts away", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.price_snapshots
          DISABLE TRIGGER price_snapshot_current_write_fence;
        ALTER TABLE public.price_snapshots
          DISABLE TRIGGER price_snapshot_publication_write_fence;
        ALTER TABLE public.price_snapshots
          DISABLE TRIGGER price_snapshot_mark_published;
      `);
      await db.exec("SET ROLE service_role;");

      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET published = true,
            published_at = CURRENT_DATE
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = false
        WHERE id = '${PUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
      await expect(db.exec(`
        INSERT INTO public.price_snapshots (
          id, period_label, source, published_at, is_current, published
        ) VALUES (
          '10000000-0000-4000-8000-000000000020',
          '2028-Q1', 'kca_tprice', CURRENT_DATE, false, true
        )
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("still permits the security-definer promotion path", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const promoted = await db.query<{
        is_current: boolean;
        published: boolean;
      }>(`
        SELECT
          (result).is_current,
          (result).published
        FROM (
          SELECT public.promote_price_snapshot(
            '${DRAFT_SNAPSHOT_ID}',
            '50000000-0000-4000-8000-000000000001'
          ) AS result
        ) AS promotion
      `);
      expect(promoted.rows).toEqual([{
        is_current: true,
        published: true,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("covers ownership columns while retaining virgin draft reassignment", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      await db.exec(`
        UPDATE public.official_prices
        SET vendor_id = '30000000-0000-4000-8000-000000000002',
            agency_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '${DRAFT_PRICE_ID}'
      `);
      await db.exec(`
        UPDATE public.official_agency_packages
        SET agency_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '${DRAFT_PACKAGE_ID}'
      `);

      await expect(db.exec(`
        UPDATE public.official_prices
        SET vendor_id = '30000000-0000-4000-8000-000000000002'
        WHERE id = '${REVIEWED_DRAFT_PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET agency_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '${REVIEWED_DRAFT_PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET agency_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '${REVIEWED_DRAFT_PACKAGE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("fails publication when approved rows reference a non-public vendor or agency", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.vendors
        SET status = 'pending'
        WHERE id = '30000000-0000-4000-8000-000000000001'
      `);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_VENDOR_NOT_PUBLIC/u);

      await db.exec(`
        UPDATE public.vendors
        SET status = 'approved', slug = 'Invalid Slug'
        WHERE id = '30000000-0000-4000-8000-000000000001'
      `);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_VENDOR_NOT_PUBLIC/u);

      await db.exec(`
        UPDATE public.vendors
        SET slug = 'sample-studio'
        WHERE id = '30000000-0000-4000-8000-000000000001';
        UPDATE public.agencies
        SET is_active = false
        WHERE id = '40000000-0000-4000-8000-000000000001';
      `);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_AGENCY_NOT_PUBLIC/u);

      await db.exec(`
        UPDATE public.agencies
        SET is_active = true,
            merged_into_agency_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '40000000-0000-4000-8000-000000000001';
      `);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_AGENCY_NOT_PUBLIC/u);

      await db.exec(`
        UPDATE public.agencies
        SET merged_into_agency_id = NULL
        WHERE id = '40000000-0000-4000-8000-000000000001';
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${DRAFT_SNAPSHOT_ID}';
      `);
      const state = await db.query<{ is_current: boolean }>(`
        SELECT is_current
        FROM public.price_snapshots
        WHERE id = '${DRAFT_SNAPSHOT_ID}'
      `);
      expect(state.rows).toEqual([{ is_current: true }]);
    } finally {
      await db.close();
    }
  });

  it("resolves pg_trgm from its installed extension schema for both lookup RPCs", async () => {
    const db = await createDatabase();
    try {
      const publicSimilarity = await db.query<{ function_oid: string | null }>(`
        SELECT to_regprocedure('public.similarity(text,text)')::text
          AS function_oid
      `);
      expect(publicSimilarity.rows).toEqual([{ function_oid: null }]);

      await db.exec("SET ROLE service_role;");
      const uploadMatches = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id
        FROM public.match_vendor_for_price_upload('Sample Studio', 'studio')
      `);
      const publicMatches = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id
        FROM public.lookup_public_price_vendors('Sample Studio', 'studio', 3)
      `);
      expect(uploadMatches.rows.map((row) => row.vendor_id)).toContain(
        '30000000-0000-4000-8000-000000000001'
      );
      expect(publicMatches.rows.map((row) => row.vendor_id)).toContain(
        '30000000-0000-4000-8000-000000000001'
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("returns a published vendor for a one-character typo through the internal lookup RPC", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const matches = await db.query<{
        vendor_id: string;
        vendor_name: string;
        similarity: number;
      }>(`
        SELECT vendor_id, vendor_name, similarity
        FROM public.lookup_public_price_vendors('Sample Studo', 'studio', 3)
      `);

      expect(matches.rows).toHaveLength(1);
      expect(matches.rows[0]).toMatchObject({
        vendor_id: "30000000-0000-4000-8000-000000000001",
        vendor_name: "Sample Studio",
      });
      expect(matches.rows[0]!.similarity).toBeGreaterThanOrEqual(0.3);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("removes inactive or merged agencies from every public price projection", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.agencies
        SET is_active = false
        WHERE id = '40000000-0000-4000-8000-000000000001'
      `);
      const visibility = await db.query<{
        official_price: boolean;
        official_option: boolean;
        agency_package: boolean;
        consumer_price: boolean;
        consumer_option: boolean;
        direct_price: boolean;
        direct_option: boolean;
      }>(`
        SELECT
          EXISTS (
            SELECT 1 FROM public.v_public_official_prices
            WHERE id = '${PUBLISHED_PRICE_ID}'
          ) AS official_price,
          EXISTS (
            SELECT 1 FROM public.v_public_official_price_options
            WHERE id = '${PUBLISHED_OPTION_ID}'
          ) AS official_option,
          EXISTS (
            SELECT 1 FROM public.v_public_agency_packages
            WHERE id = '${PUBLISHED_PACKAGE_ID}'
          ) AS agency_package,
          EXISTS (
            SELECT 1 FROM public.v_public_prices
            WHERE official_price_id = '${PUBLISHED_PRICE_ID}'
          ) AS consumer_price,
          EXISTS (
            SELECT 1 FROM public.v_public_price_options
            WHERE id = '${PUBLISHED_OPTION_ID}'
          ) AS consumer_option,
          EXISTS (
            SELECT 1 FROM public.v_public_prices
            WHERE official_price_id = '20000000-0000-4000-8000-000000000006'
          ) AS direct_price,
          EXISTS (
            SELECT 1 FROM public.v_public_price_options
            WHERE id = '60000000-0000-4000-8000-000000000006'
          ) AS direct_option
      `);
      expect(visibility.rows).toEqual([{
        official_price: false,
        official_option: false,
        agency_package: false,
        consumer_price: false,
        consumer_option: false,
        direct_price: true,
        direct_option: true,
      }]);
    } finally {
      await db.close();
    }
  });

  it("removes invalid vendor identities from every public price projection", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.vendors
        SET slug = 'Invalid Published Slug'
        WHERE id = '30000000-0000-4000-8000-000000000001'
      `);
      const visibility = await db.query<{
        consumer_option: boolean;
        consumer_price: boolean;
        official_option: boolean;
        official_price: boolean;
      }>(`
        SELECT
          EXISTS (
            SELECT 1 FROM public.v_public_official_prices
            WHERE id = '${PUBLISHED_PRICE_ID}'
          ) AS official_price,
          EXISTS (
            SELECT 1 FROM public.v_public_official_price_options
            WHERE id = '${PUBLISHED_OPTION_ID}'
          ) AS official_option,
          EXISTS (
            SELECT 1 FROM public.v_public_prices
            WHERE official_price_id = '${PUBLISHED_PRICE_ID}'
          ) AS consumer_price,
          EXISTS (
            SELECT 1 FROM public.v_public_price_options
            WHERE id = '${PUBLISHED_OPTION_ID}'
          ) AS consumer_option
      `);
      expect(visibility.rows).toEqual([{
        consumer_option: false,
        consumer_price: false,
        official_option: false,
        official_price: false,
      }]);
    } finally {
      await db.close();
    }
  });

  it("accepts only the three supported snapshot source values", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots (
          id, period_label, source, published, is_current
        ) VALUES
          ('10000000-0000-4000-8000-000000000010', '2027-Q1',
           'agency_site', false, false),
          ('10000000-0000-4000-8000-000000000011', '2027-Q2',
           'mixed', false, false)
      `);
      await expect(db.exec(`
        INSERT INTO public.price_snapshots (
          id, period_label, source, published, is_current
        ) VALUES (
          '10000000-0000-4000-8000-000000000012', '2027-Q3',
          'operator_typo', false, false
        )
      `)).rejects.toThrow(/price_snapshots_source_check/iu);
    } finally {
      await db.close();
    }
  });

  it("fails the migration before DDL when legacy snapshot sources are unsupported", async () => {
    await expect(createDatabase({ legacySource: "legacy_import" }))
      .rejects.toThrow(/PRICE_SNAPSHOT_SOURCE_LEGACY_VALUES_FOUND/u);
  });

  it("fails before DDL when a published price has a non-public vendor identity", async () => {
    await expect(createDatabase({ invalidPublishedVendorSlug: true }))
      .rejects.toThrow(/PRICE_SNAPSHOT_PUBLIC_VENDOR_LEGACY_VALUES_FOUND/u);
  });

  it.each<LegacyPublicationTrigger>([
    "price_snapshot_current_write_fence",
    "price_snapshot_publication_write_fence",
    "price_snapshot_mark_published",
  ])("fails closed when the prior %s trigger is missing", async (triggerName) => {
    await expect(createDatabase({ missingLegacyTrigger: triggerName }))
      .rejects.toThrow(/PRICE_PUBLICATION_IMMUTABILITY_POSTCONDITION_FAILED/u);
  });

  it("locks snapshots exclusively before the older review trigger can upgrade the lock", () => {
    const childGuard = publicationImmutabilityMigration.match(
      /AS \$guard_published_price_snapshot_child_write\$([\s\S]*?)\$guard_published_price_snapshot_child_write\$;/u
    )?.[1];
    expect(childGuard).toBeDefined();
    expect(childGuard).toMatch(
      /FROM public\.price_snapshots AS snapshot[\s\S]*?WHERE snapshot\.id IN \(old_snapshot_id, new_snapshot_id\)[\s\S]*?ORDER BY snapshot\.id\s+FOR UPDATE/u
    );
  });

  it("uses the same approved vendor and slug boundary in every price view", () => {
    const positiveSlugPredicates = publicationImmutabilityMigration.match(
      /vendor\.slug ~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,119\}\$'/gu
    ) ?? [];
    expect(positiveSlugPredicates).toHaveLength(4);
  });

  it("is replay-safe with complete triggers, pinned search paths, and private helpers", async () => {
    const db = await createDatabase();
    try {
      await db.exec(publicationImmutabilityMigration);
      const catalog = await db.query<{
        parent_trigger_count: number;
        incomplete_parent_trigger_count: number;
        child_trigger_count: number;
        incomplete_snapshot_trigger_count: number;
        private_helper_leaks: number;
        unsafe_search_paths: number;
        source_constraint_validated: boolean;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger_row
            WHERE trigger_row.tgname IN (
              'official_prices_parent_review_write_fence',
              'official_agency_packages_parent_review_write_fence'
            )
              AND trigger_row.tgenabled = 'O'
          ) AS parent_trigger_count,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger_row
            WHERE trigger_row.tgname IN (
              'official_prices_parent_review_write_fence',
              'official_agency_packages_parent_review_write_fence'
            )
              AND pg_catalog.pg_get_triggerdef(trigger_row.oid) LIKE '%UPDATE OF%'
          ) AS incomplete_parent_trigger_count,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger_row
            WHERE trigger_row.tgname IN (
              'official_prices_00_published_immutability_fence',
              'official_price_options_00_published_immutability_fence',
              'official_agency_packages_00_published_immutability_fence',
              'price_snapshots_00_published_immutability_fence',
              'price_snapshots_10_public_identity_fence'
            )
              AND trigger_row.tgenabled = 'O'
          ) AS child_trigger_count,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger_row
            WHERE trigger_row.tgname =
              'price_snapshots_00_published_immutability_fence'
              AND pg_catalog.pg_get_triggerdef(trigger_row.oid) LIKE '%UPDATE OF%'
          ) AS incomplete_snapshot_trigger_count,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_proc AS function_row
            WHERE function_row.oid IN (
              'public.guard_published_price_snapshot_child_write()'::regprocedure,
              'public.guard_published_price_snapshot_history_write()'::regprocedure,
              'public.assert_price_snapshot_public_identities()'::regprocedure,
              'public.price_trigram_similarity(text,text)'::regprocedure
            )
              AND (
                has_function_privilege('anon', function_row.oid, 'EXECUTE')
                OR has_function_privilege(
                  'authenticated', function_row.oid, 'EXECUTE'
                )
                OR has_function_privilege(
                  'service_role', function_row.oid, 'EXECUTE'
                )
              )
          ) AS private_helper_leaks,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_proc AS function_row
            WHERE function_row.oid IN (
              'public.guard_published_price_snapshot_child_write()'::regprocedure,
              'public.guard_published_price_snapshot_history_write()'::regprocedure,
              'public.assert_price_snapshot_public_identities()'::regprocedure,
              'public.price_trigram_similarity(text,text)'::regprocedure,
              'public.match_vendor_for_price_upload(text,text)'::regprocedure,
              'public.lookup_public_price_vendors(text,text,integer)'::regprocedure
            )
              AND NOT (
                function_row.proconfig @>
                  ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
              )
          ) AS unsafe_search_paths,
          (
            SELECT constraint_row.convalidated
            FROM pg_catalog.pg_constraint AS constraint_row
            WHERE constraint_row.conrelid = 'public.price_snapshots'::regclass
              AND constraint_row.conname = 'price_snapshots_source_check'
          ) AS source_constraint_validated
      `);
      expect(catalog.rows).toEqual([{
        parent_trigger_count: 2,
        incomplete_parent_trigger_count: 0,
        child_trigger_count: 5,
        incomplete_snapshot_trigger_count: 0,
        private_helper_leaks: 0,
        unsafe_search_paths: 0,
        source_constraint_validated: true,
      }]);
    } finally {
      await db.close();
    }
  });
});
