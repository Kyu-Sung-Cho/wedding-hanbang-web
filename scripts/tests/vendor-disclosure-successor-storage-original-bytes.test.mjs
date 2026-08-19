import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  captureVendorDisclosureSuccessorStorageOriginalBytesBackup,
  downloadProductionStorageOriginalObject,
  PRODUCTION_STORAGE_BASELINE_BUCKET_IDS,
  readProductionStorageOriginalBytesInventory,
  SUCCESSOR_STORAGE_ORIGINAL_BYTES_INVENTORY_SQL,
  verifyVendorDisclosureSuccessorStorageOriginalBytesBackup,
  VendorDisclosureSuccessorStorageOriginalBytesError,
} from "../lib/vendor-disclosure-successor-storage-original-bytes.mjs";

const COMMIT = "a".repeat(40);
const PROJECT_REF = "abcdefghijklmnopqrst";
const RELEASE = "vendor-disclosure-successor-test";
const INVENTORY_SHA256 = "B".repeat(64);
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-storage-repo-"));
  const artifactRoot = await mkdtemp(join(tmpdir(), "successor-storage-artifacts-"));
  await mkdir(join(repoRoot, ".git"));
  return { repoRoot, artifactRoot };
}

const objects = [
  {
    bucketId: "chat-image",
    objectId: "11111111-1111-4111-8111-111111111111",
    name: "couple-a/secret-one.png",
    bytes: Buffer.from("first original object"),
  },
  {
    bucketId: "community-images",
    objectId: "22222222-2222-4222-8222-222222222222",
    name: "member-b/secret-two.webp",
    bytes: Buffer.from("second original object split into chunks"),
  },
];

test("streams every allowlisted original byte into a durable encrypted archive and reopens it", async () => {
  const f = await fixture();
  try {
    const result = await captureVendorDisclosureSuccessorStorageOriginalBytesBackup({
      repoRoot: f.repoRoot,
      artifactRoot: f.artifactRoot,
      expectedCommit: COMMIT,
      controllerManifest: { release: RELEASE, projectRef: PROJECT_REF },
      drain: {
        secondStableSnapshotAt: "2026-08-19T02:00:00.000Z",
        totalObjectCount: objects.length,
        objectInventorySha256: INVENTORY_SHA256,
      },
      encryptionKey: ENCRYPTION_KEY,
      backupSetId: "12345678-1234-4234-8234-123456789abc",
      now: () => new Date("2026-08-19T02:05:00.000Z"),
      inventoryReader: async () => ({
        observedAt: "2026-08-19T02:00:00.000Z",
        objectInventorySha256: INVENTORY_SHA256,
        objects: objects.map(({ bytes: _bytes, ...entry }) => entry),
      }),
      downloadObject: async ({ bucketId, name }) => {
        const object = objects.find((entry) =>
          entry.bucketId === bucketId && entry.name === name);
        return Readable.from([
          object.bytes.subarray(0, 4),
          object.bytes.subarray(4),
        ]);
      },
    });
    assert.equal(result.objectCount, objects.length);
    assert.equal(result.totalOriginalBytes,
      objects.reduce((sum, object) => sum + object.bytes.length, 0));

    const receiptText = await readFile(result.receiptPath, "utf8");
    assert.doesNotMatch(receiptText, /secret-one|secret-two|couple-a|member-b/);
    const receipt = JSON.parse(receiptText);
    assert.equal(receipt.containsSecrets, false);
    assert.equal(receipt.encryptedArtifact.sha256, result.encryptedBackupArtifactSha256);

    const verified = await verifyVendorDisclosureSuccessorStorageOriginalBytesBackup({
      repoRoot: f.repoRoot,
      receiptPath: result.receiptPath,
      encryptionKey: ENCRYPTION_KEY,
      expectedCommit: COMMIT,
      controllerManifest: { release: RELEASE, projectRef: PROJECT_REF },
      expectedDrain: {
        secondStableSnapshotAt: "2026-08-19T02:00:00.000Z",
        totalObjectCount: objects.length,
        objectInventorySha256: INVENTORY_SHA256,
      },
    });
    assert.equal(verified.objectCount, objects.length);
    assert.equal(verified.originalBytesManifestSha256,
      receipt.originalBytesManifestSha256);

    const rawText = await readFile(join(f.artifactRoot, receipt.privateRaw.fileName), "utf8");
    assert.doesNotMatch(rawText, /secret-one|secret-two/);
    assert.match(rawText, /pathSha256/);
  } finally {
    await rm(f.repoRoot, { recursive: true, force: true });
    await rm(f.artifactRoot, { recursive: true, force: true });
  }
});

