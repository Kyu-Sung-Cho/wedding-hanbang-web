import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { convertManifest } from "../convert.js";
import { extractManifest, type ExtractionProvider } from "../extract.js";
import { loadValidated } from "../load.js";
import {
  buildPartnerVendorRecords,
  findPartnerVendorDedupeCandidates,
  findPartnerVendorIdentityConflicts,
} from "../partner-dedupe.js";
import type { DisclosureExtraction } from "../schemas.js";
import { scanSources } from "../scan.js";
import { resolveStagedVendorDedupePair } from "../supabase-writer.js";
import type { ManifestUnit } from "../types.js";
import { validateExtractionForUnit, validateManifest } from "../validate.js";

const UNIT_A = "a".repeat(64);
const UNIT_B = "b".repeat(64);

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

function partner(
  vendorName: string,
  category: "studio" | "dress" = "studio",
): DisclosureExtraction["partner_vendors"][number] {
  return {
    vendor_name: vendorName,
    old_names: [],
    category,
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p album",
    price_note: null,
    options: [],
    source_quote: `${vendorName} 120만원`,
    confidence: 0.95,
    needs_review: false,
  };
}

test("same-unit partner vendors with similar names become human-review candidates with stable row refs", () => {
  const records = buildPartnerVendorRecords(UNIT_A, "seoul", [
    partner("샘플라라스튜디오"),
    partner("샘플라라스튜디오점"),
  ]);

  const candidates = findPartnerVendorDedupeCandidates(records);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].left_unit_id, UNIT_A);
  assert.equal(candidates[0].right_unit_id, UNIT_A);
  assert.match(candidates[0].left_record_ref, /^[a-f0-9]{64}$/u);
  assert.match(candidates[0].right_record_ref, /^[a-f0-9]{64}$/u);
  assert.notEqual(candidates[0].left_record_ref, candidates[0].right_record_ref);
  assert.equal(candidates[0].decision, "human_review_required");
});

test("partner vendor candidates span separate disclosure units", () => {
  const records = [
    ...buildPartnerVendorRecords(UNIT_A, "busan", [partner("샘플온유스튜디오")]),
    ...buildPartnerVendorRecords(UNIT_B, "busan", [partner("샘플온유스튜디오점")]),
  ];

  const candidates = findPartnerVendorDedupeCandidates(records);

  assert.equal(candidates.length, 1);
  assert.deepEqual(
    new Set([candidates[0].left_unit_id, candidates[0].right_unit_id]),
    new Set([UNIT_A, UNIT_B]),
  );
});

test("partner vendor similarity never crosses category or region boundaries", () => {
  const records = [
    ...buildPartnerVendorRecords(UNIT_A, "seoul", [partner("샘플모아웨딩")]),
    ...buildPartnerVendorRecords(UNIT_B, "busan", [partner("샘플모아웨딩점")]),
    ...buildPartnerVendorRecords("c".repeat(64), "seoul", [partner("샘플모아웨딩점", "dress")]),
  ];

  assert.deepEqual(findPartnerVendorDedupeCandidates(records), []);
});

test("dedupe candidates exclude partner rows that cannot create a persisted vendor UUID", () => {
  const noPrice = partner("샘플모아스튜디오점");
  noPrice.price_min_krw = null;
  noPrice.price_max_krw = null;
  const records = buildPartnerVendorRecords(UNIT_A, "seoul", [
    partner("샘플모아스튜디오"),
    noPrice,
  ]);

  assert.deepEqual(findPartnerVendorDedupeCandidates(records), []);
});

test("exact normalized partner identity with conflicting staged price payload fails closed", () => {
  const first = partner("샘플하나 스튜디오");
  const second = partner("샘플하나스튜디오");
  second.price_min_krw = 1_500_000;
  second.price_max_krw = 1_500_000;
  const records = [
    ...buildPartnerVendorRecords(UNIT_A, "seoul", [first]),
    ...buildPartnerVendorRecords(UNIT_B, "seoul", [second]),
  ];

  const conflicts = findPartnerVendorIdentityConflicts(records);

  assert.equal(conflicts.length, 1);
  assert.deepEqual(new Set(conflicts[0].unit_ids), new Set([UNIT_A, UNIT_B]));
  assert.deepEqual(new Set(conflicts[0].record_refs), new Set(records.map((record) => record.record_ref)));
});

test("source provenance differences alone do not create a partner price conflict", () => {
  const first = partner("샘플하나 스튜디오");
  const second = partner("샘플하나스튜디오");
  first.options = [{
    name: "원본 추가",
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    unit: "1건",
    condition: null,
    raw_text: "원본 추가 10만원",
    source_quote: "원본 추가 10만원",
    source_file_ids: ["3".repeat(64)],
  }];
  second.options = [{ ...first.options[0], source_file_ids: ["4".repeat(64)] }];
  const records = [
    ...buildPartnerVendorRecords(UNIT_A, "seoul", [first]),
    ...buildPartnerVendorRecords(UNIT_B, "seoul", [second]),
  ];

  assert.deepEqual(findPartnerVendorIdentityConflicts(records), []);
});

