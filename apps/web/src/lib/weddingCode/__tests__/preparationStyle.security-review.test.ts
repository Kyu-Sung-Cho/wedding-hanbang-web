import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { PreparationStyleSnapshot } from "../preparationStyle";

const owner = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const couple = "33333333-3333-4333-8333-333333333333";

async function database() {
  const db = await PGlite.create();
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
  await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260920120000_wedding_preparation_style.sql"), "utf8"));
  await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [owner, peer]);
  await db.query("INSERT INTO public.couples VALUES($1,$2,$3)", [couple, owner, peer]);
  await db.query("INSERT INTO public.profiles VALUES($1,$3,'bride'),($2,$3,'groom')", [owner, peer, couple]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("SET ROLE authenticated");
  return db;
}

it("does not resurrect deleted answers when a delayed first-save request is replayed", async () => {
  const db = await database();
  try {
    const firstRequest = [null, "v1.2-code", "A".repeat(20), "2026-09-20"];
    const save = () => db.query<{ snapshot: PreparationStyleSnapshot }>(
      "SELECT public.set_own_wedding_preparation_style($1,$2,$3,$4) AS snapshot", firstRequest,
    );
    const initial = (await save()).rows[0].snapshot;
    const cleared = await db.query<{ snapshot: PreparationStyleSnapshot }>(
      "SELECT public.clear_own_wedding_preparation_style($1) AS snapshot", [initial.own!.revision],
    );
    expect(cleared.rows[0].snapshot.own).toBeNull();
    await expect(save()).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    const after = await db.query<{ snapshot: PreparationStyleSnapshot }>("SELECT public.get_own_wedding_preparation_style() AS snapshot");
    expect(after.rows[0].snapshot.own).toBeNull();
    expect(after.rows[0].snapshot.stateRevision).toBeGreaterThan(initial.own!.revision);
    await expect(db.query(
      "SELECT public.share_own_wedding_preparation_style($1,$2,$3,'2026-09-20') AS snapshot", [after.rows[0].snapshot.stateRevision, couple, peer],
    )).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    await db.exec("RESET ROLE");
    const stored = await db.query("SELECT scene_version,answer_code,save_consent_version,saved_at FROM public.wedding_preparation_style_responses WHERE owner_user_id=$1", [owner]);
    expect(stored.rows).toEqual([{ scene_version: null, answer_code: null, save_consent_version: null, saved_at: null }]);
    expect((await db.query("SELECT owner_user_id FROM public.wedding_preparation_style_shares")).rows).toEqual([]);
    await db.exec("SET ROLE authenticated");
    const renewed = await db.query<{ snapshot: PreparationStyleSnapshot }>(
      "SELECT public.set_own_wedding_preparation_style($1,$2,$3,$4) AS snapshot", [after.rows[0].snapshot.stateRevision, "v1.2-code", "B".repeat(20), "2026-09-20"],
    );
    expect(renewed.rows[0].snapshot.own?.answerCode).toBe("B".repeat(20));
  } finally {
    await db.close();
  }
}, 30_000);

it.each([false, true])("invalidates delayed approvals across unlink/relink even with existing grant=%s", async existingGrant => {
  const db = await database();
  try {
    const saved = await db.query<{ snapshot: PreparationStyleSnapshot }>(
      "SELECT public.set_own_wedding_preparation_style(NULL,'v1.2-code',$1,'2026-09-20') AS snapshot", ["A".repeat(20)],
    );
    let delayedRevision = saved.rows[0].snapshot.own!.revision;
    if (existingGrant) {
      const shared = await db.query<{ snapshot: PreparationStyleSnapshot }>(
        "SELECT public.share_own_wedding_preparation_style($1,$2,$3,'2026-09-20') AS snapshot", [delayedRevision, couple, peer],
      );
      delayedRevision = shared.rows[0].snapshot.own!.revision;
    }
    await db.exec("RESET ROLE");
    // 각 트랜잭션의 최종 profile/roster를 맞춘다. 관리자 복구도 과거 승인을 새 승인으로 바꾸면 안 된다.
    await db.exec("BEGIN");
    await db.query("UPDATE public.couples SET groom_id=NULL WHERE id=$1", [couple]);
    await db.query("UPDATE public.profiles SET couple_id=NULL,role=NULL WHERE id=$1", [peer]);
    await db.exec("COMMIT; BEGIN");
    await db.query("UPDATE public.couples SET groom_id=$1 WHERE id=$2", [peer, couple]);
    await db.query("UPDATE public.profiles SET couple_id=$1,role='groom' WHERE id=$2", [couple, peer]);
    await db.exec("COMMIT; SET ROLE authenticated");
    await expect(db.query(
      "SELECT public.share_own_wedding_preparation_style($1,$2,$3,'2026-09-20') AS snapshot", [delayedRevision, couple, peer],
    )).rejects.toThrow("PREPARATION_STYLE_REVISION_CONFLICT");
    const after = await db.query<{ snapshot: PreparationStyleSnapshot }>("SELECT public.get_own_wedding_preparation_style() AS snapshot");
    expect(after.rows[0].snapshot.sharing).toBeNull();
    expect(after.rows[0].snapshot.partner).toBeNull();
  } finally {
    await db.close();
  }
}, 30_000);
