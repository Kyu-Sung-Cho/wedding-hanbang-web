// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 234가 만들고 235가 v0.9까지 넓힌 익명 연구 기여 저장소에 236을 이어 적용한다. 236은 장면 버전 CHECK에
// 'v1.0-code' 하나만 더한다. 답 코드 규칙·권한·RLS·함수는 그대로여야 하고, 적용 직후 검증 블록은 그중 하나라도
// 어긋나면 전체를 되돌려야 한다. (234·235 자체의 동작 테스트는 각자의 migration 테스트가 맡는다.)
const migrations = resolve(process.cwd(), "../../supabase/migrations");
const store = readFileSync(resolve(migrations, "20260915130000_wedding_code_research_contributions.sql"), "utf8");
const widenV09 = readFileSync(resolve(migrations, "20260917090000_wedding_code_research_scene_v09.sql"), "utf8");
const widen = readFileSync(resolve(migrations, "20260918090000_wedding_code_research_scene_v10.sql"), "utf8");
const verifyBlock = widen.slice(widen.indexOf("DO $verify_wedding_code_scene_v10$"), widen.lastIndexOf("\n\nCOMMIT;\n"));
const CONSENT = "wc-research-consent-v3";
const ANSWER = "ABCD-ABCD-ABCD-ABCD-";
const WIDENED = "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text, 'v1.0-code'::text]))";
const V09_WIDENED = "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))";
const FUNCTIONS = [
  "delete_wedding_code_research_contribution",
  "insert_wedding_code_research_contribution",
  "purge_expired_wedding_code_research_contributions",
] as const;
const hash = (byte: number) => new Uint8Array(32).fill(byte);
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
let db: PGlite;

// 새 PGlite에 Supabase처럼 앱 역할 기본 권한을 깔고 234·235를 적용한다. 그래야 236이 권한을 넓히지 않는지 드러난다.
async function createStore(): Promise<PGlite> {
  const instance = await PGlite.create();
  await instance.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  await instance.exec(store);
  await instance.exec(widenV09);
  return instance;
}
async function asRole<T>(role: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try { return await work(); } finally { await db.exec("RESET ROLE"); }
}
function insert(scene: string, receipt: Uint8Array, answer = ANSWER, target = db) {
  return target.query("SELECT public.insert_wedding_code_research_contribution($1,$2,$3,$4)", [scene, answer, CONSENT, receipt]);
}
async function sceneCheck(target = db) {
  return (await target.query<{ def: string; validated: boolean }>(`SELECT pg_get_constraintdef(oid, true) AS def, convalidated AS validated
    FROM pg_constraint WHERE conrelid = 'public.wedding_code_research_contributions'::regclass
    AND conname = 'wcr_contributions_scene_version'`)).rows;
}
async function constraintDefinitions() {
  return (await db.query<{ conname: string; def: string }>(`SELECT conname, pg_get_constraintdef(oid, true) AS def FROM pg_constraint
    WHERE conrelid IN ('public.wedding_code_research_contributions'::regclass, 'public.wedding_code_research_deletion_tombstones'::regclass)
    AND contype <> 'n' ORDER BY conname`)).rows;
}

let constraintsBefore: { conname: string; def: string }[];
beforeAll(async () => {
  db = await createStore();
  // 운영처럼 236 전에 이미 받은 v0.8-code·v0.9-code 응답이 있다. 236은 이 행을 건드리지 않고 검증만 통과해야 한다.
  await asRole("service_role", async () => {
    await insert("v0.8-code", hash(1));
    await insert("v0.9-code", hash(2));
  });
  await expect(asRole("service_role", () => insert("v1.0-code", hash(3)))).rejects.toThrow(/wcr_contributions_scene_version/);
  constraintsBefore = await constraintDefinitions();
  expect(await sceneCheck()).toEqual([{ def: V09_WIDENED, validated: true }]);
  await db.exec(widen);
}, 30_000);
beforeEach(async () => {
  await db.query("DELETE FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash NOT IN ($1, $2)", [hash(1), hash(2)]);
  await db.exec("TRUNCATE public.wedding_code_research_deletion_tombstones");
});
afterAll(async () => { await db.close(); });

