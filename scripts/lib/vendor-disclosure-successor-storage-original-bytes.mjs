import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_KIND =
  "successor-storage-original-bytes-backup-verification-v1";

export const PRODUCTION_STORAGE_BASELINE_BUCKET_IDS = Object.freeze([
  "chat-image",
  "cohort-images",
  "community-images",
  "community-videos",
  "disclosure-preview",
  "disclosure-raw",
  "guestbook-images",
  "guestbook-uploads",
  "invitation-photos",
  "user_photos",
  "vendor-images",
  "vendor-licenses",
]);

const BUCKET_VALUES = PRODUCTION_STORAGE_BASELINE_BUCKET_IDS
  .map((id) => `('${id}'::text)`)
  .join(",\n    ");

export const SUCCESSOR_STORAGE_ORIGINAL_BYTES_INVENTORY_SQL = `
WITH expected_buckets(id) AS (
  VALUES
    ${BUCKET_VALUES}
), actual_buckets AS (
  SELECT id::text
  FROM storage.buckets
), object_rows AS (
  SELECT
    object.bucket_id::text AS bucket_id,
    object.name::text AS name,
    object.id::text AS object_id,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(pg_catalog.to_jsonb(object)::text, 'UTF8')
      ),
      'hex'
    ) AS row_sha256
  FROM storage.objects AS object
), inventory AS (
  SELECT
    count(*)::bigint AS object_count,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          COALESCE(pg_catalog.string_agg(
            row_sha256, '' ORDER BY bucket_id, name, object_id
          ), ''),
          'UTF8'
        )
      ),
      'hex'
    ) AS object_inventory_sha256
  FROM object_rows
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  NOT EXISTS (
    (SELECT id FROM expected_buckets EXCEPT ALL SELECT id FROM actual_buckets)
    UNION ALL
    (SELECT id FROM actual_buckets EXCEPT ALL SELECT id FROM expected_buckets)
  ) AS exact_bucket_allowlist,
  (SELECT pg_catalog.jsonb_agg(id ORDER BY id) FROM actual_buckets) AS bucket_ids,
  inventory.object_count::integer AS object_count,
  upper(inventory.object_inventory_sha256) AS object_inventory_sha256,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'bucketId', row.bucket_id,
      'name', row.name,
      'objectId', row.object_id
    ) ORDER BY row.bucket_id, row.name, row.object_id)
    FROM object_rows AS row
  ), '[]'::jsonb) AS objects
FROM inventory;
`;

const MAGIC = Buffer.from("HBSTOR1\n", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_OBJECTS = 1_000_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const RELEASE = /^[a-z][a-z0-9-]{2,80}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const UPPER_SHA256 = /^[A-F0-9]{64}$/u;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.-]{2,180}$/u;
const BUCKET_SET = new Set(PRODUCTION_STORAGE_BASELINE_BUCKET_IDS);

export class VendorDisclosureSuccessorStorageOriginalBytesError extends Error {
  constructor(code) {
    super(code);
    this.name = "VendorDisclosureSuccessorStorageOriginalBytesError";
    this.code = code;
  }
}

function fail(code = "SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID") {
  throw new VendorDisclosureSuccessorStorageOriginalBytesError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function decodeKey(value) {
  if (typeof value !== "string" || value.length < 40 || value.length > 48) fail();
  const key = Buffer.from(value, "base64");
  if (key.length !== 32
      || key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) {
    fail();
  }
  return key;
}

function validateIdentity({ controllerManifest, expectedCommit, drain }) {
  if (!RELEASE.test(controllerManifest?.release ?? "")
      || !PROJECT_REF.test(controllerManifest?.projectRef ?? "")
      || !COMMIT.test(expectedCommit ?? "")
      || !Number.isFinite(Date.parse(drain?.secondStableSnapshotAt ?? ""))
      || !Number.isSafeInteger(drain?.totalObjectCount)
      || drain.totalObjectCount < 0
      || drain.totalObjectCount > MAX_OBJECTS
      || !UPPER_SHA256.test(drain?.objectInventorySha256 ?? "")) {
    fail();
  }
}

async function externalDirectory(repoRoot, target) {
  if (!isAbsolute(target) || inside(repoRoot, target)) fail();
  const metadata = await lstat(target).catch(() => null);
  const [canonicalRepo, canonicalTarget] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    metadata?.isDirectory() && !metadata.isSymbolicLink()
      ? realpath(target).catch(() => null)
      : null,
  ]);
  if (!canonicalRepo || !canonicalTarget || inside(canonicalRepo, canonicalTarget)) fail();
  return canonicalTarget;
}

