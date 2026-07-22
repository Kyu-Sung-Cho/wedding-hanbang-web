// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const atomicMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
  ),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722198000_vendor_disclosure_preview_transport_identity.sql",
  ),
  "utf8",
);
const openDatabases: PGlite[] = [];

function extractOriginalProvenanceFunction(): string {
  const prefix =
    "CREATE OR REPLACE FUNCTION public.vendor_disclosure_payload_provenance_is_safe";
  const suffix = "$vendor_disclosure_payload_provenance_is_safe$;";
  const start = atomicMigration.indexOf(prefix);
  const end = atomicMigration.indexOf(suffix, start);
  if (start < 0 || end < 0) {
    throw new Error("original provenance function fixture is missing");
  }
  return atomicMigration.slice(start, end + suffix.length);
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

async function migrationDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  openDatabases.push(db);
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    ${extractOriginalProvenanceFunction()}

    CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic(
      p_target_project_ref text,
      p_run_sha256 text,
      p_full_plan_sha256 text,
      p_batch_plan_sha256 text,
      p_batch_sha256 text,
      p_batch_index integer,
      p_batch_count integer,
      p_snapshot_source text,
      p_snapshot_period text,
      p_authorization_kind text,
      p_authorization_sha256 text,
      p_local_pending_only_unit_ids text[],
      p_storage_objects jsonb,
      p_payload jsonb
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $stage_vendor_disclosure_batch_atomic$
    BEGIN
      IF p_payload IS NULL
        OR NOT public.vendor_disclosure_payload_provenance_is_safe(p_payload)
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INVALID_INPUT' USING ERRCODE = '22023';
      END IF;

      IF jsonb_array_length(p_storage_objects)
          IS DISTINCT FROM jsonb_array_length(p_payload -> 'raw_objects') + jsonb_array_length(p_payload -> 'preview_objects')
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT 'disclosure-raw'::text AS bucket_id,
              raw.value ->> 'storage_path' AS object_name,
              raw.value ->> 'sha256' AS object_sha256,
              (raw.value ->> 'bytes')::bigint AS object_bytes
            FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
            UNION ALL
            SELECT 'disclosure-preview'::text,
              preview.value ->> 'storage_path', preview.value ->> 'sha256',
              (preview.value ->> 'bytes')::bigint
            FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
          ) AS expected
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
            WHERE supplied.value ->> 'bucket' = expected.bucket_id
              AND supplied.value ->> 'object_key' = expected.object_name
              AND supplied.value ->> 'sha256' = expected.object_sha256
              AND (supplied.value ->> 'bytes')::bigint = expected.object_bytes
          )
        )
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_OUTCOME_INCOMPLETE' USING ERRCODE = '23514';
      END IF;
      RETURN true;
    END;
    $stage_vendor_disclosure_batch_atomic$;
  `);
  await db.exec(migration);
  return db;
}

const RAW_SHA_A = "1".repeat(64);
const RAW_SHA_B = "2".repeat(64);
const FOREIGN_RAW_SHA = "3".repeat(64);
const RAW_KEY_A = `${RAW_SHA_A}.pdf`;
const RAW_KEY_B = `${RAW_SHA_B}.pdf`;
const FOREIGN_RAW_KEY = `${FOREIGN_RAW_SHA}.pdf`;
const PREVIEW_SHA_A = "a".repeat(64);
const PREVIEW_SHA_B = "b".repeat(64);
const PREVIEW_KEY_A = `${PREVIEW_SHA_A}.txt`;
const PREVIEW_KEY_B = `${PREVIEW_SHA_B}.txt`;
const UNIT_ID = "6".repeat(64);

type JsonObject = Record<string, unknown>;

function raw(sha256: string): JsonObject {
  return {
    storage_path: `${sha256}.pdf`,
    sha256,
    ext: "pdf",
    bytes: 1_000,
    source_path: `local/${sha256}.pdf`,
  };
}

function preview(
  storagePath: string,
  sha256: string,
  sourceObjectKey: string,
  bytes = 100,
): JsonObject {
  return {
    storage_path: storagePath,
    sha256,
    bytes,
    source_object_key: sourceObjectKey,
    source_label: "page-1",
  };
}

function unit(sourceObjectKeys: string[], sourcePreviewKeys: string[]): JsonObject {
  return {
    unit_id: UNIT_ID,
    source_object_keys: sourceObjectKeys,
    source_preview_keys: sourcePreviewKeys,
  };
}

function payload(
  rawObjects: JsonObject[],
  previewObjects: JsonObject[],
  sourceObjectKeys: string[],
  sourcePreviewKeys: string[],
  officialPrices: JsonObject[] = [],
): JsonObject {
  return {
    units: [unit(sourceObjectKeys, sourcePreviewKeys)],
    raw_objects: rawObjects,
    preview_objects: previewObjects,
    agency_packages: [],
    official_prices: officialPrices,
    disclosure_semantics: [],
  };
}

function storageObject(
  bucket: "disclosure-raw" | "disclosure-preview",
  objectKey: string,
  sha256: string,
  bytes: number,
): JsonObject {
  return {
    bucket,
    object_key: objectKey,
    sha256,
    bytes,
    created: false,
  };
}

const RAW_STORAGE_A = storageObject(
  "disclosure-raw",
  RAW_KEY_A,
  RAW_SHA_A,
  1_000,
);
const RAW_STORAGE_B = storageObject(
  "disclosure-raw",
  RAW_KEY_B,
  RAW_SHA_B,
  1_000,
);
const PREVIEW_STORAGE_A = storageObject(
  "disclosure-preview",
  PREVIEW_KEY_A,
  PREVIEW_SHA_A,
  100,
);
const PREVIEW_STORAGE_B = storageObject(
  "disclosure-preview",
  PREVIEW_KEY_B,
  PREVIEW_SHA_B,
  100,
);

async function invoke(
  db: PGlite,
  authorizationKind: "local_validated_pending_only" | "paid_pilot_gate",
  batchPayload: JsonObject,
  storageObjects: JsonObject[],
): Promise<void> {
  await db.exec(`
    SELECT public.stage_vendor_disclosure_batch_atomic(
      'staging-project', repeat('1', 64), repeat('2', 64), repeat('3', 64),
      repeat('4', 64), 1, 1, 'kca_tprice', '2026Q3', '${authorizationKind}',
      repeat('5', 64), ARRAY['${UNIT_ID}'],
      $storage$${JSON.stringify(storageObjects)}$storage$::jsonb,
      $payload$${JSON.stringify(batchPayload)}$payload$::jsonb
    );
  `);
}

describe("preview transport identity migration", () => {
  it("allows one local-only Storage object to back repeated current mappings", async () => {
    const db = await migrationDatabase();
    const batchPayload = payload(
      [raw(RAW_SHA_A), raw(RAW_SHA_B)],
      [
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_B),
      ],
      [RAW_KEY_A, RAW_KEY_B],
      [PREVIEW_KEY_A],
    );

    await expect(
      invoke(db, "local_validated_pending_only", batchPayload, [
        RAW_STORAGE_A,
        RAW_STORAGE_B,
        PREVIEW_STORAGE_A,
      ]),
    ).resolves.toBeUndefined();
  });

  it("allows a redundant foreign occurrence only beside a current mapping", async () => {
    const db = await migrationDatabase();
    const batchPayload = payload(
      [raw(RAW_SHA_A)],
      [
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, FOREIGN_RAW_KEY),
      ],
      [RAW_KEY_A],
      [PREVIEW_KEY_A],
    );

    await expect(
      invoke(db, "local_validated_pending_only", batchPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
      ]),
    ).resolves.toBeUndefined();
  });

  it("keeps paid authorization on the original strict provenance fence", async () => {
    const db = await migrationDatabase();
    const batchPayload = payload(
      [raw(RAW_SHA_A)],
      [
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
      ],
      [RAW_KEY_A],
      [PREVIEW_KEY_A],
    );

    await expect(
      invoke(db, "paid_pilot_gate", batchPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
      ]),
    ).rejects.toThrow(/DISCLOSURE_ATOMIC_INVALID_INPUT/iu);
  });

  it("keeps distinct preview identities on the complete Storage set fence", async () => {
    const db = await migrationDatabase();
    const batchPayload = payload(
      [raw(RAW_SHA_A)],
      [
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
        preview(PREVIEW_KEY_B, PREVIEW_SHA_B, RAW_KEY_A),
      ],
      [RAW_KEY_A],
      [PREVIEW_KEY_A, PREVIEW_KEY_B],
    );

    await expect(
      invoke(db, "local_validated_pending_only", batchPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
      ]),
    ).rejects.toThrow(/DISCLOSURE_ATOMIC_STORAGE_OUTCOME_INCOMPLETE/iu);

    await expect(
      invoke(db, "local_validated_pending_only", batchPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
        PREVIEW_STORAGE_B,
      ]),
    ).resolves.toBeUndefined();
  });

  it("rejects conflicting metadata and a foreign-only mapping", async () => {
    const conflictDb = await migrationDatabase();
    const conflictingPayload = payload(
      [raw(RAW_SHA_A)],
      [
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_A),
        preview(PREVIEW_KEY_A, PREVIEW_SHA_A, FOREIGN_RAW_KEY, 101),
      ],
      [RAW_KEY_A],
      [PREVIEW_KEY_A],
    );
    await expect(
      invoke(conflictDb, "local_validated_pending_only", conflictingPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
      ]),
    ).rejects.toThrow(/DISCLOSURE_ATOMIC_INVALID_INPUT/iu);

    const foreignOnlyDb = await migrationDatabase();
    const foreignOnlyPayload = payload(
      [raw(RAW_SHA_A)],
      [preview(PREVIEW_KEY_A, PREVIEW_SHA_A, FOREIGN_RAW_KEY)],
      [RAW_KEY_A],
      [PREVIEW_KEY_A],
    );
    await expect(
      invoke(foreignOnlyDb, "local_validated_pending_only", foreignOnlyPayload, [
        RAW_STORAGE_A,
        PREVIEW_STORAGE_A,
      ]),
    ).rejects.toThrow(/DISCLOSURE_ATOMIC_INVALID_INPUT/iu);
  });

  it("requires every staged row to have its own current raw-to-preview mapping", async () => {
    const db = await migrationDatabase();
    const price = {
      unit_id: UNIT_ID,
      source_object_keys: [RAW_KEY_A],
      source_preview_keys: [PREVIEW_KEY_A],
    };
    const batchPayload = payload(
      [raw(RAW_SHA_A), raw(RAW_SHA_B)],
      [preview(PREVIEW_KEY_A, PREVIEW_SHA_A, RAW_KEY_B)],
      [RAW_KEY_A, RAW_KEY_B],
      [PREVIEW_KEY_A],
      [price],
    );

    await expect(
      invoke(db, "local_validated_pending_only", batchPayload, [
        RAW_STORAGE_A,
        RAW_STORAGE_B,
        PREVIEW_STORAGE_A,
      ]),
    ).rejects.toThrow(/DISCLOSURE_ATOMIC_INVALID_INPUT/iu);
  });
});
