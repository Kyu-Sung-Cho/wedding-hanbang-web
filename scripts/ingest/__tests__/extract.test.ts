import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import sharp from "sharp";
import * as XLSX from "xlsx";

import { canonicalJsonSha256ExcludingField } from "../artifact-integrity.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "../extraction-contract.js";
import { convertManifest } from "../convert.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "../io.js";
import {
  acquireExtractionLock,
  assertOpenAIProviderModel,
  assertPaidProviderUsageWithinReservation,
  buildOpenAIResponseRequest,
  computeRetryDelayMilliseconds,
  assertOpenAIExtractionProviderEnvironment,
  ExtractionProviderResponseError,
  extractFixedEightWithScriptedProviderForTests,
  extractManifest as extractManifestWithPaidGate,
  extractManifestForTests as extractManifest,
  imageTileScratchTemporaryPathUpperBound,
  isPermanentProviderBillingFailure,
  isRetryableExtractionProviderError,
  mergeExtractionChunks,
  parseOpenAIExtractionResponse,
  planExtraction,
  planExtractionForTests,
  resolveExtractionModel,
  resolveUncachedPaidCallLimitUsd,
  selectExtractionUnits,
  stripRedundantWorkbookMarkdown,
  workbookInterpretationContext,
  validateImageRequestPayloadLimits,
  type ExtractionProvider,
  type ExtractionRequest,
} from "../extract.js";
import {
  initializePaidExecutionDomainForTests,
  loadPaidExecutionDomainForPlanningForTests,
} from "../paid-execution-domain.js";
import { scanSources } from "../scan.js";
import { sourceFileId } from "../provenance.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "../pilot-pass-receipt.js";
import { createLedgerId } from "../ledger.js";
import {
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  providerBoundReservation,
} from "../paid-extraction-budget.js";
import { listPendingPaidCallIntents } from "../paid-call-journal.js";
import type { DisclosureExtraction } from "../schemas.js";
import { DisclosureExtractionSchema, ExtractionBatchCheckpointSchema } from "../schemas.js";
import type { IngestManifest, ManifestUnit, SourceExtension } from "../types.js";

function selectionUnit(
  id: string,
  ext: SourceExtension,
  kind: "agency" | "hall",
  options: { textCharacters?: number; images?: number } = {},
): ManifestUnit {
  return {
    unit_id: id.repeat(64),
    display_name: `${id}.${ext}`,
    parsed: {
      region_code: "seoul_gangnam",
      raw_name: id,
      normalized_name: id,
      corporate_name: null,
      kind_hint: kind,
    },
    source_files: [{
      path: `${kind}/${id}.${ext}`,
      absolute_path: `C:/${kind}/${id}.${ext}`,
      ext,
      sha256: id.repeat(64),
      bytes: 100,
    }],
    source_fingerprint: id.repeat(64),
    stage: "converted",
    notices: [],
    conversion: {
      source_fingerprint: id.repeat(64),
      text_artifacts: options.textCharacters === 0 ? [] : [`C:/${id}.txt`],
      image_artifacts: Array.from({ length: options.images ?? 0 }, (_, index) => `C:/${id}-${index}.png`),
      text_characters: options.textCharacters ?? 1_000,
      cell_count: 1,
      artifact_fingerprint: id.repeat(64),
      converted_at: new Date(0).toISOString(),
    },
  };
}

function dummyExtraction(businessName: string): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: businessName,
    region_hint: "제주",
    agency_packages: [
      {
        package_name: "더미 기본 패키지",
        category_scope: ["studio", "dress", "makeup"],
        price_min_krw: 2_900_000,
        price_max_krw: 2_900_000,
        vat_note: null,
        price_note: null,
        options: [],
        source_quote: "더미 기본 패키지 290만원",
        confidence: 0.95,
        needs_review: false,
      },
    ],
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
    extraction_notes: "더미 테스트 결과",
  };
}

test("fixed --units selection preserves the requested order and rejects unknown ids", () => {
  const units = [
    selectionUnit("a", "xlsx", "agency"),
    selectionUnit("b", "pdf", "hall"),
    selectionUnit("c", "docx", "agency"),
  ];
  const manifest = { units } as IngestManifest;

  assert.deepEqual(
    selectExtractionUnits(manifest, { unitIds: ["c".repeat(64), "a".repeat(64)] })
      .map((unit) => unit.unit_id),
    ["c".repeat(64), "a".repeat(64)],
  );
  assert.throws(
    () => selectExtractionUnits(manifest, { unitIds: ["d".repeat(64)] }),
    /unknown_unit_id/u,
  );
});

test("the production extraction API rejects provider injection before any injected code can run", async () => {
  let calls = 0;
  const injectedProvider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("injected"), inputTokens: 1, outputTokens: 1 };
    },
  };
  type ProductionDependencies = NonNullable<Parameters<typeof extractManifestWithPaidGate>[1]>;
  const compileTimeBoundary: ProductionDependencies = {
    // @ts-expect-error Production extraction must never accept a provider dependency.
    provider: injectedProvider,
  };

  await assert.rejects(
    extractManifestWithPaidGate(
      { stateDir: path.join(os.tmpdir(), "must-not-read-production-injection") },
      compileTimeBoundary as ProductionDependencies,
    ),
    /production_extract_rejects_injected_provider/u,
  );
  assert.equal(calls, 0);
});

test("an arbitrary test provider cannot enter production-paid mode", async () => {
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("must-not-run"), inputTokens: 1, outputTokens: 1 };
    },
  };
  await assert.rejects(
    extractManifest(
      {
        stateDir: path.join(os.tmpdir(), "must-not-read-arbitrary-paid-test-provider"),
        enforcePilotAuthorization: true,
        approvedPlanSha256: "a".repeat(64),
      },
      { provider, env: {} },
    ),
    /arbitrary_test_provider_cannot_enter_production_paid_mode/u,
  );
  assert.equal(calls, 0);
});

test("production planning authorizes an exact caller-selected batch of up to 25 units", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-batch-auth-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "unapproved.docx"));
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });

  const plan = await planExtractionForTests({
    stateDir,
    unitIds: [scanned.units[0].unit_id],
    enforcePilotAuthorization: true,
  }, {}, { authorityRoot });

  assert.equal(plan.units.length, 1);
  assert.equal(plan.approval_status, "approved_sequential_runtime_fence");
  assert.match(plan.approval_plan_sha256 ?? "", /^[a-f0-9]{64}$/u);
});

test("automatic pilot selection is deterministic and stratifies formats instead of taking manifest order", () => {
  const units = [
    selectionUnit("a", "xlsx", "agency"),
    selectionUnit("b", "xlsx", "agency"),
    selectionUnit("c", "xlsx", "agency"),
    selectionUnit("d", "xlsx", "hall"),
    selectionUnit("e", "pdf", "agency", { textCharacters: 2_000 }),
    selectionUnit("f", "docx", "agency"),
    selectionUnit("1", "png", "agency", { textCharacters: 0, images: 1 }),
  ];
  const selected = selectExtractionUnits({ units } as IngestManifest, { sampleSize: 5 });

  assert.deepEqual(
    selected.map((unit) => `${unit.source_files[0].ext}:${unit.parsed.kind_hint}`),
    ["png:agency", "docx:agency", "pdf:agency", "xlsx:hall", "xlsx:agency"],
  );
  assert.deepEqual(
    selectExtractionUnits({ units } as IngestManifest, { sampleSize: 5 }).map((unit) => unit.unit_id),
    selected.map((unit) => unit.unit_id),
  );
});

test("explicit selection permits a validated unit only when its extraction prompt is stale", () => {
  const stale = selectionUnit("a", "xlsx", "agency");
  stale.stage = "validated";
  stale.extraction = {
    fingerprint: "d".repeat(64),
    source_fingerprint: stale.source_fingerprint,
    artifact_fingerprint: stale.conversion?.artifact_fingerprint ?? "e".repeat(64),
    prompt_version: "v6-occurrence-located-coverage",
    model: "gpt-5.6-luna",
    artifact_path: "C:/stale.json",
    cache_hit: false,
    attempts: 1,
    input_tokens: 1,
    output_tokens: 1,
    extracted_at: new Date(0).toISOString(),
  };

  assert.deepEqual(
    selectExtractionUnits({ units: [stale] } as IngestManifest, { unitIds: [stale.unit_id] }),
    [stale],
  );
  stale.stage = "loaded";
  assert.throws(
    () => selectExtractionUnits({ units: [stale] } as IngestManifest, { unitIds: [stale.unit_id] }),
    /unit_not_extractable/u,
  );
});

test("validated selection uses the full current extraction identity, including model", () => {
  const current = selectionUnit("a", "xlsx", "agency");
  current.stage = "validated";
  const scannerParserVersion = "test-scanner";
  const converterVersion = current.conversion?.converter_version ?? "v1-legacy";
  const fingerprint = currentExtractionFingerprint({
    scannerParserVersion,
    converterVersion,
    model: "gpt-5.6-luna",
    rawName: current.parsed.raw_name,
    regionCode: current.parsed.region_code,
    kindHint: current.parsed.kind_hint,
    sourceFingerprint: current.source_fingerprint,
    artifactFingerprint: current.conversion?.artifact_fingerprint ?? "e".repeat(64),
  });
  current.extraction = {
    fingerprint,
    content_sha256: "f".repeat(64),
    source_fingerprint: current.source_fingerprint,
    artifact_fingerprint: current.conversion?.artifact_fingerprint ?? "e".repeat(64),
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: scannerParserVersion,
    converter_version: converterVersion,
    model: "gpt-5.6-luna",
    artifact_path: "C:/current.json",
    cache_hit: false,
    attempts: 1,
    input_tokens: 1,
    output_tokens: 1,
    extracted_at: new Date(0).toISOString(),
  };
  const manifest = { scanner_parser_version: scannerParserVersion, units: [current] } as IngestManifest;

  assert.throws(
    () => selectExtractionUnits(manifest, { unitIds: [current.unit_id], model: "gpt-5.6-luna" }),
    /unit_not_extractable/u,
  );
  assert.deepEqual(
    selectExtractionUnits(manifest, { unitIds: [current.unit_id], model: "gpt-5.6-terra" }),
    [current],
  );
});

test("extraction plan estimates selected work without requiring an API key or paid-call enable flag", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-plan-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_계획테스트.docx"));
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const plan = await planExtraction({ stateDir, unitIds: [scanned.units[0].unit_id] }, {});

  assert.equal(plan.provider, "openai_responses_api");
  assert.equal(plan.configured_model_env, null);
  assert.equal(plan.resolved_model, "gpt-5.6-luna");
  assert.match(plan.processing_version, /^[a-f0-9]{64}$/u);
  assert.match(plan.luna_semantics, /literal.*not an alias/iu);
  assert.equal(plan.units.length, 1);
  assert.ok(plan.estimated_input_tokens > 0);
  assert.ok(plan.estimated_cost_usd > 0);
  assert.equal(
    plan.estimated_cost_usd,
    ((plan.estimated_input_tokens * 1.25) + (plan.estimated_output_tokens * 6)) / 1_000_000,
  );
  assert.ok(plan.maximum_cost_usd >= plan.estimated_cost_usd);
  assert.equal(plan.max_retry_attempts, 4);
  assert.equal(plan.uncached_paid_call_hard_limit_usd, 20);
  assert.equal(
    plan.cost_fence_scope,
    "local_user_home_execution_domain_claims_and_authoritative_state_ledger",
  );
  assert.equal(plan.units[0].maximum_output_tokens, plan.units[0].requests * 16_000 * 4);
  assert.ok(plan.units[0].maximum_input_tokens >= plan.units[0].estimated_input_tokens * 4);
  assert.match(plan.estimation_basis, /request-level heuristic estimates/iu);
  assert.match(
    plan.estimation_basis,
    /1,050,000-input-token cost bound.*922,000 max input.*16,000 output tokens/iu,
  );
  assert.match(plan.estimation_basis, /1\.25x cache-write.*long-context multipliers/iu);
  assert.match(plan.estimation_basis, /sequential authority claim.*may stop execution/iu);
});

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

async function rasterizeGeneratedPdf(
  _sourcePath: string,
  outputDirectory: string,
): Promise<string[]> {
  const pagePath = path.join(outputDirectory, "page-1.png");
  await writeFile(pagePath, "generated PDF page raster");
  return [pagePath];
}

test("fixed-eight planning reports an over-budget maximum without issuing approval", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-plan-blocked-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < FIXED_EIGHT_ORDERED_UNIT_IDS.length; index += 1) {
    await writeDummyDocx(
      path.join(regionDir, `(제주)_blocked-plan-${index}.docx`),
      `blocked plan fixture ${index} 더미 기본 패키지 290만원`,
    );
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  manifest.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(manifestPath, manifest);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });

  const plan = await planExtractionForTests({
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  }, {
    INGEST_MAX_UNCACHED_COST_USD: "0.000001",
  }, { authorityRoot });

  assert.equal(plan.approval_status, "blocked_expected_cost_exceeds_remaining_budget");
  assert.equal(plan.approval_authorized_ceiling_usd, 0.000001);
  assert.equal(plan.approval_plan_sha256, null);
  assert.equal(plan.approval_plan_path, null);
  assert.ok(plan.maximum_cost_usd > plan.remaining_paid_call_budget_usd);
  assert.equal(
    plan.maximum_input_tokens,
    plan.units.reduce((sum, unit) => sum + unit.maximum_input_tokens, 0),
  );
  assert.equal(
    plan.maximum_output_tokens,
    plan.units.reduce((sum, unit) => sum + unit.maximum_output_tokens, 0),
  );
  await assert.rejects(
    stat(path.join(stateDir, ".cache", "paid-extraction-plans")),
    /ENOENT/u,
  );
  await assert.rejects(
    extractManifestWithPaidGate({
      stateDir,
      unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
      enforcePilotAuthorization: true,
    }, { env: {} }),
    /paid_extraction_batch_requires_approved_plan_sha256/u,
  );
});

