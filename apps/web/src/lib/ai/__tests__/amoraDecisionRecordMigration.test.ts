// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { SCHEDULE_CATEGORY_KEYS } from "@/lib/ai/tools";
import {
  createBudgetDecisionDatabase, migration, COUPLE_ID, USER_ID, PARTNER_ID, OUTSIDER_ID,
  OTHER_COUPLE_ID,
} from "./fixtures/amoraBudgetDecisionDatabase";

const NEXT = "20260921100000_amora_approved_decision_records.sql";
const TOOL = "add_decision_record";
const databases: PGlite[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });

function definitions(sql: string, name: string) {
  return [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\$function\$;/gu)]
    .map(([definition]) => definition)
    .filter((definition) => definition.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`));
}

async function setup() {
  const db = await createBudgetDecisionDatabase();
  databases.push(db);
  await db.exec("RESET ROLE");
  await db.exec(migration("20260915101500_amora_atomic_not_applicable_status.sql"));
  const claims = definitions(migration("20260823120000_couple_approval_becomes_notification.sql"), "claim_amora_tool_execution");
  expect(claims).toHaveLength(2);
  for (const definition of claims) await db.exec(definition);
  await db.exec(definitions(migration("20260802140000_amora_manual_schedule_fairness.sql"), "enforce_amora_shared_action_execution")[0]);
  if (existsSync(resolve(process.cwd(), "../../supabase/migrations", NEXT))) await db.exec(migration(NEXT));
  await db.exec("SET ROLE service_role");
  return db;
}

async function proposal(db: PGlite, input: Record<string, unknown> = {
  title: "양가 식사는 따로 논의하기", status: "considering", memo: "일정을 먼저 확인하기", category_key: "meeting",
}, toolName = TOOL) {
  const actionId = randomUUID(), proposalId = randomUUID(), confirmationId = randomUUID();
  const requestKey = `chat:${USER_ID}:${randomUUID()}`;
  const identity = getAmoraToolOperationIdentity(toolName, input);
  const revision = (await db.query<{ revision: number }>(
    "SELECT state_revision::integer AS revision FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID],
  )).rows[0].revision;
  const now = Date.now();
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,'ai','assistant','DO_NOT_COPY_UNAPPROVED_CONTEXT','shared',$3::jsonb,clock_timestamp())`,
  [proposalId, COUPLE_ID, JSON.stringify({ pending_amora_action: { version: 2, actionId, tool: toolName,
    input, inputDigest: identity.inputDigest, operationKey: identity.operationKey,
    confirmation: "이 내용을 함께 보는 결정 기록에 저장할까요?", issuedAt: now, expiresAt: now + 600_000 },
  pending_amora_action_journey_revision: revision })]);
  return { actionId, proposalId, confirmationId, requestKey, identity, input, revision, toolName };
}

