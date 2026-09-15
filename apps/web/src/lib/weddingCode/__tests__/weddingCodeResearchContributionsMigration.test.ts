// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 동의한 연구 응답만 익명으로 받는 저장소다. 과거 수집 테이블·RPC와 섞지 않고,
// 앱 역할은 테이블을 직접 읽거나 쓰지 못하며 service_role만 함수 세 개를 실행한다.
const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260915130000_wedding_code_research_contributions.sql"),
  "utf8",
);
const GOOD = { scene: "v0.8-code", code: "ABCD-ABCD-ABCD-ABCD-", consent: "wc-research-consent-v1" };
const REJECTED = "WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED";
const hash = (byte: number, length = 32) => new Uint8Array(length).fill(byte);
let db: PGlite;

async function asRole<T>(role: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try { return await work(); } finally { await db.exec("RESET ROLE"); }
}
function insert(receipt: Uint8Array, overrides: Partial<typeof GOOD> = {}) {
  const value = { ...GOOD, ...overrides };
  return db.query("SELECT public.insert_wedding_code_research_contribution($1,$2,$3,$4)",
    [value.scene, value.code, value.consent, receipt]);
}
function remove(receipt: Uint8Array) {
  return db.query("SELECT public.delete_wedding_code_research_contribution($1)", [receipt]);
}
async function count(table: "wedding_code_research_contributions" | "wedding_code_research_deletion_tombstones", receipt?: Uint8Array) {
  const where = receipt ? " WHERE deletion_receipt_hash = $1" : "";
  return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table}${where}`, receipt ? [receipt] : [])).rows[0].n;
}

beforeAll(async () => {
  db = await PGlite.create();
  // Supabase처럼 새 테이블·함수에 앱 역할 권한이 기본으로 붙는 상태에서 시작한다.
  // 그래야 migration이 PUBLIC만이 아니라 각 역할의 명시 권한까지 거두는지 드러난다.
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  await expect(db.query("SELECT public.purge_expired_wedding_code_research_contributions()")).rejects.toThrow(/does not exist/);
  await db.exec(sql);
}, 30_000);
beforeEach(async () => {
  await db.exec("TRUNCATE public.wedding_code_research_contributions, public.wedding_code_research_deletion_tombstones");
});
afterAll(async () => { await db.close(); });

describe("WeddingCode research contribution store", () => {
  it("stores only the anonymous research fields and never touches the retired collection objects", async () => {
    expect(sql).not.toMatch(/wedding_code_response|pair_wedding_code|user_id|user_agent|ip_address|\binet\b|auth\./i);
    const columns = await db.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name LIKE 'wedding_code_research_%' ORDER BY table_name, ordinal_position`);
    expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
      "wedding_code_research_contributions.id", "wedding_code_research_contributions.created_at",
      "wedding_code_research_contributions.expires_at", "wedding_code_research_contributions.scene_version",
      "wedding_code_research_contributions.answer_code", "wedding_code_research_contributions.consent_version",
      "wedding_code_research_contributions.deletion_receipt_hash",
      "wedding_code_research_deletion_tombstones.deletion_receipt_hash", "wedding_code_research_deletion_tombstones.deleted_at",
      "wedding_code_research_deletion_tombstones.expires_at",
    ]);
    expect((await db.query("SELECT to_regclass('public.wedding_code_responses') AS t")).rows).toEqual([{ t: null }]);
  });

  it("lets service_role write only through the function and keeps the tables closed to every app role", async () => {
    await asRole("service_role", () => insert(hash(1)));
    expect(await count("wedding_code_research_contributions", hash(1))).toBe(1);
    for (const role of ["service_role", "authenticated", "anon"]) {
      await asRole(role, async () => {
        await expect(db.query("SELECT * FROM public.wedding_code_research_contributions")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT * FROM public.wedding_code_research_deletion_tombstones")).rejects.toThrow(/permission denied/);
        await expect(db.query(`INSERT INTO public.wedding_code_research_contributions (scene_version, answer_code, consent_version, deletion_receipt_hash)
          VALUES ('v0.8-code', 'AAAAAAAAAAAAAAAAAAAA', 'wc-research-consent-v1', $1)`, [hash(9)])).rejects.toThrow(/permission denied/);
      });
    }
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(insert(hash(2))).rejects.toThrow(/permission denied/);
        await expect(remove(hash(1))).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.purge_expired_wedding_code_research_contributions()")).rejects.toThrow(/permission denied/);
      });
    }
    expect(await count("wedding_code_research_contributions")).toBe(1);
    const security = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(`SELECT proname, prosecdef, proconfig
      FROM pg_proc WHERE proname IN ('insert_wedding_code_research_contribution','delete_wedding_code_research_contribution',
      'purge_expired_wedding_code_research_contributions') ORDER BY proname`);
    expect(security.rows).toEqual([
      { proname: "delete_wedding_code_research_contribution", prosecdef: true, proconfig: ['search_path=""'] },
      { proname: "insert_wedding_code_research_contribution", prosecdef: true, proconfig: ['search_path=""'] },
      { proname: "purge_expired_wedding_code_research_contributions", prosecdef: true, proconfig: ['search_path=""'] },
    ]);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean; policies: number }>(`SELECT c.relname, c.relrowsecurity,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c
      WHERE c.relname LIKE 'wedding_code_research_%' AND c.relkind = 'r' ORDER BY c.relname`);
    expect(rls.rows).toEqual([
      { relname: "wedding_code_research_contributions", relrowsecurity: true, policies: 0 },
      { relname: "wedding_code_research_deletion_tombstones", relrowsecurity: true, policies: 0 },
    ]);
  });

  it.each([
    ["a 19-character answer code", { code: "ABCD-ABCD-ABCD-ABCD" }],
    ["a 21-character answer code", { code: "ABCD-ABCD-ABCD-ABCD-A" }],
    ["a lowercase answer code", { code: "abcd-abcd-abcd-abcd-" }],
    ["an all-skip answer code", { code: "--------------------" }],
    ["a letter outside A-D", { code: "ABCE-ABCD-ABCD-ABCD-" }],
    ["a different scene version", { scene: "v0.7-code" }],
    ["a malformed consent version", { consent: "wc-research-consent-v0" }],
    ["a free-text consent version", { consent: "I agree" }],
  ])("rejects %s", async (_name, overrides) => {
    await asRole("service_role", async () => { await expect(insert(hash(3), overrides)).rejects.toThrow(/violates check constraint/); });
    expect(await count("wedding_code_research_contributions")).toBe(0);
  });

  it("rejects a receipt hash that is not exactly 32 bytes and a duplicate hash", async () => {
    await asRole("service_role", async () => {
      await expect(insert(hash(4, 31))).rejects.toThrow(/violates check constraint/);
      await expect(insert(hash(4, 33))).rejects.toThrow(/violates check constraint/);
      await insert(hash(4));
      await expect(insert(hash(4), { code: "DDDDDDDDDDDDDDDDDDDD" })).rejects.toThrow(/duplicate key/);
      await expect(remove(hash(4, 31))).rejects.toMatchObject({ code: "22023", message: REJECTED });
    });
    expect(await count("wedding_code_research_contributions")).toBe(1);
    expect(await count("wedding_code_research_deletion_tombstones")).toBe(0);
  });

  it("deletes the row, leaves only a tombstone, and refuses to store the same receipt again", async () => {
    await asRole("service_role", async () => {
      await insert(hash(5));
      await remove(hash(5));
      await expect(insert(hash(5))).rejects.toMatchObject({ code: "22023", message: REJECTED });
    });
    expect(await count("wedding_code_research_contributions", hash(5))).toBe(0);
    const tombstone = await db.query<{ columns: string[]; lifetime: boolean }>(`SELECT
      array(SELECT jsonb_object_keys(to_jsonb(t))) AS columns,
      t.expires_at > t.deleted_at AND t.expires_at <= t.deleted_at + interval '30 days' AS lifetime
      FROM public.wedding_code_research_deletion_tombstones t WHERE deletion_receipt_hash = $1`, [hash(5)]);
    expect(tombstone.rows).toHaveLength(1);
    expect([...tombstone.rows[0].columns].sort()).toEqual(["deleted_at", "deletion_receipt_hash", "expires_at"]);
    expect(tombstone.rows[0].lifetime).toBe(true);
  });

  it("answers an unknown receipt the same way and still tombstones it", async () => {
    await asRole("service_role", async () => {
      const unknown = await remove(hash(6));
      await insert(hash(7));
      const known = await remove(hash(7));
      expect(unknown.rows).toEqual(known.rows);
      await remove(hash(6));
    });
    expect(await count("wedding_code_research_deletion_tombstones", hash(6))).toBe(1);
    expect(await count("wedding_code_research_deletion_tombstones", hash(7))).toBe(1);
    expect(await count("wedding_code_research_contributions")).toBe(0);
    await asRole("service_role", async () => { await expect(insert(hash(6))).rejects.toMatchObject({ code: "22023", message: REJECTED }); });
  });

  it("purges expired contributions and tombstones and returns the number of contribution rows removed", async () => {
    await asRole("service_role", async () => {
      for (const byte of [10, 11, 12]) await insert(hash(byte));
      await remove(hash(13));
    });
    await db.query(`UPDATE public.wedding_code_research_contributions
      SET created_at = now() - interval '70 days', expires_at = now() - interval '10 days' WHERE deletion_receipt_hash = ANY($1)`,
    [[hash(10), hash(11)]]);
    await db.exec("UPDATE public.wedding_code_research_deletion_tombstones SET expires_at = now() - interval '1 day'");
    const purged = await asRole("service_role", () =>
      db.query<{ n: number }>("SELECT public.purge_expired_wedding_code_research_contributions() AS n"));
    expect(purged.rows).toEqual([{ n: 2 }]);
    expect(await count("wedding_code_research_contributions")).toBe(1);
    expect(await count("wedding_code_research_contributions", hash(12))).toBe(1);
    expect(await count("wedding_code_research_deletion_tombstones")).toBe(0);
    const again = await asRole("service_role", () =>
      db.query<{ n: number }>("SELECT public.purge_expired_wedding_code_research_contributions() AS n"));
    expect(again.rows).toEqual([{ n: 0 }]);
  });

  it("clears expired rows before each insert so an expired tombstone no longer blocks its receipt", async () => {
    await asRole("service_role", async () => { await insert(hash(14)); await remove(hash(15)); });
    await db.query(`UPDATE public.wedding_code_research_contributions
      SET created_at = now() - interval '61 days', expires_at = now() - interval '1 day' WHERE deletion_receipt_hash = $1`, [hash(14)]);
    await db.exec("UPDATE public.wedding_code_research_deletion_tombstones SET expires_at = now() - interval '1 second'");
    await asRole("service_role", () => insert(hash(15)));
    expect(await count("wedding_code_research_contributions", hash(14))).toBe(0);
    expect(await count("wedding_code_research_contributions", hash(15))).toBe(1);
    expect(await count("wedding_code_research_deletion_tombstones")).toBe(0);
  });

  it("refuses a retention longer than 60 days even for the table owner", async () => {
    await asRole("service_role", () => insert(hash(16)));
    await expect(db.query(`UPDATE public.wedding_code_research_contributions
      SET expires_at = created_at + interval '60 days 1 second' WHERE deletion_receipt_hash = $1`, [hash(16)])).rejects.toThrow(/wcr_contributions_retention/);
    await expect(db.query(`INSERT INTO public.wedding_code_research_contributions
      (created_at, expires_at, scene_version, answer_code, consent_version, deletion_receipt_hash)
      VALUES (now(), now() + interval '61 days', 'v0.8-code', 'AAAAAAAAAAAAAAAAAAAA', 'wc-research-consent-v1', $1)`, [hash(17)]))
      .rejects.toThrow(/wcr_contributions_retention/);
    await expect(db.query(`UPDATE public.wedding_code_research_contributions
      SET expires_at = created_at WHERE deletion_receipt_hash = $1`, [hash(16)])).rejects.toThrow(/wcr_contributions_retention/);
    const kept = await db.query<{ ok: boolean }>(`SELECT expires_at > created_at AND expires_at <= created_at + interval '60 days' AS ok
      FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash = $1`, [hash(16)]);
    expect(kept.rows).toEqual([{ ok: true }]);
  });
});