test("the exact-eight paid path binds plan, intents, ledger, checkpoints, cache, and safe resume", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-chain-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < FIXED_EIGHT_ORDERED_UNIT_IDS.length; index += 1) {
    await writeDummyDocx(
      path.join(regionDir, `(제주)_paid-chain-${index}.docx`),
      `paid chain fixture ${index} 더미 기본 패키지 290만원`,
    );
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  manifest.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(manifestPath, manifest);

  const historicalRunId = "99999999-9999-4999-8999-999999999999";
  const historicalFingerprint = "9".repeat(64);
  const historicalLedger = {
    schema_version: 2,
    ledger_id: createLedgerId(historicalRunId, historicalFingerprint, 0, 1),
    run_id: historicalRunId,
    unit_id: "8".repeat(64),
    fingerprint: historicalFingerprint,
    prompt_version: "historical-v2",
    model: "gpt-5.6-luna",
    batch_index: 0,
    attempt: 1,
    request_hash: "7".repeat(64),
    request_id: "historical-request",
    input_tokens: 10,
    output_tokens: 5,
    // Historical v2 rows used uncached input at 1x: (10 + 5*6) / 1M.
    estimated_cost_usd: 0.00004,
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:00.000Z",
  };
  const ledgerPath = path.join(stateDir, ".cache", "ai-ledger.ndjson");
  const historicalLedgerBytes = Buffer.from(`${JSON.stringify(historicalLedger)}\n`, "utf8");
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, historicalLedgerBytes);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });

  const options = {
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  };
  const plan = await planExtractionForTests(options, {}, { authorityRoot });
  assert.match(plan.approval_plan_sha256 ?? "", /^[a-f0-9]{64}$/u);
  const scriptedScenario = {
    responsesByCanonicalName: Object.fromEntries(manifest.units.map((unit) => [
      unit.parsed.raw_name,
      dummyExtraction(unit.parsed.raw_name),
    ])),
    failFirstInvalidResponses: 1,
    inputTokens: 12,
    outputTokens: 7,
    requestIdPrefix: "paid-chain",
  };
  const runOptions = {
    ...options,
    approvedPlanSha256: plan.approval_plan_sha256 as string,
  };
  await writeFile(ledgerPath, "", "utf8");
  await assert.rejects(
    extractFixedEightWithScriptedProviderForTests(
      runOptions,
      scriptedScenario,
      { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
    ),
    /prior_ledger_was_truncated/u,
  );
  assert.equal(await readFile(ledgerPath, "utf8"), "");
  await writeFile(ledgerPath, historicalLedgerBytes);
  const completedExecution = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    scriptedScenario,
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  const completed = completedExecution.manifest;
  assert.equal(completed.units.filter((unit) => unit.stage === "extracted").length, 8);
  assert.equal(completedExecution.providerCalls, 9);
  assert.equal(completedExecution.observedRepairs[0], undefined);
  assert.equal(completedExecution.observedRepairs[1]?.reason, "static_validation_retry");
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);
  assert.ok(completed.units.every((unit) => unit.extraction?.provider_mode === "production_paid"));
  assert.ok(completed.units.every(
    (unit) => unit.extraction?.paid_plan_sha256 === plan.approval_plan_sha256,
  ));
  const ledgerRows = (await readFile(ledgerPath, "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(ledgerRows.length, 10);
  assert.ok(ledgerRows.slice(1).every(
    (row) => row.paid_plan_sha256 === plan.approval_plan_sha256,
  ));
  const settledDomain = await loadPaidExecutionDomainForPlanningForTests(
    stateDir,
    { authorityRoot },
  );
  assert.ok(
    settledDomain.cumulative_committed_cost_nano_usd
      < historicalLedger.estimated_cost_usd * 1_000_000_000
        + (completedExecution.providerCalls * providerBoundReservation("gpt-5.6-luna").maximumCostNanoUsd),
    "exact completed checkpoints must release unused per-call reservation",
  );

  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const checkpointNames = (await readdir(checkpointDirectory)).filter((name) => name.endsWith(".json"));
  const removedCheckpointPath = path.join(checkpointDirectory, checkpointNames[0] as string);
  const removedCheckpointBytes = await readFile(removedCheckpointPath);
  await rm(removedCheckpointPath);
  await assert.rejects(
    planExtractionForTests(options, {}, { authorityRoot }),
    /manual_reconciliation/u,
  );
  await writeFile(removedCheckpointPath, removedCheckpointBytes);

  const resumedExecution = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    scriptedScenario,
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  const resumed = resumedExecution.manifest;
  assert.equal(resumedExecution.providerCalls, 0);
  assert.ok(resumed.units.every((unit) => unit.extraction?.cache_hit === true));

  const replayPlan = await planExtractionForTests(options, {}, { authorityRoot });
  assert.notEqual(replayPlan.approval_plan_sha256, plan.approval_plan_sha256);
  await rm(path.join(stateDir, ".cache", "extract"), { recursive: true, force: true });
  const replayBlockedExecution = await extractFixedEightWithScriptedProviderForTests(
    { ...options, approvedPlanSha256: replayPlan.approval_plan_sha256 as string },
    scriptedScenario,
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  const replayBlocked = replayBlockedExecution.manifest;
  assert.equal(
    replayBlockedExecution.providerCalls,
    0,
    "a failed attempt completed by a later success checkpoint must not be replayed",
  );
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);
  assert.ok(replayBlocked.units.every((unit) => unit.stage === "error"));
  assert.ok(replayBlocked.units.every((unit) => unit.notices.some(
    (notice) => /cross_plan_replay/u.test(notice),
  )));
});

test("a conservatively settled timeout does not poison same-plan continuation or resume", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-timeout-resume-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < FIXED_EIGHT_ORDERED_UNIT_IDS.length; index += 1) {
    await writeDummyDocx(
      path.join(regionDir, `(제주)_paid-timeout-${index}.docx`),
      `paid timeout fixture ${index} 더미 기본 패키지 290만원`,
    );
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  manifest.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(manifestPath, manifest);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });

  const options = {
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  };
  const plan = await planExtractionForTests(options, {}, { authorityRoot });
  assert.match(plan.approval_plan_sha256 ?? "", /^[a-f0-9]{64}$/u);
  const responsesByCanonicalName = Object.fromEntries(manifest.units.map((unit) => [
    unit.parsed.raw_name,
    dummyExtraction(unit.parsed.raw_name),
  ]));
  const runOptions = {
    ...options,
    approvedPlanSha256: plan.approval_plan_sha256 as string,
  };

  const interrupted = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    {
      responsesByCanonicalName,
      failFirstAmbiguousTimeouts: 1,
      inputTokens: 12,
      outputTokens: 7,
      requestIdPrefix: "paid-timeout-first",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  assert.equal(interrupted.providerCalls, 8);
  assert.equal(interrupted.manifest.units.filter((unit) => unit.stage === "error").length, 1);
  assert.equal(interrupted.manifest.units.filter((unit) => unit.stage === "extracted").length, 7);
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);

  const resumed = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    {
      responsesByCanonicalName,
      inputTokens: 12,
      outputTokens: 7,
      requestIdPrefix: "paid-timeout-resume",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  assert.equal(resumed.providerCalls, 1, JSON.stringify(resumed.manifest.units.map((unit) => ({
    unit_id: unit.unit_id,
    stage: unit.stage,
    notices: unit.notices,
  }))));
  assert.ok(resumed.manifest.units.every((unit) => unit.stage === "extracted"));
  const ledgerRows = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const timeout = ledgerRows.find((row) => row.success === false);
  assert.equal(timeout?.error_category, "timeout");
  assert.equal(timeout?.charge_basis, "reservation_upper_bound");
  assert.equal(timeout?.input_tokens, 0);
  assert.equal(timeout?.output_tokens, 0);
  assert.equal(timeout?.request_id, null);
  const resumedUnitRows = ledgerRows.filter((row) => row.unit_id === FIXED_EIGHT_ORDERED_UNIT_IDS[0]);
  assert.deepEqual(resumedUnitRows.map((row) => row.attempt), [1, 2]);
  assert.deepEqual(resumedUnitRows.map((row) => row.success), [false, true]);
  assert.equal(resumedUnitRows[0]?.run_id, resumedUnitRows[1]?.run_id);
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const resumedCheckpoint = await Promise.all(
    (await readdir(checkpointDirectory)).filter((name) => name.endsWith(".json"))
      .map((name) => readJsonFile(path.join(checkpointDirectory, name))),
  ).then((checkpoints) => checkpoints.find((checkpoint) =>
    (checkpoint as { unit_id?: string }).unit_id === FIXED_EIGHT_ORDERED_UNIT_IDS[0]
  ) as { attempts: number; attempt_request_hashes: string[] } | undefined);
  assert.equal(resumedCheckpoint?.attempts, 2);
  assert.equal(resumedCheckpoint?.attempt_request_hashes.length, 2);
  assert.equal(
    resumedCheckpoint?.attempt_request_hashes[0],
    resumedCheckpoint?.attempt_request_hashes[1],
  );

  const idempotent = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    {
      responsesByCanonicalName,
      inputTokens: 12,
      outputTokens: 7,
      requestIdPrefix: "paid-timeout-idempotent",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  assert.equal(idempotent.providerCalls, 0);
  assert.ok(idempotent.manifest.units.every((unit) => unit.stage === "extracted"));
});

test("a conservatively settled 5xx after an invalid response resumes the repaired request at attempt three", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-5xx-resume-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < FIXED_EIGHT_ORDERED_UNIT_IDS.length; index += 1) {
    await writeDummyDocx(
      path.join(regionDir, `(제주)_paid-5xx-${index}.docx`),
      `paid 5xx fixture ${index} 더미 기본 패키지 290만원`,
    );
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  manifest.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(manifestPath, manifest);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });

  const options = {
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  };
  const plan = await planExtractionForTests(options, {}, { authorityRoot });
  const runOptions = {
    ...options,
    approvedPlanSha256: plan.approval_plan_sha256 as string,
  };
  const responsesByCanonicalName = Object.fromEntries(manifest.units.map((unit) => [
    unit.parsed.raw_name,
    dummyExtraction(unit.parsed.raw_name),
  ]));
  const interrupted = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    {
      responsesByCanonicalName,
      failFirstInvalidResponses: 1,
      failProvider5xxOnCalls: [2],
      inputTokens: 12,
      outputTokens: 7,
      requestIdPrefix: "paid-5xx-first",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  assert.equal(interrupted.providerCalls, 9);
  assert.equal(interrupted.manifest.units.filter((unit) => unit.stage === "error").length, 1);
  assert.equal(interrupted.manifest.units.filter((unit) => unit.stage === "extracted").length, 7);
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);

  const resumed = await extractFixedEightWithScriptedProviderForTests(
    runOptions,
    {
      responsesByCanonicalName,
      inputTokens: 12,
      outputTokens: 7,
      requestIdPrefix: "paid-5xx-resume",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  assert.equal(resumed.providerCalls, 1);
  assert.ok(resumed.manifest.units.every((unit) => unit.stage === "extracted"));
  const ledgerRows = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const resumedUnitRows = ledgerRows.filter((row) => row.unit_id === FIXED_EIGHT_ORDERED_UNIT_IDS[0]);
  assert.deepEqual(resumedUnitRows.map((row) => row.attempt), [1, 2, 3]);
  assert.deepEqual(resumedUnitRows.map((row) => row.success), [false, false, true]);
  assert.deepEqual(resumedUnitRows.map((row) => row.error_category), [
    "invalid_response",
    "provider_5xx",
    null,
  ]);
  assert.equal(resumedUnitRows[0]?.run_id, resumedUnitRows[2]?.run_id);
  assert.notEqual(resumedUnitRows[0]?.request_hash, resumedUnitRows[1]?.request_hash);
  assert.equal(resumedUnitRows[1]?.request_hash, resumedUnitRows[2]?.request_hash);
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const resumedCheckpoint = await Promise.all(
    (await readdir(checkpointDirectory)).filter((name) => name.endsWith(".json"))
      .map((name) => readJsonFile(path.join(checkpointDirectory, name))),
  ).then((checkpoints) => checkpoints.find((checkpoint) =>
    (checkpoint as { unit_id?: string }).unit_id === FIXED_EIGHT_ORDERED_UNIT_IDS[0]
  ) as { attempts: number; attempt_request_hashes: string[] } | undefined);
  assert.equal(resumedCheckpoint?.attempts, 3);
  assert.equal(resumedCheckpoint?.attempt_request_hashes.length, 3);
  assert.notEqual(
    resumedCheckpoint?.attempt_request_hashes[0],
    resumedCheckpoint?.attempt_request_hashes[1],
  );
  assert.equal(
    resumedCheckpoint?.attempt_request_hashes[1],
    resumedCheckpoint?.attempt_request_hashes[2],
  );
});

test("raising the runtime env limit cannot spend beyond the approved plan ceiling", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-approved-ceiling-"));
  const stateDir = `${rootDir}-state`;
  const authorityRoot = `${rootDir}-authority`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(authorityRoot, { recursive: true, force: true }),
    rm(`${authorityRoot}.initialized.json`, { force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < FIXED_EIGHT_ORDERED_UNIT_IDS.length; index += 1) {
    await writeDummyDocx(
      path.join(regionDir, `(제주)_approved-ceiling-${index}.docx`),
      `approved ceiling fixture ${index} 더미 기본 패키지 290만원`,
    );
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  manifest.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(manifestPath, manifest);

  const options = {
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  };
  const unapprovedEstimate = await planExtraction(
    { stateDir, unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS] },
    {},
  );
  const approvedCeiling = 3;
  assert.ok(unapprovedEstimate.estimated_cost_usd < approvedCeiling);
  assert.ok(unapprovedEstimate.maximum_single_attempt_cost_usd < approvedCeiling);
  assert.ok(unapprovedEstimate.maximum_cost_usd > approvedCeiling);
  assert.ok(approvedCeiling < 20);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await planExtractionForTests(options, {
    INGEST_MAX_UNCACHED_COST_USD: String(approvedCeiling),
  }, { authorityRoot });
  assert.match(plan.approval_plan_sha256 ?? "", /^[a-f0-9]{64}$/u);

  const scriptedScenario = {
    responsesByCanonicalName: Object.fromEntries(manifest.units.map((unit) => [
      unit.parsed.raw_name,
      dummyExtraction(unit.parsed.raw_name),
    ])),
    failFirstInvalidResponses: 1,
    inputTokens: 10,
    outputTokens: 5,
    requestIdPrefix: "approved-ceiling",
  };

  await assert.rejects(
    extractFixedEightWithScriptedProviderForTests(
      { ...options, approvedPlanSha256: plan.approval_plan_sha256 as string },
      scriptedScenario,
      {
        env: { INGEST_MAX_UNCACHED_COST_USD: "20" },
        paidExecutionDomainAuthorityRoot: authorityRoot,
      },
    ),
    /uncached_paid_call_cost_fence/u,
  );
  const ledgerRows = (await readFile(
    path.join(stateDir, ".cache", "ai-ledger.ndjson"),
    "utf8",
  )).trim().split("\n");
  assert.equal(ledgerRows.length, 1);
});

