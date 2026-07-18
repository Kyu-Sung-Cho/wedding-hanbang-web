// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8"
  );
}

const foundation = migration(
  "20260718130000_vendor_disclosure_foundation.sql"
);
const previews = migration("20260718140000_disclosure_source_previews.sql");
const snapshotPromotion = migration(
  "20260718150000_price_snapshot_promotion.sql"
);
const aliasProposals = migration(
  "20260718160000_vendor_alias_proposals.sql"
);
const optimisticConcurrency = migration(
  "20260718170000_admin_review_optimistic_concurrency.sql"
);

const ADMIN_ID = "a0000000-0000-4000-8000-000000000001";
const PRICE_ID = "b0000000-0000-4000-8000-000000000001";
const OTHER_PRICE_ID = "b0000000-0000-4000-8000-000000000002";
const PROPOSAL_ID = "b0000000-0000-4000-8000-000000000003";
const SNAPSHOT_ID = "c0000000-0000-4000-8000-000000000001";
const VENDOR_ID = "d0000000-0000-4000-8000-000000000001";
const SOURCE_KEY = `${"a".repeat(64)}.xlsx`;
const PREVIEW_KEY = `${"b".repeat(64)}.txt`;
const AGENCY_ID = "e0000000-0000-4000-8000-000000000001";
const PACKAGE_ID = "f0000000-0000-4000-8000-000000000001";
const OTHER_PACKAGE_ID = "f0000000-0000-4000-8000-000000000002";
const PRESERVED_VENDOR_ID = "d0000000-0000-4000-8000-000000000010";
const LOSING_VENDOR_ID = "d0000000-0000-4000-8000-000000000011";
const PENDING_PROPOSAL_ID = "b0000000-0000-4000-8000-000000000004";
const DEDUPE_CANDIDATE_ID = "b0000000-0000-4000-8000-000000000005";

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
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
  await db.exec(foundation);
  await db.exec(previews);
  await db.exec(snapshotPromotion);
  await db.exec(aliasProposals);
  await db.exec(optimisticConcurrency);
  return db;
}

function priceValues(itemName: string) {
  return JSON.stringify({
    category: "studio",
    item_name: itemName,
    base_spec: null,
    price_min_krw: 1_000_000,
    price_max_krw: 1_200_000,
    vat_note: null,
    price_note: null,
    source_quote: "공식 촬영 가격 100만원",
    confidence: 0.9,
  });
}

async function seedPrice(db: PGlite) {
  await db.exec(`
    INSERT INTO public.profiles (id, is_admin)
    VALUES ('${ADMIN_ID}', true);
    INSERT INTO public.vendors (id, name, category, status)
    VALUES ('${VENDOR_ID}', '테스트 스튜디오', 'studio', 'approved');
    INSERT INTO public.price_snapshots (id, period_label, source)
    VALUES ('${SNAPSHOT_ID}', '2026-Q3', 'official_test');
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, category, item_name,
      price_min_krw, price_max_krw, review_status, needs_review,
      source_file, source_quote, source_object_keys, source_preview_keys,
      confidence
    ) VALUES (
      '${PRICE_ID}', '${SNAPSHOT_ID}', '${VENDOR_ID}', 'studio', '초기 촬영',
      1000000, 1200000, 'pending', true,
      'official.xlsx', '공식 촬영 가격 100만원', ARRAY['${SOURCE_KEY}'],
      ARRAY['${PREVIEW_KEY}'], 0.9
    );
  `);
}

async function reviewPrice(
  db: PGlite,
  action: "save" | "approve" | "reject",
  expectedVersion: number,
  itemName: string,
  selectedProposalIds: string[] = []
) {
  const selectedIds = `{${selectedProposalIds.join(",")}}`;
  return db.query(`
    SELECT public.review_official_price_with_alias_proposals(
      '${PRICE_ID}',
      '${ADMIN_ID}',
      '${action}',
      $json$${priceValues(itemName)}$json$::jsonb,
      '[]'::jsonb,
      '${selectedIds}'::uuid[],
      ${expectedVersion}::bigint
    )
  `);
}

function packageValues(packageName: string) {
  return JSON.stringify({
    package_name: packageName,
    category_scope: ["studio", "dress", "makeup"],
    price_min_krw: 3_000_000,
    price_max_krw: 4_000_000,
    vat_note: null,
    price_note: null,
    source_quote: "공식 패키지 가격 300만원",
    confidence: 0.9,
  });
}

