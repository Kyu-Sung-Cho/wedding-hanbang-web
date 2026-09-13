// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222", C="33333333-3333-4333-8333-333333333333";
const COUPLE="44444444-4444-4444-8444-444444444444", REV="55555555-5555-4555-8555-555555555555";
const m=vi.hoisted(()=>({rpc:vi.fn(),partnerId:"22222222-2222-4222-8222-222222222222"}));
vi.mock("@/lib/auth/signupConsentAccess",()=>({getWebSignupConsentAccess:()=>"server_verified"}));
vi.mock("@/lib/demoSession",()=>({hasSignedDemoSessionFromCookieHeader:()=>false}));
function query(table:string) {
  const data=table==="profiles" ? {id:A,name:"이름",role:"bride",couple_id:COUPLE}
    : table==="couples" ? {id:COUPLE,bride_id:A,groom_id:m.partnerId,member_model_version:2}
    : table==="couple_profile_directory" ? {id:m.partnerId,name:"상대",role:"groom",couple_id:COUPLE}
    : {id:C,couple_id:COUPLE,total_budget:100000};
  const result={select:()=>result,eq:()=>result,single:async()=>({data,error:null}),maybeSingle:async()=>({data,error:null})};
  return result;
}
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:query,rpc:m.rpc})}));
vi.mock("@/lib/supabase/server",()=>({createClientFromRequest:async()=>({auth:{getUser:async()=>({data:{user:{id:A,email:"test@example.invalid"}}})},from:query})}));
import { GET } from "./route";
beforeEach(()=>{vi.clearAllMocks();m.partnerId=B;});
describe("auth/me projects only current explicit display roles",()=>{
  it.each(["both available","role unavailable","avatar unavailable"])("combines independent private role and avatar projections: %s",async scenario=>{
    m.rpc.mockImplementation(async (name:string)=> name==="read_profile_wedding_roles"
      ? scenario==="role unavailable"?{data:null,error:{code:"offline"}}:{data:[
        {user_id:A,confirmed_role:"groom",revision:REV,couple_id:COUPLE},
        {user_id:B,confirmed_role:"bride",revision:REV,couple_id:COUPLE}],error:null}
      : scenario==="avatar unavailable"?{data:null,error:{code:"offline"}}:{data:[
        {user_id:A,kind:"emoji",emoji:"🌷",object_path:null,revision:REV,updated_at:"2026-09-13T00:00:00Z"},
        {user_id:B,kind:"photo",emoji:null,object_path:`${B}/${REV}.webp`,revision:REV,updated_at:"2026-09-13T00:00:00Z"}],error:null});
    const response=await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(200);const body=await response.json();
    if(scenario==="role unavailable"){
      expect(body.profile).not.toHaveProperty("confirmed_role");expect(body.partner).not.toHaveProperty("confirmed_role");
    }else {expect(body.profile.confirmed_role).toBe("groom");expect(body.partner.confirmed_role).toBe("bride");}
    if(scenario==="avatar unavailable"){
      expect(body.profile).not.toHaveProperty("avatar_url");expect(body.partner).not.toHaveProperty("avatar_url");
    }else {expect(body.profile.avatar_url).toBe("🌷");expect(body.partner.avatar_url).toBe(`/api/profile/avatar/image?userId=${B}&version=${REV}`);}
    expect(body.profile.role).toBe("bride");expect(body.partner.role).toBe("groom");
    expect(m.rpc).toHaveBeenCalledWith("read_profile_avatar_snapshot",{p_user_id:A});
  });
  it("reads the verified owner, keeps authorization slots, and only projects the matched current partner",async()=>{
    m.rpc.mockResolvedValue({data:[{user_id:A,confirmed_role:"groom",revision:REV,couple_id:COUPLE},{user_id:B,confirmed_role:"bride",revision:REV,couple_id:COUPLE}],error:null});
    const response=await GET(new Request(`https://hanbang.ai/api/auth/me?userId=${C}`));
    expect(response.status).toBe(200); const body=await response.json();
    expect(m.rpc).toHaveBeenCalledWith("read_profile_wedding_roles",{p_user_id:A});
    expect(body.profile).toMatchObject({id:A,role:"bride",confirmed_role:"groom",confirmed_role_revision:REV});
    expect(body.partner).toMatchObject({id:B,role:"groom",confirmed_role:"bride"});
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it.each(["new partner", "changed couple", "query failure", "missing row"])("keeps privacy and clear semantics: %s",async scenario=>{
    if(scenario==="new partner") m.partnerId=C;
    m.rpc.mockResolvedValue(scenario==="query failure"?{data:null,error:{code:"PGRST202"}}:{data:[
      {user_id:A,confirmed_role:null,revision:null,couple_id:COUPLE},
      {user_id:B,confirmed_role:scenario==="missing row"?null:"bride",revision:scenario==="missing row"?null:REV,couple_id:scenario==="changed couple"?C:COUPLE},
    ],error:null});
    const response=await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(200); const body=await response.json();
    if(scenario==="query failure") expect(body.profile).not.toHaveProperty("confirmed_role");
    else expect(body.profile.confirmed_role).toBeNull();
    if(scenario==="missing row") expect(body.partner.confirmed_role).toBeNull();
    else expect(body.partner).not.toHaveProperty("confirmed_role");
  });
});