test("unit validation blocks exact partner identities with conflicting price, spec, or options", () => {
  const first = partner("샘플하나 스튜디오");
  const second = partner("샘플하나스튜디오");
  second.base_spec = "30p album";
  const data: DisclosureExtraction = {
    doc_kind: "partner_price_list",
    business_name: "샘플대행사",
    region_hint: "서울",
    agency_packages: [],
    partner_vendors: [first, second],
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
    extraction_notes: "fixture",
  };
  const unit: ManifestUnit = {
    unit_id: UNIT_A,
    display_name: "샘플대행사.xlsx",
    parsed: {
      region_code: "seoul",
      raw_name: "샘플대행사",
      normalized_name: "샘플대행사",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/샘플대행사.xlsx",
      absolute_path: "C:/fixtures/샘플대행사.xlsx",
      ext: "xlsx",
      sha256: "f".repeat(64),
      bytes: 1,
    }],
    source_fingerprint: "e".repeat(64),
    stage: "extracted",
    notices: [],
  };

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) =>
    issue.severity === "error" && issue.code === "conflicting_partner_vendor_prices"
  ), true);
});

test("manifest validation blocks cross-unit exact partner identity conflicts before load", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-partner-conflict-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(서울)_샘플첫대행사.docx"), "샘플하나스튜디오 120만원");
  await writeDummyDocx(path.join(regionDir, "(서울)_샘플둘대행사.docx"), "샘플하나 스튜디오 150만원");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const names = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const businessName = names.get(request.unitId) ?? "missing";
      const price = businessName === "샘플첫대행사" ? 1_200_000 : 1_500_000;
      const vendorName = businessName === "샘플첫대행사" ? "샘플하나스튜디오" : "샘플하나 스튜디오";
      return {
        data: {
          doc_kind: "partner_price_list",
          business_name: businessName,
          region_hint: "서울",
          agency_packages: [],
          partner_vendors: [{
            ...partner(vendorName),
            price_min_krw: price,
            price_max_krw: price,
            source_quote: `${vendorName} ${price === 1_200_000 ? "120만원" : "150만원"}`,
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
          extraction_notes: "fixture",
        },
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });

  const manifest = await validateManifest({ stateDir });

  assert.equal(manifest.units.every((unit) => unit.stage === "error"), true);
  assert.equal(manifest.units.every((unit) => unit.validation?.issue_count === 1), true);
});

test("cross-unit partner candidates retain row refs and vendor kind in the load plan", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-partner-candidate-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "부산");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(부산)_샘플첫대행사.docx"), "샘플온유스튜디오 120만원");
  await writeDummyDocx(path.join(regionDir, "(부산)_샘플둘대행사.docx"), "샘플온유스튜디오점 120만원");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const names = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const businessName = names.get(request.unitId) ?? "missing";
      const vendorName = businessName === "샘플첫대행사" ? "샘플온유스튜디오" : "샘플온유스튜디오점";
      return {
        data: {
          doc_kind: "partner_price_list",
          business_name: businessName,
          region_hint: "부산",
          agency_packages: [],
          partner_vendors: [partner(vendorName)],
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
          extraction_notes: "fixture",
        },
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const manifest = await validateManifest({ stateDir });
  assert.equal(manifest.units.every((unit) => unit.stage === "validated"), true);
  const artifact = JSON.parse(await readFile(
    path.join(stateDir, "validated", "dedupe_candidates.json"),
    "utf8",
  ));
  const rawVendorCandidate = artifact.candidates.find((candidate: { entity_kind?: string }) =>
    candidate.entity_kind === "vendor"
  );
  assert.ok(rawVendorCandidate);
  assert.match(rawVendorCandidate.left_record_ref, /^[a-f0-9]{64}$/u);
  assert.match(rawVendorCandidate.right_record_ref, /^[a-f0-9]{64}$/u);

  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" });
  const stagedCandidate = dryRun.plan.dedupe_candidates.find((candidate) =>
    candidate.entity_kind === "vendor"
  );
  assert.ok(stagedCandidate);
  assert.equal(stagedCandidate.left_record_ref, rawVendorCandidate.left_record_ref);
  assert.equal(stagedCandidate.right_record_ref, rawVendorCandidate.right_record_ref);
  assert.equal(
    new Set(dryRun.plan.official_prices.map((row) => row.partner_record_ref)).size,
    2,
  );
});

test("writer resolves row-level candidate refs to the exact persisted vendor UUID pair", () => {
  const leftRef = "1".repeat(64);
  const rightRef = "2".repeat(64);
  const leftVendorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const rightVendorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const pair = resolveStagedVendorDedupePair({
    entity_kind: "vendor",
    left_unit_id: UNIT_A,
    right_unit_id: UNIT_A,
    left_record_ref: leftRef,
    right_record_ref: rightRef,
    similarity: 0.9,
    reason: "fixture",
    status: "pending",
  }, new Map([[UNIT_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]]), new Map([
    [leftRef, leftVendorId],
    [rightRef, rightVendorId],
  ]));

  assert.deepEqual(pair, [rightVendorId, leftVendorId]);
});
