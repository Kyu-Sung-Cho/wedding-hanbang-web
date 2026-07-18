import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { convertManifest } from "../convert.js";
import { extractManifest, type ExtractionProvider } from "../extract.js";
import { readJsonFile, writeJsonFile } from "../io.js";
import {
  buildOfficialPriceContentFingerprint,
  buildOfficialPriceSourceRecordKey,
  loadValidated,
  type StagingLoadPlan,
  type StagingWriter,
} from "../load.js";
import { scanSources } from "../scan.js";
import { sourceFileId } from "../provenance.js";
import type { DisclosureExtraction } from "../schemas.js";
import { validateManifest } from "../validate.js";
import {
  activeVendorNameMatches,
  canonicalVendorPair,
  collectBoundedPages,
  createSupabaseStagingWriter,
  deterministicVendorSlug,
  reconcileExistingOfficialPrice,
  sanitizeVendorAliasProposals,
  stageVendorAliasProposals,
  uploadPreviewObjects,
  uploadRawObjects,
  vendorDatabaseCategory,
} from "../supabase-writer.js";

test("the staging writer independently refuses the repository production destination", () => {
  assert.throws(
    () => createSupabaseStagingWriter({
      url: "https://slrtobkksjmxgzatjyqb.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "slrtobkksjmxgzatjyqb",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }),
    /production/iu,
  );
});

async function fixtureArtifactFingerprint(filePaths: string[]): Promise<string> {
  const records = await Promise.all(
    [...filePaths].sort((left, right) => left.localeCompare(right, "en")).map(async (filePath) => {
      const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
      return `${path.resolve(filePath)}\0${digest}`;
    }),
  );
  return createHash("sha256").update(records.join("\n"), "utf8").digest("hex");
}

function stagingOfficialPriceFixture(): StagingLoadPlan["official_prices"][number] {
  return {
    unit_id: "unit-one",
    vendor_name: "샘플스튜디오",
    alias_proposals: [],
    source_agency: null,
    category: "studio",
    region_code: "seoul_gangnam3",
    item_name: "샘플스튜디오",
    base_spec: "20p 앨범",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    vat_note: null,
    price_note: null,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: "1건",
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "원본 추가 10만원",
      source_file_ids: ["d".repeat(64)],
      source_file: "결혼준비대행서비스/서울/샘플.xlsx",
      source_object_keys: [`${"a".repeat(64)}.xlsx`],
    }],
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: ["low_confidence"],
    source_file: "결혼준비대행서비스/서울/샘플.xlsx",
    source_object_keys: [`${"a".repeat(64)}.xlsx`],
    source_preview_keys: [`${"c".repeat(64)}.txt`],
    source_quote: "샘플스튜디오 20p 120만원",
    confidence: 0.75,
    source_record_key: "b".repeat(64),
  };
}

function storedOfficialPriceFixture(
  row: StagingLoadPlan["official_prices"][number],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    vendor_id: "22222222-2222-4222-8222-222222222222",
    agency_id: null,
    category: row.category,
    item_name: row.item_name,
    base_spec: row.base_spec,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    review_status: "pending",
    needs_review: row.needs_review,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
    source_record_key: row.source_record_key,
    edited_by_admin: false,
    ...overrides,
  };
}

function priceOptionClient(existingOptions: Array<Record<string, unknown>>) {
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      assert.equal(table, "official_price_options");
      return {
        select: () => ({
          eq: async () => ({ data: existingOptions, error: null }),
        }),
        insert: async (value: Record<string, unknown>) => {
          inserted.push(value);
          return { data: null, error: null };
        },
      };
    },
  } as unknown as Parameters<typeof reconcileExistingOfficialPrice>[0];
  return { client, inserted };
}

async function writeDummyDocx(filePath: string, text = "더미 기본 패키지 290만원"): Promise<void> {
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  await writeFile(filePath, await docx.generateAsync({ type: "nodebuffer" }));
}

