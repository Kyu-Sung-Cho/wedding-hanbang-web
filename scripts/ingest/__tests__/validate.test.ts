import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { convertManifest } from "../convert.js";
import { extractManifest, type ExtractionProvider } from "../extract.js";
import { loadValidated } from "../load.js";
import { scanSources } from "../scan.js";
import type { DisclosureExtraction } from "../schemas.js";
import type { ManifestUnit } from "../types.js";
import {
  normalizeEvidenceText,
  parseKoreanMoneyAmounts,
  validateExtractionForUnit,
  validateManifest,
} from "../validate.js";

async function writeDummyDocx(filePath: string, text: string): Promise<void> {
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

function extraction(businessName: string): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: businessName,
    region_hint: "광주",
    agency_packages: [{
      package_name: "더미 패키지",
      category_scope: ["studio", "dress", "makeup"],
      price_min_krw: 33_000,
      price_max_krw: 33_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "더미 패키지 3.3만원",
      confidence: 0.9,
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
    extraction_notes: "generated fixture",
  };
}

test("validate writes provenance-bound pending artifacts and only suggests likely duplicates", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(광주)_샘플정우웨딩.docx"), "더미 패키지 3.3만원");
  await writeDummyDocx(path.join(regionDir, "(광주)_광주샘플정우웨딩.docx"), "더미 패키지 3.3만원");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const names = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  const provider: ExtractionProvider = {
    extract: async (request) => ({
      data: extraction(names.get(request.unitId) ?? "더미"),
      inputTokens: 10,
      outputTokens: 10,
    }),
  };
  await extractManifest({ stateDir }, { provider, env: {} });

  const validated = await validateManifest({ stateDir });

  assert.equal(validated.units.every((unit) => unit.stage === "validated"), true);
  assert.equal(validated.units.every((unit) => unit.validation?.review_status === "pending"), true);
  const artifact = JSON.parse(await readFile(validated.units[0].validation?.artifact_path ?? "", "utf8"));
  assert.equal(artifact.source_files[0].sha256, validated.units[0].source_files[0].sha256);
  assert.equal(artifact.data.agency_packages[0].source_quote, "더미 패키지 3.3만원");
  const candidates = JSON.parse(
    await readFile(path.join(stateDir, "validated", "dedupe_candidates.json"), "utf8"),
  );
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].decision, "human_review_required");
  assert.ok(candidates.candidates[0].similarity >= 0.7);
  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" });
  assert.equal(dryRun.plan.dedupe_candidates.length, 1);
  assert.equal(dryRun.plan.dedupe_candidates[0].entity_kind, "agency");
});

test("validate repairs a content-tampered cache artifact instead of trusting its stored fingerprint", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-cache-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(
    path.join(regionDir, "(광주)_캐시복구웨딩.docx"),
    "더미 패키지 3.3만원",
  );
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const provider: ExtractionProvider = {
    extract: async () => ({
      data: extraction(scanned.units[0].parsed.raw_name),
      inputTokens: 10,
      outputTokens: 10,
    }),
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const first = await validateManifest({ stateDir });
  const artifactPath = first.units[0].validation?.artifact_path;
  assert.ok(artifactPath);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const expectedFingerprint = artifact.fingerprint;
  artifact.data.business_name = "변조된 업체명";
  artifact.issues = [];
  // Simulate a damaged cache that kept the trusted-looking metadata field.
  artifact.fingerprint = expectedFingerprint;
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const repairedManifest = await validateManifest({ stateDir });
  const repaired = JSON.parse(await readFile(artifactPath, "utf8"));

  assert.equal(repairedManifest.units[0].stage, "validated");
  assert.equal(repaired.fingerprint, expectedFingerprint);
  assert.equal(repaired.data.business_name, scanned.units[0].parsed.raw_name);
  assert.notDeepEqual(repaired.issues, []);
});

test("Korean money parsing keeps decimal 만원 units exact", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("기본 3.3만원 / 상위 124만원"), [33_000, 1_240_000]);
});