async function seedPackage(db: PGlite) {
  await db.exec(`
    INSERT INTO public.profiles (id, is_admin)
    VALUES ('${ADMIN_ID}', true);
    INSERT INTO public.agencies (id, name, region_code)
    VALUES ('${AGENCY_ID}', '테스트 대행사', 'seoul');
    INSERT INTO public.price_snapshots (id, period_label, source)
    VALUES ('${SNAPSHOT_ID}', '2026-Q3', 'official_test');
    INSERT INTO public.official_agency_packages (
      id, snapshot_id, agency_id, package_name, category_scope,
      price_min_krw, price_max_krw, review_status, needs_review,
      source_file, source_quote, source_object_keys, source_preview_keys,
      confidence
    ) VALUES
      (
        '${PACKAGE_ID}', '${SNAPSHOT_ID}', '${AGENCY_ID}', '초기 패키지',
        ARRAY['studio', 'dress', 'makeup'], 3000000, 4000000,
        'pending', true, 'official-package.xlsx',
        '공식 패키지 가격 300만원', ARRAY['${SOURCE_KEY}'],
        ARRAY['${PREVIEW_KEY}'], 0.9
      ),
      (
        '${OTHER_PACKAGE_ID}', '${SNAPSHOT_ID}', '${AGENCY_ID}',
        '관계없는 패키지', ARRAY['studio'], 1000000, 1200000,
        'pending', true, 'other-package.xlsx',
        '관계없는 가격 100만원', ARRAY['${SOURCE_KEY}'], '{}'::text[], 0.8
      );
  `);
}

async function reviewPackage(
  db: PGlite,
  action: "save" | "approve" | "reject",
  expectedVersion: number,
  packageName: string
) {
  return db.query(`
    SELECT public.review_official_agency_package(
      '${PACKAGE_ID}',
      '${ADMIN_ID}',
      '${action}',
      $json$${packageValues(packageName)}$json$::jsonb,
      '[]'::jsonb,
      ${expectedVersion}::bigint
    )
  `);
}