test("load preserves exact parent and option source files within a multi-source unit", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-row-provenance-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "agency", "jeju", "generated-multi");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(path.join(vendorDir, "a-prices.docx"), "샘플 멀티 패키지 100만원");
  await writeDummyDocx(path.join(vendorDir, "b-options.docx"), "원본 추가 10만원");
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const [priceSource, optionSource] = scanned.units[0].source_files;
  const provider: ExtractionProvider = {
    extract: async () => ({
      data: {
        doc_kind: "agency_disclosure",
        business_name: scanned.units[0].parsed.raw_name,
        region_hint: "제주",
        agency_packages: [{
          package_name: "샘플 멀티 패키지",
          category_scope: ["studio", "dress", "makeup"],
          price_min_krw: 1_000_000,
          price_max_krw: 1_000_000,
          vat_note: null,
          price_note: null,
          source_quote: "샘플 멀티 패키지 100만원",
          source_file_ids: [sourceFileId(priceSource)],
          options: [{
            name: "원본 추가",
            price_min_krw: 100_000,
            price_max_krw: 100_000,
            unit: "1건",
            condition: null,
            raw_text: "원본 추가 10만원",
            source_quote: "원본 추가 10만원",
            source_file_ids: [sourceFileId(optionSource)],
          }],
          confidence: 0.95,
          needs_review: false,
        }],
        partner_vendors: [],
        hall: {
          venue_fee_krw: null,
          meal_price_min_krw: null,
          meal_price_max_krw: null,
          venue_fee_source_quote: null,
          meal_price_source_quote: null,
          items: [],
          confidence: 0,
          needs_review: true,
        },
        extraction_notes: "generated multi-source fixture",
      },
      inputTokens: 10,
      outputTokens: 10,
    }),
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  assert.equal(validated.units[0].stage, "validated");

  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });
  const row = dry.plan.agency_packages[0];
  assert.equal(row.source_file, priceSource.path);
  assert.deepEqual(row.source_object_keys, [`${priceSource.sha256}.${priceSource.ext}`]);
  assert.equal(row.options[0].source_file, optionSource.path);
  assert.deepEqual(row.options[0].source_object_keys, [`${optionSource.sha256}.${optionSource.ext}`]);
  assert.notEqual(row.source_file, row.options[0].source_file);
});

function extraction(): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: "더미플래너",
    region_hint: "제주",
    agency_packages: [{
      package_name: "더미 기본 패키지",
      category_scope: ["studio", "dress", "makeup"],
      price_min_krw: 2_900_000,
      price_max_krw: 2_900_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "더미 기본 패키지 290만원",
      confidence: 0.95,
      needs_review: true,
    }],
    partner_vendors: [],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      items: [],
      confidence: 0,
      needs_review: true,
    },
    extraction_notes: "generated fixture",
  };
}

function partnerExtraction(): DisclosureExtraction {
  return {
    doc_kind: "partner_price_list",
    business_name: "샘플연결플래너",
    region_hint: "제주",
    agency_packages: [],
    partner_vendors: [{
      vendor_name: "샘플제휴스튜디오",
      old_names: ["샘플제휴스튜디오 구상호"],
      category: "studio",
      price_min_krw: 1_200_000,
      price_max_krw: 1_200_000,
      base_spec: "기본 촬영",
      price_note: null,
      options: [],
      source_quote: "샘플제휴스튜디오 기본 촬영 120만원",
      confidence: 0.95,
      needs_review: false,
    }],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      items: [],
      confidence: 0,
      needs_review: true,
    },
    extraction_notes: "generated partner fixture",
  };
}

