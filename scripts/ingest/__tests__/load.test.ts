import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { convertManifest } from "../convert.js";
import {
  createStorageIntentJournal,
  createStorageObjectJournal,
  writeStagingRunDescriptor,
  writeStorageIntentJournal,
  writeStorageObjectJournal,
} from "../batch-safety-journal.js";
import { extractManifestForTests as extractManifest, type ExtractionProvider } from "../extract.js";
import { readJsonFile, writeJsonFile } from "../io.js";
import {
  buildDisclosureSemanticContentFingerprint,
  buildDisclosureSemanticSourceRecordKey,
  stagingProvenanceForSourceIds,
  stagingDisclosureSemantics,
  stagingOption,
  buildOfficialPriceContentFingerprint,
  buildOfficialPriceSourceRecordKey,
  buildStagingBatches,
  abortStagingRun,
  applyConfirmedLocalPendingOnlyPlan,
  createLocalPendingOnlyApplyPreparation,
  assertCompleteApplyUniverse,
  assertFourTabPartnerVendorCompatibility,
  createLocalPendingOnlyAuthorization,
  createStagingRunDescriptor,
  finalizeConfirmedLocalPendingOnlyPlan,
  hallPriceRows,
  loadValidated,
  stagingLoadPlanSha256,
  stagingEnvironment,
  StagingRollbackIncompleteError,
  StagingStorageIntentsUnsettledError,
  validateLocalPendingOnlyAuthorization,
  type StagingLoadPlan,
  type StagingBatchWriteContext,
  type StagingStorageIntent,
  type StagingUnit,
  type StagingWriter,
} from "../load.js";
import { canonicalSha256 } from "../gate-integrity.js";
import { scanSources } from "../scan.js";
import { sourceFileId } from "../provenance.js";
import type { DisclosureExtraction } from "../schemas.js";
import { validateManifest } from "../validate.js";
import {
  activeVendorNameMatches,
  abortAtomicDisclosureRun,
  completeAtomicDisclosureStorageRollback,
  assertPendingOnlyBatch,
  assertDisclosureSemanticPlanRows,
  assertDisclosureSemanticLinkPlan,
  canonicalVendorPair,
  collectBoundedPages,
  createSupabaseStagingWriter,
  deterministicVendorSlug,
  finalizeAtomicDisclosureDedupe,
  invalidateAtomicDisclosureRun,
  persistDisclosureSemantic,
  reconcileExistingOfficialPrice,
  resolveDisclosureSemanticPersistenceRows,
  sanitizeVendorAliasProposals,
  stageAtomicDisclosureBatch,
  stageVendorAliasProposals,
  withSqlStateRetry,
  uploadPreviewObjects,
  uploadRawObjects,
  vendorDatabaseCategory,
} from "../supabase-writer.js";

const STAGING_RUN_STARTED_AT = "2026-07-20T06:00:00.000Z";
const STORAGE_TEST_RUN_SHA256 = "c".repeat(64);
const STORAGE_TEST_CLAIM_TOKEN = "11111111-1111-4111-8111-111111111111";
const STORAGE_TEST_CLAIMANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function storageOwnershipForTest() {
  return {
    runSha256: STORAGE_TEST_RUN_SHA256,
    firstObjectIndex: 0,
    claimObject: async (object: StagingStorageIntent) => ({
      fresh: true,
      claim: {
        ...object,
        claim_token: STORAGE_TEST_CLAIM_TOKEN,
        claim_epoch: 1,
        claimant_id: STORAGE_TEST_CLAIMANT_ID,
        claim_action: "upload" as const,
        claim_expires_at: "2026-07-20T06:10:00.000Z",
      },
    }),
    recordClaim: async () => "test-storage-claim-journal",
    startUpload: async () => ({
      uploadAttempt: 1,
      shouldUpload: true,
      journalPath: "test-storage-upload-start-journal",
    }),
    recordObject: async () => "test-storage-journal",
  };
}

function localAuthorizationFor(
  plan: StagingLoadPlan,
  localUnitIds: string[],
  targetProjectRef = "staging-ref",
) {
  return createLocalPendingOnlyAuthorization({
    createdAt: STAGING_RUN_STARTED_AT,
    targetProjectRef,
    manifestSha256: createHash("sha256").update("test-manifest").digest("hex"),
    fullPlanSha256: stagingLoadPlanSha256(plan),
    snapshot: plan.snapshot,
    orderedBatchSha256s: buildStagingBatches(plan).map((batch) => batch.batch_sha256),
    localUnitIds,
    sourceFingerprints: localUnitIds.map((unitId) => createHash("sha256").update(`source:${unitId}`).digest("hex")),
    conversionFingerprints: localUnitIds.map((unitId) => createHash("sha256").update(`conversion:${unitId}`).digest("hex")),
    extractionFingerprints: localUnitIds.map((unitId) => createHash("sha256").update(`extraction:${unitId}`).digest("hex")),
    extractionContentSha256s: localUnitIds.map((unitId) => createHash("sha256").update(`extraction-content:${unitId}`).digest("hex")),
    validationFingerprints: localUnitIds.map((unitId) =>
      createHash("sha256").update(`validation:${unitId}`).digest("hex")
    ),
  });
}

function localBatchAuthorizationFor(authorization: ReturnType<typeof localAuthorizationFor>) {
  return {
    authorizationKind: "local_validated_pending_only" as const,
    authorizationSha256: authorization.authorization_sha256,
  };
}

function pendingOnlyApplyFixture(unitCount = 1) {
  const stagedUnitIds = Array.from({ length: unitCount }, (_, index) =>
    createHash("sha256").update(`confirmed-apply-unit:${index}`).digest("hex")
  );
  const artifactIdentity = (kind: string, unitId: string) =>
    createHash("sha256").update(`${kind}:${unitId}`).digest("hex");
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: stagedUnitIds.map((unitId) => ({
      unit_id: unitId,
      source_fingerprint: artifactIdentity("source", unitId),
      validation_fingerprint: artifactIdentity("validation", unitId),
    })),
    skipped_units: Array.from({ length: 8 }, (_, index) => ({
      unit_id: artifactIdentity("manual-hwp", String(index)),
      display_name: `manual-${index}.hwp`,
      stage: "needs_manual_conversion",
      reason: "manual_conversion_required",
    })),
    raw_objects: [],
    preview_objects: [],
    agency_packages: stagedUnitIds.map((unitId) => ({
      unit_id: unitId,
      review_status: "pending",
      needs_review: true,
      validation_issue_codes: ["local_deterministic_review_only"],
    })),
    official_prices: [],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: stagedUnitIds.map((unitId) => `local_deterministic_review_only:${unitId}`),
  } as unknown as StagingLoadPlan;
  const manifest = {
    schema_version: 1,
    scanner_parser_version: "fixture",
    root_dir: "C:\\fixture\\raw",
    state_dir: "C:\\fixture\\state",
    scanned_at: STAGING_RUN_STARTED_AT,
    units: [
      ...stagedUnitIds.map((unitId) => ({
        unit_id: unitId,
        stage: "validated",
        source_fingerprint: artifactIdentity("source", unitId),
        source_files: [{ ext: "pdf" }],
        conversion: {
          artifact_fingerprint: artifactIdentity("conversion", unitId),
        },
        local_extraction: {
          fingerprint: artifactIdentity("extraction", unitId),
          content_sha256: artifactIdentity("extraction-content", unitId),
        },
        validation: {
          provider_mode: "local_deterministic",
          fingerprint: artifactIdentity("validation", unitId),
          extraction_content_sha256: artifactIdentity("extraction-content", unitId),
        },
      })),
      ...plan.skipped_units.map((unit) => ({
        unit_id: unit.unit_id,
        stage: "needs_manual_conversion",
        source_fingerprint: artifactIdentity("source", unit.unit_id),
        source_files: [{ ext: "hwp" }],
      })),
    ],
  } as unknown as Parameters<typeof assertCompleteApplyUniverse>[1];
  const environment = {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  };
  const preparation = createLocalPendingOnlyApplyPreparation({
    plan,
    manifest,
    targetProjectRef: environment.projectRef,
    startedAt: STAGING_RUN_STARTED_AT,
  });
  return { plan, manifest, environment, preparation, stagedUnitIds };
}

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

test("the staging writer binds the URL host and private buckets to its declared project", () => {
  assert.throws(
    () => createSupabaseStagingWriter({
      url: "https://slrtobkksjmxgzatjyqb.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "fake-staging",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }),
    /host|project ref/iu,
  );
  assert.throws(
    () => createSupabaseStagingWriter({
      url: "https://fake-staging.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "fake-staging",
      bucket: "wrong-bucket",
      previewBucket: "disclosure-preview",
    }),
    /bucket/iu,
  );
});

test("the production writer has no legacy non-atomic staging path", async () => {
  const writer = createSupabaseStagingWriter({
    url: "https://fake-staging.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "fake-staging",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  });
  await assert.rejects(
    writer.stage({} as StagingLoadPlan),
    /atomic.*context|required.*context/iu,
  );
});

test("staging batches are capped at 25 and retain only batch-owned evidence and AI ledger rows", () => {
  const unitIds = Array.from({ length: 26 }, (_, index) =>
    createHash("sha256").update(`batch-unit:${index}`).digest("hex")
  );
  const objectKeys = unitIds.map((unitId) => `${unitId}.pdf`);
  const previewKeys = unitIds.map((unitId) => `${unitId}.txt`);
  const fullPlan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: unitIds.map((unitId, index) => ({
      unit_id: unitId,
      source_object_keys: [objectKeys[index]],
      source_preview_keys: [previewKeys[index]],
    })),
    skipped_units: [],
    raw_objects: unitIds.map((unitId, index) => ({
      source_path: `agency/seoul/${index}.pdf`,
      absolute_path: `C:\\machine-a\\raw\\${index}.pdf`,
      sha256: unitId,
      ext: "pdf",
      bytes: index + 1,
      storage_path: objectKeys[index],
    })),
    preview_objects: unitIds.map((unitId, index) => ({
      source_label: `${index}.pdf`,
      source_object_key: objectKeys[index],
      absolute_path: `C:\\machine-a\\preview\\${index}.txt`,
      sha256: unitId,
      bytes: index + 1,
      storage_path: previewKeys[index],
    })),
    agency_packages: unitIds.map((unitId) => ({ unit_id: unitId })),
    official_prices: unitIds.map((unitId) => ({ unit_id: unitId })),
    disclosure_semantics: unitIds.map((unitId) => ({ unit_id: unitId })),
    dedupe_candidates: [{
      entity_kind: "vendor",
      left_unit_id: unitIds[0],
      right_unit_id: unitIds[25],
      similarity: 0.95,
      reason: "cross batch",
      status: "pending",
    }],
    ai_ledger: unitIds.map((unitId) => ({
      unit_id: unitId,
      ledger_id: createHash("sha256").update(`ledger:${unitId}`).digest("hex"),
    })),
    warnings: unitIds.map((unitId) => `local_deterministic_review_only:${unitId}`),
  } as unknown as StagingLoadPlan;

  const batches = buildStagingBatches(fullPlan);

  assert.deepEqual(batches.map((batch) => batch.plan.units.length), [25, 1]);
  assert.deepEqual(batches.map((batch) => batch.plan.ai_ledger.length), [25, 1]);
  assert.deepEqual(batches.map((batch) => batch.plan.raw_objects.length), [25, 1]);
  assert.deepEqual(batches.map((batch) => batch.plan.preview_objects.length), [25, 1]);
  assert.ok(batches.every((batch) => batch.plan.dedupe_candidates.length === 0));
  assert.deepEqual(
    batches[1]?.plan.ai_ledger.map((entry) => entry.unit_id),
    [unitIds[25]],
  );
  assert.equal(new Set(batches.map((batch) => batch.batch_sha256)).size, 2);
  assert.ok(batches.every((batch, index) => batch.batch_index === index + 1));
  assert.ok(batches.every((batch) => batch.batch_count === 2));

  const authorization = createLocalPendingOnlyAuthorization({
    createdAt: STAGING_RUN_STARTED_AT,
    targetProjectRef: "staging-ref",
    manifestSha256: createHash("sha256").update("manifest").digest("hex"),
    fullPlanSha256: stagingLoadPlanSha256(fullPlan),
    snapshot: fullPlan.snapshot,
    orderedBatchSha256s: batches.map((batch) => batch.batch_sha256),
    localUnitIds: unitIds,
    sourceFingerprints: unitIds.map((unitId) => createHash("sha256").update(`source:${unitId}`).digest("hex")),
    conversionFingerprints: unitIds.map((unitId) => createHash("sha256").update(`conversion:${unitId}`).digest("hex")),
    extractionFingerprints: unitIds.map((unitId) => createHash("sha256").update(`extraction:${unitId}`).digest("hex")),
    extractionContentSha256s: unitIds.map((unitId) => createHash("sha256").update(`extraction-content:${unitId}`).digest("hex")),
    validationFingerprints: unitIds.map((unitId) => createHash("sha256").update(`validation:${unitId}`).digest("hex")),
  });
  assert.deepEqual(validateLocalPendingOnlyAuthorization(authorization), authorization);
  const descriptor = createStagingRunDescriptor(
    fullPlan,
    "staging-ref",
    STAGING_RUN_STARTED_AT,
    localBatchAuthorizationFor(authorization),
    authorization,
  );
  const movedPlan = structuredClone(fullPlan);
  movedPlan.raw_objects.forEach((raw, index) => {
    raw.absolute_path = `D:\\machine-b\\raw\\${index}.pdf`;
  });
  movedPlan.preview_objects.forEach((preview, index) => {
    preview.absolute_path = `D:\\machine-b\\preview\\${index}.txt`;
  });
  assert.equal(
    createStagingRunDescriptor(
      movedPlan,
      "staging-ref",
      STAGING_RUN_STARTED_AT,
      localBatchAuthorizationFor(authorization),
      authorization,
    ).run_sha256,
    descriptor.run_sha256,
  );
  assert.notEqual(
    (() => {
      const changedAuthorization = {
      ...authorization,
      payload: { ...authorization.payload, target_project_ref: "other-staging-ref" },
      authorization_sha256: canonicalSha256({ ...authorization.payload, target_project_ref: "other-staging-ref" }),
      };
      return createStagingRunDescriptor(
        fullPlan,
        "other-staging-ref",
        STAGING_RUN_STARTED_AT,
        localBatchAuthorizationFor(changedAuthorization),
        changedAuthorization,
      ).run_sha256;
    })(),
    descriptor.run_sha256,
  );
  assert.deepEqual(descriptor.batch_sha256s, batches.map((batch) => batch.batch_sha256));
});

test("apply universe is the entire manifest except exactly eight manual HWP units", () => {
  const stagedUnitId = createHash("sha256").update("staged-unit").digest("hex");
  const hwpUnitIds = Array.from({ length: 8 }, (_, index) =>
    createHash("sha256").update(`manual-hwp:${index}`).digest("hex")
  );
  const manifest = {
    units: [{
      unit_id: stagedUnitId,
      stage: "validated",
      conversion: { artifact_fingerprint: createHash("sha256").update("conversion").digest("hex") },
      validation: { fingerprint: createHash("sha256").update("validation").digest("hex") },
      source_files: [{ ext: "pdf" }],
    }, ...hwpUnitIds.map((unitId) => ({
      unit_id: unitId,
      stage: "needs_manual_conversion",
      conversion: null,
      validation: null,
      source_files: [{ ext: "hwp" }],
    }))],
  } as unknown as Parameters<typeof assertCompleteApplyUniverse>[1];
  const plan = {
    units: [{ unit_id: stagedUnitId }],
    skipped_units: hwpUnitIds.map((unitId) => ({
      unit_id: unitId,
      display_name: unitId,
      stage: "needs_manual_conversion",
      reason: "manual_conversion_required",
    })),
  } as unknown as StagingLoadPlan;

  assert.doesNotThrow(() => assertCompleteApplyUniverse(plan, manifest));
  assert.throws(
    () => assertCompleteApplyUniverse({
      ...plan,
      units: [],
      skipped_units: [...plan.skipped_units, {
        unit_id: stagedUnitId,
        display_name: stagedUnitId,
        stage: "validated",
        reason: "blocking_validation_issue",
      }],
    }, manifest),
    /full-plan universe|validated.*skipped/iu,
  );
});

test("SQLSTATE is preserved and only lock_not_available is retried with bounded backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const response = await withSqlStateRetry("fixture", async () => {
    attempts += 1;
    return attempts < 3
      ? { data: null, error: { code: "55P03", message: "lock not available" } }
      : { data: { ok: true }, error: null };
  }, {
    maxAttempts: 3,
    baseDelayMs: 5,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });
  assert.deepEqual(response.data, { ok: true });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);

  let nonRetryAttempts = 0;
  await assert.rejects(
    withSqlStateRetry("fixture", async () => {
      nonRetryAttempts += 1;
      return { data: null, error: { code: "40001", message: "serialization" } };
    }, { sleep: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "40001");
      return true;
    },
  );
  assert.equal(nonRetryAttempts, 1);
});

