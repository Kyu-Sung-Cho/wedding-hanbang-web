import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pgliteEntry = join(
  repoRoot,
  "apps/web/node_modules/@electric-sql/pglite/dist/index.js",
);
const restoreScript = join(
  repoRoot,
  "apps/web/scripts/amora-db-current-baseline-restore.mjs",
);
const expectedTables = [
  "ai_interactions_log",
  "amora_actions",
  "amora_chat_request_claims",
  "amora_couple_profiles",
  "amora_tool_executions",
  "amora_turn_counters",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "couples",
  "decision_nodes",
  "profiles",
  "vendor_reviews",
  "wedding_journeys",
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

async function postgresJsonbText(value) {
  const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
  const db = new PGlite();
  try {
    const result = await db.query("select $1::jsonb::text as value", [
      JSON.stringify(value),
    ]);
    return String(result.rows[0].value);
  } finally {
    await db.close();
  }
}

async function runRestore(lines) {
  return await new Promise((resolveResult) => {
    const child = spawn(process.execPath, [restoreScript], {
      cwd: join(repoRoot, "apps/web"),
      env: {
        ...process.env,
        HBAM_PGLITE_ENTRY: pgliteEntry,
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (status) => resolveResult({ status, stdout, stderr }));
    child.stdin.end(`${lines.join("\n")}\n`);
  });
}

test("the logical row replay restores an exact 14-table payload including vendor_reviews", async () => {
  await readFile(pgliteEntry);
  const schemaContract = {
    tables: expectedTables.map((name, index) => ({
      name,
      relation_oid: String(10_000 + index),
      relkind: "r",
      has_inheritance_children: false,
      is_inheritance_child: false,
    })),
    columns: expectedTables.map((table_name) => ({
      table_name,
      column_name: "id",
      ordinal_position: 1,
    })),
    constraints: [],
    indexes: [],
    policies: [],
    triggers: [],
    dependent_functions: [],
    owned_sequences: [],
  };
  const canonicalContract = await postgresJsonbText(schemaContract);
  const inventory = {
    schema_contract: schemaContract,
    schema_contract_sha256: sha256(canonicalContract),
  };
  const emptyRowsDigest = sha256("");
  const logicalData = {
    tables: Object.fromEntries(expectedTables.map((name) => [
      name,
      { row_count: 0, rows: [], canonical_sha256: emptyRowsDigest },
    ])),
  };
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  const result = await runRestore([
    encode(inventory),
    encode(logicalData),
    encode(inventory),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.LogicalRowReplayVerified, true);
  assert.equal(receipt.TableCount, 14);
  assert.equal(receipt.RestoredColumnCount, 14);
  assert.equal(receipt.TypedSchemaReplayed, false);
  assert.equal(receipt.PlaintextWrittenToDisk, false);
});
