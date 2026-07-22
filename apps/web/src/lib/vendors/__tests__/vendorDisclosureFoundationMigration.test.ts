// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const publicColumnPrivilegeHotfix = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718120000_vendor_public_column_privilege_hotfix.sql"
  ),
  "utf8"
);

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718130000_vendor_disclosure_foundation.sql"
  ),
  "utf8"
);

const snapshotPromotionMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718150000_price_snapshot_promotion.sql"
  ),
  "utf8"
);

const priceConsumerMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718190000_price_consumer_contract.sql"
  ),
  "utf8"
);

async function createBaselineDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

    CREATE SCHEMA storage;
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

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
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

    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_category_check
      CHECK (category IN (
        'studio', 'dress', 'makeup', 'package', 'snap', 'dvd', 'hanbok',
        'suit', 'jewelry', 'invitation', 'venue', 'honeymoon', 'other'
      ));
    GRANT SELECT ON public.vendors TO anon, authenticated;

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
  `);
  return db;
}

async function createLegacyDisclosureDatabase() {
  const db = await createBaselineDatabase();
  await db.exec(`
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL
    );
    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      period_label text NOT NULL,
      source text NOT NULL DEFAULT 'kca_tprice',
      source_url text,
      published_at date,
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
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
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id) ON DELETE CASCADE,
      name text NOT NULL,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      anon_id text NOT NULL,
      vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
      surface text NOT NULL,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(migration);
}

