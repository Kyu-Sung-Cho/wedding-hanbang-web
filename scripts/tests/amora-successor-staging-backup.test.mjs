import assert from "node:assert/strict";
import { createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  assertSuccessorStagingBackupPlan,
  assertSuccessorStagingMigrationLedger,
  assertSupabaseRootCertificate,
  createEncryptedBackupFile,
  createEncryptedBackupStream,
  parseSupabaseTemporaryDatabaseCredentials,
  verifyEncryptedBackupFile,
  verifyEncryptedBackupStream,
} from "../lib/amora-successor-staging-backup.mjs";

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "b2b5c4a64e304135d3dcf88bcec868502744f20d";

test("staging database TLS uses the exact pinned Supabase root certificate", async () => {
  const certificate = await readFile(new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url));
  assert.match(assertSupabaseRootCertificate(certificate), /^-----BEGIN CERTIFICATE-----/);
  assert.match(
    assertSupabaseRootCertificate(Buffer.from(certificate.toString("utf8").replace(/\n/g, "\r\n"), "utf8")),
    /^-----BEGIN CERTIFICATE-----/,
  );
  const tampered = Buffer.from(certificate);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => assertSupabaseRootCertificate(tampered));
});

test("staging backup accepts only the exact ordered CLI migration ledger", () => {
  assert.deepEqual(assertSuccessorStagingMigrationLedger({
    expectedHead: "20260727090000",
    expectedCount: 3,
    remoteVersions: ["20260726090000", "20260727080000", "20260727090000"],
    remoteOnlyVersions: [],
  }), {
    migrationHead: "20260727090000",
    migrationCount: 3,
  });
  for (const patch of [
    { remoteVersions: ["20260726090000", "20260727090000", "20260727080000"] },
    { remoteVersions: ["20260726090000", "20260727090000", "20260727090000"] },
    { remoteVersions: ["20260726090000", "20260727080000"] },
    { remoteOnlyVersions: ["20260727090000"] },
  ]) {
    assert.throws(() => assertSuccessorStagingMigrationLedger({
      expectedHead: "20260727090000",
      expectedCount: 3,
      remoteVersions: ["20260726090000", "20260727080000", "20260727090000"],
      remoteOnlyVersions: [],
      ...patch,
    }));
  }
});

function validPlan(overrides = {}) {
  return {
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    expectedCommit: COMMIT,
    actualCommit: COMMIT,
    originCommit: COMMIT,
    trackedWorktreeClean: true,
    migrationHead: "20260727090000",
    expectedMigrationHead: "20260727090000",
    migrationCount: 147,
    expectedMigrationCount: 147,
    tables: [
      { name: "chat_messages", columns: ["id", "content"] },
      { name: "profiles", columns: ["id", "display_name"] },
    ],
    ...overrides,
  };
}

test("staging backup plan is bound to a clean exact non-production commit and inventory", () => {
  const plan = assertSuccessorStagingBackupPlan(validPlan());
  assert.equal(plan.projectRef, STAGING_REF);
  assert.equal(plan.tables.length, 2);

  for (const patch of [
    { projectRef: PRODUCTION_REF },
    { actualCommit: "a".repeat(40) },
    { originCommit: "b".repeat(40) },
    { trackedWorktreeClean: false },
    { migrationHead: "20260716117000" },
    { migrationCount: 146 },
    { tables: [] },
    { tables: [{ name: "profiles", columns: ["id"] }, { name: "profiles", columns: ["id"] }] },
    { tables: [{ name: "profiles", columns: ["id", "id"] }] },
  ]) {
    assert.throws(() => assertSuccessorStagingBackupPlan(validPlan(patch)));
  }
});

test("temporary database credentials are parsed in memory and fenced to the staging ref", () => {
  const script = `export PGHOST="aws-1-ap-northeast-2.pooler.supabase.com"
export PGPORT="5432"
export PGUSER="cli_login_postgres.${STAGING_REF}"
export PGPASSWORD="temporary-password-123456789"
export PGDATABASE="postgres"
pg_dump \\
    --data-only \\
    --role "postgres" \\`;
  const credentials = parseSupabaseTemporaryDatabaseCredentials(script, STAGING_REF);
  assert.equal(credentials.host, "aws-1-ap-northeast-2.pooler.supabase.com");
  assert.equal(credentials.user, `cli_login_postgres.${STAGING_REF}`);
  assert.equal(credentials.password, "temporary-password-123456789");

  assert.throws(() => parseSupabaseTemporaryDatabaseCredentials(
    script.replace(STAGING_REF, PRODUCTION_REF),
    STAGING_REF,
  ));
  assert.throws(() => parseSupabaseTemporaryDatabaseCredentials(
    script.replace("pooler.supabase.com", "attacker.example"),
    STAGING_REF,
  ));
  assert.throws(() => parseSupabaseTemporaryDatabaseCredentials(
    script.replace("temporary-password-123456789", "bad password"),
    STAGING_REF,
  ));
  assert.throws(() => parseSupabaseTemporaryDatabaseCredentials(
    script.replace('    --role "postgres" \\', ""),
    STAGING_REF,
  ));
});

