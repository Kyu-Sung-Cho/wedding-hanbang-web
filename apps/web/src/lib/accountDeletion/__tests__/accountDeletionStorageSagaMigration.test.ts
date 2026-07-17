// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260716113000_account_deletion_storage_saga.sql"),
  "utf8",
);
const releasePost = readFileSync(
  resolve(repoRoot, "supabase/release-checks/amora-engine-v2-20260716-post.sql"),
  "utf8",
);
const deletionReleasePost = releasePost.match(
  /DO \$post_deletion_1130\$[\s\S]*?\$post_deletion_1130\$;/,
)?.[0];
if (!deletionReleasePost) {
  throw new Error("missing post_deletion_1130 release block");
}
const exactAclRepair = migration.match(
  /DO \$rebuild_account_deletion_exact_acl\$[\s\S]*?\$rebuild_account_deletion_exact_acl\$;/,
)?.[0];
if (!exactAclRepair) {
  throw new Error("missing account-deletion exact ACL rebuild block");
}
const exactAclPostcondition = migration.match(
  /DO \$account_deletion_exact_acl_postcondition\$[\s\S]*?\$account_deletion_exact_acl_postcondition\$;/,
)?.[0];
if (!exactAclPostcondition) {
  throw new Error("missing account-deletion exact ACL postcondition block");
}

