// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = (file: string) =>
  resolve(process.cwd(), "../../supabase/migrations", file);

const previousView = readFileSync(
  migrationPath("20260726090000_public_vendor_policies.sql"),
  "utf8",
);
const migration = readFileSync(
  migrationPath("20260902090000_hall_document_penalty_reaches_the_public_view.sql"),
  "utf8",
);

const SNAPSHOT_ID = "9a000000-0000-4000-8000-000000000001";
const DRAFT_SNAPSHOT_ID = "9a000000-0000-4000-8000-000000000002";
const STUDIO_VENDOR_ID = "9a000000-0000-4000-8000-000000000010";
const HALL_VENDOR_ID = "9a000000-0000-4000-8000-000000000011";
const OTHER_HALL_VENDOR_ID = "9a000000-0000-4000-8000-000000000012";
const AGENCY_ID = "9a000000-0000-4000-8000-000000000020";

// 원본 객체 키는 실제 적재와 같은 모양(스토리지 경로)으로 둔다. 섹션과 가격 행이
// 같은 파일에서 나왔다는 사실이 이 뷰의 귀속 근거이기 때문이다.
const HALL_OBJECT = "raw/hall/rabidol.xlsx";
const OTHER_HALL_OBJECT = "raw/hall/floating-island.xlsx";
const MIXED_OBJECT = "raw/hall/two-halls-in-one-file.xlsx";
const AGENCY_OBJECT = "raw/agency/some-agency.xlsx";

