// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "11111111-1111-4111-8111-111111111111";
const JOURNEY_ID = "33333333-3333-4333-8333-333333333333";
const action = (id: string): AmoraActionItem => ({
  id, title: `준비 ${id}`, status: "open", priority: "medium", source: "chat",
  createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
});
const ACTION_A = "act_first";
const ACTION_B = "act_second";

const mocks = vi.hoisted(() => ({ admin: null as unknown, authenticated: null as unknown, repositoryError: null as { code: string; message: string } | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => mocks.authenticated,
}));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

let db: PGlite;
let reads = 0;
let writes = 0;
let rpcWrites = 0;
let queryError = false;
let profileError = false;
let saveError = false;
let returnedRevision: number | null | undefined;
let omitRevision = false;
let beforeWrite: (() => Promise<void>) | null = null;
let firstReadBarrier: (() => Promise<void>) | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 실제 supabase-js 요청의 필터를 PostgreSQL WHERE로 실행한다. 외부 요청은 없다. */
async function localPostgrest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const table = url.pathname.split("/").at(-1);
  if (table === "profiles") {
    if (profileError) return json({ code: "57014", message: "private profile timeout" }, 500);
    const profile = await db.query("SELECT couple_id FROM profiles WHERE id = $1", [USER_ID]);
    return json(profile.rows[0]);
  }
  if (table === "mutate_own_amora_action" || table === "update_own_legacy_amora_action") {
    const body = await request.json();
    if (table === "mutate_own_amora_action" && mocks.repositoryError) return json(mocks.repositoryError, 500);
    const canonical = table === "mutate_own_amora_action";
    const exists = canonical ? (await db.query("SELECT id FROM amora_actions WHERE id = $1", [body.p_action_id])).rows.length > 0 : false;
    if (!canonical) writes += 1;
    if (saveError && (!canonical || exists || body.p_operation === "create")) return json({ message: "private write error", code: "XX000" }, 500);
    if (beforeWrite && (!canonical || exists || body.p_operation === "create")) await beforeWrite();
    try {
      const result = await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [USER_ID]);
        return canonical
          ? tx.query<{ value: unknown }>("SELECT public.mutate_own_amora_action($1,$2,$3,$4::jsonb) AS value", [body.p_couple_id, body.p_action_id, body.p_operation, JSON.stringify(body.p_values)])
          : tx.query<{ value: unknown }>("SELECT public.update_own_legacy_amora_action($1,$2,$3,$4,$5::jsonb) AS value", [body.p_couple_id, body.p_journey_id, body.p_action_id, body.p_expected_revision, JSON.stringify(body.p_values)]);
      });
      return json(result.rows[0]?.value ?? null);
    } catch (error) {
      const detail = error as { code: string; message: string };
      return json({ code: detail.code, message: detail.message }, 400);
    }
  }
  if (table === "apply_journey_progress_patch") {
    rpcWrites += 1;
    const body = await request.json();
    if (saveError) return json({ message: "private database error", code: "XX000" }, 500);
    if (beforeWrite) await beforeWrite();
    const result = await db.query<{ progress: Record<string, unknown> }>("UPDATE wedding_journeys SET progress = progress || $1::jsonb WHERE couple_id = $2 RETURNING progress", [JSON.stringify(body.p_patch), body.p_couple_id]);
    return json(result.rows[0]?.progress ?? null);
  }
  if (table === "amora_actions") {
    expect(url.searchParams.get("couple_id")).toBe(`eq.${COUPLE_ID}`);
    const values: unknown[] = [COUPLE_ID];
    const where = ["couple_id = $1"];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const status = url.searchParams.get("status");
    if (status) { expect(status).toMatch(/^eq\.(open|done|dismissed)$/); where.push(`status = ${bind(status.slice(3))}`); }
    const ids = url.searchParams.get("id");
    if (ids) { expect(ids).toMatch(/^in\.\(/); where.push(`id = ANY(${bind(ids.slice(4, -1).split(","))}::text[])`); }
    const filter = url.searchParams.get("or");
    if (filter) {
      const match = /^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\."((?:\\.|[^"\\])*)"\)\)$/.exec(filter);
      if (!match) throw new Error("Unexpected actual Supabase keyset filter");
      expect(match[1]).toBe(match[2]);
      const time = bind(match[1]); const id = bind(JSON.parse(`"${match[3]}"`));
      where.push(`(created_at < ${time}::timestamptz OR (created_at = ${time}::timestamptz AND id < ${id}))`);
    }
    const count = await db.query<{ count: number }>(`SELECT count(*)::integer AS count FROM amora_actions WHERE ${where.join(" AND ")}`, values);
    const headers = { "content-type": "application/json", "content-range": `0-0/${count.rows[0].count}` };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const limit = Number(url.searchParams.get("limit") ?? 80);
    expect(limit).toBeLessThanOrEqual(81);
    const rows = await db.query<{ value: unknown }>(`SELECT to_jsonb(action) AS value FROM amora_actions AS action WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${bind(limit)}`, values);
    return new Response(JSON.stringify(rows.rows.map((row) => row.value)), { status: 200, headers });
  }
  if (table !== "wedding_journeys") throw new Error(`Unexpected local table: ${table}`);
  expect(url.searchParams.get("couple_id")).toBe(`eq.${COUPLE_ID}`);
  if (request.method === "GET") {
    reads += 1;
    if (queryError) return json({ message: "private read error", code: "XX000" }, 500);
    const result = await db.query<Record<string, unknown>>("SELECT * FROM wedding_journeys WHERE couple_id = $1", [COUPLE_ID]);
    if (firstReadBarrier) await firstReadBarrier();
    if (returnedRevision !== undefined) result.rows.forEach((row) => { row.state_revision = returnedRevision; });
    if (omitRevision) result.rows.forEach((row) => { delete row.state_revision; });
    return json(result.rows);
  }
  expect(request.method).toBe("PATCH");
  writes += 1;
  if (saveError) return json({ message: "private write error", code: "XX000" }, 500);
  if (beforeWrite) await beforeWrite();
  const body = await request.json();
  expect(url.searchParams.get("id")).toBe(`eq.${JOURNEY_ID}`);
  const revisionFilter = url.searchParams.get("state_revision");
  expect(revisionFilter).toMatch(/^eq\.\d+$/);
  expect(Object.keys(body)).toEqual(["progress"]);
  const result = await db.query("UPDATE wedding_journeys SET progress = $1::jsonb WHERE id = $2 AND couple_id = $3 AND state_revision = $4 RETURNING *", [JSON.stringify(body.progress), JOURNEY_ID, COUPLE_ID, Number(revisionFilter!.slice(3))]);
  return json(result.rows[0] ?? null);
}