async function assertRegularHandle(path, handle, expected) {
  const [handleStat, pathStat] = await Promise.all([
    handle.stat(),
    lstat(path).catch(() => null),
  ]);
  if (!handleStat.isFile() || !pathStat?.isFile() || pathStat.isSymbolicLink()
      || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino
      || (expected && (handleStat.size !== expected.size
        || String(handleStat.dev) !== expected.dev
        || String(handleStat.ino) !== expected.ino))) {
    fail();
  }
  if (process.platform !== "win32" && (handleStat.mode & 0o077) !== 0) fail();
  return handleStat;
}

async function syncParent(path) {
  if (process.platform === "win32") return;
  const handle = await open(dirname(path), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (bytesWritten < 1) fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_OUTPUT_FAILED");
    offset += bytesWritten;
  }
}

async function writeDurableExclusive(path, bytes) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await writeAll(handle, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"));
    await handle.sync();
    await assertRegularHandle(path, handle);
    await handle.close();
    handle = null;
    await syncParent(path);
  } catch {
    await handle?.close().catch(() => {});
    await unlink(path).catch(() => {});
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_OUTPUT_FAILED");
  }
}

async function hashHandle(handle, size) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < size) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (bytesRead < 1) fail();
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

function normalizeObject(entry) {
  if (!exactKeys(entry, ["bucketId", "name", "objectId"])
      || !BUCKET_SET.has(entry.bucketId)
      || !UUID.test(entry.objectId ?? "")
      || typeof entry.name !== "string"
      || entry.name.length < 1 || entry.name.length > 1024
      || entry.name.startsWith("/") || entry.name.includes("\0")) {
    fail();
  }
  return { bucketId: entry.bucketId, name: entry.name, objectId: entry.objectId.toLowerCase() };
}

function compareObjects(left, right) {
  return left.bucketId.localeCompare(right.bucketId, "en")
    || left.name.localeCompare(right.name, "en")
    || left.objectId.localeCompare(right.objectId, "en");
}

function validateInventory(value, drain) {
  const observedMs = Date.parse(value?.observedAt ?? "");
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isFinite(observedMs)
      || observedMs < Date.parse(drain.secondStableSnapshotAt)
      || value.objectInventorySha256 !== drain.objectInventorySha256
      || !Array.isArray(value.objects)
      || value.objects.length !== drain.totalObjectCount
      || value.objects.length > MAX_OBJECTS) {
    fail();
  }
  const objects = value.objects.map(normalizeObject).sort(compareObjects);
  const identities = new Set(objects.map((entry) =>
    `${entry.bucketId}\n${entry.name}\n${entry.objectId}`));
  if (identities.size !== objects.length) fail();
  return objects;
}

async function responseJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) fail();
  try {
    return JSON.parse(text);
  } catch {
    fail();
  }
}

export async function readProductionStorageOriginalBytesInventory({
  projectRef,
  accessToken,
  fetchImpl = globalThis.fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? "")
      || typeof accessToken !== "string" || accessToken.length < 20
      || typeof fetchImpl !== "function") fail();
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: SUCCESSOR_STORAGE_ORIGINAL_BYTES_INVENTORY_SQL,
          parameters: [],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail();
  }
  const body = await responseJson(response);
  const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
  if (response.status !== 201 || row?.exact_bucket_allowlist !== true
      || JSON.stringify(row.bucket_ids) !== JSON.stringify(PRODUCTION_STORAGE_BASELINE_BUCKET_IDS)
      || row.object_count !== row.objects?.length) fail();
  return {
    observedAt: new Date(row.observed_at).toISOString(),
    objectInventorySha256: row.object_inventory_sha256,
    objects: row.objects,
  };
}