test("extract uses lower-cost Luna by default and reuses a successful content-addressed cache", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_더미플래너.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const requests: Array<{ model: string; text: string }> = [];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      requests.push({ model: request.model, text: request.text });
      return { data: dummyExtraction("더미플래너"), inputTokens: 100, outputTokens: 50 };
    },
  };

  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const second = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(resolveExtractionModel({}), "gpt-5.6-luna");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.6-luna");
  assert.match(requests[0].text, /더미 기본 패키지 290만원/u);
  assert.equal(first.units[0].stage, "extracted");
  assert.equal(second.units[0].extraction?.cache_hit, true);
  assert.match(second.units[0].extraction?.artifact_path ?? "", /\.cache[\\/]extract[\\/][a-f0-9]{64}\.json$/u);
  const artifact = JSON.parse(await readFile(second.units[0].extraction?.artifact_path ?? "", "utf8"));
  assert.equal(artifact.schema_version, 3);
  assert.equal(artifact.provider_mode, "test_only");
  assert.equal(artifact.paid_plan_sha256, null);
  assert.equal(artifact.unit_id, second.units[0].unit_id);
  assert.equal(second.units[0].extraction?.content_sha256, artifact.content_sha256);

  const ledgerPath = path.join(stateDir, ".cache", "ai-ledger.ndjson");
  const ledgerRows = (await readFile(ledgerPath, "utf8")).trim().split("\n").map(
    (line) => JSON.parse(line),
  );
  ledgerRows[0].request_id = "forged-request-id";
  await writeFile(ledgerPath, `${ledgerRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  const rejected = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(requests.length, 1);
  assert.equal(rejected.units[0].stage, "error");
  assert.match(rejected.units[0].notices.join("\n"), /ledger_provenance_mismatch/u);
});

test("a content-tampered extraction cache fails closed without another provider charge", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cache-tamper-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cache-tamper.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("cache tamper"), inputTokens: 10, outputTokens: 10 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const cachePath = first.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(cachePath, "utf8"));
  artifact.data.business_name = "schema-valid tampering";
  await writeFile(cachePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 1);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /content hash/u);
});

test("a self-rehashed cache with changed prompt identity still fails closed", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cache-identity-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cache-identity.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("cache identity"), inputTokens: 10, outputTokens: 10 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const cachePath = first.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(cachePath, "utf8"));
  artifact.prompt_version = "forged-prompt";
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeFile(cachePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 1);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /identity_mismatch/u);
});

test("a self-rehashed cache cannot omit its batch checkpoint replay set", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cache-empty-checkpoints-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cache-empty-checkpoints.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("cache empty checkpoints"), inputTokens: 10, outputTokens: 10 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const cachePath = first.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(cachePath, "utf8"));
  artifact.batch_checkpoint_fingerprints = [];
  artifact.batch_checkpoint_result_hashes = [];
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeFile(cachePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 1);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /schema_or_legacy_artifact|checkpoint_set_mismatch/u);
});

test("a self-rehashed final cache cannot diverge from checkpoint replay", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cache-finalization-replay-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cache-finalization-replay.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("checkpoint-backed result"), inputTokens: 10, outputTokens: 10 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const cachePath = first.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(cachePath, "utf8"));
  artifact.data.business_name = "self-rehashed forged final result";
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeFile(cachePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 1);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /finalization_mismatch/u);
});

test("a self-rehashed checkpoint with a substituted request hash is rejected", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-checkpoint-request-substitution-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "checkpoint-request-substitution.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("checkpoint request substitution"), inputTokens: 10, outputTokens: 10 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const cachePath = first.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(cachePath, "utf8"));
  const checkpointFingerprint = artifact.batch_checkpoint_fingerprints[0] as string;
  const checkpointPath = path.join(
    stateDir,
    ".cache",
    "extract-batches",
    `${checkpointFingerprint}.json`,
  );
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  checkpoint.request_hash = checkpoint.request_hash === "a".repeat(64)
    ? "b".repeat(64)
    : "a".repeat(64);
  checkpoint.content_sha256 = canonicalJsonSha256ExcludingField(checkpoint, "content_sha256");
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 1);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /checkpoint_identity/u);
});

test("extraction cache identity includes the scanner processing version", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-processing-cache-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "processing-version.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      return { data: dummyExtraction("processing version"), inputTokens: 1, outputTokens: 1 };
    },
  };
  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const firstFingerprint = first.units[0].extraction?.fingerprint;
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.scanner_parser_version = "v-next-scanner-fixture";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const second = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(calls, 2);
  assert.notEqual(second.units[0].extraction?.fingerprint, firstFingerprint);
});

test("text extraction materializes the money audit ledger from source evidence instead of trusting a conflicting model copy", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-ledger-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울(강남)");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_원장테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["가격(단위: 만원, VAT 포함)"],
    ["업체명", "기본가격"],
    ["원장스튜디오", 105],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const modelResult = dummyExtraction("원장테스트");
  modelResult.agency_packages[0].price_min_krw = 1_050_000;
  modelResult.agency_packages[0].price_max_krw = 1_050_000;
  modelResult.agency_packages[0].source_quote = "가격표!B3: 105";
  modelResult.money_occurrences = [{
    amount_krw: 10_500_000,
    raw_text: "105",
    source_quote: "가격표!B3: 105",
    source_file_ids: ["f".repeat(64)],
    kind: "price",
    needs_review: false,
  }];
  const extracted = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async () => ({ data: modelResult, inputTokens: 10, outputTokens: 10 }),
    },
  });
  const unit = extracted.units[0];
  const artifact = JSON.parse(await readFile(unit.extraction?.artifact_path ?? "", "utf8"));

  assert.deepEqual(artifact.data.money_occurrences, [{
    amount_krw: 1_050_000,
    raw_text: "105",
    source_quote: "가격표!B3: 105",
    source_file_ids: [sourceFileId(scanned.units[0].source_files[0])],
    kind: "price",
    needs_review: false,
  }]);
});

test("workbook extraction never splits cells from the same sheet row across requests", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-atomic-rows-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울(강남)");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_행원자성테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string | number>> = [
    ["가격(단위: 만원, VAT 포함)"],
    ["업체명", "기본가격", "주요선택품목가격"],
    ...Array.from({ length: 8 }, (_, index) => [
      `행원자성업체${index + 1}`,
      100 + index,
      `${"세부조건".repeat(100)} 야간씬:${10 + index}`,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const requestTexts: string[] = [];
  const extracted = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        requestTexts.push(request.text);
        const data = dummyExtraction("행원자성테스트");
        data.agency_packages = [];
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.ok(requestTexts.length > 1);
  for (let row = 3; row <= 10; row += 1) {
    const owners = requestTexts.filter((text) =>
      [`가격표!A${row}:`, `가격표!B${row}:`, `가격표!C${row}:`].some((locator) => text.includes(locator))
    );
    assert.equal(owners.length, 1, `가격표 ${row}행은 정확히 한 요청에만 있어야 합니다.`);
    assert.match(owners[0], new RegExp(`가격표!A${row}:`, "u"));
    assert.match(owners[0], new RegExp(`가격표!B${row}:`, "u"));
    assert.match(owners[0], new RegExp(`가격표!C${row}:`, "u"));
  }
});

test("workbook extraction carries a vertically merged vendor identity into each priced row", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-merged-vendor-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울(강남)");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_병합업체테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["가격(단위: 만원, VAT 포함)"],
    ["업체명", "기본가격", "옵션"],
    ["병합스튜디오", 100, "기본"],
    [null, null, "야간촬영 20"],
  ]);
  sheet["!merges"] = [XLSX.utils.decode_range("A3:A4")];
  XLSX.utils.book_append_sheet(workbook, sheet, "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const requestTexts: string[] = [];

  await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        requestTexts.push(request.text);
        return { data: dummyExtraction("병합업체테스트"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  const rowFourOwner = requestTexts.find((text) => text.includes("가격표!C4: 야간촬영 20"));
  assert.ok(rowFourOwner);
  assert.match(rowFourOwner, /\[병합 상속: 가격표!A3 -> 4행 A4\] 병합스튜디오/u);
  assert.doesNotMatch(rowFourOwner, /^가격표!A4:/mu);
});

test("extract accepts a bounded large unit that needs more than 96 text chunks", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-large-unit-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_샘플대형홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  const longText = Array.from(
    { length: 120 },
    (_, index) => `샘플 공시 100만원 ${index} ${"안내".repeat(1_000)}`,
  ).join("\n");
  await convertManifest({ stateDir }, {
    extractPdfText: async () => longText,
    rasterizePdf: rasterizeGeneratedPdf,
  });
  let requests = 0;

  const result = await extractManifest(
    { stateDir },
    {
      env: {},
      provider: {
        extract: async () => {
          requests += 1;
          const data = dummyExtraction("샘플대형홀");
          data.agency_packages[0].price_min_krw = 1_000_000;
          data.agency_packages[0].price_max_krw = 1_000_000;
          data.agency_packages[0].source_quote = "샘플 공시 100만원";
          return { data, inputTokens: 10, outputTokens: 5 };
        },
      },
    },
  );

  assert.ok(requests > 96 && requests <= 256);
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join("\n"));
});

test("extract rejects every model outside the Luna/Terra allowlist", () => {
  assert.throws(
    () => resolveExtractionModel({ EXTRACTION_MODEL: "gpt-4o" }),
    /gpt-5\.6-luna.*gpt-5\.6-terra/u,
  );
});

test("paid-call cost limit keeps the legacy default and permits the explicit fifty-dollar run cap", () => {
  assert.equal(resolveUncachedPaidCallLimitUsd({}), 20);
  assert.equal(resolveUncachedPaidCallLimitUsd({ INGEST_MAX_UNCACHED_COST_USD: "7.5" }), 7.5);
  assert.equal(resolveUncachedPaidCallLimitUsd({ INGEST_MAX_UNCACHED_COST_USD: "50" }), 50);
  assert.throws(
    () => resolveUncachedPaidCallLimitUsd({ INGEST_MAX_UNCACHED_COST_USD: "50.01" }),
    /between 0 and 50/u,
  );
});

test("OpenAI extraction provider pins the official endpoint and rejects ambient overrides", () => {
  assert.throws(
    () => assertOpenAIExtractionProviderEnvironment({
      INGEST_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "test-key-never-sent",
      OPENAI_BASE_URL: "https://proxy.invalid/v1",
    }),
    /공식 OpenAI API 주소/u,
  );
  assert.doesNotThrow(() => assertOpenAIExtractionProviderEnvironment({
    INGEST_OPENAI_ENABLED: "true",
    OPENAI_API_KEY: "test-key-never-sent",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  }));
  assert.throws(
    () => assertOpenAIExtractionProviderEnvironment({
      INGEST_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "test-key-never-sent",
      OPENAI_CUSTOM_HEADERS: "Authorization: Bearer wrong-key",
    }),
    /OPENAI_CUSTOM_HEADERS is not allowed/u,
  );
});

test("OpenAI extraction request uses Responses structured output and never stores the response", async (t) => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-openai-request-"));
  t.after(async () => rm(fixtureDir, { recursive: true, force: true }));
  const imagePath = path.join(fixtureDir, "dummy.png");
  await writeFile(imagePath, "generated-image-fixture");

  const request = await buildOpenAIResponseRequest({
    unitId: "a".repeat(64),
    model: "gpt-5.6-terra",
    canonicalName: "샘플홀",
    regionCode: "seoul_etc",
    kindHint: "hall",
    text: "더미 원문",
    imagePaths: [imagePath],
    imageSourceRefs: [{
      artifactId: sha256Text("generated-image-fixture"),
      sources: [{ sourceFileId: "c".repeat(64), sourcePath: "예식장/서울/샘플홀.png" }],
    }],
  });

  assert.equal(request.store, false);
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.max_output_tokens, PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP);
  assert.equal(request.temperature, 0);
  assert.equal(request.reasoning?.effort, "none");
  assert.equal(request.service_tier, "default");
  assert.equal(request.text?.format?.type, "json_schema");
  assert.equal(request.tools, undefined);
  assert.match(String(request.instructions), /텍스트.*money_occurrences.*빈 배열.*이미지.*금액 발생/isu);
  assert.match(String(request.instructions), /단일 셀·도형·수식 locator.*여러 locator.*세미콜론.*만들지 않습니다/isu);
  assert.match(String(request.instructions), /XLSX_FORMULA.*절대로 계산하거나 외부 함수를 실행하지 않습니다/isu);
  assert.match(String(request.instructions), /parent price.*null.*options.*parent와 option.*중복/isu);
  assert.match(String(request.instructions), /보완적 halls 레코드.*셀별.*exact source_quote/isu);
  assert.match(String(request.instructions), /%는 비율.*KRW 금액이 아닙니다.*money_occurrences/isu);
  assert.match(String(request.instructions), /이미지 응답 완료 전.*통화 금액.*전수 스캔/isu);
  assert.match(JSON.stringify(request.input), /data:image\/png;base64/u);
  assert.match(JSON.stringify(request.input), /샘플홀/u);
  assert.match(JSON.stringify(request.input), /hall/u);
  assert.match(JSON.stringify(request.input), /source_file_id: c{64}/u);
  assert.match(JSON.stringify(request.input), /예식장\/서울\/샘플홀\.png/u);
});

test("OpenAI request creation rejects image bytes that differ from the request-bound digest", async (t) => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-openai-image-digest-"));
  t.after(async () => rm(fixtureDir, { recursive: true, force: true }));
  const imagePath = path.join(fixtureDir, "same-size.png");
  await writeFile(imagePath, "first-image-bytes");
  const artifactId = (await sha256File(imagePath)).sha256;
  await writeFile(imagePath, "other-image-bytes");

  await assert.rejects(
    buildOpenAIResponseRequest({
      unitId: "a".repeat(64),
      model: "gpt-5.6-luna",
      canonicalName: "fixture",
      regionCode: "seoul_etc",
      kindHint: "agency",
      text: "",
      imagePaths: [imagePath],
      imageSourceRefs: [{
        artifactId,
        sources: [{ sourceFileId: "c".repeat(64), sourcePath: "fixture.png" }],
      }],
    }),
    /image_artifact_digest_changed_before_provider/u,
  );
});

test("multi-batch retries reuse successful schema-validated checkpoints instead of paying twice", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-batch-checkpoint-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_체크포인트홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest(
    { stateDir },
    {
      extractPdfText: async () => "체크포인트홀 100만원\n".repeat(4_000),
      rasterizePdf: rasterizeGeneratedPdf,
    },
  );

  const callTexts: string[] = [];
  let shouldFailSecondBatch = true;
  const provider: ExtractionProvider = {
    extract: async (request) => {
      callTexts.push(request.text);
      if (shouldFailSecondBatch && callTexts.length === 2) {
        shouldFailSecondBatch = false;
        throw new Error("generated second-batch failure");
      }
      const data = dummyExtraction("체크포인트홀");
      data.agency_packages[0].price_min_krw = 1_000_000;
      data.agency_packages[0].price_max_krw = 1_000_000;
      data.agency_packages[0].source_quote = "체크포인트홀 100만원";
      return { data, inputTokens: 11, outputTokens: 7 };
    },
  };

  const failed = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(failed.units[0].stage, "error");
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const checkpointNames = await import("node:fs/promises").then(({ readdir }) => readdir(checkpointDirectory));
  assert.equal(checkpointNames.length, 1);
  const checkpoint = JSON.parse(await readFile(path.join(checkpointDirectory, checkpointNames[0]), "utf8"));
  assert.equal(ExtractionBatchCheckpointSchema.safeParse(checkpoint).success, true);
  assert.equal(checkpoint.canonical_identity.canonical_name, "체크포인트홀");
  assert.match(checkpoint.prompt_hash, /^[a-f0-9]{64}$/u);
  assert.match(checkpoint.request_hash, /^[a-f0-9]{64}$/u);

  const completed = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(completed.units[0].stage, "extracted");
  assert.ok(callTexts.length > 3 && callTexts.length <= 97);
  assert.equal(callTexts.filter((value) => value === callTexts[0]).length, 1);
  assert.equal(completed.units[0].extraction?.input_tokens, (callTexts.length - 1) * 11);
  assert.equal(completed.units[0].extraction?.output_tokens, (callTexts.length - 1) * 7);

  const callsAfterCompletion = callTexts.length;
  const cached = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(cached.units[0].stage, "extracted");
  assert.equal(cached.units[0].extraction?.cache_hit, true);
  assert.equal(callTexts.length, callsAfterCompletion);
});

test("workbook preparation removes duplicated Markdown rows but preserves located cells", () => {
  const prepared = stripRedundantWorkbookMarkdown([
    "## 시트: 가격표",
    "가격표!A1: 업체명",
    "가격표!B2: 123",
    "| 셀 | 값 |",
    "| --- | --- |",
    "| A1 | 업체명 |",
    "| B2 | 123 |",
  ].join("\n"));

  assert.match(prepared, /가격표!B2: 123/u);
  assert.doesNotMatch(prepared, /^\|/mu);
  assert.equal((prepared.match(/123/gu) ?? []).length, 1);
});

test("workbook interpretation context repeats horizontally merged price-header ownership", () => {
  const context = workbookInterpretationContext([
    "## 시트: 가격표",
    "가격표!C4: 주요선택품목가격",
    "병합 범위 C4:E4 · 좌상단 C4",
  ].join("\n"));

  assert.match(context, /\[병합 헤더: 가격표!C4:E4 · 좌상단 C4\] 주요선택품목가격/u);
});

test("workbook interpretation context excludes substantive policy rows from other extraction chunks", () => {
  const context = workbookInterpretationContext([
    "## 시트: Sheet1",
    "Sheet1!A2: 업체명",
    "Sheet1!B2: 식대",
    "Sheet1!A10: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "병합 범위 A10:M10 · 좌상단 A10",
  ].join("\n"));

  assert.match(context, /Sheet1!A2: 업체명/u);
  assert.match(context, /Sheet1!B2: 식대/u);
  assert.doesNotMatch(context, /A10|계약해지|산정기준/u);
});

test("an invalid batch checkpoint fails closed before another provider charge", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-invalid-checkpoint-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_깨진체크포인트홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest(
    { stateDir },
    {
      extractPdfText: async () => "깨진체크포인트홀 100만원\n".repeat(4_000),
      rasterizePdf: rasterizeGeneratedPdf,
    },
  );

  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      if (calls === 2) throw new Error("generated second-batch failure");
      const data = dummyExtraction("깨진체크포인트홀");
      data.agency_packages[0].price_min_krw = 1_000_000;
      data.agency_packages[0].price_max_krw = 1_000_000;
      data.agency_packages[0].source_quote = "깨진체크포인트홀 100만원";
      return { data, inputTokens: 1, outputTokens: 1 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const checkpointName = await import("node:fs/promises").then(async ({ readdir }) => (await readdir(checkpointDirectory))[0]);
  const checkpointPath = path.join(checkpointDirectory, checkpointName);
  const tamperedCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  tamperedCheckpoint.data.business_name = "schema-valid tampering";
  assert.equal(ExtractionBatchCheckpointSchema.safeParse(tamperedCheckpoint).success, true);
  await writeFile(checkpointPath, `${JSON.stringify(tamperedCheckpoint)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(calls, 2);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /batch_checkpoint_invalid/u);
});