async function stored() {
  const result = await db.query<{ progress: { __amora_actions: AmoraActionItem[]; [key: string]: unknown }; total_budget: number; state_revision: number }>("SELECT * FROM wedding_journeys WHERE id = $1", [JOURNEY_ID]);
  return result.rows[0];
}
async function patch(id: string, updates: Record<string, unknown> = { status: "done" }) {
  const { PATCH } = await import("../route");
  return PATCH(new Request(`https://hanbang.ai/api/amora/actions/${id}`, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify(updates),
  }), { params: Promise.resolve({ id }) });
}

async function createAction() {
  const { POST } = await import("../../route");
  return POST(new Request("https://hanbang.ai/api/amora/actions", {
    method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ title: "합성 준비 항목", href: "/wedding/checklist" }),
  }));
}

async function rpcAs(role: "authenticated" | "anon" | "service_role", sql: string, values: unknown[], actor = USER_ID) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actor]);
    return tx.query(sql, values);
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE TABLE profiles(id uuid PRIMARY KEY, couple_id uuid, role text); CREATE TABLE couples(id uuid PRIMARY KEY, bride_id uuid, groom_id uuid)");
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    CREATE TABLE public.amora_actions (
      id text PRIMARY KEY, couple_id uuid NOT NULL, title text NOT NULL, description text, due_date text,
      category_key text, priority text DEFAULT 'medium', status text DEFAULT 'open', source text DEFAULT 'manual', href text,
      created_by uuid, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      completed_at timestamptz, dismissed_at timestamptz
    );
  `);
  await db.exec("CREATE TABLE public.wedding_journeys(id uuid PRIMARY KEY, couple_id uuid UNIQUE, progress jsonb, total_budget bigint NOT NULL DEFAULT 0, state_revision bigint NOT NULL DEFAULT 0, updated_at timestamptz)");
  // 현재 저장소의 가장 최근 revision 트리거 함수를 그대로 실행한다.
  const migration = readFileSync(path.resolve(process.cwd(), "../../supabase/migrations/20260802170000_amora_shared_action_roster_binding.sql"), "utf8");
  const trigger = migration.match(/CREATE OR REPLACE FUNCTION public\.advance_wedding_journey_state_revision\(\)[\s\S]*?\$function\$;/)?.[0];
  if (!trigger) throw new Error("Missing original revision trigger");
  await db.exec(trigger);
  await db.exec("CREATE TRIGGER trg_advance_wedding_journey_state_revision BEFORE INSERT OR UPDATE ON wedding_journeys FOR EACH ROW EXECUTE FUNCTION public.advance_wedding_journey_state_revision()");
  await db.exec(readFileSync(path.resolve(process.cwd(), "../../supabase/migrations/20260615101000_fix_amora_action_status_timestamps.sql"), "utf8"));
  await db.exec("CREATE TRIGGER set_amora_actions_status_timestamps BEFORE INSERT OR UPDATE ON amora_actions FOR EACH ROW EXECUTE FUNCTION public.set_amora_action_status_timestamps()");
  await db.exec(readFileSync(path.resolve(process.cwd(), "../../supabase/migrations/20260906074227_amora_manual_actions_actor_boundary.sql"), "utf8"));
  mocks.admin = createClient("http://127.0.0.1:55430", "local-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localPostgrest } });
  const authenticated = createClient("http://127.0.0.1:55430", "local-authenticated-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localPostgrest } });
  vi.spyOn(authenticated.auth, "getUser").mockResolvedValue({ data: { user: { id: USER_ID } }, error: null } as never);
  mocks.authenticated = authenticated;
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  reads = 0; writes = 0; rpcWrites = 0; queryError = false; saveError = false;
  profileError = false;
  returnedRevision = undefined; omitRevision = false; beforeWrite = null; firstReadBarrier = null; mocks.repositoryError = null;
  await db.exec("TRUNCATE wedding_journeys, amora_actions");
  await db.exec("TRUNCATE profiles, couples");
  await db.query("INSERT INTO profiles VALUES ($1,$2,'bride')", [USER_ID, COUPLE_ID]);
  await db.query("INSERT INTO couples VALUES ($1,$2,NULL)", [COUPLE_ID, USER_ID]);
  await db.query("INSERT INTO wedding_journeys(id, couple_id, progress, total_budget) VALUES ($1,$2,$3::jsonb,100)", [JOURNEY_ID, COUPLE_ID, JSON.stringify({ __amora_actions: [action(ACTION_A), action(ACTION_B)], venue: { checklist: [{ id: "venue_01", done: false }] }, __events: [{ id: "event_a" }] })]);
});

describe("legacy action updates preserve concurrent preparation changes", () => {
  it("paginates actual Supabase query parameters with SQL microsecond order and a newer insert between pages", async () => {
    await db.query("UPDATE wedding_journeys SET progress = '{}' WHERE id = $1", [JOURNEY_ID]);
    await db.query(`INSERT INTO amora_actions(id,couple_id,title,created_at)
      SELECT 'act_page_' || lpad(value::text,3,'0'), $1, '합성 페이지',
        '2026-01-01T00:00:00.123000Z'::timestamptz + (value % 3) * interval '1 microsecond'
      FROM generate_series(1,95) AS value`, [COUPLE_ID]);
    const expected = (await db.query<{ id: string }>("SELECT id FROM amora_actions ORDER BY created_at DESC,id DESC")).rows.map((row) => row.id);
    const { GET } = await import("../../route");
    const first = await GET(new Request("https://hanbang.ai/api/amora/actions?status=all&limit=80"));
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1).toMatchObject({ count: 95, open_count: 95 });
    expect(page1.actions).toHaveLength(80);
    expect(typeof page1.next_cursor).toBe("string");
    await db.query("INSERT INTO amora_actions(id,couple_id,title,created_at) VALUES ('act_new',$1,'합성 새 카드','2026-01-02T00:00:00Z')", [COUPLE_ID]);
    const second = await GET(new Request(`https://hanbang.ai/api/amora/actions?status=all&limit=80&cursor=${page1.next_cursor}`));
    expect(second.status).toBe(200);
    const page2 = await second.json();
    expect(page2).toMatchObject({ count: 96, open_count: 96, next_cursor: null });
    const actual = [...page1.actions, ...page2.actions].map((row: { id: string }) => row.id);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(95);
  });

  it.each(["profile unlink", "roster removal"])("rejects a %s committed after lookup but before the legacy write", async (change) => {
    beforeWrite = async () => {
      beforeWrite = null;
      if (change === "profile unlink") await db.query("UPDATE profiles SET couple_id = NULL WHERE id = $1", [USER_ID]);
      else await db.query("UPDATE couples SET bride_id = NULL WHERE id = $1", [COUPLE_ID]);
    };
    const response = await patch(ACTION_A);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("action");
    expect((await stored()).progress.__amora_actions[0].status).toBe("open");
  });
  it("keeps both changes when two requests read the same original action array", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let arrived = 0;
    firstReadBarrier = async () => { arrived += 1; if (arrived === 2) release(); if (arrived <= 2) await gate; };
    const responses = await Promise.all([patch(ACTION_A), patch(ACTION_B)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await stored()).progress.__amora_actions.map((item) => item.status)).toEqual(["done", "done"]);
    expect(reads).toBe(3);
    expect(rpcWrites).toBe(0);
  });

  it("re-reads changed checklist, schedule, and budget fields before retrying", async () => {
    beforeWrite = async () => {
      beforeWrite = null;
      await db.query("UPDATE wedding_journeys SET progress = progress || $1::jsonb, total_budget = 200 WHERE id = $2", [JSON.stringify({ venue: { checklist: [{ id: "venue_01", done: true }] }, __events: [{ id: "event_b" }] }), JOURNEY_ID]);
    };
    expect((await patch(ACTION_A)).status).toBe(200);
    const row = await stored();
    expect(row.progress.venue).toEqual({ checklist: [{ id: "venue_01", done: true }] });
    expect(row.progress.__events).toEqual([{ id: "event_b" }]);
    expect(row.total_budget).toBe(200);
    expect(row.progress.__amora_actions.map((item) => item.status)).toEqual(["done", "open"]);
    expect(reads).toBe(2);
    expect(writes).toBe(2);
  });

  it("stops after three conflicts with 409 and never pretends the action was saved", async () => {
    beforeWrite = async () => { await db.exec("UPDATE wedding_journeys SET total_budget = total_budget + 1"); };
    const response = await patch(ACTION_A);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.stringContaining("최신 기록을 불러온 뒤"), code: "AMORA_ACTION_CONFLICT" });
    expect(reads).toBe(3);
    expect(writes).toBe(3);
    expect((await stored()).progress.__amora_actions.every((item) => item.status === "open")).toBe(true);
    expect((await stored()).total_budget).toBe(103);
  });

  it.each([null, -1, Number.MAX_SAFE_INTEGER, 0.5])("fails closed before writes for invalid revision %s", async (revision) => {
    returnedRevision = revision;
    expect((await patch(ACTION_A)).status).toBe(503);
    expect(writes).toBe(0);
    expect(rpcWrites).toBe(0);
  });

  it("does not use an unconditional fallback when the revision is unavailable", async () => {
    omitRevision = true;
    expect((await patch(ACTION_A)).status).toBe(503);
    expect(writes).toBe(0);
    expect(rpcWrites).toBe(0);
  });

  it("returns no success or 404 for a read or write failure", async () => {
    queryError = true;
    const readFailure = await patch(ACTION_A);
    expect(readFailure.status).toBe(500);
    expect(await readFailure.json()).not.toHaveProperty("action");
    expect(writes).toBe(0);
    queryError = false; saveError = true;
    const saveFailure = await patch(ACTION_A);
    expect(saveFailure.status).toBe(500);
    expect(JSON.stringify(await saveFailure.json())).not.toContain("private");
    expect((await stored()).progress.__amora_actions[0].status).toBe("open");
  });

  it("supports absent canonical storage while preserving every other raw array entry", async () => {
    mocks.repositoryError = { code: "42P01", message: 'relation "amora_actions" does not exist' };
    const originals: unknown[] = Array.from({ length: 90 }, (_, index) => action(`act_${index}`));
    originals.splice(2, 0, { legacy_note: "keep this unknown entry" });
    await db.query("UPDATE wedding_journeys SET progress = jsonb_set(progress, '{__amora_actions}', $1::jsonb) WHERE id = $2", [JSON.stringify(originals), JOURNEY_ID]);
    expect((await patch("act_89", { category_key: "makeup" })).status).toBe(200);
    const after = (await stored()).progress.__amora_actions;
    expect(after).toHaveLength(91);
    expect(after.slice(0, 90)).toEqual(originals.slice(0, 90));
    expect(after[90]).toMatchObject({ id: "act_89", categoryKey: "makeup", status: "open" });
  });

  it("returns 404 if the action disappears while the conflicting write is retried", async () => {
    beforeWrite = async () => {
      beforeWrite = null;
      await db.query("UPDATE wedding_journeys SET progress = jsonb_set(progress, '{__amora_actions}', $1::jsonb) WHERE id = $2", [JSON.stringify([action(ACTION_B)]), JOURNEY_ID]);
    };
    expect((await patch(ACTION_A)).status).toBe(404);
    expect((await stored()).progress.__amora_actions).toEqual([action(ACTION_B)]);
    expect(writes).toBe(1);
  });
});