describe("vendor disclosure foundation migration", () => {
  it("denies every direct vendor base-table projection before the V2 foundation is deployed", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        INSERT INTO public.vendors (
          id, owner_id, name, category, status, is_verified, website,
          bank_name, account_number, account_holder
        ) VALUES (
          '40000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000099',
          'Hotfix vendor', 'studio', 'approved', true, 'https://vendor.example',
          'Sensitive Bank', '123-456-789', 'Private Holder'
        )
      `);

      // The emergency migration is independently replay-safe.
      await db.exec(publicColumnPrivilegeHotfix);
      await db.exec(publicColumnPrivilegeHotfix);

      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role};`);
        await expect(db.query("SELECT id FROM public.vendors")).rejects.toThrow();
        await expect(db.query(`
          SELECT id, name, is_verified, website
          FROM public.vendors
        `)).rejects.toThrow();
        await expect(db.query("SELECT * FROM public.vendors")).rejects.toThrow();
        await expect(db.query(`
          SELECT owner_id, bank_name, account_number, account_holder
          FROM public.vendors
        `)).rejects.toThrow();
        await db.exec("RESET ROLE;");
      }
      const exposedColumns = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns AS column_row
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[]) AS role_name
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = 'vendors'
          AND has_column_privilege(
            role_name,
            'public.vendors',
            column_row.column_name,
            'SELECT'
          )
      `);
      expect(exposedColumns.rows[0]?.count).toBe(0);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps public and owner child-table RLS working without exposing vendor ownership", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        CREATE TABLE public.vendor_products (
          id uuid PRIMARY KEY,
          vendor_id uuid NOT NULL REFERENCES public.vendors(id),
          name text NOT NULL,
          is_active boolean NOT NULL DEFAULT true
        );
        ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON public.vendor_products TO anon, authenticated;

        CREATE TABLE public.vendor_settlements (
          id uuid PRIMARY KEY,
          vendor_id uuid NOT NULL REFERENCES public.vendors(id),
          amount_krw integer NOT NULL
        );
        ALTER TABLE public.vendor_settlements ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON public.vendor_settlements TO authenticated;
        CREATE POLICY vendor_settlements_select
          ON public.vendor_settlements FOR SELECT
          USING (vendor_id IN (
            SELECT vendors.id
            FROM public.vendors
            WHERE vendors.owner_id = auth.uid()
          ));

        CREATE POLICY "공개: 활성 상품 조회"
          ON public.vendor_products FOR SELECT
          USING (
            is_active = true
            AND EXISTS (
              SELECT 1 FROM public.vendors
              WHERE vendors.id = vendor_products.vendor_id
                AND vendors.status = 'approved'
            )
          );
        CREATE POLICY "업체: 본인 상품 조회"
          ON public.vendor_products FOR SELECT
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY "업체: 본인 상품 추가"
          ON public.vendor_products FOR INSERT
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY "업체: 본인 상품 수정"
          ON public.vendor_products FOR UPDATE
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY "업체: 본인 상품 삭제"
          ON public.vendor_products FOR DELETE
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY vendor_products_select
          ON public.vendor_products FOR SELECT
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND (
                vendors.status = 'approved'
                OR vendors.owner_id = auth.uid()
              )
          ));
        CREATE POLICY vendor_products_insert
          ON public.vendor_products FOR INSERT
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY vendor_products_update
          ON public.vendor_products FOR UPDATE
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
        CREATE POLICY vendor_products_delete
          ON public.vendor_products FOR DELETE
          USING (EXISTS (
            SELECT 1 FROM public.vendors
            WHERE vendors.id = vendor_products.vendor_id
              AND vendors.owner_id = auth.uid()
          ));

        INSERT INTO public.vendors (id, owner_id, name, category, status)
        VALUES
          (
            '40100000-0000-4000-8000-000000000001',
            '40100000-0000-4000-8000-000000000091',
            'Approved vendor', 'studio', 'approved'
          ),
          (
            '40100000-0000-4000-8000-000000000002',
            '40100000-0000-4000-8000-000000000091',
            'Owner pending vendor', 'studio', 'pending'
          ),
          (
            '40100000-0000-4000-8000-000000000003',
            '40100000-0000-4000-8000-000000000092',
            'Other pending vendor', 'studio', 'pending'
          );
        INSERT INTO public.vendor_products (id, vendor_id, name)
        VALUES
          (
            '40200000-0000-4000-8000-000000000001',
            '40100000-0000-4000-8000-000000000001',
            'Public product'
          ),
          (
            '40200000-0000-4000-8000-000000000002',
            '40100000-0000-4000-8000-000000000002',
            'Owner pending product'
          ),
          (
            '40200000-0000-4000-8000-000000000003',
            '40100000-0000-4000-8000-000000000003',
            'Other pending product'
          );
        INSERT INTO public.vendor_settlements (id, vendor_id, amount_krw)
        VALUES
          (
            '40300000-0000-4000-8000-000000000001',
            '40100000-0000-4000-8000-000000000002',
            100000
          ),
          (
            '40300000-0000-4000-8000-000000000002',
            '40100000-0000-4000-8000-000000000003',
            200000
          );
      `);

      await db.exec(publicColumnPrivilegeHotfix);
      await db.exec(publicColumnPrivilegeHotfix);

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '', false);
        SET ROLE anon;
      `);
      const publicProducts = await db.query<{ name: string }>(`
        SELECT name FROM public.vendor_products ORDER BY name
      `);
      expect(publicProducts.rows.map(({ name }) => name)).toEqual([
        "Public product",
      ]);
      const anonymousChecks = await db.query<{
        owns_vendor: boolean;
        public_vendor: boolean;
        pending_vendor: boolean;
      }>(`
        SELECT
          public.is_vendor_owner(
            '40100000-0000-4000-8000-000000000001'
          ) AS owns_vendor,
          public.is_vendor_public(
            '40100000-0000-4000-8000-000000000001'
          ) AS public_vendor,
          public.is_vendor_public(
            '40100000-0000-4000-8000-000000000002'
          ) AS pending_vendor
      `);
      expect(anonymousChecks.rows[0]).toEqual({
        owns_vendor: false,
        public_vendor: true,
        pending_vendor: false,
      });
      await db.exec("RESET ROLE;");

      await db.exec(`
        SELECT set_config(
          'request.jwt.claim.sub',
          '40100000-0000-4000-8000-000000000091',
          false
        );
        SET ROLE authenticated;
      `);
      const ownerProducts = await db.query<{ name: string }>(`
        SELECT name FROM public.vendor_products ORDER BY name
      `);
      expect(ownerProducts.rows.map(({ name }) => name)).toEqual([
        "Owner pending product",
        "Public product",
      ]);
      const ownerSettlements = await db.query<{ amount_krw: number }>(`
        SELECT amount_krw FROM public.vendor_settlements ORDER BY amount_krw
      `);
      expect(ownerSettlements.rows).toEqual([{ amount_krw: 100000 }]);
      await db.exec(`
        INSERT INTO public.vendor_products (id, vendor_id, name)
        VALUES (
          '40200000-0000-4000-8000-000000000004',
          '40100000-0000-4000-8000-000000000002',
          'Owner-created product'
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.vendor_products (id, vendor_id, name)
        VALUES (
          '40200000-0000-4000-8000-000000000005',
          '40100000-0000-4000-8000-000000000003',
          'Forbidden product'
        )
      `)).rejects.toThrow();
      await expect(
        db.query("SELECT owner_id FROM public.vendors")
      ).rejects.toThrow();
      const ownerCheck = await db.query<{ owns_vendor: boolean }>(`
        SELECT public.is_vendor_owner(
          '40100000-0000-4000-8000-000000000002'
        ) AS owns_vendor
      `);
      expect(ownerCheck.rows[0]?.owns_vendor).toBe(true);
      await db.exec("RESET ROLE;");

      await db.exec(`
        SELECT set_config(
          'request.jwt.claim.sub',
          '40100000-0000-4000-8000-000000000092',
          false
        );
        SET ROLE authenticated;
      `);
      const otherProducts = await db.query<{ name: string }>(`
        SELECT name FROM public.vendor_products ORDER BY name
      `);
      expect(otherProducts.rows.map(({ name }) => name)).toEqual([
        "Other pending product",
        "Public product",
      ]);
      await db.exec("RESET ROLE;");

      const unsafePolicies = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_catalog.pg_policy AS policy
        WHERE COALESCE(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
          ''
        ) ~ '(^|[^[:alnum:]_])vendors([^[:alnum:]_]|$)'
          OR COALESCE(
            pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
            ''
          ) ~ '(^|[^[:alnum:]_])vendors([^[:alnum:]_]|$)'
      `);
      expect(unsafePolicies.rows[0]?.count).toBe(0);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls the hotfix back when an unhandled child policy still reads private vendor columns", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        CREATE TABLE public.unmapped_vendor_children (
          id uuid PRIMARY KEY,
          vendor_id uuid NOT NULL REFERENCES public.vendors(id)
        );
        ALTER TABLE public.unmapped_vendor_children ENABLE ROW LEVEL SECURITY;
        CREATE POLICY unmapped_owner_policy
          ON public.unmapped_vendor_children FOR SELECT
          USING (EXISTS (
            SELECT 1
            FROM public.vendors
            WHERE vendors.id = unmapped_vendor_children.vendor_id
              AND vendors.owner_id = auth.uid()
          ));
      `);

      await expect(db.exec(publicColumnPrivilegeHotfix)).rejects.toThrow(
        /VENDOR_PRIVATE_COLUMN_POLICY_REFERENCE_REMAINS/
      );
      await db.exec("ROLLBACK;");

      const rollbackState = await db.query<{
        broad_select_preserved: boolean;
        helper_missing: boolean;
      }>(`
        SELECT
          has_table_privilege('anon', 'public.vendors', 'SELECT')
            AS broad_select_preserved,
          to_regprocedure('public.is_vendor_owner(uuid)') IS NULL
            AS helper_missing
      `);
      expect(rollbackState.rows[0]).toEqual({
        broad_select_preserved: true,
        helper_missing: true,
      });
    } finally {
      await db.exec("ROLLBACK;").catch(() => undefined);
      await db.close();
    }
  });

  it("creates the disclosure foundation and extends vendors without mutating rows", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        INSERT INTO public.vendors (name, category, status)
        VALUES ('기존 스튜디오', 'studio', 'approved')
      `);

      await applyMigration(db);

      const tables = await db.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'agencies', 'price_snapshots', 'official_prices',
            'official_price_options', 'official_agency_packages',
            'events', 'tags', 'vendor_tags', 'vendor_enrichment_private'
            , 'vendor_dedupe_candidates', 'agency_dedupe_candidates'
          )
        ORDER BY table_name
      `);
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
        "agencies",
        "agency_dedupe_candidates",
        "events",
        "official_agency_packages",
        "official_price_options",
        "official_prices",
        "price_snapshots",
        "tags",
        "vendor_dedupe_candidates",
        "vendor_enrichment_private",
        "vendor_tags",
      ]);

      const vendor = await db.query<{
        count: number;
        attributes: Record<string, unknown>;
        enrichment_status: string;
      }>(`
        SELECT
          count(*) OVER ()::int AS count,
          attributes,
          enrichment_status
        FROM public.vendors
      `);
      expect(vendor.rows[0]).toEqual({
        count: 1,
        attributes: {},
        enrichment_status: "pending",
      });
    } finally {
      await db.close();
    }
  });

  it("rolls back every schema and data change when the migration transaction fails", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        INSERT INTO public.vendors (name, category, status, website)
        VALUES ('롤백 보존 업체', 'studio', 'approved', 'https://legacy.example')
      `);
      const forcedFailure = migration.replace(
        /COMMIT;\s*$/,
        "SELECT 1 / 0;\nCOMMIT;"
      );
      await expect(db.exec(forcedFailure)).rejects.toThrow();
      await db.exec("ROLLBACK;");

      const addedColumns = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vendors'
          AND column_name IN ('slug', 'official_url', 'attributes')
      `);
      expect(addedColumns.rows[0]?.count).toBe(0);
      const addedTables = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('official_prices', 'tags', 'vendor_enrichment_private')
      `);
      expect(addedTables.rows[0]?.count).toBe(0);
      const vendor = await db.query<{ name: string; website: string }>(`
        SELECT name, website FROM public.vendors
      `);
      expect(vendor.rows).toEqual([{
        name: "롤백 보존 업체",
        website: "https://legacy.example",
      }]);
    } finally {
      await db.close();
    }
  });

  it("expands a compatible first-pass disclosure schema with provenance", async () => {
    const db = await createLegacyDisclosureDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('91000000-0000-4000-8000-000000000001', 'legacy');
        INSERT INTO public.official_prices (
          snapshot_id, category, item_name, review_status, needs_review
        ) VALUES (
          '91000000-0000-4000-8000-000000000001',
          'studio', '기존 승인 행', 'approved', false
        );
      `);
      await applyMigration(db);
      const columns = await db.query<{ table_name: string; column_name: string }>(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (
              table_name = 'agencies'
              AND column_name IN (
                'normalized_name', 'corporate_name', 'region_code',
                'source_file', 'created_at', 'updated_at'
              )
            )
            OR (
              table_name IN ('official_prices', 'official_price_options')
              AND column_name IN ('source_file', 'source_quote', 'confidence')
            )
            OR (
              table_name IN (
                'official_prices', 'official_price_options',
                'official_agency_packages'
              )
              AND column_name = 'source_object_keys'
            )
          )
        ORDER BY table_name, column_name
      `);
      expect(columns.rows).toHaveLength(15);
      const legacyPublic = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.v_public_official_prices
      `);
      expect(legacyPublic.rows[0]?.count).toBe(0);
      const provenanceConstraint = await db.query<{ convalidated: boolean }>(`
        SELECT convalidated
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.official_prices'::regclass
          AND conname = 'official_prices_approved_provenance_check'
      `);
      expect(provenanceConstraint.rows[0]?.convalidated).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("constrains vendor enrichment state while preserving the canonical venue category", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);

      await expect(
        db.exec(`
          INSERT INTO public.vendors (name, category, enrichment_status)
          VALUES ('잘못된 상태', 'venue', 'finished')
        `)
      ).rejects.toThrow();

      await db.exec(`
        INSERT INTO public.vendors (name, category, enrichment_status)
        VALUES ('예식장', 'venue', 'done')
      `);
      const result = await db.query<{ category: string }>(`
        SELECT category FROM public.vendors WHERE name = '예식장'
      `);
      expect(result.rows[0]?.category).toBe("venue");
    } finally {
      await db.close();
    }
  });

  it("backfills canonical HTTPS URLs and rejects unsafe public slugs", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, website, instagram
        ) VALUES (
          '40500000-0000-4000-8000-000000000001',
          '기존 URL 업체', 'studio',
          'https://vendor.example', 'https://instagram.com/vendor'
        )
      `);
      await applyMigration(db);

      const vendor = await db.query<{
        official_url: string;
        instagram_url: string;
      }>(`
        SELECT official_url, instagram_url
        FROM public.vendors
        WHERE id = '40500000-0000-4000-8000-000000000001'
      `);
      expect(vendor.rows[0]).toEqual({
        official_url: "https://vendor.example",
        instagram_url: "https://instagram.com/vendor",
      });

      await expect(
        db.exec(`
          UPDATE public.vendors
          SET slug = '../unsafe slug'
          WHERE id = '40500000-0000-4000-8000-000000000001'
        `)
      ).rejects.toThrow();
      await db.exec(`
        UPDATE public.vendors
        SET slug = 'safe-vendor-2026'
        WHERE id = '40500000-0000-4000-8000-000000000001'
      `);
    } finally {
      await db.close();
    }
  });

  it("keeps direct vendor reads closed and exposes only the public enrichment view", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, owner_id, name, category, status, is_verified, website, instagram,
          bank_name, account_number, account_holder, attributes
        ) VALUES (
          '40900000-0000-4000-8000-000000000001',
          '40900000-0000-4000-8000-000000000099',
          'Public-safe vendor', 'studio', 'approved', true,
          'https://vendor.example', 'https://instagram.com/vendor',
          'Sensitive Bank', '123-456-789', 'Private Holder',
          '{
            "shoot_locations":["indoor"],
            "original_files_policy":null,
            "secret_future_key":"future private value"
          }'::jsonb
        );
        -- Legacy/direct service writes may predate the RPC hostname fence.
        UPDATE public.vendors
        SET official_url = 'https://user:secret@vendor.example',
            instagram_url = 'https://instagram.com.evil.example/vendor',
            naver_place_url = 'https://naver.com.evil.example/place/1'
        WHERE id = '40900000-0000-4000-8000-000000000001'
      `);

      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role};`);
        await expect(db.query("SELECT id FROM public.vendors")).rejects.toThrow();
        await expect(db.query(`
          SELECT id, name, category, status, is_verified, website, instagram
          FROM public.vendors
        `)).rejects.toThrow();
        await expect(db.query(`
          SELECT owner_id, bank_name, account_number, account_holder
          FROM public.vendors
        `)).rejects.toThrow();
        await expect(
          db.query("SELECT attributes FROM public.vendors")
        ).rejects.toThrow();

        const safeEnrichment = await db.query<{
          attributes: Record<string, unknown>;
          official_url: string | null;
          instagram_url: string | null;
          naver_place_url: string | null;
        }>(`
          SELECT attributes, official_url, instagram_url, naver_place_url
          FROM public.v_public_vendor_enrichment
          WHERE id = '40900000-0000-4000-8000-000000000001'
        `);
        expect(safeEnrichment.rows[0]?.attributes).toEqual({
          shoot_locations: ["indoor"],
          original_files_policy: null,
        });
        expect(safeEnrichment.rows[0]).toMatchObject({
          official_url: null,
          instagram_url: null,
          naver_place_url: null,
        });
        await db.exec("RESET ROLE;");
      }
      const exposedColumns = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns AS column_row
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[]) AS role_name
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = 'vendors'
          AND has_column_privilege(
            role_name,
            'public.vendors',
            column_row.column_name,
            'SELECT'
          )
      `);
      expect(exposedColumns.rows[0]?.count).toBe(0);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("adds admin edit provenance, aliases, and an ordered dedupe queue", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (id, name, category)
        VALUES
          ('41000000-0000-4000-8000-000000000001', '왼쪽 업체', 'studio'),
          ('41000000-0000-4000-8000-000000000002', '오른쪽 업체', 'studio')
      `);
      const vendor = await db.query<{ aliases: string[] }>(`
        SELECT aliases FROM public.vendors
        WHERE id = '41000000-0000-4000-8000-000000000001'
      `);
      expect(vendor.rows[0]?.aliases).toEqual([]);

      await expect(
        db.exec(`
          INSERT INTO public.vendor_dedupe_candidates (
            left_vendor_id, right_vendor_id, reason, similarity
          ) VALUES (
            '41000000-0000-4000-8000-000000000002',
            '41000000-0000-4000-8000-000000000001',
            '순서 오류', 0.9
          )
        `)
      ).rejects.toThrow();

      await db.exec(`
        INSERT INTO public.vendor_dedupe_candidates (
          left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '41000000-0000-4000-8000-000000000001',
          '41000000-0000-4000-8000-000000000002',
          '이름 유사', 0.9
        )
      `);
      await expect(
        db.exec(`
          INSERT INTO public.vendor_dedupe_candidates (
            left_vendor_id, right_vendor_id, reason, similarity
          ) VALUES (
            '41000000-0000-4000-8000-000000000001',
            '41000000-0000-4000-8000-000000000002',
            '중복 후보', 0.8
          )
        `)
      ).rejects.toThrow();

      const editedColumn = await db.query<{ column_default: string | null }>(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'official_prices'
          AND column_name = 'edited_by_admin'
      `);
      expect(editedColumn.rows[0]?.column_default).toBe("false");
    } finally {
      await db.close();
    }
  });

  it("atomically unions bounded vendor aliases without exposing the RPC publicly", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, aliases, category, status, updated_at
        ) VALUES (
          '41500000-0000-4000-8000-000000000001',
          '현재 업체명', ARRAY['기존 별칭'], 'studio', 'pending',
          '2000-01-01T00:00:00Z'
        )
      `);

      await db.exec("SET ROLE anon;");
      await expect(db.query(`
        SELECT public.merge_vendor_aliases(
          '41500000-0000-4000-8000-000000000001',
          ARRAY['옛 업체명']
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.merge_vendor_aliases(
          '41500000-0000-4000-8000-000000000001',
          ARRAY[' 옛 업체명 ', '기존 별칭', '현재 업체명', '과거 상호', '옛 업체명']
        )
      `);
      // Replay is idempotent and a later writer cannot erase prior aliases.
      await db.query(`
        SELECT public.merge_vendor_aliases(
          '41500000-0000-4000-8000-000000000001',
          ARRAY['세 번째 별칭']
        )
      `);
      await expect(db.query(`
        SELECT public.merge_vendor_aliases(
          '41500000-0000-4000-8000-000000000001',
          ARRAY[repeat('가', 201)]
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      const vendor = await db.query<{ aliases: string[]; updated_at: string }>(`
        SELECT aliases, updated_at
        FROM public.vendors
        WHERE id = '41500000-0000-4000-8000-000000000001'
      `);
      expect([...vendor.rows[0]!.aliases].sort()).toEqual([
        "과거 상호", "기존 별칭", "세 번째 별칭", "옛 업체명",
      ].sort());
      expect(new Date(vendor.rows[0]!.updated_at).getUTCFullYear()).toBeGreaterThan(2000);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("atomically merges an approved duplicate candidate without deleting the losing vendor", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, owner_id, name, aliases, category, status, region_code
        )
        VALUES
          (
            '42000000-0000-4000-8000-000000000001',
            '42000000-0000-4000-8000-000000000099',
            '보존 업체', ARRAY['예전 보존명'], 'studio', 'approved', 'seoul_etc'
          ),
          (
            '42000000-0000-4000-8000-000000000002',
            NULL,
            '합칠 업체', ARRAY['구 합칠명'], 'studio', 'pending', 'seoul_etc'
          ),
          (
            '42000000-0000-4000-8000-000000000003',
            NULL,
            '별도 후보 업체', '{}', 'studio', 'pending', 'seoul_etc'
          );
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('43000000-0000-4000-8000-000000000001', '2026Q3');
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, category, item_name
        ) VALUES (
          '44000000-0000-4000-8000-000000000001',
          '43000000-0000-4000-8000-000000000001',
          '42000000-0000-4000-8000-000000000002',
          'studio', '기본가'
        );
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source, created_at)
        SELECT '42000000-0000-4000-8000-000000000001', id, 'team', '2020-06-01T00:00:00Z'
        FROM public.tags WHERE slug = 'studio-natural-light';
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source, created_at)
        SELECT '42000000-0000-4000-8000-000000000002', id, 'user_review', '2022-06-01T00:00:00Z'
        FROM public.tags WHERE slug = 'studio-film-mood';
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source, created_at)
        SELECT '42000000-0000-4000-8000-000000000002', id, 'official_doc', '2021-06-01T00:00:00Z'
        FROM public.tags WHERE slug = 'studio-natural-light';
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '45000000-0000-4000-8000-000000000001',
          '42000000-0000-4000-8000-000000000001',
          '42000000-0000-4000-8000-000000000002',
          '정규화 이름 유사', 0.91
        ), (
          '45000000-0000-4000-8000-000000000002',
          '42000000-0000-4000-8000-000000000002',
          '42000000-0000-4000-8000-000000000003',
          '연쇄 후보', 0.75
        );
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '45000000-0000-4000-8000-000000000001',
          'same',
          '42000000-0000-4000-8000-000000000002',
          '46000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow();
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '45000000-0000-4000-8000-000000000001',
          'same',
          '42000000-0000-4000-8000-000000000001',
          '46000000-0000-4000-8000-000000000001'
        )
      `);
      // A retried admin request is idempotent and does not duplicate aliases/tags.
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '45000000-0000-4000-8000-000000000001',
          'same',
          '42000000-0000-4000-8000-000000000001',
          '46000000-0000-4000-8000-000000000001'
        )
      `);
      await db.exec("RESET ROLE;");

      const vendors = await db.query<{
        id: string;
        aliases: string[];
        status: string;
        enrichment_status: string;
      }>(`
        SELECT id, aliases, status, enrichment_status
        FROM public.vendors
        WHERE id IN (
          '42000000-0000-4000-8000-000000000001',
          '42000000-0000-4000-8000-000000000002'
        )
        ORDER BY id
      `);
      expect(vendors.rows).toEqual([
        {
          id: "42000000-0000-4000-8000-000000000001",
          aliases: ["구 합칠명", "예전 보존명", "합칠 업체"],
          status: "approved",
          enrichment_status: "pending",
        },
        {
          id: "42000000-0000-4000-8000-000000000002",
          aliases: ["구 합칠명"],
          status: "rejected",
          enrichment_status: "skip",
        },
      ]);
      const price = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id FROM public.official_prices
        WHERE id = '44000000-0000-4000-8000-000000000001'
      `);
      expect(price.rows[0]?.vendor_id).toBe(
        "42000000-0000-4000-8000-000000000001"
      );
      const tagCount = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.vendor_tags
        WHERE vendor_id = '42000000-0000-4000-8000-000000000001'
      `);
      expect(tagCount.rows[0]?.count).toBe(2);
      const mergedTags = await db.query<{
        slug: string;
        source: string;
        created_year: number;
      }>(`
        SELECT tag_row.slug, assignment.source,
               extract(year FROM assignment.created_at AT TIME ZONE 'UTC')::int AS created_year
        FROM public.vendor_tags AS assignment
        JOIN public.tags AS tag_row ON tag_row.id = assignment.tag_id
        WHERE assignment.vendor_id = '42000000-0000-4000-8000-000000000001'
        ORDER BY tag_row.slug
      `);
      expect(mergedTags.rows.map(({ slug, source, created_year }) => ({
        slug,
        source,
        year: created_year,
      }))).toEqual([
        { slug: "studio-film-mood", source: "user_review", year: 2022 },
        { slug: "studio-natural-light", source: "official_doc", year: 2020 },
      ]);
      const decision = await db.query<{
        status: string;
        preserved_vendor_id: string;
        decided_by: string;
      }>(`
        SELECT status, preserved_vendor_id, decided_by
        FROM public.vendor_dedupe_candidates
        WHERE id = '45000000-0000-4000-8000-000000000001'
      `);
      expect(decision.rows[0]).toMatchObject({
        status: "same",
        preserved_vendor_id: "42000000-0000-4000-8000-000000000001",
        decided_by: "46000000-0000-4000-8000-000000000001",
      });
      const superseded = await db.query<{ status: string; preserved_vendor_id: string | null }>(`
        SELECT status, preserved_vendor_id
        FROM public.vendor_dedupe_candidates
        WHERE id = '45000000-0000-4000-8000-000000000002'
      `);
      expect(superseded.rows[0]).toEqual({
        status: "superseded",
        preserved_vendor_id: null,
      });
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("preserves compatible V2 enrichment data when a pending vendor is merged", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, aliases, category, status, region_code, slug,
          website, instagram, official_url, instagram_url, naver_place_url,
          attributes, enrichment_status, enriched_at
        ) VALUES
          (
            '58000000-0000-4000-8000-000000000001',
            'Preserved vendor', ARRAY['Preserved alias'], 'studio', 'approved',
            'seoul_etc', NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb,
            'pending', NULL
          ),
          (
            '58000000-0000-4000-8000-000000000002',
            'Losing vendor', ARRAY['Losing alias'], 'studio', 'pending',
            'seoul_etc', 'canonical-vendor', 'https://vendor.example',
            'https://instagram.com/vendor', 'https://vendor.example',
            'https://instagram.com/vendor', 'https://m.place.naver.com/place/1',
            '{"style":"editorial","capacity":120}'::jsonb,
            'done', '2026-07-17T12:00:00Z'
          );
        INSERT INTO public.vendor_enrichment_private (
          vendor_id, price_band, notes_internal, enriched_by, updated_at
        ) VALUES (
          '58000000-0000-4000-8000-000000000002', 'premium',
          'Verified by the enrichment team',
          '58000000-0000-4000-8000-000000000099',
          '2026-07-17T12:00:00Z'
        );
        INSERT INTO public.events (
          id, anon_id, vendor_id, surface, event_type
        ) VALUES (
          '58100000-0000-4000-8000-000000000001', 'anon-v2',
          '58000000-0000-4000-8000-000000000002',
          'vendor_profile', 'vendor_view'
        );
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('58100000-0000-4000-8000-000000000002', 'merge-fence');
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '58200000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000002',
          'same official identity', 0.99
        );
      `);

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '58200000-0000-4000-8000-000000000001',
          'same',
          '58000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000098'
        )
      `);
      // Retry after all relations moved: no duplicate private row or event.
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '58200000-0000-4000-8000-000000000001',
          'same',
          '58000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000098'
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.vendor_enrichment_private (vendor_id, notes_internal)
        VALUES (
          '58000000-0000-4000-8000-000000000002',
          'Late isolated enrichment'
        )
      `)).rejects.toThrow(/VENDOR_REFERENCE_REJECTED/);
      await expect(db.exec(`
        INSERT INTO public.events (
          anon_id, vendor_id, surface, event_type
        ) VALUES (
          'late-event', '58000000-0000-4000-8000-000000000002',
          'vendor_profile', 'vendor_view'
        )
      `)).rejects.toThrow(/VENDOR_REFERENCE_REJECTED/);
      await expect(db.exec(`
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source)
        SELECT '58000000-0000-4000-8000-000000000002', id, 'team'
        FROM public.tags
        ORDER BY id
        LIMIT 1
      `)).rejects.toThrow(/VENDOR_REFERENCE_REJECTED/);
      await expect(db.exec(`
        INSERT INTO public.official_prices (
          snapshot_id, vendor_id, category, item_name
        ) VALUES (
          '58100000-0000-4000-8000-000000000002',
          '58000000-0000-4000-8000-000000000002',
          'studio', 'Late isolated price'
        )
      `)).rejects.toThrow(/VENDOR_REFERENCE_REJECTED/);
      await db.exec("RESET ROLE;");

      const preserved = await db.query<{
        slug: string;
        website: string;
        instagram: string;
        official_url: string;
        instagram_url: string;
        naver_place_url: string;
        attributes: Record<string, unknown>;
        enrichment_status: string;
        enriched_at: string;
      }>(`
        SELECT slug, website, instagram, official_url, instagram_url,
               naver_place_url, attributes, enrichment_status, enriched_at
        FROM public.vendors
        WHERE id = '58000000-0000-4000-8000-000000000001'
      `);
      expect(preserved.rows[0]).toMatchObject({
        slug: "canonical-vendor",
        website: "https://vendor.example",
        instagram: "https://instagram.com/vendor",
        official_url: "https://vendor.example",
        instagram_url: "https://instagram.com/vendor",
        naver_place_url: "https://m.place.naver.com/place/1",
        attributes: { style: "editorial", capacity: 120 },
        enrichment_status: "done",
      });
      expect(new Date(preserved.rows[0]?.enriched_at ?? 0).toISOString()).toBe(
        "2026-07-17T12:00:00.000Z"
      );

      const losing = await db.query<{
        slug: string | null;
        status: string;
        enrichment_status: string;
      }>(`
        SELECT slug, status, enrichment_status
        FROM public.vendors
        WHERE id = '58000000-0000-4000-8000-000000000002'
      `);
      expect(losing.rows[0]).toEqual({
        slug: null,
        status: "rejected",
        enrichment_status: "skip",
      });

      const privateRows = await db.query<{
        vendor_id: string;
        price_band: string;
        notes_internal: string;
        enriched_by: string;
      }>(`
        SELECT vendor_id, price_band, notes_internal, enriched_by
        FROM public.vendor_enrichment_private
      `);
      expect(privateRows.rows).toEqual([{
        vendor_id: "58000000-0000-4000-8000-000000000001",
        price_band: "premium",
        notes_internal: "Verified by the enrichment team",
        enriched_by: "58000000-0000-4000-8000-000000000099",
      }]);
      const event = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id FROM public.events
        WHERE id = '58100000-0000-4000-8000-000000000001'
      `);
      expect(event.rows[0]?.vendor_id).toBe(
        "58000000-0000-4000-8000-000000000001"
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("ignores only staged schema defaults while preserving populated winner fields", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.vendors
          ADD COLUMN location text NOT NULL DEFAULT '',
          ADD COLUMN price_min integer NOT NULL DEFAULT 0,
          ADD COLUMN price_max integer NOT NULL DEFAULT 0,
          ADD COLUMN rating numeric NOT NULL DEFAULT 0,
          ADD COLUMN review_count integer NOT NULL DEFAULT 0,
          ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[],
          ADD COLUMN style_tags text[] NOT NULL DEFAULT '{}'::text[],
          ADD COLUMN ai_recommend boolean NOT NULL DEFAULT false,
          ADD COLUMN business_hours jsonb NOT NULL DEFAULT '{
            "mon":"10:00-19:00","tue":"10:00-19:00",
            "wed":"10:00-19:00","thu":"10:00-19:00",
            "fri":"10:00-19:00","sat":"10:00-18:00","sun":"휴무"
          }'::jsonb,
          ADD COLUMN notification_settings jsonb NOT NULL DEFAULT '{
            "booking":true,"message":true,"marketing":false
          }'::jsonb,
          ADD COLUMN legacy_note text;
      `);
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, owner_id, name, category, status, region_code, slug,
          location, price_min, price_max, rating, review_count, tags,
          style_tags, is_verified, ai_recommend, business_hours,
          notification_settings
        ) VALUES
          (
            '58300000-0000-4000-8000-000000000001', NULL,
            'Populated winner', 'studio', 'approved', 'seoul_etc', NULL,
            '서울 강남', 3000000, 5000000, 4.8, 120,
            ARRAY['award-winning'], ARRAY['classic'], true, true,
            '{"mon":"09:00-18:00","sun":"closed"}'::jsonb,
            '{"booking":false,"message":true,"marketing":true}'::jsonb
          ),
          (
            '58300000-0000-4000-8000-000000000002', NULL,
            'Loader staging row', 'studio', 'pending', 'seoul_etc',
            'loader-staging-row',
            DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT,
            DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT
          );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '58400000-0000-4000-8000-000000000001',
          '58300000-0000-4000-8000-000000000001',
          '58300000-0000-4000-8000-000000000002',
          'loader default duplicate', 0.99
        );
      `);

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '58400000-0000-4000-8000-000000000001', 'same',
          '58300000-0000-4000-8000-000000000001',
          '58400000-0000-4000-8000-000000000099'
        )
      `);
      await db.exec("RESET ROLE;");

      const winner = await db.query<{
        slug: string;
        location: string;
        price_min: number;
        price_max: number;
        rating: string;
        review_count: number;
        tags: string[];
        style_tags: string[];
        is_verified: boolean;
        ai_recommend: boolean;
        business_hours: Record<string, string>;
        notification_settings: Record<string, boolean>;
      }>(`
        SELECT slug, location, price_min, price_max, rating::text,
               review_count, tags, style_tags, is_verified, ai_recommend,
               business_hours, notification_settings
        FROM public.vendors
        WHERE id = '58300000-0000-4000-8000-000000000001'
      `);
      expect(winner.rows[0]).toEqual({
        slug: "loader-staging-row",
        location: "서울 강남",
        price_min: 3000000,
        price_max: 5000000,
        rating: "4.8",
        review_count: 120,
        tags: ["award-winning"],
        style_tags: ["classic"],
        is_verified: true,
        ai_recommend: true,
        business_hours: { mon: "09:00-18:00", sun: "closed" },
        notification_settings: {
          booking: false,
          message: true,
          marketing: true,
        },
      });
      const loser = await db.query<{ status: string }>(`
        SELECT status FROM public.vendors
        WHERE id = '58300000-0000-4000-8000-000000000002'
      `);
      expect(loser.rows[0]?.status).toBe("rejected");
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("still blocks a merge when an unhandled vendor column has meaningful losing data", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.vendors ADD COLUMN legacy_note text;
      `);
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, region_code, legacy_note
        ) VALUES
          (
            '58500000-0000-4000-8000-000000000001', 'Winner',
            'studio', 'approved', 'seoul_etc', NULL
          ),
          (
            '58500000-0000-4000-8000-000000000002', 'Loser',
            'studio', 'pending', 'seoul_etc', 'must not be discarded'
          );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, similarity
        ) VALUES (
          '58600000-0000-4000-8000-000000000001',
          '58500000-0000-4000-8000-000000000001',
          '58500000-0000-4000-8000-000000000002', 0.99
        );
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '58600000-0000-4000-8000-000000000001', 'same',
          '58500000-0000-4000-8000-000000000001',
          '58600000-0000-4000-8000-000000000099'
        )
      `)).rejects.toThrow(/VENDOR_DEDUPE_UNMERGED_COLUMN_CONFLICT: legacy_note/);
      await db.exec("RESET ROLE;");

      const state = await db.query<{ vendor_status: string; candidate_status: string }>(`
        SELECT vendor.status AS vendor_status, candidate.status AS candidate_status
        FROM public.vendors AS vendor
        JOIN public.vendor_dedupe_candidates AS candidate
          ON candidate.right_vendor_id = vendor.id
        WHERE vendor.id = '58500000-0000-4000-8000-000000000002'
      `);
      expect(state.rows[0]).toEqual({
        vendor_status: "pending",
        candidate_status: "pending",
      });
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed and rolls back when public or private enrichment conflicts", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, region_code, official_url, attributes
        ) VALUES
          (
            '59000000-0000-4000-8000-000000000001', 'URL preserved',
            'studio', 'approved', 'seoul_etc',
            'https://preserved.example', '{}'::jsonb
          ),
          (
            '59000000-0000-4000-8000-000000000002', 'URL losing',
            'studio', 'pending', 'seoul_etc',
            'https://losing.example', '{}'::jsonb
          ),
          (
            '59100000-0000-4000-8000-000000000001', 'Attribute preserved',
            'studio', 'approved', 'seoul_etc', NULL,
            '{"style":"natural"}'::jsonb
          ),
          (
            '59100000-0000-4000-8000-000000000002', 'Attribute losing',
            'studio', 'pending', 'seoul_etc', NULL,
            '{"style":"editorial"}'::jsonb
          ),
          (
            '59200000-0000-4000-8000-000000000001', 'Private preserved',
            'studio', 'approved', 'seoul_etc', NULL, '{}'::jsonb
          ),
          (
            '59200000-0000-4000-8000-000000000002', 'Private losing',
            'studio', 'pending', 'seoul_etc', NULL, '{}'::jsonb
          );
        INSERT INTO public.vendor_enrichment_private (
          vendor_id, price_band, notes_internal, enriched_by
        ) VALUES
          (
            '59200000-0000-4000-8000-000000000001',
            'mid', 'Preserved evidence',
            '59200000-0000-4000-8000-000000000091'
          ),
          (
            '59200000-0000-4000-8000-000000000002',
            'premium', 'Losing evidence',
            '59200000-0000-4000-8000-000000000092'
          );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES
          (
            '59300000-0000-4000-8000-000000000001',
            '59000000-0000-4000-8000-000000000001',
            '59000000-0000-4000-8000-000000000002', 'URL conflict', 0.9
          ),
          (
            '59300000-0000-4000-8000-000000000002',
            '59100000-0000-4000-8000-000000000001',
            '59100000-0000-4000-8000-000000000002', 'attribute conflict', 0.9
          ),
          (
            '59300000-0000-4000-8000-000000000003',
            '59200000-0000-4000-8000-000000000001',
            '59200000-0000-4000-8000-000000000002', 'private conflict', 0.9
          );
      `);

      await db.exec("SET ROLE service_role;");
      for (const [candidateId, preservedId] of [
        ["59300000-0000-4000-8000-000000000001", "59000000-0000-4000-8000-000000000001"],
        ["59300000-0000-4000-8000-000000000002", "59100000-0000-4000-8000-000000000001"],
        ["59300000-0000-4000-8000-000000000003", "59200000-0000-4000-8000-000000000001"],
      ]) {
        await expect(db.query(`
          SELECT public.decide_vendor_dedupe_candidate(
            '${candidateId}', 'same', '${preservedId}',
            '59400000-0000-4000-8000-000000000001'
          )
        `)).rejects.toThrow();
      }
      await db.exec("RESET ROLE;");

      const candidates = await db.query<{ status: string }>(`
        SELECT status
        FROM public.vendor_dedupe_candidates
        WHERE id::text LIKE '59300000-%'
        ORDER BY id
      `);
      expect(candidates.rows).toEqual([
        { status: "pending" },
        { status: "pending" },
        { status: "pending" },
      ]);
      const losingVendors = await db.query<{ status: string }>(`
        SELECT status FROM public.vendors
        WHERE id IN (
          '59000000-0000-4000-8000-000000000002',
          '59100000-0000-4000-8000-000000000002',
          '59200000-0000-4000-8000-000000000002'
        )
        ORDER BY id
      `);
      expect(losingVendors.rows).toEqual([
        { status: "pending" },
        { status: "pending" },
        { status: "pending" },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("blocks a merge when an unhandled vendor relation would be stranded", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        CREATE TABLE public.vendor_domain_records (
          id uuid PRIMARY KEY,
          vendor_id uuid NOT NULL REFERENCES public.vendors(id),
          payload jsonb NOT NULL
        );
        INSERT INTO public.vendors (
          id, name, category, status, region_code
        ) VALUES
          (
            '59500000-0000-4000-8000-000000000001',
            'Reference preserved', 'studio', 'approved', 'seoul_etc'
          ),
          (
            '59500000-0000-4000-8000-000000000002',
            'Reference losing', 'studio', 'pending', 'seoul_etc'
          );
        INSERT INTO public.vendor_domain_records (id, vendor_id, payload)
        VALUES (
          '59600000-0000-4000-8000-000000000001',
          '59500000-0000-4000-8000-000000000002',
          '{"must":"remain attached"}'::jsonb
        );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '59700000-0000-4000-8000-000000000001',
          '59500000-0000-4000-8000-000000000001',
          '59500000-0000-4000-8000-000000000002',
          'unhandled relation', 0.9
        );
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '59700000-0000-4000-8000-000000000001', 'same',
          '59500000-0000-4000-8000-000000000001',
          '59800000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow(/VENDOR_DEDUPE_UNHANDLED_REFERENCE/);
      await db.exec("RESET ROLE;");

      const reference = await db.query<{ vendor_id: string }>(`
        SELECT vendor_id FROM public.vendor_domain_records
      `);
      expect(reference.rows[0]?.vendor_id).toBe(
        "59500000-0000-4000-8000-000000000002"
      );
      const candidate = await db.query<{ status: string }>(`
        SELECT status FROM public.vendor_dedupe_candidates
        WHERE id = '59700000-0000-4000-8000-000000000001'
      `);
      expect(candidate.rows[0]?.status).toBe("pending");
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("refuses to merge same-category vendors from different regions", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, region_code
        ) VALUES
          (
            '55000000-0000-4000-8000-000000000001',
            '서울 업체', 'studio', 'approved', 'seoul_etc'
          ),
          (
            '55000000-0000-4000-8000-000000000002',
            '부산 업체', 'studio', 'approved', 'busan'
          );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, similarity
        ) VALUES (
          '56000000-0000-4000-8000-000000000001',
          '55000000-0000-4000-8000-000000000001',
          '55000000-0000-4000-8000-000000000002', 0.9
        );
      `);
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '56000000-0000-4000-8000-000000000001',
          'same',
          '55000000-0000-4000-8000-000000000001',
          '57000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");
      const candidate = await db.query<{ status: string }>(`
        SELECT status FROM public.vendor_dedupe_candidates
        WHERE id = '56000000-0000-4000-8000-000000000001'
      `);
      expect(candidate.rows[0]?.status).toBe("pending");
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("refuses to reopen done or skipped enrichment and preserves completion timestamps", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, enrichment_status, enriched_at, updated_at
        ) VALUES
          (
            '46800000-0000-4000-8000-000000000001', 'Completed vendor',
            'studio', 'approved', 'done', '2026-07-10T08:00:00Z',
            '2026-07-10T08:00:00Z'
          ),
          (
            '46800000-0000-4000-8000-000000000002', 'Skipped vendor',
            'studio', 'approved', 'skip', '2026-07-11T09:00:00Z',
            '2026-07-11T09:00:00Z'
          );
        INSERT INTO public.vendor_enrichment_private (
          vendor_id, enriched_by, updated_at
        ) VALUES
          (
            '46800000-0000-4000-8000-000000000001',
            '46800000-0000-4000-8000-000000000091',
            '2026-07-10T08:00:00Z'
          ),
          (
            '46800000-0000-4000-8000-000000000002',
            '46800000-0000-4000-8000-000000000092',
            '2026-07-11T09:00:00Z'
          );
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.assign_vendor_enrichment(
          '46800000-0000-4000-8000-000000000001',
          '46800000-0000-4000-8000-000000000099'
        )
      `)).rejects.toThrow(/VENDOR_ENRICHMENT_VENDOR_DONE/);
      await expect(db.query(`
        SELECT public.assign_vendor_enrichment(
          '46800000-0000-4000-8000-000000000002',
          '46800000-0000-4000-8000-000000000099'
        )
      `)).rejects.toThrow(/VENDOR_ENRICHMENT_VENDOR_SKIPPED/);
      await db.exec("RESET ROLE;");

      const vendors = await db.query<{
        id: string;
        enrichment_status: string;
        enriched_at: string;
        updated_at: string;
      }>(`
        SELECT id, enrichment_status, enriched_at, updated_at
        FROM public.vendors
        WHERE id::text LIKE '46800000-%'
        ORDER BY id
      `);
      expect(vendors.rows.map((row) => ({
        id: row.id,
        status: row.enrichment_status,
        enrichedAt: new Date(row.enriched_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }))).toEqual([
        {
          id: "46800000-0000-4000-8000-000000000001",
          status: "done",
          enrichedAt: "2026-07-10T08:00:00.000Z",
          updatedAt: "2026-07-10T08:00:00.000Z",
        },
        {
          id: "46800000-0000-4000-8000-000000000002",
          status: "skip",
          enrichedAt: "2026-07-11T09:00:00.000Z",
          updatedAt: "2026-07-11T09:00:00.000Z",
        },
      ]);
      const actors = await db.query<{ enriched_by: string }>(`
        SELECT enriched_by
        FROM public.vendor_enrichment_private
        WHERE vendor_id::text LIKE '46800000-%'
        ORDER BY vendor_id
      `);
      expect(actors.rows).toEqual([
        { enriched_by: "46800000-0000-4000-8000-000000000091" },
        { enriched_by: "46800000-0000-4000-8000-000000000092" },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects assignment and save attempts against inactive vendor tombstones", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (
          id, name, category, status, enrichment_status, official_url
        ) VALUES (
          '46850000-0000-4000-8000-000000000001',
          'Merged vendor tombstone', 'studio', 'approved', 'pending', NULL
        );
        INSERT INTO public.vendor_enrichment_private (
          vendor_id, enriched_by, notes_internal
        ) VALUES (
          '46850000-0000-4000-8000-000000000001',
          '46850000-0000-4000-8000-000000000099',
          'immutable tombstone note'
        );
        UPDATE public.vendors
        SET status = 'rejected'
        WHERE id = '46850000-0000-4000-8000-000000000001';
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.assign_vendor_enrichment(
          '46850000-0000-4000-8000-000000000001',
          '46850000-0000-4000-8000-000000000098'
        )
      `)).rejects.toThrow(/VENDOR_ENRICHMENT_VENDOR_INACTIVE/);
      await expect(db.query(`
        SELECT public.save_vendor_enrichment(
          '46850000-0000-4000-8000-000000000001',
          '46850000-0000-4000-8000-000000000099',
          'https://should-not-save.example', NULL, NULL,
          '{}'::jsonb, NULL, 'mutated note', '{}'::uuid[], false
        )
      `)).rejects.toThrow(/VENDOR_ENRICHMENT_VENDOR_INACTIVE/);
      await db.exec("RESET ROLE;");

      const vendor = await db.query<{
        official_url: string | null;
        enrichment_status: string;
      }>(`
        SELECT official_url, enrichment_status
        FROM public.vendors
        WHERE id = '46850000-0000-4000-8000-000000000001'
      `);
      expect(vendor.rows[0]).toEqual({
        official_url: null,
        enrichment_status: "pending",
      });
      const privateRow = await db.query<{ notes_internal: string; enriched_by: string }>(`
        SELECT notes_internal, enriched_by
        FROM public.vendor_enrichment_private
        WHERE vendor_id = '46850000-0000-4000-8000-000000000001'
      `);
      expect(privateRow.rows[0]).toEqual({
        notes_internal: "immutable tombstone note",
        enriched_by: "46850000-0000-4000-8000-000000000099",
      });
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects unsafe or falsely branded enrichment URLs inside the database RPC", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (id, name, category, status)
        VALUES (
          '46900000-0000-4000-8000-000000000001',
          'URL 검증 업체', 'studio', 'approved'
        );
      `);
      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.assign_vendor_enrichment(
          '46900000-0000-4000-8000-000000000001',
          '46900000-0000-4000-8000-000000000099'
        )
      `);

      for (const unsafeArguments of [
        `'https://user:secret@vendor.example', NULL, NULL`,
        `'https://vendor.example:8443', NULL, NULL`,
        `NULL, 'https://instagram.com.evil.example/vendor', NULL`,
        `NULL, NULL, 'https://naver.com.evil.example/place/1'`,
      ]) {
        await expect(db.query(`
          SELECT public.save_vendor_enrichment(
            '46900000-0000-4000-8000-000000000001',
            '46900000-0000-4000-8000-000000000099',
            ${unsafeArguments}, '{}'::jsonb, NULL, NULL,
            '{}'::uuid[], false
          )
        `)).rejects.toThrow(/VENDOR_ENRICHMENT_URL_INVALID/);
      }

      await db.query(`
        SELECT public.save_vendor_enrichment(
          '46900000-0000-4000-8000-000000000001',
          '46900000-0000-4000-8000-000000000099',
          'https://vendor.example:443/path',
          'https://www.instagram.com/vendor/',
          'https://m.place.naver.com/place/1',
          '{}'::jsonb, NULL, NULL, '{}'::uuid[], false
        )
      `);
      await db.exec("RESET ROLE;");

      const stored = await db.query<{
        official_url: string;
        instagram_url: string;
        naver_place_url: string;
      }>(`
        SELECT official_url, instagram_url, naver_place_url
        FROM public.vendors
        WHERE id = '46900000-0000-4000-8000-000000000001'
      `);
      expect(stored.rows[0]).toEqual({
        official_url: "https://vendor.example:443/path",
        instagram_url: "https://www.instagram.com/vendor/",
        naver_place_url: "https://m.place.naver.com/place/1",
      });
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("atomically assigns and saves public enrichment while isolating notes and actor", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.vendors (id, name, category, status, updated_at)
        VALUES (
          '47000000-0000-4000-8000-000000000001',
          '인리치 업체', 'studio', 'approved', '2000-01-01T00:00:00Z'
        );
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source)
        SELECT '47000000-0000-4000-8000-000000000001', id, 'official_doc'
        FROM public.tags WHERE slug = 'studio-film-mood';
        INSERT INTO public.vendor_tags (vendor_id, tag_id, source)
        SELECT '47000000-0000-4000-8000-000000000001', id, 'user_review'
        FROM public.tags WHERE slug = 'studio-natural-light'
      `);

      await db.exec("SET ROLE anon;");
      await expect(
        db.query(`
          SELECT public.assign_vendor_enrichment(
            '47000000-0000-4000-8000-000000000001',
            '47000000-0000-4000-8000-000000000099'
          )
        `)
      ).rejects.toThrow();
      await db.exec("RESET ROLE;");

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.assign_vendor_enrichment(
          '47000000-0000-4000-8000-000000000001',
          '47000000-0000-4000-8000-000000000099'
        )
      `);
      await expect(
        db.query(`
          SELECT public.assign_vendor_enrichment(
            '47000000-0000-4000-8000-000000000001',
            '47000000-0000-4000-8000-000000000098'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.query(`
          SELECT public.save_vendor_enrichment(
            '47000000-0000-4000-8000-000000000001',
            '47000000-0000-4000-8000-000000000098',
            NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, '{}'::uuid[], false
          )
        `)
      ).rejects.toThrow();
      await db.query(`
        SELECT public.save_vendor_enrichment(
          '47000000-0000-4000-8000-000000000001',
          '47000000-0000-4000-8000-000000000099',
          'https://vendor.example',
          'https://instagram.com/vendor',
          'https://naver.me/vendor',
          '{"shoot_locations":["indoor"]}'::jsonb,
          'mid',
          '전화로 원본 정책 재확인',
          ARRAY(
            SELECT id FROM public.tags
            WHERE slug IN ('studio-natural-light', 'studio-cinematic')
            ORDER BY slug
          ),
          true
        )
      `);
      await db.exec("RESET ROLE;");

      const vendor = await db.query<{
        enrichment_status: string;
        website: string;
        instagram: string;
        official_url: string;
        instagram_url: string;
        naver_place_url: string;
        attributes: Record<string, unknown>;
        enriched_at: string | null;
        updated_at: string;
      }>(`
        SELECT enrichment_status, website, instagram, official_url,
               instagram_url, naver_place_url, attributes, enriched_at,
               updated_at
        FROM public.vendors
        WHERE id = '47000000-0000-4000-8000-000000000001'
      `);
      expect(vendor.rows[0]).toMatchObject({
        enrichment_status: "done",
        website: "https://vendor.example",
        instagram: "https://instagram.com/vendor",
        official_url: "https://vendor.example",
        instagram_url: "https://instagram.com/vendor",
        naver_place_url: "https://naver.me/vendor",
        attributes: { shoot_locations: ["indoor"] },
      });
      expect(vendor.rows[0]?.enriched_at).not.toBeNull();
      expect(new Date(vendor.rows[0]?.updated_at ?? 0).getUTCFullYear()).toBeGreaterThan(2000);
      const privateRow = await db.query<{
        notes_internal: string;
        price_band: string;
        enriched_by: string;
      }>(`
        SELECT notes_internal, price_band, enriched_by
        FROM public.vendor_enrichment_private
        WHERE vendor_id = '47000000-0000-4000-8000-000000000001'
      `);
      expect(privateRow.rows[0]).toEqual({
        notes_internal: "전화로 원본 정책 재확인",
        price_band: "mid",
        enriched_by: "47000000-0000-4000-8000-000000000099",
      });
      const tags = await db.query<{ slug: string; source: string }>(`
        SELECT tag_row.slug, assignment.source
        FROM public.vendor_tags AS assignment
        JOIN public.tags AS tag_row ON tag_row.id = assignment.tag_id
        WHERE assignment.vendor_id = '47000000-0000-4000-8000-000000000001'
        ORDER BY tag_row.slug
      `);
      expect(tags.rows).toEqual([
        { slug: "studio-cinematic", source: "team" },
        { slug: "studio-film-mood", source: "official_doc" },
        { slug: "studio-natural-light", source: "user_review" },
      ]);

      await db.exec("SET ROLE anon;");
      const publicVendor = await db.query<{ attributes: Record<string, unknown> }>(`
        SELECT attributes FROM public.v_public_vendor_enrichment
        WHERE id = '47000000-0000-4000-8000-000000000001'
      `);
      expect(publicVendor.rows[0]?.attributes).toEqual({ shoot_locations: ["indoor"] });
      await expect(
        db.query("SELECT price_band FROM public.vendor_enrichment_private")
      ).rejects.toThrow();
      await db.exec("RESET ROLE;");

      await db.exec("SET ROLE service_role;");
      await expect(
        db.query(`
          SELECT public.save_vendor_enrichment(
            '47000000-0000-4000-8000-000000000001',
            '47000000-0000-4000-8000-000000000099',
            NULL, NULL, NULL,
            '{"notes_internal":"새면 안 됨"}'::jsonb,
            NULL, '새면 안 됨', '{}'::uuid[], false
          )
        `)
      ).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects impossible prices and requires provenance before approval", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.price_snapshots (id, period_label, source)
        VALUES ('10000000-0000-4000-8000-000000000001', '2026Q3', 'kca_tprice');
        INSERT INTO public.agencies (id, name)
        VALUES ('20000000-0000-4000-8000-000000000001', '샘플 대행사');
      `);

      await expect(
        db.exec(`
          INSERT INTO public.official_prices (
            snapshot_id, category, item_name, price_min_krw
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            'studio', '기본 상품', -1
          )
        `)
      ).rejects.toThrow();

      await expect(
        db.exec(`
          INSERT INTO public.official_prices (
            snapshot_id, category, item_name, source_object_keys
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            'studio', '안전하지 않은 원본 키', ARRAY['../sample.xlsx']
          )
        `)
      ).rejects.toThrow();

      await expect(
        db.exec(`
          INSERT INTO public.official_prices (
            snapshot_id, category, item_name, price_min_krw,
            review_status, needs_review
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            'studio', '근거 없는 승인', 1000000, 'approved', false
          )
        `)
      ).rejects.toThrow();

      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name,
          price_min_krw, price_max_krw, review_status, needs_review,
          source_file, source_quote, confidence, source_object_keys
        ) VALUES (
          '30000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'studio', '승인된 상품', 1000000, 1200000, 'approved', false,
          'studio.xlsx', '기본 상품 100~120만원', 0.92,
          ARRAY[repeat('a', 64) || '.xlsx']
        )
      `);

      await expect(
        db.exec(`
          INSERT INTO public.official_price_options (
            official_price_id, name, price_min_krw, price_max_krw
          ) VALUES (
            '30000000-0000-4000-8000-000000000001',
            '역전된 가격', 200000, 100000
          )
        `)
      ).rejects.toThrow();

      await expect(
        db.exec(`
          INSERT INTO public.official_agency_packages (
            snapshot_id, agency_id, package_name, options
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '잘못된 옵션', '{}'::jsonb
          )
        `)
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("serializes option writes and fences approved or admin-edited parents", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.profiles (id, is_admin)
        VALUES ('50800000-0000-4000-8000-000000000001', true);
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('50500000-0000-4000-8000-000000000001', '2026Q3-fence');
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name, price_min_krw,
          review_status, needs_review, source_file, source_quote, confidence,
          source_object_keys
        ) VALUES
          (
            '50600000-0000-4000-8000-000000000001',
            '50500000-0000-4000-8000-000000000001',
            'studio', 'Pending parent', 1000000, 'pending', true,
            'source/pending.xlsx', 'Pending parent 1,000,000', 0.9,
            ARRAY[repeat('a', 64) || '.xlsx']
          ),
          (
            '50600000-0000-4000-8000-000000000002',
            '50500000-0000-4000-8000-000000000001',
            'studio', 'Approved parent', 1200000, 'pending', true,
            'source/approved.xlsx', 'Approved parent 1,200,000', 0.95,
            ARRAY[repeat('b', 64) || '.xlsx']
          );
        INSERT INTO public.official_price_options (
          id, official_price_id, name, price_min_krw,
          source_file, source_quote, source_object_keys, confidence
        ) VALUES
          (
            '50700000-0000-4000-8000-000000000001',
            '50600000-0000-4000-8000-000000000001',
            'Pending option', 100000, 'source/pending.xlsx',
            'Pending option 100,000', ARRAY[repeat('a', 64) || '.xlsx'], 0.9
          ),
          (
            '50700000-0000-4000-8000-000000000002',
            '50600000-0000-4000-8000-000000000002',
            'Approved option', 200000, 'source/approved.xlsx',
            'Approved option 200,000', ARRAY[repeat('b', 64) || '.xlsx'], 0.95
          );
        UPDATE public.official_prices
        SET review_status = 'approved', needs_review = false
        WHERE id = '50600000-0000-4000-8000-000000000002';
      `);

      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        INSERT INTO public.official_price_options (
          official_price_id, name, price_min_krw
        ) VALUES (
          '50600000-0000-4000-8000-000000000002',
          'Late approved insert', 300000
        )
      `)).rejects.toThrow(/OFFICIAL_PRICE_OPTION_PARENT_NOT_WRITABLE/);
      await expect(db.exec(`
        UPDATE public.official_price_options
        SET price_min_krw = 300000
        WHERE id = '50700000-0000-4000-8000-000000000002'
      `)).rejects.toThrow(/OFFICIAL_PRICE_OPTION_PARENT_NOT_WRITABLE/);
      await expect(db.exec(`
        DELETE FROM public.official_price_options
        WHERE id = '50700000-0000-4000-8000-000000000002'
      `)).rejects.toThrow(/OFFICIAL_PRICE_OPTION_PARENT_NOT_WRITABLE/);

      // Raw ingest can still maintain an untouched pending option set.
      await db.exec(`
        INSERT INTO public.official_price_options (
          id, official_price_id, name, price_min_krw
        ) VALUES (
          '50700000-0000-4000-8000-000000000003',
          '50600000-0000-4000-8000-000000000001',
          'Pending replay option', 100000
        );
        UPDATE public.official_price_options
        SET price_min_krw = 110000
        WHERE id = '50700000-0000-4000-8000-000000000003';
        DELETE FROM public.official_price_options
        WHERE id = '50700000-0000-4000-8000-000000000003';
      `);

      // The review RPC owns the parent FOR UPDATE lock and may edit the
      // approved option set through its transaction-local trusted context.
      await db.query(`
        SELECT public.review_official_price(
          '50600000-0000-4000-8000-000000000002',
          '50800000-0000-4000-8000-000000000001',
          'save',
          '{
            "category":"studio","item_name":"Approved parent",
            "base_spec":null,"price_min_krw":1200000,"price_max_krw":null,
            "vat_note":null,"price_note":null,
            "source_quote":"Approved parent 1,200,000","confidence":0.95
          }'::jsonb,
          '[{
            "id":"50700000-0000-4000-8000-000000000002",
            "name":"Approved option","price_min_krw":250000,
            "price_max_krw":null,"unit":null,"condition":null,
            "raw_text":null,"source_quote":"Approved option 250,000",
            "confidence":0.95
          }]'::jsonb
        )
      `);
      await db.exec("RESET ROLE;");

      const reviewed = await db.query<{
        review_status: string;
        edited_by_admin: boolean;
        price_min_krw: number;
      }>(`
        SELECT price.review_status, price.edited_by_admin,
               option_row.price_min_krw
        FROM public.official_prices AS price
        JOIN public.official_price_options AS option_row
          ON option_row.official_price_id = price.id
        WHERE price.id = '50600000-0000-4000-8000-000000000002'
      `);
      expect(reviewed.rows[0]).toEqual({
        review_status: "pending",
        edited_by_admin: true,
        price_min_krw: 250000,
      });

      const fence = await db.query<{ definition: string; trigger_count: number }>(`
        SELECT
          pg_get_functiondef(
            'public.guard_official_price_option_write()'::regprocedure
          ) AS definition,
          (
            SELECT count(*)::int
            FROM pg_catalog.pg_trigger
            WHERE tgrelid = 'public.official_price_options'::regclass
              AND tgname = 'guard_official_price_option_write'
              AND NOT tgisinternal
          ) AS trigger_count
      `);
      expect(fence.rows[0]?.definition).toMatch(/ORDER BY price\.id\s+FOR SHARE/i);
      expect(fence.rows[0]?.trigger_count).toBe(1);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("reviews a price and its options atomically with strict provenance and ACLs", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.profiles (id, is_admin)
        VALUES
          ('54000000-0000-4000-8000-000000000001', true),
          ('54000000-0000-4000-8000-000000000002', false);
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('51000000-0000-4000-8000-000000000001', '2026Q3');
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name, price_min_krw,
          review_status, needs_review, source_file, source_quote, confidence,
          source_object_keys
        ) VALUES (
          '52000000-0000-4000-8000-000000000001',
          '51000000-0000-4000-8000-000000000001',
          'studio', '기본 촬영', 1200000,
          'pending', true, '원본/샘플.xlsx', '기본 촬영 120만원', 0.95,
          ARRAY[repeat('a', 64) || '.xlsx']
        );
        INSERT INTO public.official_price_options (
          id, official_price_id, name, price_min_krw,
          source_file, source_quote, confidence, source_object_keys
        ) VALUES (
          '53000000-0000-4000-8000-000000000001',
          '52000000-0000-4000-8000-000000000001',
          '야외 촬영', 200000,
          '원본/샘플.xlsx', '야외 촬영 +20만원', 0.9,
          ARRAY[repeat('a', 64) || '.xlsx']
        );
      `);

      const values = `'{"category":"studio","item_name":"기본 촬영",` +
        `"base_spec":null,"price_min_krw":1200000,"price_max_krw":null,` +
        `"vat_note":null,"price_note":null,"source_quote":"기본 촬영 120만원",` +
        `"confidence":0.95}'::jsonb`;
      const options = `'[{"id":"53000000-0000-4000-8000-000000000001",` +
        `"name":"야외 촬영","price_min_krw":200000,"price_max_krw":null,` +
        `"unit":null,"condition":null,"raw_text":null,` +
        `"source_quote":"야외 촬영 +20만원","confidence":0.9}]'::jsonb`;

      await db.exec("SET ROLE anon;");
      await expect(db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'approve', ${values}, ${options}
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'save', ${values.replace('"studio"', '"arbitrary"')}, ${options}
        )
      `)).rejects.toThrow();
      await expect(db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000002',
          'approve', ${values}, ${options}
        )
      `)).rejects.toThrow(/PRICE_REVIEW_ADMIN_REQUIRED/);
      await db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'approve', ${values}, ${options}
        )
      `);
      await db.exec("RESET ROLE;");

      const approved = await db.query<{
        review_status: string;
        needs_review: boolean;
        edited_by_admin: boolean;
        reviewed_by: string;
        reviewed_at: string;
        review_action: string;
      }>(`
        SELECT review_status, needs_review, edited_by_admin,
               reviewed_by, reviewed_at, review_action
        FROM public.official_prices
        WHERE id = '52000000-0000-4000-8000-000000000001'
      `);
      expect(approved.rows[0]).toMatchObject({
        review_status: "approved",
        needs_review: false,
        edited_by_admin: false,
        reviewed_by: "54000000-0000-4000-8000-000000000001",
        review_action: "approve",
      });
      expect(new Date(approved.rows[0]!.reviewed_at).getTime()).toBeGreaterThan(0);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET review_action = 'impersonated-action'
        WHERE id = '52000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow();

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'approve',
          '{"category":"studio","item_name":"롤백되어야 함",` +
            `"base_spec":null,"price_min_krw":1200000,"price_max_krw":null,` +
            `"vat_note":null,"price_note":null,"source_quote":"기본 촬영 120만원",` +
            `"confidence":0.95}'::jsonb,
          '[{"id":"53000000-0000-4000-8000-000000000001",` +
            `"name":"야외 촬영","price_min_krw":-1,"price_max_krw":null,` +
            `"unit":null,"condition":null,"raw_text":null,` +
            `"source_quote":null,"confidence":0.9}]'::jsonb
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      const afterFailure = await db.query<{
        item_name: string;
        review_status: string;
        option_count: number;
      }>(`
        SELECT price.item_name, price.review_status,
               count(option_row.id)::int AS option_count
        FROM public.official_prices AS price
        LEFT JOIN public.official_price_options AS option_row
          ON option_row.official_price_id = price.id
        WHERE price.id = '52000000-0000-4000-8000-000000000001'
        GROUP BY price.id
      `);
      expect(afterFailure.rows[0]).toEqual({
        item_name: "기본 촬영",
        review_status: "approved",
        option_count: 1,
      });

      const changedValues = values.replace("기본 촬영", "수정 촬영");
      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'save', ${changedValues},
          '[{
            "id":"53000000-0000-4000-8000-000000000001",
            "name":"야외 촬영","price_min_krw":250000,
            "price_max_krw":null,"unit":null,"condition":null,
            "raw_text":null,"source_quote":"야외 촬영 +25만원","confidence":0.9
          },{
            "id":null,"name":"앨범 추가","price_min_krw":100000,
            "price_max_krw":null,"unit":"1권","condition":null,
            "raw_text":null,"source_quote":"앨범 1권 +10만원","confidence":0.85
          }]'::jsonb
        )
      `);
      await db.exec("RESET ROLE;");

      const saved = await db.query<{
        item_name: string;
        review_status: string;
        needs_review: boolean;
        edited_by_admin: boolean;
      }>(`
        SELECT item_name, review_status, needs_review, edited_by_admin
        FROM public.official_prices
        WHERE id = '52000000-0000-4000-8000-000000000001'
      `);
      expect(saved.rows[0]).toEqual({
        item_name: "수정 촬영",
        review_status: "pending",
        needs_review: true,
        edited_by_admin: true,
      });
      const savedOptions = await db.query<{
        id: string;
        name: string;
        source_file: string;
        source_object_keys: string[];
      }>(`
        SELECT id, name, source_file, source_object_keys
        FROM public.official_price_options
        WHERE official_price_id = '52000000-0000-4000-8000-000000000001'
        ORDER BY name
      `);
      expect(savedOptions.rows).toHaveLength(2);
      expect(savedOptions.rows.find(({ name }) => name === "앨범 추가")).toMatchObject({
        source_file: "원본/샘플.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
      });

      const insertedOption = savedOptions.rows.find(({ name }) => name === "앨범 추가");
      expect(insertedOption).toBeDefined();
      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.review_official_price(
          '52000000-0000-4000-8000-000000000001',
          '54000000-0000-4000-8000-000000000001',
          'save', ${changedValues},
          '[{
            "id":"${insertedOption?.id}","name":"앨범 추가",
            "price_min_krw":100000,"price_max_krw":null,"unit":"1권",
            "condition":null,"raw_text":null,
            "source_quote":"앨범 1권 +10만원","confidence":0.85
          }]'::jsonb
        )
      `);
      await db.exec("RESET ROLE;");
      const replacedOptions = await db.query<{ name: string }>(`
        SELECT name FROM public.official_price_options
        WHERE official_price_id = '52000000-0000-4000-8000-000000000001'
      `);
      expect(replacedOptions.rows).toEqual([{ name: "앨범 추가" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("reviews agency packages atomically and publishes only approved evidence", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.profiles (id, is_admin)
        VALUES
          ('58000000-0000-4000-8000-000000000001', true),
          ('58000000-0000-4000-8000-000000000002', false);
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('55000000-0000-4000-8000-000000000001', '2026Q3');
        INSERT INTO public.agencies (id, name, region_code)
        VALUES (
          '56000000-0000-4000-8000-000000000001',
          'Evidence Agency', 'seoul_gangnam3'
        );
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, agency_id, package_name, category_scope,
          price_min_krw, options, review_status, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '57000000-0000-4000-8000-000000000001',
          '55000000-0000-4000-8000-000000000001',
          '56000000-0000-4000-8000-000000000001',
          'Essential Package', ARRAY['studio','dress','makeup'], 2900000,
          '[{
            "name":"Album upgrade","price_min_krw":200000,
            "price_max_krw":null,"unit":"one set","condition":null,
            "raw_text":"Album +200,000","source_quote":"Album +200,000"
          }]'::jsonb,
          'pending', 'agency/source.xlsx', 'Essential Package 2,900,000',
          ARRAY[repeat('e', 64) || '.xlsx'], 0.95
        );
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, agency_id, package_name, category_scope,
          price_min_krw, options, review_status
        ) VALUES (
          '57000000-0000-4000-8000-000000000002',
          '55000000-0000-4000-8000-000000000001',
          '56000000-0000-4000-8000-000000000001',
          'No Evidence Package', ARRAY['studio'], 2900000,
          '[]'::jsonb, 'pending'
        );
      `);

      const values = `$json$${JSON.stringify({
        package_name: "Essential Package",
        category_scope: ["studio", "dress", "makeup"],
        price_min_krw: 2_900_000,
        price_max_krw: null,
        vat_note: null,
        price_note: null,
        source_quote: "Essential Package 2,900,000",
        confidence: 0.95,
      })}$json$::jsonb`;
      const options = `$json$${JSON.stringify([{
        name: "Album upgrade",
        price_min_krw: 200_000,
        price_max_krw: null,
        unit: "one set",
        condition: null,
        raw_text: "Album +200,000",
        source_quote: "Album +200,000",
      }])}$json$::jsonb`;

      await db.exec("SET ROLE anon;");
      await expect(db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          'approve', ${values}, ${options}
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000002',
          '58000000-0000-4000-8000-000000000001',
          'approve', ${values}, ${options}
        )
      `)).rejects.toThrow();
      await expect(db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000002',
          'approve', ${values}, ${options}
        )
      `)).rejects.toThrow(/AGENCY_PACKAGE_REVIEW_ADMIN_REQUIRED/);
      await db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          'approve', ${values}, ${options}
        )
      `);
      await db.exec("RESET ROLE;");

      const approved = await db.query<{
        review_status: string;
        edited_by_admin: boolean;
        reviewed_by: string;
        reviewed_at: string;
        review_action: string;
      }>(`
        SELECT review_status, edited_by_admin,
               reviewed_by, reviewed_at, review_action
        FROM public.official_agency_packages
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `);
      expect(approved.rows[0]).toMatchObject({
        review_status: "approved",
        edited_by_admin: false,
        reviewed_by: "58000000-0000-4000-8000-000000000001",
        review_action: "approve",
      });
      expect(new Date(approved.rows[0]!.reviewed_at).getTime()).toBeGreaterThan(0);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET review_action = 'impersonated-action'
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow();
      const publicPackage = await db.query<{ package_name: string }>(`
        SELECT package_name
        FROM public.v_public_agency_packages
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `);
      expect(publicPackage.rows).toEqual([{ package_name: "Essential Package" }]);

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          'reject', ${values}, ${options}
        )
      `);
      await expect(db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          'approve',
          ${values.replace("Essential Package", "Corrupted Package")},
          '[{
            "name":"Broken option","price_min_krw":-1,
            "price_max_krw":null,"unit":null,"condition":null,
            "raw_text":null,"source_quote":"Broken -1"
          }]'::jsonb
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE;");

      const afterRollback = await db.query<{
        package_name: string;
        review_status: string;
        edited_by_admin: boolean;
        source_object_keys: string[];
      }>(`
        SELECT package_name, review_status, edited_by_admin, source_object_keys
        FROM public.official_agency_packages
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `);
      expect(afterRollback.rows[0]).toEqual({
        package_name: "Essential Package",
        review_status: "rejected",
        edited_by_admin: false,
        source_object_keys: ["e".repeat(64) + ".xlsx"],
      });
      const hiddenAfterReject = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.v_public_agency_packages
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `);
      expect(hiddenAfterReject.rows[0]?.count).toBe(0);

      const changedValues = values.replace("Essential Package", "Curated Package");
      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.review_official_agency_package(
          '57000000-0000-4000-8000-000000000001',
          '58000000-0000-4000-8000-000000000001',
          'save', ${changedValues}, ${options}
        )
      `);
      await db.exec("RESET ROLE;");
      const saved = await db.query<{
        package_name: string;
        review_status: string;
        edited_by_admin: boolean;
        reviewed_by: string;
        review_action: string;
      }>(`
        SELECT package_name, review_status, edited_by_admin,
               reviewed_by, review_action
        FROM public.official_agency_packages
        WHERE id = '57000000-0000-4000-8000-000000000001'
      `);
      expect(saved.rows[0]).toEqual({
        package_name: "Curated Package",
        review_status: "pending",
        edited_by_admin: true,
        reviewed_by: "58000000-0000-4000-8000-000000000001",
        review_action: "save",
      });
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("uses a stable source record key without conflating items that quote the same row", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('31000000-0000-4000-8000-000000000001', '2026Q3');
        INSERT INTO public.official_prices (
          snapshot_id, category, item_name, source_file, source_quote,
          source_record_key
        ) VALUES
          (
            '31000000-0000-4000-8000-000000000001', 'studio', '기본가',
            'same.xlsx', '같은 표 행', 'sheet1-row10-base'
          ),
          (
            '31000000-0000-4000-8000-000000000001', 'studio', '원본 옵션',
            'same.xlsx', '같은 표 행', 'sheet1-row10-originals'
          )
      `);

      await expect(
        db.exec(`
          INSERT INTO public.official_prices (
            snapshot_id, category, item_name, source_record_key
          ) VALUES (
            '31000000-0000-4000-8000-000000000001',
            'studio', '중복 키', 'sheet1-row10-base'
          )
        `)
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("is replay-safe and prevents duplicate snapshot identities", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await applyMigration(db);

      await db.exec(`
        INSERT INTO public.price_snapshots (period_label, source, is_current)
        VALUES ('2026Q3', 'kca_tprice', true)
      `);
      await expect(
        db.exec(`
          INSERT INTO public.price_snapshots (period_label, source)
          VALUES ('2026Q3', 'kca_tprice')
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.price_snapshots (period_label, source, is_current)
          VALUES ('2026Q4', 'kca_tprice', true)
        `)
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("seeds the four canonical category tag vocabularies", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      const result = await db.query<{
        category: string;
        tag_group: string;
        count: number;
      }>(`
        SELECT category, tag_group, count(*)::int AS count
        FROM public.tags
        GROUP BY category, tag_group
        ORDER BY category
      `);

      expect(result.rows).toEqual([
        { category: "dress", tag_group: "dress_detail", count: 12 },
        { category: "makeup", tag_group: "makeup_style", count: 7 },
        { category: "studio", tag_group: "shoot_style", count: 12 },
        { category: "venue", tag_group: "hall_mood", count: 7 },
      ]);
    } finally {
      await db.close();
    }
  });

  it("creates a private disclosure-raw bucket with an exact document allow-list", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      const bucket = await db.query<{
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>(`
        SELECT public, file_size_limit::int, allowed_mime_types
        FROM storage.buckets
        WHERE id = 'disclosure-raw'
      `);
      expect(bucket.rows[0]).toEqual({
        public: false,
        file_size_limit: 52_428_800,
        allowed_mime_types: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/x-hwp",
          "application/haansofthwp",
          "image/png",
        ],
      });

      const policies = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND (qual LIKE '%disclosure-raw%' OR with_check LIKE '%disclosure-raw%')
      `);
      expect(policies.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("allows idempotent disclosure extraction audit records without rewriting old logs", async () => {
    const db = await createBaselineDatabase();
    try {
      await db.exec(`
        INSERT INTO public.ai_interactions_log (interaction_type, metadata)
        VALUES ('community_agent_auto', '{"existing":true}')
      `);
      await applyMigration(db);

      await db.exec(`
        INSERT INTO public.ai_interactions_log (interaction_type, metadata)
        VALUES (
          'disclosure_extraction',
          '{"ingest_call_id":"extract:file-sha:prompt-v1"}'
        )
      `);
      await expect(
        db.exec(`
          INSERT INTO public.ai_interactions_log (interaction_type, metadata)
          VALUES (
            'disclosure_extraction',
            '{"ingest_call_id":"extract:file-sha:prompt-v1"}'
          )
        `)
      ).rejects.toThrow();

      const result = await db.query<{ count: number; existing_count: number }>(`
        SELECT
          count(*)::int AS count,
          count(*) FILTER (
            WHERE metadata @> '{"existing":true}'::jsonb
          )::int AS existing_count
        FROM public.ai_interactions_log
      `);
      expect(result.rows[0]).toEqual({ count: 2, existing_count: 1 });
    } finally {
      await db.close();
    }
  });

  it("publishes only approved safe projections and keeps staging service-only", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        -- Simulate legacy rows that predate the NOT VALID approval constraint.
        -- Public views must independently require needs_review=false.
        ALTER TABLE public.official_prices
          DROP CONSTRAINT official_prices_approved_provenance_check;
        ALTER TABLE public.official_agency_packages
          DROP CONSTRAINT official_agency_packages_approved_provenance_check;

        INSERT INTO public.vendors (
          id, name, category, status, attributes, slug, region_code
        ) VALUES
          (
            '40000000-0000-4000-8000-000000000001', '공개 업체', 'studio',
            'approved', '{"pet_friendly":true}',
            'public-vendor', 'seoul_gangnam3'
          ),
          (
            '40000000-0000-4000-8000-000000000002', '검수중 업체', 'studio',
            'pending', '{}', 'pending-vendor', 'seoul_gangnam3'
          );
        INSERT INTO public.vendor_enrichment_private (
          vendor_id, notes_internal, enriched_by
        ) VALUES (
          '40000000-0000-4000-8000-000000000001',
          '외부 공개 금지',
          '40000000-0000-4000-8000-000000000099'
        );
        INSERT INTO public.price_snapshots (
          id, period_label, source, is_current
        ) VALUES (
          '50000000-0000-4000-8000-000000000001', '2026Q3', 'kca_tprice', true
        );
        INSERT INTO public.agencies (id, name, region_code)
        VALUES (
          '60000000-0000-4000-8000-000000000001', '공개 대행사', 'seoul_gangnam3'
        );
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, category, item_name, price_min_krw,
          review_status, needs_review, source_file, source_quote, confidence,
          source_object_keys
        ) VALUES
          (
            '70000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            'studio', '공개 가격', 1000000, 'pending', true,
            'approved.xlsx', '공개 가격 100만원', 0.9,
            ARRAY[repeat('a', 64) || '.xlsx']
          ),
          (
            '70000000-0000-4000-8000-000000000002',
            '50000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000002',
            'studio', '업체 미승인 가격', 1100000, 'pending', true,
            'vendor-pending.xlsx', '가격 110만원', 0.9,
            ARRAY[repeat('b', 64) || '.xlsx']
          ),
          (
            '70000000-0000-4000-8000-000000000003',
            '50000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            'studio', '가격 미승인', 1200000, 'pending', true,
            'price-pending.xlsx', '가격 120만원', 0.7,
            ARRAY[repeat('c', 64) || '.xlsx']
          ),
          (
            '70000000-0000-4000-8000-000000000004',
            '50000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            'studio', '검토 필요 승인 가격', 1300000, 'pending', true,
            'legacy-review.xlsx', '검토 필요 가격 130만원', 0.9,
            ARRAY[repeat('e', 64) || '.xlsx']
          );
        INSERT INTO public.official_price_options (
          official_price_id, name, price_min_krw, source_file,
          source_quote, confidence, source_object_keys
        ) VALUES
          (
            '70000000-0000-4000-8000-000000000001', '추가 옵션', 100000,
            'approved.xlsx', '추가 10만원', 0.9,
            ARRAY[repeat('a', 64) || '.xlsx']
          ),
          (
            '70000000-0000-4000-8000-000000000004',
            '검토 필요 승인 옵션', 130000,
            'legacy-review.xlsx', '검토 필요 옵션 13만원', 0.9,
            ARRAY[repeat('e', 64) || '.xlsx']
          );
        UPDATE public.official_prices
        SET review_status = 'approved', needs_review = false
        WHERE id IN (
          '70000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000002'
        );
        UPDATE public.official_prices
        SET review_status = 'approved'
        WHERE id = '70000000-0000-4000-8000-000000000004';
        INSERT INTO public.official_agency_packages (
          snapshot_id, agency_id, package_name, category_scope,
          price_min_krw, review_status, needs_review, source_file, source_quote, confidence,
          source_object_keys
        ) VALUES
          (
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '공개 패키지', ARRAY['studio','dress','makeup'], 2900000,
            'approved', false, 'agency.xlsx', '스드메 290만원', 0.95,
            ARRAY[repeat('d', 64) || '.xlsx']
          ),
          (
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '검토 필요 승인 패키지', ARRAY['studio'], 3000000,
            'approved', true, 'legacy-review.xlsx', '검토 필요 300만원', 0.9,
            ARRAY[repeat('e', 64) || '.xlsx']
          );
      `);

      await db.exec("SET ROLE anon;");
      await expect(db.query("SELECT * FROM public.official_prices")).rejects.toThrow();
      await expect(db.query("SELECT * FROM public.events")).rejects.toThrow();
      await expect(
        db.query("SELECT source_object_keys FROM public.v_public_official_prices")
      ).rejects.toThrow();
      await expect(
        db.query("SELECT reviewed_by FROM public.v_public_official_prices")
      ).rejects.toThrow();
      await expect(
        db.query("SELECT reviewed_by FROM public.v_public_agency_packages")
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.events (anon_id, surface, event_type)
          VALUES ('anon', 'amora_reco', 'vendor_impression')
        `)
      ).rejects.toThrow();

      const prices = await db.query<{ item_name: string; is_current: boolean }>(`
        SELECT item_name, is_current FROM public.v_public_official_prices
      `);
      expect(prices.rows).toEqual([{
        item_name: "공개 가격",
        is_current: true,
      }]);
      const options = await db.query<{ name: string }>(`
        SELECT name FROM public.v_public_official_price_options
      `);
      expect(options.rows).toEqual([{ name: "추가 옵션" }]);
      const packages = await db.query<{ package_name: string }>(`
        SELECT package_name FROM public.v_public_agency_packages
      `);
      expect(packages.rows).toEqual([{ package_name: "공개 패키지" }]);
      const vendors = await db.query<{
        name: string;
        attributes: Record<string, unknown>;
      }>(`
        SELECT name, attributes FROM public.v_public_vendor_enrichment
      `);
      expect(vendors.rows).toEqual([
        { name: "공개 업체", attributes: { pet_friendly: true } },
      ]);
      await expect(
        db.query("SELECT * FROM public.vendor_enrichment_private")
      ).rejects.toThrow();

      await db.exec("RESET ROLE;");
      await db.exec("SET ROLE service_role;");
      await db.exec(`
        INSERT INTO public.events (anon_id, surface, event_type)
        VALUES ('amora', 'amora_reco', 'vendor_impression')
      `);
      const privateRows = await db.query<{ notes_internal: string }>(`
        SELECT notes_internal FROM public.vendor_enrichment_private
      `);
      expect(privateRows.rows[0]?.notes_internal).toBe("외부 공개 금지");
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("never publishes disclosure evidence attached to a merged agency tombstone", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.agencies (id, name, normalized_name, region_code)
        VALUES
          ('80000000-0000-4000-8000-000000000001', 'Active Agency', 'activeagency', 'seoul'),
          ('80000000-0000-4000-8000-000000000002', 'Merged Agency', 'mergedagency', 'seoul');
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('80000000-0000-4000-8000-000000000003', '2026Q3');
        INSERT INTO public.official_prices (
          id, snapshot_id, agency_id, category, item_name, price_min_krw,
          review_status, needs_review, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '80000000-0000-4000-8000-000000000004',
          '80000000-0000-4000-8000-000000000003',
          '80000000-0000-4000-8000-000000000002',
          'studio', 'Merged Agency Item', 1000000, 'pending', true,
          'merged.xlsx', 'Merged Agency Item 1000000',
          ARRAY[repeat('a', 64) || '.xlsx'], 0.9
        );
        INSERT INTO public.official_price_options (
          official_price_id, name, price_min_krw, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '80000000-0000-4000-8000-000000000004', 'Merged Agency Option',
          100000, 'merged.xlsx', 'Merged Agency Option 100000',
          ARRAY[repeat('a', 64) || '.xlsx'], 0.9
        );
        UPDATE public.official_prices
        SET review_status = 'approved', needs_review = false
        WHERE id = '80000000-0000-4000-8000-000000000004';
        INSERT INTO public.official_agency_packages (
          snapshot_id, agency_id, package_name, category_scope, price_min_krw,
          review_status, needs_review, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '80000000-0000-4000-8000-000000000003',
          '80000000-0000-4000-8000-000000000002',
          'Merged Agency Package', ARRAY['studio'], 2000000,
          'approved', false, 'merged.xlsx', 'Merged Agency Package 2000000',
          ARRAY[repeat('b', 64) || '.xlsx'], 0.9
        );

        -- Simulate a pre-fence/privileged tombstone that still has legacy rows.
        UPDATE public.agencies
        SET normalized_name = NULL,
            merged_into_agency_id = '80000000-0000-4000-8000-000000000001'
        WHERE id = '80000000-0000-4000-8000-000000000002';
      `);

      await db.exec("SET ROLE anon;");
      const prices = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.v_public_official_prices
      `);
      const options = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.v_public_official_price_options
      `);
      const packages = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.v_public_agency_packages
      `);
      expect(prices.rows[0]?.count).toBe(0);
      expect(options.rows[0]?.count).toBe(0);
      expect(packages.rows[0]?.count).toBe(0);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("merges same-region agency candidates atomically and preserves audit rows", async () => {
    const db = await createBaselineDatabase();
    try {
      await applyMigration(db);
      await db.exec(`
        INSERT INTO public.agencies (id, name, normalized_name, aliases, region_code)
        VALUES
          ('81000000-0000-4000-8000-000000000001', 'Primary Agency', 'primaryagency', ARRAY['Primary Alias'], 'gwangju'),
          ('81000000-0000-4000-8000-000000000002', 'Legacy Agency', 'legacyagency', ARRAY['Old Alias'], 'gwangju'),
          ('81000000-0000-4000-8000-000000000003', 'Third Agency', 'thirdagency', '{}', 'gwangju'),
          ('81000000-0000-4000-8000-000000000004', 'Other Region Agency', 'otherregionagency', '{}', 'busan');
        INSERT INTO public.price_snapshots (id, period_label)
        VALUES ('82000000-0000-4000-8000-000000000001', '2026Q3');
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, agency_id, package_name, category_scope,
          price_min_krw, source_file, source_quote, source_object_keys, confidence
        ) VALUES (
          '83000000-0000-4000-8000-000000000001',
          '82000000-0000-4000-8000-000000000001',
          '81000000-0000-4000-8000-000000000002',
          'Legacy Package', ARRAY['studio'], 1000000, 'legacy.xlsx',
          'Legacy Package 1000000', ARRAY[repeat('a', 64) || '.xlsx'], 0.9
        );
        INSERT INTO public.official_prices (id, snapshot_id, agency_id, category, item_name)
        VALUES (
          '84000000-0000-4000-8000-000000000001',
          '82000000-0000-4000-8000-000000000001',
          '81000000-0000-4000-8000-000000000002', 'studio', 'Legacy Item'
        );
        INSERT INTO public.agency_dedupe_candidates (
          id, left_agency_id, right_agency_id, similarity
        ) VALUES
          ('85000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 0.93),
          ('85000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 0.75),
          ('85000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000004', 0.75);
      `);

      await db.exec("SET ROLE anon;");
      await expect(db.query(`
        SELECT public.decide_agency_dedupe_candidate(
          '85000000-0000-4000-8000-000000000001', 'same',
          '81000000-0000-4000-8000-000000000001',
          '86000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow();
      await db.exec("RESET ROLE; SET ROLE service_role;");
      await expect(db.query(`
        SELECT public.decide_agency_dedupe_candidate(
          '85000000-0000-4000-8000-000000000003', 'same',
          '81000000-0000-4000-8000-000000000003',
          '86000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow();
      await db.query(`
        SELECT public.decide_agency_dedupe_candidate(
          '85000000-0000-4000-8000-000000000001', 'same',
          '81000000-0000-4000-8000-000000000001',
          '86000000-0000-4000-8000-000000000001'
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.official_agency_packages (
          snapshot_id, agency_id, package_name
        ) VALUES (
          '82000000-0000-4000-8000-000000000001',
          '81000000-0000-4000-8000-000000000002',
          'Late Package'
        )
      `)).rejects.toThrow(/AGENCY_REFERENCE_MERGED/);
      await expect(db.exec(`
        INSERT INTO public.official_prices (
          snapshot_id, agency_id, category, item_name
        ) VALUES (
          '82000000-0000-4000-8000-000000000001',
          '81000000-0000-4000-8000-000000000002',
          'studio', 'Late Item'
        )
      `)).rejects.toThrow(/AGENCY_REFERENCE_MERGED/);
      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET agency_id = '81000000-0000-4000-8000-000000000002'
        WHERE id = '83000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/AGENCY_REFERENCE_MERGED/);

      // A replay after rejected late writes must remain an idempotent no-op.
      await db.query(`
        SELECT public.decide_agency_dedupe_candidate(
          '85000000-0000-4000-8000-000000000001', 'same',
          '81000000-0000-4000-8000-000000000001',
          '86000000-0000-4000-8000-000000000001'
        )
      `);
      await db.exec("RESET ROLE;");

      const agencies = await db.query<{
        id: string; normalized_name: string | null; aliases: string[];
        merged_into_agency_id: string | null;
      }>(`
        SELECT id, normalized_name, aliases, merged_into_agency_id
        FROM public.agencies
        WHERE id IN ('81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002')
        ORDER BY id
      `);
      expect(agencies.rows[0]).toMatchObject({
        normalized_name: "primaryagency",
        aliases: ["Legacy Agency", "Old Alias", "Primary Alias"],
        merged_into_agency_id: null,
      });
      expect(agencies.rows[1]).toMatchObject({
        normalized_name: null,
        merged_into_agency_id: "81000000-0000-4000-8000-000000000001",
      });
      const packageOwner = await db.query<{ agency_id: string }>(`
        SELECT agency_id FROM public.official_agency_packages
        WHERE id = '83000000-0000-4000-8000-000000000001'
      `);
      expect(packageOwner.rows[0]?.agency_id).toBe("81000000-0000-4000-8000-000000000001");
      const priceOwner = await db.query<{ agency_id: string }>(`
        SELECT agency_id FROM public.official_prices
        WHERE id = '84000000-0000-4000-8000-000000000001'
      `);
      expect(priceOwner.rows[0]?.agency_id).toBe("81000000-0000-4000-8000-000000000001");
      const decisions = await db.query<{ id: string; status: string }>(`
        SELECT id, status FROM public.agency_dedupe_candidates ORDER BY id
      `);
      expect(decisions.rows).toEqual([
        { id: "85000000-0000-4000-8000-000000000001", status: "same" },
        { id: "85000000-0000-4000-8000-000000000002", status: "superseded" },
        { id: "85000000-0000-4000-8000-000000000003", status: "pending" },
      ]);
      const fences = await db.query<{ trigger_name: string }>(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND trigger_name IN (
            'official_agency_packages_active_agency_fence',
            'official_prices_active_agency_fence'
          )
        ORDER BY trigger_name
      `);
      expect([...new Set(fences.rows.map(({ trigger_name }) => trigger_name))]).toEqual([
        "official_agency_packages_active_agency_fence",
        "official_prices_active_agency_fence",
      ]);
      const fenceFunction = await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef(
          'public.enforce_active_agency_reference()'::regprocedure
        ) AS definition
      `);
      expect(fenceFunction.rows[0]?.definition).toContain("FOR SHARE");
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps drafts private and atomically publishes consumer data with owned state and analytics", async () => {
    const db = await createBaselineDatabase();
    const adminId = "91000000-0000-4000-8000-000000000001";
    const userId = "91000000-0000-4000-8000-000000000002";
    const coupleId = "91000000-0000-4000-8000-000000000003";
    const vendorId = "92000000-0000-4000-8000-000000000001";
    const agencyId = "93000000-0000-4000-8000-000000000001";
    const snapshotId = "94000000-0000-4000-8000-000000000001";
    const priceId = "95000000-0000-4000-8000-000000000001";
    try {
      await db.exec(`
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        ALTER TABLE public.profiles ADD COLUMN couple_id uuid;
        CREATE TABLE public.wedding_journeys (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          couple_id uuid NOT NULL,
          wedding_date date
        );
        CREATE TABLE public.vendor_favorites (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, vendor_id)
        );
        GRANT SELECT, INSERT, DELETE ON public.vendor_favorites TO service_role;
      `);
      await applyMigration(db);
      await db.exec(snapshotPromotionMigration);
      // PGlite does not bundle pg_trgm. A deterministic compatibility function
      // lets this test exercise the migration's remaining PostgreSQL behavior;
      // hosted Supabase supplies the real extension.
      await db.exec(`
        CREATE FUNCTION public.similarity(left_value text, right_value text)
        RETURNS real LANGUAGE sql IMMUTABLE AS $$
          SELECT CASE WHEN left_value = right_value THEN 1::real ELSE 0::real END
        $$
      `);
      await db.exec(priceConsumerMigration.replace(
        "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
        "-- pg_trgm supplied by the PGlite test compatibility function",
      ));

      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${userId}');
        INSERT INTO public.profiles (id, is_admin, couple_id) VALUES
          ('${adminId}', true, NULL),
          ('${userId}', false, '${coupleId}');
        INSERT INTO public.wedding_journeys (couple_id, wedding_date)
        VALUES ('${coupleId}', CURRENT_DATE + 100);
        INSERT INTO public.vendors (
          id, name, category, status, slug, aliases
        ) VALUES (
          '${vendorId}', '샘플 스튜디오 Z', 'studio', 'approved',
          'sample-studio-z', ARRAY['샘플 구상호 Z']
        );
        INSERT INTO public.agencies (
          id, name, normalized_name, slug, display_name
        ) VALUES (
          '${agencyId}', '샘플 대행사 Z', '샘플대행사z',
          'sample-agency-z', '샘플 대행사'
        );
        INSERT INTO public.price_snapshots (
          id, period_label, source, source_note, collected_at
        ) VALUES (
          '${snapshotId}', '2099Q1', 'kca_tprice',
          '한국소비자원 참가격', CURRENT_DATE
        );
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, agency_id, category, item_name,
          price_min_krw, price_max_krw, review_status, needs_review,
          source_file, source_quote, source_object_keys, confidence
        ) VALUES (
          '${priceId}', '${snapshotId}', '${vendorId}', '${agencyId}',
          'studio', '샘플 기본 촬영', 1230000, 1230000,
          'pending', true, 'sample.xlsx', '샘플 기본 촬영 123만원',
          ARRAY[repeat('a', 64) || '.xlsx'], 0.99
        );
        INSERT INTO public.official_price_options (
          official_price_id, name, price_min_krw, price_max_krw,
          raw_text, is_effectively_mandatory, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '${priceId}', '샘플 옵션', 10000, 10000, '샘플 옵션 1만원',
          true, 'sample.xlsx', '샘플 옵션 1만원',
          ARRAY[repeat('a', 64) || '.xlsx'], 0.99
        );
        UPDATE public.official_prices
        SET review_status = 'approved', needs_review = false
        WHERE id = '${priceId}';
      `);

      await db.exec("SET ROLE anon;");
      const hidden = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM public.v_public_prices
      `);
      expect(hidden.rows[0]?.count).toBe(0);
      await db.exec("RESET ROLE; SET ROLE service_role;");
      await db.query(
        "SELECT public.promote_price_snapshot($1, $2)",
        [snapshotId, adminId],
      );
      await db.exec("RESET ROLE; SET ROLE anon;");
      const visible = await db.query<{
        vendor_name: string;
        agency_name: string;
        is_current: boolean;
      }>(`
        SELECT vendor_name, agency_name, is_current
        FROM public.v_public_prices
      `);
      expect(visible.rows).toEqual([{
        vendor_name: "샘플 스튜디오 Z",
        agency_name: "샘플 대행사",
        is_current: true,
      }]);

      await db.exec("RESET ROLE; SET ROLE service_role;");
      const published = await db.query<{
        published: boolean;
        published_at: string | null;
      }>(`
        SELECT published, published_at::text
        FROM public.price_snapshots WHERE id = '${snapshotId}'
      `);
      expect(published.rows[0]).toMatchObject({ published: true });
      expect(published.rows[0]?.published_at).not.toBeNull();
      const matches = await db.query<{ match_kind: string }>(
        "SELECT match_kind FROM public.match_vendor_for_price_upload($1, $2)",
        ["샘플 구상호 Z", "studio"],
      );
      expect(matches.rows[0]?.match_kind).toBe("exact_alias");

      await db.exec("RESET ROLE; SET ROLE authenticated;");
      await db.query(
        "SELECT set_config('request.jwt.claim.sub', $1, false)",
        [userId],
      );
      await db.exec(`
        INSERT INTO public.wishlists (user_id, vendor_id)
        VALUES ('${userId}', '${vendorId}')
      `);
      await db.exec("RESET ROLE; SET ROLE service_role;");
      const legacyFavorite = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM public.vendor_favorites
        WHERE user_id = '${userId}' AND vendor_id = '${vendorId}'
      `);
      expect(legacyFavorite.rows[0]?.count).toBe(1);

      await db.exec(`
        INSERT INTO public.events (
          anon_id, user_id, session_id, event_type, vendor_id, surface,
          context, weight
        ) VALUES (
          'consumer-test', '${userId}', 'session-test', 'wishlist_add',
          '${vendorId}', 'price_list', '{"category":"studio"}'::jsonb, 5
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.events (
          anon_id, session_id, event_type, vendor_id, surface, context, weight
        ) VALUES (
          'forged', 'forged', 'wishlist_add', '${vendorId}', 'price_list',
          '{"email":"private@example.test"}'::jsonb, 999
        )
      `)).rejects.toThrow();
      await expect(db.exec(`UPDATE public.events SET weight = 0`))
        .rejects.toThrow(/EVENTS_ARE_APPEND_ONLY|permission denied/iu);
      await db.query(`
        SELECT public.aggregate_vendor_demand_daily(
          (now() AT TIME ZONE 'Asia/Seoul')::date
        )
      `);
      const demand = await db.query<{
        wishlist_adds: number;
        weighted_score: string;
        qualified_score: string;
      }>(`
        SELECT wishlist_adds, weighted_score::text, qualified_score::text
        FROM public.vendor_demand_daily
        WHERE vendor_id = '${vendorId}'
      `);
      expect(demand.rows).toEqual([{
        wishlist_adds: 1,
        weighted_score: "5",
        qualified_score: "5",
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
