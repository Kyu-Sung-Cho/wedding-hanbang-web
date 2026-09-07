// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, GET, POST } from "./route";
import { POST as createManualAction } from "@/app/api/amora/actions/route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "synthetic") }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
const ownerId="10000000-0000-4000-8000-000000000001";
const partnerId="10000000-0000-4000-8000-000000000002";
const coupleId="20000000-0000-4000-8000-000000000001";
const messageId="30000000-0000-4000-8000-000000000001";
const version="40000000-0000-4000-8000-000000000001";
const fields={messageId,expectedOwnerId:ownerId,expectedProposalVersion:version,expectedRosterFingerprint:"a".repeat(32)};
const row={userId:ownerId,choice:"conditional",condition:"방문 후 확인",revision:1,updatedAt:"2026-09-07T00:00:00.000Z"};
function state() { return {actorId:ownerId,proposalVersion:version,rosterFingerprint:fields.expectedRosterFingerprint,accepted:false,acceptedCount:0,requiredCount:2,partnerLinked:true,completed:false,myResponseRevision:1,myResponse:{...row},responses:[{...row}]}; }
let data: unknown;
let error: {code:string;message:string}|null;
let profileError: unknown;
let currentUser: string|null;
let currentCouple: string;
const rpc=vi.fn(async () => ({data,error}));
function req(method:"GET"|"POST"|"DELETE",body:Record<string,unknown>={}) {
  return new Request(`https://hanbang.ai/api/amora/mediation/responses${method==="GET"?`?${new URLSearchParams({...fields,...body} as Record<string,string>)}`:""}`,method==="GET"?undefined:{
    method,headers:{Origin:"https://hanbang.ai","Content-Type":"application/json"},
    body:JSON.stringify({...fields,expectedResponseRevision:0,...(method==="POST"?{choice:"conditional",condition:"방문 후 확인"}:{}),...body}),
  });
}
beforeEach(()=>{
  vi.clearAllMocks();data=state();error=null;profileError=null;currentUser=ownerId;currentCouple=coupleId;
  vi.mocked(createClientFromRequest).mockImplementation(async()=>({
    auth:{getUser:async()=>({data:{user:currentUser?{id:currentUser}:null},error:null})},rpc,
    from:()=>{
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{couple_id:currentCouple},error:profileError}),single:async()=>({data:{couple_id:currentCouple},error:profileError})};return q;
    },
  }) as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
});

describe("Mediation response HTTP boundary",()=>{
  it("reads the exact actor/proposal response from the authenticated RPC",async()=>{
    const response=await GET(req("GET"));expect(response.status).toBe(200);expect(await response.json()).toEqual(state());
    expect(rpc).toHaveBeenCalledWith("read_own_amora_mediation_response",{p_message_id:messageId,p_expected_owner_id:ownerId,p_expected_proposal_version:version,p_expected_roster_fingerprint:fields.expectedRosterFingerprint});
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("confirms a conditional receipt without claiming a completed decision",async()=>{
    const response=await POST(req("POST"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({accepted:false,completed:false,myResponseRevision:1});
    expect(rpc).toHaveBeenCalledWith("respond_own_amora_mediation",expect.objectContaining({p_choice:"conditional",p_condition:"방문 후 확인",p_expected_response_revision:0}));
  });
  it("requires a tombstone revision receipt when withdrawing",async()=>{
    data={...state(),myResponse:null,myResponseRevision:2,responses:[]};
    const response=await DELETE(req("DELETE",{expectedResponseRevision:1}));expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("respond_own_amora_mediation",expect.objectContaining({p_choice:null,p_condition:null,p_expected_response_revision:1}));
  });
  it.each(["GET","POST","DELETE"] as const)("rejects an account change before %s RPC",async method=>{
    currentUser=partnerId;const response=await ({GET,POST,DELETE}[method])(req(method));expect(response.status).toBe(403);expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["GET","POST","DELETE"] as const)("reports profile outages on %s without source leakage",async method=>{
    profileError={message:"PRIVATE_SYNTHETIC_REPORT"};const response=await ({GET,POST,DELETE}[method])(req(method));expect(response.status).toBe(503);expect(await response.text()).not.toContain("PRIVATE_SYNTHETIC_REPORT");expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    {choice:"conditional",condition:" "},{choice:"ok",condition:"조건"},{choice:"unknown",condition:null},
    {choice:null,condition:null},{choice:undefined,condition:null},{choice:["ok"],condition:null},
    {choice:"difficult",condition:"😀".repeat(251)},{expectedResponseRevision:-1},{expectedResponseRevision:0.5},
  ])("rejects invalid response input before any RPC: %j",async body=>{
    expect((await POST(req("POST",body))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    {...state(),actorId:partnerId},{...state(),proposalVersion:messageId},{...state(),completed:true},
    {...state(),myResponseRevision:3,myResponse:{...row,revision:3},responses:[{...row,revision:3}]},
    {...state(),myResponse:{...row,condition:"다른 조건"},responses:[{...row,condition:"다른 조건"}]},
  ])("never reports success for a stale or mismatched persisted receipt",async malformed=>{
    data=malformed;expect((await POST(req("POST"))).status).toBe(503);
  });
  it.each([
    ["40001","AMORA_MEDIATION_RESPONSE_CHANGED",409],
    ["55000","AMORA_MEDIATION_ALREADY_COMPLETED",409],
    ["42501","PRIVATE_SYNTHETIC_REPORT",403],
    ["08006","PRIVATE_SYNTHETIC_REPORT",503],
  ])("preserves database failure class %s without raw details",async(code,message,status)=>{
    error={code:String(code),message:String(message)};const response=await POST(req("POST"));expect(response.status).toBe(status);expect(await response.text()).not.toContain("PRIVATE_SYNTHETIC_REPORT");
  });
  it("does not trust declared length when reading a large streamed request",async()=>{
    const request=new Request("https://hanbang.ai/api/amora/mediation/responses",{method:"POST",headers:{Origin:"https://hanbang.ai","Content-Type":"application/json","Content-Length":"1"},body:JSON.stringify({...fields,condition:"x".repeat(9000)})});
    expect((await POST(request)).status).toBe(413);expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps malformed JSON out of logs and returns an input error",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {const request=new Request("https://hanbang.ai/api/amora/mediation/responses",{method:"POST",headers:{Origin:"https://hanbang.ai"},body:'{"PRIVATE_SYNTHETIC_REPORT":'});expect((await POST(request)).status).toBe(400);expect(warn).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();}finally{warn.mockRestore();log.mockRestore();}
  });
  it.each([
    {expectedOwnerId:partnerId,expectedCoupleId:coupleId},
    {expectedOwnerId:ownerId,expectedCoupleId:messageId},
    {expectedOwnerId:ownerId},
  ])("does not write reviewed shared-task content into a changed scope",async scope=>{
    const response=await createManualAction(new Request("https://hanbang.ai/api/amora/actions",{method:"POST",headers:{Origin:"https://hanbang.ai","Content-Type":"application/json"},body:JSON.stringify({title:"내가 확인할 내용",status:"open",source:"manual",href:"/chat",...scope})}));
    expect(response.status).toBe(403);expect(rpc).not.toHaveBeenCalled();
  });
});