test("agency-root partner prices carry the scan-derived source agency identity", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-partner-agency-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_샘플연결플래너.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir }, {
    extractPdfText: async () => "샘플제휴스튜디오 기본 촬영 120만원 ".repeat(20),
  });
  const provider: ExtractionProvider = {
    extract: async () => ({ data: partnerExtraction(), inputTokens: 10, outputTokens: 5 }),
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  await validateManifest({ stateDir });
  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.equal(dry.plan.official_prices.length, 1);
  assert.deepEqual(dry.plan.official_prices[0].source_agency, {
    name: "샘플연결플래너",
    normalized_name: "샘플연결플래너",
    corporate_name: null,
    region_code: "jeju",
    source_file: "결혼준비대행서비스/제주/(제주)_샘플연결플래너.pdf",
  });
  assert.deepEqual(dry.plan.official_prices[0].alias_proposals, ["샘플제휴스튜디오 구상호"]);
});

test("load is dry by default and apply requires an explicitly confirmed staging destination", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-load-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_더미플래너.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const provider: ExtractionProvider = {
    extract: async () => ({ data: extraction(), inputTokens: 10, outputTokens: 5, requestId: "req_generated" }),
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  await validateManifest({ stateDir });

  let writerCalls = 0;
  const writer: StagingWriter = {
    stage: async (plan) => {
      writerCalls += 1;
      return {
        loadedUnitIds: plan.units.map((unit) => unit.unit_id),
        skippedUnitIds: [],
        loggedLedgerIds: plan.ai_ledger.map((entry) => entry.ledger_id),
      };
    },
  };

  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" }, { writer, env: {} });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(writerCalls, 0);
  assert.equal(dryRun.plan.agency_packages.length, 1);
  assert.equal(dryRun.plan.raw_objects.length, 1);
  assert.equal(dryRun.plan.preview_objects.length, 1);
  assert.equal(dryRun.plan.ai_ledger.length, 1);
  assert.equal(dryRun.plan.skipped_units.length, 0);
  assert.equal(dryRun.plan.agency_packages[0].source_file.includes("["), false);
  assert.equal(dryRun.plan.agency_packages[0].source_file, "결혼준비대행서비스/제주/(제주)_더미플래너.docx");
  assert.deepEqual(dryRun.plan.agency_packages[0].source_object_keys, [dryRun.plan.raw_objects[0].storage_path]);
  assert.deepEqual(dryRun.plan.agency_packages[0].source_preview_keys, [dryRun.plan.preview_objects[0].storage_path]);
  assert.match(dryRun.plan.preview_objects[0].storage_path, /^[0-9a-f]{64}\.txt$/u);
  assert.equal(dryRun.plan.preview_objects[0].source_label, "(제주)_더미플래너.docx");
  assert.equal(dryRun.plan.preview_objects[0].source_object_key, dryRun.plan.raw_objects[0].storage_path);
  assert.equal(dryRun.plan.agency_packages[0].needs_review, true);
  assert.deepEqual(dryRun.plan.agency_packages[0].validation_issue_codes, ["low_confidence"]);

  const previewArtifactPath = dryRun.plan.preview_objects[0].absolute_path;
  const previewArtifactContent = await readFile(previewArtifactPath);
  await writeFile(previewArtifactPath, Buffer.concat([previewArtifactContent, Buffer.from("\ntampered")]));
  await assert.rejects(
    loadValidated({ stateDir, snapshot: "2026Q3" }, { writer, env: {} }),
    /conversion artifact hash|artifact hash.*conversion/iu,
  );
  await writeFile(previewArtifactPath, previewArtifactContent);

  const manifestPath = path.join(stateDir, "manifest.json");
  const originalManifest = await readJsonFile(manifestPath) as Record<string, unknown>;
  const escapedManifest = structuredClone(originalManifest) as {
    units: Array<{
      conversion: { text_artifacts: string[]; image_artifacts: string[]; artifact_fingerprint: string };
      extraction: { artifact_fingerprint: string };
    }>;
  };
  const escapedPreviewPath = path.join(stateDir, "escaped-preview.txt");
  await writeFile(escapedPreviewPath, previewArtifactContent);
  escapedManifest.units[0].conversion.text_artifacts = [escapedPreviewPath];
  const escapedFingerprint = await fixtureArtifactFingerprint([
    ...escapedManifest.units[0].conversion.text_artifacts,
    ...escapedManifest.units[0].conversion.image_artifacts,
  ]);
  escapedManifest.units[0].conversion.artifact_fingerprint = escapedFingerprint;
  escapedManifest.units[0].extraction.artifact_fingerprint = escapedFingerprint;
  await writeJsonFile(manifestPath, escapedManifest);
  await assert.rejects(
    loadValidated({ stateDir, snapshot: "2026Q3" }, { writer, env: {} }),
    /preview artifact path|변환 디렉터리/iu,
  );
  await writeJsonFile(manifestPath, originalManifest);

  await assert.rejects(
    loadValidated(
      { stateDir, snapshot: "2026Q3", apply: true, confirmProjectRef: "staging-ref" },
      { writer, env: {} },
    ),
    /INGEST_LOAD_ENABLED/u,
  );
  assert.equal(writerCalls, 0);

  const applied = await loadValidated(
    { stateDir, snapshot: "2026Q3", apply: true, confirmProjectRef: "staging-ref" },
    {
      writer,
      env: {
        INGEST_LOAD_ENABLED: "true",
        INGEST_TARGET_ENV: "staging",
        INGEST_STAGING_PROJECT_REF: "staging-ref",
        INGEST_STORAGE_BUCKET: "disclosure-raw",
        SUPABASE_PROJECT_REF: "staging-ref",
        SUPABASE_PRODUCTION_PROJECT_REF: "slrtobkksjmxgzatjyqb",
        SUPABASE_URL: "https://staging-ref.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_generated_fixture",
      },
    },
  );

  assert.equal(applied.mode, "applied");
  assert.equal(writerCalls, 1);
  assert.equal(applied.manifest.units[0].stage, "loaded");

  const validStagingEnv = {
    INGEST_LOAD_ENABLED: "true",
    INGEST_TARGET_ENV: "staging",
    INGEST_STAGING_PROJECT_REF: "staging-ref",
    INGEST_STORAGE_BUCKET: "disclosure-raw",
    SUPABASE_PROJECT_REF: "staging-ref",
    SUPABASE_PRODUCTION_PROJECT_REF: "slrtobkksjmxgzatjyqb",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_generated_fixture",
  };
  for (const [unsafeUrl, expectedError] of [
    ["http://staging-ref.supabase.co", /https/iu],
    ["https://staging-ref.supabase.co:8443", /port|포트/iu],
    ["https://user:password@staging-ref.supabase.co", /credentials|자격|사용자/iu],
    ["https://staging-ref.supabase.co/rest/v1", /base URL|path|경로/iu],
    ["https://staging-ref.supabase.co?redirect=other", /base URL|query|쿼리/iu],
    ["https://staging-ref.supabase.co#other", /base URL|hash|fragment|해시/iu],
  ] as const) {
    await assert.rejects(
      loadValidated(
        { stateDir, snapshot: "2026Q3", apply: true, confirmProjectRef: "staging-ref" },
        { writer, env: { ...validStagingEnv, SUPABASE_URL: unsafeUrl } },
      ),
      expectedError,
    );
  }
  assert.equal(writerCalls, 1);

  await assert.rejects(
    loadValidated(
      { stateDir, snapshot: "2026Q3", apply: true, confirmProjectRef: "slrtobkksjmxgzatjyqb" },
      {
        writer,
        env: {
          INGEST_LOAD_ENABLED: "true",
          INGEST_TARGET_ENV: "staging",
          INGEST_STAGING_PROJECT_REF: "slrtobkksjmxgzatjyqb",
          INGEST_STORAGE_BUCKET: "disclosure-raw",
          SUPABASE_PROJECT_REF: "slrtobkksjmxgzatjyqb",
          SUPABASE_PRODUCTION_PROJECT_REF: "slrtobkksjmxgzatjyqb",
          SUPABASE_URL: "https://slrtobkksjmxgzatjyqb.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_generated_fixture",
        },
      },
    ),
    /production/iu,
  );

  await assert.rejects(
    loadValidated(
      {
        stateDir,
        snapshot: "2026Q3",
        apply: true,
        confirmProjectRef: "slrtobkksjmxgzatjyqb",
      },
      {
        writer,
        env: {
          INGEST_LOAD_ENABLED: "true",
          INGEST_TARGET_ENV: "staging",
          INGEST_STAGING_PROJECT_REF: "slrtobkksjmxgzatjyqb",
          INGEST_STORAGE_BUCKET: "disclosure-raw",
          SUPABASE_PROJECT_REF: "slrtobkksjmxgzatjyqb",
          // A typo or malicious override must not redefine which project is production.
          SUPABASE_PRODUCTION_PROJECT_REF: "misspelled-production-ref",
          SUPABASE_URL: "https://slrtobkksjmxgzatjyqb.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_generated_fixture",
        },
      },
    ),
    /production/iu,
  );
  assert.equal(writerCalls, 1);

  const artifactPath = applied.manifest.units[0].validation?.artifact_path;
  assert.ok(artifactPath);
  const artifact = await readJsonFile(artifactPath) as Record<string, unknown>;
  const data = artifact.data as DisclosureExtraction;
  data.doc_kind = "unknown";
  data.agency_packages = [];
  await writeJsonFile(artifactPath, artifact);
  await assert.rejects(
    loadValidated({ stateDir, snapshot: "2026Q3" }, { writer, env: {} }),
    /artifact.*hash|hash.*artifact|내용 hash/iu,
  );
});

