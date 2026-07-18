// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718207000_public_disclosure_evidence_privacy.sql",
  ),
  "utf8",
);

const SNAPSHOT_ID = "71000000-0000-4000-8000-000000000001";
const VENDOR_ID = "71000000-0000-4000-8000-000000000002";
const AGENCY_ID = "71000000-0000-4000-8000-000000000003";
const PRICE_ID = "71000000-0000-4000-8000-000000000004";
const OPTION_ID = "71000000-0000-4000-8000-000000000005";
const PACKAGE_ID = "71000000-0000-4000-8000-000000000006";
const ACTOR_ID = "71000000-0000-4000-8000-000000000007";
const UNPUBLISHED_SNAPSHOT_ID = "71000000-0000-4000-8000-000000000008";
const UNPUBLISHED_PRICE_ID = "71000000-0000-4000-8000-000000000009";
const UNPUBLISHED_OPTION_ID = "71000000-0000-4000-8000-000000000010";

async function baseline() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL,
      published_at timestamptz,
      is_current boolean NOT NULL DEFAULT false,
      source_note text,
      published boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      slug text,
      name text NOT NULL,
      category text NOT NULL,
      region_code text,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      status text NOT NULL
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      region_code text,
      slug text,
      display_name text,
      is_active boolean NOT NULL DEFAULT true,
      merged_into_agency_id uuid
    );
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
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      reviewed_by uuid,
      review_action text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id),
      name text NOT NULL,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      is_effectively_mandatory boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
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
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      reviewed_by uuid,
      review_action text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO public.price_snapshots (
      id, period_label, source, published_at, is_current, source_note, published
    ) VALUES (
      '${SNAPSHOT_ID}', '2026Q3', 'kca_tprice', now(), true,
      'private operator note admin@example.test', true
    );
    INSERT INTO public.vendors (
      id, slug, name, category, region_code, aliases, status
    ) VALUES (
      '${VENDOR_ID}', 'sample-studio', '샘플 스튜디오', 'studio',
      'seoul_gangnam3', ARRAY['샘플 별칭'], 'approved'
    );
    INSERT INTO public.agencies (
      id, name, region_code, slug, display_name, is_active
    ) VALUES (
      '${AGENCY_ID}', '샘플 대행사', 'seoul_gangnam3',
      'sample-agency', '샘플 대행사', true
    );
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, agency_id, category, item_name,
      base_spec, price_min_krw, price_max_krw, vat_note, price_note,
      source_file, source_quote, source_object_keys, confidence,
      review_status, needs_review, reviewed_by, review_action
    ) VALUES (
      '${PRICE_ID}', '${SNAPSHOT_ID}', '${VENDOR_ID}', '${AGENCY_ID}',
      'studio', '기본 촬영', '원본 제공', 1200000, 1400000,
      '부가세 포함', '앨범 포함', 'private/source.pdf',
      '원문 문의 010-1234-5678', ARRAY['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'],
      0.95, 'approved', false, '${ACTOR_ID}', 'approve'
    );
    INSERT INTO public.official_price_options (
      id, official_price_id, name, price_min_krw, price_max_krw,
      unit, condition, raw_text, source_quote, source_object_keys,
      confidence, is_effectively_mandatory, sort_order
    ) VALUES (
      '${OPTION_ID}', '${PRICE_ID}', '야외 촬영', 200000, 200000,
      '1회', '우천 시 변경', '야외 촬영 20만원',
      '비공개 인용 https://private.example.test',
      ARRAY['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'],
      0.9, false, 1
    );
    INSERT INTO public.official_agency_packages (
      id, snapshot_id, agency_id, package_name, category_scope,
      price_min_krw, price_max_krw, vat_note, price_note, options,
      source_file, source_quote, source_object_keys, confidence,
      review_status, needs_review, reviewed_by, review_action
    ) VALUES (
      '${PACKAGE_ID}', '${SNAPSHOT_ID}', '${AGENCY_ID}', '샘플 패키지',
      ARRAY['studio'], 1300000, 1500000, '부가세 포함', '상담 후 확정',
      '[{"name":"기본 구성","price_min_krw":100000,"price_max_krw":100000,"unit":"1회","condition":"예약 시","raw_text":"기본 구성 10만원","source_quote":"private@example.test"}]'::jsonb,
      'private/package.pdf', '담당자 010-7777-6666',
      ARRAY['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf'],
      0.9, 'approved', false, '${ACTOR_ID}', 'approve'
    );

    INSERT INTO public.price_snapshots (
      id, period_label, source, published_at, is_current, source_note, published
    ) VALUES (
      '${UNPUBLISHED_SNAPSHOT_ID}', '2026Q4', 'kca_tprice', NULL, false,
      '발행 전 검수 자료', false
    );
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, agency_id, category, item_name,
      base_spec, price_min_krw, price_max_krw, vat_note, price_note,
      source_file, source_quote, source_object_keys, confidence,
      review_status, needs_review, reviewed_by, review_action
    ) VALUES (
      '${UNPUBLISHED_PRICE_ID}', '${UNPUBLISHED_SNAPSHOT_ID}', '${VENDOR_ID}',
      '${AGENCY_ID}', 'studio', '발행 전 촬영', '기본 구성', 1000000,
      1000000, '부가세 포함', NULL, 'private/unpublished.pdf',
      '안전한 비공개 근거',
      ARRAY['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.pdf'],
      0.9, 'approved', false, '${ACTOR_ID}', 'approve'
    );
    INSERT INTO public.official_price_options (
      id, official_price_id, name, price_min_krw, price_max_krw,
      unit, condition, raw_text, source_quote, source_object_keys,
      confidence, is_effectively_mandatory, sort_order
    ) VALUES (
      '${UNPUBLISHED_OPTION_ID}', '${UNPUBLISHED_PRICE_ID}', '발행 전 옵션',
      100000, 100000, '1회', NULL, '문의 private.example.com/contact',
      '안전한 비공개 근거',
      ARRAY['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.pdf'],
      0.9, false, 1
    );

    CREATE VIEW public.v_public_official_prices AS
      SELECT price.*, snapshot.source_note
      FROM public.official_prices AS price
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id;
    CREATE VIEW public.v_public_official_price_options AS
      SELECT * FROM public.official_price_options;
    CREATE VIEW public.v_public_agency_packages AS
      SELECT package_row.*, snapshot.source_note
      FROM public.official_agency_packages AS package_row
      JOIN public.price_snapshots AS snapshot ON snapshot.id = package_row.snapshot_id;
    CREATE VIEW public.v_public_prices AS
      SELECT price.id AS official_price_id, price.source_quote,
             snapshot.source_note
      FROM public.official_prices AS price
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id;
    CREATE VIEW public.v_public_price_options AS
      SELECT id, official_price_id, raw_text, source_quote
      FROM public.official_price_options;

    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  return db;
}