test("row provenance canonicalizes reversed source ids together with their immutable object keys", () => {
  const sourceA = {
    source_file_id: "a".repeat(64),
    source_file: "agency/seoul/a.xlsx",
    source_object_key: `${"1".repeat(64)}.xlsx`,
    source_preview_key: `${"3".repeat(64)}.txt`,
  };
  const sourceB = {
    source_file_id: "b".repeat(64),
    source_file: "agency/seoul/b.pdf",
    source_object_key: `${"2".repeat(64)}.pdf`,
    source_preview_key: `${"4".repeat(64)}.txt`,
  };
  const unit = {
    raw_name: "sample",
    source_records: [sourceA, sourceB],
  } as unknown as StagingLoadPlan["units"][number];

  assert.deepEqual(
    stagingProvenanceForSourceIds(unit, [sourceB.source_file_id, sourceA.source_file_id]),
    {
      source_file_ids: [sourceA.source_file_id, sourceB.source_file_id],
      source_file: JSON.stringify([sourceA.source_file, sourceB.source_file]),
      source_object_keys: [sourceA.source_object_key, sourceB.source_object_key],
      source_preview_keys: [sourceA.source_preview_key, sourceB.source_preview_key],
    },
  );
  assert.deepEqual(
    stagingOption(unit, {
      name: "album",
      price_min_krw: 10_000,
      price_max_krw: 10_000,
      unit: null,
      condition: null,
      raw_text: "album 10000",
      source_quote: "A1: album 10000",
      source_file_ids: [sourceB.source_file_id, sourceA.source_file_id],
    }),
    {
      name: "album",
      price_min_krw: 10_000,
      price_max_krw: 10_000,
      unit: null,
      condition: null,
      raw_text: "album 10000",
      source_quote: "A1: album 10000",
      source_file_ids: [sourceA.source_file_id, sourceB.source_file_id],
      source_file: JSON.stringify([sourceA.source_file, sourceB.source_file]),
      source_object_keys: [sourceA.source_object_key, sourceB.source_object_key],
    },
  );
});

test("semantic provenance canonicalizes reversed source ids without detaching partner identity", () => {
  const sourceA = {
    source_file_id: "a".repeat(64),
    source_file: "agency/seoul/a.xlsx",
    source_object_key: `${"1".repeat(64)}.xlsx`,
    source_preview_key: `${"3".repeat(64)}.txt`,
  };
  const sourceB = {
    source_file_id: "b".repeat(64),
    source_file: "agency/seoul/b.pdf",
    source_object_key: `${"2".repeat(64)}.pdf`,
    source_preview_key: `${"4".repeat(64)}.txt`,
  };
  const unit = {
    unit_id: "c".repeat(64),
    kind_hint: "agency",
    region_code: "seoul_gangnam3",
    raw_name: "Sample Agency",
    normalized_name: "sampleagency",
    corporate_name: null,
    source_fingerprint: "d".repeat(64),
    validation_fingerprint: "e".repeat(64),
    validation_issue_codes: [],
    source_records: [sourceA, sourceB],
    data: {
      partner_vendors: [{
        vendor_name: "(주) Sample Vendor",
        old_names: [],
        category: "dress",
        price_min_krw: null,
        price_max_krw: null,
        base_spec: null,
        price_note: null,
        options: [],
        policies: [{
          policy_type: "penalty",
          raw_text: "cancellation policy",
          source_quote: "A1: cancellation policy",
          source_file_ids: [sourceB.source_file_id, sourceA.source_file_id],
        }],
        source_quote: "A1: cancellation policy",
        source_file_ids: [sourceA.source_file_id],
        confidence: 0.9,
        needs_review: false,
      }],
      sections: [],
    },
  } as unknown as StagingLoadPlan["units"][number];

  const [row] = stagingDisclosureSemantics(unit);
  assert.deepEqual(row.source_file_ids, [sourceA.source_file_id, sourceB.source_file_id]);
  assert.deepEqual(row.source_object_keys, [sourceA.source_object_key, sourceB.source_object_key]);
  assert.equal(row.subject_normalized_name, "samplevendor");
  assert.equal(row.partner_link_status, "price_row_staged");
  assert.match(row.partner_record_ref ?? "", /^[a-f0-9]{64}$/u);
});

test("semantic source keys use immutable locators rather than content or array occurrence", () => {
  const identity = {
    schema_version: 2 as const,
    source_fingerprint: "a".repeat(64),
    record_kind: "vendor_policy" as const,
    semantic_type: "penalty" as const,
    subject_kind: "vendor" as const,
    subject_normalized_name: "samplevendor",
    partner_record_ref: "b".repeat(64),
    title: null,
    source_file_ids: ["c".repeat(64), "d".repeat(64)],
    source_quote: "Sheet1!A1: cancellation fee applies",
    content_verbatim: "cancellation fee applies",
  };

  assert.equal(
    buildDisclosureSemanticSourceRecordKey(identity),
    buildDisclosureSemanticSourceRecordKey({ ...identity }),
  );
  assert.equal(
    buildDisclosureSemanticSourceRecordKey(identity),
    buildDisclosureSemanticSourceRecordKey({
      ...identity,
      content_verbatim: "a different source-backed policy",
    }),
  );
});

function semanticPlanFixture(options: { stageablePrice?: boolean } = {}): {
  plan: StagingLoadPlan;
  row: StagingLoadPlan["disclosure_semantics"][number];
} {
  const sourceId = "a".repeat(64);
  const sourceFile = "agency/seoul/policy.xlsx";
  const sourceObjectKey = `${"b".repeat(64)}.xlsx`;
  const unit = {
    unit_id: "c".repeat(64),
    kind_hint: "agency",
    region_code: "seoul_gangnam3",
    normalized_name: "sampleagency",
    raw_name: "Sample Agency",
    corporate_name: null,
    source_file: sourceFile,
    source_object_keys: [sourceObjectKey],
    source_preview_keys: [`${"d".repeat(64)}.txt`],
    source_records: [{
      source_file_id: sourceId,
      source_file: sourceFile,
      source_object_key: sourceObjectKey,
      source_preview_key: `${"d".repeat(64)}.txt`,
    }],
    source_fingerprint: "e".repeat(64),
    conversion_fingerprint: "c".repeat(64),
    extraction_fingerprint: "b".repeat(64),
    validation_fingerprint: "f".repeat(64),
    validation_issue_codes: [],
    data: {
      doc_kind: "partner_price_list",
      business_name: "Sample Agency",
      region_hint: "서울",
      agency_packages: [],
      partner_vendors: [{
        vendor_name: "Sample Vendor",
        old_names: [],
        category: "dress",
        price_min_krw: options.stageablePrice ? 1_000_000 : null,
        price_max_krw: options.stageablePrice ? 1_000_000 : null,
        base_spec: null,
        price_note: null,
        options: [],
        policies: [{
          policy_type: "penalty",
          raw_text: "contract cancellation fee applies",
          source_quote: "Sheet1!A1: contract cancellation fee applies",
          source_file_ids: [sourceId],
        }],
        source_quote: "Sheet1!A1: contract cancellation fee applies",
        source_file_ids: [sourceId],
        confidence: 0.9,
        needs_review: false,
      }],
      halls: [],
      sections: [],
      money_occurrences: [],
      hall: {
        venue_fee_krw: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_source_quote: null,
        meal_price_source_quote: null,
        venue_fee_source_file_ids: [],
        meal_price_source_file_ids: [],
        items: [],
        confidence: 0,
        needs_review: false,
      },
      extraction_notes: "generated writer semantic preflight fixture",
    },
  } satisfies StagingUnit;
  const [row] = stagingDisclosureSemantics(unit);
  return {
    row,
    plan: {
      schema_version: 2,
      snapshot: "2026Q3",
      snapshot_source: "kca_tprice",
      units: [unit],
      skipped_units: [],
      raw_objects: [],
      preview_objects: [],
      agency_packages: [],
      official_prices: [],
      disclosure_semantics: [row],
      dedupe_candidates: [],
      ai_ledger: [],
      warnings: [],
    },
  };
}

test("writer semantic preflight rejects rehashed invented rows and omissions", () => {
  const { plan, row } = semanticPlanFixture();
  assert.doesNotThrow(() => assertDisclosureSemanticPlanRows(plan));

  const inventedWithoutFingerprint = {
    ...row,
    source_quote: "Sheet1!Z99: invented policy",
    content_verbatim: "invented policy",
    source_record_key: buildDisclosureSemanticSourceRecordKey({
      ...row,
      source_quote: "Sheet1!Z99: invented policy",
      content_verbatim: "invented policy",
    }),
  };
  const invented = {
    ...inventedWithoutFingerprint,
    content_fingerprint: buildDisclosureSemanticContentFingerprint(inventedWithoutFingerprint),
  };
  assert.throws(
    () => assertDisclosureSemanticPlanRows({ ...plan, disclosure_semantics: [invented] }),
    /exact.*unit|reconstructed|additional|missing|modified/iu,
  );
  assert.throws(
    () => assertDisclosureSemanticPlanRows({ ...plan, disclosure_semantics: [] }),
    /exact.*unit|reconstructed|additional|missing|modified/iu,
  );
});

test("writer semantic preflight rejects same-locator content drift after a valid rehash", () => {
  const { plan, row } = semanticPlanFixture();
  const changedWithoutFingerprint = {
    ...row,
    content_verbatim: "mutated content at the same locator",
  };
  const changed = {
    ...changedWithoutFingerprint,
    content_fingerprint: buildDisclosureSemanticContentFingerprint(changedWithoutFingerprint),
  };
  assert.equal(changed.source_record_key, row.source_record_key);
  assert.notEqual(changed.content_fingerprint, row.content_fingerprint);
  assert.throws(
    () => assertDisclosureSemanticPlanRows({ ...plan, disclosure_semantics: [changed] }),
    /exact.*unit|reconstructed|additional|missing|modified/iu,
  );
});

test("semantic link preflight requires one exact staged price row before external writes", () => {
  const { plan, row } = semanticPlanFixture({ stageablePrice: true });
  assert.equal(row.partner_link_status, "price_row_staged");
  assert.throws(
    () => assertDisclosureSemanticLinkPlan(plan),
    /price_row_staged.*exact.*official price|persisted IDs.*preflight/iu,
  );
  const matchingPrice = {
    ...stagingOfficialPriceFixture(),
    unit_id: row.unit_id,
    partner_record_ref: row.partner_record_ref ?? undefined,
    vendor_name: row.subject_name,
    category: row.vendor_category ?? "other",
    region_code: row.region_code,
  };
  const linkedPlan = { ...plan, official_prices: [matchingPrice] };
  assert.doesNotThrow(() => assertDisclosureSemanticLinkPlan(linkedPlan));
  assert.throws(
    () => assertDisclosureSemanticLinkPlan({
      ...linkedPlan,
      official_prices: [matchingPrice, { ...matchingPrice }],
    }),
    /exactly one|duplicate/iu,
  );
});