describe("manual action authenticated database boundary", () => {
  it("reports profile read errors as unavailable instead of pretending the couple is missing", async () => {
    profileError = true;
    const response = await patch(ACTION_A);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("action");
    expect(writes).toBe(0);
  });

  it("rolls back the legacy change when the database revision trigger is unavailable", async () => {
    const before = await stored();
    await db.exec("ALTER TABLE wedding_journeys DISABLE TRIGGER trg_advance_wedding_journey_state_revision");
    try {
      const response = await patch(ACTION_A);
      expect(response.status).toBe(503);
      expect(await stored()).toEqual(before);
    } finally {
      await db.exec("ALTER TABLE wedding_journeys ENABLE TRIGGER trg_advance_wedding_journey_state_revision");
    }
  });
  it("creates only an actor-owned canonical row and leaves legacy plans unchanged", async () => {
    const before = await stored();
    const response = await createAction();
    expect(response.status).toBe(201);
    const payload = await response.json();
    const row = (await db.query("SELECT * FROM amora_actions WHERE id = $1", [payload.action.id])).rows[0];
    expect(row).toMatchObject({ created_by: USER_ID, couple_id: COUPLE_ID, status: "open", href: "/wedding/checklist" });
    expect(await stored()).toEqual(before);
  });

  it.each(["create", "update"])("rejects a disconnected actor immediately before canonical %s", async (operation) => {
    await db.query("INSERT INTO amora_actions(id,couple_id,title) VALUES ($1,$2,'합성 원본')", [ACTION_A, COUPLE_ID]);
    beforeWrite = async () => { beforeWrite = null; await db.query("UPDATE profiles SET couple_id = NULL WHERE id = $1", [USER_ID]); };
    const response = operation === "create" ? await createAction() : await patch(ACTION_A);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("action");
    expect((await db.query("SELECT status FROM amora_actions")).rows).toEqual([{ status: "open" }]);
  });

  it("keeps a committed change when unlink happens afterwards and rejects later changes", async () => {
    await db.query("INSERT INTO amora_actions(id,couple_id,title) VALUES ($1,$2,'합성 원본')", [ACTION_A, COUPLE_ID]);
    expect((await patch(ACTION_A)).status).toBe(200);
    await db.query("UPDATE profiles SET couple_id = NULL WHERE id = $1", [USER_ID]);
    expect((await patch(ACTION_A, { status: "open" })).status).toBe(404);
    expect((await db.query("SELECT status, completed_at FROM amora_actions")).rows[0])
      .toMatchObject({ status: "done", completed_at: expect.any(Date) });
  });

  it.each(["canonical", "legacy"])("clears an optional href in %s storage without failing validation", async (storage) => {
    if (storage === "canonical") await db.query("INSERT INTO amora_actions(id,couple_id,title,href) VALUES ($1,$2,'합성 원본','/wedding/checklist')", [ACTION_A, COUPLE_ID]);
    const response = await patch(ACTION_A, { href: "" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action.href ?? null).toBeNull();
    expect(storage === "canonical" ? (await db.query<{ href: string | null }>("SELECT href FROM amora_actions")).rows[0].href
      : (await stored()).progress.__amora_actions[0].href).toBeNull();
  });

  it.each([
    { created_by: USER_ID }, { couple_id: COUPLE_ID }, { metadata: {} },
    { progress: { __events: [] } }, { status: null }, { title: "" },
    { priority: "urgent" }, { href: "https://outside.invalid" }, { href: "//outside.invalid" },
  ])("rejects fields/values that bypass the HTTP schema: %j", async (values) => {
    const before = await stored();
    await expect(rpcAs("authenticated", "SELECT public.update_own_legacy_amora_action($1,$2,$3,$4,$5::jsonb)", [COUPLE_ID, JOURNEY_ID, ACTION_A, before.state_revision, JSON.stringify(values)]))
      .rejects.toMatchObject({ code: "22023" });
    expect(await stored()).toEqual(before);
  });

  it.each(["anon", "service_role"] as const)("does not grant the manual RPCs to %s", async (role) => {
    await expect(rpcAs(role, "SELECT public.mutate_own_amora_action($1,$2,'create',$3::jsonb)", [COUPLE_ID, "act_denied", JSON.stringify({ title: "합성 거부" })]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(rpcAs(role, "SELECT public.update_own_legacy_amora_action($1,$2,$3,0,$4::jsonb)", [COUPLE_ID, JOURNEY_ID, ACTION_A, JSON.stringify({ status: "done" })]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("rejects an absent authenticated actor and a mismatched roster role", async () => {
    const sql = "SELECT public.mutate_own_amora_action($1,$2,'create',$3::jsonb)";
    const values = [COUPLE_ID, "act_denied", JSON.stringify({ title: "합성 거부" })];
    await expect(rpcAs("authenticated", sql, values, "")).rejects.toMatchObject({ code: "42501" });
    await db.query("UPDATE profiles SET role = 'groom' WHERE id = $1", [USER_ID]);
    await expect(rpcAs("authenticated", sql, values)).rejects.toMatchObject({ code: "42501" });
  });
});
