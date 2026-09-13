// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const COUPLE = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
interface Role { user_id: string; confirmed_role: "bride" | "groom" | null; revision: string }
let db: PGlite;
const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260913075045_profile_wedding_roles.sql"), "utf8");
async function save(id: string, role: string | null, revision: string | null) {
  return (await db.query<{ value: Role }>("SELECT public.save_profile_wedding_role($1,$2,$3) AS value", [id, role, revision])).rows[0].value;
}
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, couple_id uuid, name text, avatar_url text);
    CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY,user_id uuid,status text);
    GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated,anon;`);
  // 실제 기존 fixture에는 이 경로가 없다. 정확한 새 SQL을 적용한 뒤 같은 호출을 검증한다.
  await expect(db.query("SELECT public.read_profile_wedding_roles($1)", [A])).rejects.toThrow(/does not exist/);
  await db.exec(sql);
}, 30000);
beforeEach(async () => {
  await db.exec("TRUNCATE auth.users CASCADE; TRUNCATE public.profiles,public.couples,public.account_deletion_jobs;");
  await db.query("INSERT INTO auth.users VALUES ($1),($2),($3)", [A, B, C]);
  await db.query("INSERT INTO profiles VALUES ($1,'bride',$4,'original','kept'),($2,'groom',$4,'partner',NULL),($3,NULL,$5,'other',NULL)", [A,B,C,COUPLE,OTHER]);
  await db.query("INSERT INTO couples VALUES ($1,$2,$3),($4,$5,NULL)", [COUPLE,A,B,OTHER,C]);
});
afterAll(async () => { await db.close(); });
describe("photo-independent explicit wedding roles", () => {
  it("keeps table/RPC access service-only and enables RLS without Storage objects", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const fn of ["public.save_profile_wedding_role(uuid,text,uuid)", "public.read_profile_wedding_roles(uuid)"]) {
        expect((await db.query<{ allowed: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role,fn])).rows[0].allowed).toBe(false);
      }
      expect((await db.query<{ allowed: boolean }>("SELECT has_table_privilege($1,'public.profile_wedding_roles','SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])).rows[0].allowed).toBe(false);
    }
    expect((await db.query<{ enabled: boolean }>("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='public.profile_wedding_roles'::regclass")).rows[0].enabled).toBe(true);
    await db.exec("SET ROLE service_role");
    try { expect((await db.query("SELECT * FROM public.read_profile_wedding_roles($1)", [A])).rows).toHaveLength(2); }
    finally { await db.exec("RESET ROLE"); }
    expect((await db.query("SELECT oid FROM pg_namespace WHERE nspname='storage'")).rows).toHaveLength(0);
  });
  it("requires explicit input, preserves authorization slots/name/photo, and accepts independent same-role choices", async () => {
    await expect(save(A,"partner",null)).rejects.toThrow("PROFILE_ROLE_INVALID");
    const first = await save(A,"groom",null);
    await save(B,"groom",null);
    expect(first.confirmed_role).toBe("groom");
    expect((await db.query("SELECT role,name,avatar_url FROM profiles WHERE id=$1",[A])).rows).toEqual([{role:"bride",name:"original",avatar_url:"kept"}]);
    expect((await db.query("SELECT confirmed_role,revision FROM public.read_profile_wedding_roles($1) WHERE user_id=$2",[A,C])).rows).toHaveLength(0);
  });
  it("rejects stale initial/save/reset and ABA revisions without losing the latest choice", async () => {
    const first = await save(A,"groom",null);
    await expect(save(A,"bride",null)).rejects.toThrow("PROFILE_ROLE_CONFLICT");
    const second = await save(A,"bride",first.revision);
    const third = await save(A,"groom",second.revision);
    expect(new Set([first.revision,second.revision,third.revision]).size).toBe(3);
    await expect(save(A,null,first.revision)).rejects.toThrow("PROFILE_ROLE_CONFLICT");
    const reset = await save(A,null,third.revision);
    expect(reset.confirmed_role).toBeNull(); expect(reset.revision).not.toBe(third.revision);
  });
  it("only reads the current mutual partner and never old/unrelated/mismatched roster members", async () => {
    await save(B,"bride",null); await save(C,"groom",null);
    expect((await db.query<{user_id:string}>("SELECT * FROM public.read_profile_wedding_roles($1)",[A])).rows.map(row=>row.user_id).sort()).toEqual([A,B]);
    await db.query("UPDATE profiles SET couple_id=$1 WHERE id=$2",[OTHER,B]);
    expect((await db.query<{user_id:string}>("SELECT * FROM public.read_profile_wedding_roles($1)",[A])).rows.map(row=>row.user_id)).toEqual([A]);
    await db.query("UPDATE couples SET bride_id=$1 WHERE id=$2",[C,COUPLE]);
    expect((await db.query<{user_id:string}>("SELECT * FROM public.read_profile_wedding_roles($1)",[A])).rows.map(row=>row.user_id)).toEqual([A]);
  });
  it("returns real missing rows as neutral and no row for deleted/unknown owners", async () => {
    expect((await db.query("SELECT confirmed_role,revision FROM public.read_profile_wedding_roles($1) WHERE user_id=$1",[A])).rows).toEqual([{confirmed_role:null,revision:null}]);
    expect((await db.query("SELECT * FROM public.read_profile_wedding_roles($1)",[OTHER])).rows).toHaveLength(0);
  });
  it("blocks pending deletion, preserves the saved value, and cascades on auth user removal", async () => {
    const saved = await save(A,"bride",null);
    await db.query("INSERT INTO account_deletion_jobs VALUES($1,$2,'inventorying')",[OTHER,A]);
    await expect(save(A,null,saved.revision)).rejects.toThrow("PROFILE_ROLE_DELETION_PENDING");
    await db.query("DELETE FROM auth.users WHERE id=$1",[A]);
    expect((await db.query("SELECT * FROM profile_wedding_roles WHERE user_id=$1",[A])).rows).toHaveLength(0);
    await expect(save(A,"groom",null)).rejects.toThrow("PROFILE_ROLE_OWNER_MISSING");
  });
});
