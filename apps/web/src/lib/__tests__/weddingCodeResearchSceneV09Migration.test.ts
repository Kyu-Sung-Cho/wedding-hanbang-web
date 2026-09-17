// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 234가 만든 익명 연구 기여 저장소에 235를 이어 적용한다. 235는 장면 버전 CHECK에 'v0.9-code' 하나만 더한다.
// 답 코드 규칙·권한·RLS·함수는 그대로여야 하고, 적용 직후 검증 블록은 그중 하나라도 어긋나면 전체를 되돌려야 한다.
// (234 자체의 동작 테스트는 weddingCode/__tests__/weddingCodeResearchContributionsMigration.test.ts 가 맡는다.)
const migrations = resolve(process.cwd(), "../../supabase/migrations");
const store = readFileSync(resolve(migrations, "20260915130000_wedding_code_research_contributions.sql"), "utf8");
const widen = readFileSync(resolve(migrations, "20260917090000_wedding_code_research_scene_v09.sql"), "utf8");
const verifyBlock = widen.slice(widen.indexOf("DO $verify_wedding_code_scene_v09$"), widen.lastIndexOf("\n\nCOMMIT;\n"));
const CONSENT = "wc-research-consent-v1";
const ANSWER = "ABCD-ABCD-ABCD-ABCD-";
const WIDENED = "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))";
const V08_ONLY = "CHECK (scene_version = 'v0.8-code'::text)";
const FUNCTIONS = [
  "delete_wedding_code_research_contribution",
  "insert_wedding_code_research_contribution",
  "purge_expired_wedding_code_research_contributions",
] as const;
const hash = (byte: number) => new Uint8Array(32).fill(byte);
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
let db: PGlite;

// 새 PGlite에 Supabase처럼 앱 역할 기본 권한을 깔고 234를 적용한다. 그래야 235가 권한을 넓히지 않는지 드러난다.
async function createStore(): Promise<PGlite> {
  const instance = await PGlite.create();
  await instance.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  await instance.exec(store);
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
  // 운영처럼 235 전에 이미 받은 v0.8-code 응답이 있다. 235는 이 행을 건드리지 않고 검증만 통과해야 한다.
  await asRole("service_role", () => insert("v0.8-code", hash(1)));
  await expect(asRole("service_role", () => insert("v0.9-code", hash(2)))).rejects.toThrow(/wcr_contributions_scene_version/);
  constraintsBefore = await constraintDefinitions();
  expect(await sceneCheck()).toEqual([{ def: V08_ONLY, validated: true }]);
  await db.exec(widen);
}, 30_000);
beforeEach(async () => {
  await db.query("DELETE FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash <> $1", [hash(1)]);
  await db.exec("TRUNCATE public.wedding_code_research_deletion_tombstones");
});
afterAll(async () => { await db.close(); });