test("encrypted staging backup verifies exact table order, rows and terminal receipt", async () => {
  const key = randomBytes(32);
  const plan = assertSuccessorStagingBackupPlan(validPlan());
  const lines = [
    { kind: "header", version: 1, projectRef: STAGING_REF, commit: COMMIT },
    { kind: "table", name: "chat_messages", columns: ["id", "content"] },
    {
      kind: "row",
      table: "chat_messages",
      valueJson: '{"id":9007199254740993,"content":"hello"}',
    },
    { kind: "table_end", name: "chat_messages", rowCount: 1 },
    { kind: "table", name: "profiles", columns: ["id", "display_name"] },
    { kind: "row", table: "profiles", valueJson: '{"id":"p1","display_name":"A"}' },
    { kind: "table_end", name: "profiles", rowCount: 1 },
    { kind: "footer", tableCount: 2, rowCount: 2 },
  ];
  const encrypted = await createEncryptedBackupStream({ key, lines });
  const receipt = await verifyEncryptedBackupStream({ key, encrypted, plan });

  assert.deepEqual(receipt.tableRows, {
    chat_messages: 1,
    profiles: 1,
  });
  assert.equal(receipt.totalRows, 2);
  assert.equal(receipt.verified, true);

  const tampered = Buffer.from(encrypted.ciphertext);
  tampered[Math.floor(tampered.length / 2)] ^= 1;
  await assert.rejects(() => verifyEncryptedBackupStream({
    key,
    encrypted: { ...encrypted, ciphertext: tampered },
    plan,
  }));

  const duplicateTable = await createEncryptedBackupStream({
    key,
    lines: [
      lines[0],
      lines[1],
      lines[3],
      lines[1],
      lines[3],
      { kind: "footer", tableCount: 2, rowCount: 0 },
    ],
  });
  await assert.rejects(() => verifyEncryptedBackupStream({ key, encrypted: duplicateTable, plan }));

  const wrongCount = await createEncryptedBackupStream({
    key,
    lines: lines.map((line) => line.kind === "footer" ? { ...line, rowCount: 3 } : line),
  });
  await assert.rejects(() => verifyEncryptedBackupStream({ key, encrypted: wrongCount, plan }));
});

test("streaming backup writes ciphertext only and authenticates the file before parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amora-successor-backup-"));
  const path = join(directory, "logical-data.ndjson.gz.aesgcm");
  const key = randomBytes(32);
  const plan = assertSuccessorStagingBackupPlan(validPlan());
  const lines = [
    { kind: "header", version: 1, projectRef: STAGING_REF, commit: COMMIT },
    { kind: "table", name: "chat_messages", columns: ["id", "content"] },
    {
      kind: "row",
      table: "chat_messages",
      valueJson: '{"id":9007199254740993,"content":"private"}',
    },
    { kind: "table_end", name: "chat_messages", rowCount: 1 },
    { kind: "table", name: "profiles", columns: ["id", "display_name"] },
    { kind: "table_end", name: "profiles", rowCount: 0 },
    { kind: "footer", tableCount: 2, rowCount: 1 },
  ];

  try {
    async function* source() {
      for (const line of lines) yield line;
    }
    const encrypted = await createEncryptedBackupFile({ key, lines: source(), path });
    const bytes = await readFile(path);
    assert.equal(bytes.includes(Buffer.from("private", "utf8")), false);
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
    decipher.setAuthTag(encrypted.authTag);
    const plaintext = gunzipSync(Buffer.concat([decipher.update(bytes), decipher.final()]));
    assert.equal(plaintext.includes(Buffer.from("9007199254740993", "utf8")), true);
    assert.match(encrypted.ciphertextSha256, /^[0-9a-f]{64}$/);
    assert.match(encrypted.plaintextSha256, /^[0-9a-f]{64}$/);

    const receipt = await verifyEncryptedBackupFile({ key, encrypted, plan });
    assert.equal(receipt.totalRows, 1);

    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await writeFile(path, bytes);
    await assert.rejects(() => verifyEncryptedBackupFile({ key, encrypted, plan }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