test("an absent XLSX citation is repaired once, then removed while valid data survives", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-batch-evidence-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_청크근거테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["가격(단위: 만원)"],
    ["패키지", "기본가격"],
    ["실제 패키지", 290],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        const data = dummyExtraction("청크근거테스트");
        data.agency_packages[0].source_quote = "가격표!B99: 290";
        if (captured.length === 2) {
          data.agency_packages.push({
            ...data.agency_packages[0],
            package_name: "검증된 패키지",
            source_quote: "가격표!B3: 290",
          });
          data.extraction_notes = "provider note preserved";
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(captured.length, 2);
  assert.equal(captured[0].repair, undefined);
  assert.equal(captured[1].repair?.reason, "xlsx_locator_ownership");
  assert.equal(captured[1].repair?.rejectedLocator, "가격표!B99");
  assert.ok(captured[1].repair?.allowedXlsxLocators.includes("가격표!B3"));
  assert.equal(captured[1].repair?.allowedXlsxLocators.includes("가격표!B99"), false);
  assert.match(captured[1].repair?.allowedLocatorSetSha256 ?? "", /^[a-f0-9]{64}$/u);

  const repairPayload = JSON.stringify(await buildOpenAIResponseRequest(captured[1]));
  assert.match(repairPayload, /trusted_repair_constraints/u);
  assert.match(repairPayload, /가격표!B3/u);
  assert.match(repairPayload, /허용 목록에 없는 XLSX locator/u);
  assert.match(repairPayload, /일반 시트 셀은 그 셀의 실제 연속 원문 조각/u);
  assert.match(repairPayload, /XLSX_DRAWING\/XLSX_FORMULA는[^\n]*payload 전체를 생략·축약 없이 정확히 복사/u);
  assert.doesNotMatch(repairPayload, /단일 locator와 그 뒤의 실제 연속 원문 조각만/u);

  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledger[0].rejected_locator, "가격표!B99");
  assert.equal(ledger[0].allowed_locator_count, captured[1].repair?.allowedXlsxLocators.length);
  assert.equal(ledger[0].allowed_locator_set_sha256, captured[1].repair?.allowedLocatorSetSha256);
  assert.equal(JSON.stringify(ledger[0]).includes("가격표!B99: 290"), false);
  assert.equal(result.units[0].stage, "extracted");
  const artifact = JSON.parse(
    await readFile(result.units[0].extraction!.artifact_path, "utf8"),
  );
  assert.deepEqual(
    artifact.data.agency_packages.map((item: { package_name: string }) => item.package_name),
    ["검증된 패키지"],
  );
  assert.equal(JSON.stringify(artifact.data).includes("가격표!B99: 290"), false);
  assert.match(artifact.data.extraction_notes, /provider note preserved/u);
  assert.match(
    artifact.data.extraction_notes,
    /local_evidence_guard.*xlsx_source_quote:1.*agency_packages\[0\]/u,
  );
  assert.equal(ledger[1].success, true);
});

test("an XLSX ownership repair retry can re-emit using only the exact allowlisted cell", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-batch-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_청크수리테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["가격(단위: 만원)"],
    ["패키지", "기본가격"],
    ["실제 패키지", 290],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("청크수리테스트");
        data.agency_packages[0].source_quote = calls === 1
          ? "가격표!A3: 실제 패키지; 가격표!B3: 290"
          : "가격표!B3: 290";
        if (calls === 2) {
          assert.equal(request.repair?.reason, "xlsx_locator_ownership");
          assert.equal(request.repair?.rejectedLocator, "가격표!A3");
          assert.deepEqual(
            request.repair?.allowedXlsxLocators.filter((locator) => locator.endsWith("!B3")),
            ["가격표!B3"],
          );
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.units[0].stage, "extracted");
  assert.equal(result.units[0].notices.some((notice) => notice.startsWith("extract 실패:")), false);
  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(ledger[0].locator_violation, "not_exact_single_cell");
  assert.equal(JSON.stringify(ledger[0]).includes("실제 패키지"), false);
  assert.match(ledger[0].request_hash, /^[a-f0-9]{64}$/u);
  assert.match(ledger[1].request_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(ledger[0].request_hash, ledger[1].request_hash);
  const finalArtifact = await readJsonFile(result.units[0].extraction!.artifact_path) as {
    batch_checkpoint_fingerprints: string[];
  };
  const checkpoint = await readJsonFile(path.join(
    stateDir,
    ".cache",
    "extract-batches",
    `${finalArtifact.batch_checkpoint_fingerprints[0]}.json`,
  )) as {
    attempt_request_hashes: string[];
    successful_request_hash: string;
  };
  assert.deepEqual(
    checkpoint.attempt_request_hashes,
    ledger.map((entry) => entry.request_hash),
  );
  assert.equal(checkpoint.successful_request_hash, ledger[1].request_hash);
});

test("XLSX ownership accepts one exact locator with a contiguous verbatim fragment from that cell", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cell-fragment-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_셀조각테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["패키지", "기본가격"],
    ["실제 패키지", "앞 문구 기본가격 290만원 뒤 문구"],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async () => {
        calls += 1;
        const data = dummyExtraction("셀조각테스트");
        data.agency_packages[0].source_quote = "가격표!B2: 기본가격 290만원";
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.units[0].stage, "extracted");
});

test("XLSX ownership accepts request-scoped drawing and formula evidence and repairs a forged part", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-aux-evidence-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_보조근거테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["패키지", "기본가격"],
    ["더미 기본 패키지 스튜디오 드레스 메이크업", "기본가격 290만원"],
  ]);
  worksheet.B20 = { t: "n", f: "SUM(B2)", v: 2_900_000, z: "#,##0" };
  worksheet["!ref"] = "A1:B20";
  XLSX.utils.book_append_sheet(workbook, worksheet, "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file(
    "xl/drawings/drawing1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:sp><xdr:txBody><a:p><a:r><a:t>총비용 = 기본가격</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:wsDr>',
  );
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const captured: ExtractionRequest[] = [];
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        captured.push(request);
        const drawing = request.text.match(/^XLSX_DRAWING .*$/mu)?.[0];
        const formula = request.text.match(/^XLSX_FORMULA .*$/mu)?.[0];
        assert.ok(drawing);
        assert.ok(formula);
        const data = dummyExtraction("보조근거테스트");
        data.agency_packages[0].source_quote = "가격표!B2: 기본가격 290만원";
        data.sections = [
          {
            section_type: "pricing_basis",
            title: "총비용",
            content_verbatim: "총비용 = 기본가격",
            summary: "도형 산정 기준",
            source_quote: drawing,
            source_file_ids: [],
            confidence: 0.99,
            needs_review: false,
          },
          {
            section_type: "pricing_basis",
            title: "SUM(B2)",
            content_verbatim: "SUM(B2)",
            summary: "수식 원문",
            source_quote: calls === 1 ? formula.replace("sheet1.xml", "sheet99.xml") : formula,
            source_file_ids: [],
            confidence: 0.99,
            needs_review: false,
          },
        ];
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(captured[1].repair?.reason, "xlsx_locator_ownership");
  assert.equal(
    captured[1].repair?.allowedXlsxLocators.some((locator) => locator.startsWith("XLSX_DRAWING ")),
    true,
  );
  assert.equal(
    captured[1].repair?.allowedXlsxLocators.some((locator) => locator.startsWith("XLSX_FORMULA ")),
    true,
  );
  assert.equal(result.units[0].stage, "extracted");
});