describe("WeddingCode research scene v0.9 widening (235 after 234)", () => {
  it("accepts v0.9-code through the service_role function, still accepts v0.8-code, and keeps the earlier row", async () => {
    await asRole("service_role", async () => {
      await insert("v0.9-code", hash(10));
      await insert("v0.8-code", hash(11));
    });
    const rows = await db.query<{ scene_version: string; answer_code: string; receipt: string }>(`SELECT scene_version, answer_code,
      encode(deletion_receipt_hash, 'hex') AS receipt FROM public.wedding_code_research_contributions ORDER BY receipt`);
    expect(rows.rows).toEqual([
      { scene_version: "v0.8-code", answer_code: ANSWER, receipt: "01".repeat(32) },
      { scene_version: "v0.9-code", answer_code: ANSWER, receipt: "0a".repeat(32) },
      { scene_version: "v0.8-code", answer_code: ANSWER, receipt: "0b".repeat(32) },
    ]);
    expect(await sceneCheck()).toEqual([{ def: WIDENED, validated: true }]);
  });

  it.each(["v1.0-code", "", "v0.9", "V0.9-CODE", "v0.9-code ", "v0.7-code", "v0.8-code,v0.9-code"])(
    "rejects scene version %j", async (scene) => {
      await asRole("service_role", async () => {
        await expect(insert(scene, hash(20))).rejects.toThrow(/violates check constraint "wcr_contributions_scene_version"/);
      });
      expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.wedding_code_research_contributions")).rows).toEqual([{ n: 1 }]);
    },
  );

  it.each([
    ["a 19-character answer code", "ABCD-ABCD-ABCD-ABCD"],
    ["a 21-character answer code", "ABCD-ABCD-ABCD-ABCD-A"],
    ["a lowercase answer code", "abcd-abcd-abcd-abcd-"],
    ["an all-skip answer code", "--------------------"],
    ["a letter outside A-D", "ABCE-ABCD-ABCD-ABCD-"],
  ])("keeps the answer code rule for v0.9-code: rejects %s", async (_name, answer) => {
    await asRole("service_role", async () => {
      await expect(insert("v0.9-code", hash(21), answer)).rejects.toThrow(/violates check constraint "wcr_contributions_answer_code"/);
      await insert("v0.9-code", hash(22), "AAAAAAAAAAAAAAAAAAAA");
    });
  });

  it("changes only the scene version constraint; every other constraint definition is byte-identical", async () => {
    const after = await constraintDefinitions();
    expect(after.map((row) => row.conname)).toEqual(constraintsBefore.map((row) => row.conname));
    expect(after.filter((row) => row.conname !== "wcr_contributions_scene_version"))
      .toEqual(constraintsBefore.filter((row) => row.conname !== "wcr_contributions_scene_version"));
    expect(constraintsBefore.find((row) => row.conname === "wcr_contributions_scene_version")?.def).toBe(V08_ONLY);
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
        await expect(insert("v0.9-code", hash(30))).rejects.toThrow(/permission denied/);
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
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version ~ '^v0[.][0-9]-code$')`, "WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED"],
    ["v0.8-code was dropped", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.9-code')) NOT VALID`, "WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED"],
    ["the CHECK was left unvalidated", `ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code')) NOT VALID`, "WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED"],
    ["an extra constraint was added", "ALTER TABLE public.wedding_code_research_contributions ADD CONSTRAINT extra_rule CHECK (true)",
      "WEDDING_CODE_SCENE_VERSION_CONSTRAINT_SET_CHANGED"],
    ["RLS was disabled", "ALTER TABLE public.wedding_code_research_deletion_tombstones DISABLE ROW LEVEL SECURITY", "WEDDING_CODE_SCENE_VERSION_RLS_DISABLED"],
    ["a policy was added", "CREATE POLICY open_read ON public.wedding_code_research_contributions USING (true)", "WEDDING_CODE_SCENE_VERSION_POLICY_PRESENT"],
    ["a table grant was added", "GRANT SELECT ON public.wedding_code_research_contributions TO anon", "WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN"],
    ["a column grant was added", "GRANT SELECT (scene_version) ON public.wedding_code_research_contributions TO authenticated",
      "WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN"],
    ["a function became SECURITY INVOKER", "ALTER FUNCTION public.purge_expired_wedding_code_research_contributions() SECURITY INVOKER",
      "WEDDING_CODE_SCENE_VERSION_FUNCTION_CHANGED"],
    ["a function body changed", `CREATE OR REPLACE FUNCTION public.purge_expired_wedding_code_research_contributions() RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$ BEGIN RETURN 0; END; $body$`, "WEDDING_CODE_SCENE_VERSION_FUNCTION_CHANGED"],
    ["a function lost its signature", "DROP FUNCTION public.delete_wedding_code_research_contribution(bytea)", "WEDDING_CODE_SCENE_VERSION_FUNCTION_MISSING"],
    ["authenticated may execute a function", "GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO authenticated",
      "WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_OPEN"],
    ["service_role lost execute", "REVOKE EXECUTE ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea) FROM service_role",
      "WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_MISSING"],
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

  // 검증 블록의 convalidated 조건은 겹쳐 둔 방어다. 정의 문자열 비교만으로도 검증 안 된 CHECK가 걸리는 이유를 고정한다.
  it("sees an unvalidated CHECK through its definition alone because PostgreSQL appends NOT VALID", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
        ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code')) NOT VALID`);
      expect(await sceneCheck()).toEqual([{ def: `${WIDENED} NOT VALID`, validated: false }]);
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(await sceneCheck()).toEqual([{ def: WIDENED, validated: true }]);
  });

  it("rolls the whole migration back when its verification fails, leaving the v0.8-only CHECK in place", async () => {
    const other = await createStore();
    try {
      await other.exec("GRANT SELECT ON public.wedding_code_research_contributions TO anon");
      await expect(other.exec(widen)).rejects.toThrow("WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN");
      await other.exec("ROLLBACK");
      expect(await sceneCheck(other)).toEqual([{ def: V08_ONLY, validated: true }]);
      await expect(insert("v0.9-code", hash(40), ANSWER, other)).rejects.toThrow(/wcr_contributions_scene_version/);
    } finally {
      await other.close();
    }
  }, 30_000);

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
