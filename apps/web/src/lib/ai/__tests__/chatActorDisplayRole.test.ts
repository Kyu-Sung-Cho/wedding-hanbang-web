import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readChatActorDisplayRole } from "../chatActorDisplayRole";

describe("authenticated chat actor's selected role", () => {
  it.each([
    [{ confirmed_role: "bride", role: "groom" }, "bride"],
    [{ confirmed_role: "groom", role: "bride" }, "groom"],
    [{ confirmed_role: null, role: "bride" }, "not_selected"],
    [{ role: "groom" }, "unavailable"],
    [{ confirmed_role: "unexpected" }, "unavailable"],
    [null, "unavailable"],
  ])("does not infer from the internal slot: %j", async (data, expected) => {
    const single = vi.fn().mockResolvedValue({ data, error: null });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, "current-actor")).toBe(expected);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("confirmed_role");
    expect(eq).toHaveBeenCalledWith("id", "current-actor");
  });

  it.each([{ code: "42703" }, { code: "PGRST301" }, new Error("network")])("fails independently of the required profile read: %j", async error => {
    const single = vi.fn().mockResolvedValue({ data: { confirmed_role: null }, error });
    const from = vi.fn().mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, "current-actor")).toBe("unavailable");
    from.mockImplementationOnce(() => { throw error; });
    expect(await readChatActorDisplayRole({ from } as unknown as SupabaseClient, "current-actor")).toBe("unavailable");
  });
});
