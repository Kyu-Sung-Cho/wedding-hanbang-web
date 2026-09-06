// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PATCH, DELETE } from "@/app/api/amora/personal-actions/route";
import { parsePersonalActionPage, parsePersonalActionReceipt } from "@hanbang/shared/amora-personal-actions";
import { readPersonalActionConversationCount } from "@/lib/amora/personalActionConversationRead";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => mocks.client }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "personal-test" }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

const migration = resolve(process.cwd(), "../../supabase/migrations/20260906151956_amora_personal_actions_owner_boundary.sql");
const OWNER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const SEGMENT = "44444444-4444-4444-8444-444444444444";
const USER_MESSAGE = "55555555-5555-4555-8555-555555555555";
const AI_MESSAGE = "66666666-6666-4666-8666-666666666666";
const REQUEST = "77777777-7777-4777-8777-777777777777";

describe("personal action database boundary", () => {
  let db: PGlite;
  let actor = OWNER;
  let unavailable = false;
  let tamperReceipt = false;
  let beforeRpc: (() => Promise<void>) | null = null;
  let requestCount = 0;
  let afterConversationRead: (() => Promise<void>) | null = null;
  async function asActor(sql: string, values: unknown[] = [], user = actor) {
    return db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
      return tx.query<Record<string,unknown>>(sql, values);
    });
  }
  const respond = (value: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  // 실제 supabase-js가 만든 소유자·revision·keyset 필터를 RLS 아래 SQL로 실행한다.
  async function localPostgrest(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init); const url = new URL(request.url);
    requestCount += 1;
    if (unavailable) return respond({ code: "57014", message: "SYNTHETIC_PRIVATE_DATABASE_DETAIL" }, 400);
    try {
      if (url.pathname.endsWith("/rpc/save_own_amora_personal_action")) {
        const values = await request.json();
        await beforeRpc?.();
        const result = await asActor("SELECT public.save_own_amora_personal_action($1,$2,$3,$4,$5,$6,$7::date) AS value", [values.p_owner_id,values.p_couple_id,values.p_message_id,values.p_request_id,values.p_title,values.p_description,values.p_due_date]);
        const row = result.rows[0].value as Record<string,unknown>;
        return respond(tamperReceipt ? { ...row, title: "SYNTHETIC_WRONG_RECEIPT" } : row);
      }
      if (url.pathname.endsWith("/profiles")) {
        const owner = url.searchParams.get("id");
        expect(owner?.startsWith("eq.")).toBe(true);
        const result = await asActor("SELECT couple_id,role FROM profiles WHERE id=$1", [owner!.slice(3)]);
        return respond(result.rows[0] ?? null);
      }
      if (!url.pathname.endsWith("/amora_personal_actions")) throw new Error("Unexpected local table");
      const values: unknown[] = []; const where: string[] = [];
      const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
      for (const column of ["owner_user_id","id","revision","status"]) {
        const raw = url.searchParams.get(column);
        if (raw) { expect(raw.startsWith("eq.")).toBe(true); where.push(`${column}=${bind(raw.slice(3))}`); }
      }
      const sourceCouple = url.searchParams.get("source.couple_id");
      const sourceVisibility = url.searchParams.get("source.visibility");
      if (sourceCouple || sourceVisibility) {
        expect(url.searchParams.get("select")).toContain("source:chat_messages!amora_personal_actions_source_message_id_fkey!inner(couple_id,visibility)");
        expect(sourceCouple?.startsWith("eq.")).toBe(true); expect(sourceVisibility?.startsWith("eq.")).toBe(true);
        where.push(`EXISTS(SELECT 1 FROM chat_messages src WHERE src.id=action.source_message_id AND src.couple_id=${bind(sourceCouple!.slice(3))} AND src.visibility=${bind(sourceVisibility!.slice(3))})`);
      }
      const filter = url.searchParams.get("or");
      if (filter) {
        const match = /^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([0-9a-f-]+)\)\)$/.exec(filter);
        if (!match || match[1] !== match[2]) throw new Error("Unexpected actual cursor filter");
        const time = bind(match[1]); const id = bind(match[3]);
        where.push(`(created_at<${time}::timestamptz OR(created_at=${time}::timestamptz AND id<${id}::uuid))`);
      }
      const predicate = where.length ? where.join(" AND ") : "true";
      if (request.method === "HEAD") {
        const result = await asActor(`SELECT count(*)::integer AS count FROM amora_personal_actions AS action WHERE ${predicate}`, values);
        if (sourceCouple) await afterConversationRead?.();
        return new Response(null, { status: 200, headers: { "content-range": `0-0/${result.rows[0].count}` } });
      }
      let sql: string;
      if (request.method === "PATCH") {
        const payload = await request.json(); expect(Object.keys(payload)).toEqual(["status"]);
        sql = `UPDATE amora_personal_actions SET status=${bind(payload.status)} WHERE ${predicate} RETURNING to_jsonb(amora_personal_actions) AS value`;
      } else if (request.method === "DELETE") sql = `DELETE FROM amora_personal_actions WHERE ${predicate} RETURNING to_jsonb(amora_personal_actions) AS value`;
      else {
        const limit = Number(url.searchParams.get("limit") ?? 300); expect(limit).toBeLessThanOrEqual(300);
        sql = `SELECT to_jsonb(action) AS value FROM amora_personal_actions AS action WHERE ${predicate} ORDER BY created_at DESC,id DESC LIMIT ${bind(limit)}`;
      }
      const result = await asActor(sql, values); const rows = result.rows.map(row => row.value);
      return respond(request.headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows);
    } catch (error) {
      const detail = error as { code?: string; message: string };
      if (!detail.code) throw error;
      return respond({ code: detail.code, message: detail.message }, 400);
    }
  }
  const request = (method: string, value: Record<string,unknown>) => new Request("https://hanbang.ai/api/amora/personal-actions", { method, headers: { authorization: "Bearer synthetic", "content-type": "application/json" }, body: JSON.stringify(value) });
  const draft = { title: "개인 상담 후 확인할 질문", description: null, dueDate: null };
  const saveBody = (overrides: Record<string,unknown> = {}) => ({ messageId: AI_MESSAGE, requestId: REQUEST, expectedOwnerId: actor, expectedCoupleId: COUPLE, ...draft, ...overrides });
  async function save(overrides: Record<string,unknown> = {}) {
    const response = await POST(request("POST", saveBody(overrides)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(parsePersonalActionReceipt(body, actor, { kind: "save", sourceMessageId: AI_MESSAGE, draft: { ...draft, ...overrides } })).not.toBeNull();
    return body.action as { id: string; revision: number; status: string };
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      CREATE TABLE couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE profiles(id uuid PRIMARY KEY,couple_id uuid,role text);
      CREATE TABLE conversation_segments(id uuid PRIMARY KEY,couple_id uuid,visibility text,owner_user_id uuid);
      CREATE TABLE chat_messages(id uuid PRIMARY KEY,couple_id uuid,segment_id uuid,visibility text,sender_id uuid,sender_type text,role text,metadata jsonb);
      GRANT SELECT ON profiles,chat_messages TO authenticated;
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated USING(id=auth.uid());`);
    const sql = readFileSync(migration, "utf8");
    if (sql.trim()) await db.exec(sql);
    const client = createClient("http://127.0.0.1:55431", "synthetic-local-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localPostgrest } });
    vi.spyOn(client.auth,"getUser").mockImplementation(async () => ({ data: { user: { id: actor } }, error: null }) as never);
    mocks.client = client;
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    actor = OWNER; unavailable = false; tamperReceipt = false; beforeRpc = null; requestCount = 0; afterConversationRead = null;
    await db.exec("TRUNCATE chat_messages,conversation_segments,profiles,couples,auth.users CASCADE");
    await db.query("INSERT INTO auth.users VALUES ($1),($2)", [OWNER, PARTNER]);
    await db.query("INSERT INTO couples VALUES ($1,$2,$3)", [COUPLE, OWNER, PARTNER]);
    await db.query("INSERT INTO profiles VALUES ($1,$3,'bride'),($2,$3,'groom')", [OWNER, PARTNER, COUPLE]);
    await db.query("INSERT INTO conversation_segments VALUES ($1,$2,'bride_private',$3)", [SEGMENT, COUPLE, OWNER]);
    await db.query("INSERT INTO chat_messages VALUES ($1,$3,$4,'bride_private',$5,'bride','user','{}'),($2,$3,$4,'bride_private',null,'ai','assistant',$6::jsonb)", [USER_MESSAGE, AI_MESSAGE, COUPLE, SEGMENT, OWNER, JSON.stringify({ in_reply_to_user_message_id: USER_MESSAGE })]);
  });
  it("installs an owner-only table with row security enabled", async () => {
    const result = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.amora_personal_actions')");
    expect(result.rows).toEqual([{ relrowsecurity: true }]);
  });
  it("saves the exact confirmed draft, replays its request once, and rejects changed replay content", async () => {
    const first = await save(); const replay = await save();
    expect(replay.id).toBe(first.id);
    expect((await db.query("SELECT id FROM amora_personal_actions")).rows).toHaveLength(1);
    expect((await POST(request("POST",saveBody({ title: "다른 합성 제목" })))).status).toBe(409);
    const list = await (await GET(new Request("https://hanbang.ai/api/amora/personal-actions?status=all&limit=30"))).json();
    expect(parsePersonalActionPage(list, OWNER)?.actions[0].title).toBe(draft.title);
  });
  it.each([
    ["shared", "UPDATE chat_messages SET visibility='shared' WHERE id=$1"],
    ["partner slot", "UPDATE chat_messages SET visibility='groom_private' WHERE id=$1"],
    ["user message", "UPDATE chat_messages SET sender_type='bride',role='user' WHERE id=$1"],
    ["forged AI sender", "UPDATE chat_messages SET sender_id='11111111-1111-4111-8111-111111111111' WHERE id=$1"],
    ["missing segment", "UPDATE chat_messages SET segment_id=null WHERE id=$1"],
    ["missing requester", "UPDATE chat_messages SET metadata='{}' WHERE id=$1"],
  ])("rejects %s source without private state leakage", async (name, sql) => {
    await db.query(sql,[AI_MESSAGE]);
    const response = await POST(request("POST",saveBody()));
    expect(response.status).toBe(name.startsWith("missing") ? 409 : 403);
    if (name.startsWith("missing")) expect(await response.json()).toMatchObject({code:"PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE"});
    expect((await db.query("SELECT id FROM amora_personal_actions")).rows).toHaveLength(0);
  });
  it("rejects a predecessor's private segment even after reusing the bride slot", async () => {
    await db.query("UPDATE conversation_segments SET owner_user_id=$1 WHERE id=$2",[PARTNER,SEGMENT]);
    expect((await POST(request("POST",saveBody()))).status).toBe(403);
  });
  it("binds the AI answer to the actual requester account, not just the private role label", async () => {
    await db.query("UPDATE chat_messages SET sender_id=$1 WHERE id=$2",[PARTNER,USER_MESSAGE]);
    expect((await POST(request("POST",saveBody()))).status).toBe(403);
  });
  it("rechecks membership inside the atomic save after a concurrent unlink", async () => {
    beforeRpc = async () => { await db.query("UPDATE profiles SET couple_id=null WHERE id=$1",[OWNER]); };
    expect((await POST(request("POST",saveBody()))).status).toBe(403);
    expect((await db.query("SELECT id FROM amora_personal_actions")).rows).toHaveLength(0);
  });
  it("rejects an expected actor mismatch before any database operation", async () => {
    expect((await POST(request("POST",saveBody({ expectedOwnerId: PARTNER })))).status).toBe(403);
    expect(requestCount).toBe(0);
  });
  it("a partner cannot read, modify, delete, or overwrite provenance through the direct authenticated API", async () => {
    const item = await save();
    actor = PARTNER;
    expect((await asActor("SELECT id FROM amora_personal_actions")).rows).toHaveLength(0);
    expect((await asActor("UPDATE amora_personal_actions SET status='done' WHERE id=$1 RETURNING id",[item.id])).rows).toHaveLength(0);
    expect((await asActor("DELETE FROM amora_personal_actions WHERE id=$1 RETURNING id",[item.id])).rows).toHaveLength(0);
    const partnerList = await GET(new Request("https://hanbang.ai/api/amora/personal-actions"));
    expect(await partnerList.json()).toEqual({actions:[],count:0,next_cursor:null});
    expect((await PATCH(request("PATCH",{ id:item.id,status:"done",expectedRevision:1,expectedOwnerId:PARTNER }))).status).toBe(404);
    actor = OWNER;
    await expect(asActor("UPDATE amora_personal_actions SET owner_user_id=$1 WHERE id=$2",[PARTNER,item.id])).rejects.toMatchObject({ code: "42501" });
    await expect(asActor("INSERT INTO amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title) VALUES($1,$2,$3,$4,'forged')",[OWNER,AI_MESSAGE,USER_MESSAGE,REQUEST])).rejects.toMatchObject({ code: "42501" });
    expect((await db.query("SELECT status FROM amora_personal_actions WHERE id=$1",[item.id])).rows).toEqual([{status:"open"}]);
  });
  it("keeps owner-only access after unlink and uses server revision CAS for status and deletion", async () => {
    const item = await save(); await db.query("UPDATE profiles SET couple_id=null WHERE id=$1",[OWNER]);
    const updated = await PATCH(request("PATCH",{id:item.id,status:"done",expectedRevision:1,expectedOwnerId:OWNER}));
    expect(updated.status).toBe(200); expect((await updated.json()).action).toMatchObject({status:"done",revision:2});
    expect((await PATCH(request("PATCH",{id:item.id,status:"open",expectedRevision:1,expectedOwnerId:OWNER}))).status).toBe(409);
    expect((await DELETE(request("DELETE",{id:item.id,expectedRevision:1,expectedOwnerId:OWNER}))).status).toBe(409);
    const removed = await DELETE(request("DELETE",{id:item.id,expectedRevision:2,expectedOwnerId:OWNER}));
    expect(await removed.json()).toEqual({deleted:true,id:item.id});
    expect((await DELETE(request("DELETE",{id:item.id,expectedRevision:2,expectedOwnerId:OWNER}))).status).toBe(200);
  });
  it.each([AI_MESSAGE,USER_MESSAGE])("hard-deleting source %s deletes its private derivative", async id => {
    await save(); await db.query("DELETE FROM chat_messages WHERE id=$1",[id]);
    expect((await db.query("SELECT id FROM amora_personal_actions")).rows).toHaveLength(0);
  });
  it("cannot execute the privileged creator anonymously", async () => {
    await expect(db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE anon");
      await tx.query("SELECT public.save_own_amora_personal_action($1,$2,$3,$4,'forged',null,null)",[OWNER,COUPLE,AI_MESSAGE,REQUEST]);
    })).rejects.toMatchObject({code:"42501"});
  });
  it("does not claim success for a mismatched persisted receipt and safely recovers with the same request", async () => {
    tamperReceipt = true;
    expect((await POST(request("POST",saveBody()))).status).toBe(503);
    tamperReceipt = false; await save();
    expect((await db.query("SELECT id FROM amora_personal_actions")).rows).toHaveLength(1);
  });
  it("surfaces unavailable reads and writes without leaking the database's private detail", async () => {
    unavailable = true;
    for (const response of [await GET(new Request("https://hanbang.ai/api/amora/personal-actions")),await POST(request("POST",saveBody()))]) {
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
    }
  });
  it("validates UTF16 and calendar boundaries both at the API and direct RPC", async () => {
    await save({title:"😀".repeat(60),description:"😀".repeat(250),dueDate:"2028-02-29"});
    expect((await POST(request("POST",saveBody({title:"😀".repeat(61)})))).status).toBe(400);
    expect((await POST(request("POST",saveBody({dueDate:"2027-02-29"})))).status).toBe(400);
    await expect(asActor("SELECT public.save_own_amora_personal_action($1,$2,$3,$4,$5,null,null)",[OWNER,COUPLE,AI_MESSAGE,REQUEST,"😀".repeat(61)])).rejects.toMatchObject({code:"22023"});
  });
  it("paginates all owner rows by exact microsecond keyset and preserves status counts", async () => {
    await save();
    await db.query(`INSERT INTO amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title,status,created_at)
      SELECT $1,$2,$3,gen_random_uuid(),'합성 개인 할 일',CASE WHEN n%2=0 THEN 'done' ELSE 'open' END,'2026-09-01T00:00:00Z'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,64)n`,[OWNER,AI_MESSAGE,USER_MESSAGE]);
    const ids: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const response = await GET(new Request(`https://hanbang.ai/api/amora/personal-actions?limit=30${cursor ? `&cursor=${cursor}` : ""}`));
      expect(response.status).toBe(200);
      const page = await response.json(); expect(parsePersonalActionPage(page,OWNER)).not.toBeNull();
      expect(page.count).toBe(pages === 0 ? 65 : 66);
      expect(page.actions.length).toBeLessThanOrEqual(30);
      ids.push(...page.actions.map((row: {id:string}) => row.id)); cursor = page.next_cursor; pages++;
      if (pages === 1) await db.query(`INSERT INTO amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title) VALUES($1,$2,$3,gen_random_uuid(),'추가된 새 행')`,[OWNER,AI_MESSAGE,USER_MESSAGE]);
      expect(pages).toBeLessThan(4);
    } while(cursor);
    expect(ids).toHaveLength(65); expect(new Set(ids).size).toBe(65);
    const done = await (await GET(new Request("https://hanbang.ai/api/amora/personal-actions?status=done&limit=7"))).json();
    expect(done.count).toBe(32); expect(done.actions).toHaveLength(7);
    expect(done.actions.every((row: {status:string}) => row.status === "done")).toBe(true);
    actor = PARTNER;
    expect((await GET(new Request(`https://hanbang.ai/api/amora/personal-actions?status=done&cursor=${done.next_cursor}`))).status).toBe(400);
  });
  it("replays the original request at capacity and rejects a new request without a partial insert", async () => {
    const first = await save();
    await db.query(`INSERT INTO amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title)
      SELECT $1,$2,$3,gen_random_uuid(),'합성 한도 항목' FROM generate_series(1,299)`,[OWNER,AI_MESSAGE,USER_MESSAGE]);
    expect((await save()).id).toBe(first.id);
    const limited = await POST(request("POST",saveBody({requestId:"88888888-8888-4888-8888-888888888888"})));
    expect(limited.status).toBe(409);
    expect(await limited.json()).toMatchObject({code:"PERSONAL_ACTION_LIMIT_REACHED"});
    expect((await db.query("SELECT count(*)::int AS count FROM amora_personal_actions")).rows).toEqual([{count:300}]);
  });
  it.each(["PATCH","DELETE"])("requires expectedOwnerId on %s before database access", async method => {
    const fn = method === "PATCH" ? PATCH : DELETE;
    expect((await fn(request(method,{id:AI_MESSAGE,expectedRevision:1,status:method === "PATCH" ? "done" : undefined,expectedOwnerId:PARTNER}))).status).toBe(403);
    expect(requestCount).toBe(0);
  });
  it("fresh-reads only the chosen owner's current private source for conversation and excludes deleted/partner/old-couple rows", async () => {
    const action = await save();
    const url = `https://hanbang.ai/api/amora/personal-actions?conversationCoupleId=${COUPLE}&actionId=${action.id}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actions: [{ id: action.id, title: draft.title }], count: 1, next_cursor: null });
    const client = mocks.client as ReturnType<typeof createClient>;
    expect(await readPersonalActionConversationCount(client, OWNER, COUPLE, "bride_private", "all")).toBe(1);
    actor = PARTNER;
    expect(await (await GET(new Request(url))).json()).toMatchObject({ actions: [], count: 0 });
    actor = OWNER;
    await db.query("UPDATE chat_messages SET couple_id=$1 WHERE id=$2", ["88888888-8888-4888-8888-888888888888", AI_MESSAGE]);
    expect(await (await GET(new Request(url))).json()).toMatchObject({ actions: [], count: 0 });
    expect(await readPersonalActionConversationCount(client, OWNER, COUPLE, "bride_private", "all")).toBe(0);
    await db.query("UPDATE chat_messages SET couple_id=$1,visibility='shared' WHERE id=$2", [COUPLE, AI_MESSAGE]);
    expect(await (await GET(new Request(url))).json()).toMatchObject({ actions: [], count: 0 });
    await db.query("DELETE FROM chat_messages WHERE id=$1", [AI_MESSAGE]);
    expect(await (await GET(new Request(url))).json()).toMatchObject({ actions: [], count: 0 });
  });
  it("rejects a couple change during the conversation read instead of returning the stale selection or count", async () => {
    const action = await save();
    afterConversationRead = async () => { await db.query("UPDATE profiles SET couple_id=null WHERE id=$1", [OWNER]); };
    const response = await GET(new Request(`https://hanbang.ai/api/amora/personal-actions?conversationCoupleId=${COUPLE}&actionId=${action.id}`));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(draft.title);
    await expect(readPersonalActionConversationCount(mocks.client as ReturnType<typeof createClient>, OWNER, COUPLE, "bride_private", "all")).rejects.toThrow("PERSONAL_ACTION_CONVERSATION_SCOPE_CHANGED");
    await db.query("UPDATE profiles SET couple_id=$1 WHERE id=$2", [COUPLE, OWNER]);
    await expect(readPersonalActionConversationCount(mocks.client as ReturnType<typeof createClient>, OWNER, COUPLE, "bride_private", "all")).rejects.toThrow("PERSONAL_ACTION_CONVERSATION_SCOPE_CHANGED");
  });
  it("rejects a selected-action query without a current couple boundary", async () => {
    expect((await GET(new Request(`https://hanbang.ai/api/amora/personal-actions?actionId=${AI_MESSAGE}`))).status).toBe(400);
  });
});
