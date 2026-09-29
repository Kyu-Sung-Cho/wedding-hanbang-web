// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repo = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");
const providerMigration = read("supabase/migrations/20260928135517_provider_participation_self_publishing.sql");
const cleanupMigration = read("supabase/migrations/20260928142123_provider_media_cleanup.sql");
const fence = read("supabase/platform-operations/storage/20260928135517_provider_portfolio_service_fence.sql");
const owner = "11111111-1111-4111-8111-111111111111";
const provider = "22222222-2222-4222-8222-222222222222";
const media = (i: number) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
const token = "44444444-4444-4444-8444-444444444444";
const anotherToken = "55555555-5555-4555-8555-555555555555";
const path = (i: number) => `${owner}/${provider}/${media(i)}.webp`;
async function fixture() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false);
    CREATE TABLE public.account_deletion_jobs(user_id uuid,status text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
    INSERT INTO auth.users VALUES('${owner}','owner@example.invalid',now(),null,
      '{"signup_consent":{"schemaVersion":1,"source":"hanbang_auth_server","record":{"terms_agreed":true,"privacy_agreed":true,"age_over_14_confirmed":true,"marketing_agreed":false,"consent_policy_version":"2026-09-28","consent_agreed_at":"2026-09-28T00:00:00.000Z"}}}');
    INSERT INTO public.profiles VALUES('${owner}',false);
  `);
  await db.exec(fence); await db.exec(providerMigration); await db.exec(cleanupMigration);
  await db.query(`INSERT INTO public.provider_profiles(id,owner_id,kind,name,categories,regions,contact_name,contact_email,approval_status)
    VALUES($1,$2,'team','Synthetic team',ARRAY['photography'],ARRAY['서울'],'Synthetic owner','owner@example.invalid','approved')`, [provider, owner]);
  for (const [i, status, age] of [[1, "uploading", "40 minutes"], [2, "removed", "40 minutes"], [3, "ready", "40 minutes"], [4, "removed", "10 minutes"], [5, "uploading", "10 minutes"]] as const) {
    await db.query(`INSERT INTO public.provider_media(id,provider_id,storage_path,mime_type,byte_size,status,created_at,rights_confirmed_at)
      VALUES($1,$2,$3,'image/webp',10,$4,now()-$5::interval,CASE WHEN $4='ready' THEN now() ELSE null END)`, [media(i), provider, path(i), status, age]);
  }
  return db;
}
async function claim(db: PGlite, claimToken = token) {
  return (await db.query<{ result: { id: string; status: string; storage_path: string }[] }>("SELECT public.provider_claim_media_cleanup($1,20) AS result", [claimToken])).rows[0].result;
}
async function checkpoint(db: PGlite, id = media(1), claimToken = token, storagePath = path(1)) {
  return (await db.query<{ done: boolean }>("SELECT public.provider_checkpoint_media_cleanup($1,$2,$3) AS done", [id, claimToken, storagePath])).rows[0].done;
}

describe("provider cleanup SQL lifecycle", () => {
  it("claims only removed/abandoned reservations after grace, excluding ready and recent media", async () => {
    const db = await fixture();
    try {
      await db.exec("SET ROLE service_role");
      expect((await claim(db)).map((row) => row.id).sort()).toEqual([media(1), media(2)]);
      expect(await claim(db, anotherToken)).toEqual([]);
      expect(await checkpoint(db, media(1), anotherToken)).toBe(false);
      expect(await checkpoint(db, media(1), token, path(2))).toBe(false);
      expect(await checkpoint(db)).toBe(true);
      expect(await checkpoint(db)).toBe(false);
      await db.exec("RESET ROLE");
      expect((await db.query("SELECT status FROM public.provider_media WHERE id=$1", [media(3)])).rows).toEqual([{ status: "ready" }]);
    } finally { await db.close(); }
  });
  it("prevents direct user cleanup and prevents a reclaimed file from becoming ready", async () => {
    const db = await fixture();
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("SET ROLE authenticated");
      await expect(claim(db)).rejects.toThrow(/permission denied/);
      await expect(checkpoint(db)).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE; SET ROLE service_role"); await claim(db);
      await db.exec("RESET ROLE; SET ROLE authenticated");
      await expect(db.query("SELECT public.provider_finalize_media($1,'caption','description',true)", [media(1)])).rejects.toThrow("PROVIDER_INVALID_STATE");
      await db.exec("RESET ROLE");
      await expect(db.query("UPDATE public.provider_media SET status='ready',rights_confirmed_at=now() WHERE id=$1", [media(1)])).rejects.toThrow(/provider_media_cleanup_removed/);
    } finally { await db.close(); }
  });
  it("releases failed leases for retry while completed rows stay retired", async () => {
    const db = await fixture();
    try {
      await db.exec("SET ROLE service_role"); await claim(db); expect(await checkpoint(db)).toBe(true);
      await db.exec("RESET ROLE"); await db.query("UPDATE public.provider_media SET cleanup_claim_until=now()-interval '1 second' WHERE id=$1", [media(2)]);
      await db.exec("SET ROLE service_role");
      expect((await claim(db, anotherToken)).map((row) => row.id)).toEqual([media(2)]);
      expect(await checkpoint(db, media(2), token, path(2))).toBe(false);
      expect(await checkpoint(db, media(2), anotherToken, path(2))).toBe(true);
    } finally { await db.close(); }
  });
  it("grants only service execution and never deletes storage metadata", async () => {
    const db = await fixture();
    try {
      expect((await db.query(`SELECT has_function_privilege('anon','public.provider_claim_media_cleanup(uuid,integer)','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.provider_claim_media_cleanup(uuid,integer)','EXECUTE') AS member,
        has_function_privilege('service_role','public.provider_claim_media_cleanup(uuid,integer)','EXECUTE') AS worker`)).rows)
        .toEqual([{ anon: false, member: false, worker: true }]);
      expect(cleanupMigration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
    } finally { await db.close(); }
  });
});
