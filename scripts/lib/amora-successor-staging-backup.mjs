import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import { createGunzip, createGzip, gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const PROJECT_REF = /^[a-z0-9]{20}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const MIGRATION_VERSION = /^\d{14}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const BACKUP_ALGORITHM = "aes-256-gcm+gzip+ndjson-v1";
const MAX_TEST_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const MAX_STREAM_LINE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

function invalid(message) {
  throw new Error(`AMORA_SUCCESSOR_STAGING_BACKUP_INVALID: ${message}`);
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function exactExport(script, name) {
  const matches = [...script.matchAll(new RegExp(`^export ${name}="([^"]+)"$`, "gm"))];
  if (matches.length !== 1) invalid("temporary database credential envelope is malformed");
  return matches[0][1];
}

export function parseSupabaseTemporaryDatabaseCredentials(script, expectedProjectRef) {
  if (typeof script !== "string"
      || script.length < 64
      || script.length > 64 * 1024
      || typeof expectedProjectRef !== "string"
      || !PROJECT_REF.test(expectedProjectRef)) {
    invalid("temporary database credential input is malformed");
  }
  const host = exactExport(script, "PGHOST");
  const portText = exactExport(script, "PGPORT");
  const user = exactExport(script, "PGUSER");
  const password = exactExport(script, "PGPASSWORD");
  const database = exactExport(script, "PGDATABASE");
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
      || !["5432", "6543"].includes(portText)
      || user !== `cli_login_postgres.${expectedProjectRef}`
      || !/^[!-~]{20,256}$/.test(password)
      || /["'`\\]/.test(password)
      || database !== "postgres") {
    invalid("temporary database credentials failed the staging destination fence");
  }
  return Object.freeze({
    host,
    port: Number(portText),
    user,
    password,
    database,
  });
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalTable(table) {
  if (!exactKeys(table, ["name", "columns"])
      || typeof table.name !== "string"
      || !IDENTIFIER.test(table.name)
      || !Array.isArray(table.columns)
      || table.columns.length === 0
      || table.columns.some((column) => typeof column !== "string" || !IDENTIFIER.test(column))
      || new Set(table.columns).size !== table.columns.length) {
    invalid("table inventory is malformed");
  }
  return Object.freeze({
    name: table.name,
    columns: Object.freeze([...table.columns]),
  });
}

export function assertSuccessorStagingBackupPlan(input) {
  if (!exactKeys(input, [
    "projectRef",
    "productionProjectRef",
    "expectedCommit",
    "actualCommit",
    "originCommit",
    "trackedWorktreeClean",
    "migrationHead",
    "expectedMigrationHead",
    "migrationCount",
    "expectedMigrationCount",
    "tables",
  ])) {
    invalid("plan keys are malformed");
  }
  if (!PROJECT_REF.test(input.projectRef)
      || !PROJECT_REF.test(input.productionProjectRef)
      || input.projectRef === input.productionProjectRef) {
    invalid("project must be an exact non-production Supabase ref");
  }
  if (!GIT_COMMIT.test(input.expectedCommit)
      || input.actualCommit !== input.expectedCommit
      || input.originCommit !== input.expectedCommit) {
    invalid("commit and origin are not the exact candidate");
  }
  if (input.trackedWorktreeClean !== true) {
    invalid("tracked worktree is not clean");
  }
  if (!MIGRATION_VERSION.test(input.migrationHead)
      || input.migrationHead !== input.expectedMigrationHead
      || !Number.isSafeInteger(input.migrationCount)
      || input.migrationCount < 1
      || input.migrationCount !== input.expectedMigrationCount) {
    invalid("migration ledger does not match the expected baseline");
  }
  if (!Array.isArray(input.tables) || input.tables.length === 0) {
    invalid("table inventory is empty");
  }
  const tables = input.tables.map(canonicalTable);
  if (new Set(tables.map((table) => table.name)).size !== tables.length) {
    invalid("table inventory contains duplicate names");
  }
  return Object.freeze({
    ...input,
    tables: Object.freeze(tables),
  });
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    invalid("encryption key must be 32 bytes");
  }
}

function serializeLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    invalid("backup line set is empty");
  }
  const plaintext = Buffer.from(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  if (plaintext.length > MAX_TEST_PLAINTEXT_BYTES) {
    invalid("in-memory backup helper exceeded its bounded test payload");
  }
  return plaintext;
}

export async function createEncryptedBackupStream({ key, lines }) {
  assertKey(key);
  const iv = randomBytes(12);
  const compressed = await gzipAsync(serializeLines(lines), { level: 9 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Object.freeze({
    algorithm: BACKUP_ALGORITHM,
    iv,
    authTag: cipher.getAuthTag(),
    ciphertext,
  });
}

function parseEncryptedEnvelope(encrypted) {
  if (!exactKeys(encrypted, ["algorithm", "iv", "authTag", "ciphertext"])
      || encrypted.algorithm !== BACKUP_ALGORITHM
      || !Buffer.isBuffer(encrypted.iv)
      || encrypted.iv.length !== 12
      || !Buffer.isBuffer(encrypted.authTag)
      || encrypted.authTag.length !== 16
      || !Buffer.isBuffer(encrypted.ciphertext)
      || encrypted.ciphertext.length === 0) {
    invalid("encrypted envelope is malformed");
  }
  return encrypted;
}

function parseNdjson(plaintext) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length < 2 || plaintext.length > MAX_TEST_PLAINTEXT_BYTES) {
    invalid("decrypted payload is outside its bound");
  }
  const text = plaintext.toString("utf8");
  if (!text.endsWith("\n")) {
    invalid("decrypted payload is not canonical NDJSON");
  }
  try {
    return text.slice(0, -1).split("\n").map((line) => JSON.parse(line));
  } catch {
    invalid("decrypted payload contains invalid JSON");
  }
}

function verifyLines(lines, plan) {
  const verifier = new BackupLineVerifier(plan);
  for (const line of lines) verifier.accept(line);
  return verifier.finish();
}

class BackupLineVerifier {
  constructor(plan) {
    this.plan = plan;
    this.mode = "header";
    this.tableIndex = 0;
    this.currentRows = 0;
    this.totalRows = 0;
    this.tableRows = {};
  }

  accept(line) {
    if (this.mode === "done") invalid("backup contains data after its footer");
    if (this.mode === "header") {
      if (!exactKeys(line, ["kind", "version", "projectRef", "commit"])
          || line.kind !== "header"
          || line.version !== 1
          || line.projectRef !== this.plan.projectRef
          || line.commit !== this.plan.expectedCommit) {
        invalid("backup header does not match the plan");
      }
      this.mode = "table";
      return;
    }
    if (this.mode === "table") {
      const expected = this.plan.tables[this.tableIndex];
      if (!expected
          || !exactKeys(line, ["kind", "name", "columns"])
          || line.kind !== "table"
          || line.name !== expected.name
          || !Array.isArray(line.columns)
          || !sameArray(line.columns, expected.columns)) {
        invalid("table order or columns do not match the plan");
      }
      this.currentRows = 0;
      this.mode = "rows";
      return;
    }
    if (this.mode === "rows" && line?.kind === "row") {
      const expected = this.plan.tables[this.tableIndex];
      let value;
      try {
        value = typeof line?.valueJson === "string" ? JSON.parse(line.valueJson) : null;
      } catch {
        invalid("row JSON is malformed");
      }
      if (!exactKeys(line, ["kind", "table", "valueJson"])
          || line.table !== expected.name
          || value === null
          || typeof value !== "object"
          || Array.isArray(value)
          || !sameArray(Object.keys(value), expected.columns)) {
        invalid("row is malformed or bound to another table");
      }
      this.currentRows += 1;
      return;
    }
    if (this.mode === "rows") {
      const expected = this.plan.tables[this.tableIndex];
      if (!exactKeys(line, ["kind", "name", "rowCount"])
          || line.kind !== "table_end"
          || line.name !== expected.name
          || line.rowCount !== this.currentRows) {
        invalid("table terminal receipt does not match observed rows");
      }
      this.tableRows[expected.name] = this.currentRows;
      this.totalRows += this.currentRows;
      this.tableIndex += 1;
      this.mode = this.tableIndex === this.plan.tables.length ? "footer" : "table";
      return;
    }
    if (this.mode === "footer") {
      if (!exactKeys(line, ["kind", "tableCount", "rowCount"])
          || line.kind !== "footer"
          || line.tableCount !== this.plan.tables.length
          || line.rowCount !== this.totalRows) {
        invalid("backup footer does not match observed contents");
      }
      this.mode = "done";
    }
  }

  finish() {
    if (this.mode !== "done") invalid("backup ended before its terminal receipt");
    return Object.freeze({
      verified: true,
      totalRows: this.totalRows,
      tableRows: Object.freeze(this.tableRows),
    });
  }
}

export async function verifyEncryptedBackupStream({ key, encrypted, plan: rawPlan }) {
  assertKey(key);
  const plan = assertSuccessorStagingBackupPlan(rawPlan);
  const envelope = parseEncryptedEnvelope(encrypted);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    const compressed = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]);
    return verifyLines(parseNdjson(await gunzipAsync(compressed)), plan);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AMORA_SUCCESSOR_STAGING_BACKUP_INVALID:")) {
      throw error;
    }
    invalid("encrypted backup authentication or decompression failed");
  }
}