type Proposal = Awaited<ReturnType<typeof proposal>>;
async function approve(db: PGlite, action: Proposal) {
  expect((await db.query<{ result: { applicationGranted: boolean } }>(
    "SELECT claim_amora_shared_action_application($1,$2,$3,$4) AS result",
    [action.actionId, COUPLE_ID, action.proposalId, USER_ID],
  )).rows[0].result.applicationGranted).toBe(true);
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,$3,'bride','user','확인','shared',$4::jsonb,clock_timestamp())`,
  [action.confirmationId, COUPLE_ID, USER_ID, JSON.stringify({ confirmed_amora_action_id: action.actionId })]);
  await db.query(`INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,user_message_id)
    VALUES($1,$2,$3,'shared','processing',$4)`, [COUPLE_ID, action.requestKey, USER_ID, action.confirmationId]);
}

async function claim(db: PGlite, action: Proposal, pendingId: string | null = action.actionId, providerIndex?: number | null) {
  const args: unknown[] = [COUPLE_ID, action.requestKey, action.identity.operationKey, action.toolName, action.identity.inputDigest, 1, pendingId];
  if (providerIndex !== undefined) args.push(providerIndex);
  return (await db.query<{ result: Record<string, unknown> }>(
    `SELECT claim_amora_tool_execution(${args.map((_, index) => `$${index + 1}`).join(",")}) AS result`, args,
  )).rows[0].result;
}

function mutation(action: Proposal) {
  return { kind: "decision_record_insert", record: { title: action.input.title, decision_type: action.input.status,
    reasoning: action.input.memo ?? null, category: action.input.category_key ?? "general" } };
}

async function apply(db: PGlite, action: Proposal, options: {
  input?: Record<string, unknown>; mutation?: unknown; result?: unknown;
} = {}) {
  return (await db.query<{ result: { toolName: string; success: boolean; toolOutput: Record<string, unknown>; displayMessage: string } }>(
    "SELECT apply_amora_atomic_tool_execution($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS result",
    [COUPLE_ID, action.requestKey, action.identity.operationKey, action.identity.inputDigest,
      JSON.stringify(options.input ?? action.input), JSON.stringify(options.mutation ?? mutation(action)),
      JSON.stringify(options.result ?? { toolName: TOOL, success: true,
        toolOutput: { verified: true, decision: { id: OUTSIDER_ID, title: "FORGED_RECEIPT" } }, displayMessage: "FORGED_SUCCESS" })],
  )).rows[0].result;
}

describe("approved shared decision record RPC", () => {
  it("keeps membership fencing without acquiring a profile row-lock dependency after claiming and saving", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action);
    await db.exec("BEGIN");
    try {
      expect(await claim(db, action)).toEqual({ action: "acquired" });
      expect((await apply(db, action)).success).toBe(true);
      // 실제 RPC가 남긴 잠금 풋프린트다. PGlite 단일 세션이므로 교착 재현은 아니다.
      const locks = (await db.query<{ relation: string; mode: string }>(`
        SELECT relation::regclass::text AS relation, mode FROM pg_locks
        WHERE pid=pg_backend_pid() AND granted
          AND relation IN ('public.profiles'::regclass, 'public.couples'::regclass)
      `)).rows;
      expect(locks).toContainEqual({ relation: "couples", mode: "RowShareLock" });
      expect(locks).not.toContainEqual({ relation: "profiles", mode: "RowShareLock" });
      expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([{ id: action.actionId }]);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("retains direct-client and deferred membership guards without a late profile lock", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action);
    await claim(db, action);
    const clientBoundary = migration("20260614110000_lock_sensitive_anon_access.sql");
    const clientGuard = clientBoundary.slice(
      clientBoundary.indexOf("CREATE OR REPLACE FUNCTION public.prevent_profile_membership_self_change()"),
      clientBoundary.indexOf("CREATE OR REPLACE FUNCTION public.prevent_couple_slot_self_change()"),
    );
    const integrityGuard = definitions(
      migration("20260716114000_current_couple_membership_privacy_fence.sql"),
      "enforce_current_couple_membership_integrity",
    )[0];
    await db.exec(`RESET ROLE;
      ALTER TABLE profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
      GRANT SELECT, UPDATE ON profiles TO authenticated;`);
    await db.exec(clientGuard);
    await db.exec(integrityGuard);
    await db.exec(`
      CREATE CONSTRAINT TRIGGER trg_current_couple_profile_integrity
        AFTER INSERT OR UPDATE OR DELETE ON public.profiles DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION public.enforce_current_couple_membership_integrity();
      CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity
        AFTER INSERT OR UPDATE OR DELETE ON public.couples DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION public.enforce_current_couple_membership_integrity();
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.role','authenticated',false);
    `);
    await db.query("UPDATE profiles SET role='groom',couple_id=$1 WHERE id=$2", [OTHER_COUPLE_ID, USER_ID]);
    expect((await db.query("SELECT role,couple_id FROM profiles WHERE id=$1", [USER_ID])).rows)
      .toEqual([{ role: "bride", couple_id: COUPLE_ID }]);
    await db.exec(`RESET ROLE; SET ROLE service_role;
      SELECT set_config('request.jwt.claim.role','service_role',false);`);
    for (const [role, coupleId] of [["groom", COUPLE_ID], ["bride", OTHER_COUPLE_ID], ["bride", null]]) {
      await expect(db.query("UPDATE profiles SET role=$1,couple_id=$2 WHERE id=$3", [role, coupleId, USER_ID]))
        .rejects.toThrow(/CURRENT_COUPLE_PROFILE_SLOT_MISMATCH|CURRENT_COUPLE_UNLINKED_PROFILE_HAS_SLOT/u);
      expect((await db.query("SELECT role,couple_id FROM profiles WHERE id=$1", [USER_ID])).rows)
        .toEqual([{ role: "bride", couple_id: COUPLE_ID }]);
    }
    expect((await apply(db, action)).toolOutput).toMatchObject({ verified: true, decision: { id: action.actionId } });
  });

  it("saves only the approved fields and returns a canonical receipt, once across retries", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action);
    expect(await claim(db, action)).toEqual({ action: "acquired" });
    const saved = await apply(db, action);
    expect(saved).toMatchObject({ toolName: TOOL, success: true, toolOutput: { verified: true,
      decision: { id: action.actionId, title: action.input.title, status: "considering", memo: action.input.memo,
        category_key: "meeting", created_at: expect.any(String) } } });
    expect(JSON.stringify(saved)).not.toContain("FORGED");
    expect(await apply(db, action)).toEqual(saved);
    expect(await claim(db, action)).toEqual({ action: "completed", result: saved });
    const rows = (await db.query("SELECT id,title,source,source_ref_id,source_message_id,visibility,memory_key,metadata FROM decision_nodes")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: action.actionId, source: "chat", source_ref_id: action.actionId,
      source_message_id: action.confirmationId, visibility: "shared", memory_key: null,
      metadata: { origin: "amora_shared_decision_record", actor_user_id: USER_ID } });
    expect(JSON.stringify(rows)).not.toContain("DO_NOT_COPY");
    expect((await db.query("SELECT state_revision::integer AS revision,progress FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows)
      .toEqual([{ revision: action.revision, progress: {} }]);
    await db.exec("RESET ROLE; SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [PARTNER_ID]);
    expect((await db.query("SELECT id FROM decision_nodes WHERE couple_id=$1", [COUPLE_ID])).rows).toEqual([{ id: action.actionId }]);
  });

  it("rolls the insert and receipt back if completion fails, then safely retries the same pending ID", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action);
    await claim(db, action);
    await db.exec(`RESET ROLE;
      CREATE FUNCTION test_fail_decision_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'TEST_LEDGER_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER z_test_fail_decision_completion BEFORE UPDATE ON amora_tool_executions
        FOR EACH ROW EXECUTE FUNCTION test_fail_decision_completion(); SET ROLE service_role;`);
    await expect(apply(db, action)).rejects.toThrow("TEST_LEDGER_FAILURE");
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT status,result FROM amora_tool_executions")).rows).toEqual([{ status: "processing", result: null }]);
    await db.exec("RESET ROLE; DROP TRIGGER z_test_fail_decision_completion ON amora_tool_executions; SET ROLE service_role;");
    expect((await apply(db, action)).success).toBe(true);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([{ id: action.actionId }]);
  });

  it("does not report success when a decision insert fails or a pending ID collides with an existing record", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action);
    await db.exec(`RESET ROLE;
      CREATE FUNCTION test_fail_decision_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TEST_INSERT_FAILURE'; END $$;
      CREATE TRIGGER test_fail_decision_insert BEFORE INSERT ON decision_nodes
        FOR EACH ROW EXECUTE FUNCTION test_fail_decision_insert(); SET ROLE service_role;`);
    await expect(apply(db, action)).rejects.toThrow("TEST_INSERT_FAILURE");
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT status,result FROM amora_tool_executions")).rows).toEqual([{ status: "processing", result: null }]);
    await db.exec("RESET ROLE; DROP TRIGGER test_fail_decision_insert ON decision_nodes; SET ROLE service_role;");
    await db.query("INSERT INTO decision_nodes(id,couple_id,title,source,visibility) VALUES($1,$2,'EXISTING_MANUAL_RECORD','manual','shared')",
      [action.actionId, COUPLE_ID]);
    await expect(apply(db, action)).rejects.toThrow(/duplicate key/u);
    expect((await db.query("SELECT title FROM decision_nodes")).rows).toEqual([{ title: "EXISTING_MANUAL_RECORD" }]);
    expect((await db.query("SELECT status,result FROM amora_tool_executions")).rows).toEqual([{ status: "processing", result: null }]);
  });

  it.each(["private_claim", "private_confirmation", "private_proposal", "wrong_actor", "roster_change", "new_revision", "new_shared_message"])(
    "rejects %s after claim without writing a record or successful receipt", async (kind) => {
      const db = await setup(), action = await proposal(db);
      await approve(db, action);
      await claim(db, action);
      if (kind === "private_claim") await db.query("UPDATE amora_chat_request_claims SET visibility='bride_private'");
      if (kind === "private_confirmation") await db.query("UPDATE chat_messages SET visibility='bride_private' WHERE id=$1", [action.confirmationId]);
      if (kind === "private_proposal") await db.query("UPDATE chat_messages SET visibility='bride_private' WHERE id=$1", [action.proposalId]);
      if (kind === "wrong_actor") await db.query("UPDATE amora_chat_request_claims SET user_id=$1", [OUTSIDER_ID]);
      if (kind === "roster_change") await db.query("UPDATE couples SET groom_id=$1 WHERE id=$2", [OUTSIDER_ID, COUPLE_ID]);
      if (kind === "new_revision") await db.query("UPDATE wedding_journeys SET state_revision=state_revision+1 WHERE couple_id=$1", [COUPLE_ID]);
      if (kind === "new_shared_message") await db.query(`INSERT INTO chat_messages(couple_id,sender_id,sender_type,role,content,visibility,created_at)
        VALUES($1,$2,'bride','user','다른 이야기','shared',clock_timestamp())`, [COUPLE_ID, USER_ID]);
      await expect(apply(db, action)).rejects.toThrow(/AMORA_/u);
      expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
      expect((await db.query("SELECT status,result FROM amora_tool_executions")).rows).toEqual([{ status: "processing", result: null }]);
    },
  );

  it("rejects a forged input despite a valid pending ID/digest and a self-consistent domain mutation", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action);
    const forged = { ...action, input: { ...action.input, title: "UNAPPROVED_PRIVATE_TEXT" } };
    await expect(apply(db, action, { input: forged.input, mutation: mutation(forged) }))
      .rejects.toThrow("AMORA_DECISION_APPROVED_INPUT_MISMATCH");
    await expect(apply(db, action, { mutation: mutation(forged) })).rejects.toThrow("AMORA_DECISION_INPUT_MISMATCH");
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
  });

  it("rejects unapproved legacy and provider-only calls before creating an execution", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action);
    await expect(claim(db, action, null)).rejects.toThrow("AMORA_DECISION_APPROVAL_REQUIRED");
    await expect(claim(db, action, null, 1)).rejects.toThrow("AMORA_DECISION_APPROVAL_REQUIRED");
    expect((await db.query("SELECT operation_key FROM amora_tool_executions")).rows).toEqual([]);
  });

  it.each(["anon", "authenticated"])("rejects %s writes and keeps old dispatcher aliases non-callable", async (role) => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action);
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.role',$1,false)", [role]);
    await expect(claim(db, action)).rejects.toThrow(/permission denied|SERVICE_ROLE_REQUIRED/u);
    await expect(apply(db, action)).rejects.toThrow(/permission denied|SERVICE_ROLE_REQUIRED/u);
    await expect(db.query("SELECT apply_amora_atomic_tool_execution_pre_decision_record(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"))
      .rejects.toThrow(/permission denied/u);
    await db.exec("RESET ROLE; SET ROLE service_role");
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
  });

  it("does not replay a saved receipt into a changed partner roster", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action); await apply(db, action);
    await db.query("UPDATE couples SET groom_id=$1 WHERE id=$2", [OUTSIDER_ID, COUPLE_ID]);
    await expect(claim(db, action)).rejects.toThrow(/AMORA_/u);
    await expect(apply(db, action)).rejects.toThrow(/AMORA_/u);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([{ id: action.actionId }]);
  });

  it("does not duplicate a saved decision when the same pending ID is retried under another request key", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action);
    const saved = await apply(db, action), retry = { ...action, requestKey: `chat:${USER_ID}:${randomUUID()}` };
    await db.query(`INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,user_message_id)
      VALUES($1,$2,$3,'shared','processing',$4)`, [COUPLE_ID, retry.requestKey, USER_ID, action.confirmationId]);
    expect(await claim(db, retry)).toEqual({ action: "completed", result: saved });
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([{ id: action.actionId }]);
  });

  it("rejects invalid fields, hidden scope attributes and a made-up success without an actual saved row", async () => {
    const db = await setup(), action = await proposal(db);
    await approve(db, action); await claim(db, action);
    for (const input of [
      { title: "x".repeat(161), status: "considering" }, { title: " ", status: "considering" },
      { title: "허용된 기록", status: "booked" }, { title: "허용된 기록" },
      { title: "허용된 기록", status: "considering", memo: "x".repeat(1001) },
      { title: "허용된 기록", status: "considering", memo: null },
      { title: "허용된 기록", status: "considering", category_key: "not_a_category" },
      { title: "허용된 기록", status: "considering", visibility: "bride_private" },
      { title: "허용된 기록", status: "considering", couple_id: OUTSIDER_ID },
    ]) await expect(apply(db, action, { input })).rejects.toThrow("AMORA_DECISION_INVALID_INPUT");
    await expect(apply(db, action, { mutation: { ...mutation(action), privateContext: "NOT_APPROVED" } }))
      .rejects.toThrow("AMORA_DECISION_INVALID_INPUT");
    await expect(db.query(`UPDATE amora_tool_executions SET status='completed',result=$1::jsonb`,
      [JSON.stringify({ toolName: TOOL, success: true, toolOutput: { verified: true }, displayMessage: "FORGED" })]))
      .rejects.toThrow("AMORA_DECISION_RECEIPT_MISSING");
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT status,result FROM amora_tool_executions")).rows).toEqual([{ status: "processing", result: null }]);
  });

  it("supports exactly the declared categories and statuses without deriving joint consent", async () => {
    const db = await setup();
    for (const [index, category] of SCHEDULE_CATEGORY_KEYS.entries()) {
      const status = ["exploring", "considering", "decided"][index % 3];
      const action = await proposal(db, { title: "명시적으로 확인한 기록", status, category_key: category });
      await approve(db, action); await claim(db, action);
      expect((await apply(db, action)).toolOutput).toMatchObject({ verified: true,
        decision: { status, category_key: category, memo: null } });
    }
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(SCHEDULE_CATEGORY_KEYS.length);
    expect((await db.query("SELECT action_id FROM amora_shared_action_acceptances")).rows).toEqual([]);
    expect((await db.query("SELECT action_id FROM couple_change_notifications WHERE event_kind='change_applied'")).rows)
      .toHaveLength(SCHEDULE_CATEGORY_KEYS.length);
  });

  it("delegates existing approved budget tools without changing their journey and decision receipt behavior", async () => {
    const db = await setup(), input = { total_budget: 50_000_000 };
    const action = await proposal(db, input, "update_budget");
    await approve(db, action);
    expect(await claim(db, action, action.actionId, null)).toEqual({ action: "acquired" });
    const operation = buildAmoraAtomicToolOperation("update_budget", input, {
      coupleId: COUPLE_ID, requestKey: action.requestKey, requestAttemptCount: 1, pendingActionId: action.actionId,
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
    }, action.identity.operationKey);
    const { toolName, toolOutput, success, displayMessage } = operation.result;
    expect((await apply(db, action, { mutation: operation.domainMutation, result: { toolName, toolOutput, success, displayMessage } })).success).toBe(true);
    expect((await db.query("SELECT total_budget::integer,state_revision::integer AS revision FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows)
      .toEqual([{ total_budget: 50_000_000, revision: action.revision + 1 }]);
    expect((await db.query("SELECT source FROM decision_nodes")).rows).toEqual([{ source: "budget" }]);
  });

  it.each([false, true])("delegates custom budget writes through the public wrapper (existing screen slot: %s)", async (existing) => {
    const db = await setup(), screenKey = "custom_1773727842937";
    const progress: Record<string, { category: string; label: string; status: string; budget: number; spent: number }> = {};
    if (existing) {
      progress[screenKey] = { category: screenKey, label: "차량  이동", status: "not_applicable", budget: 500_000, spent: 200_000 };
      await db.query("UPDATE wedding_journeys SET progress=$1::jsonb WHERE couple_id=$2", [JSON.stringify(progress), COUPLE_ID]);
    }
    const input = { label: "차량 이동", budget: 750_000 };
    const action = await proposal(db, input, "add_custom_category");
    await approve(db, action);
    expect(await claim(db, action, action.actionId, null)).toEqual({ action: "acquired" });
    const operation = buildAmoraAtomicToolOperation("add_custom_category", input, {
      coupleId: COUPLE_ID, requestKey: action.requestKey, requestAttemptCount: 1, pendingActionId: action.actionId,
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress },
    }, action.identity.operationKey);
    const { toolName, toolOutput, success, displayMessage } = operation.result;
    const key = toolOutput.key;
    if (typeof key !== "string") throw new Error("Expected a custom budget operation");
    if (existing) expect(key).toBe(screenKey);
    else expect(key).toMatch(/^custom_[a-f0-9]{24}$/u);
    const saved = await apply(db, action, { mutation: operation.domainMutation, result: { toolName, toolOutput, success, displayMessage } });
    expect(saved).toMatchObject({ success: true, toolOutput: { key, created: !existing } });
    expect((await db.query("SELECT state_revision::integer AS revision,progress FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows)
      .toEqual([{ revision: action.revision + 1, progress: { [key]: {
        category: key, label: "차량 이동", status: existing ? "not_applicable" : "in_progress", budget: 750_000,
        ...(existing ? { spent: 200_000 } : {}),
      } } }]);
    expect(await claim(db, action, action.actionId, null)).toEqual({ action: "completed", result: saved });
    expect((await db.query("SELECT source FROM decision_nodes")).rows).toEqual([{ source: "budget" }]);
  });

  it.each([false, true])("keeps custom-slot creation and existing-slot CAS checks after delegation (forged existing: %s)", async (pretendExisting) => {
    const db = await setup(), key = "custom_1773727842937";
    const input = { label: "차량 이동", budget: 750_000 };
    const prior = { category: key, label: input.label, status: "in_progress", budget: 500_000 };
    const value = { ...prior, budget: input.budget };
    const action = await proposal(db, input, "add_custom_category");
    await approve(db, action); await claim(db, action, action.actionId, null);
    const attempt = apply(db, action, {
      mutation: { kind: "journey_progress_entry_cas", key, expectedPresent: pretendExisting,
        ...(pretendExisting ? { expected: prior } : {}), value },
      result: { toolName: "add_custom_category", success: true, displayMessage: "NOT_VERIFIED",
        toolOutput: { key, label: input.label, created: !pretendExisting, progress_key: key, progress_value: value } },
    });
    if (pretendExisting) {
      expect(await attempt).toMatchObject({ success: false, toolOutput: { error: "domain_state_changed" } });
    } else {
      await expect(attempt).rejects.toThrow("AMORA_ATOMIC_CUSTOM_CATEGORY_INVALID");
    }
    expect((await db.query("SELECT state_revision::integer AS revision,progress FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows)
      .toEqual([{ revision: action.revision, progress: {} }]);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toEqual([]);
  });
});
