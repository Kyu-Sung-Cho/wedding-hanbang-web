// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, describe, expect, it } from "vitest";

const predecessor = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
  ),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722200000_vendor_disclosure_dedupe_link_replay.sql",
  ),
  "utf8",
);

const finalizerStart = predecessor.indexOf(
  "CREATE OR REPLACE FUNCTION public.finalize_vendor_disclosure_dedupe_atomic",
);
const finalizerEnd = predecessor.indexOf(
  "-- A completed draft run can be quarantined",
  finalizerStart,
);
if (finalizerStart < 0 || finalizerEnd < 0) {
  throw new Error("atomic dedupe finalizer migration slice is missing");
}
const finalizerSql = predecessor.slice(finalizerStart, finalizerEnd);

const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_A = "20000000-0000-4000-8000-000000000001";
const VENDOR_B = "20000000-0000-4000-8000-000000000002";
const AGENCY_A = "30000000-0000-4000-8000-000000000001";
const AGENCY_B = "30000000-0000-4000-8000-000000000002";
const RUN_SHA = "1".repeat(64);
const PLAN_SHA = "2".repeat(64);
const BATCH_SHA = "3".repeat(64);
const CANDIDATE_SHA = "4".repeat(64);
const UNIT_A = "a".repeat(64);
const UNIT_B = "b".repeat(64);
const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

function sqlJson(value: unknown): string {
  return `$payload$${JSON.stringify(value)}$payload$::jsonb`;
}

function candidate(
  entityKind: "vendor" | "agency",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entity_kind: entityKind,
    left_unit_id: UNIT_A,
    right_unit_id: UNIT_B,
    reason: `${entityKind} exact replay`,
    similarity: 0.91,
    status: "pending",
    ...overrides,
  };
}