function hashingTransform(hash, onBytes) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      onBytes(chunk.length);
      callback(null, chunk);
    },
  });
}

async function* serializeLineStream(lines, plaintextHash, onBytes) {
  for await (const line of lines) {
    const bytes = Buffer.from(`${JSON.stringify(line)}\n`, "utf8");
    if (bytes.length > MAX_STREAM_LINE_BYTES) invalid("one backup line exceeds its bound");
    plaintextHash.update(bytes);
    onBytes(bytes.length);
    yield bytes;
  }
}

export async function createEncryptedBackupFile({ key, lines, path }) {
  assertKey(key);
  if (!lines || typeof lines[Symbol.asyncIterator] !== "function" || typeof path !== "string" || path.length < 1) {
    invalid("streaming backup input is malformed");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintextHash = createHash("sha256");
  const ciphertextHash = createHash("sha256");
  let plaintextBytes = 0;
  let ciphertextBytes = 0;
  try {
    await pipeline(
      Readable.from(serializeLineStream(lines, plaintextHash, (size) => { plaintextBytes += size; })),
      createGzip({ level: 9 }),
      cipher,
      hashingTransform(ciphertextHash, (size) => { ciphertextBytes += size; }),
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
    return Object.freeze({
      algorithm: BACKUP_ALGORITHM,
      path,
      iv,
      authTag: cipher.getAuthTag(),
      plaintextSha256: plaintextHash.digest("hex"),
      ciphertextSha256: ciphertextHash.digest("hex"),
      plaintextBytes,
      ciphertextBytes,
    });
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

function parseEncryptedFileEnvelope(encrypted) {
  if (!exactKeys(encrypted, [
    "algorithm",
    "path",
    "iv",
    "authTag",
    "plaintextSha256",
    "ciphertextSha256",
    "plaintextBytes",
    "ciphertextBytes",
  ])
      || encrypted.algorithm !== BACKUP_ALGORITHM
      || typeof encrypted.path !== "string"
      || encrypted.path.length < 1
      || !Buffer.isBuffer(encrypted.iv)
      || encrypted.iv.length !== 12
      || !Buffer.isBuffer(encrypted.authTag)
      || encrypted.authTag.length !== 16
      || !SHA256.test(encrypted.plaintextSha256)
      || !SHA256.test(encrypted.ciphertextSha256)
      || !Number.isSafeInteger(encrypted.plaintextBytes)
      || encrypted.plaintextBytes < 1
      || !Number.isSafeInteger(encrypted.ciphertextBytes)
      || encrypted.ciphertextBytes < 1) {
    invalid("encrypted file envelope is malformed");
  }
  return encrypted;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

function decryptedFileStream(envelope) {
  const decipher = createDecipheriv("aes-256-gcm", envelope.key, envelope.iv);
  decipher.setAuthTag(envelope.authTag);
  return createReadStream(envelope.path).pipe(decipher).pipe(createGunzip());
}

async function authenticateEncryptedFile(envelope) {
  const plaintextHash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of decryptedFileStream(envelope)) {
    plaintextHash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== envelope.plaintextBytes || plaintextHash.digest("hex") !== envelope.plaintextSha256) {
    invalid("decrypted file digest does not match its receipt");
  }
}

async function verifyDecryptedLines(stream, plan) {
  const verifier = new BackupLineVerifier(plan);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.write(chunk);
    if (Buffer.byteLength(pending, "utf8") > MAX_STREAM_LINE_BYTES * 2) {
      invalid("decrypted line buffer exceeds its bound");
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_STREAM_LINE_BYTES || line.length === 0) {
        invalid("decrypted payload contains an invalid line");
      }
      try { verifier.accept(JSON.parse(line)); }
      catch (error) {
        if (error instanceof SyntaxError) invalid("decrypted payload contains invalid JSON");
        throw error;
      }
    }
  }
  pending += decoder.end();
  if (pending.length !== 0) invalid("decrypted payload is not newline terminated");
  return verifier.finish();
}

export async function verifyEncryptedBackupFile({ key, encrypted: rawEnvelope, plan: rawPlan }) {
  assertKey(key);
  const plan = assertSuccessorStagingBackupPlan(rawPlan);
  const envelope = { ...parseEncryptedFileEnvelope(rawEnvelope), key };
  try {
    const actual = await hashFile(envelope.path);
    if (actual.bytes !== envelope.ciphertextBytes || actual.sha256 !== envelope.ciphertextSha256) {
      invalid("ciphertext file does not match its receipt");
    }
    await authenticateEncryptedFile(envelope);
    return await verifyDecryptedLines(decryptedFileStream(envelope), plan);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AMORA_SUCCESSOR_STAGING_BACKUP_INVALID:")) {
      throw error;
    }
    invalid("encrypted backup file authentication or parsing failed");
  }
}
