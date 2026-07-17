import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  "scripts/amora-db-jsonb-roundtrip.mjs",
);
const PGLITE_ENTRY_PATH = path.resolve(
  process.cwd(),
  "node_modules/@electric-sql/pglite/dist/index.js",
);
const RUNTIME_ENV = {
  ...process.env,
  HBAM_PGLITE_ENTRY: PGLITE_ENTRY_PATH,
};
const TABLES = [
  "account_deletion_jobs",
  "account_deletion_media_manifest",
  "ai_interactions_log",
  "amora_actions",
  "amora_care_deliveries",
  "amora_care_jobs",
  "amora_care_scan_states",
  "amora_chat_request_claims",
  "amora_conflict_check_claims",
  "amora_couple_profiles",
  "amora_mediation_acceptances",
  "amora_memory_consents",
  "amora_memory_jobs",
  "amora_memory_settings",
  "amora_tool_executions",
  "amora_turn_counters",
  "amora_turn_requests",
  "booking_projection_jobs",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "community_upload_sessions",
  "couples",
  "decision_nodes",
  "profiles",
  "vendor_reviews",
  "wedding_journeys",
];

function authenticatedInput(inventory: unknown, rawLogicalJson: string): string {
  return `${Buffer.from(JSON.stringify(inventory)).toString("base64")}\n${Buffer.from(rawLogicalJson).toString("base64")}\n`;
}

function canonicalRowsDigest(rows: string[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(String(Buffer.byteLength(row, "utf8")));
    hash.update(":");
    hash.update(row);
    hash.update("\n");
  }
  return hash.digest("hex").toUpperCase();
}

function canonicalRowForTable(tableName: string): string {
  if (tableName === "ai_interactions_log") {
    return '{"id": 9007199254740993}';
  }
  if (tableName === "profiles") {
    return '{"id": "profiles", "couple_id": "couples"}';
  }
  return `{"id": "${tableName}"}`;
}

function validFixture(): { inventory: unknown; rawLogicalJson: string } {
  const inventory = {
    columns: [
      ...TABLES.map((table_name) => ({ table_name, column_name: "id" })),
      { table_name: "profiles", column_name: "couple_id" },
    ],
    constraints: [
      ...TABLES.map((table) => ({
        table,
        type: "p",
        columns: ["id"],
      })),
      {
        table: "profiles",
        type: "f",
        columns: ["couple_id"],
        referenced_table: "public.couples",
        referenced_columns: ["id"],
      },
    ],
  };
  const logical = {
    tables: Object.fromEntries(
      TABLES.map((name) => [
        name,
        {
          row_count: 1,
          canonical_sha256: canonicalRowsDigest([
            canonicalRowForTable(name),
          ]).toLowerCase(),
          rows: [{
            id: name === "ai_interactions_log" ? "__BIG_INTEGER__" : name,
            ...(name === "profiles" ? { couple_id: "couples" } : {}),
          }],
        },
      ]),
    ),
  };
  const rawLogicalJson = JSON.stringify(logical).replace(
    '"__BIG_INTEGER__"',
    "9007199254740993",
  );

  return { inventory, rawLogicalJson };
}

describe("Amora authenticated JSONB round-trip", () => {
  it("stages raw logical JSON without V8 integer precision loss", () => {
    const { inventory, rawLogicalJson } = validFixture();

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      input: authenticatedInput(inventory, rawLogicalJson),
      encoding: "utf8",
      timeout: 30_000,
      env: RUNTIME_ENV,
    });

    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      JsonbRoundTripVerified: true,
      AuthenticatedJsonbStaged: true,
      TableCount: 27,
      TotalRows: "27",
      PrimaryConstraintsChecked: 27,
      ForeignKeysChecked: 1,
      SourceCanonicalDigestsVerified: true,
      LogicalDataParsedInV8: false,
      PlaintextWrittenToDisk: false,
    });
  });

  it("rejects a payload missing vendor_reviews from the exact backup allowlist", () => {
    const { inventory, rawLogicalJson } = validFixture();
    const typedInventory = inventory as {
      columns: Array<{ table_name: string }>;
      constraints: Array<{ table: string }>;
    };
    const logicalData = JSON.parse(rawLogicalJson) as {
      tables: Record<string, unknown>;
    };
    delete logicalData.tables.vendor_reviews;

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      input: authenticatedInput(
        {
          columns: typedInventory.columns.filter(
            (column) => column.table_name !== "vendor_reviews",
          ),
          constraints: typedInventory.constraints.filter(
            (constraint) => constraint.table !== "vendor_reviews",
          ),
        },
        JSON.stringify(logicalData),
      ),
      encoding: "utf8",
      timeout: 30_000,
      env: RUNTIME_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("JSONB round-trip table allowlist mismatch");
  });

  it("rejects a source canonical digest mismatch without echoing payload data", () => {
    const marker = "CONFIDENTIAL_DIGEST_MISMATCH_MARKER";
    const { inventory, rawLogicalJson } = validFixture();
    const tamperedLogicalJson = rawLogicalJson.replace(
      '"id":"amora_actions"',
      `"id":"${marker}"`,
    );

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      input: authenticatedInput(inventory, tamperedLogicalJson),
      encoding: "utf8",
      timeout: 30_000,
      env: RUNTIME_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "source PostgreSQL canonical digest mismatch for amora_actions",
    );
    expect(result.stderr).not.toContain(marker);
  });

  it("rejects invalid logical JSON without echoing a payload excerpt", () => {
    const marker = "CONFIDENTIAL_PAYLOAD_MARKER";
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      input: authenticatedInput(
        { columns: [], constraints: [] },
        `{"secret":"${marker}",INVALID}`,
      ),
      encoding: "utf8",
      timeout: 30_000,
      env: RUNTIME_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "logical data payload is not valid PostgreSQL JSONB",
    );
    expect(result.stderr).not.toContain(marker);
  });
});
