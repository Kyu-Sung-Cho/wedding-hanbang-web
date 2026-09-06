// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const BRIDE = "00000000-0000-4000-8000-000000000001";
const GROOM = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const COUPLE = "10000000-0000-4000-8000-000000000001";
const MESSAGE = "20000000-0000-4000-8000-000000000002";
const RESOLUTION = "두 사람이 포함 항목을 확인한 뒤 예산을 다시 비교한다";
type Binding = { version: string; roster: string };
type Receipt = {
  actorId: string; accepted: boolean; acceptedCount: number; completed: boolean;
  myResponseRevision: number; myResponse: { userId: string; choice: string; condition: string | null } | null;
  responses: Array<{ userId: string; choice: string; condition: string | null }>;
};
const migration = (file: string) => readFileSync(resolve(process.cwd(), "../../supabase/migrations", file), "utf8");

async function persona(db: PGlite, actor: string, service = false) {
  await db.exec(`RESET ROLE; SET ROLE ${service ? "service_role" : "authenticated"}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
async function fixture() {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT current_setting('role',true) $$;
      CREATE TABLE couples(id uuid PRIMARY KEY,bride_id uuid REFERENCES auth.users(id),groom_id uuid REFERENCES auth.users(id));
      CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),couple_id uuid REFERENCES couples(id),role text);
      CREATE TABLE chat_messages(id uuid PRIMARY KEY,couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
        sender_id uuid REFERENCES auth.users(id),sender_type text,role text,content text,visibility text DEFAULT 'shared',
        metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
      CREATE TABLE decision_nodes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id) ON DELETE CASCADE,
        category text,decision_type text DEFAULT 'exploring',title text,chosen_value jsonb,options_considered jsonb DEFAULT '[]',
        reasoning text,confidence numeric,stage_tag text,decided_at timestamptz,source text DEFAULT 'chat',source_ref_id uuid,
        metadata jsonb DEFAULT '{}',visibility text DEFAULT 'shared',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE couple_change_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid,recipient_user_id uuid,
        actor_user_id uuid,source_message_id uuid,action_id uuid,event_kind text,tool_name text,title text,message text,href text,
        created_at timestamptz DEFAULT now(),UNIQUE(couple_id,recipient_user_id,action_id,event_kind));
      CREATE FUNCTION public.is_couple_member(p_couple_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT EXISTS(SELECT 1 FROM couples WHERE id=p_couple_id AND auth.uid() IN(bride_id,groom_id)) $$;
      CREATE FUNCTION public.can_access_couple_visibility(p_couple_id uuid,p_visibility text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT EXISTS(SELECT 1 FROM couples WHERE id=p_couple_id AND
          ((p_visibility='shared' AND auth.uid() IN(bride_id,groom_id)) OR (p_visibility='bride_private' AND auth.uid()=bride_id)
           OR (p_visibility='groom_private' AND auth.uid()=groom_id))) $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO PUBLIC;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT SELECT ON public.chat_messages,public.couples TO authenticated;
      INSERT INTO auth.users VALUES('${BRIDE}'),('${GROOM}'),('${OTHER}');
      INSERT INTO couples VALUES('${COUPLE}','${BRIDE}','${GROOM}');
      INSERT INTO profiles VALUES('${BRIDE}','${COUPLE}','bride'),('${GROOM}','${COUPLE}','groom'),('${OTHER}',null,null);
      INSERT INTO chat_messages(id,couple_id,sender_type,role,content) VALUES('${MESSAGE}','${COUPLE}','ai','assistant','합성 조율안');
    `);
    const currentMembership = migration("20260716114000_current_couple_membership_privacy_fence.sql")
      .match(/CREATE OR REPLACE FUNCTION public\.is_current_couple_member\([\s\S]*?(?=CREATE OR REPLACE FUNCTION public\.can_access_couple_visibility)/)?.[0];
    if (!currentMembership) throw new Error("Current membership migration fixture is missing");
    await db.exec(currentMembership);
    await db.exec(migration("20260716092000_amora_mediation_confirmation.sql"));
    await db.exec(migration("20260824130000_mediation_tells_the_partner.sql"));
    await db.exec(migration("20260906223557_amora_mediation_response_choices.sql"));
    await db.query("UPDATE chat_messages SET metadata=$1::jsonb WHERE id=$2", [JSON.stringify({mediation:{resolution:RESOLUTION,origin:"user_requested",evidenceScope:"requester_summary_only",schemaVersion:2}}),MESSAGE]);
    const binding = (await db.query<Binding>("SELECT metadata #>> '{mediation,proposalVersion}' AS version,metadata #>> '{mediation,rosterFingerprint}' AS roster FROM chat_messages WHERE id=$1",[MESSAGE])).rows[0];
    return { db, binding };
  } catch (error) { await db.close(); throw error; }
}
async function read(db: PGlite, actor: string, binding: Binding) {
  return (await db.query<{result:Receipt}>("SELECT public.read_own_amora_mediation_response($1,$2,$3,$4) AS result",[MESSAGE,actor,binding.version,binding.roster])).rows[0].result;
}
async function respond(db: PGlite, actor: string, binding: Binding, revision: number, choice: string | null, condition: string | null = null) {
  return (await db.query<{result:Receipt}>("SELECT public.respond_own_amora_mediation($1,$2,$3,$4,$5,$6,$7) AS result",[MESSAGE,actor,binding.version,binding.roster,revision,choice,condition])).rows[0].result;
}
async function decisions(db: PGlite) {
  await db.exec("RESET ROLE");
  return (await db.query("SELECT chosen_value,metadata FROM decision_nodes WHERE category='conflict_resolution'")).rows;
}

