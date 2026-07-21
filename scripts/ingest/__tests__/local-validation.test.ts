import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONVERTER_VERSION } from "../convert.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "../io.js";
import { extractManifestLocally } from "../local-extraction-runner.js";
import { loadValidated } from "../load.js";
import { SCANNER_PARSER_VERSION } from "../scan.js";
import type { LocalDeterministicExtractionArtifact } from "../schemas.js";
import { scoreExtractionAgainstGroundTruth } from "../score.js";
import type { IngestManifest } from "../types.js";
import {
  deriveValidatedPayloadForUnit,
  DedupeCandidatesSchema,
  LocalValidatedArtifactSchema,
  scanSourceMoneyOccurrences,
  verifyCurrentLocalValidatedArtifactForUnit,
  validateManifest,
} from "../validate.js";

async function localValidationFixture(convertedText = [
  "## 시트: 스튜디오",
  "스튜디오!A3: 사업자명",
  "스튜디오!B3: 기본가격",
  "스튜디오!A4: 해피스튜디오",
  "스튜디오!B4: 기본 120만원",
].join("\n")): Promise<{
  rootDir: string;
  stateDir: string;
  manifest: IngestManifest;
}> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-validation-"));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(temporaryRoot, "state");
  const rawPath = path.join(rootDir, "agency", "seoul", "sample.xlsx");
  const sourceFingerprint = sha256Text("local-validation-source");
  const unitId = sha256Text("local-validation-unit");
  const convertedPath = path.join(
    stateDir,
    ".converted",
    unitId,
    sourceFingerprint,
    "1-sheets.txt",
  );
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(rawPath, "immutable source", "utf8");
  await writeFile(convertedPath, convertedText, "utf8");
  const sourceDigest = await sha256File(rawPath);
  const convertedDigest = await sha256File(convertedPath);
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
    units: [{
      unit_id: unitId,
      display_name: "sample.xlsx",
      parsed: {
        region_code: "seoul",
        raw_name: "샘플웨딩",
        normalized_name: "샘플웨딩",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [{
        path: "agency/seoul/sample.xlsx",
        absolute_path: rawPath,
        ext: "xlsx",
        sha256: sourceDigest.sha256,
        bytes: sourceDigest.bytes,
      }],
      source_fingerprint: sourceFingerprint,
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: CONVERTER_VERSION,
        source_fingerprint: sourceFingerprint,
        text_artifacts: [convertedPath],
        image_artifacts: [],
        text_characters: (await readFile(convertedPath, "utf8")).length,
        cell_count: 4,
        artifact_fingerprint: sha256Text(
          `${path.resolve(convertedPath)}\0${convertedDigest.sha256}`,
        ),
        converted_at: new Date(0).toISOString(),
      },
    }],
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  return { rootDir, stateDir, manifest };
}

async function addConflictingLocalUnit(
  fixture: Awaited<ReturnType<typeof localValidationFixture>>,
): Promise<void> {
  const sourceFingerprint = sha256Text("local-validation-conflict-source");
  const unitId = sha256Text("local-validation-conflict-unit");
  const rawPath = path.join(fixture.rootDir, "agency", "seoul", "conflict.xlsx");
  const convertedPath = path.join(
    fixture.stateDir,
    ".converted",
    unitId,
    sourceFingerprint,
    "1-sheets.txt",
  );
  const convertedText = [
    "## 시트: 스튜디오",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 해피스튜디오",
    "스튜디오!B4: 기본 150만원",
  ].join("\n");
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(rawPath, "second immutable source", "utf8");
  await writeFile(convertedPath, convertedText, "utf8");
  const sourceDigest = await sha256File(rawPath);
  const convertedDigest = await sha256File(convertedPath);
  fixture.manifest.units.push({
    unit_id: unitId,
    display_name: "conflict.xlsx",
    parsed: {
      region_code: "seoul",
      raw_name: "다른공시대행사",
      normalized_name: "다른공시대행사",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/conflict.xlsx",
      absolute_path: rawPath,
      ext: "xlsx",
      sha256: sourceDigest.sha256,
      bytes: sourceDigest.bytes,
    }],
    source_fingerprint: sourceFingerprint,
    stage: "converted",
    notices: [],
    conversion: {
      converter_version: CONVERTER_VERSION,
      source_fingerprint: sourceFingerprint,
      text_artifacts: [convertedPath],
      image_artifacts: [],
      text_characters: convertedText.length,
      cell_count: 4,
      artifact_fingerprint: sha256Text(
        `${path.resolve(convertedPath)}\0${convertedDigest.sha256}`,
      ),
      converted_at: new Date(0).toISOString(),
    },
  });
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
}