async function migrationDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  openDatabases.push(db);
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      published boolean NOT NULL DEFAULT false,
      is_current boolean NOT NULL DEFAULT false,
      published_at timestamptz
    );
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      target_project_ref text NOT NULL,
      full_plan_sha256 text NOT NULL,
      authorization_kind text NOT NULL,
      local_pending_only_unit_ids text[] NOT NULL,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      batch_count integer NOT NULL,
      completed_batch_count integer NOT NULL,
      dedupe_candidates_sha256 text,
      dedupe_payload_sha256 text,
      status text NOT NULL,
      dedupe_finalized_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_disclosure_ingest_batches (
      run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256),
      batch_index integer NOT NULL,
      batch_sha256 text NOT NULL,
      unit_ids text[] NOT NULL,
      PRIMARY KEY (run_sha256, batch_index)
    );
    CREATE TABLE public.vendors (id uuid PRIMARY KEY);
    CREATE TABLE public.agencies (id uuid PRIMARY KEY);
    CREATE TABLE public.vendor_disclosure_ingest_identity_links (
      run_sha256 text NOT NULL,
      unit_id text NOT NULL,
      identity_kind text NOT NULL,
      record_ref text NOT NULL DEFAULT '',
      vendor_id uuid,
      agency_id uuid
    );
    CREATE TABLE public.vendor_dedupe_candidates (
      left_vendor_id uuid NOT NULL,
      right_vendor_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      status text NOT NULL,
      UNIQUE (left_vendor_id, right_vendor_id)
    );
    CREATE TABLE public.agency_dedupe_candidates (
      left_agency_id uuid NOT NULL,
      right_agency_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      status text NOT NULL,
      UNIQUE (left_agency_id, right_agency_id)
    );
    CREATE TABLE public.vendor_disclosure_ingest_dedupe_links (
      run_sha256 text NOT NULL,
      entity_kind text NOT NULL,
      left_identity_id uuid NOT NULL,
      right_identity_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      created_by_run boolean NOT NULL,
      initial_candidate_sha256 text NOT NULL,
      cleanup_status text NOT NULL,
      PRIMARY KEY (run_sha256, entity_kind, left_identity_id, right_identity_id)
    );

    INSERT INTO public.price_snapshots(id) VALUES ('${SNAPSHOT_ID}');
    INSERT INTO public.vendor_disclosure_ingest_runs (
      run_sha256, target_project_ref, full_plan_sha256, authorization_kind,
      local_pending_only_unit_ids, snapshot_id, batch_count,
      completed_batch_count, status
    ) VALUES (
      '${RUN_SHA}', 'staging-ref', '${PLAN_SHA}',
      'local_validated_pending_only', ARRAY['${UNIT_A}', '${UNIT_B}'],
      '${SNAPSHOT_ID}', 1, 1, 'active'
    );
    INSERT INTO public.vendor_disclosure_ingest_batches (
      run_sha256, batch_index, batch_sha256, unit_ids
    ) VALUES ('${RUN_SHA}', 1, '${BATCH_SHA}', ARRAY['${UNIT_A}', '${UNIT_B}']);
    INSERT INTO public.vendors(id) VALUES ('${VENDOR_A}'), ('${VENDOR_B}');
    INSERT INTO public.agencies(id) VALUES ('${AGENCY_A}'), ('${AGENCY_B}');
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, vendor_id, agency_id
    ) VALUES
      ('${RUN_SHA}', '${UNIT_A}', 'vendor', '${VENDOR_A}', NULL),
      ('${RUN_SHA}', '${UNIT_B}', 'vendor', '${VENDOR_B}', NULL),
      ('${RUN_SHA}', '${UNIT_A}', 'agency', NULL, '${AGENCY_A}'),
      ('${RUN_SHA}', '${UNIT_B}', 'agency', NULL, '${AGENCY_B}');
  `);
  await db.exec(finalizerSql);
  await db.exec(migration);
  return db;
}

async function finalize(
  db: PGlite,
  candidates: Record<string, unknown>[],
): Promise<Array<{ staged_candidate_count: number; already_finalized: boolean }>> {
  const result = await db.query<{
    staged_candidate_count: number;
    already_finalized: boolean;
  }>(`
    SELECT * FROM public.finalize_vendor_disclosure_dedupe_atomic(
      'staging-ref', '${RUN_SHA}', '${PLAN_SHA}', '${CANDIDATE_SHA}',
      ARRAY['${BATCH_SHA}'], ${sqlJson(candidates)}
    )
  `);
  return result.rows;
}

async function seedExistingLink(
  db: PGlite,
  entityKind: "vendor" | "agency",
): Promise<void> {
  const isVendor = entityKind === "vendor";
  const leftId = isVendor ? VENDOR_A : AGENCY_A;
  const rightId = isVendor ? VENDOR_B : AGENCY_B;
  const candidateTable = isVendor
    ? "public.vendor_dedupe_candidates"
    : "public.agency_dedupe_candidates";
  const leftColumn = isVendor ? "left_vendor_id" : "left_agency_id";
  const rightColumn = isVendor ? "right_vendor_id" : "right_agency_id";
  const replayCandidate = candidate(entityKind);

  await db.exec(`
    INSERT INTO ${candidateTable} (
      ${leftColumn}, ${rightColumn}, reason, similarity, status
    ) VALUES (
      '${leftId}', '${rightId}', '${replayCandidate.reason}',
      ${replayCandidate.similarity}, 'pending'
    );
    INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
      run_sha256, entity_kind, left_identity_id, right_identity_id,
      reason, similarity, created_by_run, initial_candidate_sha256,
      cleanup_status
    ) VALUES (
      '${RUN_SHA}', '${entityKind}', '${leftId}', '${rightId}',
      '${replayCandidate.reason}', ${replayCandidate.similarity}, false,
      encode(extensions.digest(convert_to(jsonb_build_object(
        'entity_kind', '${entityKind}', 'left_identity_id', '${leftId}'::uuid,
        'right_identity_id', '${rightId}'::uuid,
        'reason', '${replayCandidate.reason}',
        'similarity', ${replayCandidate.similarity}::numeric,
        'status', 'pending'
      )::text, 'UTF8'), 'sha256'), 'hex'),
      'reused'
    );
  `);
}

describe("vendor disclosure dedupe-link replay migration", () => {
  it("reuses one exact ingest link when repeated vendor and agency candidates resolve to the same pair", async () => {
    const db = await migrationDatabase();
    const vendor = candidate("vendor");
    const agency = candidate("agency");
    const candidates = [vendor, structuredClone(vendor), agency, structuredClone(agency)];

    await expect(finalize(db, candidates)).resolves.toEqual([{
      staged_candidate_count: 2,
      already_finalized: false,
    }]);

    const state = await db.query<{
      vendor_candidates: number;
      agency_candidates: number;
      links: number;
      owned_links: number;
      status: string;
      candidate_sha: string;
      payload_hash_exact: boolean;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM public.vendor_dedupe_candidates) AS vendor_candidates,
        (SELECT count(*)::integer FROM public.agency_dedupe_candidates) AS agency_candidates,
        (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_dedupe_links) AS links,
        (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_dedupe_links
          WHERE created_by_run AND cleanup_status = 'owned') AS owned_links,
        run.status,
        run.dedupe_candidates_sha256 AS candidate_sha,
        run.dedupe_payload_sha256 = encode(
          extensions.digest(convert_to(${sqlJson(candidates)}::text, 'UTF8'), 'sha256'),
          'hex'
        ) AS payload_hash_exact
      FROM public.vendor_disclosure_ingest_runs AS run
      WHERE run.run_sha256 = '${RUN_SHA}'
    `);
    expect(state.rows).toEqual([{
      vendor_candidates: 1,
      agency_candidates: 1,
      links: 2,
      owned_links: 2,
      status: "complete",
      candidate_sha: CANDIDATE_SHA,
      payload_hash_exact: true,
    }]);
  });

  it.each([
    ["reason", "reason = 'drifted evidence'"],
    ["numeric similarity", "similarity = 0.92"],
    ["initial representation", `initial_candidate_sha256 = '${"f".repeat(64)}'`],
    ["ownership tuple", "created_by_run = true, cleanup_status = 'reused'"],
  ])("fails 23505 when a repeated vendor link drifts in %s", async (_label, mutation) => {
    const db = await migrationDatabase();
    await seedExistingLink(db, "vendor");
    await db.exec(`
      UPDATE public.vendor_disclosure_ingest_dedupe_links
      SET ${mutation}
      WHERE run_sha256 = '${RUN_SHA}' AND entity_kind = 'vendor'
    `);

    await expect(finalize(db, [candidate("vendor")])).rejects.toThrow(
      /DISCLOSURE_DEDUPE_VENDOR_LINK_REPLAY_CONFLICT/iu,
    );
  });

  it("applies the same fail-closed representation check to agency links", async () => {
    const db = await migrationDatabase();
    await seedExistingLink(db, "agency");
    await db.exec(`
      UPDATE public.vendor_disclosure_ingest_dedupe_links
      SET initial_candidate_sha256 = '${"f".repeat(64)}'
      WHERE run_sha256 = '${RUN_SHA}' AND entity_kind = 'agency'
    `);

    await expect(finalize(db, [candidate("agency")])).rejects.toThrow(
      /DISCLOSURE_DEDUPE_AGENCY_LINK_REPLAY_CONFLICT/iu,
    );
  });
});
