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
  "ai_interactions_log",
  "amora_actions",
  "amora_couple_profiles",
  "amora_turn_counters",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "couples",
  "decision_nodes",
  "profiles",
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
      TableCount: 11,
      TotalRows: "11",
      PrimaryConstraintsChecked: 11,
      ForeignKeysChecked: 1,
      SourceCanonicalDigestsVerified: true,
      LogicalDataParsedInV8: false,
      PlaintextWrittenToDisk: false,
    });
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
