// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { getAmoraActionApprovalPolicy, getAmoraPendingActionTtlMs } from "@hanbang/shared";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { createBudgetDecisionDatabase, migration, COUPLE_ID, USER_ID, PARTNER_ID, OUTSIDER_ID } from "./fixtures/amoraBudgetDecisionDatabase";

const root = resolve(process.cwd(), "../..");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const candidates = [
  { path: "amora-action-view-v2/patch_own_amora_action_view_v2.sql", expected: "e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d" },
  { path: "amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql", expected: "25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca" },
  { path: "amora-action-writer-retirement-v1/retirement_service_writers_v1.sql", expected: "56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4" },
  { path: "amora-action-writer-retirement-v1/retirement_reserved_plan_writers_v1.sql", expected: "20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d" },
  { path: "amora-action-writer-retirement-v1/retirement_direct_journey_guard_v1.sql", expected: "3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c" },
].map(item => ({ ...item, sql: readFileSync(resolve(root, "supabase/release-candidates", item.path), "utf8") }));
const databases: PGlite[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });

async function setup() {
  for (const candidate of candidates) expect(sha(candidate.sql), candidate.path).toBe(candidate.expected);
  const db = await createBudgetDecisionDatabase(); databases.push(db);
  await db.exec("RESET ROLE");
  await db.exec("ALTER TABLE wedding_journeys ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()");
  for (const name of [
    "20260911080244_amora_budget_plan_explicit_allocations.sql",
    "20260915101500_amora_atomic_not_applicable_status.sql",
    "20260615100000_create_amora_actions.sql",
    "20260615101000_fix_amora_action_status_timestamps.sql",
    "20260906074227_amora_manual_actions_actor_boundary.sql",
    "20260611160000_journey_progress_atomic_merge.sql",
    "20260716100000_journey_progress_atomic_item_patch.sql",
    "20260731123000_couple_plan_change_write_boundary.sql",
  ]) await db.exec(migration(name));
  const planFence = /CREATE OR REPLACE FUNCTION public\.enforce_couple_plan_change_write_boundary\([\s\S]*?\$function\$;/.exec(
    migration("20260823120000_couple_approval_becomes_notification.sql"))?.[0];
  if (!planFence) throw new Error("Original current plan fence function missing");
  await db.exec(planFence);
  const executionFence = /CREATE OR REPLACE FUNCTION public\.enforce_amora_shared_action_execution\([\s\S]*?\$function\$;/.exec(
    migration("20260802140000_amora_manual_schedule_fairness.sql"))?.[0];
  if (!executionFence) throw new Error("Original current AI execution fence function missing");
  await db.exec(executionFence);
  // Replace only the synthetic fixture timestamp trigger with the real source triggers above.
  await db.exec("DROP TRIGGER test_action_timestamps ON public.amora_actions");
  const bodies = await protectedBodies(db);
  expect(bodies).toHaveLength(10);
  for (const candidate of candidates) await db.exec(candidate.sql);
  expect(await protectedBodies(db)).toEqual(bodies);
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  return db;
}

async function protectedBodies(db: PGlite) {
  return (await db.query<{ name: string; body_hash: string; owner:string; config:string[]|null; acl:string[]; securityDefiner:boolean }>(`SELECT p.proname AS name,md5(p.prosrc) AS body_hash,
    pg_get_userbyid(p.proowner) AS owner,p.proconfig AS config,p.prosecdef AS "securityDefiner",
    ARRAY(SELECT privilege::text FROM unnest(p.proacl) privilege ORDER BY privilege::text) AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN ('amora_shared_action_policy','amora_shared_action_context','amora_shared_action_context_pre_roster_binding',
      'claim_amora_shared_action_application','authorize_amora_shared_action_execution','enforce_amora_shared_action_execution',
      'apply_amora_atomic_tool_execution','apply_amora_atomic_tool_execution_pre_shared_revision',
      'record_amora_shared_budget_decision','notify_amora_shared_action_completion') ORDER BY p.proname`)).rows;
}

async function propose(db: PGlite, tool: string, input: Record<string, unknown>, actor = USER_ID) {
  const row = (await db.query<{ state_revision: number; total_budget: number; progress: ToolExecutionContext["weddingContext"]["progress"] }>(
    "SELECT state_revision::integer,total_budget,progress FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows[0];
  const actionId = randomUUID(), proposalId = randomUUID(), confirmationId = randomUUID();
  const requestKey = `chat:${actor}:${randomUUID()}`;
  const identity = getAmoraToolOperationIdentity(tool, input), now = Date.now();
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,'ai','assistant','SYNTHETIC-PROPOSAL','shared',$3::jsonb,clock_timestamp())`,
    [proposalId,COUPLE_ID,JSON.stringify({ pending_amora_action: { version:2,actionId,tool,input,
      inputDigest:identity.inputDigest,operationKey:identity.operationKey,confirmation:"확인할 합성 변경",issuedAt:now,
      expiresAt:now+getAmoraPendingActionTtlMs(tool,input) },pending_amora_action_journey_revision:row.state_revision })]);
  const context: ToolExecutionContext = { coupleId:COUPLE_ID,requestKey,requestAttemptCount:1,pendingActionId:actionId,
    weddingContext:{ weddingDate:null,budget:Number(row.total_budget),venue:null,progress:row.progress } };
  const operation = buildAmoraAtomicToolOperation(tool,input,context,identity.operationKey);
  const result = { toolName:operation.result.toolName,toolOutput:operation.result.toolOutput,
    success:operation.result.success,displayMessage:operation.result.displayMessage };
  return { actionId,proposalId,confirmationId,requestKey,identity,input,operation,result,revision:row.state_revision };
}
type Proposal = Awaited<ReturnType<typeof propose>>;

async function claim(db: PGlite, proposal: Proposal, actor = USER_ID) {
  return (await db.query<{ value: { applicationGranted: boolean } }>(
    "SELECT claim_amora_shared_action_application($1,$2,$3,$4) AS value",
    [proposal.actionId,COUPLE_ID,proposal.proposalId,actor])).rows[0].value;
}

async function confirm(db: PGlite, proposal: Proposal, actor = USER_ID) {
  expect((await claim(db,proposal,actor)).applicationGranted).toBe(true);
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,$3,$4,'user','SYNTHETIC-CONFIRMATION','shared',$5::jsonb,clock_timestamp())`,
    [proposal.confirmationId,COUPLE_ID,actor,actor===USER_ID?"bride":"groom",JSON.stringify({ confirmed_amora_action_id:proposal.actionId })]);
  await db.query(`INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,user_message_id)
    VALUES($1,$2,$3,'shared','processing',$4)`,[COUPLE_ID,proposal.requestKey,actor,proposal.confirmationId]);
  await db.query(`INSERT INTO amora_tool_executions(couple_id,request_key,operation_key,tool_name,input_digest,pending_action_id,
    atomic_dispatch,request_attempt_count) VALUES($1,$2,$3,$4,$5,$6,true,1)`,
    [COUPLE_ID,proposal.requestKey,proposal.identity.operationKey,proposal.result.toolName,proposal.identity.inputDigest,proposal.actionId]);
}

async function apply(db: PGlite, proposal: Proposal) {
  return (await db.query<{ value: Record<string, unknown> }>(`SELECT apply_amora_atomic_tool_execution(
    $1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS value`,
    [COUPLE_ID,proposal.requestKey,proposal.identity.operationKey,proposal.identity.inputDigest,JSON.stringify(proposal.input),
      JSON.stringify(proposal.operation.domainMutation),JSON.stringify(proposal.result)])).rows[0].value;
}

describe("independent actual approved AI compatibility after action writer retirement", () => {
  it("adds through the real pending approval and completed execution without fabricating a decision", async () => {
    const db = await setup();
    process.stdout.write(`LOCAL_SYNTHETIC_PRESERVED_AI_BODY_MD5 ${JSON.stringify(await protectedBodies(db))}\n`);
    process.stdout.write(`LOCAL_SYNTHETIC_PLAN_BODY_MD5 ${JSON.stringify((await db.query(`SELECT p.proname AS name,md5(p.prosrc) AS body_hash
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('normalize_couple_plan_changes','apply_couple_plan_change_locked','enforce_couple_plan_change_write_boundary')
      ORDER BY p.proname`)).rows)}\n`);
    const proposal = await propose(db,"add_amora_action",{ title:"SYNTHETIC 식사 포함 범위 확인",category_key:"venue",description:"합성 메모" });
    expect(proposal.result.success).toBe(true);
    await confirm(db,proposal);
    const result = await apply(db,proposal);
    expect(result).toMatchObject({ success:true,toolName:"add_amora_action",toolOutput:{action:{title:"SYNTHETIC 식사 포함 범위 확인",status:"open",source:"chat"}} });
    const cards = (await db.query("SELECT id,couple_id,title,created_by FROM amora_actions")).rows;
    expect(cards).toHaveLength(1); expect(cards[0]).toMatchObject({ couple_id:COUPLE_ID,title:"SYNTHETIC 식사 포함 범위 확인",created_by:null });
    const execution = (await db.query("SELECT status,pending_action_journey_revision FROM amora_tool_executions")).rows;
    expect(execution).toEqual([{ status:"completed",pending_action_journey_revision:proposal.revision }]);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
    expect((await db.query("SELECT request_key FROM amora_shared_action_journey_mutation_receipts")).rows).toHaveLength(0);
    expect((await db.query("SELECT recipient_user_id,actor_user_id,event_kind,tool_name FROM couple_change_notifications")).rows)
      .toEqual([{ recipient_user_id:PARTNER_ID,actor_user_id:USER_ID,event_kind:"change_applied",tool_name:"add_amora_action" }]);
    expect((await db.query("SELECT state_revision::integer AS revision FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows)
      .toEqual([{ revision:proposal.revision }]);
    expect(getAmoraActionApprovalPolicy("update_amora_action",{})).toBe("blocked");
  },30_000);

  // 진행·하객 선물 분야는 서버 기본 링크(아모라 대화)와 DB 가 다시 계산하는 기본 링크가 달라서
  // 카드를 누르면 AMORA_ATOMIC_ACTION_HREF_INVALID 로 거절됐다. 저장된 제안에서 실제 저장 함수와
  // 트리거까지 전부 지나서 저장되고, 상대에게 알림이 가는지 본다.
  it.each(["mc","gift"])("adds a %s task through the real pending approval with the Amora chat link", async (category) => {
    const db = await setup();
    const proposal = await propose(db,"add_amora_action",{ title:`SYNTHETIC ${category} 준비 확인`,category_key:category });
    expect(proposal.result.success).toBe(true);
    await confirm(db,proposal);
    const result = await apply(db,proposal);
    expect(result).toMatchObject({ success:true,toolName:"add_amora_action",
      toolOutput:{action:{categoryKey:category,href:"/wedding/chat",status:"open"}} });
    expect((await db.query("SELECT category_key,href FROM amora_actions")).rows)
      .toEqual([{ category_key:category,href:"/wedding/chat" }]);
    expect((await db.query("SELECT recipient_user_id,actor_user_id,event_kind,tool_name FROM couple_change_notifications")).rows)
      .toEqual([{ recipient_user_id:PARTNER_ID,actor_user_id:USER_ID,event_kind:"change_applied",tool_name:"add_amora_action" }]);
  },30_000);

  it("replays the actual completed add receipt once without duplicate cards, claims or notifications", async () => {
    const db = await setup();
    const proposal = await propose(db,"add_amora_action",{ title:"SYNTHETIC 같은 승인 재시도" });
    await confirm(db,proposal);
    const first = await apply(db,proposal);
    expect(first.success).toBe(true);
    expect(await apply(db,proposal)).toEqual(first);
    expect((await db.query(`SELECT
      (SELECT count(*)::integer FROM amora_actions) AS cards,
      (SELECT count(*)::integer FROM amora_tool_executions WHERE status='completed') AS executions,
      (SELECT count(*)::integer FROM amora_shared_action_application_claims) AS claims,
      (SELECT count(*)::integer FROM couple_change_notifications WHERE event_kind='change_applied') AS notifications,
      (SELECT count(*)::integer FROM decision_nodes) AS decisions`)).rows)
      .toEqual([{ cards:1,executions:1,claims:1,notifications:1,decisions:0 }]);
    await expect(claim(db,proposal,PARTNER_ID)).rejects.toThrow("AMORA_SHARED_ACTION_STALE_CONTEXT");
    expect((await db.query("SELECT id FROM amora_actions")).rows).toHaveLength(1);
  },30_000);

  it("preserves a real approved budget decision and its receipt while an approved add creates no extra decision", async () => {
    const db = await setup();
    const budget = await propose(db,"update_budget",{ total_budget:18_000_000 });
    await confirm(db,budget);
    const budgetResult = await apply(db,budget);
    expect(budgetResult.success).toBe(true);
    expect(await apply(db,budget)).toEqual(budgetResult);
    const before = (await db.query(`SELECT id,couple_id,source,source_ref_id,source_message_id,source_actor_role,
      chosen_value,metadata FROM decision_nodes`)).rows;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ couple_id:COUPLE_ID,source:"budget",source_ref_id:budget.actionId,
      source_message_id:budget.confirmationId,source_actor_role:"bride",
      chosen_value:{ schemaVersion:1,budgetScope:"total",amount:18_000_000 },
      metadata:{ origin:"amora_shared_budget_action",actionId:budget.actionId } });
    const card = await propose(db,"add_amora_action",{ title:"SYNTHETIC 결정 기록 다음의 할 일" });
    await confirm(db,card); expect((await apply(db,card)).success).toBe(true);
    expect((await db.query(`SELECT id,couple_id,source,source_ref_id,source_message_id,source_actor_role,
      chosen_value,metadata FROM decision_nodes`)).rows).toEqual(before);
    expect((await db.query("SELECT action_id FROM amora_shared_action_journey_mutation_receipts")).rows)
      .toEqual([{ action_id:budget.actionId }]);
  },30_000);

  it("preserves shared couple ownership for both members and denies an outsider's approval and card read", async () => {
    const db = await setup();
    const proposal = await propose(db,"add_amora_action",{ title:"SYNTHETIC 신랑이 승인한 공유 할 일" },PARTNER_ID);
    await expect(claim(db,proposal,OUTSIDER_ID)).rejects.toThrow("AMORA_SHARED_ACTION_SCOPE_DENIED");
    expect((await db.query("SELECT action_id FROM amora_shared_action_application_claims")).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM amora_actions")).rows).toHaveLength(0);
    await confirm(db,proposal,PARTNER_ID); expect((await apply(db,proposal)).success).toBe(true);
    const notification = (await db.query("SELECT actor_user_id,recipient_user_id FROM couple_change_notifications")).rows;
    expect(notification).toEqual([{ actor_user_id:PARTNER_ID,recipient_user_id:USER_ID }]);
    for (const actor of [USER_ID,PARTNER_ID,OUTSIDER_ID]) {
      await db.exec("RESET ROLE; SET ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[actor]);
      const cards = (await db.query("SELECT couple_id,title FROM amora_actions")).rows;
      expect(cards).toEqual(actor===OUTSIDER_ID?[]:[{ couple_id:COUPLE_ID,title:"SYNTHETIC 신랑이 승인한 공유 할 일" }]);
    }
  },30_000);

  it("keeps update_amora_action blocked at the actual persisted-proposal approval boundary", async () => {
    const db = await setup();
    const creation = await propose(db,"add_amora_action",{ title:"SYNTHETIC AI가 임의 수정하면 안 되는 할 일" });
    await confirm(db,creation); expect((await apply(db,creation)).success).toBe(true);
    const original = (await db.query<{ id:string; status:string }>("SELECT id,status FROM amora_actions")).rows;
    const proposal = await propose(db,"update_amora_action",{ action_id:original[0].id,status:"done" });
    expect(getAmoraActionApprovalPolicy("update_amora_action",proposal.input)).toBe("blocked");
    expect((await db.query("SELECT amora_shared_action_policy('update_amora_action',$1::jsonb) AS value",
      [JSON.stringify(proposal.input)])).rows).toEqual([{ value:"blocked" }]);
    await expect(claim(db,proposal)).rejects.toThrow("AMORA_SHARED_ACTION_BLOCKED");
    await expect(db.query(`INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility,metadata,created_at)
      VALUES($1,$2,$3,'bride','user','SYNTHETIC-FORBIDDEN-CONFIRMATION','shared',$4::jsonb,clock_timestamp())`,
      [proposal.confirmationId,COUPLE_ID,USER_ID,JSON.stringify({ confirmed_amora_action_id:proposal.actionId })]))
      .rejects.toThrow("AMORA_SHARED_ACTION_BLOCKED");
    expect((await db.query("SELECT id,status FROM amora_actions")).rows).toEqual(original);
    expect((await db.query("SELECT tool_name,status FROM amora_tool_executions")).rows)
      .toEqual([{ tool_name:"add_amora_action",status:"completed" }]);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
  },30_000);
});