export async function downloadProductionStorageOriginalObject({
  projectRef,
  supabaseUrl,
  serviceRoleKey,
  bucketId,
  name,
  fetchImpl = globalThis.fetch,
}) {
  let origin;
  try {
    origin = new URL(supabaseUrl);
  } catch {
    fail();
  }
  if (!PROJECT_REF.test(projectRef ?? "")
      || origin.protocol !== "https:"
      || origin.origin !== `https://${projectRef}.supabase.co`
      || origin.pathname !== "/" || origin.search || origin.hash
      || typeof serviceRoleKey !== "string" || serviceRoleKey.length < 40
      || !BUCKET_SET.has(bucketId)
      || typeof name !== "string" || typeof fetchImpl !== "function") fail();
  const encodedPath = name.split("/").map(encodeURIComponent).join("/");
  let response;
  try {
    response = await fetchImpl(
      new URL(`/storage/v1/object/${encodeURIComponent(bucketId)}/${encodedPath}`, origin),
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch {
    fail();
  }
  if (response.status !== 200 || !response.body) fail();
  return response.body;
}

function frameLength(length) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(length);
  return buffer;
}

async function writeCiphertext(handle, cipher, plaintext) {
  const ciphertext = cipher.update(plaintext);
  if (ciphertext.length) await writeAll(handle, ciphertext);
}

async function archiveEntries({ path, key, binding, objects, downloadObject }) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const entries = [];
  let totalBytes = 0;
  let handle;
  try {
    handle = await open(path, "wx+", 0o600);
    await writeAll(handle, Buffer.concat([MAGIC, iv]));
    await writeCiphertext(handle, cipher, Buffer.from(`${JSON.stringify({
      type: "binding",
      ...binding,
    })}\n`, "utf8"));
    for (const object of objects) {
      await writeCiphertext(handle, cipher, Buffer.from(`${JSON.stringify({
        type: "object",
        bucketId: object.bucketId,
        name: object.name,
        objectId: object.objectId,
      })}\n`, "utf8"));
      const digest = createHash("sha256");
      let size = 0;
      const stream = await downloadObject(object);
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") fail();
      for await (const value of stream) {
        const chunk = Buffer.from(value);
        for (let offset = 0; offset < chunk.length; offset += MAX_FRAME_BYTES) {
          const frame = chunk.subarray(offset, offset + MAX_FRAME_BYTES);
          await writeCiphertext(handle, cipher, frameLength(frame.length));
          await writeCiphertext(handle, cipher, frame);
          digest.update(frame);
          size += frame.length;
        }
      }
      await writeCiphertext(handle, cipher, frameLength(0));
      const byteSha256 = digest.digest("hex");
      await writeCiphertext(handle, cipher, Buffer.from(`${byteSha256}\n`, "ascii"));
      totalBytes += size;
      entries.push({
        bucketId: object.bucketId,
        objectId: object.objectId,
        pathSha256: sha256(`${object.bucketId}\n${object.name}`),
        byteSha256,
        size,
      });
    }
    await writeCiphertext(handle, cipher, Buffer.from(`${JSON.stringify({
      type: "end",
      objectCount: entries.length,
      totalOriginalBytes: totalBytes,
    })}\n`, "utf8"));
    const final = cipher.final();
    if (final.length) await writeAll(handle, final);
    await writeAll(handle, cipher.getAuthTag());
    await handle.sync();
    const metadata = await assertRegularHandle(path, handle);
    const artifactSha256 = await hashHandle(handle, metadata.size);
    await assertRegularHandle(path, handle);
    await handle.close();
    handle = null;
    await syncParent(path);
    return { entries, totalBytes, artifactSha256, metadata };
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(path).catch(() => {});
    if (error instanceof VendorDisclosureSuccessorStorageOriginalBytesError) throw error;
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_OUTPUT_FAILED");
  }
}