test("durable semantic link resolution fails closed and distinguishes price from policy-only vendors", () => {
  const vendorId = "11111111-1111-4111-8111-111111111111";
  const officialPriceId = "22222222-2222-4222-8222-222222222222";
  const price = semanticPlanFixture({ stageablePrice: true }).row;
  const generatedIdentity = semanticPlanFixture().row;
  const policyOnlyWithoutFingerprint = {
    ...generatedIdentity,
    partner_link_status: "policy_only_pending_identity" as const,
  };
  const policyOnly = {
    ...policyOnlyWithoutFingerprint,
    content_fingerprint: buildDisclosureSemanticContentFingerprint(policyOnlyWithoutFingerprint),
  };
  const priceRef = price.partner_record_ref ?? "";
  const policyRef = policyOnly.partner_record_ref ?? "";

  assert.throws(
    () => resolveDisclosureSemanticPersistenceRows([price], new Map(), new Map()),
    /persisted vendor.*official price|price_row_staged.*resolve/iu,
  );
  assert.deepEqual(
    resolveDisclosureSemanticPersistenceRows(
      [price],
      new Map([[priceRef, { partnerVendorId: vendorId, officialPriceId }]]),
      new Map(),
    )[0],
    { row: price, partnerVendorId: vendorId, officialPriceId },
  );
  assert.deepEqual(
    resolveDisclosureSemanticPersistenceRows(
      [policyOnly],
      new Map(),
      new Map([[policyRef, vendorId]]),
    )[0],
    { row: policyOnly, partnerVendorId: vendorId, officialPriceId: null },
  );
});

test("partial canonical halls retain distinct source-backed legacy price facts", () => {
  const sourceId = "a".repeat(64);
  const sourceObjectKey = `${"b".repeat(64)}.xlsx`;
  const sourceQuote = "Sheet1!A1: 그랜드홀 대관료 300만원, 주차 5만원";
  const unit = {
    unit_id: "c".repeat(64),
    raw_name: "그랜드웨딩",
    region_code: "seoul_gangnam3",
    source_fingerprint: "d".repeat(64),
    validation_issue_codes: [],
    source_records: [{
      source_file_id: sourceId,
      source_file: "hall/seoul/grand.xlsx",
      source_object_key: sourceObjectKey,
      source_preview_key: `${"e".repeat(64)}.txt`,
    }],
    data: {
      halls: [{
        hall_name: "그랜드홀",
        guarantee_min: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_min_krw: 3_000_000,
        venue_fee_max_krw: 3_000_000,
        venue_fee_note: null,
        decoration_fee_min_krw: null,
        decoration_fee_max_krw: null,
        decoration_note: null,
        options: [],
        source_quote: sourceQuote,
        source_file_ids: [sourceId],
        confidence: 0.95,
        needs_review: false,
      }],
      hall: {
        venue_fee_krw: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_source_quote: null,
        meal_price_source_quote: null,
        venue_fee_source_file_ids: [],
        meal_price_source_file_ids: [],
        items: [{
          name: "주차",
          price_min_krw: 50_000,
          price_max_krw: 50_000,
          raw_text: "주차 5만원",
          source_quote: sourceQuote,
          source_file_ids: [sourceId],
          confidence: 0.9,
          needs_review: false,
        }],
        confidence: 0.9,
        needs_review: false,
      },
    },
  } as unknown as StagingLoadPlan["units"][number];

  assert.deepEqual(
    hallPriceRows(unit).map((row) => [row.item_name, row.price_min_krw]),
    [["그랜드홀 대관료", 3_000_000], ["주차", 50_000]],
  );
  unit.data.hall.venue_fee_krw = 4_000_000;
  unit.data.hall.venue_fee_source_quote = sourceQuote;
  unit.data.hall.venue_fee_source_file_ids = [sourceId];
  assert.throws(
    () => hallPriceRows(unit),
    /canonical and legacy hall payloads disagree/iu,
  );
});

test("source-backed canonical halls without a safe price stage as review-only identities", () => {
  const sourceId = "a".repeat(64);
  const sourceObjectKey = `${"b".repeat(64)}.xlsx`;
  const sourceQuote = "Sheet1!A5: 하모니스홀 | 가격은 별도 문의";
  const unit = {
    unit_id: "c".repeat(64),
    raw_name: "샘플웨딩홀",
    region_code: "seoul_gangnam3",
    source_fingerprint: "d".repeat(64),
    validation_issue_codes: [],
    source_records: [{
      source_file_id: sourceId,
      source_file: "hall/seoul/sample.xlsx",
      source_object_key: sourceObjectKey,
      source_preview_key: `${"e".repeat(64)}.txt`,
    }],
    data: {
      halls: [{
        hall_name: "하모니스홀",
        guarantee_min: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_min_krw: null,
        venue_fee_max_krw: null,
        venue_fee_note: null,
        decoration_fee_min_krw: null,
        decoration_fee_max_krw: null,
        decoration_note: null,
        options: [],
        source_quote: sourceQuote,
        source_file_ids: [sourceId],
        confidence: 0.99,
        needs_review: false,
      }],
      hall: {
        venue_fee_krw: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_source_quote: null,
        meal_price_source_quote: null,
        venue_fee_source_file_ids: [],
        meal_price_source_file_ids: [],
        items: [],
        confidence: 0,
        needs_review: false,
      },
    },
  } as unknown as StagingLoadPlan["units"][number];

  const rows = hallPriceRows(unit);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    unit_id: unit.unit_id,
    vendor_name: unit.raw_name,
    alias_proposals: [],
    source_agency: null,
    category: "hall",
    region_code: unit.region_code,
    item_name: "하모니스홀 기본 정보",
    base_spec: null,
    price_min_krw: null,
    price_max_krw: null,
    vat_note: null,
    price_note: null,
    options: [],
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: ["identity_only_no_price"],
    source_file: "hall/seoul/sample.xlsx",
    source_object_keys: [sourceObjectKey],
    source_preview_keys: [`${"e".repeat(64)}.txt`],
    source_quote: sourceQuote,
    confidence: 0.99,
    source_record_key: rows[0].source_record_key,
  });
  assert.match(rows[0].source_record_key, /^[a-f0-9]{64}$/u);
  assert.equal(
    rows[0].needs_review === false && rows[0].validation_issue_codes.length === 0,
    false,
    "an identity-only hall must fail closed for bulk approval",
  );
});

test("writer accepts only exactly marked review-only identity rows when no structured price exists", () => {
  const identityRow = {
    ...stagingOfficialPriceFixture(),
    unit_id: "0".repeat(64),
    price_min_krw: null,
    price_max_krw: null,
    options: [],
    review_status: "pending" as const,
    needs_review: true,
    validation_issue_codes: ["identity_only_no_price"],
  };
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{
      unit_id: identityRow.unit_id,
      source_fingerprint: "1".repeat(64),
      conversion_fingerprint: "2".repeat(64),
      extraction_fingerprint: "3".repeat(64),
      validation_fingerprint: "4".repeat(64),
    }],
    skipped_units: [],
    raw_objects: [],
    preview_objects: [],
    agency_packages: [],
    official_prices: [identityRow],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: [],
  } as unknown as StagingLoadPlan;

  assert.doesNotThrow(() => assertPendingOnlyBatch(plan));
  assert.throws(
    () => assertPendingOnlyBatch({
      ...plan,
      official_prices: [{
        ...identityRow,
        validation_issue_codes: [],
      }],
    }),
    /unpriced.*identity.*identity_only_no_price/iu,
  );
  assert.throws(
    () => assertPendingOnlyBatch({
      ...plan,
      official_prices: [{
        ...identityRow,
        needs_review: false,
      }],
    }),
    /unpriced.*identity.*review-only/iu,
  );
  assert.throws(
    () => assertPendingOnlyBatch({
      ...plan,
      official_prices: [{
        ...identityRow,
        price_min_krw: 1,
        price_max_krw: 1,
      }],
    }),
    /identity_only_no_price.*structured price/iu,
  );
  assert.throws(
    () => assertPendingOnlyBatch({
      ...plan,
      official_prices: [{
        ...identityRow,
        category: "other",
      }],
    }),
    /four consumer explorer categories/iu,
  );
});

test("load apply requires explicit immutable confirmations before planning, env checks, or writer access", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-blocked-apply-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  let writerCalls = 0;
  const writer: StagingWriter = {
    stage: async () => {
      writerCalls += 1;
      throw new Error("writer must remain unreachable while apply is blocked");
    },
  };
  const blocked = (error: unknown): boolean => error instanceof Error
    && /startedAt|full plan|authorization|run SHA-256/iu.test(error.message);

  await assert.rejects(
    loadValidated(
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
    ),
    blocked,
  );
  await assert.rejects(
    loadValidated({ stateDir, snapshot: "2026Q3", apply: true }),
    blocked,
  );
  assert.equal(writerCalls, 0);
});

test("confirmed pending-only apply rejects a wrong project or immutable hash before writer access", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-confirmed-load-fence-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const fixture = pendingOnlyApplyFixture();
  let writerCalls = 0;
  const writer: StagingWriter = {
    stage: async () => {
      writerCalls += 1;
      throw new Error("writer must remain unreachable for a stale confirmation");
    },
  };
  const confirmation = {
    expectedFullPlanSha256: fixture.preparation.full_plan_sha256,
    expectedAuthorizationSha256: fixture.preparation.authorization.authorization_sha256,
    expectedRunSha256: fixture.preparation.descriptor.run_sha256,
  };

  assert.throws(
    () => createLocalPendingOnlyApplyPreparation({
      plan: fixture.plan,
      manifest: fixture.manifest,
      targetProjectRef: "slrtobkksjmxgzatjyqb",
      startedAt: STAGING_RUN_STARTED_AT,
    }),
    /production/iu,
  );

  await assert.rejects(
    applyConfirmedLocalPendingOnlyPlan({
      stateDir,
      startedAt: STAGING_RUN_STARTED_AT,
      environment: { ...fixture.environment, projectRef: "other-staging-ref", url: "https://other-staging-ref.supabase.co" },
      manifest: fixture.manifest,
      plan: fixture.plan,
      writer,
      confirmation,
    }),
    /authorization|run SHA-256|target/iu,
  );
  for (const staleConfirmation of [
    { ...confirmation, expectedFullPlanSha256: "0".repeat(64) },
    { ...confirmation, expectedAuthorizationSha256: "1".repeat(64) },
    { ...confirmation, expectedRunSha256: "2".repeat(64) },
  ]) {
    await assert.rejects(
      applyConfirmedLocalPendingOnlyPlan({
        stateDir,
        startedAt: STAGING_RUN_STARTED_AT,
        environment: fixture.environment,
        manifest: fixture.manifest,
        plan: fixture.plan,
        writer,
        confirmation: staleConfirmation,
      }),
      /confirmed.*SHA-256|confirmation/iu,
    );
  }
  assert.equal(writerCalls, 0);
});

test("pending-only apply resumes immutable batches, stays active for QA, and finalizes only explicitly", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-confirmed-load-resume-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const fixture = pendingOnlyApplyFixture(26);
  const receipts = new Map<string, string>();
  let stageCalls = 0;
  let verifyCalls = 0;
  let finalizeCalls = 0;
  const writer: StagingWriter = {
    stage: async (plan, context) => {
      assert.ok(context);
      stageCalls += 1;
      const receipt = canonicalSha256({
        run_sha256: context.run_sha256,
        batch_sha256: context.batch_sha256,
      });
      receipts.set(context.batch_sha256, receipt);
      return {
        loadedUnitIds: [...context.unit_ids],
        skippedUnitIds: [],
        loggedLedgerIds: plan.ai_ledger.map((entry) => entry.ledger_id),
        atomicBatchReceiptSha256: receipt,
      };
    },
    verifyBatchReceipt: async (context, expectedReceiptSha256) => {
      verifyCalls += 1;
      assert.equal(receipts.get(context.batch_sha256), expectedReceiptSha256);
      const batch = buildStagingBatches(fixture.plan)[context.batch_index - 1]!;
      return {
        loadedUnitIds: [...context.unit_ids],
        skippedUnitIds: [],
        loggedLedgerIds: batch.plan.ai_ledger.map((entry) => entry.ledger_id),
        atomicBatchReceiptSha256: expectedReceiptSha256,
      };
    },
    finalizeDedupe: async (_plan, context) => {
      finalizeCalls += 1;
      assert.equal(context.run_sha256, fixture.preparation.descriptor.run_sha256);
      assert.deepEqual(
        context.completed_batch_sha256s,
        buildStagingBatches(fixture.plan).map((batch) => batch.batch_sha256),
      );
    },
  };
  const confirmation = {
    expectedFullPlanSha256: fixture.preparation.full_plan_sha256,
    expectedAuthorizationSha256: fixture.preparation.authorization.authorization_sha256,
    expectedRunSha256: fixture.preparation.descriptor.run_sha256,
  };

  const first = await applyConfirmedLocalPendingOnlyPlan({
    stateDir,
    startedAt: STAGING_RUN_STARTED_AT,
    environment: fixture.environment,
    manifest: fixture.manifest,
    plan: fixture.plan,
    writer,
    confirmation,
  });
  assert.equal(first.batchRun.results.length, 2);
  assert.equal(stageCalls, 2);
  assert.equal(finalizeCalls, 0, "a completed load must remain abortable until explicit finalize");

  const resumed = await applyConfirmedLocalPendingOnlyPlan({
    stateDir,
    startedAt: STAGING_RUN_STARTED_AT,
    environment: fixture.environment,
    manifest: fixture.manifest,
    plan: fixture.plan,
    writer,
    confirmation,
  });
  assert.equal(resumed.batchRun.results.length, 2);
  assert.equal(stageCalls, 2, "resume must not replay completed remote writes");
  assert.equal(verifyCalls, 2, "resume must remotely verify both persisted receipts");
  assert.equal(finalizeCalls, 0);

  const finalized = await finalizeConfirmedLocalPendingOnlyPlan({
    stateDir,
    startedAt: STAGING_RUN_STARTED_AT,
    environment: fixture.environment,
    manifest: fixture.manifest,
    plan: fixture.plan,
    writer,
    confirmation,
  });
  assert.equal(finalized.descriptor.run_sha256, fixture.preparation.descriptor.run_sha256);
  assert.equal(finalizeCalls, 1);
  assert.equal(verifyCalls, 4, "finalize must re-verify every completed remote receipt");

  await assert.rejects(
    applyConfirmedLocalPendingOnlyPlan({
      stateDir,
      startedAt: STAGING_RUN_STARTED_AT,
      environment: fixture.environment,
      manifest: fixture.manifest,
      plan: fixture.plan,
      writer,
      confirmation,
    }),
    /finaliz(?:e|ation).*already requested|already.*finaliz/iu,
  );
  assert.equal(stageCalls, 2, "a finalized run must not be presented as a new active load");
});