test("a repeated foreign source_file_id failure removes every invalid nested record", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-id-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_출처수리테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["패키지", "기본가격"],
    ["실제 패키지", "290만원"],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const allowedSourceId = /^source_file_id:\s*([a-f0-9]{64})$/gmu.exec(request.text)?.[1];
        assert.ok(allowedSourceId);
        const data = dummyExtraction("출처수리테스트");
        data.agency_packages[0].source_quote = "가격표!B2: 290만원";
        data.agency_packages[0].source_file_ids = [calls === 1 ? "f".repeat(64) : allowedSourceId];
        if (calls === 2) {
          data.agency_packages[0].options = [{
            name: "유효 옵션",
            price_min_krw: null,
            price_max_krw: null,
            unit: null,
            condition: null,
            raw_text: "유효 옵션",
            source_quote: "가격표!B2: 290만원",
            source_file_ids: [allowedSourceId],
          }, {
            name: "외부 옵션 1",
            price_min_krw: null,
            price_max_krw: null,
            unit: null,
            condition: null,
            raw_text: "외부 옵션 1",
            source_quote: "가격표!B2: 290만원",
            source_file_ids: ["e".repeat(64)],
          }, {
            name: "외부 옵션 2",
            price_min_krw: null,
            price_max_krw: null,
            unit: null,
            condition: null,
            raw_text: "외부 옵션 2",
            source_quote: "가격표!B2: 290만원",
            source_file_ids: ["d".repeat(64)],
          }];
        }
        if (calls === 2) {
          assert.equal(request.repair?.reason, "source_file_ownership");
          if (request.repair?.reason === "source_file_ownership") {
            assert.equal(request.repair.rejectedSourceFileId, "f".repeat(64));
            assert.deepEqual(request.repair.allowedSourceFileIds, [allowedSourceId]);
            assert.match(request.repair.allowedSourceFileSetSha256, /^[a-f0-9]{64}$/u);
          }
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2, result.units[0].notices.join(" | "));
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
  const artifact = JSON.parse(await readFile(result.units[0].extraction!.artifact_path, "utf8"));
  assert.deepEqual(
    artifact.data.agency_packages[0].options.map((option: { name: string }) => option.name),
    ["유효 옵션"],
  );
  assert.match(artifact.data.extraction_notes, /local_evidence_guard.*2 record/u);
  assert.match(artifact.data.extraction_notes, /agency_packages\[0\]\.options\[1\]/u);
  assert.match(artifact.data.extraction_notes, /agency_packages\[0\]\.options\[2\]/u);
});

test("a repeated XLSX source-quote failure removes all invalid nested records", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-nested-xlsx-record-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "서울");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(서울)_중첩근거테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["업체", "기본가", "옵션", "정책"],
    ["업체A", "100만원", "옵션 10만원", "환불 규정"],
  ]), "Prices");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const sourceId = /^source_file_id:\s*([a-f0-9]{64})$/gmu.exec(request.text)?.[1];
        assert.ok(sourceId);
        const data = dummyExtraction("중첩근거테스트");
        data.agency_packages = [];
        data.partner_vendors = [{
          vendor_name: "업체A",
          old_names: [],
          category: "studio",
          price_min_krw: 1_000_000,
          price_max_krw: 1_000_000,
          base_spec: null,
          price_note: null,
          options: [{
            name: "옵션",
            price_min_krw: 100_000,
            price_max_krw: 100_000,
            unit: null,
            condition: null,
            raw_text: "옵션 10만원",
            source_quote: calls === 1
              ? "Synthetic!Z99: 옵션 10만원"
              : "Prices!C2: 옵션 10만원",
            source_file_ids: [sourceId],
          }, ...(calls === 2 ? [{
            name: "합성 옵션",
            price_min_krw: null,
            price_max_krw: null,
            unit: null,
            condition: null,
            raw_text: "합성 옵션",
            source_quote: "Synthetic!Z97: 합성 옵션",
            source_file_ids: [sourceId],
          }] : [])],
          policies: [{
            policy_type: "refund",
            raw_text: "환불 규정",
            source_quote: calls === 2
              ? "Synthetic!Z98: 환불 규정"
              : "Prices!D2: 환불 규정",
            source_file_ids: [calls === 2 ? "e".repeat(64) : sourceId],
          }],
          source_quote: "Prices!B2: 100만원",
          source_file_ids: [sourceId],
          confidence: 0.95,
          needs_review: false,
        }];
        if (calls === 2) assert.equal(request.repair?.reason, "xlsx_locator_ownership");
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
  const artifact = JSON.parse(await readFile(result.units[0].extraction!.artifact_path, "utf8"));
  assert.equal(artifact.data.partner_vendors.length, 1);
  assert.equal(artifact.data.partner_vendors[0].options.length, 1);
  assert.equal(artifact.data.partner_vendors[0].policies.length, 0);
  assert.match(artifact.data.extraction_notes, /local_evidence_guard.*2 record/u);
  assert.match(
    artifact.data.extraction_notes,
    /partner_vendors\[0\]\.options\[1\]/u,
  );
  assert.match(
    artifact.data.extraction_notes,
    /local_evidence_guard.*partner_vendors\[0\]\.policies\[0\]/u,
  );
});

test("a second structured ownership failure sanitizes its own path even when the first path differed", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-hall-evidence-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(제주)_홀근거수리테스트.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["홀명", "식대", "대관료"],
    ["그랜드홀 1관", "75,000원~99,000원", "3,000,000원"],
  ]), "가격표");
  await writeFile(sourcePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const sourceId = /^source_file_id:\s*([a-f0-9]{64})$/gmu.exec(request.text)?.[1];
        assert.ok(sourceId);
        const data = dummyExtraction("홀근거수리테스트");
        data.doc_kind = "hall_disclosure";
        data.agency_packages = [];
        data.halls = [{
          hall_name: "그랜드홀 1관",
          guarantee_min: null,
          meal_price_min_krw: 75_000,
          meal_price_max_krw: 99_000,
          venue_fee_min_krw: calls === 2 ? 3_000_000 : null,
          venue_fee_max_krw: calls === 2 ? 3_000_000 : null,
          venue_fee_note: null,
          decoration_fee_min_krw: null,
          decoration_fee_max_krw: null,
          decoration_note: null,
          options: [],
          source_quote: "가격표!B2: 75,000원~99,000원",
          source_file_ids: [sourceId],
          confidence: 0.95,
          needs_review: false,
        }, {
          hall_name: "Second hall",
          guarantee_min: null,
          meal_price_min_krw: 75_000,
          meal_price_max_krw: 99_000,
          venue_fee_min_krw: calls === 2 ? 4_000_000 : null,
          venue_fee_max_krw: calls === 2 ? 4_000_000 : null,
          venue_fee_note: null,
          decoration_fee_min_krw: null,
          decoration_fee_max_krw: null,
          decoration_note: null,
          options: [],
          source_quote: calls === 1
            ? "가격표!A2: 그랜드홀 1관"
            : "가격표!B2: 75,000원~99,000원",
          source_file_ids: [sourceId],
          confidence: 0.95,
          needs_review: false,
        }];
        if (calls === 2) {
          assert.equal(request.repair?.reason, "structured_numeric_evidence");
          if (request.repair?.reason === "structured_numeric_evidence") {
            assert.equal(request.repair.rejectedPath, "halls[1]");
          }
        }
        return {
          data,
          inputTokens: 10,
          outputTokens: 10,
          providerModel: "gpt-5.6-luna-2026-07-15",
        };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.units[0].stage, "extracted");
  const artifact = JSON.parse(await readFile(result.units[0].extraction!.artifact_path, "utf8"));
  assert.equal(artifact.data.halls[0].meal_price_min_krw, 75_000);
  assert.equal(artifact.data.halls[0].meal_price_max_krw, 99_000);
  assert.equal(artifact.data.halls[0].venue_fee_min_krw, null);
  assert.equal(artifact.data.halls[0].venue_fee_max_krw, null);
  assert.equal(artifact.data.halls[1].meal_price_min_krw, 75_000);
  assert.equal(artifact.data.halls[1].meal_price_max_krw, 99_000);
  assert.equal(artifact.data.halls[1].venue_fee_min_krw, null);
  assert.equal(artifact.data.halls[1].venue_fee_max_krw, null);
  assert.equal(artifact.data.halls[1].needs_review, true);
  assert.match(artifact.data.extraction_notes, /local_evidence_guard.*4 field/u);
  assert.match(artifact.data.extraction_notes, /halls\[0\]/u);
  assert.match(artifact.data.extraction_notes, /halls\[1\]/u);
  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledger[0].success, false);
  assert.equal(ledger[0].provider_model, "gpt-5.6-luna-2026-07-15");
});

test("a repeated image evidence failure removes every invalid occurrence on the second attempt", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-percent-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_퍼센트테스트.png"), Buffer.from("not-a-real-png"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("퍼센트테스트");
        data.money_occurrences = calls === 1
          ? [{
              amount_krw: 100,
              raw_text: "100%",
              source_quote: "고객 만족 100%",
              source_file_ids: [request.imageSourceRefs[0].sources[0].sourceFileId],
              kind: "other_money",
              needs_review: false,
            }]
          : [{
              amount_krw: 100,
              raw_text: "100%",
              source_quote: "customer satisfaction 100%",
              source_file_ids: [request.imageSourceRefs[0].sources[0].sourceFileId],
              kind: "other_money",
              needs_review: false,
            }, {
              amount_krw: 20_000,
              raw_text: "20,000원",
              source_quote: "다른 금액 30,000원",
              source_file_ids: [request.imageSourceRefs[0].sources[0].sourceFileId],
              kind: "price",
              needs_review: false,
            }, {
              amount_krw: 50_000,
              raw_text: "50,000원",
              source_quote: "추가 비용 50,000원",
              source_file_ids: [request.imageSourceRefs[0].sources[0].sourceFileId],
              kind: "price",
              needs_review: false,
            }];
        if (calls === 2) {
          assert.equal(request.repair?.reason, "image_non_currency_percentage");
          if (request.repair?.reason === "image_non_currency_percentage") {
            assert.equal(request.repair.rejectedOccurrenceIndex, 0);
          }
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.units[0].stage, "extracted");
  const artifact = JSON.parse(await readFile(result.units[0].extraction!.artifact_path, "utf8"));
  assert.deepEqual(
    artifact.data.money_occurrences.map((occurrence: { amount_krw: number }) => occurrence.amount_krw),
    [50_000],
  );
  assert.match(artifact.data.extraction_notes, /local_evidence_guard.*2 occurrence/u);
  assert.match(artifact.data.extraction_notes, /money_occurrences\[0\]/u);
  assert.match(artifact.data.extraction_notes, /money_occurrences\[1\]/u);
  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(ledger[0].rejected_occurrence_index, 0);
  assert.equal(JSON.stringify(ledger[0]).includes("고객 만족"), false);
});

test("an image money occurrence must match both its raw text and source quote", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-money-evidence-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_이미지금액근거.png"), Buffer.from("not-a-real-png"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("이미지금액근거");
        data.money_occurrences = [{
          amount_krw: 50_000,
          raw_text: "+5만원",
          source_quote: calls === 1 ? "앨범 추가 20만원" : "보정 추가 +5만원",
          source_file_ids: [request.imageSourceRefs[0].sources[0].sourceFileId],
          kind: "price",
          needs_review: false,
        }];
        if (calls === 2) {
          assert.equal(request.repair?.reason, "image_money_evidence_mismatch");
          if (request.repair?.reason === "image_money_evidence_mismatch") {
            assert.equal(request.repair.rejectedOccurrenceIndex, 0);
          }
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2, result.units[0].notices.join(" | "));
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
});

test("unitless image numbers cannot survive as guessed structured KRW values", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-unitless-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_이미지단위없음.png"), Buffer.from("not-a-real-png"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("이미지단위없음");
        data.agency_packages[0].price_min_krw = calls === 1 ? 33_000 : null;
        data.agency_packages[0].price_max_krw = calls === 1 ? 33_000 : null;
        data.agency_packages[0].source_quote = "기본추가 3.3";
        data.agency_packages[0].needs_review = true;
        data.money_occurrences = [];
        if (calls === 2) assert.equal(request.repair?.reason, "structured_numeric_evidence");
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2, result.units[0].notices.join(" | "));
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
});

test("image range endpoints use the full shared-unit expression so zero remains verifiable", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-zero-range-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_이미지영원범위.png"), Buffer.from("not-a-real-png"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("이미지영원범위");
        const sourceId = request.imageSourceRefs[0].sources[0].sourceFileId;
        data.money_occurrences = [0, 1_200_000].map((amount) => ({
          amount_krw: amount,
          raw_text: "국내 0 ~ 최고 120만원",
          source_quote: "국내 0 ~ 최고 120만원",
          source_file_ids: [sourceId],
          kind: "price" as const,
          needs_review: false,
        }));
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 1, result.units[0].notices.join(" | "));
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
});

