import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalSha256 } from "../gate-integrity.js";
import {
  stagingLoadPlanSha256,
  type StagingBatchWriteContext,
  type StagingLoadPlan,
} from "../load.js";
import { assertPendingOnlyBatch, stageAtomicDisclosureBatch } from "../supabase-writer.js";

const UNIT_ID = createHash("sha256").update("local-identity-marker-compat").digest("hex");
const SOURCE_FILE = "venue/seoul/local-identity-marker.pdf";
const STORAGE_CLAIMANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function localCompatibilityFixture(t: TestContext) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-identity-marker-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const rawPath = path.join(rootDir, "source.pdf");
  const previewPath = path.join(rootDir, "source.txt");
  const rawContent = Buffer.from("immutable raw source");
  const previewContent = Buffer.from("Sheet1!A1: venue fee 1,000,000 won", "utf8");
  await writeFile(rawPath, rawContent);
  await writeFile(previewPath, previewContent);
  const rawSha256 = createHash("sha256").update(rawContent).digest("hex");
  const previewSha256 = createHash("sha256").update(previewContent).digest("hex");
  const sourceObjectKey = `${rawSha256}.pdf`;
  const previewObjectKey = `${previewSha256}.txt`;
  const sourceFileId = createHash("sha256").update("local-identity-source").digest("hex");
  const plan = {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{
      unit_id: UNIT_ID,
      source_fingerprint: "1".repeat(64),
      conversion_fingerprint: "2".repeat(64),
      extraction_fingerprint: "3".repeat(64),
      validation_fingerprint: "4".repeat(64),
      kind_hint: "hall",
      raw_name: "Local Compatibility Venue",
      normalized_name: "localcompatibilityvenue",
      corporate_name: null,
      region_code: "seoul",
      validation_issue_codes: [
        "identity_only_no_price",
        "local_deterministic_review_only",
        "visual_transcription_human_confirmed_pending_admin_review",
      ],
      source_object_keys: [sourceObjectKey],
      source_preview_keys: [previewObjectKey],
      source_records: [{
        source_file_id: sourceFileId,
        source_file: SOURCE_FILE,
        source_object_key: sourceObjectKey,
        source_preview_key: previewObjectKey,
      }],
      data: {
        doc_kind: "venue_disclosure",
        agency_packages: [],
        partner_vendors: [],
        sections: [],
        hall: null,
      },
    }],
    skipped_units: [],
    raw_objects: [{
      source_path: SOURCE_FILE,
      absolute_path: rawPath,
      sha256: rawSha256,
      ext: "pdf",
      bytes: rawContent.byteLength,
      storage_path: sourceObjectKey,
    }],
    preview_objects: [{
      source_label: "local-identity-marker.pdf",
      source_object_key: sourceObjectKey,
      absolute_path: previewPath,
      sha256: previewSha256,
      bytes: previewContent.byteLength,
      storage_path: previewObjectKey,
    }],
    agency_packages: [],
    official_prices: [{
      unit_id: UNIT_ID,
      vendor_name: "Local Compatibility Venue",
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: "seoul",
      item_name: "Main hall",
      base_spec: null,
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: true,
      validation_issue_codes: [
        "identity_only_no_price",
        "local_deterministic_review_only",
        "visual_transcription_human_confirmed_pending_admin_review",
      ],
      source_file: SOURCE_FILE,
      source_object_keys: [sourceObjectKey],
      source_preview_keys: [previewObjectKey],
      source_quote: "Sheet1!A1: venue fee 1,000,000 won",
      confidence: 0.95,
      source_record_key: createHash("sha256").update("local-identity-price-row").digest("hex"),
    }],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: [`local_deterministic_review_only:${UNIT_ID}`],
  } as unknown as StagingLoadPlan;
  return plan;
}