test("dedupe vendor UUIDs are always written in canonical order", () => {
  assert.deepEqual(
    canonicalVendorPair(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ),
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  );
});

test("vendor persistence maps hall to venue and generates a stable ASCII identity slug", () => {
  assert.equal(vendorDatabaseCategory("hall"), "venue");
  assert.equal(vendorDatabaseCategory("dress"), "dress");
  const first = deterministicVendorSlug("샘플 컨벤션", "hall", "seoul_gangnam3");
  const second = deterministicVendorSlug("샘플 컨벤션", "hall", "seoul_gangnam3");
  assert.equal(first, second);
  assert.match(first, /^venue-seoul-gangnam3-[a-f0-9]{12}$/u);
});

test("official price logical identity is stable across model validation fingerprints and content revisions", () => {
  const base = {
    vendor_name: "샘플스튜디오",
    category: "studio",
    price_min_krw: 1_000_000,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: null,
      unit: "1건",
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "원본 추가 10만원",
      confidence: 0.9,
      needs_review: false,
    }],
  };
  const changed = structuredClone(base);
  changed.options[0].price_min_krw = 200_000;
  changed.options[0].raw_text = "원본 추가 20만원";
  changed.options[0].source_quote = "원본 추가 20만원";

  const logicalIdentity = {
    category: base.category,
    normalized_vendor_name: "sample-studio",
    occurrence: 0,
  };
  const sourceKeyFromExtractionRun = (_validationFingerprint: string, payload: unknown) =>
    buildOfficialPriceSourceRecordKey("a".repeat(64), "partner", payload);
  assert.equal(
    sourceKeyFromExtractionRun("luna-validation".padEnd(64, "0"), logicalIdentity),
    sourceKeyFromExtractionRun("terra-validation".padEnd(64, "0"), logicalIdentity),
  );
  assert.equal(
    sourceKeyFromExtractionRun("luna-validation".padEnd(64, "0"), base),
    sourceKeyFromExtractionRun("terra-validation".padEnd(64, "0"), changed),
  );
  assert.notEqual(
    buildOfficialPriceContentFingerprint(base),
    buildOfficialPriceContentFingerprint(changed),
  );
  assert.notEqual(
    buildOfficialPriceSourceRecordKey("a".repeat(64), "partner", base, 0),
    buildOfficialPriceSourceRecordKey("a".repeat(64), "partner", base, 1),
  );
});