test("non-XLSX text evidence removes all repeated disjoint records after one repair", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-text-quote-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(
    path.join(regionDir, "(제주)_텍스트근거수리.docx"),
    "더미 기본 패키지 290만원 중간에 별도 안내가 있으며 환불 규정은 계약서를 따릅니다",
  );
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        calls += 1;
        const data = dummyExtraction("텍스트근거수리");
        data.agency_packages[0].source_quote = calls === 1
          ? "더미 기본 패키지 290만원 환불 규정은 계약서를 따릅니다"
          : "더미 기본 패키지 290만원";
        if (calls === 2) {
          data.sections = [{
            section_type: "notice",
            title: "유효 안내",
            content_verbatim: "중간에 별도 안내가 있으며",
            summary: "유효 안내",
            source_quote: "중간에 별도 안내가 있으며",
            source_file_ids: [],
            confidence: 0.95,
            needs_review: false,
          }, {
            section_type: "refund_policy",
            title: "합성 규정 1",
            content_verbatim: "없는 규정 1",
            summary: "합성 규정",
            source_quote: "원문에 없는 합성 규정 1",
            source_file_ids: [],
            confidence: 0.95,
            needs_review: false,
          }, {
            section_type: "refund_policy",
            title: "합성 규정 2",
            content_verbatim: "없는 규정 2",
            summary: "합성 규정",
            source_quote: "원문에 없는 합성 규정 2",
            source_file_ids: [],
            confidence: 0.95,
            needs_review: false,
          }];
        }
        if (calls === 2) {
          assert.equal(request.repair?.reason, "text_quote_contiguity");
          if (request.repair?.reason === "text_quote_contiguity") {
            assert.equal(request.repair.rejectedPath, "agency_packages[0]");
          }
        }
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
  });

  assert.equal(calls, 2, result.units[0].notices.join(" | "));
  assert.equal(result.units[0].stage, "extracted", result.units[0].notices.join(" | "));
  const artifact = JSON.parse(await readFile(result.units[0].extraction!.artifact_path, "utf8"));
  assert.deepEqual(
    artifact.data.sections.map((section: { title: string }) => section.title),
    ["유효 안내"],
  );
  assert.match(artifact.data.extraction_notes, /local_evidence_guard.*2 record/u);
  assert.match(artifact.data.extraction_notes, /sections\[1\]/u);
  assert.match(artifact.data.extraction_notes, /sections\[2\]/u);
});

test("invalid structured output keeps billable usage and request id in the attempt ledger", async (t) => {
  let rawResponseError: unknown;
  try {
    parseOpenAIExtractionResponse({
      output_text: "{\"not\":\"the extraction schema\"}",
      usage: {
        input_tokens: 123,
        output_tokens: 45,
        input_tokens_details: {
          cached_tokens: 20,
          cache_write_tokens: 30,
        },
      },
    }, "req_generated_invalid");
  } catch (error) {
    rawResponseError = error;
  }
  assert.equal(rawResponseError instanceof ExtractionProviderResponseError, true);
  assert.equal((rawResponseError as ExtractionProviderResponseError).inputTokens, 123);
  assert.equal((rawResponseError as ExtractionProviderResponseError).outputTokens, 45);
  assert.equal((rawResponseError as ExtractionProviderResponseError).cachedInputTokens, 20);
  assert.equal((rawResponseError as ExtractionProviderResponseError).cacheWriteInputTokens, 30);
  assert.equal((rawResponseError as ExtractionProviderResponseError).usageReported, true);
  assert.equal((rawResponseError as ExtractionProviderResponseError).requestId, "req_generated_invalid");

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-invalid-usage-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_사용량더미.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      if (calls === 1) {
        throw new ExtractionProviderResponseError(
          "OpenAI 구조화 출력 검증에 실패했습니다: generated invalid",
          {
            inputTokens: 123,
            outputTokens: 45,
            cachedInputTokens: 20,
            cacheWriteInputTokens: 30,
            requestId: "req_generated_invalid",
          },
        );
      }
      return {
        data: dummyExtraction("사용량더미"),
        inputTokens: 10,
        outputTokens: 5,
        providerModel: "gpt-5.6-luna-2026-07-15",
      };
    },
  };

  const result = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(result.units[0].stage, "extracted");
  assert.equal(result.units[0].extraction?.input_tokens, 133);
  assert.equal(result.units[0].extraction?.output_tokens, 50);
  const entries = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(entries[0].success, false);
  assert.match(entries[0].error_detail, /generated invalid/u);
  assert.equal(entries[0].request_id, "req_generated_invalid");
  assert.equal(entries[0].input_tokens, 123);
  assert.equal(entries[0].output_tokens, 45);
  assert.equal(entries[0].cached_input_tokens, 20);
  assert.equal(entries[0].cache_write_input_tokens, 30);
  assert.equal(entries[0].estimated_cost_usd, (73 + (30 * 1.25) + (20 * 0.1) + (45 * 6)) / 1_000_000);
  assert.equal(entries[1].cached_input_tokens, null);
  assert.equal(entries[1].cache_write_input_tokens, null);
  assert.equal(entries[1].provider_model, "gpt-5.6-luna-2026-07-15");
  assert.equal(entries[1].error_detail, null);
  assert.equal(entries[1].estimated_cost_usd, ((10 * 1.25) + (5 * 6)) / 1_000_000);
});

test("Responses usage captures cache reads and writes but fails conservative on missing or malformed details", () => {
  const outputText = JSON.stringify(dummyExtraction("cache-usage"));
  const snakeCase = parseOpenAIExtractionResponse({
    output_text: outputText,
    usage: {
      input_tokens: 1_500,
      output_tokens: 100,
      input_tokens_details: {
        cached_tokens: 300,
        cache_write_tokens: 500,
      },
    },
  });
  assert.equal(snakeCase.cachedInputTokens, 300);
  assert.equal(snakeCase.cacheWriteInputTokens, 500);
  assert.equal(snakeCase.usageReported, true);

  const sdkCamelCase = parseOpenAIExtractionResponse({
    output_text: outputText,
    usage: {
      inputTokens: 1_500,
      outputTokens: 100,
      inputTokensDetails: {
        cachedTokens: 300,
        cacheWriteTokens: 500,
      },
    },
  });
  assert.equal(sdkCamelCase.cachedInputTokens, 300);
  assert.equal(sdkCamelCase.cacheWriteInputTokens, 500);
  assert.equal(sdkCamelCase.usageReported, true);

  const missingDetails = parseOpenAIExtractionResponse({
    output_text: outputText,
    usage: { input_tokens: 1_500, output_tokens: 100 },
  });
  assert.equal(missingDetails.cachedInputTokens, null);
  assert.equal(missingDetails.cacheWriteInputTokens, null);
  assert.equal(missingDetails.usageReported, true);

  const malformedDetails = parseOpenAIExtractionResponse({
    output_text: outputText,
    usage: {
      input_tokens: 1_500,
      output_tokens: 100,
      input_tokens_details: {
        cached_tokens: 1_200,
        cache_write_tokens: 500,
      },
    },
  });
  assert.equal(malformedDetails.cachedInputTokens, null);
  assert.equal(malformedDetails.cacheWriteInputTokens, null);
  assert.equal(malformedDetails.usageReported, true);

  const conflictingTotals = parseOpenAIExtractionResponse({
    output_text: outputText,
    usage: {
      input_tokens: 1_500,
      inputTokens: 1_499,
      output_tokens: 100,
      input_tokens_details: {
        cached_tokens: "300",
        cache_write_tokens: 500,
      },
    },
  });
  assert.equal(conflictingTotals.inputTokens, 0);
  assert.equal(conflictingTotals.outputTokens, 0);
  assert.equal(conflictingTotals.cachedInputTokens, null);
  assert.equal(conflictingTotals.cacheWriteInputTokens, null);
  assert.equal(conflictingTotals.usageReported, false);
});

test("Responses parsing preserves the actual provider model identifier", () => {
  const parsed = parseOpenAIExtractionResponse({
    model: "gpt-5.6-luna",
    output_text: JSON.stringify(dummyExtraction("실제모델")),
    usage: { input_tokens: 10, output_tokens: 5 },
  }, "req-provider-model");

  assert.equal(parsed.providerModel, "gpt-5.6-luna");
  assert.equal(assertOpenAIProviderModel(parsed, "gpt-5.6-luna"), "gpt-5.6-luna");
  assert.throws(
    () => assertOpenAIProviderModel({
      data: dummyExtraction("모델누락"),
      inputTokens: 10,
      outputTokens: 5,
    }, "gpt-5.6-luna"),
    /provider_model_missing/u,
  );

  assert.throws(
    () => parseOpenAIExtractionResponse({
      model: "gpt-5.6-luna-2026-07-15",
      output_text: "{\"not\":\"the extraction schema\"}",
      usage: { input_tokens: 11, output_tokens: 6 },
    }, "req-invalid-with-model"),
    (error: unknown) => error instanceof ExtractionProviderResponseError
      && error.providerModel === "gpt-5.6-luna-2026-07-15",
  );
});

test("Responses parsing rejects a non-exact provider model without trusting its usage", () => {
  for (const providerModel of [
    "gpt-5.6-terra",
    "gpt-5.6-luna-2026-07-15",
    " gpt-5.6-luna ",
  ]) {
    assert.throws(
      () => parseOpenAIExtractionResponse({
        model: providerModel,
        output_text: JSON.stringify(dummyExtraction("모델불일치")),
        usage: { input_tokens: 10, output_tokens: 5 },
      }, "req-provider-model-mismatch", "gpt-5.6-luna"),
      (error: unknown) => error instanceof ExtractionProviderResponseError
        && error.message === "provider_model_mismatch"
        && error.providerModel === providerModel
        && error.requestId === "req-provider-model-mismatch"
        && error.inputTokens === 0
        && error.outputTokens === 0
        && error.usageReported === false,
    );
  }

  const exact = parseOpenAIExtractionResponse({
    model: "gpt-5.6-luna",
    output_text: JSON.stringify(dummyExtraction("정확한모델")),
    usage: { input_tokens: 10, output_tokens: 5 },
  }, "req-provider-model-exact", "gpt-5.6-luna");
  assert.equal(exact.providerModel, "gpt-5.6-luna");
  assert.equal(exact.usageReported, true);
});

test("Responses model identity is checked before malformed output usage can be trusted", () => {
  assert.throws(
    () => parseOpenAIExtractionResponse({
      model: "gpt-5.6-terra",
      output_text: "not-json",
      usage: { input_tokens: 10, output_tokens: 5 },
    }, "req-wrong-model-invalid-output", "gpt-5.6-luna"),
    (error: unknown) => error instanceof ExtractionProviderResponseError
      && error.message === "provider_model_mismatch"
      && error.providerModel === "gpt-5.6-terra"
      && error.inputTokens === 0
      && error.outputTokens === 0
      && error.usageReported === false,
  );
});

test("text and image evidence expose stable source-file labels to the model request", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-labels-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_샘플라벨웨딩");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(path.join(vendorDir, "가격표.docx"));
  await writeDummyDocx(path.join(vendorDir, "옵션표.docx"));
  await writeFile(path.join(vendorDir, "사진.png"), "generated-image-fixture");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];

  await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        const data = dummyExtraction("샘플라벨웨딩");
        if (request.imagePaths.length > 0) {
          data.agency_packages[0].price_min_krw = 33_000;
          data.agency_packages[0].price_max_krw = 33_000;
          data.agency_packages[0].source_quote = "visible image package 3.3만원";
        }
        return { data, inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(captured.length, 3);
  const combinedText = captured.map((request) => request.text).join("\n");
  for (const source of scanned.units[0].source_files.filter((item) => item.ext === "docx")) {
    assert.match(combinedText, new RegExp(source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.equal((combinedText.match(/source_file_id: [a-f0-9]{64}/gu) ?? []).length, 2);
  const imageRequest = captured.find((request) => request.imageSourceRefs.length > 0);
  assert.ok(imageRequest);
  assert.equal(imageRequest.imageSourceRefs.length, 1);
  assert.equal(imageRequest.imageSourceRefs[0].sources[0].sourcePath.endsWith("사진.png"), true);
  assert.match(imageRequest.imageSourceRefs[0].sources[0].sourceFileId, /^[a-f0-9]{64}$/u);
  const manifest = JSON.parse(await readFile(path.join(stateDir, "manifest.json"), "utf8"));
  const artifact = JSON.parse(await readFile(manifest.units[0].extraction.artifact_path, "utf8"));
  const packageModalities = new Map(
    artifact.evidence_modalities
      .filter((entry: { path: string }) => /^agency_packages\[\d+\]$/u.test(entry.path))
      .map((entry: { path: string; modality: string }) => [entry.path, entry.modality]),
  );
  assert.deepEqual([...packageModalities.values()].sort(), ["image", "text"]);
});

test("low-resolution evidence gets deterministic cached zoom tiles without mutating raw", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-tiles-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(vendorDir, { recursive: true });
  const imagePath = path.join(vendorDir, "(제주)_샘플저해상이미지.png");
  await sharp({
    create: { width: 533, height: 951, channels: 3, background: "white" },
  }).png().toFile(imagePath);
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];

  const extracted = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        return { data: dummyExtraction("샘플저해상이미지"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].imagePaths.length, 4);
  assert.equal(captured[0].imagePaths[0], imagePath);
  assert.equal(captured[0].imageSourceRefs[0].viewLabel, "original");
  assert.deepEqual(
    captured[0].imageSourceRefs.slice(1).map((view) => view.viewLabel),
    [
      "enlarged vertical tile 1/3 (same source; overlap may repeat rows)",
      "enlarged vertical tile 2/3 (same source; overlap may repeat rows)",
      "enlarged vertical tile 3/3 (same source; overlap may repeat rows)",
    ],
  );
  for (const tilePath of captured[0].imagePaths.slice(1)) {
    assert.equal(path.resolve(tilePath).startsWith(path.resolve(stateDir)), true);
  }
  assert.equal((await stat(imagePath)).size > 0, true);
});

test("deep image tile destinations render through a bounded same-state scratch path", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-tile-long-path-"));
  const stateRoot = `${rootDir}-state`;
  const finalTileSuffix = path.join(
    ".cache",
    "image-tiles",
    "f".repeat(64),
    "1-of-3.png",
  );
  const targetFinalPathLength = 220;
  const unpaddedFinalPathLength = path.join(stateRoot, finalTileSuffix).length;
  const paddingLength = Math.max(1, targetFinalPathLength - unpaddedFinalPathLength - 1);
  const stateDir = path.join(stateRoot, "s".repeat(paddingLength));
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateRoot, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(vendorDir, { recursive: true });
  const imagePath = path.join(vendorDir, "(제주)_긴경로이미지.png");
  await sharp({
    create: { width: 533, height: 951, channels: 3, background: "white" },
  }).png().toFile(imagePath);
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];

  const extracted = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        return { data: dummyExtraction("긴경로이미지"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(extracted.units[0]?.stage, "extracted");
  assert.equal(captured.length, 1);
  const finalTilePaths = captured[0].imagePaths.slice(1);
  assert.equal(finalTilePaths.length, 3);
  const obsoleteDeepTemporaryPath = `${finalTilePaths[0]}.${process.pid}.${"x".repeat(36)}.tmp.png`;
  const boundedScratchPath = imageTileScratchTemporaryPathUpperBound(stateDir);
  assert.ok(obsoleteDeepTemporaryPath.length > 260, obsoleteDeepTemporaryPath);
  assert.ok(boundedScratchPath.length < obsoleteDeepTemporaryPath.length, boundedScratchPath);
  assert.ok(boundedScratchPath.length < 240, boundedScratchPath);
  for (const tilePath of finalTilePaths) {
    assert.equal((await stat(tilePath)).isFile(), true);
    assert.equal((await sharp(tilePath).metadata()).width, 1_600);
  }
  const scratchRoot = path.dirname(path.dirname(boundedScratchPath));
  assert.deepEqual(await readdir(scratchRoot), []);
});

