import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { StagingLoadPlan, StagingStorageIntent } from "../load.js";
import {
  assertPlanSourceObjectKeys,
  storageIntentsForPlan,
  uploadPreviewObjects,
} from "../supabase-writer.js";

const RUN_SHA256 = "c".repeat(64);
const CLAIM_TOKEN = "11111111-1111-4111-8111-111111111111";
const CLAIMANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function previewPlan(
  previews: StagingLoadPlan["preview_objects"],
  rawObjects: StagingLoadPlan["raw_objects"] = [],
): StagingLoadPlan {
  return {
    raw_objects: rawObjects,
    preview_objects: previews,
  } as StagingLoadPlan;
}

test("preview transport canonicalizes repeated content addresses without changing source mappings", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-preview-transport-dedupe-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));

  const sharedContent = Buffer.from("same extracted disclosure text", "utf8");
  const otherContent = Buffer.from("another extracted disclosure text", "utf8");
  const sharedDigest = digest(sharedContent);
  const otherDigest = digest(otherContent);
  const sharedPathA = path.join(rootDir, "shared-a.txt");
  const sharedPathB = path.join(rootDir, "shared-b.txt");
  const otherPath = path.join(rootDir, "other.txt");
  await Promise.all([
    writeFile(sharedPathA, sharedContent),
    writeFile(sharedPathB, sharedContent),
    writeFile(otherPath, otherContent),
  ]);

  const previews: StagingLoadPlan["preview_objects"] = [{
    source_label: "first.pdf",
    source_object_key: `${"a".repeat(64)}.pdf`,
    absolute_path: sharedPathA,
    sha256: sharedDigest,
    bytes: sharedContent.byteLength,
    storage_path: `${sharedDigest}.txt`,
  }, {
    source_label: "second.pdf",
    source_object_key: `${"b".repeat(64)}.pdf`,
    absolute_path: sharedPathB,
    sha256: sharedDigest,
    bytes: sharedContent.byteLength,
    storage_path: `${sharedDigest}.txt`,
  }, {
    source_label: "third.pdf",
    source_object_key: `${"d".repeat(64)}.pdf`,
    absolute_path: otherPath,
    sha256: otherDigest,
    bytes: otherContent.byteLength,
    storage_path: `${otherDigest}.txt`,
  }];
  const plan = previewPlan(previews, [{
    source_path: "first.pdf",
    absolute_path: "C:\\raw\\first.pdf",
    sha256: "a".repeat(64),
    ext: "pdf",
    bytes: 1,
    storage_path: `${"a".repeat(64)}.pdf`,
  }]);
  const originalPlan = structuredClone(plan);
  const uploadedKeys: string[] = [];
  const claimed: Array<{ key: string; index: number }> = [];
  const recorded: Array<{ key: string; index: number }> = [];
  const contentByKey = new Map([
    [`${sharedDigest}.txt`, sharedContent],
    [`${otherDigest}.txt`, otherContent],
  ]);
  const client = {
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploadedKeys.push(key);
          return { data: null, error: null };
        },
        download: async (key: string) => ({
          data: new Blob([contentByKey.get(key) ?? Buffer.alloc(0)]),
          error: null,
        }),
        info: async (key: string) => {
          const content = contentByKey.get(key) ?? Buffer.alloc(0);
          return {
            data: {
              size: content.byteLength,
              metadata: {
                size: content.byteLength,
                ingest_run_sha256: RUN_SHA256,
                ingest_sha256: digest(content),
                ingest_bytes: content.byteLength,
                ingest_claim_token: CLAIM_TOKEN,
                ingest_claim_epoch: 1,
                ingest_claimant_id: CLAIMANT_ID,
              },
            },
            error: null,
          };
        },
      }),
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];

  const journal = await uploadPreviewObjects(client, "disclosure-preview", plan, {
    runSha256: RUN_SHA256,
    firstObjectIndex: 7,
    claimObject: async (object, objectIndex) => {
      claimed.push({ key: object.object_key, index: objectIndex });
      return {
        fresh: true,
        claim: {
          ...object,
          claim_token: CLAIM_TOKEN,
          claim_epoch: 1,
          claimant_id: CLAIMANT_ID,
          claim_action: "upload" as const,
          claim_expires_at: "2026-07-22T12:00:00.000Z",
        },
      };
    },
    recordClaim: async () => "claim-journal",
    startUpload: async () => ({
      uploadAttempt: 1,
      shouldUpload: true,
      journalPath: "upload-journal",
    }),
    recordObject: async (object, objectIndex) => {
      recorded.push({ key: object.object_key, index: objectIndex });
      return "object-journal";
    },
  });

  assert.deepEqual(uploadedKeys, [`${sharedDigest}.txt`, `${otherDigest}.txt`]);
  assert.deepEqual(claimed, [
    { key: `${sharedDigest}.txt`, index: 7 },
    { key: `${otherDigest}.txt`, index: 8 },
  ]);
  assert.deepEqual(recorded, claimed);
  assert.deepEqual(journal.map((object) => object.object_key), uploadedKeys);
  assert.deepEqual(plan, originalPlan);
  assert.deepEqual(
    plan.preview_objects.map((preview) => preview.source_object_key),
    [`${"a".repeat(64)}.pdf`, `${"b".repeat(64)}.pdf`, `${"d".repeat(64)}.pdf`],
  );
});