describe("WeddingCode research scene v1.0 widening (236 after 234 and 235)", () => {
  it("accepts v1.0-code through the service_role function, still accepts v0.8-code and v0.9-code, and keeps the earlier rows", async () => {
    await asRole("service_role", async () => {
      await insert("v1.0-code", hash(10));
      await insert("v0.9-code", hash(11));
      await insert("v0.8-code", hash(12));
    });
    const rows = await db.query<{ scene_version: string; answer_code: string; receipt: string }>(`SELECT scene_version, answer_code,
      encode(deletion_receipt_hash, 'hex') AS receipt FROM public.wedding_code_research_contributions ORDER BY receipt`);
    expect(rows.rows).toEqual([
      { scene_version: "v0.8-code", answer_code: ANSWER, receipt: "01".repeat(32) },
      { scene_version: "v0.9-code", answer_code: ANSWER, receipt: "02".repeat(32) },
      { scene_version: "v1.0-code", answer_code: ANSWER, receipt: "0a".repeat(32) },
      { scene_version: "v0.9-code", answer_code: ANSWER, receipt: "0b".repeat(32) },
      { scene_version: "v0.8-code", answer_code: ANSWER, receipt: "0c".repeat(32) },
    ]);
    expect(await sceneCheck()).toEqual([{ def: WIDENED, validated: true }]);
  });

  it.each(["v1.1-code", "", "v1.0", "V1.0-CODE", "v1.0-code ", "v10-code", "v0.7-code", "v0.9-code,v1.0-code"])(
    "rejects scene version %j", async (scene) => {
      await asRole("service_role", async () => {
        await expect(insert(scene, hash(20))).rejects.toThrow(/violates check constraint "wcr_contributions_scene_version"/);
      });
      expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.wedding_code_research_contributions")).rows).toEqual([{ n: 2 }]);
    },
  );

  it.each([
    ["a 19-character answer code", "ABCD-ABCD-ABCD-ABCD"],
    ["a 21-character answer code", "ABCD-ABCD-ABCD-ABCD-A"],
    ["a lowercase answer code", "abcd-abcd-abcd-abcd-"],
    ["an all-skip answer code", "--------------------"],
    ["a letter outside A-D", "ABCE-ABCD-ABCD-ABCD-"],
  ])("keeps the answer code rule for v1.0-code: rejects %s", async (_name, answer) => {
    await asRole("service_role", async () => {
      await expect(insert("v1.0-code", hash(21), answer)).rejects.toThrow(/violates check constraint "wcr_contributions_answer_code"/);
      await insert("v1.0-code", hash(22), "AAAAAAAAAAAAAAAAAAAA");
    });
  });

  it("changes only the scene version constraint; every other constraint definition is byte-identical", async () => {
    const after = await constraintDefinitions();
    expect(after.map((row) => row.conname)).toEqual(constraintsBefore.map((row) => row.conname));
    expect(after.filter((row) => row.conname !== "wcr_contributions_scene_version"))
      .toEqual(constraintsBefore.filter((row) => row.conname !== "wcr_contributions_scene_version"));
    expect(constraintsBefore.find((row) => row.conname === "wcr_contributions_scene_version")?.def).toBe(V09_WIDENED);
    expect(after.find((row) => row.conname === "wcr_contributions_scene_version")?.def).toBe(WIDENED);
  });

  it("keeps privileges, RLS and the three owner-rights functions exactly as 234 left them", async () => {
    for (const role of ["service_role", "authenticated", "anon"]) {
      await asRole(role, async () => {
        await expect(db.query("SELECT * FROM public.wedding_code_research_contributions")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT * FROM public.wedding_code_research_deletion_tombstones")).rejects.toThrow(/permission denied/);
      });
    }
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(insert("v1.0-code", hash(30))).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.purge_expired_wedding_code_research_contributions()")).rejects.toThrow(/permission denied/);
      });
    }
    const acl = await db.query<{ relname: string; relacl: string; relrowsecurity: boolean; policies: number }>(`SELECT c.relname,
      c.relacl::text AS relacl, c.relrowsecurity, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.relname LIKE 'wedding_code_research_%' AND c.relkind = 'r' ORDER BY c.relname`);
    expect(acl.rows).toEqual([
      { relname: "wedding_code_research_contributions", relacl: "{postgres=arwdDxtm/postgres}", relrowsecurity: true, policies: 0 },
      { relname: "wedding_code_research_deletion_tombstones", relacl: "{postgres=arwdDxtm/postgres}", relrowsecurity: true, policies: 0 },
    ]);
    const bodies = new Map([...store.matchAll(/^CREATE FUNCTION public\.(\w+)\([\s\S]*?\nAS \$function\$([\s\S]*?)\$function\$;$/gm)]
      .map(([, name, body]) => [name, md5(body)]));
    const functions = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[]; proacl: string; body: string }>(`SELECT
      proname, prosecdef, proconfig, proacl::text AS proacl, md5(prosrc) AS body FROM pg_proc WHERE proname = ANY($1) ORDER BY proname`, [FUNCTIONS]);
    expect(functions.rows).toEqual(FUNCTIONS.map((name) => ({ proname: name, prosecdef: true, proconfig: ['search_path=""'],
      proacl: "{postgres=X/postgres,service_role=X/postgres}", body: bodies.get(name) })));
    expect(widen).not.toMatch(/\b(?:GRANT|REVOKE|CREATE|POLICY|DISABLE)\b/);
  });

  // 검증 블록이 실제로 문다: 각 위반을 심은 트랜잭션 안에서 돌리면 RAISE EXCEPTION이 나야 한다.
  it.each([
    ["the CHECK was widened to a pattern", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version ~ '^v[0-9][.][0-9]-code$')`, "WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED"],
    ["the CHECK stayed at the 235 list", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code'))`, "WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED"],
    ["v0.9-code was dropped", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v1.0-code')) NOT VALID`, "WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED"],
    ["the CHECK was left unvalidated", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code', 'v1.0-code')) NOT VALID`,
    "WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED"],
    ["an extra constraint was added", "ALTER TABLE public.wedding_code_research_contributions ADD CONSTRAINT extra_rule CHECK (true)",
      "WEDDING_CODE_SCENE_V10_CONSTRAINT_SET_CHANGED"],
    ["RLS was disabled", "ALTER TABLE public.wedding_code_research_deletion_tombstones DISABLE ROW LEVEL SECURITY", "WEDDING_CODE_SCENE_V10_RLS_DISABLED"],
    ["a policy was added", "CREATE POLICY open_read ON public.wedding_code_research_contributions USING (true)", "WEDDING_CODE_SCENE_V10_POLICY_PRESENT"],
    ["a table grant was added", "GRANT SELECT ON public.wedding_code_research_contributions TO anon", "WEDDING_CODE_SCENE_V10_TABLE_PRIVILEGE_OPEN"],
    ["a column grant was added", "GRANT SELECT (scene_version) ON public.wedding_code_research_contributions TO authenticated",
      "WEDDING_CODE_SCENE_V10_TABLE_PRIVILEGE_OPEN"],
    ["a function became SECURITY INVOKER", "ALTER FUNCTION public.purge_expired_wedding_code_research_contributions() SECURITY INVOKER",
      "WEDDING_CODE_SCENE_V10_FUNCTION_CHANGED"],
    ["a function body changed", `CREATE OR REPLACE FUNCTION public.purge_expired_wedding_code_research_contributions() RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$ BEGIN RETURN 0; END; $body$`, "WEDDING_CODE_SCENE_V10_FUNCTION_CHANGED"],
    ["a function lost its signature", "DROP FUNCTION public.delete_wedding_code_research_contribution(bytea)", "WEDDING_CODE_SCENE_V10_FUNCTION_MISSING"],
    ["authenticated may execute a function", "GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO authenticated",
      "WEDDING_CODE_SCENE_V10_FUNCTION_PRIVILEGE_OPEN"],
    ["service_role lost execute", "REVOKE EXECUTE ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea) FROM service_role",
      "WEDDING_CODE_SCENE_V10_FUNCTION_PRIVILEGE_MISSING"],
  ])("the post-apply verification block rejects a state where %s", async (_name, tamper, expected) => {
    await db.exec("BEGIN");
    try {
      await db.exec(verifyBlock);
      await db.exec(tamper);
      await expect(db.exec(verifyBlock)).rejects.toThrow(expected);
    } finally {
      await db.exec("ROLLBACK");
    }
    await db.exec(verifyBlock);
  });

  it("rolls the whole migration back when its verification fails, leaving the 235 CHECK in place", async () => {
    const other = await createStore();
    try {
      await other.exec("GRANT SELECT ON public.wedding_code_research_contributions TO anon");
      await expect(other.exec(widen)).rejects.toThrow("WEDDING_CODE_SCENE_V10_TABLE_PRIVILEGE_OPEN");
      await other.exec("ROLLBACK");
      expect(await sceneCheck(other)).toEqual([{ def: V09_WIDENED, validated: true }]);
      await expect(insert("v1.0-code", hash(40), ANSWER, other)).rejects.toThrow(/wcr_contributions_scene_version/);
    } finally {
      await other.close();
    }
  }, 30_000);

  // 235 없이 234 위에 바로 적용하면 CHECK는 바뀌지만, 운영 lane은 235 이력 행이 없으면 원격에 쓰지 않는다
  // (scripts/tests/wedding-code-research-scene-v10-runtime.test.mjs). 여기서는 234조차 없으면 적용되지 않는 것만 본다.
  it("cannot be applied before 234 and changes nothing when it fails", async () => {
    const bare = await PGlite.create();
    try {
      await expect(bare.exec(widen)).rejects.toThrow(/wedding_code_research_contributions/);
      await bare.exec("ROLLBACK");
      expect((await bare.query("SELECT to_regclass('public.wedding_code_research_contributions') AS t")).rows).toEqual([{ t: null }]);
    } finally {
      await bare.close();
    }
  }, 30_000);
});