test("vendor matching ignores rejected rows and resolves a losing merged name through active aliases", () => {
  const target = "잃은업체";
  assert.equal(activeVendorNameMatches({ name: target, status: "rejected" }, target), false);
  assert.equal(activeVendorNameMatches({
    name: "보존업체",
    aliases: [target],
    status: "approved",
  }, target), true);
});

test("vendor candidate pagination finds matches beyond the first 500 and fails closed on truncation", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ id: index }));
  const pages: Array<[number, number]> = [];
  const collected = await collectBoundedPages(async (from, to) => {
    pages.push([from, to]);
    return rows.slice(from, to + 1);
  });
  assert.equal(collected.length, 501);
  assert.deepEqual(pages, [[0, 499], [500, 999]]);

  const overflow = Array.from({ length: 1_001 }, (_, index) => index);
  await assert.rejects(
    collectBoundedPages(async (from, to) => overflow.slice(from, to + 1), 500, 1_000),
    /fail-closed|exceeds/iu,
  );
});

test("old_names are normalized into private pending proposals and never call the alias merge RPC", async () => {
  assert.deepEqual(sanitizeVendorAliasProposals([" old name ", "old name", "new name"]), [
    { alias: "old name", normalized_alias: "oldname" },
    { alias: "new name", normalized_alias: "newname" },
  ]);
  const rows: Array<Record<string, unknown>> = [];
  const rpcCalls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { error: null };
    },
    from: (table: string) => {
      assert.equal(table, "vendor_alias_proposals");
      return {
        select: () => ({
          eq: async (_column: string, priceId: string) => ({
            data: rows.filter((row) => row.official_price_id === priceId),
            error: null,
          }),
        }),
        upsert: async (values: Array<Record<string, unknown>>) => {
          for (const value of values) rows.push({ ...value });
          return { error: null };
        },
      };
    },
  } as unknown as Parameters<typeof stageVendorAliasProposals>[0];
  await stageVendorAliasProposals(
    client,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    [" old name ", "new name"],
  );
  assert.deepEqual(rpcCalls, []);
  assert.deepEqual(rows.map(({ status, alias, normalized_alias }) => ({ status, alias, normalized_alias })), [
    { status: "pending", alias: "old name", normalized_alias: "oldname" },
    { status: "pending", alias: "new name", normalized_alias: "newname" },
  ]);
  rows[0].status = "approved";
  rows.splice(1, 1);
  await stageVendorAliasProposals(
    client,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ["old name", "new name"],
  );
  assert.deepEqual(rows.map(({ status, alias }) => ({ status, alias })), [
    { status: "approved", alias: "old name" },
    { status: "pending", alias: "new name" },
  ]);
  assert.deepEqual(rpcCalls, []);
});