test("explicit finalize fails locally when the batch journal is incomplete", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-incomplete-finalize-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const fixture = pendingOnlyApplyFixture();
  let finalizeCalls = 0;
  const writer: StagingWriter = {
    stage: async () => assert.fail("finalize must never stage a missing batch"),
    verifyBatchReceipt: async () => assert.fail("there is no persisted receipt to verify"),
    finalizeDedupe: async () => { finalizeCalls += 1; },
  };

  await assert.rejects(
    finalizeConfirmedLocalPendingOnlyPlan({
      stateDir,
      startedAt: STAGING_RUN_STARTED_AT,
      environment: fixture.environment,
      manifest: fixture.manifest,
      plan: fixture.plan,
      writer,
      confirmation: {
        expectedFullPlanSha256: fixture.preparation.full_plan_sha256,
        expectedAuthorizationSha256: fixture.preparation.authorization.authorization_sha256,
        expectedRunSha256: fixture.preparation.descriptor.run_sha256,
      },
    }),
    /descriptor|incomplete|batch journal/iu,
  );
  assert.equal(finalizeCalls, 0);
});

test("staging environment validation retains URL, production, and service-key fences", () => {
  const validStagingEnv = {
    INGEST_LOAD_ENABLED: "true",
    INGEST_TARGET_ENV: "staging",
    INGEST_STAGING_PROJECT_REF: "staging-ref",
    INGEST_STORAGE_BUCKET: "disclosure-raw",
    SUPABASE_PROJECT_REF: "staging-ref",
    SUPABASE_PRODUCTION_PROJECT_REF: "slrtobkksjmxgzatjyqb",
    SUPABASE_URL: "https://staging-ref.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_generated_fixture",
  };

  assert.deepEqual(stagingEnvironment(validStagingEnv, "staging-ref"), {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  });
  for (const [unsafeUrl, expectedError] of [
    ["http://staging-ref.supabase.co", /https/iu],
    ["https://staging-ref.supabase.co:8443", /port|포트/iu],
    ["https://user:password@staging-ref.supabase.co", /credentials/iu],
    ["https://staging-ref.supabase.co/rest/v1", /base URL|path/iu],
    ["https://staging-ref.supabase.co?redirect=other", /base URL|query/iu],
    ["https://staging-ref.supabase.co#other", /base URL|hash|fragment/iu],
  ] as const) {
    assert.throws(
      () => stagingEnvironment({ ...validStagingEnv, SUPABASE_URL: unsafeUrl }, "staging-ref"),
      expectedError,
    );
  }
  for (const unsafeKey of ["sb_publishable_fixture", "anon_fixture", "not-a-service-role-key"]) {
    assert.throws(
      () => stagingEnvironment({
        ...validStagingEnv,
        SUPABASE_SERVICE_ROLE_KEY: unsafeKey,
      }, "staging-ref"),
      /anon|publishable|service_role|sb_secret/iu,
    );
  }
  assert.throws(
    () => stagingEnvironment({
      ...validStagingEnv,
      INGEST_STAGING_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      SUPABASE_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      SUPABASE_URL: "https://slrtobkksjmxgzatjyqb.supabase.co",
    }, "slrtobkksjmxgzatjyqb"),
    /production/iu,
  );
  assert.throws(
    () => stagingEnvironment({
      ...validStagingEnv,
      INGEST_STAGING_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      SUPABASE_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      SUPABASE_PRODUCTION_PROJECT_REF: "misspelled-production-ref",
      SUPABASE_URL: "https://slrtobkksjmxgzatjyqb.supabase.co",
    }, "slrtobkksjmxgzatjyqb"),
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

function stagingDisclosureSemanticFixture(): StagingLoadPlan["disclosure_semantics"][number] {
  const semantic = {
    schema_version: 2,
    unit_id: "1".repeat(64),
    record_kind: "document_section",
    semantic_type: "pricing_basis",
    subject_kind: "agency",
    subject_name: "샘플웨딩",
    subject_normalized_name: "샘플웨딩",
    partner_record_ref: null,
    source_agency: null,
    partner_link_status: "not_applicable",
    vendor_category: null,
    region_code: "seoul_gangnam3",
    title: "가격 기준",
    content_verbatim: "가격은 계약일 기준입니다.",
    summary: "계약일 기준 가격",
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: ["low_confidence"],
    source_file_ids: ["2".repeat(64)],
    source_file: "결혼준비대행서비스/서울/샘플.xlsx",
    source_object_keys: [`${"3".repeat(64)}.xlsx`],
    source_preview_keys: [`${"4".repeat(64)}.txt`],
    source_quote: "Sheet1!A1: 가격은 계약일 기준입니다.",
    source_fingerprint: "5".repeat(64),
    validation_fingerprint: "6".repeat(64),
    confidence: 0.75,
  } satisfies Omit<
    StagingLoadPlan["disclosure_semantics"][number],
    "source_record_key" | "content_fingerprint"
  >;
  const row = {
    ...semantic,
    source_record_key: buildDisclosureSemanticSourceRecordKey(semantic),
  } satisfies Omit<StagingLoadPlan["disclosure_semantics"][number], "content_fingerprint">;
  return {
    ...row,
    content_fingerprint: buildDisclosureSemanticContentFingerprint(row),
  };
}

test("semantic staging inserts an immutable pending row with its snapshot provenance", async () => {
  const row = stagingDisclosureSemanticFixture();
  const inserted: Array<Record<string, unknown>> = [];
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const client = {
    from(table: string) {
      assert.equal(table, "disclosure_semantic_staging");
      return {
        select: () => query,
        insert: (value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "99999999-9999-4999-8999-999999999999" },
                error: null,
              }),
            }),
          };
        },
      };
    },
  } as unknown as Parameters<typeof persistDisclosureSemantic>[0];

  const id = await persistDisclosureSemantic(
    client,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    row,
    { partnerVendorId: null, officialPriceId: null },
  );

  assert.equal(id, "99999999-9999-4999-8999-999999999999");
  assert.deepEqual(inserted, [{
    snapshot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...row,
    partner_vendor_id: null,
    official_price_id: null,
  }]);
});

test("document semantic staging rejects invented durable links before database access", async () => {
  const row = stagingDisclosureSemanticFixture();
  let databaseCalls = 0;
  const client = {
    from: () => {
      databaseCalls += 1;
      throw new Error("database must remain unreachable for invented document links");
    },
  } as unknown as Parameters<typeof persistDisclosureSemantic>[0];

  await assert.rejects(
    persistDisclosureSemantic(
      client,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      row,
      {
        partnerVendorId: "11111111-1111-4111-8111-111111111111",
        officialPriceId: null,
      },
    ),
    /document semantic.*durable/i,
  );
  assert.equal(databaseCalls, 0);
});

test("price-backed semantic staging persists exact durable vendor and official-price links", async () => {
  const row = semanticPlanFixture({ stageablePrice: true }).row;
  const partnerVendorId = "11111111-1111-4111-8111-111111111111";
  const officialPriceId = "22222222-2222-4222-8222-222222222222";
  const inserted: Array<Record<string, unknown>> = [];
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const client = {
    from(table: string) {
      assert.equal(table, "disclosure_semantic_staging");
      return {
        select: () => query,
        insert: (value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "99999999-9999-4999-8999-999999999999" },
                error: null,
              }),
            }),
          };
        },
      };
    },
  } as unknown as Parameters<typeof persistDisclosureSemantic>[0];

  await persistDisclosureSemantic(
    client,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    row,
    { partnerVendorId, officialPriceId },
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].partner_vendor_id, partnerVendorId);
  assert.equal(inserted[0].official_price_id, officialPriceId);
});

test("semantic staging rejects a forged source key before any database access", async () => {
  const fixture = stagingDisclosureSemanticFixture();
  const withoutContentFingerprint = {
    ...fixture,
    source_record_key: "f".repeat(64),
    content_fingerprint: undefined,
  };
  const { content_fingerprint: _removed, ...row } = withoutContentFingerprint;
  const forged = {
    ...row,
    content_fingerprint: buildDisclosureSemanticContentFingerprint(row),
  };
  let databaseCalls = 0;
  const client = {
    from: () => {
      databaseCalls += 1;
      throw new Error("database must remain unreachable for a forged source key");
    },
  } as unknown as Parameters<typeof persistDisclosureSemantic>[0];

  await assert.rejects(
    persistDisclosureSemantic(
      client,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      forged,
      { partnerVendorId: null, officialPriceId: null },
    ),
    /source record key.*immutable locator|source key.*match/iu,
  );
  assert.equal(databaseCalls, 0);
});

test("semantic staging is idempotent and rejects immutable source-key content drift", async () => {
  const row = stagingDisclosureSemanticFixture();
  const snapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const stored = {
    id: "99999999-9999-4999-8999-999999999999",
    snapshot_id: snapshotId,
    ...row,
    partner_vendor_id: null,
    official_price_id: null,
  };
  let insertCalls = 0;
  const clientFor = (existing: Record<string, unknown>) => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data: existing, error: null }),
    };
    return {
      from(table: string) {
        assert.equal(table, "disclosure_semantic_staging");
        return {
          select: () => query,
          insert: () => {
            insertCalls += 1;
            throw new Error("an existing semantic row must never be overwritten");
          },
        };
      },
    } as unknown as Parameters<typeof persistDisclosureSemantic>[0];
  };

  assert.equal(
    await persistDisclosureSemantic(
      clientFor(stored),
      snapshotId,
      row,
      { partnerVendorId: null, officialPriceId: null },
    ),
    stored.id,
  );
  assert.equal(insertCalls, 0);

  await assert.rejects(
    persistDisclosureSemantic(
      clientFor({ ...stored, content_verbatim: "변조된 원문" }),
      snapshotId,
      row,
      { partnerVendorId: null, officialPriceId: null },
    ),
    /different immutable content/iu,
  );
  assert.equal(insertCalls, 0);
});

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

async function writeDummyDocx(
  filePath: string,
  text = "더미 기본 패키지 | 스튜디오 드레스 메이크업 | 290만원",
): Promise<void> {
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
  await writeDummyDocx(
    path.join(vendorDir, "a-prices.docx"),
    "샘플 멀티 패키지 | 스튜디오 드레스 메이크업 | 100만원",
  );
  await writeDummyDocx(
    path.join(vendorDir, "b-options.docx"),
    "샘플 멀티 패키지 | 스튜디오 드레스 메이크업 | 원본 추가 | 1건 | 10만원",
  );
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const [priceSource, optionSource] = scanned.units[0].source_files;
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const requestSourceIds = [...request.text.matchAll(/^source_file_id:\s*([a-f0-9]{64})\s*$/gmu)]
        .map((match) => match[1]);
      assert.equal(requestSourceIds.length, 1);
      const isPriceRequest = requestSourceIds[0] === sourceFileId(priceSource);
      const locatedLine = /^(line:\d+:\s*.*)$/mu.exec(request.text)?.[1];
      assert.ok(locatedLine);
      return {
        data: {
        doc_kind: "agency_disclosure",
        business_name: scanned.units[0].parsed.raw_name,
        region_hint: "제주",
        agency_packages: [{
          package_name: "샘플 멀티 패키지",
          category_scope: ["studio", "dress", "makeup"],
          price_min_krw: isPriceRequest ? 1_000_000 : null,
          price_max_krw: isPriceRequest ? 1_000_000 : null,
          vat_note: null,
          price_note: null,
          source_quote: locatedLine,
          source_file_ids: requestSourceIds,
          options: isPriceRequest ? [] : [{
            name: "원본 추가",
            price_min_krw: 100_000,
            price_max_krw: 100_000,
            unit: "1건",
            condition: null,
            raw_text:
              "샘플 멀티 패키지 | 스튜디오 드레스 메이크업 | 원본 추가 | 1건 | 10만원",
            source_quote: locatedLine,
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
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );

  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });
  const row = dry.plan.agency_packages[0];
  assert.equal(row.source_file, priceSource.path);
  assert.deepEqual(row.source_object_keys, [`${priceSource.sha256}.${priceSource.ext}`]);
  assert.equal(row.options[0].source_file, optionSource.path);
  assert.deepEqual(row.options[0].source_object_keys, [`${optionSource.sha256}.${optionSource.ext}`]);
  assert.notEqual(row.source_file, row.options[0].source_file);
});

test("load stages every canonical hall with distinct identity, prices, options, and source provenance", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-canonical-halls-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "hall", "jeju", "generated-venue");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(
    path.join(vendorDir, "grand.docx"),
    "그랜드 홀 대관료 300만원 주말 기준, 식대 8만원, 최소 보증 인원 200명",
  );
  await writeDummyDocx(
    path.join(vendorDir, "ocean.docx"),
    "오션 홀 대관료 500만원, 장식비 100만원 생화 포함, 빔 프로젝터 10만원",
  );
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const [grandSource, oceanSource] = scanned.units[0].source_files;
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const requestSourceIds = [...request.text.matchAll(/^source_file_id:\s*([a-f0-9]{64})\s*$/gmu)]
        .map((match) => match[1]);
      assert.equal(requestSourceIds.length, 1);
      const sourceQuote = /^(line:\d+:\s*.*)$/mu.exec(request.text)?.[1];
      assert.ok(sourceQuote);
      const isGrandHall = requestSourceIds[0] === sourceFileId(grandSource);
      return {
        data: {
          doc_kind: "hall_disclosure",
          business_name: scanned.units[0].parsed.raw_name,
          region_hint: "제주",
          agency_packages: [],
          partner_vendors: [],
          halls: [isGrandHall ? {
            hall_name: "그랜드 홀",
            guarantee_min: 200,
            meal_price_min_krw: 80_000,
            meal_price_max_krw: 80_000,
            venue_fee_min_krw: 3_000_000,
            venue_fee_max_krw: 3_000_000,
            venue_fee_note: "주말 기준",
            decoration_fee_min_krw: null,
            decoration_fee_max_krw: null,
            decoration_note: null,
            options: [],
            source_quote: sourceQuote,
            source_file_ids: requestSourceIds,
            confidence: 0.95,
            needs_review: false,
          } : {
            hall_name: "오션 홀",
            guarantee_min: null,
            meal_price_min_krw: null,
            meal_price_max_krw: null,
            venue_fee_min_krw: 5_000_000,
            venue_fee_max_krw: 5_000_000,
            venue_fee_note: null,
            decoration_fee_min_krw: 1_000_000,
            decoration_fee_max_krw: 1_000_000,
            decoration_note: "생화 포함",
            options: [{
              name: "빔 프로젝터",
              price_min_krw: 100_000,
              price_max_krw: 100_000,
              unit: null,
              condition: null,
              raw_text: "빔 프로젝터 10만원",
              source_quote: sourceQuote,
              source_file_ids: requestSourceIds,
            }],
            source_quote: sourceQuote,
            source_file_ids: requestSourceIds,
            confidence: 0.9,
            needs_review: false,
          }],
          sections: [],
          money_occurrences: [],
          hall: {
            venue_fee_krw: null,
            meal_price_min_krw: null,
            meal_price_max_krw: null,
            venue_fee_source_quote: null,
            meal_price_source_quote: null,
            venue_fee_source_file_ids: [],
            meal_price_source_file_ids: [],
            items: [],
            confidence: 0,
            needs_review: false,
          },
          extraction_notes: "generated canonical halls fixture",
        },
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );

  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.deepEqual(dry.plan.skipped_units, []);
  assert.equal(dry.plan.units.length, 1);
  assert.deepEqual(
    dry.plan.official_prices.map((row) => ({
      item_name: row.item_name,
      base_spec: row.base_spec,
      price_min_krw: row.price_min_krw,
      price_max_krw: row.price_max_krw,
      price_note: row.price_note,
      source_file: row.source_file,
      source_quote: row.source_quote,
      source_object_keys: row.source_object_keys,
      option_names: row.options.map((option) => option.name),
      option_sources: row.options.map((option) => option.source_file),
      option_object_keys: row.options.map((option) => option.source_object_keys),
      review_status: row.review_status,
    })),
    [
      {
        item_name: "그랜드 홀 대관료",
        base_spec: "최소 보증 인원 200명",
        price_min_krw: 3_000_000,
        price_max_krw: 3_000_000,
        price_note: "주말 기준",
        source_file: grandSource.path,
        source_quote: "line:1: docx:body:p1: 그랜드 홀 대관료 300만원 주말 기준, 식대 8만원, 최소 보증 인원 200명",
        source_object_keys: [`${grandSource.sha256}.${grandSource.ext}`],
        option_names: [],
        option_sources: [],
        option_object_keys: [],
        review_status: "pending",
      },
      {
        item_name: "그랜드 홀 식대",
        base_spec: "최소 보증 인원 200명",
        price_min_krw: 80_000,
        price_max_krw: 80_000,
        price_note: null,
        source_file: grandSource.path,
        source_quote: "line:1: docx:body:p1: 그랜드 홀 대관료 300만원 주말 기준, 식대 8만원, 최소 보증 인원 200명",
        source_object_keys: [`${grandSource.sha256}.${grandSource.ext}`],
        option_names: [],
        option_sources: [],
        option_object_keys: [],
        review_status: "pending",
      },
      {
        item_name: "오션 홀 대관료",
        base_spec: null,
        price_min_krw: 5_000_000,
        price_max_krw: 5_000_000,
        price_note: null,
        source_file: oceanSource.path,
        source_quote: "line:2: docx:body:p1: 오션 홀 대관료 500만원, 장식비 100만원 생화 포함, 빔 프로젝터 10만원",
        source_object_keys: [`${oceanSource.sha256}.${oceanSource.ext}`],
        option_names: [],
        option_sources: [],
        option_object_keys: [],
        review_status: "pending",
      },
      {
        item_name: "오션 홀 장식비",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_000_000,
        price_note: "생화 포함",
        source_file: oceanSource.path,
        source_quote: "line:2: docx:body:p1: 오션 홀 대관료 500만원, 장식비 100만원 생화 포함, 빔 프로젝터 10만원",
        source_object_keys: [`${oceanSource.sha256}.${oceanSource.ext}`],
        option_names: [],
        option_sources: [],
        option_object_keys: [],
        review_status: "pending",
      },
      {
        item_name: "오션 홀 옵션",
        base_spec: null,
        price_min_krw: null,
        price_max_krw: null,
        price_note: null,
        source_file: oceanSource.path,
        source_quote: "line:2: docx:body:p1: 오션 홀 대관료 500만원, 장식비 100만원 생화 포함, 빔 프로젝터 10만원",
        source_object_keys: [`${oceanSource.sha256}.${oceanSource.ext}`],
        option_names: ["빔 프로젝터"],
        option_sources: [oceanSource.path],
        option_object_keys: [[`${oceanSource.sha256}.${oceanSource.ext}`]],
        review_status: "pending",
      },
    ],
  );
  assert.equal(new Set(dry.plan.official_prices.map((row) => row.source_record_key)).size, 5);
});