function writeContext(
  plan: StagingLoadPlan,
  authorizationKind: "paid_pilot_gate" | "local_validated_pending_only",
): StagingBatchWriteContext {
  const fullPlanSha256 = stagingLoadPlanSha256(plan);
  return {
    target_project_ref: "staging-ref",
    run_sha256: createHash("sha256").update("local-identity-run").digest("hex"),
    full_plan_sha256: fullPlanSha256,
    batch_plan_sha256: fullPlanSha256,
    batch_sha256: canonicalSha256({
      schema_version: 1,
      batch_index: 1,
      batch_count: 1,
      full_plan_sha256: fullPlanSha256,
      unit_ids: [UNIT_ID],
      batch_plan_sha256: fullPlanSha256,
    }),
    batch_index: 1,
    batch_count: 1,
    unit_ids: [UNIT_ID],
    authorization_kind: authorizationKind,
    authorization_sha256: createHash("sha256").update(`authorization:${authorizationKind}`).digest("hex"),
    local_pending_only_unit_ids: authorizationKind === "local_validated_pending_only" ? [UNIT_ID] : [],
    storage_claimant_id: STORAGE_CLAIMANT_ID,
    record_storage_intent: async () => "unreachable-storage-intent",
    read_storage_claim: async () => null,
    record_storage_claim: async () => "unreachable-storage-claim",
    record_storage_upload_started: async () => ({
      uploadAttempt: 1,
      shouldUpload: true,
      journalPath: "unreachable-upload-start",
    }),
    record_storage_journal: async () => "unreachable-storage-journal",
    record_storage_object: async () => "unreachable-storage-object",
  };
}

const environment = {
  url: "https://staging-ref.supabase.co",
  key: "sb_secret_generated_fixture",
  projectRef: "staging-ref",
  bucket: "disclosure-raw",
  previewBucket: "disclosure-preview",
} as const;

test("local pending-only staging accepts a structured price with the stale identity marker only at the safe review boundary", async (t) => {
  const plan = await localCompatibilityFixture(t);
  let reachedSnapshotBoundary = false;
  const client = {
    from: () => {
      reachedSnapshotBoundary = true;
      throw new Error("snapshot boundary reached");
    },
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(
      client,
      environment,
      plan,
      writeContext(plan, "local_validated_pending_only"),
    ),
    /snapshot boundary reached/iu,
  );
  assert.equal(reachedSnapshotBoundary, true);
});

test("the default pending-only assertion remains strict for a structured price with the stale identity marker", async (t) => {
  const plan = await localCompatibilityFixture(t);

  assert.throws(
    () => assertPendingOnlyBatch(plan),
    /identity_only_no_price.*structured price/iu,
  );
});

test("paid staging remains strict for a structured price with the stale identity marker", async (t) => {
  const plan = await localCompatibilityFixture(t);
  const client = {
    from: () => assert.fail("paid compatibility rejection must happen before external I/O"),
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(client, environment, plan, writeContext(plan, "paid_pilot_gate")),
    /identity_only_no_price.*structured price/iu,
  );
});

test("local staging rejects the stale marker compatibility when the structured price is not review-only", async (t) => {
  const plan = await localCompatibilityFixture(t);
  plan.official_prices[0]!.needs_review = false;
  const client = {
    from: () => assert.fail("unsafe local row must be rejected before external I/O"),
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(
      client,
      environment,
      plan,
      writeContext(plan, "local_validated_pending_only"),
    ),
    /identity_only_no_price.*structured price/iu,
  );
});

test("local staging rejects the stale marker compatibility without the deterministic review-only marker", async (t) => {
  const plan = await localCompatibilityFixture(t);
  plan.official_prices[0]!.validation_issue_codes = plan.official_prices[0]!.validation_issue_codes
    .filter((issue) => issue !== "local_deterministic_review_only");
  const client = {
    from: () => assert.fail("unmarked local row must be rejected before external I/O"),
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(
      client,
      environment,
      plan,
      writeContext(plan, "local_validated_pending_only"),
    ),
    /identity_only_no_price.*structured price/iu,
  );
});

test("local staging rejects the stale marker compatibility without human-confirmed visual transcription", async (t) => {
  const plan = await localCompatibilityFixture(t);
  plan.official_prices[0]!.validation_issue_codes = plan.official_prices[0]!.validation_issue_codes
    .filter((issue) => issue !== "visual_transcription_human_confirmed_pending_admin_review");
  const client = {
    from: () => assert.fail("unconfirmed visual transcription must be rejected before external I/O"),
  } as unknown as Parameters<typeof stageAtomicDisclosureBatch>[0];

  await assert.rejects(
    stageAtomicDisclosureBatch(
      client,
      environment,
      plan,
      writeContext(plan, "local_validated_pending_only"),
    ),
    /identity_only_no_price.*structured price/iu,
  );
});