test("local validation uses a distinct review-only provenance contract", async (t) => {
  const fixture = await localValidationFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  extracted.manifest.units[0]!.notices.push(
    "validate failed: local extraction artifact provenance mismatch (obsolete)",
  );
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), extracted.manifest);

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  const rawArtifact = await readJsonFile(unit.validation!.artifact_path);

  assert.equal(unit.stage, "validated", JSON.stringify(rawArtifact));
  assert.equal(unit.validation?.provider_mode, "local_deterministic");
  assert.equal(unit.validation?.model, "local-deterministic-v1");
  assert.equal(unit.validation?.needs_review, true);
  assert.equal(unit.validation?.bulk_approval_eligible, false);
  assert.equal(unit.notices.some((notice) => notice.startsWith("validate failed:")), false);
  const artifact = LocalValidatedArtifactSchema.parse(
    rawArtifact,
  );
  assert.equal(artifact.schema_version, 3);
  assert.equal(artifact.provider_mode, "local_deterministic");
  assert.equal(artifact.model, "local-deterministic-v1");
  assert.equal(artifact.needs_review, true);
  assert.equal(artifact.bulk_approval_eligible, false);
  assert.deepEqual(artifact.coverage_gaps, []);
  assert.ok(artifact.issues.some((issue) =>
    issue.code === "local_evidence_guard" && issue.severity === "warning"
  ));
  assert.deepEqual(
    await verifyCurrentLocalValidatedArtifactForUnit(unit, validated, fixture.stateDir),
    artifact,
  );
});

test("ground-truth scoring explicitly selects the active local validation chain", async (t) => {
  const fixture = await localValidationFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const manifest = await validateManifest({ stateDir: fixture.stateDir });
  const unit = manifest.units[0]!;
  const artifact = LocalValidatedArtifactSchema.parse(
    await readJsonFile(unit.validation!.artifact_path),
  );
  const occurrence = artifact.data.money_occurrences[0];
  assert.ok(occurrence, "fixture must produce a locally grounded money occurrence");
  const groundTruthPath = path.join(fixture.stateDir, "local-ground-truth.json");
  await writeJsonFile(groundTruthPath, {
    generated_at: new Date(0).toISOString(),
    units: [{
      unit_id: unit.unit_id,
      display_name: unit.display_name,
      source_paths: unit.source_files.map((source) => source.path),
      candidate_count: 1,
      candidates: [{
        raw: String(occurrence.amount_krw),
        krw: occurrence.amount_krw,
        line_context: occurrence.source_quote,
        source_locator: "manual:1",
      }],
    }],
  });
  const paidLatestPath = path.join(fixture.stateDir, "scoring", "latest.json");
  await writeJsonFile(paidLatestPath, { sentinel: "paid score evidence" });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [unit.unit_id],
    groundTruthPath,
    expectedGroundTruthSha256: (await sha256File(groundTruthPath)).sha256,
    expectedOccurrenceCount: 1,
    requireValidatedArtifacts: true,
    candidateSource: "local",
  });

  assert.deepEqual(report.verification, {
    mode: "strict_local_review_artifacts",
    candidate_source: "local",
    validated_artifacts_required: true,
    deterministic_artifact_paths_required: true,
    artifact_content_hashes_required: true,
    paid_plan_sha256: null,
    review_only: true,
  });
  const unitReport = (report.units as Array<Record<string, unknown>>)[0]!;
  assert.notEqual(unitReport.status, "blocked", JSON.stringify(unitReport));
  assert.equal(unitReport.model, "local-deterministic-v1");
  assert.equal(
    (unitReport.provenance as Record<string, unknown>).candidate_source,
    "active_local_validation",
  );
  assert.equal((report.gate as Record<string, unknown>).eligible_for_25_unit_batch, false);
  assert.deepEqual(await readJsonFile(paidLatestPath), { sentinel: "paid score evidence" });
  assert.deepEqual(
    await readJsonFile(path.join(fixture.stateDir, "scoring", "local-review", "latest.json")),
    report,
  );
});

