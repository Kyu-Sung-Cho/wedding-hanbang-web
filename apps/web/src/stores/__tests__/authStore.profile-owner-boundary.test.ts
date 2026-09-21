import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "../authStore";
import { PATCH } from "@/app/api/profile/route";
import type { Profile } from "@/types/database.types";

const server = vi.hoisted(() => ({ rpc: vi.fn(), userId: "", fetch: vi.fn<typeof fetch>() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: async () => ({ data: { user: { id: server.userId } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: server.rpc }) }));
vi.mock("@/lib/profileWeddingRole", () => ({ readOptionalProfileWeddingRoles: async () => new Map() }));
vi.mock("@/lib/profileAvatar", () => ({ readOptionalProfileAvatars: async () => new Map() }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: () => true }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "synthetic-profile-owner" }));

const B = "22222222-2222-4222-8222-222222222222";
let count = 0;
let profile: Profile;
beforeEach(() => {
  const id = `11111111-1111-4111-8111-${String(++count).padStart(12, "0")}`;
  profile = { id, name: "이전 이름", role: "bride", couple_id: null, avatar_url: null,
    onboarding_completed: true, onboarding_step: 5, is_admin: false,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
    care_notifications_enabled: false, care_notifications_consented_at: null };
  useAuthStore.getState().reset();
  useAuthStore.setState({ user: { id, email: "synthetic@example.invalid" }, profile, isDemo: false, isInitialized: true });
  server.userId = id;
  server.rpc.mockReset().mockImplementation(async () => ({ data: { profile: { ...profile, id: server.userId, name: "새이름" }, community_profile_synced: false }, error: null }));
  server.fetch.mockReset().mockImplementation(async (_input, init) => PATCH(new Request("http://localhost/api/profile", init)));
  vi.stubGlobal("fetch", server.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); useAuthStore.getState().reset(); });

it("blocks an A screen's draft before the B-authenticated route can call a write RPC", async () => {
  server.userId = B;
  await expect(useAuthStore.getState().updateProfile({ name: "옛계정초안" })).rejects.toThrow();
  expect(server.rpc).not.toHaveBeenCalled();
  expect(useAuthStore.getState().profile?.name).toBe("이전 이름");
});

it("sends the screen owner and completes a same-owner profile save through the real route", async () => {
  await useAuthStore.getState().updateProfile({ name: "새이름" });
  expect(JSON.parse(String(server.fetch.mock.calls[0][1]?.body))).toEqual({ name: "새이름", expectedOwnerId: profile.id });
  expect(server.rpc).toHaveBeenCalledWith("patch_profile_atomic", expect.objectContaining({ p_user_id: profile.id, p_name: "새이름" }));
  expect(useAuthStore.getState().profile?.name).toBe("새이름");
});

it.each([null, { id: B, email: "other@example.invalid" }])("does not send when local user/profile bindings disagree: %j", async user => {
  useAuthStore.setState({ user });
  await expect(useAuthStore.getState().updateProfile({ name: "새이름" })).rejects.toThrow();
  expect(server.fetch).not.toHaveBeenCalled();
  expect(server.rpc).not.toHaveBeenCalled();
});

it("derives the target from the store, not an extra caller-supplied owner field", async () => {
  const updates = { name: "새이름", expectedOwnerId: B };
  await useAuthStore.getState().updateProfile(updates);
  expect(JSON.parse(String(server.fetch.mock.calls[0][1]?.body)).expectedOwnerId).toBe(profile.id);
});

it.each([undefined, null, "", B, {}, 17])("rejects absent, malformed or stale targets without database writes: %j", async expectedOwnerId => {
  const response = await PATCH(new Request("http://localhost/api/profile", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "새이름", expectedOwnerId }),
  }));
  expect(response.status).toBe(409);
  expect(server.rpc).not.toHaveBeenCalled();
  const body = await response.json();
  expect(body.error).not.toContain(profile.id);
  expect(body.error).not.toContain(B);
});