test("load preserves a pricing-basis section even when the document has no price row", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-semantic-only-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "agency", "jeju", "semantic-only-agency");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(
    path.join(vendorDir, "pricing-basis.docx"),
    "가격 기준 | 계약 시점의 공시 원문을 그대로 적용합니다",
  );
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const source = scanned.units[0].source_files[0];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const sourceQuote = /^(line:\d+:\s*.*)$/mu.exec(request.text)?.[1];
      assert.ok(sourceQuote);
      return {
        data: {
          doc_kind: "agency_disclosure",
          business_name: scanned.units[0].parsed.raw_name,
          region_hint: "제주",
          agency_packages: [],
          partner_vendors: [],
          halls: [],
          sections: [{
            section_type: "pricing_basis",
            title: "가격 기준",
            content_verbatim: "가격 기준 | 계약 시점의 공시 원문을 그대로 적용합니다",
            summary: "계약 시점 공시 원문 적용",
            source_quote: sourceQuote,
            source_file_ids: [sourceFileId(source)],
            confidence: 0.95,
            needs_review: false,
          }],
          money_occurrences: [],
          hall: {
            venue_fee_krw: null,
            meal_price_min_krw: null,
            meal_price_max_krw: null,
            venue_fee_source_quote: null,
            meal_price_source_quote: null,
            venue_fee_source_file_ids: [],
            meal_price_source_file_ids: [],
            items: [],
            confidence: 0,
            needs_review: false,
          },
          extraction_notes: "generated semantic-only fixture",
        },
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );

  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.deepEqual(dry.plan.skipped_units, []);
  assert.equal(dry.plan.units.length, 1);
  assert.equal(dry.plan.agency_packages.length, 0);
  assert.equal(dry.plan.official_prices.length, 0);
  assert.deepEqual(dry.plan.disclosure_semantics, [{
    schema_version: 2,
    unit_id: scanned.units[0].unit_id,
    record_kind: "document_section",
    semantic_type: "pricing_basis",
    subject_kind: "agency",
    subject_name: scanned.units[0].parsed.raw_name,
    subject_normalized_name: scanned.units[0].parsed.normalized_name,
    partner_record_ref: null,
    source_agency: null,
    partner_link_status: "not_applicable",
    vendor_category: null,
    region_code: "jeju",
    title: "가격 기준",
    content_verbatim: "가격 기준 | 계약 시점의 공시 원문을 그대로 적용합니다",
    summary: "계약 시점 공시 원문 적용",
    review_status: "pending",
    needs_review: false,
    validation_issue_codes: [],
    source_file_ids: [sourceFileId(source)],
    source_file: source.path,
    source_object_keys: [`${source.sha256}.${source.ext}`],
    source_preview_keys: [dry.plan.preview_objects[0].storage_path],
    source_quote: "line:1: docx:body:p1: 가격 기준 \\| 계약 시점의 공시 원문을 그대로 적용합니다",
    source_fingerprint: scanned.units[0].source_fingerprint,
    validation_fingerprint: dry.plan.units[0].validation_fingerprint,
    confidence: 0.95,
    source_record_key: dry.plan.disclosure_semantics[0].source_record_key,
    content_fingerprint: dry.plan.disclosure_semantics[0].content_fingerprint,
  }]);
  assert.match(dry.plan.disclosure_semantics[0].source_record_key, /^[a-f0-9]{64}$/u);
  assert.match(dry.plan.disclosure_semantics[0].content_fingerprint, /^[a-f0-9]{64}$/u);
});

test("load stages a source-backed unpriced partner identity without inventing a price", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-policy-only-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "agency", "jeju", "policy-only-agency");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(
    path.join(vendorDir, "partner-policy.docx"),
    "샘플드레스 위약금 규정 | 계약 취소 시 위약금은 별도 협의합니다",
  );
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const source = scanned.units[0].source_files[0];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const sourceQuote = /^(line:\d+:\s*.*)$/mu.exec(request.text)?.[1];
      assert.ok(sourceQuote);
      return {
        data: {
          doc_kind: "partner_price_list",
          business_name: scanned.units[0].parsed.raw_name,
          region_hint: "제주",
          agency_packages: [],
          partner_vendors: [{
            vendor_name: "샘플드레스",
            old_names: [],
            category: "dress",
            price_min_krw: null,
            price_max_krw: null,
            base_spec: null,
            price_note: null,
            options: [],
            policies: [{
              policy_type: "penalty",
              raw_text: "샘플드레스 위약금 규정 | 계약 취소 시 위약금은 별도 협의합니다",
              source_quote: sourceQuote,
              source_file_ids: [sourceFileId(source)],
            }],
            source_quote: sourceQuote,
            source_file_ids: [sourceFileId(source)],
            confidence: 0.86,
            needs_review: false,
          }],
          halls: [],
          sections: [],
          money_occurrences: [],
          hall: {
            venue_fee_krw: null,
            meal_price_min_krw: null,
            meal_price_max_krw: null,
            venue_fee_source_quote: null,
            meal_price_source_quote: null,
            venue_fee_source_file_ids: [],
            meal_price_source_file_ids: [],
            items: [],
            confidence: 0,
            needs_review: false,
          },
          extraction_notes: "generated policy-only fixture",
        },
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );

  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.deepEqual(dry.plan.skipped_units, []);
  assert.equal(dry.plan.official_prices.length, 1);
  assert.equal(dry.plan.agency_packages.length, 0);
  assert.equal(dry.plan.disclosure_semantics.length, 1);
  assert.deepEqual(dry.plan.official_prices[0], {
    unit_id: scanned.units[0].unit_id,
    partner_record_ref: dry.plan.official_prices[0].partner_record_ref,
    vendor_name: "샘플드레스",
    alias_proposals: [],
    source_agency: {
      name: scanned.units[0].parsed.raw_name,
      normalized_name: scanned.units[0].parsed.normalized_name,
      corporate_name: scanned.units[0].parsed.corporate_name,
      region_code: "jeju",
      source_file: source.path,
    },
    category: "dress",
    region_code: "jeju",
    item_name: "샘플드레스",
    base_spec: null,
    price_min_krw: null,
    price_max_krw: null,
    vat_note: null,
    price_note: null,
    options: [],
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: ["identity_only_no_price"],
    source_file: source.path,
    source_object_keys: [`${source.sha256}.${source.ext}`],
    source_preview_keys: [dry.plan.preview_objects[0].storage_path],
    source_quote: "line:1: docx:body:p1: 샘플드레스 위약금 규정 \\| 계약 취소 시 위약금은 별도 협의합니다",
    confidence: 0.86,
    source_record_key: dry.plan.official_prices[0].source_record_key,
  });
  assert.match(dry.plan.official_prices[0].partner_record_ref ?? "", /^[a-f0-9]{64}$/u);
  assert.match(dry.plan.official_prices[0].source_record_key, /^[a-f0-9]{64}$/u);
  assert.equal(
    dry.plan.official_prices[0].needs_review === false
      && dry.plan.official_prices[0].validation_issue_codes.length === 0,
    false,
    "an identity-only partner must fail closed for bulk approval",
  );
  assert.deepEqual(dry.plan.disclosure_semantics[0], {
    schema_version: 2,
    unit_id: scanned.units[0].unit_id,
    record_kind: "vendor_policy",
    semantic_type: "penalty",
    subject_kind: "vendor",
    subject_name: "샘플드레스",
    subject_normalized_name: "샘플드레스",
    partner_record_ref: dry.plan.disclosure_semantics[0].partner_record_ref,
    source_agency: {
      name: scanned.units[0].parsed.raw_name,
      normalized_name: scanned.units[0].parsed.normalized_name,
      corporate_name: scanned.units[0].parsed.corporate_name,
      region_code: "jeju",
      source_file: source.path,
    },
    partner_link_status: "price_row_staged",
    vendor_category: "dress",
    region_code: "jeju",
    title: null,
    content_verbatim: "샘플드레스 위약금 규정 | 계약 취소 시 위약금은 별도 협의합니다",
    summary: null,
    review_status: "pending",
    needs_review: false,
    validation_issue_codes: [],
    source_file_ids: [sourceFileId(source)],
    source_file: source.path,
    source_object_keys: [`${source.sha256}.${source.ext}`],
    source_preview_keys: [dry.plan.preview_objects[0].storage_path],
    source_quote: "line:1: docx:body:p1: 샘플드레스 위약금 규정 \\| 계약 취소 시 위약금은 별도 협의합니다",
    source_fingerprint: scanned.units[0].source_fingerprint,
    validation_fingerprint: dry.plan.units[0].validation_fingerprint,
    confidence: 0.86,
    source_record_key: dry.plan.disclosure_semantics[0].source_record_key,
    content_fingerprint: dry.plan.disclosure_semantics[0].content_fingerprint,
  });
  assert.match(dry.plan.disclosure_semantics[0].partner_record_ref ?? "", /^[a-f0-9]{64}$/u);
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
      source_quote: "더미 기본 패키지 | 스튜디오 드레스 메이크업 | 290만원",
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