test("conflicting local vendor rows stay replayable pending dedupe candidates", async (t) => {
  const fixture = await localValidationFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await addConflictingLocalUnit(fixture);
  await extractManifestLocally({ stateDir: fixture.stateDir });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(validated.units.length, 2);
  for (const unit of validated.units) {
    assert.equal(unit.stage, "validated");
    assert.equal(unit.validation?.review_status, "pending");
    assert.equal(unit.validation?.needs_review, true);
    assert.equal(unit.validation?.bulk_approval_eligible, false);
    assert.ok(unit.notices.includes(
      "local_partner_vendor_conflict_requires_dedupe_review",
    ));
    const artifact = LocalValidatedArtifactSchema.parse(
      await readJsonFile(unit.validation!.artifact_path),
    );
    assert.equal(artifact.issues.some(({ severity }) => severity === "error"), false);
    assert.deepEqual(
      await verifyCurrentLocalValidatedArtifactForUnit(unit, validated, fixture.stateDir),
      artifact,
    );
  }

  const dedupe = DedupeCandidatesSchema.parse(await readJsonFile(
    path.join(fixture.stateDir, "validated", "dedupe_candidates.json"),
  ));
  const candidate = dedupe.candidates.find((row) =>
    row.entity_kind === "vendor" && row.similarity === 1
  );
  assert.ok(candidate?.left_record_ref);
  assert.ok(candidate?.right_record_ref);
  assert.equal(candidate.decision, "human_review_required");
  assert.equal(dedupe.auto_merge, false);

  const load = await loadValidated({ stateDir: fixture.stateDir, snapshot: "2026Q3" });
  assert.equal(load.mode, "dry-run");
  assert.equal(load.plan.official_prices.length, 2);
  assert.ok(load.plan.official_prices.every((row) =>
    row.review_status === "pending" && row.needs_review
  ));
  assert.equal(load.plan.dedupe_candidates.length, 1);
});

test("local validation grounds a bare price through exact unit and table cells", async (t) => {
  const fixture = await localValidationFixture([
    "## 시트: 가격표",
    "가격표!A1: 금액 단위: 만원",
    "가격표!A2: 스튜디오 가격",
    "가격표!A3: 사업자명",
    "가격표!B3: 기본 촬영 가격",
    "가격표!A4: 해피스튜디오",
    "가격표!B4: 125",
  ].join("\n"));
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = LocalValidatedArtifactSchema.parse(
    await readJsonFile(validated.units[0]!.validation!.artifact_path),
  );

  assert.equal(validated.units[0]!.stage, "validated", JSON.stringify(artifact.issues));
  assert.deepEqual(artifact.coverage_gaps, []);
  assert.equal(artifact.issues.some(({ severity }) => severity === "error"), false,
    JSON.stringify(artifact.issues));
  assert.equal(artifact.data.partner_vendors[0]?.options[0]?.price_min_krw, 1_250_000);
});

test("local review-only validation may ground studio from an exact album-page cell", async (t) => {
  const fixture = await localValidationFixture([
    "## 시트: Sheet1",
    "Sheet1!A3: 사업자명",
    "Sheet1!B3: 앨범 구성",
    "Sheet1!C3: 기본가격",
    "Sheet1!A5: 로즈",
    "Sheet1!B5: 50페이지",
    "Sheet1!C5: 100만원",
  ].join("\n"));
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = LocalValidatedArtifactSchema.parse(
    await readJsonFile(validated.units[0]!.validation!.artifact_path),
  );

  assert.equal(artifact.data.partner_vendors[0]?.category, "studio");
  assert.equal(artifact.issues.some(({ severity }) => severity === "error"), false,
    JSON.stringify(artifact.issues));
  assert.ok(artifact.issues.some(({ code }) =>
    code === "local_category_inferred_from_sheet_locator"
    || code === "local_exact_evidence_requires_record_review"
  ));
});