test("duplicate Storage objects are downloaded and hash-verified before being trusted", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-hash-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "sample.pdf");
  const content = Buffer.from("generated original evidence");
  await writeFile(sourcePath, content);
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(content).digest("hex");
  let downloads = 0;
  const bucket = {
    upload: async () => ({ data: null, error: { statusCode: "409", message: "already exists" } }),
    download: async () => {
      downloads += 1;
      return { data: new Blob(["different object"]), error: null };
    },
  };
  const client = {
    storage: { from: () => bucket },
  } as unknown as Parameters<typeof uploadRawObjects>[0];
  const plan = {
    raw_objects: [{
      source_path: "예식장/제주/sample.pdf",
      absolute_path: sourcePath,
      sha256: digest,
      ext: "pdf",
      bytes: content.byteLength,
      storage_path: `${digest}.pdf`,
    }],
  } as StagingLoadPlan;

  await assert.rejects(
    uploadRawObjects(client, "disclosure-raw", plan),
    /existing.*hash|hash.*existing|Storage.*mismatch|일치하지/iu,
  );
  assert.equal(downloads, 1);
});

test("derived text previews upload only to the private preview bucket without mutating raw evidence", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-preview-upload-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const previewPath = path.join(rootDir, "preview.txt");
  const content = Buffer.from("견적!B7: 기본 패키지 290만원", "utf8");
  await writeFile(previewPath, content);
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(content).digest("hex");
  const uploads: Array<{ bucket: string; key: string; body: Uint8Array; options: unknown }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, body: Uint8Array, options: unknown) => {
          uploads.push({ bucket, key, body, options });
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];
  const rawObjects = [{
    source_path: "서울/가격표.xlsx",
    absolute_path: path.join(rootDir, "immutable.xlsx"),
    sha256: "a".repeat(64),
    ext: "xlsx",
    bytes: 123,
    storage_path: `${"a".repeat(64)}.xlsx`,
  }];
  const plan = {
    raw_objects: structuredClone(rawObjects),
    preview_objects: [{
      source_label: "가격표.xlsx",
      source_object_key: `${"a".repeat(64)}.xlsx`,
      absolute_path: previewPath,
      sha256: digest,
      bytes: content.byteLength,
      storage_path: `${digest}.txt`,
    }],
  } as StagingLoadPlan;

  await uploadPreviewObjects(client, "disclosure-preview", plan);

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, "disclosure-preview");
  assert.equal(uploads[0].key, `${digest}.txt`);
  assert.deepEqual(uploads[0].options, { contentType: "text/plain", upsert: false });
  assert.deepEqual(plan.raw_objects, rawObjects);
});