test("a stageable partner vendor cannot disappear outside the four-tab explorer taxonomy", () => {
  const data = partnerExtraction();
  data.partner_vendors[0]!.category = "other";

  assert.throws(
    () => assertFourTabPartnerVendorCompatibility(data),
    /no four-tab explorer category.*other/iu,
  );

  data.partner_vendors[0]!.category = "dress";
  assert.doesNotThrow(() => assertFourTabPartnerVendorCompatibility(data));
});

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
    extractPdfText: async () => "카테고리: 스튜디오 | 샘플제휴스튜디오 기본 촬영 120만원 ".repeat(20),
    rasterizePdf: async (_sourcePath, outputDirectory) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, "generated partner price raster");
      return [pagePath];
    },
  });
  const provider: ExtractionProvider = {
    extract: async () => {
      const data = partnerExtraction();
      data.partner_vendors[0].source_quote =
        "line:1: 카테고리: 스튜디오 | 샘플제휴스튜디오 기본 촬영 120만원";
      return { data, inputTokens: 10, outputTokens: 5 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  await validateManifest({ stateDir });
  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.equal(
    dry.plan.official_prices.length,
    1,
    JSON.stringify(dry.plan.skipped_units),
  );
  assert.deepEqual(dry.plan.official_prices[0].source_agency, {
    name: "샘플연결플래너",
    normalized_name: "샘플연결플래너",
    corporate_name: null,
    region_code: "jeju",
    source_file: "결혼준비대행서비스/제주/(제주)_샘플연결플래너.pdf",
  });
  assert.deepEqual(dry.plan.official_prices[0].alias_proposals, ["샘플제휴스튜디오 구상호"]);
});

test("load is dry by default and keeps validated artifacts tamper-evident", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-load-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_더미플래너.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const provider: ExtractionProvider = {
    extract: async () => {
      const data = extraction();
      data.agency_packages[0].source_quote =
        "line:1: docx:body:p1: 더미 기본 패키지 \\| 스튜디오 드레스 메이크업 \\| 290만원";
      return { data, inputTokens: 10, outputTokens: 5, requestId: "req_generated" };
    },
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
    /validation_conversion_artifact_changed|conversion artifact hash|artifact hash.*conversion/iu,
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
    /strict extraction metadata|preview artifact path|변환 디렉터리/iu,
  );
  await writeJsonFile(manifestPath, originalManifest);

  const artifactPath = dryRun.manifest.units[0].validation?.artifact_path;
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
    uploadRawObjects(client, "disclosure-raw", plan, storageOwnershipForTest()),
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
        download: async () => ({ data: new Blob([content]), error: null }),
        info: async () => ({
          data: {
            size: content.byteLength,
            metadata: {
              size: content.byteLength,
              ingestRunSha256: STORAGE_TEST_RUN_SHA256,
              ingestSha256: digest,
              ingestBytes: content.byteLength,
              ingestClaimToken: STORAGE_TEST_CLAIM_TOKEN,
              ingestClaimEpoch: 1,
              ingestClaimantId: STORAGE_TEST_CLAIMANT_ID,
            },
          },
          error: null,
        }),
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

  const storageJournal = await uploadPreviewObjects(
    client,
    "disclosure-preview",
    plan,
    storageOwnershipForTest(),
  );

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, "disclosure-preview");
  assert.equal(uploads[0].key, `${digest}.txt`);
  assert.deepEqual(uploads[0].options, {
    contentType: "text/plain",
    upsert: false,
    metadata: {
      ingest_run_sha256: STORAGE_TEST_RUN_SHA256,
      ingest_sha256: digest,
      ingest_bytes: content.byteLength,
      ingest_claim_token: STORAGE_TEST_CLAIM_TOKEN,
      ingest_claim_epoch: 1,
      ingest_claimant_id: STORAGE_TEST_CLAIMANT_ID,
    },
  });
  assert.deepEqual(plan.raw_objects, rawObjects);
  assert.deepEqual(storageJournal, [{
    bucket: "disclosure-preview",
    object_key: `${digest}.txt`,
    sha256: digest,
    bytes: content.byteLength,
    created: true,
  }]);
});

test("a verify claim reuses an inherited raw object and makes zero HTTP upload calls", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-verify-claim-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "source.pdf");
  const content = Buffer.from("inherited immutable evidence");
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  const objectKey = `${digest}.pdf`;
  const inheritedOwner = "a".repeat(64);
  let uploadCalls = 0;
  const recorded: Array<{ created: boolean; uploadAttempt: number }> = [];
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          uploadCalls += 1;
          return { data: null, error: null };
        },
        download: async () => ({ data: new Blob([content]), error: null }),
        info: async () => ({
          data: {
            size: content.byteLength,
            metadata: {
              size: content.byteLength,
              ingest_run_sha256: inheritedOwner,
              ingest_sha256: digest,
              ingest_bytes: content.byteLength,
            },
          },
          error: null,
        }),
      }),
    },
  } as unknown as Parameters<typeof uploadRawObjects>[0];
  const plan = {
    raw_objects: [{
      source_path: "예식장/서울/source.pdf",
      absolute_path: sourcePath,
      sha256: digest,
      ext: "pdf",
      bytes: content.byteLength,
      storage_path: objectKey,
    }],
  } as StagingLoadPlan;

  const result = await uploadRawObjects(client, "disclosure-raw", plan, {
    runSha256: STORAGE_TEST_RUN_SHA256,
    firstObjectIndex: 1,
    claimObject: async (object) => ({
      fresh: true,
      claim: {
        ...object,
        claim_token: "66666666-6666-4666-8666-666666666666",
        claim_epoch: 3,
        claimant_id: STORAGE_TEST_CLAIMANT_ID,
        claim_action: "verify",
        claim_expires_at: "2026-07-20T06:10:00.000Z",
      },
    }),
    recordClaim: async () => "verify-claim-journal",
    startUpload: async () => assert.fail("verify claims must never open the HTTP upload path"),
    recordObject: async (object, _objectIndex, _claim, uploadAttempt) => {
      recorded.push({ created: object.created, uploadAttempt });
      return "verify-object-journal";
    },
  });

  assert.equal(uploadCalls, 0);
  assert.deepEqual(recorded, [{ created: false, uploadAttempt: 0 }]);
  assert.deepEqual(result, [{
    bucket: "disclosure-raw",
    object_key: objectKey,
    sha256: digest,
    bytes: content.byteLength,
    created: false,
  }]);
});

test("the HTTP upload helper rejects a claim for any different object before Storage I/O", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-wrong-claim-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "source.pdf");
  const content = Buffer.from("exact claim boundary");
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  let storageCalls = 0;
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          storageCalls += 1;
          return { data: null, error: null };
        },
        download: async () => {
          storageCalls += 1;
          return { data: new Blob([content]), error: null };
        },
        info: async () => {
          storageCalls += 1;
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof uploadRawObjects>[0];

  await assert.rejects(
    uploadRawObjects(client, "disclosure-raw", {
      raw_objects: [{
        source_path: "예식장/서울/source.pdf",
        absolute_path: sourcePath,
        sha256: digest,
        ext: "pdf",
        bytes: content.byteLength,
        storage_path: `${digest}.pdf`,
      }],
    } as StagingLoadPlan, {
      runSha256: STORAGE_TEST_RUN_SHA256,
      firstObjectIndex: 1,
      claimObject: async () => ({
        fresh: true,
        claim: {
          bucket: "disclosure-raw",
          object_key: `${"9".repeat(64)}.pdf`,
          sha256: "9".repeat(64),
          bytes: content.byteLength,
          claim_token: "99999999-9999-4999-8999-999999999999",
          claim_epoch: 1,
          claimant_id: STORAGE_TEST_CLAIMANT_ID,
          claim_action: "upload",
          claim_expires_at: "2026-07-20T06:10:00.000Z",
        },
      }),
      recordClaim: async () => assert.fail("a mismatched claim must not be journaled as usable"),
      startUpload: async () => assert.fail("a mismatched claim must not start an upload"),
      recordObject: async () => assert.fail("a mismatched claim must not record an object"),
    }),
    /claim does not bind the exact prepared raw object/u,
  );
  assert.equal(storageCalls, 0);
});

test("a crash-resume observation closes the exact upload claim without re-uploading", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-observed-resume-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "source.pdf");
  const content = Buffer.from("already uploaded by the exact claim");
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  const objectKey = `${digest}.pdf`;
  const claimToken = "77777777-7777-4777-8777-777777777777";
  let uploadCalls = 0;
  let recordedAttempt = 0;
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          uploadCalls += 1;
          return { data: null, error: null };
        },
        download: async () => ({ data: new Blob([content]), error: null }),
        info: async () => ({
          data: {
            size: content.byteLength,
            metadata: {
              size: content.byteLength,
              ingest_run_sha256: STORAGE_TEST_RUN_SHA256,
              ingest_sha256: digest,
              ingest_bytes: content.byteLength,
              ingest_claim_token: claimToken,
              ingest_claim_epoch: 9,
              ingest_claimant_id: STORAGE_TEST_CLAIMANT_ID,
            },
          },
          error: null,
        }),
      }),
    },
  } as unknown as Parameters<typeof uploadRawObjects>[0];

  const result = await uploadRawObjects(client, "disclosure-raw", {
    raw_objects: [{
      source_path: "예식장/서울/source.pdf",
      absolute_path: sourcePath,
      sha256: digest,
      ext: "pdf",
      bytes: content.byteLength,
      storage_path: objectKey,
    }],
  } as StagingLoadPlan, {
    runSha256: STORAGE_TEST_RUN_SHA256,
    firstObjectIndex: 1,
    claimObject: async (object) => ({
      fresh: false,
      claim: {
        ...object,
        claim_token: claimToken,
        claim_epoch: 9,
        claimant_id: STORAGE_TEST_CLAIMANT_ID,
        claim_action: "upload",
        claim_expires_at: "2026-07-20T06:10:00.000Z",
      },
    }),
    recordClaim: async () => "resume-claim-journal",
    startUpload: async () => ({ uploadAttempt: 2, shouldUpload: false, journalPath: null }),
    recordObject: async (object, _objectIndex, _claim, uploadAttempt) => {
      assert.equal(object.created, true);
      recordedAttempt = uploadAttempt;
      return "resume-object-journal";
    },
  });

  assert.equal(uploadCalls, 0);
  assert.equal(recordedAttempt, 2);
  assert.equal(result[0].created, true);
});

test("a recalled local claim fails closed before a copied loader can enter HTTP upload", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-copied-claim-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "source.pdf");
  const content = Buffer.from("copied claimant must not upload");
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  let uploadCalls = 0;
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          uploadCalls += 1;
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof uploadRawObjects>[0];

  await assert.rejects(
    uploadRawObjects(client, "disclosure-raw", {
      raw_objects: [{
        source_path: "agency/seoul/source.pdf",
        absolute_path: sourcePath,
        sha256: digest,
        ext: "pdf",
        bytes: content.byteLength,
        storage_path: `${digest}.pdf`,
      }],
    } as StagingLoadPlan, {
      runSha256: STORAGE_TEST_RUN_SHA256,
      firstObjectIndex: 1,
      claimObject: async (object) => ({
        fresh: false,
        claim: {
          ...object,
          claim_token: "33333333-3333-4333-8333-333333333333",
          claim_epoch: 4,
          claimant_id: STORAGE_TEST_CLAIMANT_ID,
          claim_action: "upload",
          claim_expires_at: "2026-07-20T06:10:00.000Z",
        },
      }),
      recordClaim: async () => assert.fail("a recalled claim must already have a durable claim journal"),
      startUpload: async (_claim, _objectIndex, freshClaim) => {
        assert.equal(freshClaim, false);
        throw new Error("storage_upload_manual_reconciliation_required:attempt=0");
      },
      recordObject: async () => assert.fail("an un-reconciled copied claim must not observe an object"),
    }),
    /storage_upload_manual_reconciliation_required/u,
  );
  assert.equal(uploadCalls, 0);
});

