// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readProfileWeddingRole, saveProfileWeddingRole } from "@/lib/profileWeddingRole";
import { readChatActorDisplayRole } from "../chatActorDisplayRole";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
let db: PGlite;

// Supabase 경계만 실제 로컬 SQL로 연결한다. 저장/조회 helper와 정본 migration은 그대로 쓴다.
const client = {
  async rpc(name: string, args: Record<string, unknown>) {
    try {
      if (name === "save_profile_wedding_role") {
        const result = await db.query<{ value: unknown }>(
          "SELECT public.save_profile_wedding_role($1,$2,$3) AS value",
          [args.p_user_id, args.p_confirmed_role, args.p_expected_revision],
        );
        return { data: result.rows[0].value, error: null };
      }
      if (name === "read_profile_wedding_roles") {
        return { data: (await db.query("SELECT * FROM public.read_profile_wedding_roles($1)", [args.p_user_id])).rows, error: null };
      }
      throw new Error("unexpected RPC");
    } catch (error) { return { data: null, error }; }
  },
  from(table: string) {
    if (!["profiles", "profile_wedding_roles"].includes(table)) throw new Error("unexpected relation");
    return { select(columns: string) {
      if (!["confirmed_role", "user_id,confirmed_role"].includes(columns)) throw new Error("unexpected projection");
      return { eq(column: string, actorId: string) {
        if (!["id", "user_id"].includes(column)) throw new Error("unexpected owner key");
        const read = async () => {
          try {
            const rows = (await db.query(`SELECT ${columns} FROM public.${table} WHERE ${column}=$1`, [actorId])).rows;
            return { data: rows[0] ?? null, error: null };
          } catch (error) { return { data: null, error }; }
        };
        return { single: read, maybeSingle: read };
      } };
    } };
  },
} as unknown as SupabaseClient;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, couple_id uuid);
    CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY,user_id uuid,status text);
    GRANT USAGE ON SCHEMA public,auth TO service_role;
    GRANT SELECT ON public.profiles TO service_role;`);
  await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260913075045_profile_wedding_roles.sql"), "utf8"));
  await db.query("INSERT INTO auth.users VALUES ($1),($2)", [ACTOR, PARTNER]);
  await db.query("INSERT INTO profiles VALUES ($1,'bride',$3),($2,'groom',$3)", [ACTOR, PARTNER, COUPLE]);
  await db.query("INSERT INTO couples VALUES ($1,$2,$3)", [COUPLE, ACTOR, PARTNER]);
  await db.exec("SET ROLE service_role");
}, 30_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("TRUNCATE public.profile_wedding_roles"); });

describe("settings-to-chat canonical selected role", () => {
  it("reads the actor's saved choice from the actual role schema instead of a profile column, slot or partner", async () => {
    const actorSaved = await saveProfileWeddingRole(client, ACTOR, "groom", null);
    await saveProfileWeddingRole(client, PARTNER, "bride", null);
    expect(actorSaved.confirmed_role).toBe("groom");
    expect(await readChatActorDisplayRole(client, ACTOR)).toBe("groom");
  });

  it("agrees with the settings projection for an absent choice and an explicitly cleared choice", async () => {
    expect((await readProfileWeddingRole(client, ACTOR)).confirmed_role).toBeNull();
    expect(await readChatActorDisplayRole(client, ACTOR)).toBe("not_selected");
    const saved = await saveProfileWeddingRole(client, ACTOR, "bride", null);
    expect(await readChatActorDisplayRole(client, ACTOR)).toBe("bride");
    await saveProfileWeddingRole(client, ACTOR, null, saved.revision);
    expect((await readProfileWeddingRole(client, ACTOR)).confirmed_role).toBeNull();
    expect(await readChatActorDisplayRole(client, ACTOR)).toBe("not_selected");
  });
});