const AUTHENTICATED_EXACT_ACL_FUNCTIONS = [
  "public.account_deletion_storage_writes_allowed()",
  "public.production_storage_writes_allowed()",
] as const;
const SERVICE_ROLE_EXACT_ACL_FUNCTIONS = [
  "public.begin_account_deletion_job(uuid,text)",
  "public.claim_account_deletion_job(uuid,uuid,timestamp with time zone)",
  "public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)",
  "public.release_account_deletion_job(uuid,uuid,text)",
  "public.mark_account_deletion_manual_review(uuid,uuid,text)",
  "public.resume_account_deletion_after_manual_review(uuid)",
  "public.checkpoint_account_deletion_media(uuid,uuid,text,text)",
  "public.prepare_account_deletion_auth_delete(uuid,uuid)",
  "public.finalize_account_deletion_job(uuid,uuid)",
] as const;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID_RE = /^[0-9a-f-]{36}$/i;
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const DELETE_CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const STAGING_PATH = `${USER_ID}/${UPLOAD_ID}.png`;
const LEGACY_PATH = `${USER_ID}/1700000000000_66666666-6666-4666-8666-666666666666.jpg`;
const LEGACY_UPPERCASE_PATH = `${USER_ID}/1700000000001_77777777-7777-4777-8777-777777777777.JPG`;
const COUPLE_ID = "88888888-8888-4888-8888-888888888888";
const CHAT_FILE_ID = "99999999-9999-4999-8999-999999999999";
const CHAT_PATH = `${COUPLE_ID}/${USER_ID}/${CHAT_FILE_ID}.jpeg`;
const OTHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function database() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.account_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      email text,
      reason text DEFAULT 'unknown',
      deleted_at timestamptz DEFAULT clock_timestamp()
    );
    CREATE TABLE public.community_upload_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      staging_path text NOT NULL,
      final_bucket text NOT NULL,
      final_path text NOT NULL,
      expires_at timestamptz NOT NULL
    );
    INSERT INTO auth.users(id) VALUES ('${USER_ID}');
    INSERT INTO public.community_upload_sessions(
      id, user_id, staging_path, final_bucket, final_path, expires_at
    ) VALUES (
      '${UPLOAD_ID}', '${USER_ID}', '${STAGING_PATH}', 'community-images',
      '${STAGING_PATH}', '2019-12-31T23:50:00Z'
    );
  `);
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  return db;
}

describe("account deletion community Storage saga migration", () => {
  it("atomically closes direct authenticated Storage writes once deletion intake starts", async () => {
    const db = await database();
    try {
      await db.exec(deletionReleasePost);
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [USER_ID]);
      await db.exec("SET ROLE authenticated;");
      const before = await db.query<{ allowed: boolean }>(`
        SELECT public.account_deletion_storage_writes_allowed() AS allowed
      `);
      expect(before.rows).toEqual([{ allowed: true }]);

      await db.exec("RESET ROLE; SET ROLE service_role;");
      await db.query(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      await db.exec("RESET ROLE; SET ROLE authenticated;");
      const after = await db.query<{ allowed: boolean }>(`
        SELECT public.account_deletion_storage_writes_allowed() AS allowed
      `);
      expect(after.rows).toEqual([{ allowed: false }]);

      await db.exec("RESET ROLE; SET ROLE anon;");
      await expect(db.query(`
        SELECT public.account_deletion_storage_writes_allowed()
      `)).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE;");

      const contract = await db.query<{
        owner_name: string;
        security_definer: boolean;
        volatility: string;
        config: string[];
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT pg_get_userbyid(proowner) AS owner_name,
          prosecdef AS security_definer,
          provolatile AS volatility,
          proconfig AS config,
          has_function_privilege(
            'anon', oid, 'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated', oid, 'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role', oid, 'EXECUTE'
          ) AS service_execute
        FROM pg_proc
        WHERE oid = 'public.account_deletion_storage_writes_allowed()'::regprocedure
      `);
      expect(contract.rows).toEqual([{
        owner_name: "postgres",
        security_definer: true,
        volatility: "v",
        config: [
          'search_path=""',
          "lock_timeout=5s",
          "statement_timeout=10s",
        ],
        anon_execute: false,
        authenticated_execute: true,
        service_execute: false,
      }]);

      expect(migration.match(
        /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\([^)]*::text, 0\)\s*\)/g,
      )).toHaveLength(2);

      await db.exec(`
        GRANT EXECUTE ON FUNCTION
          public.account_deletion_storage_writes_allowed() TO service_role;
      `);
      await expect(db.exec(deletionReleasePost)).rejects.toThrow(
        /POST_1130_DELETION_CONTRACT_INVALID/,
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects custom-role ACL drift and rebuilds the exact non-grantable ACLs", async () => {
    const db = await database();
    try {
      const authenticatedFunctions = AUTHENTICATED_EXACT_ACL_FUNCTIONS.join(",\n");
      const serviceFunctions = SERVICE_ROLE_EXACT_ACL_FUNCTIONS.join(",\n");
      const allFunctions = [
        ...AUTHENTICATED_EXACT_ACL_FUNCTIONS,
        ...SERVICE_ROLE_EXACT_ACL_FUNCTIONS,
      ].join(",\n");

      await db.exec(`
        CREATE ROLE unreviewed_deletion_operator NOLOGIN;
        GRANT EXECUTE ON FUNCTION ${allFunctions}
          TO unreviewed_deletion_operator;
      `);
      await expect(db.exec(exactAclPostcondition)).rejects.toThrow(
        /ACCOUNT_DELETION_FUNCTION_ACL_INVALID/,
      );
      await expect(db.exec(deletionReleasePost)).rejects.toThrow(
        /POST_1130_DELETION_CONTRACT_INVALID/,
      );

      await db.exec(`
        GRANT EXECUTE ON FUNCTION ${authenticatedFunctions}
          TO authenticated WITH GRANT OPTION;
        GRANT EXECUTE ON FUNCTION ${serviceFunctions}
          TO service_role WITH GRANT OPTION;
      `);
      await expect(db.exec(deletionReleasePost)).rejects.toThrow(
        /POST_1130_DELETION_CONTRACT_INVALID/,
      );

      await db.exec(exactAclRepair);
      await db.exec(deletionReleasePost);

      const contractValues = [
        ...AUTHENTICATED_EXACT_ACL_FUNCTIONS.map(
          (signature) => `('${signature}', 'authenticated')`,
        ),
        ...SERVICE_ROLE_EXACT_ACL_FUNCTIONS.map(
          (signature) => `('${signature}', 'service_role')`,
        ),
      ].join(",\n");
      const contracts = await db.query<{
        signature: string;
        intended_role: "authenticated" | "service_role";
        owner_name: string;
        execute_grantees: string[];
        intended_grantable: boolean;
        custom_execute: boolean;
      }>(`
        WITH required(signature, intended_role) AS (
          VALUES ${contractValues}
        )
        SELECT required.signature,
          required.intended_role,
          pg_get_userbyid(procedure_record.proowner) AS owner_name,
          (
            SELECT array_agg(
              DISTINCT pg_get_userbyid(acl_entry.grantee)
              ORDER BY pg_get_userbyid(acl_entry.grantee)
            )
            FROM aclexplode(COALESCE(
              procedure_record.proacl,
              acldefault('f', procedure_record.proowner)
            )) AS acl_entry
            WHERE acl_entry.privilege_type = 'EXECUTE'
          ) AS execute_grantees,
          EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(
              procedure_record.proacl,
              acldefault('f', procedure_record.proowner)
            )) AS acl_entry
            WHERE acl_entry.privilege_type = 'EXECUTE'
              AND pg_get_userbyid(acl_entry.grantee) = required.intended_role
              AND acl_entry.is_grantable
          ) AS intended_grantable,
          has_function_privilege(
            'unreviewed_deletion_operator', procedure_record.oid, 'EXECUTE'
          ) AS custom_execute
        FROM required
        JOIN pg_proc AS procedure_record
          ON procedure_record.oid = to_regprocedure(required.signature)
        ORDER BY required.signature
      `);

      expect(contracts.rows).toHaveLength(11);
      for (const contract of contracts.rows) {
        expect(contract.owner_name).toBe("postgres");
        expect(contract.execute_grantees).toEqual(
          contract.intended_role === "authenticated"
            ? ["authenticated", "postgres"]
            : ["postgres", "service_role"],
        );
        expect(contract.intended_grantable).toBe(false);
        expect(contract.custom_execute).toBe(false);
      }
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("is service-only and rejects arbitrary paths before a durable manifest can advance", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE authenticated;");
      await expect(db.query(`
        SELECT * FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `)).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE; SET ROLE service_role;");

      const begun = await db.query<{ id: string; status: string }>(`
        SELECT id, status
        FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      expect(begun.rows).toEqual([{
        id: expect.stringMatching(JOB_ID_RE),
        status: "inventorying",
      }]);
      const jobId = begun.rows[0].id;

      const claimed = await db.query<{ status: string; claim_token: string }>(`
        SELECT status, claim_token
        FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      expect(claimed.rows).toEqual([{ status: "inventorying", claim_token: CLAIM_ID }]);

      await expect(db.query(`
        SELECT * FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}',
          '[{"bucket":"community-images","path":"${USER_ID}/../../other.jpg","source":"legacy_prefix","not_before":"2020-01-01T00:00:00Z"}]'::jsonb
        )
      `)).rejects.toThrow(/ACCOUNT_DELETION_MANIFEST_PATH_INVALID/);
      const stillInventorying = await db.query(`
        SELECT status, claim_token FROM public.account_deletion_jobs WHERE id = '${jobId}'
      `);
      expect(stillInventorying.rows).toEqual([{
        status: "inventorying",
        claim_token: CLAIM_ID,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("checkpoints exact objects, crosses the Auth boundary only when clean, then anonymizes", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      const jobId = begun.rows[0].id;
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      const notBefore = "2020-01-01T00:00:00Z";
      const manifest = JSON.stringify([
        { bucket: "community-media-staging", path: STAGING_PATH, source: "session_staging", not_before: notBefore },
        { bucket: "community-images", path: STAGING_PATH, source: "session_final", not_before: notBefore },
        { bucket: "community-images", path: LEGACY_PATH, source: "legacy_prefix", not_before: notBefore },
        { bucket: "community-images", path: LEGACY_UPPERCASE_PATH, source: "legacy_prefix", not_before: notBefore },
      ]).replaceAll("'", "''");
      const ready = await db.query<{ status: string; quarantine_count: number }>(`
        SELECT status, quarantine_count
        FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}', '${manifest}'::jsonb
        )
      `);
      expect(ready.rows).toEqual([{ status: "inventory_ready", quarantine_count: 0 }]);

      const deletionClaim = await db.query<{ status: string; claim_token: string }>(`
        SELECT status, claim_token
        FROM public.claim_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      expect(deletionClaim.rows).toEqual([{ status: "deleting", claim_token: DELETE_CLAIM_ID }]);
      const premature = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS prepared
      `);
      expect(premature.rows).toEqual([{ prepared: false }]);
      const wrong = await db.query<{ checkpointed: boolean }>(`
        SELECT public.checkpoint_account_deletion_media(
          '${jobId}', '${DELETE_CLAIM_ID}', 'community-images',
          '${USER_ID}/not-in-manifest.jpg'
        ) AS checkpointed
      `);
      expect(wrong.rows).toEqual([{ checkpointed: false }]);

      for (const [bucket, path] of [
        ["community-media-staging", STAGING_PATH],
        ["community-images", STAGING_PATH],
        ["community-images", LEGACY_PATH],
        ["community-images", LEGACY_UPPERCASE_PATH],
      ]) {
        const exact = await db.query<{ checkpointed: boolean }>(`
          SELECT public.checkpoint_account_deletion_media(
            '${jobId}', '${DELETE_CLAIM_ID}', '${bucket}', '${path}'
          ) AS checkpointed
        `);
        expect(exact.rows).toEqual([{ checkpointed: true }]);
      }
      const prepared = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS prepared
      `);
      expect(prepared.rows).toEqual([{ prepared: true }]);
      const beforeAuth = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS finalized
      `);
      expect(beforeAuth.rows).toEqual([{ finalized: false }]);

      await db.exec(`
        RESET ROLE;
        DELETE FROM auth.users WHERE id = '${USER_ID}';
        SET ROLE service_role;
      `);
      const finalized = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS finalized
      `);
      expect(finalized.rows).toEqual([{ finalized: true }]);
      const job = await db.query(`
        SELECT status, user_id, reason, claim_token,
               completed_at IS NOT NULL AS completed
        FROM public.account_deletion_jobs WHERE id = '${jobId}'
      `);
      expect(job.rows).toEqual([{
        status: "completed",
        user_id: null,
        reason: null,
        claim_token: null,
        completed: true,
      }]);
      const manifestRows = await db.query("SELECT * FROM public.account_deletion_media_manifest");
      expect(manifestRows.rows).toEqual([]);
      await db.exec("RESET ROLE;");
      const audit = await db.query("SELECT user_id, email, reason FROM public.account_deletions");
      expect(audit.rows).toEqual([{ user_id: null, email: null, reason: "privacy" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("enforces signed-token grace and quarantines unproven legacy objects", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      const jobId = begun.rows[0].id;
      const duplicate = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'other')
      `);
      expect(duplicate.rows).toEqual([{ id: jobId }]);
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);

      await expect(db.query(`
        SELECT * FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}',
          '[{"bucket":"community-media-staging","path":"${STAGING_PATH}","source":"session_staging","not_before":"2019-12-31T23:54:59Z"}]'::jsonb
        )
      `)).rejects.toThrow(/ACCOUNT_DELETION_SESSION_PROOF_INVALID/);

      const quarantined = await db.query<{
        status: string;
        quarantine_count: number;
        claim_token: string | null;
      }>(`
        SELECT status, quarantine_count, claim_token
        FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}',
          '[{"bucket":"community-images","path":"${USER_ID}/untracked.png","source":"quarantine","not_before":"2020-01-01T00:00:00Z"}]'::jsonb
        )
      `);
      expect(quarantined.rows).toEqual([{
        status: "manual_review",
        quarantine_count: 1,
        claim_token: null,
      }]);
      const cannotReclaim = await db.query(`
        SELECT id FROM public.claim_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      expect(cannotReclaim.rows).toEqual([]);
      const manifest = await db.query(`
        SELECT source, cleaned_at
        FROM public.account_deletion_media_manifest
        WHERE job_id = '${jobId}'
      `);
      expect(manifest.rows).toEqual([{ source: "quarantine", cleaned_at: null }]);

      await db.exec(`
        UPDATE public.account_deletion_jobs
        SET storage_verified_at = clock_timestamp()
        WHERE id = '${jobId}'
      `);

      const resumed = await db.query<{
        status: string;
        quarantine_count: number;
        storage_proof_cleared: boolean;
      }>(`
        SELECT status, quarantine_count,
               storage_verified_at IS NULL AS storage_proof_cleared
        FROM public.resume_account_deletion_after_manual_review('${jobId}')
      `);
      expect(resumed.rows).toEqual([{
        status: "inventorying",
        quarantine_count: 0,
        storage_proof_cleared: true,
      }]);
      const cleared = await db.query(`
        SELECT * FROM public.account_deletion_media_manifest
        WHERE job_id = '${jobId}'
      `);
      expect(cleared.rows).toEqual([]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("accepts only strict uploader-owned chat-image quarantine paths", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      const jobId = begun.rows[0].id;
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);

      const quarantined = await db.query<{ status: string; quarantine_count: number }>(`
        SELECT status, quarantine_count
        FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}',
          '[{"bucket":"chat-image","path":"${CHAT_PATH}","source":"quarantine","not_before":"2020-01-01T00:00:00Z"}]'::jsonb
        )
      `);
      expect(quarantined.rows).toEqual([{
        status: "manual_review",
        quarantine_count: 1,
      }]);
      const row = await db.query(`
        SELECT bucket, path, source, cleaned_at
        FROM public.account_deletion_media_manifest
        WHERE job_id = '${jobId}'
      `);
      expect(row.rows).toEqual([{
        bucket: "chat-image",
        path: CHAT_PATH,
        source: "quarantine",
        cleaned_at: null,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects malformed or wrongly-owned chat-image manifest entries", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      const jobId = begun.rows[0].id;
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);

      const invalidItems = [
        { bucket: "chat-image", path: `${COUPLE_ID}/${OTHER_USER_ID}/${CHAT_FILE_ID}.jpeg`, source: "quarantine", not_before: "2020-01-01T00:00:00Z" },
        { bucket: "chat-image", path: `${COUPLE_ID}/${USER_ID}/${CHAT_FILE_ID}.pdf`, source: "quarantine", not_before: "2020-01-01T00:00:00Z" },
        { bucket: "chat-image", path: CHAT_PATH, source: "legacy_prefix", not_before: "2020-01-01T00:00:00Z" },
        { bucket: "chat-image", path: `${USER_ID}/${CHAT_FILE_ID}.jpeg`, source: "quarantine", not_before: "2020-01-01T00:00:00Z" },
      ];
      for (const item of invalidItems) {
        const json = JSON.stringify([item]).replaceAll("'", "''");
        await expect(db.query(`
          SELECT * FROM public.replace_account_deletion_media_manifest(
            '${jobId}', '${CLAIM_ID}', '${json}'::jsonb
          )
        `)).rejects.toThrow(/ACCOUNT_DELETION_(MANIFEST_PATH|CHAT_PROOF)_INVALID/);
      }
      const manifest = await db.query(`
        SELECT * FROM public.account_deletion_media_manifest WHERE job_id = '${jobId}'
      `);
      expect(manifest.rows).toEqual([]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps the Auth boundary closed while the account owns a vendor", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'privacy')
      `);
      const jobId = begun.rows[0].id;
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      await db.query(`
        SELECT * FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}', '[]'::jsonb
        )
      `);
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      await db.exec("RESET ROLE;");
      await db.query(`
        INSERT INTO public.vendors(id, owner_id)
        VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${USER_ID}')
      `);
      await db.exec("SET ROLE service_role;");

      const blocked = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS prepared
      `);
      expect(blocked.rows).toEqual([{ prepared: false }]);

      await db.exec("RESET ROLE;");
      await db.query(`
        UPDATE public.vendors SET owner_id = NULL
        WHERE owner_id = '${USER_ID}'
      `);
      await db.exec("SET ROLE service_role;");
      const reviewed = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS prepared
      `);
      expect(reviewed.rows).toEqual([{ prepared: true }]);

      await db.exec(`
        RESET ROLE;
        CREATE OR REPLACE FUNCTION public.prepare_account_deletion_auth_delete(
          p_job_id uuid,
          p_claim_token uuid
        )
        RETURNS boolean
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = ''
        AS $$ SELECT true $$;
        ALTER FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid)
          OWNER TO postgres;
        REVOKE ALL ON FUNCTION
          public.prepare_account_deletion_auth_delete(uuid, uuid)
          FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION
          public.prepare_account_deletion_auth_delete(uuid, uuid)
          TO service_role;
      `);
      await expect(db.exec(deletionReleasePost)).rejects.toThrow(
        /POST_1130_DELETION_CONTRACT_INVALID/,
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("stores only allowlisted reason codes and finalizes the same non-PII code", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.begin_account_deletion_job(
          '${USER_ID}', 'contact bride@example.com'
        )
      `)).rejects.toThrow(/ACCOUNT_DELETION_REQUEST_INVALID/);
      await expect(db.exec(`
        INSERT INTO public.account_deletion_jobs(user_id, reason)
        VALUES ('${USER_ID}', 'phone 010-1234-5678')
      `)).rejects.toThrow(/account_deletion_jobs_reason/i);

      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${USER_ID}', 'other')
      `);
      const jobId = begun.rows[0].id;
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      await db.query(`
        SELECT * FROM public.replace_account_deletion_media_manifest(
          '${jobId}', '${CLAIM_ID}', '[]'::jsonb
        )
      `);
      await db.query(`
        SELECT * FROM public.claim_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}', clock_timestamp() - interval '15 minutes'
        )
      `);
      const prepared = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS prepared
      `);
      expect(prepared.rows).toEqual([{ prepared: true }]);
      await db.exec(`
        RESET ROLE;
        DELETE FROM auth.users WHERE id = '${USER_ID}';
        SET ROLE service_role;
      `);
      const finalized = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_account_deletion_job(
          '${jobId}', '${DELETE_CLAIM_ID}'
        ) AS finalized
      `);
      expect(finalized.rows).toEqual([{ finalized: true }]);
      await db.exec("RESET ROLE;");
      const audit = await db.query<{ reason: string }>(`
        SELECT reason FROM public.account_deletions
      `);
      expect(audit.rows).toEqual([{ reason: "other" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