test("storage intents dedupe only preview transports in first-occurrence order", () => {
  const sharedDigest = "1".repeat(64);
  const otherDigest = "2".repeat(64);
  const plan = previewPlan([{
    source_label: "first.pdf",
    source_object_key: `${"a".repeat(64)}.pdf`,
    absolute_path: "C:\\preview\\first.txt",
    sha256: sharedDigest,
    bytes: 12,
    storage_path: `${sharedDigest}.txt`,
  }, {
    source_label: "second.pdf",
    source_object_key: `${"b".repeat(64)}.pdf`,
    absolute_path: "C:\\preview\\second.txt",
    sha256: sharedDigest,
    bytes: 12,
    storage_path: `${sharedDigest}.txt`,
  }, {
    source_label: "third.pdf",
    source_object_key: `${"d".repeat(64)}.pdf`,
    absolute_path: "C:\\preview\\third.txt",
    sha256: otherDigest,
    bytes: 8,
    storage_path: `${otherDigest}.txt`,
  }], [{
    source_path: "raw.pdf",
    absolute_path: "C:\\raw\\raw.pdf",
    sha256: "e".repeat(64),
    ext: "pdf",
    bytes: 99,
    storage_path: `${"e".repeat(64)}.pdf`,
  }]);

  assert.deepEqual(storageIntentsForPlan(plan), [{
    bucket: "disclosure-raw",
    object_key: `${"e".repeat(64)}.pdf`,
    sha256: "e".repeat(64),
    bytes: 99,
  }, {
    bucket: "disclosure-preview",
    object_key: `${sharedDigest}.txt`,
    sha256: sharedDigest,
    bytes: 12,
  }, {
    bucket: "disclosure-preview",
    object_key: `${otherDigest}.txt`,
    sha256: otherDigest,
    bytes: 8,
  }]);
});

test("conflicting duplicate preview metadata fails before transport I/O", async () => {
  const previewSha = "3".repeat(64);
  const plan = previewPlan([{
    source_label: "first.pdf",
    source_object_key: `${"a".repeat(64)}.pdf`,
    absolute_path: "C:\\missing\\first.txt",
    sha256: previewSha,
    bytes: 12,
    storage_path: `${previewSha}.txt`,
  }, {
    source_label: "second.pdf",
    source_object_key: `${"b".repeat(64)}.pdf`,
    absolute_path: "C:\\missing\\second.txt",
    sha256: previewSha,
    bytes: 13,
    storage_path: `${previewSha}.txt`,
  }]);
  let storageCalls = 0;
  let claimCalls = 0;
  const client = {
    storage: {
      from: () => {
        storageCalls += 1;
        return {};
      },
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];
  const ownership = {
    runSha256: RUN_SHA256,
    firstObjectIndex: 1,
    claimObject: async (_object: StagingStorageIntent, _index: number) => {
      claimCalls += 1;
      throw new Error("claim must not run");
    },
    recordClaim: async () => "claim-journal",
    startUpload: async () => ({ uploadAttempt: 1, shouldUpload: true, journalPath: "upload" }),
    recordObject: async () => "object-journal",
  };

  assert.throws(() => storageIntentsForPlan(plan), /duplicate.*preview.*metadata|conflicting.*preview/iu);
  await assert.rejects(
    uploadPreviewObjects(client, "disclosure-preview", plan, ownership),
    /duplicate.*preview.*metadata|conflicting.*preview/iu,
  );
  assert.equal(storageCalls, 0);
  assert.equal(claimCalls, 0);
});

test("duplicate preview paths with different local bytes fail before transport I/O", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-preview-transport-conflict-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const expected = Buffer.from("content-a", "utf8");
  const conflicting = Buffer.from("content-b", "utf8");
  const expectedSha = digest(expected);
  const firstPath = path.join(rootDir, "first.txt");
  const secondPath = path.join(rootDir, "second.txt");
  await Promise.all([writeFile(firstPath, expected), writeFile(secondPath, conflicting)]);
  const plan = previewPlan([{
    source_label: "first.pdf",
    source_object_key: `${"a".repeat(64)}.pdf`,
    absolute_path: firstPath,
    sha256: expectedSha,
    bytes: expected.byteLength,
    storage_path: `${expectedSha}.txt`,
  }, {
    source_label: "second.pdf",
    source_object_key: `${"b".repeat(64)}.pdf`,
    absolute_path: secondPath,
    sha256: expectedSha,
    bytes: expected.byteLength,
    storage_path: `${expectedSha}.txt`,
  }]);
  let storageCalls = 0;
  let claimCalls = 0;
  const client = {
    storage: {
      from: () => {
        storageCalls += 1;
        return {};
      },
    },
  } as unknown as Parameters<typeof uploadPreviewObjects>[0];

  await assert.rejects(
    uploadPreviewObjects(client, "disclosure-preview", plan, {
      runSha256: RUN_SHA256,
      firstObjectIndex: 1,
      claimObject: async () => {
        claimCalls += 1;
        throw new Error("claim must not run");
      },
      recordClaim: async () => "claim-journal",
      startUpload: async () => ({ uploadAttempt: 1, shouldUpload: true, journalPath: "upload" }),
      recordObject: async () => "object-journal",
    }),
    /hash|content-address|identity/iu,
  );
  assert.equal(storageCalls, 0);
  assert.equal(claimCalls, 0);
});