async function baseline() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL DEFAULT 'kca_tprice',
      published boolean NOT NULL DEFAULT false,
      published_at timestamptz,
      is_current boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      slug text,
      name text NOT NULL,
      category text NOT NULL,
      region_code text,
      status text NOT NULL
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      vendor_id uuid REFERENCES public.vendors(id),
      agency_id uuid REFERENCES public.agencies(id),
      category text NOT NULL,
      item_name text NOT NULL,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[]
    );
    CREATE TABLE public.disclosure_semantic_staging (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      unit_id text NOT NULL,
      record_kind text NOT NULL,
      semantic_type text NOT NULL,
      subject_kind text NOT NULL,
      subject_name text NOT NULL,
      subject_normalized_name text NOT NULL,
      vendor_category text,
      region_code text NOT NULL,
      title text,
      content_verbatim text NOT NULL,
      summary text,
      partner_vendor_id uuid REFERENCES public.vendors(id),
      official_price_id uuid REFERENCES public.official_prices(id),
      source_agency jsonb,
      partner_link_status text NOT NULL DEFAULT 'not_applicable',
      source_file_ids text[] NOT NULL DEFAULT '{}'::text[],
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      source_quote text NOT NULL,
      confidence numeric
    );

    INSERT INTO public.price_snapshots (id, period_label, published, published_at, is_current)
    VALUES
      ('${SNAPSHOT_ID}', '2026Q3', true, now(), true),
      ('${DRAFT_SNAPSHOT_ID}', '2026Q4', false, NULL, false);

    INSERT INTO public.agencies (id, name) VALUES ('${AGENCY_ID}', '가대행사');

    INSERT INTO public.vendors (id, slug, name, category, region_code, status)
    VALUES
      ('${STUDIO_VENDOR_ID}', 'studio-ingest-aaaaaaaaaaaaaaaa', '가스튜디오', 'studio', 'seoul_gangnam3', 'approved'),
      ('${HALL_VENDOR_ID}', 'venue-ingest-bbbbbbbbbbbbbbbb', '(주)라비돌', 'venue', 'seoul_gangnam3', 'approved'),
      ('${OTHER_HALL_VENDOR_ID}', 'venue-ingest-cccccccccccccccc', '(주)플로팅아일랜드', 'venue', 'seoul_gangnam3', 'approved');
  `);
  return db;
}

type PolicyRow = {
  vendor_slug: string;
  semantic_type: string;
  vendor_category: string | null;
  source_agency: string | null;
  content_verbatim: string;
  policy_scope: string;
};

async function publishedPolicies(db: PGlite): Promise<PolicyRow[]> {
  const result = await db.query<PolicyRow>(`
    SELECT vendor_slug, semantic_type, vendor_category, source_agency, content_verbatim, policy_scope
    FROM public.v_public_vendor_policies
    ORDER BY vendor_slug, policy_scope, semantic_type, content_verbatim
  `);
  return result.rows;
}

async function insertApprovedHallPrice(
  db: PGlite,
  options: {
    id: string;
    vendorId: string;
    objectKey: string;
    itemName?: string;
    category?: string;
    reviewStatus?: string;
    needsReview?: boolean;
    snapshotId?: string;
  },
): Promise<void> {
  await db.exec(`
    INSERT INTO public.official_prices (
      id, snapshot_id, vendor_id, category, item_name,
      review_status, needs_review, source_object_keys
    ) VALUES (
      '${options.id}',
      '${options.snapshotId ?? SNAPSHOT_ID}',
      '${options.vendorId}',
      '${options.category ?? "hall"}',
      '${options.itemName ?? "대관료"}',
      '${options.reviewStatus ?? "approved"}',
      ${options.needsReview ?? false},
      ARRAY['${options.objectKey}']::text[]
    );
  `);
}

async function insertHallDocumentSection(
  db: PGlite,
  options: {
    objectKey: string;
    content: string;
    semanticType?: string;
    subjectKind?: string;
    confidence?: number;
    sourceQuote?: string;
    sourceFileIds?: string;
    snapshotId?: string;
  },
): Promise<void> {
  await db.exec(`
    INSERT INTO public.disclosure_semantic_staging (
      snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
      subject_name, subject_normalized_name, vendor_category, region_code,
      title, content_verbatim, summary, partner_vendor_id, official_price_id,
      source_agency, partner_link_status, source_file_ids, source_object_keys,
      source_quote, confidence
    ) VALUES (
      '${options.snapshotId ?? SNAPSHOT_ID}',
      repeat('a', 64),
      'document_section',
      '${options.semanticType ?? "penalty"}',
      '${options.subjectKind ?? "vendor"}',
      '라비돌', '라비돌', NULL, 'seoul_gangnam3',
      '위약금 기준',
      '${options.content}',
      '요약은 공개하지 않는다',
      NULL, NULL, NULL, 'not_applicable',
      ARRAY[repeat('b', 64)]::text[],
      ARRAY['${options.objectKey}']::text[],
      '${options.sourceQuote ?? "line:12: 예식 30일 전 총 비용의 10% 위약금"}',
      ${options.confidence ?? 0.95}
    );
  `);
}

describe("예식장 공시 문서의 위약금이 공개 뷰에 도달한다", () => {
  it("이전 뷰에서는 예식장 위약금이 한 건도 공개되지 않았다", async () => {
    // 이 결함의 원인을 고정해 둔다. 예식장 데이터가 없어서 0장이었던 것이 아니라,
    // record_kind='vendor_policy' 조건 때문에 어떤 데이터도 통과할 수 없었다.
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000101",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 ~ 예식 당일 총 비용의 10% 위약금",
    });
    await db.exec(previousView);

    const rows = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.v_public_vendor_policies",
    );
    expect(rows.rows[0]?.count).toBe("0");
    await db.close();
  });

  it("같은 문서의 승인된 예식장 가격 행에 귀속해 위약금·환불 원문을 공개한다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000101",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    // 같은 문서에서 나온 승인 가격 행이 여러 개여도 섹션은 한 장이다.
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000102",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
      itemName: "식대",
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 ~ 예식 당일 총 비용의 10% 위약금",
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      semanticType: "refund_policy",
      content: "계약 체결일 기준 15일 이내 90% 환불",
    });
    await db.exec(migration);

    const rows = await publishedPolicies(db);
    expect(rows).toEqual([
      {
        vendor_slug: "venue-ingest-bbbbbbbbbbbbbbbb",
        semantic_type: "penalty",
        vendor_category: "hall",
        source_agency: null,
        content_verbatim: "예식 30일 전 ~ 예식 당일 총 비용의 10% 위약금",
        policy_scope: "hall_document",
      },
      {
        vendor_slug: "venue-ingest-bbbbbbbbbbbbbbbb",
        semantic_type: "refund_policy",
        vendor_category: "hall",
        source_agency: null,
        content_verbatim: "계약 체결일 기준 15일 이내 90% 환불",
        policy_scope: "hall_document",
      },
    ]);
    await db.close();
  });

  it("업체 행에 붙은 스드메 위약금은 그대로 공개되고 scope가 vendor다", async () => {
    const db = await baseline();
    const priceId = "9a000000-0000-4000-8000-000000000201";
    await db.exec(`
      INSERT INTO public.official_prices (
        id, snapshot_id, vendor_id, agency_id, category, item_name,
        review_status, needs_review, source_object_keys
      ) VALUES (
        '${priceId}', '${SNAPSHOT_ID}', '${STUDIO_VENDOR_ID}', '${AGENCY_ID}',
        'studio', '기본 패키지', 'approved', false, ARRAY['${AGENCY_OBJECT}']::text[]
      );
      INSERT INTO public.disclosure_semantic_staging (
        snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
        subject_name, subject_normalized_name, vendor_category, region_code,
        title, content_verbatim, summary, partner_vendor_id, official_price_id,
        source_agency, partner_link_status, source_file_ids, source_object_keys,
        source_quote, confidence
      ) VALUES (
        '${SNAPSHOT_ID}', repeat('c', 64), 'vendor_policy', 'penalty', 'vendor',
        '가스튜디오', '가스튜디오', 'studio', 'seoul_gangnam3',
        NULL, '촬영 30일 전 취소 시 상품가의 100%', NULL,
        '${STUDIO_VENDOR_ID}', '${priceId}',
        '{"name": "가대행사"}'::jsonb, 'price_row_staged',
        ARRAY[repeat('d', 64)]::text[], ARRAY['${AGENCY_OBJECT}']::text[],
        '스튜디오!G31: 촬영 30일 전 취소 시 상품가의 100%', 0.95
      );
    `);
    await db.exec(migration);

    const rows = await publishedPolicies(db);
    expect(rows).toEqual([{
      vendor_slug: "studio-ingest-aaaaaaaaaaaaaaaa",
      semantic_type: "penalty",
      vendor_category: "studio",
      source_agency: "가대행사",
      content_verbatim: "촬영 30일 전 취소 시 상품가의 100%",
      policy_scope: "vendor",
    }]);
    await db.close();
  });

  it("한 파일에 두 예식장이 섞여 있으면 아무 쪽에도 붙이지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000301",
      vendorId: HALL_VENDOR_ID,
      objectKey: MIXED_OBJECT,
    });
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000302",
      vendorId: OTHER_HALL_VENDOR_ID,
      objectKey: MIXED_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: MIXED_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("같은 파일에 예식장이 아닌 가격 행이 함께 있으면 공개하지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000401",
      vendorId: HALL_VENDOR_ID,
      objectKey: MIXED_OBJECT,
    });
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000402",
      vendorId: HALL_VENDOR_ID,
      objectKey: MIXED_OBJECT,
      category: "studio",
      itemName: "제휴 스튜디오",
    });
    await insertHallDocumentSection(db, {
      objectKey: MIXED_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("검수를 통과하지 않은 가격 행만 있는 문서는 공개하지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000501",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
      reviewStatus: "pending",
      needsReview: true,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("발행되지 않은 스냅샷은 공개하지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000601",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
      snapshotId: DRAFT_SNAPSHOT_ID,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
      snapshotId: DRAFT_SNAPSHOT_ID,
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("추출 신뢰도가 낮은 원문은 예식장이라는 이유로 통과시키지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000701",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
      confidence: 0.45,
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("대행사 문서의 섹션은 어느 업체에도 붙이지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000801",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "대행사 공통 위약금 규정",
      subjectKind: "agency",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("위약금·환불이 아닌 문서 섹션은 계약 조건 카드로 새지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000901",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "총 비용의 기준은 대관료와 식대입니다",
      semanticType: "pricing_basis",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("다른 예식장의 문서 위약금이 이 예식장에 붙지 않는다", async () => {
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000001001",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000001002",
      vendorId: OTHER_HALL_VENDOR_ID,
      objectKey: OTHER_HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: OTHER_HALL_OBJECT,
      content: "예식 60일 전 총 비용의 20% 위약금",
    });
    await db.exec(migration);

    const rows = await publishedPolicies(db);
    expect(rows.map(({ vendor_slug }) => vendor_slug))
      .toEqual(["venue-ingest-cccccccccccccccc"]);
    await db.close();
  });

  it("anon은 여전히 읽기만 할 수 있다", async () => {
    const db = await baseline();
    await db.exec(migration);

    // 소유자(postgres)는 자기 뷰에 전권을 갖는다 — 확인해야 하는 것은 앱이
    // 쓰는 세 역할이 SELECT 하나만 갖는지다.
    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'v_public_vendor_policies'
        AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
      ORDER BY grantee, privilege_type
    `);
    expect(grants.rows).toEqual([
      { grantee: "anon", privilege_type: "SELECT" },
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
    await db.close();
  });
});
