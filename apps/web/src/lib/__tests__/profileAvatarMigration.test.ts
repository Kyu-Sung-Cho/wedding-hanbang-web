// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REV = "33333333-3333-4333-8333-333333333333";
const NEXT = "44444444-4444-4444-8444-444444444444";
const JOB = "55555555-5555-4555-8555-555555555555";
const CLAIM = "66666666-6666-4666-8666-666666666666";
let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${USER}'),('${OTHER}');
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid,bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,auth,storage TO service_role,authenticated,anon;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, couple_id uuid);
    CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid, groom_id uuid);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY,user_id uuid,status text,claim_token uuid,quarantine_count integer DEFAULT 0,ready_after timestamptz,claimed_at timestamptz,last_error_code text,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.account_deletion_media_manifest(job_id uuid,bucket text,path text,source text,not_before timestamptz,
      CONSTRAINT account_deletion_media_bucket CHECK (bucket <> ''), CONSTRAINT account_deletion_media_source CHECK (source <> ''));
    CREATE TABLE public.community_upload_sessions(user_id uuid,staging_path text,final_bucket text,final_path text,expires_at timestamptz);
    CREATE FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) RETURNS SETOF public.account_deletion_jobs
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT * FROM public.account_deletion_jobs WHERE false';
    REVOKE ALL ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) TO service_role;
  `);
  const migration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260913082314_private_profile_avatars_delivery.sql"), "utf8");
  await expect(db.exec(migration)).rejects.toThrow("PROFILE_AVATAR_STORAGE_POLICY_REQUIRED");
  await db.exec("ROLLBACK");
  expect((await db.query("SELECT to_regclass('public.profile_avatars') AS selected")).rows).toEqual([{ selected: null }]);
  await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/platform-operations/storage/profile-avatar-service-only.sql"), "utf8"));
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db.close(); });
describe("profile avatar database and deletion transaction", () => {
  it("denies direct anonymous/authenticated table access and function execution", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ allowed: boolean }>(`SELECT has_table_privilege('${role}','public.profile_avatars','SELECT') AS allowed`)).rows[0].allowed).toBe(false);
      expect((await db.query<{ allowed: boolean }>(`SELECT has_function_privilege('${role}','public.save_profile_avatar(uuid,text,text,uuid,uuid)','EXECUTE') AS allowed`)).rows[0].allowed).toBe(false);
    }
    expect((await db.query<{ public: boolean }>("SELECT public FROM storage.buckets WHERE id='profile-avatars'")).rows).toEqual([{ public: false }]);
  });
  it("keeps avatar objects private even if another policy permits all other Storage reads", async () => {
    await db.exec("GRANT SELECT,INSERT ON storage.objects TO authenticated; CREATE POLICY fixture_broad_read ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);");
    await db.query("INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'profile-avatars','private.webp'),($2,'other-bucket','public.webp')", [REV, NEXT]);
    await db.exec("SET ROLE authenticated");
    try {
      expect((await db.query("SELECT name FROM storage.objects")).rows).toEqual([{ name: "public.webp" }]);
      await expect(db.query("INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'profile-avatars','forged.webp')", [USER])).rejects.toThrow(/row-level security/i);
    } finally { await db.exec("RESET ROLE"); }
  });
  it("registers owner path, saves once, and rejects stale revision without replacing current photo", async () => {
    await db.query("SELECT public.register_profile_avatar_asset($1,$2)", [USER, REV]);
    await db.query("SELECT public.save_profile_avatar($1,'photo',NULL,$2,NULL)", [USER, REV]);
    await expect(db.query("SELECT public.save_profile_avatar($1,'initial',NULL,$2,NULL)", [USER, NEXT])).rejects.toThrow("PROFILE_AVATAR_CONFLICT");
    expect((await db.query<{ revision: string }>("SELECT revision FROM profile_avatars WHERE user_id=$1", [USER])).rows[0].revision).toBe(REV);
    await expect(db.query("SELECT public.save_profile_avatar($1,'photo',NULL,$2,NULL)", [OTHER, REV])).rejects.toThrow("PROFILE_AVATAR_ASSET_INVALID");
  });
  it("resets selected avatar while retaining asset proof for later account deletion", async () => {
    await db.query("SELECT public.save_profile_avatar($1,'initial',NULL,$2,$3)", [USER, NEXT, REV]);
    expect((await db.query("SELECT kind,object_path FROM profile_avatars WHERE user_id=$1", [USER])).rows).toEqual([{ kind: "initial", object_path: null }]);
    expect((await db.query("SELECT revision FROM profile_avatar_assets WHERE user_id=$1", [USER])).rows).toHaveLength(1);
  });
  it("deletion refuses new avatar writes and requires the durable asset expiry in its manifest", async () => {
    await db.query("INSERT INTO account_deletion_jobs(id,user_id,status,claim_token) VALUES ($1,$2,'inventorying',$3)", [JOB, USER, CLAIM]);
    await expect(db.query("SELECT public.register_profile_avatar_asset($1,$2)", [USER, NEXT])).rejects.toThrow("PROFILE_AVATAR_DELETION_PENDING");
    await expect(db.query("SELECT public.save_profile_avatar($1,'emoji','🌸',$2,$3)", [USER, REV, NEXT])).rejects.toThrow("PROFILE_AVATAR_DELETION_PENDING");
    const asset = (await db.query<{ object_path: string; upload_until: string }>("SELECT object_path,upload_until::text FROM profile_avatar_assets WHERE revision=$1", [REV])).rows[0];
    const manifest = [{ bucket: "profile-avatars", path: asset.object_path, source: "profile_avatar", not_before: asset.upload_until }];
    await expect(db.query("SELECT public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)", [JOB, CLAIM, JSON.stringify([{ ...manifest[0], not_before: "2020-01-01T00:00:00Z" }])])).rejects.toThrow("PROFILE_AVATAR_DELETION_PROOF_INVALID");
    await db.query("SELECT public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)", [JOB, CLAIM, JSON.stringify(manifest)]);
    expect((await db.query("SELECT bucket,source FROM account_deletion_media_manifest WHERE job_id=$1", [JOB])).rows).toEqual([{ bucket: "profile-avatars", source: "profile_avatar" }]);
  });
  it("reads only the owner and current mutual partner from a single snapshot", async () => {
    await db.query("INSERT INTO profiles(id,couple_id) VALUES ($1,$3),($2,$3);", [USER,OTHER,REV]);
    await db.query("INSERT INTO couples(id,bride_id,groom_id) VALUES ($1,$2,$3)", [REV,USER,OTHER]);
    await db.query("SELECT public.save_profile_avatar($1,'emoji','🌸',$2,NULL)", [OTHER,CLAIM]);
    expect((await db.query<{user_id:string}>("SELECT user_id FROM read_profile_avatar_snapshot($1) ORDER BY user_id",[USER])).rows.map(row=>row.user_id)).toEqual([USER,OTHER]);
    await db.query("UPDATE profiles SET couple_id=NULL WHERE id=$1",[OTHER]);
    expect((await db.query<{user_id:string}>("SELECT user_id FROM read_profile_avatar_snapshot($1)",[USER])).rows).toEqual([{user_id:USER}]);
    await db.query("UPDATE profiles SET couple_id=$2 WHERE id=$1",[OTHER,REV]);
    await db.query("UPDATE couples SET groom_id=NULL WHERE id=$1",[REV]);
    expect((await db.query<{user_id:string}>("SELECT user_id FROM read_profile_avatar_snapshot($1)",[USER])).rows).toEqual([{user_id:USER}]);
    for(const role of ["anon","authenticated"]) expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege($1,'public.read_profile_avatar_snapshot(uuid)','EXECUTE') AS allowed",[role])).rows[0].allowed).toBe(false);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='profile_avatars' AND column_name='confirmed_role'")).rows).toEqual([]);
  });
  it("rejects an ABA stale revision even when the visible emoji returns to its old value", async () => {
    const a="77777777-7777-4777-8777-777777777777",b="88888888-8888-4888-8888-888888888888";
    await db.query("SELECT public.save_profile_avatar($1,'initial',NULL,$2,$3)",[OTHER,a,CLAIM]);
    await db.query("SELECT public.save_profile_avatar($1,'emoji','🌸',$2,$3)",[OTHER,b,a]);
    await expect(db.query("SELECT public.save_profile_avatar($1,'initial',NULL,$2,$3)",[OTHER,REV,CLAIM])).rejects.toThrow("PROFILE_AVATAR_CONFLICT");
    expect((await db.query("SELECT revision FROM profile_avatars WHERE user_id=$1",[OTHER])).rows).toEqual([{revision:b}]);
  });
  it("account deletion cascades selected avatar and asset rows", async () => {
    await db.query("DELETE FROM auth.users WHERE id=$1", [USER]);
    expect((await db.query("SELECT * FROM profile_avatars WHERE user_id=$1", [USER])).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM profile_avatar_assets WHERE user_id=$1", [USER])).rows).toHaveLength(0);
  });
});
