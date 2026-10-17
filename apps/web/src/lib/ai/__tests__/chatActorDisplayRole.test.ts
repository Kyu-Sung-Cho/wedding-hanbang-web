import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readChatActorDisplayRole } from "../chatActorDisplayRole";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("authenticated chat actor's selected role", () => {
  it.each([
    [{ user_id: ACTOR, confirmed_role: "bride", role: "groom" }, "bride"],
    [{ user_id: ACTOR, confirmed_role: "groom", role: "bride" }, "groom"],
    [{ user_id: ACTOR, confirmed_role: null, role: "bride" }, "not_selected"],
    [null, "not_selected"],
    [{ user_id: ACTOR, role: "groom" }, "unavailable"],
    [{ user_id: ACTOR, confirmed_role: "unexpected" }, "unavailable"],
    [{ user_id: OTHER, confirmed_role: "groom" }, "unavailable"],
    [undefined, "unavailable"],
  ])("does not infer from the internal slot: %j", async (data, expected) => {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, ACTOR)).toBe(expected);
    expect(from).toHaveBeenCalledWith("profile_wedding_roles");
    expect(select).toHaveBeenCalledWith("user_id,confirmed_role");
    expect(eq).toHaveBeenCalledWith("user_id", ACTOR);
  });

  it.each([{ code: "42703" }, { code: "PGRST301" }, new Error("network")])("fails independently of the required profile read: %j", async error => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: ACTOR, confirmed_role: null }, error });
    const from = vi.fn().mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, ACTOR)).toBe("unavailable");
    from.mockImplementationOnce(() => { throw error; });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, ACTOR)).toBe("unavailable");
  });
});
