// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createCustomerDataBoundaryFixture, A, B, C, J, T, M } from "../../../../../scripts/tests/fixtures/account-deletion-customer-data-database.mjs";
import { buildAmoraInitialGreetingRequestKey } from "@/lib/ai/amoraInitialGreetingKey";

const sql = (name: string) => readFileSync(resolve(process.cwd(), "../../supabase/migrations", name), "utf8");

// Execute the real new migration and real pre-existing private boundary / roster
// cleanup functions. The fixture models only their table/FK dependencies; it is
// not a full 231-migration or hosted Storage/Auth integration substitute.
async function database(subjectRole: "bride" | "groom" = "bride", coupled = true) {
  return createCustomerDataBoundaryFixture({ createDatabase: () => PGlite.create(), readMigration: sql, subjectRole, coupled });
}

async function prepare(db: PGlite, token = T) {
  return db.query<{ ok: boolean }>("SELECT public.prepare_account_deletion_customer_data($1,$2) AS ok", [J, token]);
}
async function authDelete(db: PGlite) {
  await db.query("SELECT public.prepare_account_deletion_auth_delete($1,$2)", [J,T]);
  await db.query("DELETE FROM auth.users WHERE id=$1", [A]);
}
async function survivors(db: PGlite) {
  return (await db.query<{data: unknown}>(`SELECT jsonb_build_object(
    'budgets',(SELECT jsonb_agg(payload) FROM budgets),
    'schedules',(SELECT jsonb_agg(payload) FROM schedules),
    'journey',(SELECT jsonb_agg(payload) FROM wedding_journeys),
    'shared',(SELECT jsonb_agg(content ORDER BY content) FROM chat_messages WHERE visibility='shared'),
    'decisions',(SELECT jsonb_agg(title ORDER BY title) FROM decision_nodes WHERE visibility='shared'),
    'summary',(SELECT jsonb_agg(summary) FROM chat_summaries WHERE visibility='shared'),
    'partner',(SELECT jsonb_agg(content) FROM chat_messages WHERE sender_id='${B}'),
    'notes',(SELECT jsonb_agg(content) FROM amora_saved_notes WHERE message_id IS NULL)
  ) AS data`)).rows[0].data;
}

