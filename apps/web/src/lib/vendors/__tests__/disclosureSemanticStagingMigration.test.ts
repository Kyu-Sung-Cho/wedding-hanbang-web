// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260720120000_disclosure_semantic_staging.sql",
  ),
  "utf8",
);

const DRAFT_SNAPSHOT = "10000000-0000-4000-8000-000000000001";
const CURRENT_SNAPSHOT = "10000000-0000-4000-8000-000000000002";
const PUBLISHED_SNAPSHOT = "10000000-0000-4000-8000-000000000003";
const DATED_SNAPSHOT = "10000000-0000-4000-8000-000000000004";
const PARTNER_VENDOR = "20000000-0000-4000-8000-000000000001";
const OTHER_VENDOR = "20000000-0000-4000-8000-000000000002";
const PRICE_BY_SNAPSHOT: Record<string, string> = {
  [DRAFT_SNAPSHOT]: "30000000-0000-4000-8000-000000000001",
  [CURRENT_SNAPSHOT]: "30000000-0000-4000-8000-000000000002",
  [PUBLISHED_SNAPSHOT]: "30000000-0000-4000-8000-000000000003",
  [DATED_SNAPSHOT]: "30000000-0000-4000-8000-000000000004",
};
const OTHER_VENDOR_PRICE = "30000000-0000-4000-8000-000000000005";
const SHA = {
  unit: "a".repeat(64),
  partner: "b".repeat(64),
  file: "c".repeat(64),
  rawObject: "1".repeat(64),
  previewArtifact: "2".repeat(64),
  source: "d".repeat(64),
  validation: "e".repeat(64),
  record: "f".repeat(64),
  content: "0".repeat(64),
};

async function baseline(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL DEFAULT 'kca_tprice',
      published_at date,
      published boolean NOT NULL DEFAULT false,
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.price_snapshots (
      id, period_label, published, published_at, is_current
    )
    VALUES
      ('${DRAFT_SNAPSHOT}', 'draft', false, NULL, false),
      ('${CURRENT_SNAPSHOT}', 'current', false, NULL, true),
      ('${PUBLISHED_SNAPSHOT}', 'published', true, NULL, false),
      ('${DATED_SNAPSHOT}', 'dated', false, CURRENT_DATE, false);

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY
    );
    INSERT INTO public.vendors (id) VALUES
      ('${PARTNER_VENDOR}'),
      ('${OTHER_VENDOR}');

    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.official_prices (id, snapshot_id, vendor_id) VALUES
      ('${PRICE_BY_SNAPSHOT[DRAFT_SNAPSHOT]}', '${DRAFT_SNAPSHOT}', '${PARTNER_VENDOR}'),
      ('${PRICE_BY_SNAPSHOT[CURRENT_SNAPSHOT]}', '${CURRENT_SNAPSHOT}', '${PARTNER_VENDOR}'),
      ('${PRICE_BY_SNAPSHOT[PUBLISHED_SNAPSHOT]}', '${PUBLISHED_SNAPSHOT}', '${PARTNER_VENDOR}'),
      ('${PRICE_BY_SNAPSHOT[DATED_SNAPSHOT]}', '${DATED_SNAPSHOT}', '${PARTNER_VENDOR}'),
      ('${OTHER_VENDOR_PRICE}', '${DRAFT_SNAPSHOT}', '${OTHER_VENDOR}');

    CREATE FUNCTION public.decide_vendor_dedupe_candidate(
      p_candidate_id uuid,
      p_decision text,
      p_preserved_vendor_id uuid,
      p_decided_by uuid
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $decide_vendor_dedupe_candidate$
    DECLARE
      losing_vendor_id uuid;
      reference_row record;
    BEGIN
      FOR reference_row IN
        SELECT constraint_row.oid
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE (constraint_row.conrelid, 'vendor_id') NOT IN (
          ('public.official_prices'::regclass, 'vendor_id'),
          ('public.events'::regclass, 'vendor_id'),
          ('public.vendors'::regclass, 'vendor_id')
        )
      LOOP
        NULL;
      END LOOP;

  UPDATE public.official_prices
  SET vendor_id = p_preserved_vendor_id,
      updated_at = now()
  WHERE vendor_id = losing_vendor_id;
    END
    $decide_vendor_dedupe_candidate$;
    REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate(
      uuid, text, uuid, uuid
    ) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.decide_vendor_dedupe_candidate(
      uuid, text, uuid, uuid
    ) TO service_role;

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
  return db;
}