test("an existing preview object is trusted only after exact size and hash verification", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-preview-replay-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const previewPath = path.join(rootDir, "preview.txt");
  const content = Buffer.from("가격표!C9: 150만원", "utf8");
  await writeFile(previewPath, content);
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(content).digest("hex");
  const client = {
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { statusCode: "409", message: "already exists" } }),
        download: async () => ({ data: new Blob(["same size? no"]), error: null }),
      }),
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];
  const plan = {
    preview_objects: [{
      source_label: "가격표.xlsx",
      source_object_key: `${"a".repeat(64)}.xlsx`,
      absolute_path: previewPath,
      sha256: digest,
      bytes: content.byteLength,
      storage_path: `${digest}.txt`,
    }],
  } as StagingLoadPlan;

  await assert.rejects(
    uploadPreviewObjects(client, "disclosure-preview", plan),
    /preview.*size|size.*preview|preview.*hash|hash.*preview/iu,
  );
});

test("preview upload rejects unsafe keys, local-path labels, and oversized objects before Storage writes", async () => {
  let writes = 0;
  const upload = async () => {
    writes += 1;
    return { data: null, error: null };
  };
  const client = {
    storage: { from: () => ({ upload }) },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];
  const invalid = {
    source_label: "C:\\private\\preview.txt",
    source_object_key: `${"a".repeat(64)}.xlsx`,
    absolute_path: "C:\\private\\preview.txt",
    sha256: "b".repeat(64),
    bytes: 2 * 1024 * 1024 + 1,
    storage_path: "../../private.txt",
  };

  await assert.rejects(
    uploadPreviewObjects(client, "disclosure-preview", {
      preview_objects: [invalid],
    } as StagingLoadPlan),
    /metadata.*invalid/iu,
  );
  assert.equal(writes, 0);
});

test("preview upload rejects non-UTF-8 derived bytes before Storage writes", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-preview-utf8-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const previewPath = path.join(rootDir, "preview.txt");
  const content = Buffer.from([0xc3, 0x28]);
  await writeFile(previewPath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  let writes = 0;
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          writes += 1;
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];

  await assert.rejects(
    uploadPreviewObjects(client, "disclosure-preview", {
      preview_objects: [{
        source_label: "가격표.xlsx",
        source_object_key: `${"a".repeat(64)}.xlsx`,
        absolute_path: previewPath,
        sha256: digest,
        bytes: content.byteLength,
        storage_path: `${digest}.txt`,
      }],
    } as StagingLoadPlan),
    /UTF-8|preview text/iu,
  );
  assert.equal(writes, 0);
});