test("Korean money parsing expands shared range units and accepts omitted won suffixes", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("range 100~120만원 / upper 124만"), [1_000_000, 1_200_000, 1_240_000]);
});

test("every non-null extracted bound must be supported by the source quote", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_200_000;
  data.agency_packages[0].source_quote = "minimum 100만원";

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.code === "price_source_quote_mismatch"), true);
});

test("text-backed source quotes must occur in the converted evidence", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].source_quote = "지어낸 패키지 3.3만원";

  const textIssues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText("원문 패키지 3.3만원"),
    hasImages: false,
  });
  assert.equal(
    textIssues.some((issue) =>
      issue.severity === "error" && issue.code === "source_quote_not_found_in_text"
    ),
    true,
  );

  const visionIssues = validateExtractionForUnit(unit, data, {
    normalizedText: "",
    hasImages: true,
  });
  assert.equal(
    visionIssues.some((issue) =>
      issue.severity === "warning" && issue.code === "source_quote_requires_visual_review"
    ),
    true,
  );
});

test("multi-source units require valid row-level provenance before staging", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated-folder",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [
      {
        path: "agency/gwangju/generated/prices.docx",
        absolute_path: "C:/generated/prices.docx",
        ext: "docx",
        sha256: "b".repeat(64),
        bytes: 100,
      },
      {
        path: "agency/gwangju/generated/options.pdf",
        absolute_path: "C:/generated/options.pdf",
        ext: "pdf",
        sha256: "d".repeat(64),
        bytes: 200,
      },
    ],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };

  const missing = extraction("generated");
  const issues = validateExtractionForUnit(unit, missing);

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "missing_source_file_provenance"
  ), true);

  const sourceId = (source: ManifestUnit["source_files"][number]) => createHash("sha256")
    .update(`${source.path}\0${source.sha256}`, "utf8")
    .digest("hex");
  const firstId = sourceId(unit.source_files[0]);
  const secondId = sourceId(unit.source_files[1]);
  const attributed = extraction("generated");
  Object.assign(attributed.agency_packages[0], { source_file_ids: [firstId] });
  const attributedIssues = validateExtractionForUnit(unit, attributed, {
    normalizedText: normalizeEvidenceText("other file contains 더미 패키지 3.3만원"),
    hasImages: false,
    bySourceFileId: {
      [firstId]: { normalizedText: normalizeEvidenceText("first file has no quoted price"), hasImages: false },
      [secondId]: { normalizedText: normalizeEvidenceText("더미 패키지 3.3만원"), hasImages: false },
    },
  } as Parameters<typeof validateExtractionForUnit>[2]);
  assert.equal(attributedIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "source_quote_not_found_in_referenced_source"
  ), true);

  Object.assign(attributed.agency_packages[0], { source_file_ids: ["f".repeat(64)] });
  const unknownIssues = validateExtractionForUnit(unit, attributed);
  assert.equal(unknownIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "unknown_source_file_provenance"
  ), true);
});

test("unknown document kinds, kind-payload conflicts, and empty price extractions are blocking", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.pdf",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [{
      path: "hall/seoul/generated.pdf",
      absolute_path: "C:/generated/generated.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const unknown = extraction("generated");
  unknown.doc_kind = "unknown";
  unknown.agency_packages = [];
  const unknownIssues = validateExtractionForUnit(unit, unknown);
  assert.equal(unknownIssues.some((issue) => issue.severity === "error" && issue.code === "unknown_document_kind"), true);
  assert.equal(unknownIssues.some((issue) => issue.severity === "error" && issue.code === "no_price_records"), true);

  const conflict = extraction("generated");
  conflict.doc_kind = "hall_disclosure";
  const conflictIssues = validateExtractionForUnit(unit, conflict);
  assert.equal(conflictIssues.some((issue) => issue.severity === "error" && issue.code === "document_payload_conflict"), true);
  const kindConflict = extraction("generated");
  kindConflict.doc_kind = "agency_disclosure";
  const kindConflictIssues = validateExtractionForUnit(unit, kindConflict);
  assert.equal(kindConflictIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"), true);
});