class AsyncByteReader {
  constructor(iterable) {
    this.iterator = iterable[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
  }

  async fill(length) {
    while (this.buffer.length < length && !this.done) {
      const next = await this.iterator.next();
      this.done = next.done === true;
      if (!this.done) this.buffer = Buffer.concat([this.buffer, Buffer.from(next.value)]);
    }
  }

  async exact(length) {
    await this.fill(length);
    if (this.buffer.length < length) fail();
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }

  async line(max = 4096) {
    while (true) {
      const newline = this.buffer.indexOf(10);
      if (newline >= 0) {
        if (newline > max) fail();
        const value = this.buffer.subarray(0, newline).toString("utf8");
        this.buffer = this.buffer.subarray(newline + 1);
        return value;
      }
      if (this.buffer.length > max || this.done) fail();
      await this.fill(this.buffer.length + 1);
    }
  }

  async eof() {
    await this.fill(this.buffer.length + 1);
    if (!this.done || this.buffer.length !== 0) fail();
  }
}

async function *decryptArchive(handle, metadata, key) {
  if (metadata.size < MAGIC.length + IV_BYTES + TAG_BYTES + 1) fail();
  const prefix = Buffer.alloc(MAGIC.length + IV_BYTES);
  const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
  if (prefixRead.bytesRead !== prefix.length
      || !prefix.subarray(0, MAGIC.length).equals(MAGIC)) fail();
  const tag = Buffer.alloc(TAG_BYTES);
  const tagRead = await handle.read(tag, 0, TAG_BYTES, metadata.size - TAG_BYTES);
  if (tagRead.bytesRead !== TAG_BYTES) fail();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    prefix.subarray(MAGIC.length),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = prefix.length;
  const end = metadata.size - TAG_BYTES;
  while (position < end) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position,
    );
    if (bytesRead < 1) fail();
    const plaintext = decipher.update(buffer.subarray(0, bytesRead));
    if (plaintext.length) yield plaintext;
    position += bytesRead;
  }
  try {
    const final = decipher.final();
    if (final.length) yield final;
  } catch {
    fail();
  }
}

async function rehearseArchive(handle, metadata, key) {
  const reader = new AsyncByteReader(decryptArchive(handle, metadata, key));
  let binding;
  try {
    binding = JSON.parse(await reader.line());
  } catch (error) {
    if (error instanceof VendorDisclosureSuccessorStorageOriginalBytesError) throw error;
    fail();
  }
  if (!exactKeys(binding, [
    "backupSetId", "objectInventorySha256", "projectRef", "release",
    "releaseCommit", "sourceInventoryCapturedAt", "type",
  ]) || binding.type !== "binding") fail();
  const entries = [];
  let totalBytes = 0;
  while (true) {
    let header;
    try {
      header = JSON.parse(await reader.line());
    } catch (error) {
      if (error instanceof VendorDisclosureSuccessorStorageOriginalBytesError) throw error;
      fail();
    }
    if (header?.type === "end") {
      if (!exactKeys(header, ["type", "objectCount", "totalOriginalBytes"])
          || header.objectCount !== entries.length
          || header.totalOriginalBytes !== totalBytes) fail();
      await reader.eof();
      return { binding, entries, totalBytes };
    }
    if (!exactKeys(header, ["bucketId", "name", "objectId", "type"])
        || header.type !== "object") fail();
    const object = normalizeObject({
      bucketId: header.bucketId,
      name: header.name,
      objectId: header.objectId,
    });
    const digest = createHash("sha256");
    let size = 0;
    while (true) {
      const length = (await reader.exact(4)).readUInt32BE(0);
      if (length === 0) break;
      if (length > MAX_FRAME_BYTES) fail();
      const bytes = await reader.exact(length);
      digest.update(bytes);
      size += bytes.length;
    }
    const declaredDigest = await reader.line(64);
    const byteSha256 = digest.digest("hex");
    if (declaredDigest !== byteSha256) fail();
    totalBytes += size;
    entries.push({
      bucketId: object.bucketId,
      objectId: object.objectId,
      pathSha256: sha256(`${object.bucketId}\n${object.name}`),
      byteSha256,
      size,
    });
    if (entries.length > MAX_OBJECTS) fail();
  }
}

