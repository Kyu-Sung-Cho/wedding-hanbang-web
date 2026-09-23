// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPrivacyConfirmationDatabase as createDatabase } from "./privacyConfirmationFixture";
const A = "00000000-0000-4000-8000-000000000001";
const C = "10000000-0000-4000-8000-000000000001";
describe("destructive confirmation target transaction", () => {
  it("invalidates a destructive confirmation when the current chat view is cleared", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`RESET ROLE; UPDATE public.profiles SET private_chat_cleared_at=now() WHERE id='${A}'; SET ROLE authenticated;`);
      await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,7)", [A,C]))
        .rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      await db.exec("RESET ROLE");
      expect((await db.query<{ couple_id: string }>("SELECT couple_id FROM public.profiles WHERE id=$1", [A])).rows[0].couple_id).toBe(C);
    } finally { await db.close(); }
  });
  it("preserves shared and remaining-partner memory under the current main membership contract", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`RESET ROLE;
        INSERT INTO public.chat_summaries(couple_id,visibility,content) VALUES
          ('${C}','shared','shared memory'),('${C}','groom_private','partner memory'),('${C}','bride_private','departing memory');
        SET ROLE authenticated;`);
      await db.query("SELECT public.reset_current_couple_membership($1,$2,7)", [A,C]);
      await db.exec("RESET ROLE");
      expect((await db.query<{ content: string }>("SELECT content FROM public.chat_summaries ORDER BY content")).rows)
        .toEqual([{ content: "partner memory" }, { content: "shared memory" }]);
    } finally { await db.close(); }
  });
  it("rejects the old targetless reset RPC without unlinking the current couple", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query("SELECT public.reset_current_couple_membership()"))
        .rejects.toThrow(/CONFIRMATION_REQUIRED|permission denied/);
      await db.exec("RESET ROLE");
      expect((await db.query<{ couple_id: string }>("SELECT couple_id FROM public.profiles WHERE id=$1", [A])).rows[0].couple_id).toBe(C);
    } finally { await db.close(); }
  });
  it("only unlinks the authenticated actor's exact confirmed couple and epoch", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,$3)", [A,C,6])).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      const result = await db.query<{ result: { success: boolean; previous_couple_id: string } }>("SELECT public.reset_current_couple_membership($1,$2,$3) AS result", [A,C,7]);
      expect(result.rows[0].result).toEqual({ success: true, previous_couple_id: C });
      await db.exec("RESET ROLE");
      expect((await db.query<{ couple_id: string | null }>("SELECT couple_id FROM public.profiles WHERE id=$1", [A])).rows[0].couple_id).toBeNull();
    } finally { await db.close(); }
  });
  it("rejects a missing actor roster slot before entering the old reset primitive", async () => {
    const db = await createDatabase();
    try {
      await db.exec("RESET ROLE; UPDATE public.couples SET bride_id=NULL; SET ROLE authenticated");
      await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,$3)", [A,C,7])).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
    } finally { await db.close(); }
  });
  it("fences real consent and scope clearing while allowing a freshly reviewed next mutation", async () => {
    const db = await createDatabase();
    try {
      await db.exec("RESET ROLE; SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false)");
      const call = (action: string, epoch: number, consent: boolean | null) => db.query<{ result: { enabled?: boolean; cleared?: boolean } }>(
        "SELECT public.mutate_amora_memory_with_confirmation($1,$2,$3,$4,$5,$6) AS result",[A,C,epoch,'bride_private',action,consent]);
      expect((await call('toggle',7,true)).rows[0].result.enabled).toBe(true);
      await expect(call('clear_scope',7,null)).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      await db.exec("RESET ROLE");
      const epoch = Number((await db.query<{ epoch: number }>("SELECT epoch FROM public.amora_privacy_context_epochs WHERE couple_id=$1",[C])).rows[0].epoch);
      expect(epoch).toBeGreaterThan(7);
      await db.exec(`INSERT INTO public.chat_summaries(couple_id,visibility,content) VALUES ('${C}','bride_private','synthetic private summary'); SET ROLE service_role`);
      expect((await call('clear_scope',epoch,null)).rows[0].result.cleared).toBe(true);
      await db.exec("RESET ROLE");
      expect((await db.query("SELECT content FROM public.chat_summaries")).rows).toEqual([]);
      const nextEpoch = Number((await db.query<{ epoch: number }>("SELECT epoch FROM public.amora_privacy_context_epochs WHERE couple_id=$1",[C])).rows[0].epoch);
      await db.exec("SET ROLE service_role");
      expect((await call('toggle',nextEpoch,true)).rows[0].result.enabled).toBe(true);
    } finally { await db.close(); }
  });
  it("rejects wrong actors, role-private mismatch and pre-relink epochs without deleting data", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,7)", ["00000000-0000-4000-8000-000000000002",C])).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      await db.exec("RESET ROLE; SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false)");
      await expect(db.query("SELECT public.mutate_amora_memory_with_confirmation($1,$2,7,'groom_private','clear_scope',NULL)",[A,C])).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      await db.exec(`RESET ROLE; UPDATE public.profiles SET couple_id=NULL WHERE id='${A}'; UPDATE public.profiles SET couple_id='${C}' WHERE id='${A}'; SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false)`);
      await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,7)",[A,C])).rejects.toThrow(/PRIVACY_CONFIRMATION_CHANGED/);
      await db.exec("RESET ROLE");
      expect((await db.query<{ couple_id:string }>("SELECT couple_id FROM public.profiles WHERE id=$1",[A])).rows[0].couple_id).toBe(C);
      expect((await db.query("SELECT id FROM public.chat_messages")).rows).toHaveLength(3);
    } finally { await db.close(); }
  });
  it("denies direct legacy primitives, internal fence, anon reset and non-service memory calls", async () => {
    const db = await createDatabase();
    try {
      for (const role of ['anon','authenticated','service_role']) {
        await db.exec(`RESET ROLE; SET ROLE ${role}; SELECT set_config('request.jwt.claim.role','${role}',false)`);
        for (const sql of [
          "SELECT public.reset_current_couple_membership_pre_confirmation()",
          `SELECT public.lock_privacy_confirmation_target('${A}','${C}',7,'shared')`,
          `SELECT public.set_amora_memory_consent('${C}','shared','${A}',true)`,
          `SELECT public.clear_amora_memory_scope('${C}','shared','${A}')`,
        ]) await expect(db.query(sql)).rejects.toThrow(/permission denied/);
        if (role !== 'authenticated') await expect(db.query("SELECT public.reset_current_couple_membership($1,$2,7)",[A,C])).rejects.toThrow(/permission denied/);
        if (role !== 'service_role') await expect(db.query("SELECT public.mutate_amora_memory_with_confirmation($1,$2,7,'shared','clear_scope',NULL)",[A,C])).rejects.toThrow(/permission denied/);
      }
    } finally { await db.close(); }
  });
});
