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
      confidence numeric,
      -- 실제 테이블(20260720120000:229-277) CHECK 중 이 뷰가 의존하는 부분만
      -- 옮겨 온다. 예식장 위약금이 vendor_policy 로 적재될 수 없는 것이 아니라,
      -- **document_section 으로 적재되면 업체·가격 참조가 NULL 로 강제된다**는
      -- 것이 이 결함의 기계적 원인이다.
      CONSTRAINT disclosure_semantic_subject_contract CHECK (
        (record_kind = 'vendor_policy' AND partner_vendor_id IS NOT NULL)
        OR (
          record_kind = 'document_section'
          AND partner_vendor_id IS NULL
          AND official_price_id IS NULL
          AND vendor_category IS NULL
          AND source_agency IS NULL
        )
      )
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

  it("예식장 위약금은 업체·가격에 묶인 채로는 적재될 수 없다 — 그게 기계적 원인이다", async () => {
    // 옛 뷰가 예식장을 막은 조건은 세 개였다: record_kind='vendor_policy',
    // partner_vendor_id IS NOT NULL, official_prices inner join.
    // 그런데 예식장 위약금이 도착하는 record_kind 에서는 테이블 CHECK 가 뒤의
    // 두 값을 NULL 로 **강제**한다. 즉 세 조건이 서로 독립이 아니라 한 몸이고,
    // 어떤 신뢰도·검수 상태로도 우회할 수 없었다.
    //
    // 이 사실이 변이 테스트에서 "A: record_kind 제거"가 살아남은 이유이기도 하다 —
    // 그 조건은 이중 방어이고, 실제 차단은 NULL 강제가 한다.
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000091",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });

    await expect(db.exec(`
      INSERT INTO public.disclosure_semantic_staging (
        snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
        subject_name, subject_normalized_name, vendor_category, region_code,
        title, content_verbatim, summary, partner_vendor_id, official_price_id,
        source_agency, partner_link_status, source_file_ids, source_object_keys,
        source_quote, confidence
      ) VALUES (
        '${SNAPSHOT_ID}', repeat('a', 64), 'document_section', 'penalty', 'vendor',
        '라비돌', '라비돌', 'hall', 'seoul_gangnam3',
        '위약금 기준', '예식 30일 전 총 비용의 10% 위약금', '요약',
        '${HALL_VENDOR_ID}', '9a000000-0000-4000-8000-000000000091',
        NULL, 'price_row_staged',
        ARRAY[repeat('b', 64)]::text[], ARRAY['${HALL_OBJECT}']::text[],
        'line:12: 예식 30일 전', 0.95
      );
    `)).rejects.toThrow(/disclosure_semantic_subject_contract/);
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

  it("업체 행에 붙은 규정도 신뢰도가 낮으면 공개하지 않는다", async () => {
    // 변이 테스트에서 branch A 의 confidence 게이트를 지워도 아무 검사가 깨지지
    // 않았다. 이 마이그레이션이 branch A 를 다시 쓰므로, 옛 뷰가 갖고 있던
    // 게이트를 여기서 못박는다 — 없으면 스드메 저신뢰 원문 64행이 조용히
    // 공개로 넘어와도 알 수 없다.
    const db = await baseline();
    const priceId = "9a000000-0000-4000-8000-000000000251";
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
        '${SNAPSHOT_ID}', repeat('9', 64), 'vendor_policy', 'penalty', 'vendor',
        '가스튜디오', '가스튜디오', 'studio', 'seoul_gangnam3',
        NULL, '읽기 어려운 원문에서 뽑은 위약금', NULL,
        '${STUDIO_VENDOR_ID}', '${priceId}',
        '{"name": "가대행사"}'::jsonb, 'price_row_staged',
        ARRAY[repeat('8', 64)]::text[], ARRAY['${AGENCY_OBJECT}']::text[],
        '스튜디오!G31: 읽기 어려운 원문', 0.45
      );
    `);
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("정책이 다른 업체의 가격 행에 딸려 오면 공개하지 않는다", async () => {
    // 옛 뷰의 "정책이 엉뚱한 업체에 붙는 사고를 막는다" 조건
    // (price.vendor_id = semantic.partner_vendor_id). 변이 테스트에서 이 줄을
    // 지워도 아무 검사가 깨지지 않았다 — 남의 위약금을 이 업체 것으로 보여주는
    // 사고는 이 제품에서 가장 비싼 오답이므로 여기서 못박는다.
    const db = await baseline();
    const hallPriceId = "9a000000-0000-4000-8000-000000000261";
    await insertApprovedHallPrice(db, {
      id: hallPriceId,
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await db.exec(`
      INSERT INTO public.disclosure_semantic_staging (
        snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
        subject_name, subject_normalized_name, vendor_category, region_code,
        title, content_verbatim, summary, partner_vendor_id, official_price_id,
        source_agency, partner_link_status, source_file_ids, source_object_keys,
        source_quote, confidence
      ) VALUES (
        '${SNAPSHOT_ID}', repeat('7', 64), 'vendor_policy', 'penalty', 'vendor',
        '가스튜디오', '가스튜디오', 'studio', 'seoul_gangnam3',
        NULL, '남의 가격 행에 딸려 온 위약금', NULL,
        '${STUDIO_VENDOR_ID}', '${hallPriceId}',
        '{"name": "가대행사"}'::jsonb, 'price_row_staged',
        ARRAY[repeat('6', 64)]::text[], ARRAY['${AGENCY_OBJECT}']::text[],
        '스튜디오!G31: 남의 가격 행', 0.95
      );
    `);
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("승인되지 않은 업체는 두 경로 모두 위약금을 공개하지 않는다", async () => {
    // 가격 뷰와 같은 업체 게이트다. 가격은 안 보이는데 그 업체 위약금만
    // 보이는 상태가 생기면 안 된다. 두 branch 를 한 케이스에서 함께 잠근다 —
    // 변이 테스트에서 양쪽 다 지워도 아무 검사가 깨지지 않았다.
    const db = await baseline();
    const pendingStudioId = "9a000000-0000-4000-8000-000000000281";
    const pendingStudioPriceId = "9a000000-0000-4000-8000-000000000282";
    await db.exec(`
      INSERT INTO public.vendors (id, slug, name, category, region_code, status)
      VALUES ('${pendingStudioId}', 'studio-ingest-eeeeeeeeeeeeeeee', '검수 중 스튜디오', 'studio', 'seoul_gangnam3', 'pending');
      INSERT INTO public.official_prices (
        id, snapshot_id, vendor_id, agency_id, category, item_name,
        review_status, needs_review, source_object_keys
      ) VALUES (
        '${pendingStudioPriceId}', '${SNAPSHOT_ID}', '${pendingStudioId}', '${AGENCY_ID}',
        'studio', '기본 패키지', 'approved', false, ARRAY['${AGENCY_OBJECT}']::text[]
      );
      INSERT INTO public.disclosure_semantic_staging (
        snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
        subject_name, subject_normalized_name, vendor_category, region_code,
        title, content_verbatim, summary, partner_vendor_id, official_price_id,
        source_agency, partner_link_status, source_file_ids, source_object_keys,
        source_quote, confidence
      ) VALUES (
        '${SNAPSHOT_ID}', repeat('5', 64), 'vendor_policy', 'penalty', 'vendor',
        '검수 중 스튜디오', '검수중스튜디오', 'studio', 'seoul_gangnam3',
        NULL, '검수 전 업체의 위약금', NULL,
        '${pendingStudioId}', '${pendingStudioPriceId}',
        '{"name": "가대행사"}'::jsonb, 'price_row_staged',
        ARRAY[repeat('4', 64)]::text[], ARRAY['${AGENCY_OBJECT}']::text[],
        '스튜디오!G31: 검수 전 업체', 0.95
      );
    `);
    const pendingHallId = "9a000000-0000-4000-8000-000000000271";
    await db.exec(`
      INSERT INTO public.vendors (id, slug, name, category, region_code, status)
      VALUES ('${pendingHallId}', 'venue-ingest-dddddddddddddddd', '검수 중 예식장', 'venue', 'seoul_gangnam3', 'pending');
    `);
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000000272",
      vendorId: pendingHallId,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
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

  it("섹션과 가격 행이 같은 원본 객체를 공유하지 않으면 닫힌다", async () => {
    // 알려진 한계를 고정해 둔다. 귀속 근거가 "같은 원본 파일"이므로, 한 단위의
    // 섹션이 가격 행과 다른 파일(예: 이미지 첨부)에서 나왔으면 이 예식장은
    // 계속 빈 상태로 남는다. 틀린 업체에 붙이는 것보다 안 보이는 쪽을 택한 결과다.
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000001101",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: "raw/hall/rabidol-scan-page2.png",
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    expect(await publishedPolicies(db)).toEqual([]);
    await db.close();
  });

  it("한 업체가 두 경로의 규정을 모두 가지면 둘 다 나오고 섞이지 않는다", async () => {
    // 예식장이 대행사 문서의 제휴 업체 행으로도 등장할 수 있다
    // (partner_vendors[].category 에 'hall' 이 있다). 그때 union 두 갈래가
    // 같은 행을 두 번 내거나 scope 를 잘못 붙이지 않는지 본다.
    const db = await baseline();
    const hallPriceId = "9a000000-0000-4000-8000-000000001201";
    const agencyPriceId = "9a000000-0000-4000-8000-000000001202";
    await insertApprovedHallPrice(db, {
      id: hallPriceId,
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(`
      INSERT INTO public.official_prices (
        id, snapshot_id, vendor_id, agency_id, category, item_name,
        review_status, needs_review, source_object_keys
      ) VALUES (
        '${agencyPriceId}', '${SNAPSHOT_ID}', '${HALL_VENDOR_ID}', '${AGENCY_ID}',
        'hall', '대행사 취급 예식장', 'approved', false, ARRAY['${AGENCY_OBJECT}']::text[]
      );
      INSERT INTO public.disclosure_semantic_staging (
        snapshot_id, unit_id, record_kind, semantic_type, subject_kind,
        subject_name, subject_normalized_name, vendor_category, region_code,
        title, content_verbatim, summary, partner_vendor_id, official_price_id,
        source_agency, partner_link_status, source_file_ids, source_object_keys,
        source_quote, confidence
      ) VALUES (
        '${SNAPSHOT_ID}', repeat('e', 64), 'vendor_policy', 'penalty', 'vendor',
        '(주)라비돌', '라비돌', 'hall', 'seoul_gangnam3',
        NULL, '대행사 경로 취소 시 계약금 전액 위약금', NULL,
        '${HALL_VENDOR_ID}', '${agencyPriceId}',
        '{"name": "가대행사"}'::jsonb, 'price_row_staged',
        ARRAY[repeat('f', 64)]::text[], ARRAY['${AGENCY_OBJECT}']::text[],
        '예식장!B4: 대행사 경로 취소 시 계약금 전액 위약금', 0.95
      );
    `);
    await db.exec(migration);

    const rows = await publishedPolicies(db);
    expect(rows).toEqual([
      {
        vendor_slug: "venue-ingest-bbbbbbbbbbbbbbbb",
        semantic_type: "penalty",
        vendor_category: "hall",
        source_agency: null,
        content_verbatim: "예식 30일 전 총 비용의 10% 위약금",
        policy_scope: "hall_document",
      },
      {
        vendor_slug: "venue-ingest-bbbbbbbbbbbbbbbb",
        semantic_type: "penalty",
        vendor_category: "hall",
        source_agency: "가대행사",
        content_verbatim: "대행사 경로 취소 시 계약금 전액 위약금",
        policy_scope: "vendor",
      },
    ]);
    await db.close();
  });

  it("한 섹션이 두 업체에 붙는 행은 어떤 경우에도 나오지 않는다", async () => {
    // 뷰 전체에 걸린 불변식이다. id 는 semantic 행의 PK 이므로 한 id 가 두
    // vendor_id 로 나오면 그건 곧 남의 위약금을 이 업체 것으로 보여준 것이다.
    const db = await baseline();
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000001301",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
    });
    await insertApprovedHallPrice(db, {
      id: "9a000000-0000-4000-8000-000000001302",
      vendorId: HALL_VENDOR_ID,
      objectKey: HALL_OBJECT,
      itemName: "식대",
    });
    await insertHallDocumentSection(db, {
      objectKey: HALL_OBJECT,
      content: "예식 30일 전 총 비용의 10% 위약금",
    });
    await db.exec(migration);

    const leak = await db.query<{ id: string; vendors: number }>(`
      SELECT id, count(DISTINCT vendor_id)::int AS vendors
      FROM public.v_public_vendor_policies
      GROUP BY id HAVING count(DISTINCT vendor_id) > 1
    `);
    expect(leak.rows).toEqual([]);
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