async function readBoundedJsonFile(path, maximumBytes = MAX_JSON_BYTES) {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) fail();
  try {
    const before = await assertRegularHandle(path, handle);
    if (before.size < 2 || before.size > maximumBytes) fail();
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < bytes.length) {
      const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
      if (bytesRead < 1) fail();
      position += bytesRead;
    }
    const after = await assertRegularHandle(path, handle);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail();
    return { value: JSON.parse(bytes.toString("utf8")), bytes, metadata: before };
  } catch (error) {
    if (error instanceof VendorDisclosureSuccessorStorageOriginalBytesError) throw error;
    fail();
  } finally {
    await handle.close();
  }
}

function statBinding(metadata) {
  return {
    size: metadata.size,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
  };
}

export async function captureVendorDisclosureSuccessorStorageOriginalBytesBackup({
  repoRoot,
  artifactRoot,
  expectedCommit,
  controllerManifest,
  drain,
  encryptionKey,
  backupSetId,
  now = () => new Date(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  inventoryReader,
  downloadObject,
}) {
  const root = resolve(repoRoot);
  validateIdentity({ controllerManifest, expectedCommit, drain });
  if (!UUID_V4.test(backupSetId ?? "")) fail();
  const key = decodeKey(encryptionKey ?? env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const outputRoot = await externalDirectory(root, artifactRoot);
  const stem = `${controllerManifest.release}-${backupSetId}-storage-original-bytes`;
  const artifactPath = join(outputRoot, `${stem}.hbsb`);
  const rawPath = join(outputRoot, `${stem}.private.json`);
  const receiptPath = join(outputRoot, `${stem}.json`);
  if (![artifactPath, rawPath, receiptPath].every((path) =>
    dirname(path) === outputRoot && SAFE_FILE.test(basename(path)))) fail();
  if ((await Promise.all([artifactPath, rawPath, receiptPath].map((path) =>
    lstat(path).catch(() => null)))).some(Boolean)) fail();

  const inventory = await (inventoryReader
    ? inventoryReader()
    : readProductionStorageOriginalBytesInventory({
      projectRef: controllerManifest.projectRef,
      accessToken: env.SUPABASE_ACCESS_TOKEN,
      fetchImpl,
    }));
  const objects = validateInventory(inventory, drain);
  const capturedAt = now();
  if (!(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime())
      || capturedAt.getTime() < Date.parse(inventory.observedAt)) fail();
  const downloader = downloadObject ?? ((object) =>
    downloadProductionStorageOriginalObject({
      projectRef: controllerManifest.projectRef,
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl,
      ...object,
    }));

  const createdPaths = [];
  try {
    const archiveBinding = {
      release: controllerManifest.release,
      projectRef: controllerManifest.projectRef,
      releaseCommit: expectedCommit,
      backupSetId,
      sourceInventoryCapturedAt: inventory.observedAt,
      objectInventorySha256: drain.objectInventorySha256,
    };
    const archived = await archiveEntries({
      path: artifactPath,
      key,
      binding: archiveBinding,
      objects,
      downloadObject: downloader,
    });
    createdPaths.push(artifactPath);
    const artifactHandle = await open(artifactPath, "r");
    let rehearsed;
    try {
      const metadata = await assertRegularHandle(artifactPath, artifactHandle);
      rehearsed = await rehearseArchive(artifactHandle, metadata, key);
      await assertRegularHandle(artifactPath, artifactHandle);
    } finally {
      await artifactHandle.close();
    }
    if (canonicalJson(rehearsed.binding) !== canonicalJson({
      type: "binding",
      ...archiveBinding,
    })
        || canonicalJson(rehearsed.entries) !== canonicalJson(archived.entries)
        || rehearsed.totalBytes !== archived.totalBytes) fail();
    const manifestSha256 = sha256(canonicalJson(archived.entries));
    const verifiedAt = now();
    if (!(verifiedAt instanceof Date) || !Number.isFinite(verifiedAt.getTime())
        || verifiedAt.getTime() < capturedAt.getTime()) fail();
    const raw = {
      rawEvidenceVersion: 1,
      kind: "vendor-disclosure-successor-storage-original-bytes-private-v1",
      release: controllerManifest.release,
      projectRef: controllerManifest.projectRef,
      releaseCommit: expectedCommit,
      backupSetId,
      sourceInventoryCapturedAt: inventory.observedAt,
      objectInventorySha256: drain.objectInventorySha256,
      capturedAt: capturedAt.toISOString(),
      verifiedAt: verifiedAt.toISOString(),
      encryptedArtifact: {
        fileName: basename(artifactPath),
        sha256: archived.artifactSha256,
        ...statBinding(archived.metadata),
      },
      entries: archived.entries,
      totalOriginalBytes: archived.totalBytes,
      originalBytesManifestSha256: manifestSha256,
      containsObjectIdentifiers: true,
      containsObjectPaths: false,
      containsObjectBytes: false,
      containsSecrets: false,
    };
    const rawText = `${JSON.stringify(raw, null, 2)}\n`;
    await writeDurableExclusive(rawPath, rawText);
    createdPaths.push(rawPath);
    const rawMetadata = await lstat(rawPath);
    const receipt = {
      receiptVersion: 1,
      kind: SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_KIND,
      release: controllerManifest.release,
      projectRef: controllerManifest.projectRef,
      releaseCommit: expectedCommit,
      backupSetId,
      sourceInventoryCapturedAt: inventory.observedAt,
      capturedAt: capturedAt.toISOString(),
      verifiedAt: verifiedAt.toISOString(),
      bucketCount: new Set(objects.map((object) => object.bucketId)).size,
      objectCount: archived.entries.length,
      totalOriginalBytes: archived.totalBytes,
      objectInventorySha256: drain.objectInventorySha256,
      originalBytesManifestSha256: manifestSha256,
      encryptedBackupArtifactSha256: archived.artifactSha256,
      encryptedArtifact: {
        fileName: basename(artifactPath),
        sha256: archived.artifactSha256,
        ...statBinding(archived.metadata),
      },
      privateRaw: {
        fileName: basename(rawPath),
        sha256: sha256(rawText),
        ...statBinding(rawMetadata),
      },
      restoreRehearsal: {
        verifiedAt: verifiedAt.toISOString(),
        objectCount: rehearsed.entries.length,
        totalOriginalBytes: rehearsed.totalBytes,
        originalBytesManifestSha256: manifestSha256,
      },
      containsSecrets: false,
    };
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeDurableExclusive(receiptPath, receiptText);
    createdPaths.push(receiptPath);
    return Object.freeze({
      status: "successor_storage_original_bytes_backup_verified",
      receiptPath,
      receiptSha256: sha256(receiptText),
      privateRawPath: rawPath,
      privateRawSha256: receipt.privateRaw.sha256,
      encryptedArtifactPath: artifactPath,
      encryptedBackupArtifactSha256: archived.artifactSha256,
      originalBytesManifestSha256: manifestSha256,
      objectCount: archived.entries.length,
      totalOriginalBytes: archived.totalBytes,
      verifiedAt: verifiedAt.toISOString(),
      containsSecrets: false,
    });
  } catch (error) {
    for (const path of [receiptPath, rawPath, artifactPath]) {
      if (createdPaths.includes(path) || await lstat(path).catch(() => null)) {
        await unlink(path).catch(() => {});
      }
    }
    if (error instanceof VendorDisclosureSuccessorStorageOriginalBytesError) throw error;
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_OUTPUT_FAILED");
  }
}

export async function verifyVendorDisclosureSuccessorStorageOriginalBytesBackup({
  repoRoot,
  receiptPath,
  encryptionKey,
  expectedCommit,
  controllerManifest,
  expectedDrain,
}) {
  const root = resolve(repoRoot);
  validateIdentity({ controllerManifest, expectedCommit, drain: expectedDrain });
  const key = decodeKey(encryptionKey);
  if (!isAbsolute(receiptPath) || inside(root, receiptPath)) fail();
  const canonicalRoot = await externalDirectory(root, dirname(receiptPath));
  if (dirname(resolve(receiptPath)) !== canonicalRoot) fail();
  const receiptInput = await readBoundedJsonFile(receiptPath, 64 * 1024);
  const receipt = receiptInput.value;
  if (!exactKeys(receipt, [
    "backupSetId", "bucketCount", "capturedAt", "containsSecrets",
    "encryptedArtifact", "encryptedBackupArtifactSha256", "kind", "objectCount",
    "objectInventorySha256", "originalBytesManifestSha256", "privateRaw",
    "projectRef", "receiptVersion", "release", "releaseCommit", "restoreRehearsal",
    "sourceInventoryCapturedAt", "totalOriginalBytes", "verifiedAt",
  ])
      || receipt.receiptVersion !== 1
      || receipt.kind !== SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_KIND
      || receipt.release !== controllerManifest.release
      || receipt.projectRef !== controllerManifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || !UUID_V4.test(receipt.backupSetId ?? "")
      || !Number.isFinite(Date.parse(receipt.sourceInventoryCapturedAt ?? ""))
      || Date.parse(receipt.sourceInventoryCapturedAt)
        < Date.parse(expectedDrain.secondStableSnapshotAt)
      || !Number.isFinite(Date.parse(receipt.capturedAt ?? ""))
      || !Number.isFinite(Date.parse(receipt.verifiedAt ?? ""))
      || Date.parse(receipt.capturedAt) < Date.parse(receipt.sourceInventoryCapturedAt)
      || Date.parse(receipt.verifiedAt) < Date.parse(receipt.capturedAt)
      || receipt.objectInventorySha256 !== expectedDrain.objectInventorySha256
      || receipt.objectCount !== expectedDrain.totalObjectCount
      || !Number.isSafeInteger(receipt.bucketCount) || receipt.bucketCount < 0
      || !Number.isSafeInteger(receipt.totalOriginalBytes) || receipt.totalOriginalBytes < 0
      || !SHA256.test(receipt.originalBytesManifestSha256 ?? "")
      || !SHA256.test(receipt.encryptedBackupArtifactSha256 ?? "")
      || receipt.containsSecrets !== false) fail();
  for (const binding of [receipt.encryptedArtifact, receipt.privateRaw]) {
    if (!exactKeys(binding, ["dev", "fileName", "ino", "sha256", "size"])
        || !SAFE_FILE.test(binding.fileName ?? "")
        || basename(binding.fileName) !== binding.fileName
        || !SHA256.test(binding.sha256 ?? "")
        || !Number.isSafeInteger(binding.size) || binding.size < 1
        || typeof binding.dev !== "string" || typeof binding.ino !== "string") fail();
  }
  const rawPath = join(canonicalRoot, receipt.privateRaw.fileName);
  const artifactPath = join(canonicalRoot, receipt.encryptedArtifact.fileName);
  const rawInput = await readBoundedJsonFile(rawPath);
  if (sha256(rawInput.bytes) !== receipt.privateRaw.sha256
      || rawInput.metadata.size !== receipt.privateRaw.size
      || String(rawInput.metadata.dev) !== receipt.privateRaw.dev
      || String(rawInput.metadata.ino) !== receipt.privateRaw.ino) fail();
  const raw = rawInput.value;
  if (!exactKeys(raw, [
    "backupSetId", "capturedAt", "containsObjectBytes", "containsObjectIdentifiers",
    "containsObjectPaths", "containsSecrets", "encryptedArtifact", "entries", "kind",
    "objectInventorySha256", "originalBytesManifestSha256", "projectRef",
    "rawEvidenceVersion", "release", "releaseCommit", "sourceInventoryCapturedAt",
    "totalOriginalBytes", "verifiedAt",
  ])
      || raw.rawEvidenceVersion !== 1
      || raw.kind !== "vendor-disclosure-successor-storage-original-bytes-private-v1"
      || raw.release !== receipt.release || raw.projectRef !== receipt.projectRef
      || raw.releaseCommit !== receipt.releaseCommit || raw.backupSetId !== receipt.backupSetId
      || raw.sourceInventoryCapturedAt !== receipt.sourceInventoryCapturedAt
      || raw.objectInventorySha256 !== receipt.objectInventorySha256
      || raw.capturedAt !== receipt.capturedAt || raw.verifiedAt !== receipt.verifiedAt
      || canonicalJson(raw.encryptedArtifact) !== canonicalJson(receipt.encryptedArtifact)
      || !Array.isArray(raw.entries)
      || raw.entries.length !== receipt.objectCount
      || raw.originalBytesManifestSha256 !== receipt.originalBytesManifestSha256
      || raw.totalOriginalBytes !== receipt.totalOriginalBytes
      || raw.containsObjectIdentifiers !== true
      || raw.containsObjectPaths !== false || raw.containsObjectBytes !== false
      || raw.containsSecrets !== false) fail();
    const artifactHandle = await open(artifactPath, "r").catch(() => null);
  if (!artifactHandle) fail();
  try {
    const metadata = await assertRegularHandle(
      artifactPath,
      artifactHandle,
      receipt.encryptedArtifact,
    );
    const artifactSha256 = await hashHandle(artifactHandle, metadata.size);
    if (artifactSha256 !== receipt.encryptedArtifact.sha256
        || artifactSha256 !== receipt.encryptedBackupArtifactSha256) fail();
    const rehearsed = await rehearseArchive(artifactHandle, metadata, key);
    await assertRegularHandle(artifactPath, artifactHandle, receipt.encryptedArtifact);
    const manifestSha256 = sha256(canonicalJson(rehearsed.entries));
    const expectedBinding = {
      type: "binding",
      release: receipt.release,
      projectRef: receipt.projectRef,
      releaseCommit: receipt.releaseCommit,
      backupSetId: receipt.backupSetId,
      sourceInventoryCapturedAt: receipt.sourceInventoryCapturedAt,
      objectInventorySha256: receipt.objectInventorySha256,
    };
    if (canonicalJson(rehearsed.binding) !== canonicalJson(expectedBinding)
        || canonicalJson(rehearsed.entries) !== canonicalJson(raw.entries)
        || rehearsed.totalBytes !== receipt.totalOriginalBytes
        || manifestSha256 !== receipt.originalBytesManifestSha256
        || !exactKeys(receipt.restoreRehearsal, [
          "objectCount", "originalBytesManifestSha256", "totalOriginalBytes", "verifiedAt",
        ])
        || receipt.restoreRehearsal.objectCount !== rehearsed.entries.length
        || receipt.restoreRehearsal.totalOriginalBytes !== rehearsed.totalBytes
        || receipt.restoreRehearsal.originalBytesManifestSha256 !== manifestSha256
        || receipt.restoreRehearsal.verifiedAt !== receipt.verifiedAt) fail();
    return Object.freeze({
      receipt,
      receiptSha256: sha256(receiptInput.bytes),
      privateRawSha256: receipt.privateRaw.sha256,
      encryptedBackupArtifactSha256: artifactSha256,
      originalBytesManifestSha256: manifestSha256,
      objectCount: rehearsed.entries.length,
      totalOriginalBytes: rehearsed.totalBytes,
      verifiedAt: receipt.verifiedAt,
    });
  } finally {
    await artifactHandle.close();
  }
}