type SemanticInsert = {
  snapshotId?: string;
  recordKind?: "vendor_policy" | "document_section";
  semanticType?: string;
  subjectKind?: "vendor" | "agency";
  vendorCategory?: string | null;
  title?: string | null;
  summary?: string | null;
  partnerRecordRef?: string | null;
  partnerVendorId?: string | null;
  officialPriceId?: string | null;
  sourceAgency?: Record<string, unknown> | null;
  partnerLinkStatus?: string;
  sourceFileIds?: string[];
  sourceObjectKeys?: string[];
  sourcePreviewKeys?: string[];
  validationIssueCodes?: Array<string | null>;
  sourceRecordKey?: string;
};

async function insertSemantic(db: PGlite, input: SemanticInsert = {}): Promise<void> {
  const recordKind = input.recordKind ?? "vendor_policy";
  const isSection = recordKind === "document_section";
  const snapshotId = input.snapshotId ?? DRAFT_SNAPSHOT;
  const partnerLinkStatus = input.partnerLinkStatus ?? (isSection ? "not_applicable" : "price_row_staged");
  const sourceAgency = input.sourceAgency === undefined
    ? (isSection ? null : {
      name: "테스트 대행사",
      normalized_name: "테스트 대행사",
      corporate_name: null,
      region_code: "seoul-gangnam",
      source_file: "fixtures/source.xlsx",
    })
    : input.sourceAgency;
  await db.query(`
    INSERT INTO public.disclosure_semantic_staging (
      snapshot_id, schema_version, unit_id, record_kind, semantic_type,
      subject_kind, subject_name, subject_normalized_name, vendor_category,
      region_code, title, content_verbatim, summary, partner_record_ref,
      partner_vendor_id, official_price_id, source_agency, partner_link_status, validation_issue_codes,
      source_file_ids, source_file, source_object_keys, source_preview_keys,
      source_quote, source_fingerprint, validation_fingerprint, confidence,
      source_record_key, content_fingerprint
    ) VALUES (
      $1, 2, $2, $3, $4, $5, '테스트 업체', '테스트 업체', $6,
      'seoul-gangnam', $7, '원문을 그대로 보존한 내용', $8, $9,
      $10, $11, $12::jsonb, $13, $14::text[], $15::text[], 'fixtures/source.xlsx',
      $16::text[], $17::text[], '출처 원문 인용', $18, $19, 0.9, $20, $21
    )
  `, [
    snapshotId,
    SHA.unit,
    recordKind,
    input.semanticType ?? (isSection ? "notice" : "refund"),
    input.subjectKind ?? "vendor",
    input.vendorCategory === undefined ? (isSection ? null : "dress") : input.vendorCategory,
    input.title === undefined ? (isSection ? "안내" : null) : input.title,
    input.summary === undefined ? (isSection ? "원문 기반 요약" : null) : input.summary,
    input.partnerRecordRef === undefined ? (isSection ? null : SHA.partner) : input.partnerRecordRef,
    input.partnerVendorId === undefined ? (isSection ? null : PARTNER_VENDOR) : input.partnerVendorId,
    input.officialPriceId === undefined
      ? (isSection || partnerLinkStatus === "policy_only_pending_identity" ? null : PRICE_BY_SNAPSHOT[snapshotId])
      : input.officialPriceId,
    sourceAgency === null ? null : JSON.stringify(sourceAgency),
    partnerLinkStatus,
    input.validationIssueCodes ?? [],
    input.sourceFileIds ?? [SHA.file],
    input.sourceObjectKeys ?? [`${SHA.rawObject}.xlsx`],
    input.sourcePreviewKeys ?? [`${SHA.previewArtifact}.txt`],
    SHA.source,
    SHA.validation,
    input.sourceRecordKey ?? SHA.record,
    SHA.content,
  ]);
}