test("public price fields containing phone numbers or email addresses are blocked", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const phone = extraction("generated");
  phone.agency_packages[0].price_note = "문의 010-1234-5678";
  const email = extraction("generated");
  email.agency_packages[0].source_quote = "더미 패키지 3.3만원 help@example.com";

  for (const data of [phone, email]) {
    const issues = validateExtractionForUnit(unit, data);
    assert.equal(issues.some((issue) =>
      issue.severity === "error" && issue.code === "public_field_contains_contact_data"
    ), true);
  }
});

test("mixed documents cannot bypass their scan-derived root kind", () => {
  const agencyUnit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "agency-folder",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/generated/prices.pdf",
      absolute_path: "C:/generated/prices.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const agencyRootWithHallPayload = extraction("generated");
  agencyRootWithHallPayload.doc_kind = "mixed";
  agencyRootWithHallPayload.agency_packages = [];
  agencyRootWithHallPayload.hall.venue_fee_krw = 2_000_000;
  agencyRootWithHallPayload.hall.venue_fee_source_quote = "venue fee 2000000";

  const agencyIssues = validateExtractionForUnit(agencyUnit, agencyRootWithHallPayload);
  assert.equal(
    agencyIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );

  const hallUnit: ManifestUnit = {
    ...agencyUnit,
    display_name: "hall.pdf",
    parsed: { ...agencyUnit.parsed, kind_hint: "hall" },
    source_files: [{
      ...agencyUnit.source_files[0],
      path: "hall/seoul/generated.pdf",
    }],
  };
  const hallRootWithAgencyPayload = extraction("generated");
  hallRootWithAgencyPayload.doc_kind = "mixed";
  const agencyPayloadIssues = validateExtractionForUnit(hallUnit, hallRootWithAgencyPayload);
  assert.equal(
    agencyPayloadIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );

  const hallRootWithPartnerPayload = extraction("generated");
  hallRootWithPartnerPayload.doc_kind = "mixed";
  hallRootWithPartnerPayload.agency_packages = [];
  hallRootWithPartnerPayload.partner_vendors = [{
    category: "studio",
    vendor_name: "partner",
    old_names: [],
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "partner 100000",
    confidence: 0.9,
    needs_review: false,
  }];
  const partnerPayloadIssues = validateExtractionForUnit(hallUnit, hallRootWithPartnerPayload);
  assert.equal(
    partnerPayloadIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );
});

test("AI business names cannot replace the scan-derived canonical identity", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "(광주)_샘플웨딩.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "샘플웨딩",
      normalized_name: "샘플웨딩",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/광주/(광주)_샘플웨딩.docx",
      absolute_path: "C:/generated/sample.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("전혀 다른업체");

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.severity === "error" && issue.code === "business_name_conflict"), true);
});

test("conflicting prices for the same agency package are blocked instead of choosing one row", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "jeju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/제주/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages.push({
    ...structuredClone(data.agency_packages[0]),
    price_min_krw: 44_000,
    price_max_krw: 44_000,
    source_quote: "기본 패키지 4.4만원",
  });

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.severity === "error" && issue.code === "conflicting_agency_package_prices"), true);
});

test("hall aggregate prices are errors when their source quote is absent", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "더미홀.pdf",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "더미홀",
      normalized_name: "더미홀",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [{
      path: "예식장/서울/더미홀.pdf",
      absolute_path: "C:/generated/더미홀.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("더미홀");
  data.doc_kind = "hall_disclosure";
  data.agency_packages = [];
  data.hall.venue_fee_krw = 1_000_000;
  data.hall.venue_fee_source_quote = null;

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(
    issues.some((issue) => issue.severity === "error" && issue.code === "missing_source_quote"),
    true,
  );
});