test("approved price replay cannot recreate an option removed during admin review", async () => {
  const row = stagingOfficialPriceFixture();
  const stored = storedOfficialPriceFixture(row, {
    review_status: "approved",
    needs_review: false,
  });
  const { client, inserted } = priceOptionClient([]);

  await assert.rejects(
    reconcileExistingOfficialPrice(
      client,
      stored,
      stored.vendor_id as string,
      row,
    ),
    /reviewed|immutable|option.*mismatch|승인|편집/iu,
  );
  assert.equal(inserted.length, 0);
});

test("approved exact replay is an immutable no-write idempotent skip", async () => {
  const row = stagingOfficialPriceFixture();
  const stored = storedOfficialPriceFixture(row, {
    review_status: "approved",
    needs_review: false,
  });
  const option = row.options[0];
  const { client, inserted } = priceOptionClient([{
    name: option.name,
    price_min_krw: option.price_min_krw,
    price_max_krw: option.price_max_krw,
    unit: option.unit,
    condition: option.condition,
    raw_text: option.raw_text,
    source_file: row.source_file,
    source_quote: option.source_quote,
    source_object_keys: row.source_object_keys,
    confidence: row.confidence,
  }]);

  await reconcileExistingOfficialPrice(
    client,
    stored,
    stored.vendor_id as string,
    row,
  );
  assert.equal(inserted.length, 0);
});

test("a changed pending unedited price revision with the same logical key fails closed", async () => {
  const row = stagingOfficialPriceFixture();
  const stored = storedOfficialPriceFixture(row);
  const changed = structuredClone(row);
  changed.price_min_krw = (row.price_min_krw ?? 0) + 100_000;
  changed.price_max_krw = changed.price_min_krw;
  assert.equal(changed.source_record_key, row.source_record_key);
  const { client, inserted } = priceOptionClient([]);

  await assert.rejects(
    reconcileExistingOfficialPrice(
      client,
      stored,
      stored.vendor_id as string,
      changed,
    ),
    /content mismatch|immutable|revision|overwrite/iu,
  );
  assert.equal(inserted.length, 0);
});

test("a changed approved price revision with the same logical key remains immutable", async () => {
  const row = stagingOfficialPriceFixture();
  const stored = storedOfficialPriceFixture(row, {
    review_status: "approved",
    needs_review: false,
  });
  const changed = structuredClone(row);
  changed.price_note = "model-generated revision";
  assert.equal(changed.source_record_key, row.source_record_key);
  const { client, inserted } = priceOptionClient([]);

  await assert.rejects(
    reconcileExistingOfficialPrice(
      client,
      stored,
      stored.vendor_id as string,
      changed,
    ),
    /content mismatch|immutable|revision|overwrite/iu,
  );
  assert.equal(inserted.length, 0);
});

test("pending unedited replay may restore only a missing staged option after a partial write", async () => {
  const row = stagingOfficialPriceFixture();
  const stored = storedOfficialPriceFixture(row);
  const { client, inserted } = priceOptionClient([]);

  await reconcileExistingOfficialPrice(
    client,
    stored,
    stored.vendor_id as string,
    row,
  );

  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0], {
    official_price_id: stored.id,
    name: "원본 추가",
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    unit: "1건",
    condition: null,
    raw_text: "원본 추가 10만원",
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_quote: "원본 추가 10만원",
    confidence: row.confidence,
  });
});

test("rejected or admin-edited price replay cannot restore a missing staged option", async () => {
  const row = stagingOfficialPriceFixture();
  for (const overrides of [
    { review_status: "rejected", edited_by_admin: false },
    { review_status: "pending", edited_by_admin: true },
  ]) {
    const stored = storedOfficialPriceFixture(row, overrides);
    const { client, inserted } = priceOptionClient([]);
    await assert.rejects(
      reconcileExistingOfficialPrice(
        client,
        stored,
        stored.vendor_id as string,
        row,
      ),
      /reviewed|edited|immutable/iu,
    );
    assert.equal(inserted.length, 0);
  }
});