describe("private disclosure semantic staging migration", () => {
  it("executes the real migration and exposes only SELECT/INSERT to service_role", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE anon");
      await expect(db.query("SELECT * FROM public.disclosure_semantic_staging"))
        .rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");
      await db.exec("SET ROLE authenticated");
      await expect(db.query("SELECT * FROM public.disclosure_semantic_staging"))
        .rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");
      await db.exec("SET ROLE service_role");
      await insertSemantic(db);
      const privileges = await db.query<{
        canSelect: boolean;
        canInsert: boolean;
        canUpdate: boolean;
        canDelete: boolean;
      }>(`
        SELECT
          has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'SELECT') AS "canSelect",
          has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'INSERT') AS "canInsert",
          has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'UPDATE') AS "canUpdate",
          has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'DELETE') AS "canDelete"
      `);
      expect(privileges.rows).toEqual([{
        canSelect: true,
        canInsert: true,
        canUpdate: false,
        canDelete: false,
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects CHECK NULL bypasses and malformed source-agency/link contracts", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await expect(insertSemantic(db, { vendorCategory: null })).rejects.toThrow();
      await expect(insertSemantic(db, {
        recordKind: "document_section",
        title: null,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        recordKind: "document_section",
        summary: null,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        validationIssueCodes: [null],
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        sourceAgency: {
          name: "테스트 대행사",
          normalized_name: "테스트 대행사",
          corporate_name: null,
          region_code: "seoul-gangnam",
          source_file: "fixtures/source.xlsx",
          unexpected: "must fail",
        },
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        recordKind: "document_section",
        partnerRecordRef: SHA.partner,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        partnerRecordRef: null,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        partnerVendorId: null,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        officialPriceId: null,
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        partnerLinkStatus: "policy_only_pending_identity",
        officialPriceId: PRICE_BY_SNAPSHOT[DRAFT_SNAPSHOT],
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        recordKind: "document_section",
        partnerVendorId: PARTNER_VENDOR,
      })).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("binds a staged price policy to the exact durable vendor, price, and snapshot", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await insertSemantic(db);
      const linked = await db.query<{
        partnerVendorId: string;
        officialPriceId: string;
      }>(`
        SELECT
          partner_vendor_id::text AS "partnerVendorId",
          official_price_id::text AS "officialPriceId"
        FROM public.disclosure_semantic_staging
        WHERE source_record_key = '${SHA.record}'
      `);
      expect(linked.rows).toEqual([{
        partnerVendorId: PARTNER_VENDOR,
        officialPriceId: PRICE_BY_SNAPSHOT[DRAFT_SNAPSHOT],
      }]);
      await insertSemantic(db, {
        partnerLinkStatus: "policy_only_pending_identity",
        officialPriceId: null,
        sourceRecordKey: "9".repeat(64),
      });
      await expect(insertSemantic(db, {
        officialPriceId: PRICE_BY_SNAPSHOT[CURRENT_SNAPSHOT],
      })).rejects.toThrow(/DISCLOSURE_SEMANTIC_PRICE_LINK_MISMATCH/iu);
      await expect(insertSemantic(db, {
        officialPriceId: OTHER_VENDOR_PRICE,
      })).rejects.toThrow(/DISCLOSURE_SEMANTIC_PRICE_LINK_MISMATCH/iu);
      await db.exec("RESET ROLE");
      await expect(db.exec(`DELETE FROM public.official_prices WHERE id = '${PRICE_BY_SNAPSHOT[DRAFT_SNAPSHOT]}'`))
        .rejects.toThrow();
      await expect(db.exec(`DELETE FROM public.vendors WHERE id = '${PARTNER_VENDOR}'`))
        .rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("accepts independent provenance digests and enforces shape/extensions", async () => {
    const allowed = ["xlsx", "docx", "hwp", "pdf", "png"];
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      for (const [index, extension] of allowed.entries()) {
        await insertSemantic(db, {
          sourceObjectKeys: [`${SHA.rawObject}.${extension}`],
          sourceRecordKey: String(index + 1).repeat(64),
        });
      }
      await expect(insertSemantic(db, {
        sourceObjectKeys: [`${SHA.rawObject}.txt`],
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        sourceObjectKeys: [`${SHA.rawObject}.XLSX`],
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        sourceObjectKeys: [`${SHA.rawObject}.xlsx`],
        sourcePreviewKeys: [`${SHA.previewArtifact}.pdf`],
      })).rejects.toThrow();
      await expect(insertSemantic(db, {
        sourceFileIds: [SHA.file, "1".repeat(64)],
        sourceObjectKeys: [`${SHA.rawObject}.xlsx`],
      })).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("allows draft inserts but rejects current or previously published snapshots", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await insertSemantic(db);
      await expect(insertSemantic(db, { snapshotId: CURRENT_SNAPSHOT }))
        .rejects.toThrow(/DISCLOSURE_SEMANTIC_DRAFT_SNAPSHOT_REQUIRED/iu);
      await expect(insertSemantic(db, { snapshotId: PUBLISHED_SNAPSHOT }))
        .rejects.toThrow(/DISCLOSURE_SEMANTIC_DRAFT_SNAPSHOT_REQUIRED/iu);
      await expect(insertSemantic(db, { snapshotId: DATED_SNAPSHOT }))
        .rejects.toThrow(/DISCLOSURE_SEMANTIC_DRAFT_SNAPSHOT_REQUIRED/iu);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });
});
