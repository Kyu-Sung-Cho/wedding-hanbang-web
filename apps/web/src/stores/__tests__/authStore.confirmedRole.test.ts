import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../authStore";
import type { Profile, Couple } from "@/types/database.types";
const A="owner",B="partner",C="couple",R1="first-revision",R2="second-revision";
const profile:Profile={id:A,name:"이름",role:"bride",couple_id:C,avatar_url:null,confirmed_role:"groom",confirmed_role_revision:R1,onboarding_completed:true,onboarding_step:5,is_admin:false,created_at:"",updated_at:""};
const couple:Couple={id:C,bride_id:A,groom_id:B,invite_code:null,membership_sealed_at:null,created_at:"",updated_at:""};
const partner={id:B,name:"상대",role:"groom" as const,couple_id:C,confirmed_role:"bride" as const,confirmed_role_revision:R1};
const fetchMock=vi.fn<typeof fetch>();
beforeEach(()=>{useAuthStore.getState().reset();useAuthStore.setState({user:{id:A,email:"test@example.invalid"},profile:{...profile},partner:{...partner},couple,journey:null,isInitialized:true,isDemo:false});fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);});
afterEach(()=>{vi.unstubAllGlobals();useAuthStore.getState().reset();});
describe.each(["initialize","refreshJourney"] as const)("%s confirmed role",operation=>{
  it.each(["late save","missing field","explicit reset","new partner","changed couple","name saved during reset"])("preserves role/revision and owner boundaries: %s",async scenario=>{
    let finish!:(value:Response)=>void; fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=operation==="initialize"?useAuthStore.getState().initialize({force:true}):useAuthStore.getState().refreshJourney(A);
    if(scenario==="late save") useAuthStore.setState({profile:{...profile,confirmed_role:"bride",confirmed_role_revision:R2}});
    if(scenario==="name saved during reset") useAuthStore.setState({profile:{...profile,name:"새 이름"}});
    const reset=scenario==="explicit reset"||scenario==="name saved during reset";
    const fields=reset?{confirmed_role:null,confirmed_role_revision:R2}:scenario==="late save"?{confirmed_role:"groom",confirmed_role_revision:R1}:{};
    const nextCouple=scenario==="changed couple"?"couple-2":C;
    finish(new Response(JSON.stringify({user:{id:A,email:"test@example.invalid"},profile:{id:A,name:"이름",role:"bride",couple_id:nextCouple,...fields},partner:{id:scenario==="new partner"?"new-partner":B,name:"상대",role:"groom",couple_id:nextCouple,...(scenario==="explicit reset"?{confirmed_role:null,confirmed_role_revision:R2}:{})},couple:{...couple,id:nextCouple},journey:null})));
    await pending;
    expect(useAuthStore.getState().profile?.confirmed_role).toBe(scenario==="late save"?"bride":reset?null:"groom");
    expect(useAuthStore.getState().profile?.confirmed_role_revision).toBe(scenario==="late save"||reset?R2:R1);
    expect(useAuthStore.getState().partner?.confirmed_role).toBe(scenario==="new partner"||scenario==="changed couple"?undefined:scenario==="explicit reset"?null:"bride");
    expect(useAuthStore.getState().profile?.role).toBe("bride");
  });
});
describe("name edit preserves role ownership",()=>{
  it.each(["missing field","late save","account switch"])("does not roll back role or another account: %s",async scenario=>{
    let finish!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=useAuthStore.getState().updateProfile({name:"새 이름"});
    if(scenario==="late save") useAuthStore.setState({profile:{...profile,confirmed_role:"bride",confirmed_role_revision:R2}});
    if(scenario==="account switch") useAuthStore.setState({user:{id:"other",email:"other@example.invalid"},profile:{...profile,id:"other"}});
    finish(new Response(JSON.stringify({profile:{id:A,name:"새 이름",role:"bride",couple_id:C,...(scenario==="late save"?{confirmed_role:"groom",confirmed_role_revision:R1}:{})}})));
    if(scenario==="account switch") await expect(pending).rejects.toThrow("계정 상태가 바뀌었어요.");
    else await pending;
    expect(useAuthStore.getState().profile?.id).toBe(scenario==="account switch"?"other":A);
    expect(useAuthStore.getState().profile?.confirmed_role).toBe(scenario==="late save"?"bride":"groom");
    expect(useAuthStore.getState().profile?.confirmed_role_revision).toBe(scenario==="late save"?R2:R1);
  });
});
