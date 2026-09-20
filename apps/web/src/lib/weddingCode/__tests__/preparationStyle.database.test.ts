import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WEDDING_CODE_V12_QUESTIONS } from "@/constants/weddingCodeV12";
import type { PreparationStyleSnapshot } from "../preparationStyle";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const COUPLE = "44444444-4444-4444-8444-444444444444";
const CODE = "A".repeat(20);
const migration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260920120000_wedding_preparation_style.sql"), "utf8");
let db: PGlite;
async function actor(user: string | null, role = "authenticated") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`SET ROLE ${role}`);
}
async function call(name: string, params: unknown[] = []): Promise<PreparationStyleSnapshot> {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
  const result = await db.query<{ snapshot: PreparationStyleSnapshot }>(`SELECT public.${name}(${placeholders}) AS snapshot`, params);
  return result.rows[0].snapshot;
}
const get = () => call("get_own_wedding_preparation_style");
const save = (revision: number | null = null, code = CODE, version = "v1.2-code", consent = "2026-09-20") => call("set_own_wedding_preparation_style", [revision, version, code, consent]);
const share = (revision: number, peer = PEER, couple = COUPLE, consent = "2026-09-20") => call("share_own_wedding_preparation_style", [revision, couple, peer, consent]);
async function mutual() {
  await actor(OWNER); const first = await save(); const firstShared = await share(first.own!.revision);
  await actor(PEER); const second = await save(null, "B".repeat(20)); const secondShared = await share(second.own!.revision, OWNER);
  return { first: firstShared.own!, second: secondShared.own! };
}

