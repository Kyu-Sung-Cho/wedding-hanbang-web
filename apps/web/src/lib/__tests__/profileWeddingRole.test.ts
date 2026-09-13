// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readOptionalProfileWeddingRoles, readProfileWeddingRole, saveProfileWeddingRole } from "../profileWeddingRole";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REV = "33333333-3333-4333-8333-333333333333";
const PREVIOUS = "44444444-4444-4444-8444-444444444444";
const rpc = vi.fn();
const admin = { rpc } as unknown as SupabaseClient;
const saved = { user_id: USER, confirmed_role: "bride", revision: REV };
beforeEach(() => { vi.clearAllMocks(); rpc.mockImplementation(async name => ({ data: name === "save_profile_wedding_role" ? saved : [{ ...saved,couple_id:null }], error:null })); });
describe("explicit role read and CAS acknowledgement", () => {
  it("passes the screen revision and verifies the saved owner/value/revision", async () => {
    expect(await saveProfileWeddingRole(admin,USER,"bride",PREVIOUS)).toEqual(saved);
    expect(rpc).toHaveBeenNthCalledWith(1,"save_profile_wedding_role",{p_user_id:USER,p_confirmed_role:"bride",p_expected_revision:PREVIOUS});
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([null,{...saved,user_id:OTHER},{...saved,confirmed_role:null},{...saved,revision:null},{...saved,revision:PREVIOUS}])("does not claim success for malformed acknowledgement %j", async data => {
    rpc.mockResolvedValueOnce({data,error:null});
    await expect(saveProfileWeddingRole(admin,USER,"bride",PREVIOUS)).rejects.toMatchObject({status:503});
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale editor instead of reading a new baseline and overwriting it", async () => {
    rpc.mockResolvedValueOnce({data:null,error:{code:"P0001",message:"PROFILE_ROLE_CONFLICT"}});
    await expect(saveProfileWeddingRole(admin,USER,"bride",PREVIOUS)).rejects.toMatchObject({status:409});
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry uncertain writes and requires reloading the canonical role", async () => {
    rpc.mockRejectedValueOnce(new Error("transport"));
    await expect(saveProfileWeddingRole(admin,USER,"bride",PREVIOUS)).rejects.toThrow("transport");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a later canonical revision even if the role has changed back to the same value", async () => {
    rpc.mockResolvedValueOnce({data:saved,error:null}).mockResolvedValueOnce({data:[{...saved,revision:OTHER,couple_id:null}],error:null});
    await expect(saveProfileWeddingRole(admin,USER,"bride",PREVIOUS)).rejects.toMatchObject({status:409});
  });
  it("only returns the owner's public DTO and distinguishes missing selection from failure", async () => {
    rpc.mockResolvedValueOnce({data:[{user_id:USER,confirmed_role:null,revision:null,couple_id:null}],error:null});
    expect(await readProfileWeddingRole(admin,USER)).toEqual({user_id:USER,confirmed_role:null,revision:null});
    rpc.mockResolvedValueOnce({data:null,error:{code:"PGRST202"}});
    expect(await readOptionalProfileWeddingRoles(admin,USER)).toEqual(new Map());
    expect(await readOptionalProfileWeddingRoles(()=>{throw new Error("client unavailable");},USER)).toEqual(new Map());
  });
  it.each([{data:[]},{data:[{...saved,user_id:OTHER,couple_id:null}]},{data:[{...saved,couple_id:null},{...saved,couple_id:null}]}])("fails closed on malformed scope rows %j", async ({data}) => {
    rpc.mockResolvedValueOnce({data,error:null}); await expect(readProfileWeddingRole(admin,USER)).rejects.toMatchObject({status:503});
  });
});
