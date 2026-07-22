// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
  ),
  "utf8",
);
const storageOutcomeIdempotencyMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722193000_vendor_disclosure_storage_outcome_idempotency.sql",
  ),
  "utf8",
);

function migrationFunctionSql(
  signatureStart: string,
  terminator: string,
  source = migration,
): string {
  const start = source.indexOf(signatureStart);
  const end = source.indexOf(terminator, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + terminator.length);
}

const intentFenceSql = migrationFunctionSql(
  "CREATE OR REPLACE FUNCTION public.assert_vendor_disclosure_storage_intents_settled",
  "$assert_vendor_disclosure_storage_intents_settled$;",
);
const claimFenceSql = migrationFunctionSql(
  "CREATE OR REPLACE FUNCTION public.assert_vendor_disclosure_storage_upload_claims_settled",
  "$assert_vendor_disclosure_storage_upload_claims_settled$;",
);
const claimSql = migrationFunctionSql(
  "CREATE OR REPLACE FUNCTION public.claim_vendor_disclosure_storage_object_atomic",
  "$claim_vendor_disclosure_storage_object_atomic$;",
);
const recordSql = migrationFunctionSql(
  "CREATE OR REPLACE FUNCTION public.record_vendor_disclosure_storage_object_atomic",
  "$record_vendor_disclosure_storage_object_atomic$;",
  storageOutcomeIdempotencyMigration,
);
const CLAIMANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function raceDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      target_project_ref text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_storage_links (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      bucket_id text NOT NULL,
      object_name text NOT NULL,
      object_sha256 text NOT NULL,
      object_bytes bigint NOT NULL,
      ownership_state text NOT NULL,
      storage_metadata_owner_run_sha256 text,
      storage_object_id uuid,
      storage_object_updated_at timestamptz,
      upload_claim_epoch bigint NOT NULL DEFAULT 0,
      upload_claim_token uuid,
      upload_claimant_id uuid,
      upload_claim_action text,
      upload_claimed_at timestamptz,
      upload_claim_expires_at timestamptz,
      confirmed_at timestamptz,
      PRIMARY KEY (run_sha256, bucket_id, object_name)
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY,
      bucket_id text NOT NULL,
      name text NOT NULL,
      metadata jsonb NOT NULL,
      user_metadata jsonb NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (bucket_id, name)
    );
    ${intentFenceSql}
    ${claimFenceSql}
    ${claimSql}
    ${recordSql}
  `);
  return db;
}

async function insertPreparedIntent(db: PGlite, runSha256: string, objectSha256: string): Promise<void> {
  await db.query(
    `INSERT INTO public.vendor_disclosure_ingest_runs
       (run_sha256, target_project_ref, status)
     VALUES ($1, 'staging-ref', 'active')`,
    [runSha256],
  );
  await db.query(
    `INSERT INTO public.vendor_disclosure_ingest_storage_links
       (run_sha256, batch_index, bucket_id, object_name, object_sha256, object_bytes, ownership_state)
     VALUES ($1, 1, 'disclosure-raw', $2, $3, 12, 'intent')`,
    [runSha256, `${objectSha256}.pdf`, objectSha256],
  );
}

describe("vendor disclosure per-object Storage upload claim", () => {
  it("serializes prepare -> abort -> claim so a claim after abort fails before HTTP upload", async () => {
    const db = await raceDatabase();
    const runSha256 = "a".repeat(64);
    const objectSha256 = "b".repeat(64);
    await insertPreparedIntent(db, runSha256, objectSha256);

    // This is the no-HTTP branch performed by the real abort RPC while it owns
    // the run/object locks: an unclaimed, absent object is settled, then the
    // run becomes aborted. Both completion fences are zero at commit.
    await db.exec("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || $1, 0))",
      [runSha256],
    );
    await db.query(
      `UPDATE public.vendor_disclosure_ingest_storage_links
       SET ownership_state = 'deleted'
       WHERE run_sha256 = $1 AND upload_claim_token IS NULL AND ownership_state = 'intent'`,
      [runSha256],
    );
    await db.query("SELECT public.assert_vendor_disclosure_storage_upload_claims_settled($1)", [runSha256]);
    await db.query("SELECT public.assert_vendor_disclosure_storage_intents_settled($1)", [runSha256]);
    await db.query(
      "UPDATE public.vendor_disclosure_ingest_runs SET status = 'aborted' WHERE run_sha256 = $1",
      [runSha256],
    );
    await db.exec("COMMIT");

    await expect(db.query(
      `SELECT * FROM public.claim_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
      )`,
      [runSha256, `${objectSha256}.pdf`, objectSha256, CLAIMANT_A],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_CLAIM_RUN_OR_OBJECT_CONFLICT/u);
  });

  it("blocks abort after claim until the exact token/epoch records and closes the lease", async () => {
    const db = await raceDatabase();
    const runSha256 = "c".repeat(64);
    const objectSha256 = "d".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    await insertPreparedIntent(db, runSha256, objectSha256);

    const claimed = await db.query<{
      claim_token: string;
      claim_epoch: bigint;
      claim_action: string;
    }>(
      `SELECT claim_token, claim_epoch, claim_action
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );
    const claim = claimed.rows[0];
    expect(claim.claim_action).toBe("upload");

    // Expiry is informational only. Even an old lease continues blocking abort
    // because an already-sent HTTP request may still arrive.
    await db.query(
      `UPDATE public.vendor_disclosure_ingest_storage_links
       SET upload_claimed_at = now() - interval '20 minutes',
           upload_claim_expires_at = now() - interval '10 minutes'
       WHERE run_sha256 = $1`,
      [runSha256],
    );
    await expect(
      db.query("SELECT public.assert_vendor_disclosure_storage_upload_claims_settled($1)", [runSha256]),
    ).rejects.toThrow(/DISCLOSURE_ABORT_STORAGE_UPLOAD_CLAIMS_UNSETTLED/u);
    const statusWhileClaimed = await db.query<{ status: string }>(
      "SELECT status FROM public.vendor_disclosure_ingest_runs WHERE run_sha256 = $1",
      [runSha256],
    );
    expect(statusWhileClaimed.rows[0].status).toBe("active");

    const updatedAt = "2026-07-20T06:01:00.000Z";
    await db.query(
      `INSERT INTO storage.objects
        (id, bucket_id, name, metadata, user_metadata, updated_at)
       VALUES (
         '22222222-2222-4222-8222-222222222222', 'disclosure-raw', $1,
         jsonb_build_object('size', 12),
         jsonb_build_object(
           'ingest_run_sha256', $2::text, 'ingest_sha256', $3::text, 'ingest_bytes', 12,
           'ingest_claim_token', $4::text, 'ingest_claim_epoch', $5::text,
           'ingest_claimant_id', $6::text
         ),
         $7::timestamptz
       )`,
      [objectName, runSha256, objectSha256, claim.claim_token, String(claim.claim_epoch), CLAIMANT_A, updatedAt],
    );

    await expect(db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, true,
        '33333333-3333-4333-8333-333333333333', $4, $5
      )`,
      [runSha256, objectName, objectSha256, String(claim.claim_epoch), CLAIMANT_A],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_OUTCOME_CONFLICT/u);
    await expect(
      db.query("SELECT public.assert_vendor_disclosure_storage_upload_claims_settled($1)", [runSha256]),
    ).rejects.toThrow(/DISCLOSURE_ABORT_STORAGE_UPLOAD_CLAIMS_UNSETTLED/u);

    await expect(db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, true, $4, $5, $6
      )`,
      [runSha256, objectName, objectSha256, claim.claim_token, String(claim.claim_epoch), CLAIMANT_A],
    )).resolves.toBeDefined();
    const replayed = await db.query<{ ownership_state: string; already_recorded: boolean }>(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, true, $4, $5, $6
      )`,
      [runSha256, objectName, objectSha256, claim.claim_token, String(claim.claim_epoch), CLAIMANT_A],
    );
    expect(replayed.rows).toEqual([{
      ownership_state: "confirmed_created",
      already_recorded: true,
    }]);
    await expect(db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, true,
        '44444444-4444-4444-8444-444444444444', $4, $5
      )`,
      [runSha256, objectName, objectSha256, String(claim.claim_epoch), CLAIMANT_A],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_OUTCOME_CONFLICT/u);
    await expect(db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, true, $4, $5, $6
      )`,
      [
        runSha256,
        objectName,
        objectSha256,
        claim.claim_token,
	        String(BigInt(claim.claim_epoch) + BigInt(1)),
        CLAIMANT_A,
      ],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_OUTCOME_CONFLICT/u);
    await expect(
      db.query("SELECT public.assert_vendor_disclosure_storage_upload_claims_settled($1)", [runSha256]),
    ).resolves.toBeDefined();
    await expect(
      db.query("SELECT public.assert_vendor_disclosure_storage_intents_settled($1)", [runSha256]),
    ).resolves.toBeDefined();
  });

  it("returns verify for an inherited exact generation instead of opening an upload path", async () => {
    const db = await raceDatabase();
    const runSha256 = "e".repeat(64);
    const ownerRunSha256 = "f".repeat(64);
    const objectSha256 = "1".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    const objectId = "44444444-4444-4444-8444-444444444444";
    const updatedAt = "2026-07-20T06:02:00.000Z";
    await insertPreparedIntent(db, runSha256, objectSha256);
    await db.query(
      `INSERT INTO storage.objects
        (id, bucket_id, name, metadata, user_metadata, updated_at)
       VALUES ($1, 'disclosure-raw', $2, jsonb_build_object('size', 12),
         jsonb_build_object(
           'ingest_run_sha256', $3::text, 'ingest_sha256', $4::text, 'ingest_bytes', 12
         ), $5::timestamptz)`,
      [objectId, objectName, ownerRunSha256, objectSha256, updatedAt],
    );
    await db.query(
      `UPDATE public.vendor_disclosure_ingest_storage_links
       SET ownership_state = 'confirmed_inherited',
           storage_metadata_owner_run_sha256 = $2,
           storage_object_id = $3,
           storage_object_updated_at = $4::timestamptz
       WHERE run_sha256 = $1`,
      [runSha256, ownerRunSha256, objectId, updatedAt],
    );

    const claimed = await db.query<{ claim_action: string }>(
      `SELECT claim_action
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );
    expect(claimed.rows[0].claim_action).toBe("verify");
  });

  it("returns verify when a prepared intent replay finds the immutable object already present", async () => {
    const db = await raceDatabase();
    const runSha256 = "2".repeat(64);
    const objectSha256 = "3".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    await insertPreparedIntent(db, runSha256, objectSha256);
    await db.query(
      `INSERT INTO storage.objects
        (id, bucket_id, name, metadata, user_metadata, updated_at)
       VALUES (
         '88888888-8888-4888-8888-888888888888', 'disclosure-raw', $1,
         jsonb_build_object('size', 12),
         jsonb_build_object(
           'ingest_run_sha256', $2::text, 'ingest_sha256', $3::text, 'ingest_bytes', 12
         ),
         '2026-07-20T06:03:00.000Z'::timestamptz
       )`,
      [objectName, "4".repeat(64), objectSha256],
    );

    const claimed = await db.query<{ claim_action: string }>(
      `SELECT claim_action
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );
    expect(claimed.rows[0].claim_action).toBe("verify");
  });

  it("replays a recorded generic pre-existing generation without requiring ingest metadata", async () => {
    const db = await raceDatabase();
    const runSha256 = "5".repeat(64);
    const objectSha256 = "6".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    const objectId = "99999999-9999-4999-8999-999999999999";
    const updatedAt = "2026-07-20T06:04:00.000Z";
    await insertPreparedIntent(db, runSha256, objectSha256);
    await db.query(
      `INSERT INTO storage.objects
        (id, bucket_id, name, metadata, user_metadata, updated_at)
       VALUES ($1, 'disclosure-raw', $2, jsonb_build_object('size', 12), '{}'::jsonb, $3::timestamptz)`,
      [objectId, objectName, updatedAt],
    );

    const firstClaim = await db.query<{ claim_token: string; claim_epoch: bigint; claim_action: string }>(
      `SELECT claim_token, claim_epoch, claim_action
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );
    expect(firstClaim.rows[0].claim_action).toBe("verify");
    await db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, false, $4, $5, $6
      )`,
      [
        runSha256,
        objectName,
        objectSha256,
        firstClaim.rows[0].claim_token,
        String(firstClaim.rows[0].claim_epoch),
        CLAIMANT_A,
      ],
    );

    const replayClaim = await db.query<{ claim_action: string }>(
      `SELECT claim_action
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );
    expect(replayClaim.rows[0].claim_action).toBe("verify");
  });

  it("rejects partial ingest metadata instead of blessing it as generic pre-existing", async () => {
    const db = await raceDatabase();
    const runSha256 = "9".repeat(64);
    const objectSha256 = "a".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    await insertPreparedIntent(db, runSha256, objectSha256);
    await db.query(
      `INSERT INTO storage.objects
        (id, bucket_id, name, metadata, user_metadata, updated_at)
       VALUES (
         '12121212-1212-4212-8212-121212121212', 'disclosure-raw', $1,
         jsonb_build_object('size', 12), jsonb_build_object('ingest_sha256', $2::text),
         '2026-07-20T06:05:00.000Z'::timestamptz
       )`,
      [objectName, objectSha256],
    );
    const claimed = await db.query<{ claim_token: string; claim_epoch: bigint }>(
      `SELECT claim_token, claim_epoch
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, CLAIMANT_A],
    );

    await expect(db.query(
      `SELECT * FROM public.record_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, false, $4, $5, $6
      )`,
      [
        runSha256,
        objectName,
        objectSha256,
        claimed.rows[0].claim_token,
        String(claimed.rows[0].claim_epoch),
        CLAIMANT_A,
      ],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_OUTCOME_CONFLICT/u);
  });

  it("never re-exposes an active claim token to either the same or a different claimant", async () => {
    const db = await raceDatabase();
    const runSha256 = "7".repeat(64);
    const objectSha256 = "8".repeat(64);
    const objectName = `${objectSha256}.pdf`;
    const claimantA = CLAIMANT_A;
    const claimantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await insertPreparedIntent(db, runSha256, objectSha256);

    const first = await db.query<{ claim_token: string; claimant_id: string }>(
      `SELECT claim_token, claimant_id
       FROM public.claim_vendor_disclosure_storage_object_atomic(
         'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
       )`,
      [runSha256, objectName, objectSha256, claimantA],
    );
    expect(first.rows[0].claimant_id).toBe(claimantA);

    await expect(db.query(
      `SELECT * FROM public.claim_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
      )`,
      [runSha256, objectName, objectSha256, claimantA],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_CLAIM_ALREADY_ACTIVE/u);
    await expect(db.query(
      `SELECT * FROM public.claim_vendor_disclosure_storage_object_atomic(
        'staging-ref', $1, 1, 'disclosure-raw', $2, $3, 12, $4
      )`,
      [runSha256, objectName, objectSha256, claimantB],
    )).rejects.toThrow(/DISCLOSURE_STORAGE_CLAIM_ALREADY_ACTIVE/u);
  });
});