describe("preparation style SQL privacy and lifecycle", () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,couple_id uuid,role text);
      CREATE TABLE public.account_deletion_jobs(user_id uuid,status text NOT NULL);
      CREATE FUNCTION public.is_current_couple_member(p_user uuid,p_couple uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN public.couples c ON c.id=p.couple_id
          WHERE p.id=p_user AND p.couple_id=p_couple AND ((p.role='bride' AND c.bride_id=p_user) OR (p.role='groom' AND c.groom_id=p_user)))
      $$;
    `);
    await db.exec(migration);
  }, 30_000);
  beforeEach(async () => {
    await db.exec("RESET ROLE; TRUNCATE public.wedding_preparation_style_responses,public.account_deletion_jobs,public.profiles,public.couples,auth.users CASCADE;");
    await db.query("INSERT INTO auth.users(id) VALUES ($1),($2),($3)", [OWNER, PEER, OTHER]);
    await db.query("INSERT INTO public.couples VALUES($1,$2,$3)", [COUPLE, OWNER, PEER]);
    await db.query("INSERT INTO public.profiles VALUES($1,$4,'bride'),($2,$4,'groom'),($3,NULL,NULL)", [OWNER, PEER, OTHER, COUPLE]);
    await actor(OWNER);
  });
  afterAll(async () => { await db?.close(); });

  it("keeps both answers private until both current members consent, then revokes on answer change", async () => {
    const first = await save();
    await actor(PEER); const second = await save(null, "B".repeat(20));
    expect((await get()).partner).toBeNull();
    await actor(OWNER); const firstShared = await share(first.own!.revision); expect(firstShared.partner).toBeNull();
    await actor(PEER); expect((await get()).partner).toBeNull();
    expect((await share(second.own!.revision, OWNER)).partner?.answerCode).toBe(CODE);
    await actor(OWNER); expect((await get()).partner?.answerCode).toBe("B".repeat(20));
    const updated = await save(firstShared.own!.revision, "B" + CODE.slice(1));
    expect(updated.sharing).toBeNull(); expect(updated.partner).toBeNull();
    await actor(PEER); expect((await get()).partner).toBeNull();
    expect((await get()).own?.answerCode).toBe("B".repeat(20));
  });

  it("uses CAS, idempotent saved values and revisions that do not restart after deleting", async () => {
    const first = await save(); const shared = await share(first.own!.revision);
    const retry = await save();
    expect(retry.own).toEqual(shared.own); expect(retry.sharing).not.toBeNull();
    await expect(save(null, "B" + CODE.slice(1))).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    await expect(call("clear_own_wedding_preparation_style", [first.own!.revision])).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    const cleared = await call("clear_own_wedding_preparation_style", [shared.own!.revision]);
    expect((await call("clear_own_wedding_preparation_style", [shared.own!.revision])).own).toBeNull();
    await expect(save()).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    const replacement = await save(cleared.stateRevision);
    expect(replacement.own!.revision).toBeGreaterThan(first.own!.revision);
    await expect(call("clear_own_wedding_preparation_style", [first.own!.revision])).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
  });

  it("clears both sharing grants on unlink and does not resurrect them on a later roster restoration", async () => {
    const { first } = await mutual();
    await db.exec("RESET ROLE");
    await db.query("UPDATE public.profiles SET couple_id=NULL,role=NULL WHERE id=$1", [PEER]);
    await actor(OWNER); expect((await get()).partner).toBeNull(); expect((await get()).sharing).toBeNull();
    expect((await get()).stateRevision).toBeGreaterThan(first.revision);
    await db.exec("RESET ROLE");
    await db.query("UPDATE public.profiles SET couple_id=$1,role='groom' WHERE id=$2", [COUPLE, PEER]);
    await actor(OWNER); expect((await get()).partner).toBeNull(); expect((await get()).sharing).toBeNull();
    await db.exec("RESET ROLE");
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.wedding_preparation_style_responses")).rows[0].count).toBe(2);
  });

  it("retains only owner and control revision after deleting, rejects tombstone sharing, and purges metadata on account deletion", async () => {
    const first = await save(); const cleared = await call("clear_own_wedding_preparation_style", [first.stateRevision]);
    expect(cleared.own).toBeNull(); expect(cleared.stateRevision).toBeGreaterThan(first.stateRevision!);
    await expect(share(cleared.stateRevision!)).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    await db.exec("RESET ROLE");
    const rows = await db.query("SELECT * FROM public.wedding_preparation_style_responses WHERE owner_user_id=$1", [OWNER]);
    expect(rows.rows).toEqual([{ owner_user_id: OWNER, revision: cleared.stateRevision, scene_version: null, answer_code: null, saved_at: null, save_consent_version: null }]);
    await db.query("INSERT INTO public.account_deletion_jobs VALUES($1,'pending')", [OWNER]);
    expect((await db.query("SELECT * FROM public.wedding_preparation_style_responses WHERE owner_user_id=$1", [OWNER])).rows).toEqual([]);
  });

  it("rejects a stale membership, unrelated partner, absent consent and anonymous/service access", async () => {
    const first = await save();
    await expect(share(first.own!.revision, OTHER)).rejects.toThrow("PREPARATION_STYLE_MEMBERSHIP_CONFLICT");
    await expect(share(first.own!.revision, PEER, OTHER)).rejects.toThrow("PREPARATION_STYLE_MEMBERSHIP_CONFLICT");
    await expect(share(first.own!.revision, PEER, COUPLE, "")).rejects.toThrow("PREPARATION_STYLE_INVALID_INPUT");
    await actor(OTHER); expect((await get()).own).toBeNull(); expect((await get()).partner).toBeNull();
    await expect(db.query("SELECT * FROM public.wedding_preparation_style_responses")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO public.wedding_preparation_style_responses(owner_user_id,scene_version,answer_code,save_consent_version) VALUES($1,'v1.2-code',$2,'2026-09-20')", [OTHER, CODE])).rejects.toThrow(/permission denied/);
    await actor(null, "anon"); await expect(get()).rejects.toThrow(/permission denied/);
    await actor(OWNER, "service_role"); await expect(get()).rejects.toThrow(/permission denied/);
    await actor(null); await expect(get()).rejects.toThrow("PREPARATION_STYLE_AUTH_REQUIRED");
  });

  it("purges the deleting user's payload on job acceptance and blocks stale-session writes/reads", async () => {
    const { first } = await mutual();
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO public.account_deletion_jobs VALUES($1,'pending')", [PEER]);
    await actor(PEER); await expect(save()).rejects.toThrow("PREPARATION_STYLE_ACCOUNT_UNAVAILABLE");
    await expect(get()).rejects.toThrow("PREPARATION_STYLE_ACCOUNT_UNAVAILABLE");
    await actor(OWNER); const preserved = await get();
    expect(preserved.own).toEqual(first); expect(preserved.partner).toBeNull(); expect(preserved.sharing).toBeNull();
    await db.exec("RESET ROLE");
    const rows = await db.query<{ owner_user_id: string }>("SELECT owner_user_id FROM public.wedding_preparation_style_responses");
    expect(rows.rows).toEqual([{ owner_user_id: OWNER }]);
    await db.query("DELETE FROM auth.users WHERE id=$1", [PEER]);
    await actor(OWNER); expect((await get()).own).toEqual(first);
  });

  it("deletes own raw answers and sharing when the profile is removed without touching the peer's answer", async () => {
    const { second } = await mutual();
    await db.exec("RESET ROLE"); await db.query("DELETE FROM auth.users WHERE id=$1", [OWNER]);
    await actor(PEER); expect((await get()).own).toEqual(second); expect((await get()).sharing).toBeNull(); expect((await get()).partner).toBeNull();
  });

  it("revokes an explicit share without deleting either person's response", async () => {
    const { first } = await mutual();
    await actor(OWNER); const cleared = await call("unshare_own_wedding_preparation_style", [first.revision]);
    expect(cleared.own).toMatchObject({ answerCode: first.answerCode, savedAt: first.savedAt });
    expect(cleared.own!.revision).toBeGreaterThan(first.revision); expect(cleared.sharing).toBeNull(); expect(cleared.partner).toBeNull();
    await actor(PEER); expect((await get()).partner).toBeNull(); expect((await get()).own).not.toBeNull();
  });

  it("rejects delayed approval after revocation, delayed revocation after reapproval, and pre-share saves", async () => {
    const first = await save(); const shared = await share(first.own!.revision);
    expect(shared.own!.revision).toBeGreaterThan(first.own!.revision);
    expect(shared.sharing!.responseRevision).toBe(shared.own!.revision);
    await expect(save(first.own!.revision, "B" + CODE.slice(1))).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    const revoked = await call("unshare_own_wedding_preparation_style", [shared.own!.revision]);
    await expect(share(first.own!.revision)).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    await expect(share(shared.own!.revision)).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    expect((await get()).sharing).toBeNull();
    const reapproved = await share(revoked.own!.revision);
    await expect(call("unshare_own_wedding_preparation_style", [shared.own!.revision])).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    expect((await get()).sharing!.responseRevision).toBe(reapproved.own!.revision);
    expect(reapproved.own!.savedAt).toBe(first.own!.savedAt);
    await call("clear_own_wedding_preparation_style", [reapproved.own!.revision]);
    expect((await call("unshare_own_wedding_preparation_style", [reapproved.own!.revision])).own).toBeNull();
  });

  it("enforces the exact current choices in SQL, including sparse answers, and rejects older or empty submissions", async () => {
    let revision: number | null = null;
    for (const [index, question] of WEDDING_CODE_V12_QUESTIONS.entries()) {
      for (const character of ["A", "B", "C", "D", "-"]) {
        const code = CODE.slice(0, index) + character + CODE.slice(index + 1);
        if (character === "-" || question.options.some(option => option.value === character)) revision = (await save(revision, code)).own!.revision;
        else await expect(save(revision, code)).rejects.toThrow("PREPARATION_STYLE_INVALID_INPUT");
      }
    }
    revision = (await save(revision, "A" + "-".repeat(19))).own!.revision;
    for (const code of ["-".repeat(20), CODE.toLowerCase(), CODE + "\n", "A".repeat(16)]) await expect(save(revision, code)).rejects.toThrow("PREPARATION_STYLE_INVALID_INPUT");
    await expect(save(revision, CODE, "v1.1-code")).rejects.toThrow("PREPARATION_STYLE_INVALID_INPUT");
    await expect(save(revision, CODE, "v1.2-code", "")).rejects.toThrow("PREPARATION_STYLE_INVALID_INPUT");
  });
});