describe("admin review optimistic concurrency migration", () => {
  it("increments an opaque price review version and rejects a stale save without writes", async () => {
    const db = await createDatabase();
    try {
      await seedPrice(db);
      await db.exec("SET ROLE service_role;");
      await reviewPrice(db, "save", 0, "관리자 최신 촬영");
      await expect(
        reviewPrice(db, "save", 0, "오래된 폼의 촬영")
      ).rejects.toThrow(/PRICE_REVIEW_VERSION_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const saved = await db.query<{
        item_name: string;
        review_status: string;
        review_version: number;
        source_preview_keys: string[];
      }>(`
        SELECT item_name, review_status, review_version, source_preview_keys
        FROM public.official_prices
        WHERE id = '${PRICE_ID}'
      `);
      expect(saved.rows).toEqual([
        {
          item_name: "관리자 최신 촬영",
          review_status: "pending",
          review_version: 1,
          source_preview_keys: [PREVIEW_KEY],
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps stale approve/reject atomic and lets a fresh approval decide aliases", async () => {
    const db = await createDatabase();
    try {
      await seedPrice(db);
      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, category, item_name,
          review_status, needs_review, source_file, source_quote,
          source_object_keys, confidence
        ) VALUES (
          '${OTHER_PRICE_ID}', '${SNAPSHOT_ID}', '${VENDOR_ID}',
          'studio', '관계없는 가격', 'pending', true, 'other.xlsx',
          '관계없는 가격 50만원', ARRAY['${SOURCE_KEY}'], 0.8
        );
        INSERT INTO public.vendor_alias_proposals (
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES (
          '${PROPOSAL_ID}', '${PRICE_ID}', '${VENDOR_ID}',
          '옛스튜디오', '옛스튜디오'
        );
      `);

      await db.exec("SET ROLE service_role;");
      await reviewPrice(db, "save", 0, "최신 저장본");
      await expect(
        reviewPrice(db, "approve", 0, "오래된 승인본", [PROPOSAL_ID])
      ).rejects.toThrow(/PRICE_REVIEW_VERSION_CONFLICT/u);
      await expect(
        reviewPrice(db, "reject", 0, "오래된 반려본")
      ).rejects.toThrow(/PRICE_REVIEW_VERSION_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const beforeFresh = await db.query<{
        item_name: string;
        review_status: string;
        review_version: number;
        proposal_status: string;
        aliases: string[];
        other_version: number;
      }>(`
        SELECT
          price.item_name,
          price.review_status,
          price.review_version,
          proposal.status AS proposal_status,
          vendor.aliases,
          other_price.review_version AS other_version
        FROM public.official_prices AS price
        JOIN public.vendor_alias_proposals AS proposal
          ON proposal.official_price_id = price.id
        JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
        JOIN public.official_prices AS other_price
          ON other_price.id = '${OTHER_PRICE_ID}'
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(beforeFresh.rows).toEqual([
        {
          item_name: "최신 저장본",
          review_status: "pending",
          review_version: 1,
          proposal_status: "pending",
          aliases: [],
          other_version: 0,
        },
      ]);

      await db.exec("SET ROLE service_role;");
      await reviewPrice(db, "approve", 1, "최종 승인본", [PROPOSAL_ID]);
      await db.exec("RESET ROLE;");

      const approved = await db.query<{
        item_name: string;
        review_status: string;
        review_version: number;
        proposal_status: string;
        aliases: string[];
        source_preview_keys: string[];
      }>(`
        SELECT
          price.item_name,
          price.review_status,
          price.review_version,
          proposal.status AS proposal_status,
          vendor.aliases,
          price.source_preview_keys
        FROM public.official_prices AS price
        JOIN public.vendor_alias_proposals AS proposal
          ON proposal.official_price_id = price.id
        JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(approved.rows).toEqual([
        {
          item_name: "최종 승인본",
          review_status: "approved",
          review_version: 2,
          proposal_status: "approved",
          aliases: ["옛스튜디오"],
          source_preview_keys: [PREVIEW_KEY],
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("blocks stale package save/approve/reject and accepts the next fresh version", async () => {
    const db = await createDatabase();
    try {
      await seedPackage(db);
      await db.exec("SET ROLE service_role;");
      await reviewPackage(db, "save", 0, "최신 패키지");
      for (const action of ["save", "approve", "reject"] as const) {
        await expect(
          reviewPackage(db, action, 0, `오래된 ${action}`)
        ).rejects.toThrow(/AGENCY_PACKAGE_REVIEW_VERSION_CONFLICT/u);
      }
      await db.exec("RESET ROLE;");

      const staleState = await db.query<{
        package_name: string;
        review_status: string;
        review_version: number;
        source_preview_keys: string[];
        other_version: number;
      }>(`
        SELECT
          package_row.package_name,
          package_row.review_status,
          package_row.review_version,
          package_row.source_preview_keys,
          other_package.review_version AS other_version
        FROM public.official_agency_packages AS package_row
        JOIN public.official_agency_packages AS other_package
          ON other_package.id = '${OTHER_PACKAGE_ID}'
        WHERE package_row.id = '${PACKAGE_ID}'
      `);
      expect(staleState.rows).toEqual([
        {
          package_name: "최신 패키지",
          review_status: "pending",
          review_version: 1,
          source_preview_keys: [PREVIEW_KEY],
          other_version: 0,
        },
      ]);

      await db.exec("SET ROLE service_role;");
      await reviewPackage(db, "approve", 1, "최종 패키지");
      await db.exec("RESET ROLE;");
      const approved = await db.query<{
        package_name: string;
        review_status: string;
        review_version: number;
      }>(`
        SELECT package_name, review_status, review_version
        FROM public.official_agency_packages
        WHERE id = '${PACKAGE_ID}'
      `);
      expect(approved.rows).toEqual([
        {
          package_name: "최종 패키지",
          review_status: "approved",
          review_version: 2,
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows virgin pending loader recovery but blocks direct reviewed parent DML", async () => {
    const priceDb = await createDatabase();
    try {
      await seedPrice(priceDb);
      await priceDb.exec("SET ROLE service_role;");
      await priceDb.exec(`
        UPDATE public.official_prices
        SET item_name = '로더 복구 촬영',
            validation_issue_codes = ARRAY['partial_recovery']
        WHERE id = '${PRICE_ID}'
      `);

      await priceDb.query(`
        SELECT set_config(
          'hanbang.review_official_price_parent_id',
          '${PRICE_ID}',
          false
        )
      `);
      await expect(priceDb.exec(`
        UPDATE public.official_prices
        SET review_status = 'approved', needs_review = false
        WHERE id = '${PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await priceDb.query(`
        SELECT set_config('hanbang.review_official_price_parent_id', '', false)
      `);

      await reviewPrice(priceDb, "save", 0, "관리자 저장 촬영");
      await expect(priceDb.exec(`
        UPDATE public.official_prices
        SET item_name = '직접 우회 촬영'
        WHERE id = '${PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await expect(priceDb.exec(`
        DELETE FROM public.official_prices WHERE id = '${PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await expect(priceDb.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name, review_status, needs_review
        ) VALUES (
          gen_random_uuid(), '${SNAPSHOT_ID}', 'studio',
          '직접 반려 삽입', 'rejected', true
        )
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
    } finally {
      await priceDb.exec("RESET ROLE;").catch(() => undefined);
      await priceDb.close();
    }

    const packageDb = await createDatabase();
    try {
      await seedPackage(packageDb);
      await packageDb.exec("SET ROLE service_role;");
      await packageDb.exec(`
        UPDATE public.official_agency_packages
        SET package_name = '로더 복구 패키지',
            validation_issue_codes = ARRAY['partial_recovery']
        WHERE id = '${PACKAGE_ID}'
      `);
      await expect(packageDb.exec(`
        UPDATE public.official_agency_packages
        SET review_status = 'approved', needs_review = false
        WHERE id = '${PACKAGE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);

      await reviewPackage(packageDb, "save", 0, "관리자 저장 패키지");
      await expect(packageDb.exec(`
        UPDATE public.official_agency_packages
        SET package_name = '직접 우회 패키지'
        WHERE id = '${PACKAGE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
      await expect(packageDb.exec(`
        DELETE FROM public.official_agency_packages WHERE id = '${PACKAGE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED/u);
    } finally {
      await packageDb.exec("RESET ROLE;").catch(() => undefined);
      await packageDb.close();
    }
  }, 60_000);

  it("writes one private append-only audit event only for a committed review", async () => {
    const db = await createDatabase();
    try {
      await seedPrice(db);
      await db.exec("SET ROLE service_role;");
      await reviewPrice(db, "save", 0, "감사 대상 촬영");
      await expect(
        reviewPrice(db, "reject", 0, "오래된 반려")
      ).rejects.toThrow(/PRICE_REVIEW_VERSION_CONFLICT/u);

      const events = await db.query<{
        entity_kind: string;
        entity_id: string;
        actor_id: string;
        action: string;
        from_status: string;
        to_status: string;
        from_review_version: number;
        to_review_version: number;
        change_hash: string;
        serialized: string;
      }>(`
        SELECT
          event.entity_kind,
          event.entity_id,
          event.actor_id,
          event.action,
          event.from_status,
          event.to_status,
          event.from_review_version,
          event.to_review_version,
          event.change_hash,
          row_to_json(event)::text AS serialized
        FROM public.official_review_events AS event
        WHERE event.entity_id = '${PRICE_ID}'
      `);
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toMatchObject({
        entity_kind: "price",
        entity_id: PRICE_ID,
        actor_id: ADMIN_ID,
        action: "save",
        from_status: "pending",
        to_status: "pending",
        from_review_version: 0,
        to_review_version: 1,
      });
      expect(events.rows[0]?.change_hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(events.rows[0]?.serialized).not.toContain("official.xlsx");
      expect(events.rows[0]?.serialized).not.toContain(SOURCE_KEY);
      expect(events.rows[0]?.serialized).not.toContain(PREVIEW_KEY);
      expect(events.rows[0]?.serialized).not.toContain("공식 촬영 가격");

      await expect(db.exec(`
        INSERT INTO public.official_review_events (
          entity_kind, entity_id, actor_id, action,
          from_status, to_status, from_review_version, to_review_version,
          change_hash
        ) VALUES (
          'price', '${PRICE_ID}', '${ADMIN_ID}', 'save',
          'pending', 'pending', 1, 2, repeat('0', 64)
        )
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE;");

      await expect(db.exec(`
        UPDATE public.official_review_events
        SET action = 'reject'
        WHERE entity_id = '${PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(db.exec(`
        DELETE FROM public.official_review_events
        WHERE entity_id = '${PRICE_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(db.exec(`
        TRUNCATE TABLE public.official_review_events
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("accepts an exact alias-aware network replay but rejects a conflicting replay", async () => {
    const db = await createDatabase();
    try {
      await seedPrice(db);
      await db.exec(`
        INSERT INTO public.vendor_alias_proposals (
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES (
          '${PROPOSAL_ID}', '${PRICE_ID}', '${VENDOR_ID}',
          '옛스튜디오', '옛스튜디오'
        );
      `);
      await db.exec("SET ROLE service_role;");
      await reviewPrice(db, "approve", 0, "동일 승인본", [PROPOSAL_ID]);
      await expect(
        reviewPrice(db, "approve", 0, "동일 승인본", [PROPOSAL_ID])
      ).resolves.toBeDefined();
      await expect(
        reviewPrice(db, "approve", 0, "다른 승인본", [PROPOSAL_ID])
      ).rejects.toThrow(/PRICE_REVIEW_VERSION_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const state = await db.query<{
        item_name: string;
        review_version: number;
        event_count: number;
        proposal_status: string;
        aliases: string[];
      }>(`
        SELECT
          price.item_name,
          price.review_version,
          (
            SELECT count(*)::integer
            FROM public.official_review_events AS event
            WHERE event.entity_kind = 'price'
              AND event.entity_id = price.id
          ) AS event_count,
          proposal.status AS proposal_status,
          vendor.aliases
        FROM public.official_prices AS price
        JOIN public.vendor_alias_proposals AS proposal
          ON proposal.official_price_id = price.id
        JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(state.rows).toEqual([
        {
          item_name: "동일 승인본",
          review_version: 1,
          event_count: 1,
          proposal_status: "approved",
          aliases: ["옛스튜디오"],
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("accepts only the exact immediately-replayed package request", async () => {
    const db = await createDatabase();
    try {
      await seedPackage(db);
      await db.exec("SET ROLE service_role;");
      await reviewPackage(db, "approve", 0, "동일 패키지 승인");
      await expect(
        reviewPackage(db, "approve", 0, "동일 패키지 승인")
      ).resolves.toBeDefined();
      await expect(
        reviewPackage(db, "approve", 0, "다른 패키지 승인")
      ).rejects.toThrow(/AGENCY_PACKAGE_REVIEW_VERSION_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const state = await db.query<{
        package_name: string;
        review_version: number;
        event_count: number;
      }>(`
        SELECT
          package_row.package_name,
          package_row.review_version,
          (
            SELECT count(*)::integer
            FROM public.official_review_events AS event
            WHERE event.entity_kind = 'agency_package'
              AND event.entity_id = package_row.id
          ) AS event_count
        FROM public.official_agency_packages AS package_row
        WHERE package_row.id = '${PACKAGE_ID}'
      `);
      expect(state.rows).toEqual([
        {
          package_name: "동일 패키지 승인",
          review_version: 1,
          event_count: 1,
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is migration-replay safe and exposes only versioned review entry points", async () => {
    const db = await createDatabase();
    try {
      await db.exec(optimisticConcurrency);
      const acl = await db.query<{
        anon_price: boolean;
        authenticated_price: boolean;
        service_price: boolean;
        service_price_canonical: boolean;
        service_price_legacy_alias: boolean;
        service_price_legacy: boolean;
        service_package: boolean;
        service_package_legacy: boolean;
        service_audit_select: boolean;
        service_audit_insert: boolean;
        price_security_definer: boolean;
        package_security_definer: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'anon',
            'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[],bigint)',
            'EXECUTE'
          ) AS anon_price,
          has_function_privilege(
            'authenticated',
            'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[],bigint)',
            'EXECUTE'
          ) AS authenticated_price,
          has_function_privilege(
            'service_role',
            'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[],bigint)',
            'EXECUTE'
          ) AS service_price,
          has_function_privilege(
            'service_role',
            'public.review_official_price(uuid,uuid,text,jsonb,jsonb,bigint)',
            'EXECUTE'
          ) AS service_price_canonical,
          has_function_privilege(
            'service_role',
            'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[])',
            'EXECUTE'
          ) AS service_price_legacy_alias,
          has_function_privilege(
            'service_role',
            'public.review_official_price(uuid,uuid,text,jsonb,jsonb)',
            'EXECUTE'
          ) AS service_price_legacy,
          has_function_privilege(
            'service_role',
            'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb,bigint)',
            'EXECUTE'
          ) AS service_package,
          has_function_privilege(
            'service_role',
            'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb)',
            'EXECUTE'
          ) AS service_package_legacy,
          has_table_privilege(
            'service_role', 'public.official_review_events', 'SELECT'
          ) AS service_audit_select,
          has_table_privilege(
            'service_role', 'public.official_review_events', 'INSERT'
          ) AS service_audit_insert,
          (
            SELECT proc.prosecdef
            FROM pg_catalog.pg_proc AS proc
            WHERE proc.oid =
              'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[],bigint)'::regprocedure
          ) AS price_security_definer,
          (
            SELECT proc.prosecdef
            FROM pg_catalog.pg_proc AS proc
            WHERE proc.oid =
              'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb,bigint)'::regprocedure
          ) AS package_security_definer
      `);
      expect(acl.rows).toEqual([
        {
          anon_price: false,
          authenticated_price: false,
          service_price: true,
          service_price_canonical: false,
          service_price_legacy_alias: false,
          service_price_legacy: false,
          service_package: true,
          service_package_legacy: false,
          service_audit_select: true,
          service_audit_insert: false,
          price_security_definer: true,
          package_security_definer: true,
        },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("uses the vendor-before-price lock order and retries a changed relationship", async () => {
    const db = await createDatabase();
    try {
      const definition = await db.query<{ source: string }>(`
        SELECT pg_get_functiondef(
          'public.review_official_price_with_alias_proposals(uuid,uuid,text,jsonb,jsonb,uuid[],bigint)'::regprocedure
        ) AS source
      `);
      const source = definition.rows[0]?.source ?? "";
      const vendorLock = source.indexOf("WHERE vendor.id = discovered_vendor_id");
      const priceLock = source.indexOf("SELECT price.vendor_id, price.review_version");

      expect(vendorLock).toBeGreaterThan(-1);
      expect(priceLock).toBeGreaterThan(vendorLock);
      expect(source).toContain("current_vendor_id IS DISTINCT FROM discovered_vendor_id");
      expect(source).toContain("PRICE_ALIAS_REVIEW_VENDOR_CHANGED_RETRY");
      expect(source).toContain("ERRCODE = '40001'");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rolls review, version, alias decisions, and audit back as one transaction", async () => {
    const db = await createDatabase();
    try {
      await seedPrice(db);
      await db.exec(`
        INSERT INTO public.vendor_alias_proposals (
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES (
          '${PROPOSAL_ID}', '${PRICE_ID}', '${VENDOR_ID}',
          '옛스튜디오', '옛스튜디오'
        );
        CREATE FUNCTION public.force_alias_decision_failure()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $force_alias_decision_failure$
        BEGIN
          RAISE EXCEPTION 'FORCED_ALIAS_DECISION_FAILURE';
        END
        $force_alias_decision_failure$;
        CREATE TRIGGER zz_force_alias_decision_failure
        BEFORE UPDATE ON public.vendor_alias_proposals
        FOR EACH ROW
        EXECUTE FUNCTION public.force_alias_decision_failure();
      `);

      await db.exec("SET ROLE service_role;");
      await expect(
        reviewPrice(db, "approve", 0, "롤백되어야 할 승인", [PROPOSAL_ID])
      ).rejects.toThrow(/FORCED_ALIAS_DECISION_FAILURE/u);
      await db.exec("RESET ROLE;");

      const state = await db.query<{
        item_name: string;
        review_status: string;
        review_version: number;
        proposal_status: string;
        aliases: string[];
        event_count: number;
      }>(`
        SELECT
          price.item_name,
          price.review_status,
          price.review_version,
          proposal.status AS proposal_status,
          vendor.aliases,
          (
            SELECT count(*)::integer
            FROM public.official_review_events AS event
            WHERE event.entity_kind = 'price'
              AND event.entity_id = price.id
          ) AS event_count
        FROM public.official_prices AS price
        JOIN public.vendor_alias_proposals AS proposal
          ON proposal.official_price_id = price.id
        JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(state.rows).toEqual([
        {
          item_name: "초기 촬영",
          review_status: "pending",
          review_version: 0,
          proposal_status: "pending",
          aliases: [],
          event_count: 0,
        },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cascades both pending and reviewed alias proposals through a vendor merge", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.profiles (id, is_admin)
        VALUES ('${ADMIN_ID}', true);
        INSERT INTO public.vendors (
          id, name, category, status, region_code
        ) VALUES
          ('${PRESERVED_VENDOR_ID}', '보존 스튜디오', 'studio', 'approved', 'seoul'),
          ('${LOSING_VENDOR_ID}', '중복 스튜디오', 'studio', 'pending', 'seoul');
        INSERT INTO public.price_snapshots (id, period_label, source)
        VALUES ('${SNAPSHOT_ID}', '2026-Q3', 'official_test');
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, category, item_name,
          price_min_krw, price_max_krw, review_status, needs_review,
          source_file, source_quote, source_object_keys, confidence
        ) VALUES
          (
            '${PRICE_ID}', '${SNAPSHOT_ID}', '${LOSING_VENDOR_ID}',
            'studio', '검토 가격', 1000000, 1200000, 'pending', true,
            'reviewed.xlsx', '공식 촬영 가격 100만원',
            ARRAY['${SOURCE_KEY}'], 0.9
          ),
          (
            '${OTHER_PRICE_ID}', '${SNAPSHOT_ID}', '${LOSING_VENDOR_ID}',
            'studio', '대기 가격', 500000, 600000, 'pending', true,
            'pending.xlsx', '공식 촬영 가격 50만원',
            ARRAY['${SOURCE_KEY}'], 0.8
          );
        INSERT INTO public.vendor_alias_proposals (
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES
          (
            '${PROPOSAL_ID}', '${PRICE_ID}', '${LOSING_VENDOR_ID}',
            '옛스튜디오', '옛스튜디오'
          ),
          (
            '${PENDING_PROPOSAL_ID}', '${OTHER_PRICE_ID}', '${LOSING_VENDOR_ID}',
            '대기별칭', '대기별칭'
          );
        INSERT INTO public.vendor_dedupe_candidates (
          id, left_vendor_id, right_vendor_id, reason, similarity
        ) VALUES (
          '${DEDUPE_CANDIDATE_ID}', '${PRESERVED_VENDOR_ID}',
          '${LOSING_VENDOR_ID}', '같은 업체', 0.99
        );
      `);

      await db.exec("SET ROLE service_role;");
      await db.query(`
        SELECT public.review_official_price_with_alias_proposals(
          '${PRICE_ID}', '${ADMIN_ID}', 'approve',
          $json$${priceValues("검토 완료 가격")}$json$::jsonb,
          '[]'::jsonb,
          ARRAY['${PROPOSAL_ID}']::uuid[],
          0::bigint
        )
      `);
      await db.query(`
        SELECT public.decide_vendor_dedupe_candidate(
          '${DEDUPE_CANDIDATE_ID}', 'same',
          '${PRESERVED_VENDOR_ID}', '${ADMIN_ID}'
        )
      `);
      await db.exec("RESET ROLE;");

      const proposals = await db.query<{
        id: string;
        vendor_id: string;
        status: string;
      }>(`
        SELECT id, vendor_id, status
        FROM public.vendor_alias_proposals
        ORDER BY id
      `);
      expect(proposals.rows).toEqual([
        {
          id: PROPOSAL_ID,
          vendor_id: PRESERVED_VENDOR_ID,
          status: "approved",
        },
        {
          id: PENDING_PROPOSAL_ID,
          vendor_id: PRESERVED_VENDOR_ID,
          status: "pending",
        },
      ]);

      const merged = await db.query<{
        moved_prices: number;
        losing_status: string;
        candidate_status: string;
        aliases: string[];
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.official_prices
            WHERE vendor_id = '${PRESERVED_VENDOR_ID}'
          ) AS moved_prices,
          losing.status AS losing_status,
          candidate.status AS candidate_status,
          preserved.aliases
        FROM public.vendors AS preserved
        JOIN public.vendors AS losing ON losing.id = '${LOSING_VENDOR_ID}'
        JOIN public.vendor_dedupe_candidates AS candidate
          ON candidate.id = '${DEDUPE_CANDIDATE_ID}'
        WHERE preserved.id = '${PRESERVED_VENDOR_ID}'
      `);
      expect(merged.rows[0]).toMatchObject({
        moved_prices: 2,
        losing_status: "rejected",
        candidate_status: "same",
      });
      expect(merged.rows[0]?.aliases).toEqual(
        expect.arrayContaining(["옛스튜디오", "중복 스튜디오"])
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
