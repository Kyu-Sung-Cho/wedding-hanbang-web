import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  captureStorageSignedUploadDrainEvidence,
  STORAGE_INVENTORY_READ_ONLY_SQL,
  StorageDrainEvidenceError,
} from "../lib/storage-signed-upload-drain-evidence.mjs";

const COMMIT = "a".repeat(40);
const PROJECT_REF = "abcdefghijklmnopqrst";
const APPLY_SQL = "select 'freeze';\n";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "storage-drain-repo-"));
  const receipts = await mkdtemp(join(tmpdir(), "storage-drain-receipts-"));
  const manifestPath = join(
    root,
    "supabase/release-manifests/amora-engine-v2-20260716.json",
  );
  await mkdir(dirname(manifestPath), { recursive: true });
  const manifest = {
    release: "test-release",
    projectRef: PROJECT_REF,
    manualPlatformOperations: [{
      id: "storage-global-write-freeze-20260716108000",
      phase: "pre-backup",
      verificationCheckId: "storage-global-write-freeze-verify-20260716108000",
      sha256: sha256(APPLY_SQL),
    }],
    manualControlEvidence: {
      maximumAgeMinutes: 30,
      storageDrainReceiptFileName: "test-storage-signed-upload-drain.json",
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return { root, receipts, manifest };
}

function response(observedAt, { count = 49, hash = "B".repeat(64), policies = 0 } = {}) {
  return new Response(JSON.stringify([{
    observed_at: observedAt,
    total_object_count: count,
    object_inventory_sha256: hash,
    mutation_policy_count: policies,
    public_table_count: 73,
    production_write_fence_trigger_count: 73,
    production_write_fence_guard_function_count: 1,
    production_write_fence_attach_function_count: 1,
    production_live_schema_contract_function_count: 1,
    production_write_fence_event_trigger_count: 2,
  }]), { status: 201, headers: { "content-type": "application/json" } });
}

function controlResponse(url, expectedCommit = COMMIT) {
  if (String(url).endsWith("/config/auth")) {
    return new Response(JSON.stringify({ disable_signup: true }), { status: 200 });
  }
  if (String(url).endsWith("/api/release/write-fence-probe")) {
    return new Response(JSON.stringify({ error: "production_write_fence_enabled" }), {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
        "x-hanbang-deployment-commit": expectedCommit,
      },
    });
  }
  return null;
}