test("an atomic batch lets prepare bootstrap a missing draft, journals Storage, then makes one RPC without local paths", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-atomic-batch-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const absolutePath = path.join(rootDir, "source.pdf");
  const content = Buffer.from("immutable source");
  await writeFile(absolutePath, content);
  const sourceSha = createHash("sha256").update(content).digest("hex");
  const unitId = createHash("sha256").update("atomic-unit").digest("hex");
  const sourceId = createHash("sha256").update("atomic-source-id").digest("hex");
  const sourceObjectKey = `${sourceSha}.pdf`;
  const sourceFile = "agency/seoul/source.pdf";
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{
      unit_id: unitId,
      source_fingerprint: "1".repeat(64),
      conversion_fingerprint: "2".repeat(64),
      extraction_fingerprint: "3".repeat(64),
      validation_fingerprint: "4".repeat(64),
      source_object_keys: [sourceObjectKey],
      source_preview_keys: [],
      source_records: [{
        source_file_id: sourceId,
        source_file: sourceFile,
        source_object_key: sourceObjectKey,
        source_preview_key: null,
      }],
      data: {
        doc_kind: "agency_disclosure",
        agency_packages: [],
        partner_vendors: [],
        sections: [],
        hall: null,
      },
    }],
    skipped_units: [],
    raw_objects: [{
      source_path: sourceFile,
      absolute_path: absolutePath,
      sha256: sourceSha,
      ext: "pdf",
      bytes: content.byteLength,
      storage_path: sourceObjectKey,
    }],
    preview_objects: [],
    agency_packages: [{
      unit_id: unitId,
      agency_name: "Atomic Agency",
      agency_normalized_name: "atomicagency",
      agency_corporate_name: null,
      region_code: "seoul",
      package_name: "Base",
      category_scope: ["studio"],
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: true,
      validation_issue_codes: ["local_deterministic_review_only"],
      source_file: sourceFile,
      source_object_keys: [sourceObjectKey],
      source_preview_keys: [],
      source_quote: "line:1: Base 100만원",
      confidence: 0.9,
    }],
    official_prices: [],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: [`local_deterministic_review_only:${unitId}`],
  } as unknown as StagingLoadPlan;
  const batch = buildStagingBatches(plan)[0]!;
  const authorization = localAuthorizationFor(plan, [unitId]);
  const descriptor = createStagingRunDescriptor(
    plan,
    "staging-ref",
    STAGING_RUN_STARTED_AT,
    localBatchAuthorizationFor(authorization),
    authorization,
  );
  const events: string[] = [];
  let rpcArguments: Record<string, unknown> | undefined;
  let replayGenericPreexisting = false;
  const client = {
    from: (table: string) => {
      assert.equal(table, "price_snapshots");
      events.push("snapshot-query");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        upload: async (_key: string, _content: Uint8Array, options: Record<string, unknown>) => {
          assert.equal(replayGenericPreexisting, false, "a verify replay must not enter HTTP upload");
          events.push("storage-upload");
          assert.deepEqual(options.metadata, {
            ingest_run_sha256: descriptor.run_sha256,
            ingest_sha256: sourceSha,
            ingest_bytes: content.byteLength,
            ingest_claim_token: STORAGE_TEST_CLAIM_TOKEN,
            ingest_claim_epoch: 1,
            ingest_claimant_id: STORAGE_TEST_CLAIMANT_ID,
          });
          return { data: null, error: null };
        },
        info: async () => ({
          data: {
            size: content.byteLength,
            metadata: replayGenericPreexisting ? {
              size: content.byteLength,
            } : {
              size: content.byteLength,
              ingest_run_sha256: descriptor.run_sha256,
              ingest_sha256: sourceSha,
              ingest_bytes: content.byteLength,
              ingest_claim_token: STORAGE_TEST_CLAIM_TOKEN,
              ingest_claim_epoch: 1,
              ingest_claimant_id: STORAGE_TEST_CLAIMANT_ID,
            },
          },
          error: null,
        }),
        download: async () => ({ data: new Blob([content]), error: null }),
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "prepare_vendor_disclosure_batch_storage_atomic") {
        events.push("storage-prepare-rpc");
        assert.deepEqual(args.p_storage_intents, [{
          bucket: "disclosure-raw",
          object_key: sourceObjectKey,
          sha256: sourceSha,
          bytes: content.byteLength,
        }]);
        return {
          data: [{ prepared_object_count: 1, already_prepared: false }],
          error: null,
        };
      }
      if (name === "claim_vendor_disclosure_storage_object_atomic") {
        events.push("storage-claim-rpc");
        assert.equal(args.p_object_name, sourceObjectKey);
        assert.equal(args.p_claimant_id, STORAGE_TEST_CLAIMANT_ID);
        return {
          data: [{
            claim_token: replayGenericPreexisting
              ? "22222222-2222-4222-8222-222222222222"
              : STORAGE_TEST_CLAIM_TOKEN,
            claim_epoch: replayGenericPreexisting ? 2 : 1,
            claimant_id: STORAGE_TEST_CLAIMANT_ID,
            claim_action: replayGenericPreexisting ? "verify" : "upload",
            ownership_state: replayGenericPreexisting ? "confirmed_preexisting" : "intent",
            claim_expires_at: "2026-07-20T06:10:00.000Z",
            already_claimed: false,
          }],
          error: null,
        };
      }
      if (name === "record_vendor_disclosure_storage_object_atomic") {
        events.push("storage-outcome-rpc");
        assert.equal(args.p_created_by_run, !replayGenericPreexisting);
        assert.equal(
          args.p_claim_token,
          replayGenericPreexisting
            ? "22222222-2222-4222-8222-222222222222"
            : STORAGE_TEST_CLAIM_TOKEN,
        );
        assert.equal(args.p_claim_epoch, replayGenericPreexisting ? 2 : 1);
        assert.equal(args.p_claimant_id, STORAGE_TEST_CLAIMANT_ID);
        return {
          data: [{
            ownership_state: replayGenericPreexisting ? "confirmed_preexisting" : "confirmed_created",
            already_recorded: false,
          }],
          error: null,
        };
      }
      assert.equal(name, "stage_vendor_disclosure_batch_atomic");
      events.push("stage-rpc");
      rpcArguments = args;
      return {
        data: [{
          batch_receipt_sha256: createHash("sha256").update("receipt").digest("hex"),
          loaded_unit_ids: [unitId],
          logged_ledger_ids: [],
          already_applied: false,
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  const environment = {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    } as const;
  const writeContext: StagingBatchWriteContext = {
      target_project_ref: "staging-ref",
      run_sha256: descriptor.run_sha256,
      full_plan_sha256: descriptor.full_plan_sha256,
      batch_plan_sha256: batch.batch_plan_sha256,
      batch_sha256: batch.batch_sha256,
      batch_index: 1,
      batch_count: 1,
      unit_ids: [unitId],
      authorization_kind: "local_validated_pending_only",
      authorization_sha256: authorization.authorization_sha256,
      local_pending_only_unit_ids: [unitId],
      storage_claimant_id: STORAGE_TEST_CLAIMANT_ID,
      record_storage_intent: async () => {
        events.push("storage-intent");
        return "ignored-test-intent-path";
      },
      read_storage_claim: async () => null,
      record_storage_claim: async () => {
        events.push("storage-claim-journal");
        return "ignored-test-claim-path";
      },
      record_storage_upload_started: async () => {
        assert.equal(replayGenericPreexisting, false, "a verify replay must not start an upload attempt");
        events.push("storage-upload-start-journal");
        return { uploadAttempt: 1, shouldUpload: true, journalPath: "ignored-test-start-path" };
      },
      record_storage_journal: async () => {
        events.push("storage-journal");
        return "ignored-test-path";
      },
      record_storage_object: async (object, objectIndex) => {
        assert.equal(object.created, !replayGenericPreexisting);
        events.push(`storage-object-${objectIndex}`);
        return "ignored-object-path";
      },
    };
  const result = await stageAtomicDisclosureBatch(client, environment, plan, writeContext);

  assert.deepEqual(events, [
    "snapshot-query",
    "storage-intent",
    "storage-prepare-rpc",
    "storage-claim-rpc",
    "storage-claim-journal",
    "storage-upload-start-journal",
    "storage-upload",
    "storage-object-1",
    "storage-outcome-rpc",
    "storage-journal",
    "stage-rpc",
  ]);
  assert.deepEqual(result.loadedUnitIds, [unitId]);
  assert.ok(rpcArguments);
  assert.equal(JSON.stringify(rpcArguments).includes(rootDir), false);
  assert.equal(JSON.stringify(rpcArguments).includes("absolute_path"), false);
  assert.deepEqual(
    (rpcArguments.p_payload as StagingLoadPlan).units.map((unit) => ({
      source_fingerprint: unit.source_fingerprint,
      conversion_fingerprint: unit.conversion_fingerprint,
      extraction_fingerprint: unit.extraction_fingerprint,
      validation_fingerprint: unit.validation_fingerprint,
    })),
    [{
      source_fingerprint: "1".repeat(64),
      conversion_fingerprint: "2".repeat(64),
      extraction_fingerprint: "3".repeat(64),
      validation_fingerprint: "4".repeat(64),
    }],
  );

  events.length = 0;
  replayGenericPreexisting = true;
  const replayResult = await stageAtomicDisclosureBatch(client, environment, plan, writeContext);
  assert.deepEqual(replayResult.loadedUnitIds, [unitId]);
  assert.deepEqual(events, [
    "snapshot-query",
    "storage-intent",
    "storage-prepare-rpc",
    "storage-claim-rpc",
    "storage-claim-journal",
    "storage-object-1",
    "storage-outcome-rpc",
    "storage-journal",
    "stage-rpc",
  ]);
});

test("abort rolls back the database first and emits a manual receipt without name-only Storage deletion", async () => {
  const content = Buffer.from("atomic rollback fixture");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const runSha256 = createHash("sha256").update("rollback-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("rollback-plan").digest("hex");
  const object = {
    bucket: "disclosure-raw" as const,
    object_key: `${sha256}.pdf`,
    sha256,
    bytes: content.byteLength,
    created: true,
  };
  const events: string[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "abort_vendor_disclosure_ingest_run_atomic") {
        events.push("abort-rpc");
        assert.equal(args.p_run_sha256, runSha256);
        return {
          data: [{
            run_found: true,
            deleted_package_count: 1,
            deleted_price_count: 2,
            deleted_semantic_count: 3,
            deleted_vendor_count: 1,
            deleted_agency_count: 1,
            deleted_timeslot_count: 84,
            deleted_ledger_count: 1,
            retained_identity_count: 0,
            retained_ledger_count: 0,
            storage_rollback_objects: [{
              bucket: object.bucket,
              object_key: object.object_key,
              sha256: object.sha256,
              bytes: object.bytes,
            }],
            storage_object_outcomes: [{
              bucket: object.bucket,
              object_key: object.object_key,
              sha256: object.sha256,
              bytes: object.bytes,
              state: "delete_authorized",
            }],
            storage_rollback_receipt_sha256: "9".repeat(64),
            already_aborted: false,
          }],
          error: null,
        };
      }
      assert.equal(name, "complete_vendor_disclosure_storage_rollback_atomic");
      events.push("complete-rpc");
      assert.deepEqual(args.p_storage_objects, [{
        bucket: object.bucket,
        object_key: object.object_key,
        sha256: object.sha256,
        bytes: object.bytes,
      }]);
      return {
        data: [{ completed_object_count: 1, already_completed: false }],
        error: null,
      };
    },
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, object.bucket);
        return {
          info: async () => {
            events.push("storage-info");
            return {
              data: {
                size: object.bytes,
                metadata: {
                  size: object.bytes,
                  ingestRunSha256: runSha256,
                  ingestSha256: sha256,
                  ingestBytes: object.bytes,
                },
              },
              error: null,
            };
          },
          download: async () => {
            events.push("storage-download");
            return { data: new Blob([content]), error: null };
          },
          remove: async (keys: string[]) => {
            events.push("storage-remove");
            assert.deepEqual(keys, [object.object_key]);
            return { data: [], error: null };
          },
          exists: async () => {
            events.push("storage-exists");
            return { data: false, error: null };
          },
        };
      },
    },
  } as unknown as Parameters<typeof abortAtomicDisclosureRun>[0];

  await assert.rejects(
    abortAtomicDisclosureRun(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      reason: "test rollback",
      locally_created_storage_objects: [object],
    }),
    (error: unknown) => {
      assert.ok(error instanceof StagingRollbackIncompleteError);
      assert.equal(error.result.manualStorageDeletionRequiredCount, 1);
      assert.equal(error.result.completedStorageObjectCount, 0);
      assert.equal(error.result.deletedTimeslotCount, 84);
      return true;
    },
  );

  assert.deepEqual(events, ["abort-rpc"]);
});

test("abort never touches Storage when the database rollback fails", async () => {
  const runSha256 = createHash("sha256").update("failed-rollback-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("failed-rollback-plan").digest("hex");
  const client = {
    rpc: async () => ({ data: null, error: { code: "23505", message: "conflict" } }),
    storage: {
      from: () => assert.fail("Storage must not be inspected before a committed DB abort receipt"),
    },
  } as unknown as Parameters<typeof abortAtomicDisclosureRun>[0];
  await assert.rejects(
    abortAtomicDisclosureRun(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      reason: "test rollback failure",
      locally_created_storage_objects: [],
    }),
    /DB code: 23505/u,
  );
});

test("abort maps the database active-claim fence to an actionable resume error", async () => {
  const runSha256 = createHash("sha256").update("remote-pending-intent-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("remote-pending-intent-plan").digest("hex");
  const client = {
    rpc: async () => ({
      data: null,
      error: {
        code: "55000",
        message: "DISCLOSURE_ABORT_STORAGE_UPLOAD_CLAIMS_UNSETTLED",
        details: "1",
      },
    }),
  } as unknown as Parameters<typeof abortAtomicDisclosureRun>[0];

  await assert.rejects(
    abortAtomicDisclosureRun(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      reason: "interrupted upload",
      locally_created_storage_objects: [],
    }),
    (error: unknown) => {
      assert.ok(error instanceof StagingStorageIntentsUnsettledError);
      assert.equal(error.unsettledIntentCount, 1);
      assert.match(error.message, /resume/i);
      return true;
    },
  );
});

test("abort forwards a durable unclaimed Storage intent for locked atomic reconciliation", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-abort-pending-intent-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const fullPlanSha256 = createHash("sha256").update("pending-intent-plan").digest("hex");
  const batchSha256 = createHash("sha256").update("pending-intent-batch").digest("hex");
  const objectSha256 = createHash("sha256").update("pending-intent-object").digest("hex");
  const descriptorPayload = {
    schema_version: 2 as const,
    kind: "vendor_disclosure_staging_run" as const,
    started_at: STAGING_RUN_STARTED_AT,
    target_project_ref: "staging-ref",
    snapshot: "2026Q3",
    full_plan_sha256: fullPlanSha256,
    dedupe_candidates_sha256: createHash("sha256").update("pending-intent-dedupe").digest("hex"),
    authorization_kind: "local_validated_pending_only" as const,
    authorization_sha256: createHash("sha256").update("pending-intent-authorization").digest("hex"),
    local_pending_only_unit_ids: [createHash("sha256").update("pending-intent-unit").digest("hex")],
    batch_sha256s: [batchSha256],
  };
  const descriptor = {
    ...descriptorPayload,
    run_sha256: canonicalSha256(descriptorPayload),
  };
  await writeStagingRunDescriptor(stateDir, descriptor);
  const intent = {
    bucket: "disclosure-raw" as const,
    object_key: `${objectSha256}.pdf`,
    sha256: objectSha256,
    bytes: 123,
  };
  await writeStorageIntentJournal(stateDir, createStorageIntentJournal({
    runSha256: descriptor.run_sha256,
    batchSha256,
    batchIndex: 1,
    objects: [intent],
  }));
  let abortCalls = 0;
  const writer: StagingWriter = {
    stage: async () => assert.fail("stage is not used by abort"),
    abortRun: async () => {
      abortCalls += 1;
      return {
        runFound: false,
        deletedPackageCount: 0,
        deletedPriceCount: 0,
        deletedSemanticCount: 0,
        deletedVendorCount: 0,
        deletedAgencyCount: 0,
        deletedTimeslotCount: 0,
        deletedLedgerCount: 0,
        retainedIdentityCount: 0,
        retainedLedgerCount: 0,
        storageRollbackObjects: [],
        storageObjectOutcomes: [],
        storageRollbackReceiptSha256: null,
        ambiguousStorageObjectCount: 0,
        retainedStorageObjectCount: 0,
        alreadyMissingStorageObjectCount: 0,
        manualStorageDeletionRequiredCount: 0,
        alreadyAborted: false,
        completedStorageObjectCount: 0,
      };
    },
  };
  const environment = {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  };

  const aborted = await abortStagingRun({
    stateDir,
    fullPlanSha256,
    environment,
    reason: "cancel interrupted upload",
    writer,
  });
  assert.equal(abortCalls, 1);
  assert.equal(aborted.runFound, false);
});