function previewProvenancePlan(options: {
  includeLocalOccurrence: boolean;
  sourceRecordRawKey?: string;
}): StagingLoadPlan {
  const unitId = "9".repeat(64);
  const primaryRawSha = "a".repeat(64);
  const secondaryRawSha = "b".repeat(64);
  const foreignRawSha = "f".repeat(64);
  const primaryRawKey = `${primaryRawSha}.pdf`;
  const secondaryRawKey = `${secondaryRawSha}.pdf`;
  const foreignRawKey = `${foreignRawSha}.pdf`;
  const sourceRecordRawKey = options.sourceRecordRawKey ?? primaryRawKey;
  const previewSha = "4".repeat(64);
  const previewKey = `${previewSha}.txt`;
  const sourceRecords = [{
    source_file_id: "primary-source-id",
    source_file: "primary.pdf",
    source_object_key: primaryRawKey,
    source_preview_key: sourceRecordRawKey === primaryRawKey ? previewKey : null,
  }, {
    source_file_id: "secondary-source-id",
    source_file: "secondary.pdf",
    source_object_key: secondaryRawKey,
    source_preview_key: sourceRecordRawKey === secondaryRawKey ? previewKey : null,
  }];
  const selectedRecord = sourceRecords.find((record) => record.source_object_key === sourceRecordRawKey);
  assert.ok(selectedRecord);
  const previews: StagingLoadPlan["preview_objects"] = [{
    source_label: "foreign.pdf",
    source_object_key: foreignRawKey,
    absolute_path: "C:\\preview\\foreign.txt",
    sha256: previewSha,
    bytes: 10,
    storage_path: previewKey,
  }];
  if (options.includeLocalOccurrence) {
    previews.unshift({
      source_label: "primary.pdf",
      source_object_key: primaryRawKey,
      absolute_path: "C:\\preview\\primary.txt",
      sha256: previewSha,
      bytes: 10,
      storage_path: previewKey,
    });
  }
  return {
    schema_version: 2,
    snapshot: "2026Q3",
    snapshot_source: "kca_tprice",
    units: [{
      unit_id: unitId,
      source_object_keys: [primaryRawKey, secondaryRawKey],
      source_preview_keys: [previewKey],
      source_records: sourceRecords,
    }],
    skipped_units: [],
    raw_objects: [primaryRawSha, secondaryRawSha].map((sha, index) => ({
      source_path: index === 0 ? "primary.pdf" : "secondary.pdf",
      absolute_path: index === 0 ? "C:\\raw\\primary.pdf" : "C:\\raw\\secondary.pdf",
      sha256: sha,
      ext: "pdf",
      bytes: 20,
      storage_path: `${sha}.pdf`,
    })),
    preview_objects: previews,
    agency_packages: [{
      unit_id: unitId,
      source_file: selectedRecord.source_file,
      source_object_keys: [sourceRecordRawKey],
      source_preview_keys: [previewKey],
      options: [],
    }],
    official_prices: [],
    disclosure_semantics: [],
    dedupe_candidates: [],
    ai_ledger: [],
    warnings: [],
  } as unknown as StagingLoadPlan;
}

test("a foreign preview occurrence is allowed only beside an identical local occurrence", () => {
  const plan = previewProvenancePlan({ includeLocalOccurrence: true });
  const original = structuredClone(plan);

  assert.doesNotThrow(() => assertPlanSourceObjectKeys(plan));
  assert.deepEqual(plan, original);

  const foreignOnly = previewProvenancePlan({ includeLocalOccurrence: false });
  assert.throws(
    () => assertPlanSourceObjectKeys(foreignOnly),
    /foreign preview occurrence.*locally backed/iu,
  );
});

test("current unit and row preview provenance must retain an occurrence for their own raw key", () => {
  const plan = previewProvenancePlan({
    includeLocalOccurrence: true,
    sourceRecordRawKey: `${"b".repeat(64)}.pdf`,
  });

  assert.throws(
    () => assertPlanSourceObjectKeys(plan),
    /unit.*preview|source_preview_keys.*backed|canonical preview/iu,
  );
});