test("captures immutable database-clock drain stages after 130m plus 5m stability", async () => {
  const f = await fixture();
  const times = [
    "2026-07-17T00:00:00.000Z",
    "2026-07-17T02:10:00.000Z",
    "2026-07-17T02:15:00.000Z",
  ];
  let index = 0;
  const fetchImpl = async (url, init) => {
    const control = controlResponse(url);
    if (control) return control;
    assert.equal(
      url,
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`,
    );
    assert.equal(init.method, "POST");
    assert.match(init.headers.Authorization, /^Bearer /);
    const body = JSON.parse(init.body);
    assert.equal(body.query, STORAGE_INVENTORY_READ_ONLY_SQL);
    assert.deepEqual(body.parameters, []);
    return response(times[index]);
  };
  const run = async (stage) => {
    const current = times[index];
    const result = await captureStorageSignedUploadDrainEvidence({
      repoRoot: f.root,
      expectedCommit: COMMIT,
      receiptDirectory: f.receipts,
      siteUrl: stage === "start" ? "https://hanbang.example" : undefined,
      stage,
      env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
      fetchImpl,
      now: () => new Date(current),
    });
    index += 1;
    return result;
  };
  const start = await run("start");
  assert.equal(start.status, "waiting_signed_upload_expiry");
  assert.equal(start.controls.vercelDeploymentCommit, COMMIT);
  assert.equal(start.databaseWriteFence.triggerCount, 73);
  assert.equal(start.databaseWriteFence.liveSchemaContractFunctionCount, 1);
  assert.equal(start.databaseWriteFence.eventTriggerCount, 2);
  assert.equal((await run("first")).status, "waiting_inventory_stability");
  const final = await run("final");
  assert.equal(final.status, "storage_signed_upload_drain_verified");
  assert.equal(final.totalObjectCount, 49);
  assert.equal(final.freezeVerifiedAt, times[0]);
  assert.equal(final.firstStableSnapshotAt, times[1]);
  assert.equal(final.secondStableSnapshotAt, times[2]);
  assert.match(final.startReceiptSha256, /^[A-F0-9]{64}$/);
  assert.match(final.firstSnapshotReceiptSha256, /^[A-F0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(final), /Bearer|xxxxxxxxxxxxxxxxxxxxxxxx/i);

  const persisted = JSON.parse(await readFile(
    join(f.receipts, f.manifest.manualControlEvidence.storageDrainReceiptFileName),
    "utf8",
  ));
  assert.equal(persisted.stage, "verified");
});

test("captures against an explicitly supplied successor manifest without reading the predecessor path", async () => {
  const f = await fixture();
  const successor = structuredClone(f.manifest);
  successor.release = "vendor-disclosure-successor-test";
  successor.manualPlatformOperations[0].id =
    "vendor-disclosure-successor-storage-write-freeze-v1";
  const result = await captureStorageSignedUploadDrainEvidence({
    repoRoot: f.root,
    expectedCommit: COMMIT,
    receiptDirectory: f.receipts,
    siteUrl: "https://hanbang.example",
    stage: "start",
    releaseManifest: successor,
    env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
    fetchImpl: async (url) => controlResponse(url) ?? response(
      "2026-07-17T00:00:00.000Z",
    ),
    now: () => new Date("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(result.release, successor.release);
  assert.equal(result.operation.operationId, successor.manualPlatformOperations[0].id);
});

test("fails closed before signed URL expiry plus grace", async () => {
  const f = await fixture();
  const observations = [
    "2026-07-17T00:00:00.000Z",
    "2026-07-17T02:09:59.999Z",
  ];
  let index = 0;
  const run = async (stage) => {
    const current = observations[index];
    await captureStorageSignedUploadDrainEvidence({
      repoRoot: f.root,
      expectedCommit: COMMIT,
      receiptDirectory: f.receipts,
      siteUrl: stage === "start" ? "https://hanbang.example" : undefined,
      stage,
      env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
      fetchImpl: async (url) => controlResponse(url) ?? response(observations[index]),
      now: () => new Date(current),
    });
    index += 1;
  };
  await run("start");
  await assert.rejects(
    run("first"),
    (error) => error instanceof StorageDrainEvidenceError
      && error.code === "STORAGE_DRAIN_WAIT_INCOMPLETE",
  );
});

test("fails closed when the two post-expiry object inventories differ", async () => {
  const f = await fixture();
  const observations = [
    { at: "2026-07-17T00:00:00.000Z", count: 49 },
    { at: "2026-07-17T02:10:00.000Z", count: 49 },
    { at: "2026-07-17T02:15:00.000Z", count: 50 },
  ];
  let index = 0;
  const run = async (stage) => {
    const current = observations[index];
    const promise = captureStorageSignedUploadDrainEvidence({
      repoRoot: f.root,
      expectedCommit: COMMIT,
      receiptDirectory: f.receipts,
      siteUrl: stage === "start" ? "https://hanbang.example" : undefined,
      stage,
      env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
      fetchImpl: async (url) => controlResponse(url)
        ?? response(current.at, { count: current.count }),
      now: () => new Date(current.at),
    });
    index += 1;
    return await promise;
  };
  await run("start");
  await run("first");
  await assert.rejects(
    run("final"),
    (error) => error instanceof StorageDrainEvidenceError
      && error.code === "STORAGE_DRAIN_INVENTORY_CHANGED",
  );
});

test("start fails closed unless Auth, web and the exact public DB fence are all active", async () => {
  for (const scenario of ["auth-open", "web-open", "wrong-commit", "db-trigger-gap"]) {
    const f = await fixture();
    await assert.rejects(
      captureStorageSignedUploadDrainEvidence({
        repoRoot: f.root,
        expectedCommit: COMMIT,
        receiptDirectory: f.receipts,
        siteUrl: "https://hanbang.example",
        stage: "start",
        env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
        now: () => new Date("2026-07-17T00:00:00.000Z"),
        fetchImpl: async (url) => {
          if (String(url).endsWith("/config/auth")) {
            return new Response(JSON.stringify({
              disable_signup: scenario !== "auth-open",
            }), { status: 200 });
          }
          if (String(url).endsWith("/api/release/write-fence-probe")) {
            return new Response(JSON.stringify({
              error: scenario === "web-open"
                ? "not_fenced"
                : "production_write_fence_enabled",
            }), {
              status: scenario === "web-open" ? 200 : 503,
              headers: {
                "cache-control": "no-store",
                "x-hanbang-deployment-commit": scenario === "wrong-commit"
                  ? "b".repeat(40)
                  : COMMIT,
              },
            });
          }
          const row = JSON.parse(await response(
            "2026-07-17T00:00:00.000Z",
          ).text());
          if (scenario === "db-trigger-gap") {
            row[0].production_write_fence_trigger_count -= 1;
          }
          return new Response(JSON.stringify(row), { status: 201 });
        },
      }),
      (error) => error instanceof StorageDrainEvidenceError
        && [
          "STORAGE_DRAIN_GLOBAL_CONTROLS_NOT_VERIFIED",
          "STORAGE_DRAIN_QUERY_RESULT_INVALID",
        ].includes(error.code),
      scenario,
    );
  }
});