test("abort code has no name-only Supabase Storage delete path", async () => {
  const writerSource = await readFile(path.resolve("scripts/ingest/supabase-writer.ts"), "utf8");
  assert.doesNotMatch(writerSource, /\.remove\s*\(/u);
});

test("the abort CLI tells operators to resume the exact load before retrying an unsettled intent", async () => {
  const cliSource = await readFile(path.resolve("scripts/ingest/index.ts"), "utf8");
  assert.match(
    cliSource,
    /abort_staging_run_blocked_by_unsettled_storage_intents[\s\S]{0,240}resume the original exact load command/iu,
  );
});

test("the invalidation CLI explains the corrected same-snapshot successor lifecycle", async () => {
  const cliSource = await readFile(path.resolve("scripts/ingest/index.ts"), "utf8");
  const commandStart = cliSource.indexOf('if (command === "invalidate-staging-run")');
  assert.notEqual(commandStart, -1);
  const commandSource = cliSource.slice(commandStart, commandStart + 1800);
  assert.match(commandSource, /invalidated_audit_retained/u);
  assert.match(commandSource, /same --snapshot/u);
  assert.match(commandSource, /atomically supersede/u);
});

test("Storage rollback completion is bound to the exact canonical abort receipt and retries lock contention", async () => {
  const runSha256 = createHash("sha256").update("completion-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("completion-plan").digest("hex");
  const receiptSha256 = createHash("sha256").update("completion-receipt").digest("hex");
  const objectSha256 = createHash("sha256").update("completion-object").digest("hex");
  const storageObject = {
    bucket: "disclosure-raw" as const,
    object_key: `${objectSha256}.pdf`,
    sha256: objectSha256,
    bytes: 42,
  };
  let attempts = 0;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      attempts += 1;
      assert.equal(name, "complete_vendor_disclosure_storage_rollback_atomic");
      assert.equal(args.p_storage_rollback_receipt_sha256, receiptSha256);
      assert.deepEqual(args.p_storage_objects, [storageObject]);
      if (attempts === 1) return { data: null, error: { code: "55P03" } };
      return {
        data: [{ completed_object_count: 1, already_completed: false }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof completeAtomicDisclosureStorageRollback>[0];

  const result = await completeAtomicDisclosureStorageRollback(client, {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  }, {
    target_project_ref: "staging-ref",
    run_sha256: runSha256,
    full_plan_sha256: fullPlanSha256,
    storage_rollback_receipt_sha256: receiptSha256,
    storage_rollback_objects: [storageObject],
  });

  assert.deepEqual(result, { completedObjectCount: 1, alreadyCompleted: false });
  assert.equal(attempts, 2);
});

test("Storage rollback completion rejects a non-canonical or malformed receipt before RPC", async () => {
  const runSha256 = createHash("sha256").update("bad-completion-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("bad-completion-plan").digest("hex");
  const firstSha256 = "1".repeat(64);
  const secondSha256 = "2".repeat(64);
  const client = {
    rpc: async () => assert.fail("invalid completion context must not call the RPC"),
  } as unknown as Parameters<typeof completeAtomicDisclosureStorageRollback>[0];
  const environment = {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  };

  await assert.rejects(
    completeAtomicDisclosureStorageRollback(client, environment, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      storage_rollback_receipt_sha256: "not-a-receipt",
      storage_rollback_objects: [],
    }),
    /context is invalid/iu,
  );
  await assert.rejects(
    completeAtomicDisclosureStorageRollback(client, environment, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      storage_rollback_receipt_sha256: "3".repeat(64),
      storage_rollback_objects: [
        { bucket: "disclosure-raw", object_key: `${secondSha256}.pdf`, sha256: secondSha256, bytes: 2 },
        { bucket: "disclosure-raw", object_key: `${firstSha256}.pdf`, sha256: firstSha256, bytes: 1 },
      ],
    }),
    /exact canonical authorized set/iu,
  );
});

test("completed-run invalidation returns a receipt and never accepts an ambiguous response", async () => {
  const runSha256 = createHash("sha256").update("invalidate-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("invalidate-plan").digest("hex");
  const receiptSha256 = createHash("sha256").update("invalidate-receipt").digest("hex");
  const calls: Record<string, unknown>[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "invalidate_vendor_disclosure_completed_run_atomic");
      calls.push(args);
      return {
        data: [{
          invalidated: true,
          already_invalidated: false,
          invalidation_receipt_sha256: receiptSha256,
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof invalidateAtomicDisclosureRun>[0];
  const result = await invalidateAtomicDisclosureRun(client, {
    url: "https://staging-ref.supabase.co",
    key: "sb_secret_generated_fixture",
    projectRef: "staging-ref",
    bucket: "disclosure-raw",
    previewBucket: "disclosure-preview",
  }, {
    target_project_ref: "staging-ref",
    run_sha256: runSha256,
    full_plan_sha256: fullPlanSha256,
    reason: "bad completed import",
  });
  assert.deepEqual(result, {
    invalidated: true,
    alreadyInvalidated: false,
    invalidationReceiptSha256: receiptSha256,
  });
  assert.deepEqual(calls, [{
    p_target_project_ref: "staging-ref",
    p_run_sha256: runSha256,
    p_full_plan_sha256: fullPlanSha256,
    p_reason: "bad completed import",
  }]);
});

test("abort preserves every DB-authorized object and reports manual deletion even without a local creator journal", async () => {
  const content = Buffer.from("missing local ownership journal");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const runSha256 = createHash("sha256").update("missing-journal-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("missing-journal-plan").digest("hex");
  const client = {
    rpc: async () => ({
      data: [{
        run_found: true,
        deleted_package_count: 0,
        deleted_price_count: 0,
        deleted_semantic_count: 0,
        deleted_vendor_count: 0,
        deleted_agency_count: 0,
        deleted_timeslot_count: 0,
        deleted_ledger_count: 0,
        retained_identity_count: 0,
        retained_ledger_count: 0,
        storage_rollback_objects: [{
          bucket: "disclosure-raw",
          object_key: `${sha256}.pdf`,
          sha256,
          bytes: content.byteLength,
        }],
        storage_object_outcomes: [{
          bucket: "disclosure-raw",
          object_key: `${sha256}.pdf`,
          sha256,
          bytes: content.byteLength,
          state: "delete_authorized",
        }],
        storage_rollback_receipt_sha256: "9".repeat(64),
        already_aborted: false,
      }],
      error: null,
    }),
    storage: {
      from: () => assert.fail("Storage must remain untouched without both ownership receipts"),
    },
  } as unknown as Parameters<typeof abortAtomicDisclosureRun>[0];
  await assert.rejects(
    abortAtomicDisclosureRun(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      reason: "missing journal",
      locally_created_storage_objects: [],
    }),
    (error: unknown) => {
      assert.ok(error instanceof StagingRollbackIncompleteError);
      assert.equal(error.result.manualStorageDeletionRequiredCount, 1);
      return true;
    },
  );
});

test("abort reports an ambiguous locally-created Storage object as an incomplete rollback", async () => {
  const content = Buffer.from("ambiguous rollback object");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const runSha256 = createHash("sha256").update("ambiguous-rollback-run").digest("hex");
  const fullPlanSha256 = createHash("sha256").update("ambiguous-rollback-plan").digest("hex");
  const object = {
    bucket: "disclosure-raw" as const,
    object_key: `${sha256}.pdf`,
    sha256,
    bytes: content.byteLength,
    created: true,
  };
  const client = {
    rpc: async () => ({
      data: [{
        run_found: true,
        deleted_package_count: 0,
        deleted_price_count: 0,
        deleted_semantic_count: 0,
        deleted_vendor_count: 0,
        deleted_agency_count: 0,
        deleted_timeslot_count: 0,
        deleted_ledger_count: 0,
        retained_identity_count: 0,
        retained_ledger_count: 0,
        storage_rollback_objects: [],
        storage_object_outcomes: [{
          bucket: object.bucket,
          object_key: object.object_key,
          sha256: object.sha256,
          bytes: object.bytes,
          state: "ambiguous",
        }],
        storage_rollback_receipt_sha256: "9".repeat(64),
        already_aborted: false,
      }],
      error: null,
    }),
    storage: {
      from: () => assert.fail("ambiguous Storage ownership must never be inspected or deleted"),
    },
  } as unknown as Parameters<typeof abortAtomicDisclosureRun>[0];

  await assert.rejects(
    abortAtomicDisclosureRun(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, {
      target_project_ref: "staging-ref",
      run_sha256: runSha256,
      full_plan_sha256: fullPlanSha256,
      reason: "ambiguous ownership",
      locally_created_storage_objects: [object],
    }),
    (error: unknown) => {
      assert.ok(error instanceof StagingRollbackIncompleteError);
      assert.equal(error.result.ambiguousStorageObjectCount, 1);
      return true;
    },
  );
});

test("an atomic batch rejects every malformed or unreferenced raw object before external I/O", async () => {
  const unitId = createHash("sha256").update("unsafe-object-unit").digest("hex");
  const sourceSha = createHash("sha256").update("unsafe-object-source").digest("hex");
  const extraSha = createHash("sha256").update("unsafe-object-extra").digest("hex");
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{
      unit_id: unitId,
      source_fingerprint: "1".repeat(64),
      conversion_fingerprint: "2".repeat(64),
      extraction_fingerprint: "3".repeat(64),
      validation_fingerprint: "4".repeat(64),
      source_object_keys: [`${sourceSha}.pdf`],
      source_preview_keys: [],
      source_records: [{
        source_file_id: createHash("sha256").update("unsafe-source-id").digest("hex"),
        source_file: "agency/seoul/source.pdf",
        source_object_key: `${sourceSha}.pdf`,
        source_preview_key: null,
      }],
    }],
    skipped_units: [],
    raw_objects: [{
      source_path: "agency/seoul/source.pdf",
      absolute_path: "C:\\fixture\\source.pdf",
      sha256: sourceSha,
      ext: "pdf",
      bytes: 1,
      storage_path: `${sourceSha}.pdf`,
    }, {
      source_path: "agency/seoul/extra.pdf",
      absolute_path: "C:\\fixture\\extra.pdf",
      sha256: extraSha,
      ext: "pdf",
      bytes: 1,
      storage_path: "not-content-addressed.pdf",
    }],
    preview_objects: [],
    agency_packages: [{
      unit_id: unitId,
      review_status: "pending",
      needs_review: true,
      source_file: "agency/seoul/source.pdf",
      source_object_keys: [`${sourceSha}.pdf`],
      source_preview_keys: [],
      options: [],
      alias_proposals: [],
    }],
    official_prices: [],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: [],
  } as unknown as StagingLoadPlan;
  const fullPlanSha256 = stagingLoadPlanSha256(plan);
  const batchPlanSha256 = fullPlanSha256;
  const batchSha256 = canonicalSha256({
    schema_version: 1,
    batch_index: 1,
    batch_count: 1,
    full_plan_sha256: fullPlanSha256,
    unit_ids: [unitId],
    batch_plan_sha256: batchPlanSha256,
  });
  const client = {
    from: () => assert.fail("malformed object metadata must fail before snapshot I/O"),
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(client, {
      url: "https://staging-ref.supabase.co",
      key: "sb_secret_generated_fixture",
      projectRef: "staging-ref",
      bucket: "disclosure-raw",
      previewBucket: "disclosure-preview",
    }, plan, {
      target_project_ref: "staging-ref",
      run_sha256: createHash("sha256").update("unsafe-run").digest("hex"),
      full_plan_sha256: fullPlanSha256,
      batch_plan_sha256: batchPlanSha256,
      batch_sha256: batchSha256,
      batch_index: 1,
      batch_count: 1,
      unit_ids: [unitId],
      authorization_kind: "paid_pilot_gate",
      authorization_sha256: createHash("sha256").update("unsafe-paid-authorization").digest("hex"),
      local_pending_only_unit_ids: [],
      storage_claimant_id: STORAGE_TEST_CLAIMANT_ID,
      record_storage_intent: async () => assert.fail("must not journal malformed storage intent"),
      read_storage_claim: async () => assert.fail("must not read a claim for malformed storage intent"),
      record_storage_claim: async () => assert.fail("must not journal malformed storage claim"),
      record_storage_upload_started: async () => assert.fail("must not journal malformed upload start"),
      record_storage_journal: async () => assert.fail("must not journal malformed storage result"),
      record_storage_object: async () => assert.fail("must not journal malformed storage object"),
    }),
    /raw object|content-addressed|unreferenced/iu,
  );
});

test("dedupe is deferred until all immutable batch hashes are finalized by one pending-only RPC", async () => {
  const leftUnitId = createHash("sha256").update("dedupe-left").digest("hex");
  const rightUnitId = createHash("sha256").update("dedupe-right").digest("hex");
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{ unit_id: leftUnitId }, { unit_id: rightUnitId }],
    skipped_units: [],
    raw_objects: [],
    preview_objects: [],
    agency_packages: [],
    official_prices: [],
    disclosure_semantics: [],
    dedupe_candidates: [{
      entity_kind: "vendor",
      left_unit_id: leftUnitId,
      right_unit_id: rightUnitId,
      similarity: 0.95,
      reason: "review candidate",
      status: "pending",
    }],
    ai_ledger: [],
    warnings: [],
  } as unknown as StagingLoadPlan;
  plan.warnings = [
    `local_deterministic_review_only:${leftUnitId}`,
    `local_deterministic_review_only:${rightUnitId}`,
  ];
  const authorization = localAuthorizationFor(plan, [leftUnitId, rightUnitId]);
  const descriptor = createStagingRunDescriptor(
    plan,
    "staging-ref",
    STAGING_RUN_STARTED_AT,
    localBatchAuthorizationFor(authorization),
    authorization,
  );
  const completedBatchSha256s = buildStagingBatches(plan).map((batch) => batch.batch_sha256);
  const events: string[] = [];
  let rpcArgs: Record<string, unknown> | undefined;
  const client = {
    from: (table: string) => {
      assert.equal(table, "price_snapshots");
      events.push("snapshot-query");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  published: false,
                  published_at: null,
                  is_current: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      events.push("rpc");
      assert.equal(name, "finalize_vendor_disclosure_dedupe_atomic");
      rpcArgs = args;
      return { data: [{ staged_candidate_count: 1, already_finalized: false }], error: null };
    },
  } as unknown as Parameters<typeof finalizeAtomicDisclosureDedupe>[0];

  await finalizeAtomicDisclosureDedupe(client, plan, {
    target_project_ref: "staging-ref",
    run_sha256: descriptor.run_sha256,
    full_plan_sha256: descriptor.full_plan_sha256,
    dedupe_candidates_sha256: descriptor.dedupe_candidates_sha256,
    completed_batch_sha256s: completedBatchSha256s,
  });

  assert.deepEqual(events, ["snapshot-query", "rpc"]);
  assert.deepEqual(rpcArgs?.p_candidates, plan.dedupe_candidates);
  assert.deepEqual(rpcArgs?.p_completed_batch_sha256s, completedBatchSha256s);
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
    uploadPreviewObjects(client, "disclosure-preview", plan, storageOwnershipForTest()),
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
    } as StagingLoadPlan, storageOwnershipForTest()),
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
    } as StagingLoadPlan, storageOwnershipForTest()),
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