test("rejects a fabricated structured receipt when raw or encrypted bytes are absent", async () => {
  const f = await fixture();
  try {
    const receiptPath = join(f.artifactRoot, "fabricated.json");
    await writeFile(receiptPath, JSON.stringify({
      receiptVersion: 2,
      kind: "successor-storage-original-bytes-backup-verification-v1",
      release: RELEASE,
      projectRef: PROJECT_REF,
      releaseCommit: COMMIT,
      checks: { encryptedArtifactVerified: true, originalByteDigestsVerified: true },
    }));
    await assert.rejects(
      verifyVendorDisclosureSuccessorStorageOriginalBytesBackup({
        repoRoot: f.repoRoot,
        receiptPath,
        encryptionKey: ENCRYPTION_KEY,
        expectedCommit: COMMIT,
        controllerManifest: { release: RELEASE, projectRef: PROJECT_REF },
        expectedDrain: {
          secondStableSnapshotAt: "2026-08-19T02:00:00.000Z",
          totalObjectCount: objects.length,
          objectInventorySha256: INVENTORY_SHA256,
        },
      }),
      (error) => error instanceof VendorDisclosureSuccessorStorageOriginalBytesError
        && error.code === "SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID",
    );
  } finally {
    await rm(f.repoRoot, { recursive: true, force: true });
    await rm(f.artifactRoot, { recursive: true, force: true });
  }
});

test("uses the official authenticated download endpoint with server-only authorization", async () => {
  const secret = "service-role-secret-that-is-long-enough-for-the-server";
  let request;
  const stream = await downloadProductionStorageOriginalObject({
    projectRef: PROJECT_REF,
    supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    serviceRoleKey: secret,
    bucketId: "chat-image",
    name: "couple id/photo one.png",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(Buffer.from("original"), { status: 200 });
    },
  });
  assert.equal(
    request.url,
    `https://${PROJECT_REF}.supabase.co/storage/v1/object/chat-image/couple%20id/photo%20one.png`,
  );
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(Buffer.concat(await Array.fromAsync(stream)).toString("utf8"), "original");
});

test("reads only the exact 12-bucket Production allowlist through the read-only Management endpoint", async () => {
  let request;
  const inventory = await readProductionStorageOriginalBytesInventory({
    projectRef: PROJECT_REF,
    accessToken: "management-access-token-long-enough",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify([{
        observed_at: "2026-08-19 02:00:00+00",
        exact_bucket_allowlist: true,
        bucket_ids: [...PRODUCTION_STORAGE_BASELINE_BUCKET_IDS],
        object_count: 1,
        object_inventory_sha256: INVENTORY_SHA256,
        objects: [{
          bucketId: "chat-image",
          name: "private/object.png",
          objectId: "11111111-1111-4111-8111-111111111111",
        }],
      }]), { status: 201 });
    },
  });
  assert.equal(
    request.url,
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`,
  );
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    query: SUCCESSOR_STORAGE_ORIGINAL_BYTES_INVENTORY_SQL,
    parameters: [],
  });
  assert.equal(inventory.observedAt, "2026-08-19T02:00:00.000Z");
  assert.equal(inventory.objects.length, 1);
});