describe("public disclosure evidence privacy migration", () => {
  it("keeps approved raw option text public while removing private source evidence", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);

      const forbiddenColumns = await db.query<{ table_name: string; column_name: string }>(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'v_public_official_prices',
            'v_public_official_price_options',
            'v_public_agency_packages',
            'v_public_prices',
            'v_public_price_options'
          )
          AND column_name IN ('source_quote', 'source_note')
        ORDER BY table_name, column_name
      `);
      expect(forbiddenColumns.rows).toEqual([]);

      const publicPrice = await db.query<Record<string, unknown>>(`
        SELECT * FROM public.v_public_official_prices WHERE id = '${PRICE_ID}'
      `);
      expect(publicPrice.rows).toHaveLength(1);
      expect(publicPrice.rows[0]).toMatchObject({
        id: PRICE_ID,
        source: 'kca_tprice',
        source_label: '한국소비자원 참가격 · 2026Q3',
      });
      expect(JSON.stringify(publicPrice.rows)).not.toMatch(
        /010-1234-5678|admin@example\.test|private\.example\.test/iu,
      );

      const publicOptions = await db.query<Record<string, unknown>>(`
        SELECT * FROM public.v_public_official_price_options
        WHERE official_price_id = '${PRICE_ID}'
      `);
      expect(publicOptions.rows).toEqual([expect.objectContaining({
        id: OPTION_ID,
        name: '야외 촬영',
        condition: '우천 시 변경',
        raw_text: '야외 촬영 20만원',
      })]);
      expect(JSON.stringify(publicOptions.rows)).not.toMatch(
        /admin@example\.test|private\.example\.test|source_quote/iu,
      );

      const packages = await db.query<{ options: Array<Record<string, unknown>> }>(`
        SELECT options FROM public.v_public_agency_packages WHERE id = '${PACKAGE_ID}'
      `);
      expect(packages.rows[0]?.options).toEqual([{
        name: '기본 구성',
        price_min_krw: 100000,
        price_max_krw: 100000,
        unit: '1회',
        condition: '예약 시',
        raw_text: '기본 구성 10만원',
      }]);
      expect(JSON.stringify(packages.rows)).not.toMatch(
        /private@example\.test|source_quote/iu,
      );
    } finally {
      await db.close();
    }
  });

  it("keeps source quotes service-only through explicit private views", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);

      const privileges = await db.query<{
        role_name: string;
        can_read: boolean;
      }>(`
        SELECT role_name,
          has_table_privilege(role_name, 'public.v_private_admin_official_prices', 'SELECT') AS can_read
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
        ORDER BY role_name
      `);
      expect(privileges.rows).toEqual([
        { role_name: 'anon', can_read: false },
        { role_name: 'authenticated', can_read: false },
        { role_name: 'service_role', can_read: true },
      ]);

      await db.exec("SET ROLE service_role");
      const privateRows = await db.query<{ source_quote: string }>(`
        SELECT source_quote
        FROM public.v_private_admin_official_prices
        WHERE id = '${PRICE_ID}'
      `);
      await db.exec("RESET ROLE");
      expect(privateRows.rows).toEqual([{ source_quote: '원문 문의 010-1234-5678' }]);
    } finally {
      await db.close();
    }
  });

  it("rejects contact data atomically when a reviewed record is saved or approved", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);

      // Existing private source quotes may predate the fence. Replace them with
      // reviewed-safe evidence before exercising one-field-at-a-time failures.
      await db.exec(`
        UPDATE public.official_price_options
        SET raw_text = '안전한 원문', source_quote = '안전한 근거 인용'
        WHERE id = '${OPTION_ID}';
        UPDATE public.official_prices
        SET source_quote = '안전한 가격 근거 인용'
        WHERE id = '${PRICE_ID}';
        UPDATE public.official_agency_packages
        SET source_quote = '안전한 패키지 근거 인용',
            options = '[{"name":"기본 구성","price_min_krw":100000,"price_max_krw":100000,"unit":"1회","condition":"예약 시","raw_text":"안전한 원문","source_quote":"안전한 근거 인용"}]'::jsonb
        WHERE id = '${PACKAGE_ID}';
      `);

      await expect(db.exec(`
        UPDATE public.official_prices
        SET price_note = '문의 admin@example.test'
        WHERE id = '${PRICE_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:price_note/iu);

      await expect(db.exec(`
        UPDATE public.official_prices
        SET source_quote = '전화 010-4567-8910'
        WHERE id = '${PRICE_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:source_quote/iu);

      await expect(db.exec(`
        UPDATE public.official_price_options
        SET raw_text = '담당자 private.example.com/contact'
        WHERE id = '${OPTION_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:option_raw_text/iu);

      await expect(db.exec(`
        UPDATE public.official_price_options
        SET raw_text = repeat('가', 2001)
        WHERE id = '${OPTION_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_LENGTH_BLOCKED:option_raw_text/iu);

      await expect(db.exec(`
        UPDATE public.official_agency_packages
        SET options = '[{"name":"문의 @private_manager","price_min_krw":100000}]'::jsonb
        WHERE id = '${PACKAGE_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:package_option_name/iu);

      const unchanged = await db.query<{
        price_note: string;
        source_quote: string;
      }>(`
        SELECT price_note, source_quote
        FROM public.official_prices
        WHERE id = '${PRICE_ID}'
      `);
      expect(unchanged.rows).toEqual([{
        price_note: '앨범 포함',
        source_quote: '안전한 가격 근거 인용',
      }]);
    } finally {
      await db.close();
    }
  });

  it("is replay-safe and blocks unsafe snapshot labels at publication time", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec(migration);

      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET period_label = '문의 010-1111-2222'
        WHERE id = '${SNAPSHOT_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:period_label/iu);

      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET published = true, published_at = now()
        WHERE id = '${UNPUBLISHED_SNAPSHOT_ID}'
      `)).rejects.toThrow(/DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:option_raw_text/iu);

      const triggerCounts = await db.query<{ trigger_name: string; count: number }>(`
        SELECT tgname AS trigger_name, count(*)::int AS count
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'official_prices_public_text_privacy',
            'official_price_options_public_text_privacy',
            'official_agency_packages_public_text_privacy',
            'price_snapshots_public_text_privacy'
          )
        GROUP BY tgname
        ORDER BY tgname
      `);
      expect(triggerCounts.rows).toHaveLength(4);
      expect(triggerCounts.rows.every(({ count }) => count === 1)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