test("a preseeded image tile with arbitrary bytes is rejected before provider use", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-tile-preseed-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(vendorDir, { recursive: true });
  const imagePath = path.join(vendorDir, "(제주)_타일선점.png");
  await sharp({
    create: { width: 533, height: 951, channels: 3, background: "white" },
  }).png().toFile(imagePath);
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const sourceDigest = (await sha256File(imagePath)).sha256;
  const tileRoot = path.join(
    stateDir,
    ".cache",
    "image-tiles",
    sha256Text(`${sourceDigest}\0v1-three-vertical-overlap-width1600-sharpen`),
  );
  await mkdir(tileRoot, { recursive: true });
  await writeFile(path.join(tileRoot, "1-of-3.png"), "attacker-controlled-tile");
  let providerCalls = 0;

  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async () => {
        providerCalls += 1;
        return { data: dummyExtraction("타일선점"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.units[0]?.stage, "error");
  assert.match(result.units[0]?.notices.join("\n") ?? "", /image_tile_cache_content_mismatch/u);
});

test("each low-resolution source keeps its original and overlap tiles in one image-only request", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-image-source-groups-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_두장이미지");
  await mkdir(vendorDir, { recursive: true });
  for (const name of ["가격1.png", "가격2.png"]) {
    await sharp({
      create: { width: 533, height: 951, channels: 3, background: "white" },
    }).png().toFile(path.join(vendorDir, name));
  }
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];

  const extracted = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        return { data: dummyExtraction("두장이미지"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(
    extracted.units[0]?.stage,
    "extracted",
    JSON.stringify(extracted.units.map((unit) => ({ stage: unit.stage, notices: unit.notices }))),
  );
  assert.equal(captured.length, 2);
  for (const request of captured) {
    assert.equal(request.text, "");
    assert.equal(request.imagePaths.length, 4);
    assert.equal(new Set(request.imageSourceRefs.map((view) => view.sources[0].sourcePath)).size, 1);
  }
});

test("extract rejects a raw source replaced by a same-content symlink outside the raw root", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-realpath-"));
  const outsideDir = `${rootDir}-outside`;
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_링크더미");
  const outsideVendorDir = path.join(outsideDir, "outside-vendor");
  await mkdir(vendorDir, { recursive: true });
  await mkdir(outsideVendorDir, { recursive: true });
  const sourcePath = path.join(vendorDir, "가격표.docx");
  const outsidePath = path.join(outsideVendorDir, "가격표.docx");
  await writeDummyDocx(sourcePath);
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  await writeFile(outsidePath, await readFile(sourcePath));
  await rm(vendorDir, { recursive: true, force: true });
  try {
    await symlink(
      outsideVendorDir,
      vendorDir,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) {
      t.skip(`symlink unavailable: ${String(error.code)}`);
      return;
    }
    throw error;
  }
  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async () => {
        calls += 1;
        return { data: dummyExtraction("링크더미"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /provenance|realpath|raw root|경로/iu);
});

test("OpenAI image requests enforce independent raw-byte and base64 payload totals", () => {
  assert.doesNotThrow(() => validateImageRequestPayloadLimits(
    30 * 1024 * 1024,
    40 * 1024 * 1024,
  ));
  assert.throws(
    () => validateImageRequestPayloadLimits(40 * 1024 * 1024 + 1, 1),
    /image_request_raw_bytes_limit/u,
  );
  assert.throws(
    () => validateImageRequestPayloadLimits(40 * 1024 * 1024, 50 * 1024 * 1024 + 1),
    /image_request_base64_payload_limit/u,
  );
});

test("extract lock permits one process and diagnoses a dead local owner without charging", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-lock-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));

  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireExtractionLock(stateDir)),
  );
  const acquired = attempts.filter(
    (attempt): attempt is PromiseFulfilledResult<() => Promise<void>> => attempt.status === "fulfilled",
  );
  const blocked = attempts.filter(
    (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
  );
  assert.equal(acquired.length, 1);
  assert.equal(blocked.length, 7);
  for (const attempt of blocked) assert.match(String(attempt.reason), /extract_lock_active/u);
  await acquired[0].value();

  const lockDirectory = path.join(stateDir, ".cache", "locks");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(path.join(lockDirectory, "extract.lock"), JSON.stringify({
    schema_version: 1,
    lock_id: "00000000-0000-4000-8000-000000000001",
    pid: 2_147_483_647,
    hostname: os.hostname(),
    started_at: "2000-01-01T00:00:00.000Z",
    state_dir: path.resolve(stateDir),
  }));

  await assert.rejects(
    acquireExtractionLock(stateDir),
    /extract_lock_stale_local_pid/u,
  );
});

test("paid usage above the provider-bound reservation halts for manual reconciliation", () => {
  const reservation = providerBoundReservation("gpt-5.6-luna");
  assert.throws(
    () => assertPaidProviderUsageWithinReservation(
      "gpt-5.6-luna",
      {
        data: dummyExtraction("over-reservation"),
        inputTokens: 1_400_000,
        outputTokens: 16_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        usageReported: true,
      },
      reservation,
    ),
    /usage_exceeded_plan_reservation_manual_reconciliation/u,
  );
});

test("billing-quota 429 errors are permanent and never enter the retry loop", () => {
  const error = new Error("account quota unavailable");
  Object.assign(error, {
    status: 429,
    error: { type: "insufficient_quota", code: "billing_hard_limit_reached" },
  });
  assert.equal(isPermanentProviderBillingFailure(error), true);
  assert.equal(isRetryableExtractionProviderError(error), false);

  const transient = new Error("rate limited");
  Object.assign(transient, { status: 429, code: "rate_limit_exceeded" });
  assert.equal(isPermanentProviderBillingFailure(transient), false);
  assert.equal(isRetryableExtractionProviderError(transient), true);
});

test("retry delay honors bounded Retry-After seconds and HTTP dates", () => {
  const secondsError = Object.assign(new Error("generated rate limit"), {
    status: 429,
    headers: new Headers({ "Retry-After": "2" }),
  });
  const dateError = Object.assign(new Error("generated unavailable"), {
    status: 503,
    headers: { "retry-after": new Date(5_000).toUTCString() },
  });
  const excessiveError = Object.assign(new Error("generated rate limit"), {
    status: 429,
    headers: { "Retry-After": "9999" },
  });

  assert.equal(computeRetryDelayMilliseconds(secondsError, 0, 0), 2_000);
  assert.equal(computeRetryDelayMilliseconds(dateError, 1, 0), 5_000);
  assert.equal(computeRetryDelayMilliseconds(excessiveError, 2, 0), 60_000);
  assert.equal(computeRetryDelayMilliseconds(new Error("generated"), 1, 0), 500);
});

test("extract retries only a bounded number of times for 429 responses", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-retry-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_재시도더미.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let attempts = 0;
  const delays: number[] = [];
  const provider: ExtractionProvider = {
    extract: async () => {
      attempts += 1;
      if (attempts < 4) {
        const error = new Error("generated rate limit");
        Object.defineProperty(error, "status", { value: 429 });
        throw error;
      }
      return { data: dummyExtraction("재시도더미"), inputTokens: 20, outputTokens: 10 };
    },
  };

  const result = await extractManifest(
    { stateDir },
    { provider, env: {}, sleep: async (milliseconds) => { delays.push(milliseconds); } },
  );

  assert.equal(result.units[0].stage, "extracted");
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500, 1_000]);
  assert.equal(result.units[0].extraction?.attempts, 4);
  const ledgerLines = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledgerLines.length, 4);
  assert.deepEqual(
    ledgerLines.map((entry) => entry.error_category),
    ["rate_limit", "rate_limit", "rate_limit", null],
  );
  assert.equal(ledgerLines[3].success, true);
  assert.equal(ledgerLines[3].input_tokens, 20);
  assert.ok(ledgerLines[3].estimated_cost_usd > 0);
  assert.doesNotMatch(JSON.stringify(ledgerLines), /더미 원문|generated rate limit|OPENAI_API_KEY/u);
});

test("uncached paid-call cost fence blocks before the provider is called", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cost-fence-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cost-fence.docx"));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  let calls = 0;

  await assert.rejects(
    extractManifest({ stateDir }, {
      env: { INGEST_MAX_UNCACHED_COST_USD: "0" },
      provider: {
        extract: async () => {
          calls += 1;
          return { data: dummyExtraction("cost fence"), inputTokens: 1, outputTokens: 1 };
        },
      },
    }),
    /uncached_paid_call_cost_fence/u,
  );
  assert.equal(calls, 0);
});

test("uncached paid-call cost fence is cumulative across retry attempts", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-cost-fence-retry-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "cost-fence-retry.docx"));
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const plan = await planExtraction({ stateDir, unitIds: [scanned.units[0].unit_id] }, {});
  const oneAttemptReserve = 0.1;
  let calls = 0;

  await assert.rejects(
    extractManifest({ stateDir }, {
      env: { INGEST_MAX_UNCACHED_COST_USD: String(oneAttemptReserve * 1.5) },
      sleep: async () => undefined,
      provider: {
        extract: async () => {
          calls += 1;
          const error = new Error("generated rate limit");
          Object.defineProperty(error, "status", { value: 429 });
          throw error;
        },
      },
    }),
    /uncached_paid_call_cost_fence/u,
  );
  assert.equal(calls, 1);
});

test("invalid structured output receives exactly one repair retry while a second invalid response fails", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "repair.docx"), "repair fixture 더미 기본 패키지 290만원");
  await writeDummyDocx(path.join(regionDir, "fail.docx"), "fail fixture 더미 기본 패키지 290만원");
  await writeDummyDocx(path.join(regionDir, "other-4xx.docx"), "other 4xx fixture 더미 기본 패키지 290만원");
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const repairId = scanned.units.find((unit) => unit.display_name === "repair.docx")?.unit_id;
  const other4xxId = scanned.units.find((unit) => unit.display_name === "other-4xx.docx")?.unit_id;
  assert.ok(repairId);
  assert.ok(other4xxId);
  const canonicalNameByUnitId = new Map(
    scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]),
  );
  const attempts = new Map<string, number>();
  const delays: number[] = [];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const count = (attempts.get(request.unitId) ?? 0) + 1;
      attempts.set(request.unitId, count);
      if (request.unitId === other4xxId) {
        const error = new Error("generated bad request");
        Object.defineProperty(error, "status", { value: 400 });
        throw error;
      }
      if (request.unitId === repairId && count === 2) {
        return {
          data: dummyExtraction(canonicalNameByUnitId.get(request.unitId) ?? ""),
          inputTokens: 10,
          outputTokens: 5,
        };
      }
      throw new Error("구조화 출력 검증 실패");
    },
  };

  const result = await extractManifest(
    { stateDir },
    { provider, env: {}, sleep: async (milliseconds) => { delays.push(milliseconds); } },
  );

  assert.equal(attempts.get(repairId), 2);
  const failedUnit = result.units.find((unit) => unit.unit_id !== repairId && unit.unit_id !== other4xxId);
  assert.equal(attempts.get(failedUnit?.unit_id ?? ""), 2);
  assert.equal(attempts.get(other4xxId), 1);
  const repairedUnit = result.units.find((unit) => unit.unit_id === repairId);
  assert.equal(repairedUnit?.stage, "extracted", JSON.stringify(repairedUnit?.notices));
  assert.equal(failedUnit?.stage, "error");
  assert.equal(result.units.find((unit) => unit.unit_id === other4xxId)?.stage, "error");
  assert.deepEqual(delays, []);
  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledger.length, 5);
  assert.equal(ledger.filter((entry) => entry.error_category === "invalid_response").length, 3);
});

test("each extract invocation receives a new audit run id so retrying the CLI never hides a later success", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-run-id-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "generated.docx"));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });

  const failedProvider: ExtractionProvider = { extract: async () => { throw new Error("generated failure"); } };
  const failed = await extractManifest({ stateDir }, { provider: failedProvider, env: {} });
  assert.equal(failed.units[0].stage, "error");
  const successfulProvider: ExtractionProvider = {
    extract: async () => ({ data: dummyExtraction("generated"), inputTokens: 10, outputTokens: 5 }),
  };
  const successful = await extractManifest({ stateDir }, { provider: successfulProvider, env: {} });
  assert.equal(successful.units[0].stage, "extracted");

  const entries = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].run_id, entries[1].run_id);
  assert.notEqual(entries[0].ledger_id, entries[1].ledger_id);
  assert.deepEqual(entries.map((entry) => entry.success), [false, true]);
});

test("chunk merge never chooses one of conflicting non-null numeric values silently", () => {
  const first = dummyExtraction("충돌더미");
  first.hall.venue_fee_krw = 1_000_000;
  first.hall.venue_fee_source_quote = "대관료 100만원";
  const second = structuredClone(first);
  second.doc_kind = "hall_disclosure";
  second.agency_packages[0].price_min_krw = 3_100_000;
  second.agency_packages[0].price_max_krw = 3_100_000;
  second.agency_packages[0].source_quote = "더미 기본 패키지 310만원";
  second.hall.venue_fee_krw = 1_200_000;
  second.hall.venue_fee_source_quote = "대관료 120만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.doc_kind, "mixed");
  assert.equal(merged.hall.venue_fee_krw, null);
  assert.equal(merged.hall.venue_fee_source_quote, null);
  assert.equal(merged.hall.needs_review, true);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.match(merged.extraction_notes, /자동 선택하지 않고 needs_review/u);
});