describe("실제 SQL 중재 응답과 확정 경계", () => {
  it("keeps conditions per author and confirms only after two explicit ok responses", async () => {
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE);
      expect(await read(db,BRIDE,binding)).toMatchObject({acceptedCount:0,completed:false,myResponseRevision:0,myResponse:null});
      expect(await respond(db,BRIDE,binding,0,"conditional","포함 항목을 서면으로 확인해야 해요")).toMatchObject({accepted:false,acceptedCount:0,completed:false,myResponseRevision:1});
      await persona(db,GROOM);
      const second=await respond(db,GROOM,binding,0,"ok");
      expect(second).toMatchObject({accepted:true,acceptedCount:1,completed:false});
      expect(second.responses).toEqual(expect.arrayContaining([expect.objectContaining({userId:BRIDE,choice:"conditional",condition:"포함 항목을 서면으로 확인해야 해요"})]));
      expect(await decisions(db)).toHaveLength(0);
      await persona(db,BRIDE);
      expect(await respond(db,BRIDE,binding,1,"ok")).toMatchObject({acceptedCount:2,completed:true,myResponseRevision:2});
      expect(await decisions(db)).toEqual([expect.objectContaining({chosen_value:{value:RESOLUTION},metadata:expect.objectContaining({confirmed_by_both:true})})]);
    } finally {await db.close();}
  });

  it.each(["conditional","difficult"])("withdraws earlier acceptance when the author changes to %s",async choice=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE);
      await respond(db,BRIDE,binding,0,"ok");
      expect(await respond(db,BRIDE,binding,1,choice,"다른 날짜를 먼저 확인할게요")).toMatchObject({accepted:false,acceptedCount:0,completed:false});
      await persona(db,GROOM);
      expect(await respond(db,GROOM,binding,0,"ok")).toMatchObject({acceptedCount:1,completed:false});
      expect(await decisions(db)).toHaveLength(0);
    } finally {await db.close();}
  });

  it("retains a withdrawal revision so an old request cannot come back after cancellation",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"ok");
      expect(await respond(db,BRIDE,binding,1,null)).toMatchObject({accepted:false,myResponse:null,myResponseRevision:2});
      await expect(respond(db,BRIDE,binding,0,"ok")).rejects.toMatchObject({code:"40001",message:"AMORA_MEDIATION_RESPONSE_CHANGED"});
      expect(await read(db,BRIDE,binding)).toMatchObject({accepted:false,myResponseRevision:2});
    } finally {await db.close();}
  });

  it("rejects another actor and an outsider even with a valid proposal identifier",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE);
      await expect(respond(db,GROOM,binding,0,"ok")).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      await expect(read(db,GROOM,binding)).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      await persona(db,OTHER);
      await expect(read(db,OTHER,binding)).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      await expect(respond(db,OTHER,binding,0,"ok")).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      expect(await decisions(db)).toHaveLength(0);
    } finally {await db.close();}
  });

  it("does not rewrite a completed decision when a later response changes",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"ok");
      await persona(db,GROOM); await respond(db,GROOM,binding,0,"ok");
      const original=await decisions(db);
      await persona(db,BRIDE);
      await expect(respond(db,BRIDE,binding,1,"difficult","다시 논의하고 싶어요")).rejects.toMatchObject({code:"55000",message:"AMORA_MEDIATION_ALREADY_COMPLETED"});
      await expect(respond(db,BRIDE,binding,1,null)).rejects.toMatchObject({code:"55000",message:"AMORA_MEDIATION_ALREADY_COMPLETED"});
      expect(await decisions(db)).toEqual(original);
    } finally {await db.close();}
  });

  it("rejects stale proposal revisions and changed membership",async()=>{
    const {db,binding}=await fixture();
    try {
      await db.query("UPDATE chat_messages SET metadata=jsonb_set(metadata,'{mediation,resolution}',to_jsonb($1::text)) WHERE id=$2",["새 조건을 함께 검토한다",MESSAGE]);
      await persona(db,BRIDE);
      await expect(respond(db,BRIDE,binding,0,"ok")).rejects.toMatchObject({code:"55000",message:"AMORA_MEDIATION_PROPOSAL_CHANGED"});
      await db.exec("RESET ROLE");
      await db.query("UPDATE couples SET groom_id=$1 WHERE id=$2",[OTHER,COUPLE]);
      await persona(db,GROOM);
      await expect(read(db,GROOM,binding)).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      expect(await decisions(db)).toHaveLength(0);
    } finally {await db.close();}
  });

  it("does not let the legacy acceptance endpoint erase a saved condition",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"conditional","포함 항목 확인 필요");
      await persona(db,BRIDE,true);
      await expect(db.query("SELECT public.accept_amora_mediation($1,$2,$3,$4,$5,$6,$7)",[COUPLE,MESSAGE,BRIDE,"합성 조율안",RESOLUTION,binding.version,binding.roster])).rejects.toMatchObject({code:"40001",message:"AMORA_MEDIATION_RESPONSE_CHANGED"});
      await persona(db,BRIDE);
      expect(await read(db,BRIDE,binding)).toMatchObject({accepted:false,myResponse:{choice:"conditional",condition:"포함 항목 확인 필요"}});
      expect(await decisions(db)).toHaveLength(0);
    } finally {await db.close();}
  });

  it("serializes two submissions with the same revision so only one can replace the response",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE);
      const results=await Promise.allSettled([
        respond(db,BRIDE,binding,0,"conditional","계약 포함 항목 확인"),
        respond(db,BRIDE,binding,0,"difficult","다른 날짜 확인"),
      ]);
      expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
      expect(results.find(result=>result.status==="rejected")).toMatchObject({reason:{code:"40001",message:"AMORA_MEDIATION_RESPONSE_CHANGED"}});
      expect(await read(db,BRIDE,binding)).toMatchObject({acceptedCount:0,myResponseRevision:1});
    } finally {await db.close();}
  });

  it.each([["conditional",null],["conditional","\t\u3000"],["ok","아직 확인 필요"],["difficult","😀".repeat(251)]])("rejects invalid condition input without losing the accepted response (%s)",async(choice,condition)=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"ok");
      await expect(respond(db,BRIDE,binding,1,choice,condition)).rejects.toMatchObject({code:"22023",message:"AMORA_MEDIATION_INVALID_RESPONSE"});
      expect(await read(db,BRIDE,binding)).toMatchObject({accepted:true,acceptedCount:1,myResponseRevision:1});
    } finally {await db.close();}
  });

  it("enforces direct table read/write permissions and removes conditions if the source becomes private",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"conditional","공유한 확인 조건");
      await expect(db.exec("UPDATE amora_mediation_responses SET choice='ok',condition=null")).rejects.toMatchObject({code:"42501"});
      await persona(db,OTHER);
      expect((await db.query("SELECT * FROM amora_mediation_responses")).rows).toEqual([]);
      await db.exec("RESET ROLE");
      await db.query("UPDATE chat_messages SET visibility='bride_private' WHERE id=$1",[MESSAGE]);
      expect((await db.query("SELECT * FROM amora_mediation_responses")).rows).toEqual([]);
      await persona(db,GROOM);
      await expect(read(db,GROOM,binding)).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
    } finally {await db.close();}
  });

  it.each(["UPDATE profiles SET couple_id=null", "UPDATE profiles SET role='groom'"])("rejects a profile that no longer agrees with the locked couple (%s)",async change=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE); await respond(db,BRIDE,binding,0,"conditional","공유한 계약 확인 조건");
      expect((await db.query("SELECT * FROM amora_mediation_responses")).rows).toHaveLength(1);
      await db.exec("RESET ROLE");
      await db.exec(`${change} WHERE id='${BRIDE}'`);
      await persona(db,BRIDE);
      expect((await db.query("SELECT * FROM amora_mediation_responses")).rows).toEqual([]);
      await expect(read(db,BRIDE,binding)).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      await expect(respond(db,BRIDE,binding,0,"ok")).rejects.toMatchObject({code:"42501",message:"AMORA_MEDIATION_SCOPE_INVALID"});
      expect(await decisions(db)).toHaveLength(0);
    } finally {await db.close();}
  });

  it("accepts exactly 500 UTF-16 units after Unicode whitespace trimming",async()=>{
    const {db,binding}=await fixture();
    try {
      await persona(db,BRIDE);
      const condition="😀".repeat(250);
      expect(await respond(db,BRIDE,binding,0,"conditional",`\t\u3000${condition}\u3000\t`)).toMatchObject({myResponse:{choice:"conditional",condition},acceptedCount:0});
    } finally {await db.close();}
  });
});
