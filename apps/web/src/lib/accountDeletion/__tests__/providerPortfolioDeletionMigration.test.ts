// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const baseMigration = readFileSync(resolve(repoRoot, "supabase/migrations/20260716113000_account_deletion_storage_saga.sql"), "utf8");
const migration = readFileSync(resolve(repoRoot, "supabase/migrations/20260928140701_provider_portfolio_account_deletion.sql"), "utf8");
const userId = "11111111-1111-4111-8111-111111111111";
const providerId = "22222222-2222-4222-8222-222222222222";
const mediaId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const claimId = "55555555-5555-4555-8555-555555555555";
const otherId = "66666666-6666-4666-8666-666666666666";
const path = `${userId}/${providerId}/${mediaId}.webp`;
const entry = { bucket: "provider-portfolio", path, source: "provider_portfolio", not_before: "2020-01-01T00:35:00.000Z" };

async function database() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.vendors(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users);
    CREATE TABLE public.account_deletions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,email text,reason text,deleted_at timestamptz DEFAULT now());
    CREATE TABLE public.community_upload_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE,staging_path text,final_bucket text,final_path text,expires_at timestamptz);
    CREATE TABLE public.profile_avatar_assets(user_id uuid,object_path text,upload_until timestamptz);
    CREATE TABLE public.provider_profiles(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users ON DELETE CASCADE);
    CREATE TABLE public.provider_media(id uuid PRIMARY KEY,provider_id uuid REFERENCES public.provider_profiles ON DELETE CASCADE,storage_path text,created_at timestamptz);
    INSERT INTO auth.users VALUES('${userId}'),('${otherId}');
    INSERT INTO public.provider_profiles VALUES('${providerId}','${userId}');
    INSERT INTO public.provider_media VALUES('${mediaId}','${providerId}','${path}','2020-01-01T00:00:00Z');
  `);
  await db.exec(baseMigration);
  await db.exec(migration);
  await db.exec(`INSERT INTO public.account_deletion_jobs(id,user_id,reason,status,claim_token,claimed_at)
    VALUES('${jobId}','${userId}','privacy','inventorying','${claimId}',now()); SET ROLE service_role;`);
  return db;
}

async function replace(db: PGlite, entries: unknown[]) {
  return db.query("SELECT status,quarantine_count FROM public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)", [jobId, claimId, JSON.stringify(entries)]);
}

describe("provider portfolio deletion migration", () => {
  it("accepts canonical owned registrations with upload grace and restricts RPC execution", async () => {
    const db = await database();
    try {
      expect((await replace(db, [entry])).rows).toEqual([{ status: "inventory_ready", quarantine_count: 0 }]);
      expect((await db.query("SELECT bucket,path,source FROM public.account_deletion_media_manifest")).rows).toEqual([{ bucket: entry.bucket, path, source: entry.source }]);
      await db.exec("RESET ROLE;");
      expect((await db.query(`SELECT has_function_privilege('anon','public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)','EXECUTE') AS member,
        has_function_privilege('service_role','public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)','EXECUTE') AS worker`)).rows)
        .toEqual([{ anon: false, member: false, worker: true }]);
    } finally { await db.close(); }
  });

  it("rejects wrong owner, wrong media proof, wrong source and shortened grace without persisting a partial inventory", async () => {
    const db = await database();
    try {
      for (const invalid of [
        { ...entry, path: `${otherId}/${providerId}/${mediaId}.webp` },
        { ...entry, path: `${userId}/${providerId}/${otherId}.webp` },
        { ...entry, source: "session_final" },
        { ...entry, not_before: "2020-01-01T00:34:59.999Z" },
      ]) await expect(replace(db, [invalid])).rejects.toThrow(/DELETION_(MANIFEST_PATH|PROOF)_INVALID/);
      expect((await db.query("SELECT count(*)::int AS n FROM public.account_deletion_media_manifest")).rows).toEqual([{ n: 0 }]);
    } finally { await db.close(); }
  });

  it("cannot omit a registered in-flight provider upload", async () => {
    const db = await database();
    try { await expect(replace(db, [])).rejects.toThrow("PROVIDER_PORTFOLIO_DELETION_INVENTORY_INCOMPLETE"); }
    finally { await db.close(); }
  });

  it("quarantines unregistered files without weakening the registered media proof", async () => {
    const db = await database();
    try {
      expect((await replace(db, [entry, { ...entry, path: `${userId}/${providerId}/${otherId}.webp`, source: "quarantine" }])).rows)
        .toEqual([{ status: "manual_review", quarantine_count: 1 }]);
    } finally { await db.close(); }
  });
});