test("local review-only validation grounds a wedding snapshot sheet as studio", async (t) => {
  const fixture = await localValidationFixture([
    "## 시트: 본식 스냅",
    "본식 스냅!A3: 사업자명",
    "본식 스냅!B3: 기본가격",
    "본식 스냅!A5: 사진업체",
    "본식 스냅!B5: 90만원",
  ].join("\n"));
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = LocalValidatedArtifactSchema.parse(
    await readJsonFile(validated.units[0]!.validation!.artifact_path),
  );

  assert.equal(artifact.data.partner_vendors[0]?.category, "studio");
  assert.equal(artifact.issues.some(({ severity }) => severity === "error"), false,
    JSON.stringify(artifact.issues));
  assert.ok(artifact.issues.some(({ code }) =>
    code === "local_category_inferred_from_sheet_locator"
    || code === "local_exact_evidence_requires_record_review"
  ));
});

test("local validation replays full XLSX merge context without weakening exact locators", async (t) => {
  const fixture = await localValidationFixture([
    "## 시트: 스튜디오",
    "스튜디오!A1: 가격(단위: 만원)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "병합 범위 B3:C3 · 좌상단 B3",
    "스튜디오!A4: 해피스튜디오",
    "스튜디오!C4: 125",
  ].join("\n"));
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = LocalValidatedArtifactSchema.parse(
    await readJsonFile(validated.units[0]!.validation!.artifact_path),
  );

  assert.equal(validated.units[0]!.stage, "validated", JSON.stringify(artifact.issues));
  assert.equal(artifact.issues.some(({ severity }) => severity === "error"), false,
    JSON.stringify(artifact.issues));
  assert.ok(artifact.issues.some(({ code }) =>
    code === "local_money_grounded_by_full_source_scanner"
  ));
  assert.equal(artifact.data.partner_vendors[0]?.options[0]?.price_min_krw, 1_250_000);
});

test("local payment terms validate an exact contract deposit as reservation evidence", async (t) => {
  const fixture = await localValidationFixture([
    "## 시트: 약관",
    "약관!A34: 5. 지불약정",
    "약관!A35: 계약금은 50만원이며 지정 계좌로 입금합니다.",
    "약관!A40: 6. 기타 약정",
  ].join("\n"));
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  const extraction = await readJsonFile(
    unit.local_extraction!.artifact_path,
  ) as LocalDeterministicExtractionArtifact;
  const replayed = await deriveValidatedPayloadForUnit(
    unit,
    extraction,
    { mode: "local_deterministic" },
  );

  assert.ok(replayed.data.sections?.some((section) =>
    section.section_type === "reservation"
    && section.content_verbatim.includes("계약금")
  ));
  assert.equal(replayed.issues.some(({ code, path: issuePath }) =>
    code === "semantic_type_not_grounded_in_source_quote"
    && issuePath.endsWith(".section_type")
  ), false, JSON.stringify(replayed.issues));
});

test("local validation rejects invented audit money and reports the omitted source occurrence", async (t) => {
  const fixture = await localValidationFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  const extraction = await readJsonFile(
    unit.local_extraction!.artifact_path,
  ) as LocalDeterministicExtractionArtifact;
  const forged = structuredClone(extraction.data);
  assert.equal(forged.money_occurrences?.length, 1);
  forged.money_occurrences![0]!.amount_krw = 9_999_999;

  const replayed = await deriveValidatedPayloadForUnit(
    unit,
    { data: forged },
    { mode: "local_deterministic" },
  );

  assert.ok(replayed.issues.some((issue) =>
    issue.code === "local_money_audit_not_in_source" && issue.severity === "error"
  ));
  // The audit ledger never satisfies primary coverage. Structured price rows
  // still cover the genuine source amount in this fixture.
  assert.deepEqual(replayed.coverageGaps, []);
});