describe("account deletion customer data SQL boundary", () => {
  it.each(["bride", "groom"] as const)("purges %s-private provenance before Auth and preserves surviving shared/partner data", async role => {
    const db = await database(role);
    try {
      const before = await survivors(db);
      expect((await prepare(db)).rows[0].ok).toBe(true);
      expect((await db.query<{count: number}>(`SELECT count(*)::int AS count FROM chat_messages WHERE visibility='${role}_private'`)).rows[0].count).toBe(0);
      for (const table of ["amora_chat_request_claims","amora_tool_executions","amora_memory_enqueue_repair_candidates","amora_memory_enqueue_repair_dead_letters"]) {
        expect((await db.query<{count: number}>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
      }
      expect((await db.query<{count: number}>(`SELECT count(*)::int AS count FROM decision_nodes WHERE visibility='${role}_private'`)).rows[0].count).toBe(0);
      expect((await db.query<{count: number}>("SELECT count(*)::int AS count FROM amora_saved_notes WHERE message_id IS NOT NULL")).rows[0].count).toBe(0);
      expect(await survivors(db)).toEqual(before);
      await authDelete(db);
      expect(await survivors(db)).toEqual(before);
      await db.exec(`UPDATE account_deletion_jobs SET status='completed',user_id=NULL,claim_token=NULL WHERE id='${J}'`);
      // Fresh transaction starts after Auth deletion and finalization. The old
      // timestamp-only hard-delete fence would allow it; the retired lane does not.
      await expect(db.exec(`INSERT INTO chat_messages(couple_id,sender_type,role,content,visibility) VALUES('${C}','ai','assistant','late leaked reply','${role}_private')`)).rejects.toThrow(/PRIVATE_SCOPE_RETIRED/);
      await db.exec(`INSERT INTO chat_messages(couple_id,sender_type,role,content,visibility) VALUES('${C}','ai','assistant','new shared reply','shared')`);
    } finally { await db.close(); }
  });

  it("does not delete or stamp anything for a wrong claim and forbids direct Auth bypass", async () => {
    const db = await database();
    try {
      expect((await prepare(db, B)).rows[0].ok).toBe(false);
      expect((await db.query<{ready: boolean}>("SELECT data_prepared_at IS NOT NULL AS ready FROM account_deletion_jobs")).rows[0].ready).toBe(false);
      expect((await db.query<{ok: boolean}>(`SELECT prepare_account_deletion_auth_delete('${J}','${T}') AS ok`)).rows[0].ok).toBe(false);
      await expect(db.exec(`DELETE FROM auth.users WHERE id='${A}'`)).rejects.toThrow(/CUSTOMER_DATA_NOT_PREPARED/);
    } finally { await db.close(); }
  });

  it.each(["quarantine", "grace", "vendor", "legacy", "mixed-owner"])("fails closed before data changes for %s scope", async kind => {
    const db = await database();
    try {
      if (kind === "quarantine") await db.exec(`UPDATE account_deletion_jobs SET quarantine_count=1`);
      if (kind === "grace") await db.exec(`UPDATE account_deletion_jobs SET ready_after=now()+interval '1 hour'`);
      if (kind === "vendor") await db.exec(`INSERT INTO vendors(owner_id) VALUES('${A}')`);
      if (kind === "legacy") {
        await db.exec(`ALTER TABLE chat_messages DISABLE TRIGGER USER; UPDATE chat_messages SET visibility='groom_private' WHERE id='${M}'; ALTER TABLE chat_messages ENABLE TRIGGER USER`);
      }
      if (kind === "mixed-owner") await db.exec(`ALTER TABLE chat_messages DISABLE TRIGGER USER; UPDATE chat_messages SET sender_id='${B}' WHERE id='${M}'; ALTER TABLE chat_messages ENABLE TRIGGER USER`);
      await expect(prepare(db)).rejects.toThrow(/CUSTOMER_SCOPE_REVIEW_REQUIRED/);
      expect((await db.query<{ready: boolean}>("SELECT data_prepared_at IS NOT NULL AS ready FROM account_deletion_jobs")).rows[0].ready).toBe(false);
      expect((await db.query<{count: number}>("SELECT count(*)::int AS count FROM amora_tool_executions")).rows[0].count).toBe(1);
    } finally { await db.close(); }
  });

  it("rolls back the purge and durable receipt if a later delete fails", async () => {
    const db = await database();
    try {
      await db.exec(`CREATE FUNCTION fixture_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-failure'; END $$; CREATE TRIGGER fixture_fail BEFORE DELETE ON chat_messages FOR EACH ROW EXECUTE FUNCTION fixture_fail_delete()`);
      await expect(prepare(db)).rejects.toThrow("fixture-failure");
      expect((await db.query<{count: number}>("SELECT count(*)::int AS count FROM amora_tool_executions")).rows[0].count).toBe(1);
      expect((await db.query<{count: number}>("SELECT count(*)::int AS count FROM account_deletion_private_scopes")).rows[0].count).toBe(0);
      expect((await db.query<{ready: boolean}>("SELECT data_prepared_at IS NOT NULL AS ready FROM account_deletion_jobs")).rows[0].ready).toBe(false);
    } finally { await db.close(); }
  });

  it("allows exact receipt retry after Auth is gone without reconstructing ownership", async () => {
    const db = await database();
    try {
      await prepare(db); await authDelete(db);
      await db.exec(`UPDATE account_deletion_jobs SET claim_token='${B}'`);
      expect((await prepare(db, B)).rows[0].ok).toBe(true);
      await db.exec("UPDATE account_deletion_jobs SET data_prepared_at=NULL,data_prepared_version=NULL");
      await expect(prepare(db, B)).rejects.toThrow(/CUSTOMER_SCOPE_REVIEW_REQUIRED/);
    } finally { await db.close(); }
  });

  it("freezes only departing membership and private writes, retaining partner control", async () => {
    const db = await database();
    try {
      await expect(db.exec(`UPDATE profiles SET couple_id=NULL WHERE id='${A}'`)).rejects.toThrow(/MEMBERSHIP_FROZEN/);
      await expect(db.exec(`UPDATE couples SET bride_id=NULL WHERE id='${C}'`)).rejects.toThrow(/MEMBERSHIP_FROZEN/);
      await expect(db.exec(`UPDATE profiles SET couple_id=NULL WHERE id='${B}'`)).rejects.toThrow(/MEMBERSHIP_FROZEN/);
      await expect(db.exec(`UPDATE couples SET groom_id=NULL WHERE id='${C}'`)).rejects.toThrow(/MEMBERSHIP_FROZEN/);
      await expect(db.exec(`INSERT INTO chat_messages(couple_id,sender_id,visibility) VALUES('${C}','${A}','bride_private')`)).rejects.toThrow(/CUSTOMER_WRITE_FROZEN/);
      await expect(db.exec(`UPDATE amora_tool_executions SET result='{"late":true}'`)).rejects.toThrow(/CUSTOMER_WRITE_FROZEN/);
      await db.exec(`INSERT INTO chat_messages(couple_id,sender_id,visibility) VALUES('${C}','${B}','groom_private')`);
    } finally { await db.close(); }
  });

  it("supports last-member cascade without recreating retired aggregate children", async () => {
    const db = await database("bride", false);
    try {
      await prepare(db); await authDelete(db);
      expect((await db.query<{count: number}>("SELECT count(*)::int AS count FROM couples")).rows[0].count).toBe(0);
      expect((await prepare(db)).rows[0].ok).toBe(true);
    } finally { await db.close(); }
  });

  it("is service-only and keeps receipt/fence data unavailable to ordinary clients", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE authenticated");
      await expect(prepare(db)).rejects.toThrow(/permission denied/);
      await expect(db.exec("SELECT * FROM account_deletion_private_scopes")).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE; SET ROLE service_role");
      expect((await prepare(db)).rows[0].ok).toBe(true);
    } finally { await db.close(); }
  });

  it.each(["timestamp-only", "version-only"])("rejects an incomplete %s durable receipt", async form => {
    const db = await database();
    try {
      await expect(db.exec(form === "timestamp-only"
        ? "UPDATE account_deletion_jobs SET data_prepared_at=now()"
        : "UPDATE account_deletion_jobs SET data_prepared_version=1")).rejects.toThrow(/account_deletion_data_receipt_pair/);
    } finally { await db.close(); }
  });

  it("preserves real greeting/lifecycle/mediation and legacy tool contracts outside deletion", async () => {
    const db = await database();
    try {
      await db.exec("DELETE FROM account_deletion_jobs");
      const keys = [buildAmoraInitialGreetingRequestKey({ actorId:A, coupleId:C, visibility:"shared", resetAt:null }),
        buildAmoraInitialGreetingRequestKey({ actorId:A, coupleId:C, visibility:"shared", resetAt:"2026-09-13T00:00:00.000Z" }),
        `mediation:${"a".repeat(64)}`];
      for (const requestKey of keys) {
        await db.query("INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility) VALUES($1,$2,$3,'shared')",[C,requestKey,A]);
        await db.query("INSERT INTO amora_tool_executions VALUES($1,$2,'budget','{}')",[C,requestKey]);
      }
      await db.exec(`INSERT INTO amora_tool_executions VALUES('${C}','legacy-unclassified-service-operation','op','{}')`);
      await db.exec(`UPDATE amora_saved_notes SET content='partner edited own note' WHERE message_id IS NULL`);
      await db.exec(`INSERT INTO chat_messages(couple_id,sender_id,visibility) VALUES('${C}','${A}','shared'),('${C}','${B}','groom_private')`);
      expect((await db.query<{count:number}>("SELECT count(*)::int AS count FROM amora_tool_executions")).rows[0].count).toBe(5);
    } finally { await db.close(); }
  });

  it("retires hashed system requests after claims vanish, without keeping raw request keys", async () => {
    const db = await database();
    try {
      const systemKey = buildAmoraInitialGreetingRequestKey({actorId:A,coupleId:C,visibility:"shared",resetAt:"2026-09-13T00:00:00.000Z"});
      await db.exec("ALTER TABLE amora_chat_request_claims DISABLE TRIGGER USER; ALTER TABLE amora_tool_executions DISABLE TRIGGER USER");
      await db.query("INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility) VALUES($1,$2,$3,'shared')",[C,systemKey,A]);
      await db.query("INSERT INTO amora_tool_executions VALUES($1,$2,'op','{}')",[C,systemKey]);
      await db.exec("ALTER TABLE amora_chat_request_claims ENABLE TRIGGER USER; ALTER TABLE amora_tool_executions ENABLE TRIGGER USER");
      await prepare(db); await authDelete(db);
      await db.exec(`UPDATE account_deletion_jobs SET status='completed',user_id=NULL,claim_token=NULL`);
      await expect(db.query("INSERT INTO amora_tool_executions VALUES($1,$2,'late','{}')",[C,systemKey])).rejects.toThrow(/CUSTOMER_REQUEST_RETIRED/);
      const rows = (await db.query<{request_digest:string}>("SELECT request_digest FROM account_deletion_retired_requests")).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every(row => /^[a-f0-9]{64}$/.test(row.request_digest))).toBe(true);
    } finally { await db.close(); }
  });

  it("leaves truly ownerless legacy tool payloads for review instead of stamping completion", async () => {
    const db = await database();
    try {
      await db.exec("ALTER TABLE amora_tool_executions DISABLE TRIGGER USER");
      await db.exec(`INSERT INTO amora_tool_executions VALUES('${C}','legacy-unknown-owner','op','{"personal":"unknown owner"}')`);
      await db.exec("ALTER TABLE amora_tool_executions ENABLE TRIGGER USER");
      await expect(prepare(db)).rejects.toThrow(/CUSTOMER_SCOPE_REVIEW_REQUIRED/);
      expect((await db.query<{ready:boolean}>("SELECT data_prepared_at IS NOT NULL AS ready FROM account_deletion_jobs")).rows[0].ready).toBe(false);
    } finally { await db.close(); }
  });

  it("does not let an unchanged partner's deletion job deadlock both Auth cascades", async () => {
    const db = await database();
    try {
      const secondJob = "30000000-0000-4000-8000-000000000002";
      await db.query("INSERT INTO account_deletion_jobs(id,user_id,status,claim_token,ready_after) VALUES($1,$2,'deleting',$3,now()-interval '1 hour')",[secondJob,B,T]);
      await prepare(db);
      expect((await db.query<{ok:boolean}>("SELECT prepare_account_deletion_customer_data($1,$2) AS ok",[secondJob,T])).rows[0].ok).toBe(true);
      await authDelete(db);
      await db.query("SELECT prepare_account_deletion_auth_delete($1,$2)",[secondJob,T]);
      await db.query("DELETE FROM auth.users WHERE id=$1",[B]);
      expect((await db.query<{count:number}>("SELECT count(*)::int AS count FROM couples")).rows[0].count).toBe(0);
    } finally { await db.close(); }
  });

  it("preserves a legacy shared summary outside the current couple for scope review", async () => {
    const db = await database();
    try {
      const previousCouple = "10000000-0000-4000-8000-000000000002";
      await db.query("INSERT INTO couples(id) VALUES($1)", [previousCouple]);
      await db.exec("ALTER TABLE chat_summaries DISABLE TRIGGER USER");
      await db.query("INSERT INTO chat_summaries(couple_id,user_id,visibility,summary) VALUES($1,$2,'shared','legacy shared source')", [previousCouple,A]);
      await db.exec("ALTER TABLE chat_summaries ENABLE TRIGGER USER");
      await expect(prepare(db)).rejects.toThrow(/CUSTOMER_SCOPE_REVIEW_REQUIRED/);
      expect((await db.query<{summary: string}>("SELECT summary FROM chat_summaries WHERE couple_id=$1", [previousCouple])).rows).toEqual([{summary: "legacy shared source"}]);
      expect((await db.query<{ready: boolean}>("SELECT data_prepared_at IS NOT NULL AS ready FROM account_deletion_jobs WHERE id=$1", [J])).rows[0].ready).toBe(false);
    } finally { await db.close(); }
  });

  it("keeps the global memory queue usable with frozen pending/expired jobs", async () => {
    const db = await database();
    try {
      await db.exec(`UPDATE amora_memory_jobs SET claimed_at=now()-interval '1 hour',attempt_count=5`);
      await db.exec(`ALTER TABLE amora_memory_jobs DISABLE TRIGGER USER;
        INSERT INTO amora_memory_jobs(couple_id,user_id,visibility,status,created_at) VALUES
          ('${C}','${A}','shared','pending',now()-interval '2 hours'),
          ('${C}','${B}','shared','pending',now());
        ALTER TABLE amora_memory_jobs ENABLE TRIGGER USER`);
      const claimed=(await db.query<{user_id:string}>("SELECT * FROM claim_amora_memory_job(300,NULL)")).rows;
      expect(claimed).toHaveLength(1); expect(claimed[0].user_id).toBe(B);
      expect((await db.query<{status:string}>(`SELECT status FROM amora_memory_jobs WHERE user_id='${A}' AND visibility='bride_private'`)).rows[0].status).toBe("failed");
      await prepare(db);
      await expect(db.exec(`INSERT INTO chat_summaries(couple_id,user_id,visibility,summary) VALUES('${C}','${A}','shared','late subject summary')`)).rejects.toThrow(/CUSTOMER_WRITE_FROZEN/);
      await db.exec(`INSERT INTO chat_summaries(couple_id,user_id,visibility,summary) VALUES('${C}','${B}','shared','partner summary')`);
    } finally { await db.close(); }
  });

  it("supports a verified unlinked profile without inventing a private lane", async () => {
    const db = await database();
    try {
      await db.exec(`UPDATE account_deletion_jobs SET status='completed',user_id=NULL; DELETE FROM couples; UPDATE account_deletion_jobs SET status='deleting',user_id='${A}'`);
      expect((await prepare(db)).rows[0].ok).toBe(true);
      expect((await db.query<{count:number}>("SELECT count(*)::int AS count FROM account_deletion_private_scopes")).rows[0].count).toBe(0);
      await authDelete(db);
      expect((await prepare(db)).rows[0].ok).toBe(true);
    } finally { await db.close(); }
  });
});
