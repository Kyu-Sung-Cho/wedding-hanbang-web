// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { createBudgetDecisionDatabase, COUPLE_ID, USER_ID, PARTNER_ID, OUTSIDER_ID } from "./fixtures/amoraBudgetDecisionDatabase";

const databases: PGlite[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
const original = {
  custom_trial: { category: "custom_trial", label: "초대장·꽃·하객선물", budget: 1_500_000,
    spent: 123_000, payer: "both_parents", status: "completed", notes: "DO_NOT_COPY_MEMO",
    checklist: [{ id: "fixture", done: true }] },
  venue: { category: "venue", budget: 12_000_000, status: "not_started" },
  __events: [{ id: "keep", title: "DO_NOT_COPY_EVENT" }],
  __shares: { bride: 40, groom: 60 },
};
async function setup(includeBudgetMigration = true) {
  const db = await createBudgetDecisionDatabase(includeBudgetMigration);
  databases.push(db);
  await db.query("UPDATE wedding_journeys SET total_budget=35000000,progress=$1::jsonb WHERE couple_id=$2",
    [JSON.stringify(original), COUPLE_ID]);
  return db;
}
async function prepare(db: PGlite, toolName: string, input: Record<string, unknown>) {
  const row = (await db.query<{ state_revision: number; total_budget: number;
    progress: ToolExecutionContext["weddingContext"]["progress"] }>(
    "SELECT state_revision::integer,total_budget,progress FROM wedding_journeys WHERE couple_id=$1", [COUPLE_ID])).rows[0];
  const actionId = randomUUID(), proposalId = randomUUID(), confirmationId = randomUUID();
  const requestKey = `chat:${USER_ID}:${randomUUID()}`;
  const identity = getAmoraToolOperationIdentity(toolName, input);
  const now = Date.now();
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,'ai','assistant','DO_NOT_COPY_PROPOSAL','shared',$3::jsonb,clock_timestamp())`,
    [proposalId, COUPLE_ID, JSON.stringify({pending_amora_action: {version:2, actionId, tool:toolName,
      input, inputDigest:identity.inputDigest, operationKey:identity.operationKey,
      confirmation:"확인", issuedAt:now, expiresAt:now+86400000},
      pending_amora_action_journey_revision:row.state_revision})]);
  const granted = await db.query<{result:{applicationGranted:boolean}}>(
    "SELECT claim_amora_shared_action_application($1,$2,$3,$4) AS result",
    [actionId, COUPLE_ID, proposalId, USER_ID]);
  expect(granted.rows[0].result.applicationGranted).toBe(true);
  await db.query(`INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,$3,'bride','user','DO_NOT_COPY_CONFIRMATION','shared',$4::jsonb,clock_timestamp())`,
    [confirmationId, COUPLE_ID, USER_ID, JSON.stringify({confirmed_amora_action_id:actionId})]);
  await db.query(`INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,user_message_id)
    VALUES($1,$2,$3,'shared','processing',$4)`, [COUPLE_ID,requestKey,USER_ID,confirmationId]);
  await db.query(`INSERT INTO amora_tool_executions(couple_id,request_key,operation_key,tool_name,input_digest,
    pending_action_id,atomic_dispatch,request_attempt_count)
    VALUES($1,$2,$3,$4,$5,$6,true,1)`,
    [COUPLE_ID,requestKey,identity.operationKey,toolName,identity.inputDigest,actionId]);
  const context: ToolExecutionContext = {coupleId:COUPLE_ID,requestKey,requestAttemptCount:1,pendingActionId:actionId,
    weddingContext:{weddingDate:"2099-05-01",budget:Number(row.total_budget),venue:null,progress:row.progress}};
  const operation = buildAmoraAtomicToolOperation(toolName,input,context,identity.operationKey);
  const result = {toolName:operation.result.toolName,toolOutput:operation.result.toolOutput,
    success:operation.result.success,displayMessage:operation.result.displayMessage};
  return {actionId,proposalId,confirmationId,requestKey,identity,input,operation,result};
}
async function apply(db:PGlite, action:Awaited<ReturnType<typeof prepare>>) {
  return db.query<{result:Record<string,unknown>}>(`SELECT apply_amora_atomic_tool_execution(
    $1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS result`,
    [COUPLE_ID,action.requestKey,action.identity.operationKey,action.identity.inputDigest,
      JSON.stringify(action.input),JSON.stringify(action.operation.domainMutation),JSON.stringify(action.result)]);
}
describe("approved shared budget decision receipts", () => {
  it("records the actual custom budget approval without copying unrelated content", async () => {
    const db=await setup();
    const action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_501_000});
    expect(action.result.success).toBe(true);
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    const decisions=await db.query("SELECT source,decision_type,category,visibility,title,chosen_value,reasoning,metadata FROM decision_nodes");
    expect(decisions.rows).toHaveLength(1);
    expect(decisions.rows[0]).toMatchObject({source:"budget",decision_type:"decided",category:"budget",visibility:"shared"});
    expect(JSON.stringify(decisions.rows)).not.toContain("DO_NOT_COPY");
    const state=(await db.query<{progress:typeof original}>("SELECT progress FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0];
    expect(state.progress).toEqual({...original,custom_trial:{...original.custom_trial,budget:1_501_000}});
  });

  it.each([
    {tool:"update_budget", input:{total_budget:36_000_000}, scope:"total"},
    {tool:"update_budget", input:{total_budget:0}, scope:"total"},
    {tool:"update_category_budget", input:{category:"venue",budget:0}, scope:"category"},
    {tool:"add_custom_category", input:{label:"New transport",budget:0}, scope:"category"},
    {tool:"apply_budget_plan", input:{total_budget:35_000_000,allocations:[{category:"venue",budget:13_000_000}]}, scope:"allocation"},
    {tool:"apply_budget_plan", input:{total_budget:36_000_000,allocations:[{category:"custom",label:"New transport",budget:100_000}]}, scope:"allocation"},
  ])("records canonical $tool / $scope amounts", async ({tool,input,scope}) => {
    const db=await setup();
    const action=await prepare(db,tool,input);
    expect(action.result.success).toBe(true);
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    const rows=await db.query<{chosen_value:{schemaVersion:number;budgetScope:string;budgetDelta:{schemaVersion:number;totalBudget:unknown;categories:Array<{key:string;label:string;beforeBudget:number|null;afterBudget:number}>}}}>("SELECT chosen_value FROM decision_nodes");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].chosen_value).toMatchObject({schemaVersion:1,budgetScope:scope,budgetDelta:{schemaVersion:1}});
    expect(Object.hasOwn(rows.rows[0].chosen_value.budgetDelta,"totalBudget")).toBe(true);
    for(const category of rows.rows[0].chosen_value.budgetDelta.categories) {
      expect(Object.keys(category).sort()).toEqual(["afterBudget","beforeBudget","key","label"]);
    }
    if(tool==="add_custom_category") expect(rows.rows[0].chosen_value.budgetDelta.categories[0]).toMatchObject({beforeBudget:null,afterBudget:0});
    expect(JSON.stringify(rows.rows)).not.toContain("DO_NOT_COPY");
  });

  it.each([false, true])("preserves previously allowed explicit null category budget (new receipt: %s)",async(includeBudgetMigration)=>{
    const db=await setup(includeBudgetMigration);
    await db.query("UPDATE wedding_journeys SET progress=jsonb_set(progress,'{venue,budget}','null') WHERE couple_id=$1",[COUPLE_ID]);
    const action=await prepare(db,"update_category_budget",{category:"venue",budget:1_000_000});
    expect(action.result.success).toBe(true);
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    if(includeBudgetMigration) expect((await db.query<{delta:unknown}>("SELECT chosen_value->'budgetDelta' AS delta FROM decision_nodes")).rows)
      .toEqual([{delta:{schemaVersion:1,totalBudget:null,categories:[{key:"venue",label:"결혼식장",beforeBudget:null,afterBudget:1_000_000}]}}]);
  });

  it.each([false, true])("preserves a total-only update with unchanged SQL-null progress (new receipt: %s)",async(includeBudgetMigration)=>{
    const db=await setup(includeBudgetMigration);
    await db.query("UPDATE wedding_journeys SET progress=NULL WHERE couple_id=$1",[COUPLE_ID]);
    const action=await prepare(db,"update_budget",{total_budget:36_000_000});
    expect(action.result.success).toBe(true);
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    expect((await db.query<{progress:unknown}>("SELECT progress FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0].progress).toBeNull();
  });

  it("keeps exact changed allocations in the human-readable confirmed value",async()=>{
    const db=await setup();
    const action=await prepare(db,"apply_budget_plan",{total_budget:36_000_000,allocations:[{category:"venue",budget:13_000_001}]});
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    const decision=(await db.query<{value:string;reasoning:string;delta:{categories:Array<{label:string;afterBudget:number}>}}>("SELECT chosen_value->>'value' AS value,reasoning,chosen_value->'budgetDelta' AS delta FROM decision_nodes")).rows[0];
    expect(decision.value).toContain("총예산 36,000,000원");
    expect(decision.value).toContain("결혼식장 13,000,001원");
    for(const category of decision.delta.categories) expect(decision.value).toContain(`${category.label} ${category.afterBudget.toLocaleString("en-US")}원`);
    expect(decision.value).not.toContain("DO_NOT_COPY");
    expect(decision.reasoning).toBe(`승인한 구성원의 예산 배정 변경. ${decision.value}`);
  });

  it.each([
    {tool:"add_custom_category", input:{label:"초대장·꽃·하객선물",spent:124_000}},
    {tool:"add_custom_category", input:{label:"초대장·꽃·하객선물",budget:1_500_000,spent:124_000}},
    {tool:"update_category_budget", input:{category:"venue",budget:12_000_000,spent:1_000}},
  ])("keeps spent-only changes out of budget decisions ($tool)",async({tool,input})=>{
    const db=await setup(), action=await prepare(db,tool,input);
    expect(action.result.success).toBe(true);
    expect((await apply(db,action)).rows[0].result.success).toBe(true);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
    expect((await db.query<{budget_delta:unknown}>("SELECT budget_delta FROM amora_shared_action_journey_mutation_receipts")).rows)
      .toEqual([{budget_delta:{schemaVersion:1,totalBudget:null,categories:[]}}]);
  });

  it("keeps a no-change result out of both mutation and decision receipts",async()=>{
    const db=await setup(), action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_500_000});
    expect(action.result.success).toBe(false);
    expect((await apply(db,action)).rows[0].result.success).toBe(false);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
    expect((await db.query("SELECT action_id FROM amora_shared_action_journey_mutation_receipts")).rows).toHaveLength(0);
  });

  it("replays one operation once and records a separately approved restoration",async()=>{
    const db=await setup(), action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_501_000});
    const first=await apply(db,action), replay=await apply(db,action);
    expect(replay.rows).toEqual(first.rows);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(1);
    const restore=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_500_000});
    await apply(db,restore);
    const rows=await db.query<{amount:number;before_amount:number;after_amount:number}>(
      "SELECT (chosen_value->>'amount')::integer AS amount,(chosen_value#>>'{budgetDelta,categories,0,beforeBudget}')::integer AS before_amount,(chosen_value#>>'{budgetDelta,categories,0,afterBudget}')::integer AS after_amount FROM decision_nodes ORDER BY created_at");
    expect(rows.rows).toEqual([{amount:1_501_000,before_amount:1_500_000,after_amount:1_501_000},
      {amount:1_500_000,before_amount:1_501_000,after_amount:1_500_000}]);
    expect((await db.query<{progress:unknown}>("SELECT progress FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0].progress).toEqual(original);
  });

  it("rolls the budget, revision, execution and receipt back if the decision insert fails",async()=>{
    const db=await setup(), action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_501_000});
    await db.exec("RESET ROLE; CREATE FUNCTION test_reject_budget_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_DECISION_INSERT_FAILED'; END $$; CREATE TRIGGER test_reject_budget_decision BEFORE INSERT ON decision_nodes FOR EACH ROW EXECUTE FUNCTION test_reject_budget_decision(); SET ROLE service_role;");
    await expect(apply(db,action)).rejects.toThrow("TEST_DECISION_INSERT_FAILED");
    const state=await db.query<{progress:unknown;state_revision:number}>("SELECT progress,state_revision::integer FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID]);
    expect(state.rows[0]).toEqual({progress:original,state_revision:1});
    expect((await db.query<{status:string}>("SELECT status FROM amora_tool_executions")).rows).toEqual([{status:"processing"}]);
    expect((await db.query("SELECT action_id FROM amora_shared_action_journey_mutation_receipts")).rows).toHaveLength(0);
  });

  it("rejects a successful budget execution if its actual delta was not captured",async()=>{
    const db=await setup(), action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_501_000});
    await db.exec("RESET ROLE; ALTER TABLE wedding_journeys DISABLE TRIGGER trg_capture_amora_shared_budget_delta; SET ROLE service_role;");
    await expect(apply(db,action)).rejects.toThrow("AMORA_SHARED_BUDGET_DECISION_DELTA_MISSING");
    expect((await db.query<{progress:unknown}>("SELECT progress FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0].progress).toEqual(original);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
  });

  it.each(["private_claim","private_confirmation","wrong_actor","newer_revision","forged_amount"])("rejects %s without a budget decision",async(kind)=>{
    const db=await setup(), action=await prepare(db,"add_custom_category",{label:"초대장·꽃·하객선물",budget:1_501_000});
    if(kind==="private_claim") await db.query("UPDATE amora_chat_request_claims SET visibility='bride_private' WHERE request_key=$1",[action.requestKey]);
    if(kind==="private_confirmation") await db.query("UPDATE chat_messages SET visibility='bride_private' WHERE id=$1",[action.confirmationId]);
    if(kind==="wrong_actor") await db.query("UPDATE chat_messages SET sender_id=NULL WHERE id=$1",[action.confirmationId]);
    if(kind==="newer_revision") await db.query("UPDATE wedding_journeys SET updated_at=clock_timestamp() WHERE couple_id=$1",[COUPLE_ID]);
    if(kind==="forged_amount") action.result.toolOutput.progress_value={...original.custom_trial,budget:1_999_000};
    await expect(apply(db,action)).rejects.toThrow();
    expect((await db.query<{progress:unknown}>("SELECT progress FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0].progress).toEqual(original);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
  });

  it("leaves unbound direct/manual updates outside the AI decision hook",async()=>{
    const db=await setup();
    await db.query("UPDATE wedding_journeys SET progress=jsonb_set(progress,'{custom_trial,budget}','1501000') WHERE couple_id=$1",[COUPLE_ID]);
    expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(0);
    expect((await db.query("SELECT action_id FROM amora_shared_action_journey_mutation_receipts")).rows).toHaveLength(0);
  });

  it("keeps the schedule pointer contract unchanged and new functions inaccessible",async()=>{
    const db=await setup(),action=await prepare(db,"update_budget",{total_budget:36_000_000});
    await apply(db,action);
    expect((await db.query("SELECT mutation_kind,decision_node_id,decision_recorded_at FROM amora_shared_action_journey_mutation_receipts")).rows)
      .toEqual([{mutation_kind:null,decision_node_id:null,decision_recorded_at:null}]);
    expect((await db.query<{granted:boolean}>("SELECT has_function_privilege(role_name,fn,'EXECUTE') AS granted FROM unnest(ARRAY['anon','authenticated','service_role']) role_name CROSS JOIN unnest(ARRAY['capture_amora_shared_budget_delta()','record_amora_shared_budget_decision()']) fn")).rows.every(row=>!row.granted)).toBe(true);
  });

  it("coexists with the current schedule add and identity-bound update receipt",async()=>{
    const db=await setup();
    await db.query("UPDATE wedding_journeys SET progress=progress-'__events' WHERE couple_id=$1",[COUPLE_ID]);
    const added=await prepare(db,"add_schedule_event",{title:"Schedule fixture",date:"2099-05-01",time:"19:30",category_key:"general",schedule_scope:"confirmed_fact"});
    expect(added.result.success).toBe(true);
    expect((await apply(db,added)).rows[0].result.success).toBe(true);
    const event=(await db.query<{event_id:string}>("SELECT progress#>>'{__events,0,id}' AS event_id FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0];
    const updated=await prepare(db,"update_schedule_event",{event_id:event.event_id,expected_title:"Schedule fixture",expected_date:"2099-05-01",time:"19:45",schedule_scope:"confirmed_fact"});
    expect(updated.result.success).toBe(true);
    expect((await apply(db,updated)).rows[0].result.success).toBe(true);
    const receipts=(await db.query("SELECT mutation_kind,budget_delta,decision_node_id IS NOT NULL AS linked FROM amora_shared_action_journey_mutation_receipts ORDER BY applied_revision")).rows;
    expect(receipts).toEqual([{mutation_kind:"add",budget_delta:null,linked:true},{mutation_kind:"update",budget_delta:null,linked:true}]);
    expect((await db.query("SELECT source FROM decision_nodes")).rows).toEqual([{source:"schedule"},{source:"schedule"}]);
    expect((await db.query<{time:string}>("SELECT progress#>>'{__events,0,time}' AS time FROM wedding_journeys WHERE couple_id=$1",[COUPLE_ID])).rows[0].time).toBe("19:45");
  });

  it("keeps the shared record visible only to current members under the existing policy",async()=>{
    const db=await setup(),action=await prepare(db,"update_budget",{total_budget:36_000_000});
    await apply(db,action);
    await db.exec("RESET ROLE; SET ROLE authenticated;");
    await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
    for(const [userId,count] of [[USER_ID,1],[PARTNER_ID,1],[OUTSIDER_ID,0]] as const) {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[userId]);
      expect((await db.query("SELECT id FROM decision_nodes")).rows).toHaveLength(count);
    }
  });

});