test("chunk merge preserves a later sanitizer guard marker ahead of a truncated long note", () => {
  const first = dummyExtraction("guard marker merge");
  first.extraction_notes = "x".repeat(3_999);
  const second = structuredClone(first);
  const guardMarker = "[local_evidence_guard] removed unsupported later chunk record";
  second.extraction_notes = guardMarker;
  const third = structuredClone(second);

  const merged = mergeExtractionChunks([first, second, third]);

  assert.equal(merged.extraction_notes.startsWith(guardMarker), true);
  assert.equal(merged.extraction_notes.match(/\[local_evidence_guard\]/gu)?.length, 1);
  assert.equal(merged.extraction_notes.length, 4_000);
});

test("chunk merge fails closed when canonical business or region identity conflicts", () => {
  const first = dummyExtraction("샘플제주웨딩");
  first.partner_vendors = [{
    vendor_name: "샘플제주스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "샘플제주스튜디오 100만원",
    confidence: 0.95,
    needs_review: false,
  }];
  first.hall.items = [{
    name: "대관료",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    raw_text: "대관료 100만원",
    source_quote: "대관료 100만원",
    confidence: 0.95,
    needs_review: false,
  }];

  const second = structuredClone(first);
  second.business_name = "샘플부산웨딩";
  second.region_hint = "부산";
  second.agency_packages[0].package_name = "샘플 부산 기본 패키지";
  second.partner_vendors[0].vendor_name = "샘플부산스튜디오";
  second.hall.items[0].name = "식대";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.business_name, null);
  assert.equal(merged.region_hint, null);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.hall.items.every((item) => item.needs_review), true);
  assert.equal(merged.hall.needs_review, true);
  assert.match(merged.extraction_notes, /business_name/u);
  assert.match(merged.extraction_notes, /region_hint/u);
});

test("chunk merge flags every agency package variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌플래너");
  const second = structuredClone(first);
  second.agency_packages[0].options = [{
    name: "앨범 추가",
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    unit: "1권",
    condition: null,
    raw_text: "앨범 1권 추가 10만원",
    source_quote: "앨범 1권 추가 10만원",
  }];
  second.agency_packages[0].source_quote = "기본 패키지 290만원, 앨범 추가 가능";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.agency_packages.length, 2);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.equal(merged.agency_packages.every((item) => item.confidence <= 0.5), true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge coalesces an agency base row with options from another source", () => {
  const first = dummyExtraction("agency merge");
  first.agency_packages[0].source_file_ids = ["a".repeat(64)];
  const second = structuredClone(first);
  second.agency_packages[0].price_min_krw = null;
  second.agency_packages[0].price_max_krw = null;
  second.agency_packages[0].source_quote = "원본 추가 10만원";
  second.agency_packages[0].source_file_ids = ["b".repeat(64)];
  second.agency_packages[0].options = [{
    name: "원본 추가",
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    unit: "1건",
    condition: null,
    raw_text: "원본 추가 10만원",
    source_quote: "원본 추가 10만원",
    source_file_ids: ["b".repeat(64)],
  }];

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.agency_packages.length, 1);
  assert.equal(merged.agency_packages[0].price_min_krw, first.agency_packages[0].price_min_krw);
  assert.deepEqual(merged.agency_packages[0].source_file_ids, ["a".repeat(64)]);
  assert.equal(merged.agency_packages[0].options.length, 1);
  assert.deepEqual(merged.agency_packages[0].options[0].source_file_ids, ["b".repeat(64)]);
  assert.equal(merged.agency_packages[0].needs_review, false);
});

test("chunk merge flags every partner vendor variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌플래너");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "샘플동일스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "샘플동일스튜디오 20p 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].base_spec = "30p 앨범";
  second.partner_vendors[0].source_quote = "샘플동일스튜디오 30p 120만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 2);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.confidence <= 0.5), true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge treats partner spacing variants as one identity and fails closed on conflicting prices", () => {
  const first = dummyExtraction("파트너 정규화 테스트");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "한 방 스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "한 방 스튜디오 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].vendor_name = "한방스튜디오";
  second.partner_vendors[0].price_min_krw = 1_300_000;
  second.partner_vendors[0].price_max_krw = 1_300_000;
  second.partner_vendors[0].source_quote = "한방스튜디오 130만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 2);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
});

test("chunk merge fails closed when one normalized partner option has conflicting amounts", () => {
  const first = dummyExtraction("파트너 옵션 충돌 테스트");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "한 방 스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: null,
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "가격표!C4: 원본 추가 10만원",
      source_file_ids: [],
    }],
    source_quote: "한 방 스튜디오 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].vendor_name = "한방스튜디오";
  second.partner_vendors[0].options[0].name = "원본추가";
  second.partner_vendors[0].options[0].price_min_krw = 150_000;
  second.partner_vendors[0].options[0].price_max_krw = 150_000;
  second.partner_vendors[0].options[0].raw_text = "원본추가 15만원";
  second.partner_vendors[0].options[0].source_quote = "가격표!D4: 원본추가 15만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 2);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
});

test("chunk merge coalesces complementary fields for one normalized partner option", () => {
  const first = dummyExtraction("파트너 옵션 병합 테스트");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "한 방 스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: null,
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "가격표!C4: 원본 추가 10만원",
      source_file_ids: ["a".repeat(64)],
    }],
    source_quote: "한 방 스튜디오 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].vendor_name = "한방스튜디오";
  second.partner_vendors[0].options = [{
    name: "원본추가",
    price_min_krw: null,
    price_max_krw: null,
    unit: "1회",
    condition: "계약 당일 신청",
    raw_text: "원본추가 · 1회 · 계약 당일 신청",
    source_quote: "가격표!D4: 원본추가 · 1회 · 계약 당일 신청",
    source_file_ids: ["b".repeat(64)],
  }];

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 1);
  assert.equal(merged.partner_vendors[0].options.length, 1);
  assert.equal(merged.partner_vendors[0].options[0].price_min_krw, 100_000);
  assert.equal(merged.partner_vendors[0].options[0].unit, "1회");
  assert.equal(merged.partner_vendors[0].options[0].condition, "계약 당일 신청");
  assert.deepEqual(merged.partner_vendors[0].options[0].source_file_ids, ["a".repeat(64), "b".repeat(64)]);
  assert.match(
    merged.partner_vendors[0].options[0].source_quote,
    /^__HANBANG_MERGED_EVIDENCE_V1__/u,
  );
  assert.equal(merged.partner_vendors[0].needs_review, false);
});

test("chunk merge combines complementary rows for the same partner without inventing a conflict", () => {
  const first = dummyExtraction("병합플래너");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "병합스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "가격표!A3:C3: 병합스튜디오 기본 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].price_min_krw = null;
  second.partner_vendors[0].price_max_krw = null;
  second.partner_vendors[0].base_spec = null;
  second.partner_vendors[0].source_quote = "가격표!C4: 야간촬영 20만원";
  second.partner_vendors[0].options = [{
    name: "야간촬영",
    price_min_krw: 200_000,
    price_max_krw: 200_000,
    unit: null,
    condition: null,
    raw_text: "야간촬영 20만원",
    source_quote: "가격표!C4: 야간촬영 20만원",
    source_file_ids: [],
  }];

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 1);
  assert.equal(merged.partner_vendors[0].price_min_krw, 1_200_000);
  assert.equal(merged.partner_vendors[0].options.length, 1);
  assert.equal(merged.partner_vendors[0].needs_review, false);
});

test("chunk merge flags every hall item variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌홀");
  first.doc_kind = "hall_disclosure";
  first.agency_packages = [];
  first.hall.items = [{
    name: "대관료",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    raw_text: "대관료(기본) 100만원",
    source_quote: "대관료(기본) 100만원",
    confidence: 0.95,
    needs_review: false,
  }];
  first.hall.needs_review = false;
  first.hall.confidence = 0.95;
  const second = structuredClone(first);
  second.hall.items[0].raw_text = "대관료(주말) 100만원";
  second.hall.items[0].source_quote = "대관료(주말) 100만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.hall.items.length, 2);
  assert.equal(merged.hall.items.every((item) => item.needs_review), true);
  assert.equal(merged.hall.items.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge coalesces complementary normalized hall rows across chunks", () => {
  const first = dummyExtraction("홀 병합 테스트");
  first.doc_kind = "hall_disclosure";
  first.agency_packages = [];
  first.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: 200,
    meal_price_min_krw: 75_000,
    meal_price_max_krw: 90_000,
    venue_fee_min_krw: null,
    venue_fee_max_krw: null,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [{
      name: "빔 프로젝터",
      price_min_krw: 200_000,
      price_max_krw: 200_000,
      unit: null,
      condition: null,
      raw_text: "빔 프로젝터 20만원",
      source_quote: "그랜드 홀 빔 프로젝터 20만원",
      source_file_ids: ["a".repeat(64)],
    }],
    source_quote: "그랜드 홀 보증인원 200명, 식대 7.5만~9만원",
    source_file_ids: ["a".repeat(64)],
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.halls = [{
    hall_name: "그랜드홀",
    guarantee_min: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_min_krw: 3_000_000,
    venue_fee_max_krw: 3_000_000,
    venue_fee_note: "토요일 기준",
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [{
      name: "빔프로젝터",
      price_min_krw: null,
      price_max_krw: null,
      unit: "1회",
      condition: "사전 예약",
      raw_text: "빔프로젝터 1회, 사전 예약",
      source_quote: "그랜드홀 빔프로젝터 1회, 사전 예약",
      source_file_ids: ["b".repeat(64)],
    }],
    source_quote: "그랜드홀 토요일 대관료 300만원",
    source_file_ids: ["b".repeat(64)],
    confidence: 0.9,
    needs_review: false,
  }];

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.halls?.length, 1);
  assert.equal(merged.halls?.[0].hall_name, "그랜드 홀");
  assert.equal(merged.halls?.[0].guarantee_min, 200);
  assert.equal(merged.halls?.[0].meal_price_min_krw, 75_000);
  assert.equal(merged.halls?.[0].venue_fee_min_krw, 3_000_000);
  assert.equal(merged.halls?.[0].venue_fee_note, "토요일 기준");
  assert.equal(merged.halls?.[0].options.length, 1);
  assert.equal(merged.halls?.[0].options[0].price_min_krw, 200_000);
  assert.equal(merged.halls?.[0].options[0].condition, "사전 예약");
  assert.deepEqual(merged.halls?.[0].source_file_ids, ["a".repeat(64), "b".repeat(64)]);
  assert.match(merged.halls?.[0].source_quote ?? "", /^__HANBANG_MERGED_EVIDENCE_V1__/u);
  assert.equal(merged.halls?.[0].needs_review, false);
});

test("chunk merge fails closed when normalized hall rows contain conflicting amounts", () => {
  const first = dummyExtraction("홀 금액 충돌 테스트");
  first.doc_kind = "hall_disclosure";
  first.agency_packages = [];
  first.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: 200,
    meal_price_min_krw: 75_000,
    meal_price_max_krw: 90_000,
    venue_fee_min_krw: 3_000_000,
    venue_fee_max_krw: 3_000_000,
    venue_fee_note: "토요일 기준",
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: "그랜드 홀 대관료 300만원",
    source_file_ids: ["a".repeat(64)],
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.halls![0].hall_name = "그랜드홀";
  second.halls![0].venue_fee_min_krw = 3_500_000;
  second.halls![0].venue_fee_max_krw = 3_500_000;
  second.halls![0].source_quote = "그랜드홀 대관료 350만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.halls?.length, 2);
  assert.equal(merged.halls?.every((item) => item.needs_review), true);
  assert.equal(merged.halls?.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
});

test("chunk merge fails closed when normalized hall rows contain conflicting notes", () => {
  const first = dummyExtraction("홀 문구 충돌 테스트");
  first.doc_kind = "hall_disclosure";
  first.agency_packages = [];
  first.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_min_krw: 3_000_000,
    venue_fee_max_krw: 3_000_000,
    venue_fee_note: "토요일 기준",
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: "그랜드 홀 대관료 300만원, 토요일 기준",
    source_file_ids: ["a".repeat(64)],
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.halls![0].hall_name = "그랜드홀";
  second.halls![0].venue_fee_note = "일요일 기준";
  second.halls![0].source_quote = "그랜드홀 대관료 300만원, 일요일 기준";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.halls?.length, 2);
  assert.equal(merged.halls?.every((item) => item.needs_review), true);
  assert.equal(merged.halls?.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
});

test("chunk merge keeps venue and meal evidence attached to their own values", () => {
  const venueChunk = dummyExtraction("근거분리홀");
  venueChunk.doc_kind = "hall_disclosure";
  venueChunk.agency_packages = [];
  venueChunk.hall.venue_fee_krw = 3_000_000;
  venueChunk.hall.venue_fee_source_quote = "대관료 300만원";

  const mealChunk = dummyExtraction("근거분리홀");
  mealChunk.doc_kind = "hall_disclosure";
  mealChunk.agency_packages = [];
  mealChunk.hall.meal_price_min_krw = 75_000;
  mealChunk.hall.meal_price_max_krw = 90_000;
  mealChunk.hall.meal_price_source_quote = "식대 1인 7.5만~9만원";

  const merged = mergeExtractionChunks([venueChunk, mealChunk]);

  assert.equal(merged.hall.venue_fee_source_quote, "대관료 300만원");
  assert.equal(merged.hall.meal_price_source_quote, "식대 1인 7.5만~9만원");
});

test("structured output schema caps source text lengths", () => {
  const oversized = dummyExtraction("길이더미");
  oversized.agency_packages[0].source_quote = "가".repeat(1_001);
  assert.equal(DisclosureExtractionSchema.safeParse(oversized).success, false);
});