test("local audit ledger cannot hide a missing structured price", async (t) => {
  const fixture = await localValidationFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  const extraction = await readJsonFile(
    unit.local_extraction!.artifact_path,
  ) as LocalDeterministicExtractionArtifact;
  const missingStructuredPrice = structuredClone(extraction.data);
  missingStructuredPrice.partner_vendors[0]!.options = [];

  const replayed = await deriveValidatedPayloadForUnit(
    unit,
    { data: missingStructuredPrice },
    { mode: "local_deterministic" },
  );

  assert.equal(missingStructuredPrice.money_occurrences?.length, 1);
  assert.deepEqual(replayed.coverageGaps.map((gap) => gap.krw), [1_200_000]);
  assert.ok(replayed.issues.some((issue) => issue.code === "coverage_gap"));
});

test("money scanner ignores bare numeric lists but keeps explicit won and price-column values", () => {
  const listOnly = [
    "금액 단위: 원",
    "선택 순서 1, 2, 3, 4",
  ].join("\n");
  assert.deepEqual(scanSourceMoneyOccurrences(listOnly), []);

  const explicitWon = scanSourceMoneyOccurrences("선택 순서 1, 2, 3, 4 / 실제 가격 12,000원");
  assert.deepEqual(explicitWon.map((entry) => entry.krw), [12_000]);

  const priceColumn = [
    "## 시트: 가격표",
    "가격표!B1: 기본 가격(원)",
    "가격표!B2: 120000",
  ].join("\n");
  assert.deepEqual(scanSourceMoneyOccurrences(priceColumn).map((entry) => entry.krw), [120_000]);
});

test("money scanner rejects policy clause and identifier fragments while normalizing dot thousands", () => {
  const source = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(단위: 원, VAT 포함)",
    "스튜디오!H3: 위약금 규정 가격",
    "스튜디오!B5: 촬영 가격 110.000",
    "스튜디오!H117: 1.촬영일 기준 60일 이내 - 상품가의 30%<br>2.촬영일 기준 45일 이내 - 상품가의 50%<br>3.촬영일 기준 30일 이내 - 상품가의 70%<br>4.촬영일 기준 15일 이내 - 상품가의 100%",
    "스튜디오!H118: 없음 543-1325",
  ].join("\n");

  assert.deepEqual(
    scanSourceMoneyOccurrences(source).map((entry) => ({ raw: entry.raw, krw: entry.krw })),
    [{ raw: "110.000", krw: 110_000 }],
  );
});

test("money scanner does not extract a malformed numeric suffix as a second price", () => {
  const source = [
    "## 시트: 드레스",
    "드레스!D140: 오염 시 세탁비 1,500,000원.000원",
  ].join("\n");

  assert.deepEqual(
    scanSourceMoneyOccurrences(source).map((entry) => ({ raw: entry.raw, krw: entry.krw })),
    [{ raw: "1,500,000원", krw: 1_500_000 }],
  );
});

test("money scanner preserves legitimate later prices in the same cell", () => {
  const source = [
    "드레스!B4: 본식 드레스 310만원<br>피팅비 10만원",
    "메이크업!D14: 기본 150,000원<br>얼리 추가 50,000원",
    "스튜디오!F5: 원본 15만원<br>(보증금 5만원 포함)",
    "스튜디오!F6: 수정본 5.5만원",
  ].join("\n");

  assert.deepEqual(
    scanSourceMoneyOccurrences(source).map((entry) => ({ raw: entry.raw, krw: entry.krw })),
    [
      { raw: "310만원", krw: 3_100_000 },
      { raw: "10만원", krw: 100_000 },
      { raw: "150,000원", krw: 150_000 },
      { raw: "50,000원", krw: 50_000 },
      { raw: "15만원", krw: 150_000 },
      { raw: "5만원", krw: 50_000 },
      { raw: "5.5만원", krw: 55_000 },
    ],
  );
});
