import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Couple, Profile, WeddingJourney } from "@/types/database.types";
import { useAuthStore } from "../authStore";
import {
  bindChatComposerSession,
  createEmptyComposerDrafts,
  isChatComposerLeaseCurrent,
  resetChatComposerSession,
  updateChatComposerDrafts,
  useChatComposerStore,
  type ComposerLease,
} from "../chatComposerStore";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const NOW = "2026-09-19T00:00:00.000Z";
function actor(id = "actor-a", coupleId = "couple-a", role: "bride" | "groom" = "bride") {
  const user = { id, email: `${id}@example.test` };
  const profile: Profile = {
    id, couple_id: coupleId, role, name: id, avatar_url: null, onboarding_completed: true,
    onboarding_step: 5, is_admin: false, created_at: NOW, updated_at: NOW,
  };
  const couple: Couple = {
    id: coupleId, invite_code: null, bride_id: role === "bride" ? id : "partner-a",
    groom_id: role === "groom" ? id : "partner-a", membership_sealed_at: NOW,
    created_at: NOW, updated_at: NOW,
  };
  const journey: WeddingJourney = {
    id: "journey-a", couple_id: coupleId, wedding_date: null, venue: null,
    total_budget: 0, progress: {}, created_at: NOW, updated_at: NOW,
  };
  return { user, profile, couple, journey, partner: null, isDemo: false };
}

function bindCurrent() {
  const { profile, couple, isDemo } = useAuthStore.getState();
  return bindChatComposerSession(JSON.stringify([profile?.id ?? null, couple?.id ?? null, profile?.role ?? null, isDemo]));
}

function populate(lease: ComposerLease) {
  updateChatComposerDrafts(lease, (current) => Object.fromEntries(
    Object.entries(current).map(([lane, draft]) => [lane, {
      ...draft,
      input: `SYNTHETIC_${lane}`,
      retryClientRequestId: "30000000-0000-4000-8000-000000000001",
      attachments: [{ base64: "c3ludGhldGlj", mediaType: "image/png", fileName: "synthetic.png", previewUrl: `blob:${lane}` }],
    }]),
  ) as typeof current);
}

describe("memory composer uses the real auth store lifecycle without a mounted screen", () => {
  const revoked = vi.fn();
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in this test"); }));
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
    useAuthStore.getState().reset();
    resetChatComposerSession();
    useAuthStore.setState(actor());
    revoked.mockClear();
  });
  afterEach(() => {
    useAuthStore.getState().reset();
    resetChatComposerSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("retains exact lane drafts and request ids when the same owner binds again", () => {
    const original = bindCurrent();
    populate(original);
    const before = useChatComposerStore.getState().drafts;
    const next = bindCurrent();
    expect(next).toEqual(original);
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(revoked).not.toHaveBeenCalled();
  });

  it("purges immediately on A to B to A without rendering a component", () => {
    const a = bindCurrent();
    populate(a);
    useAuthStore.setState(actor("actor-b", "couple-a", "groom"));
    expect(useChatComposerStore.getState().drafts).toEqual(createEmptyComposerDrafts());
    expect(isChatComposerLeaseCurrent(a)).toBe(false);
    const b = bindCurrent();
    populate(b);
    useAuthStore.setState(actor());
    bindCurrent();
    expect(useChatComposerStore.getState().drafts).toEqual(createEmptyComposerDrafts());
    expect(isChatComposerLeaseCurrent(a)).toBe(false);
    expect(isChatComposerLeaseCurrent(b)).toBe(false);
    expect(revoked).toHaveBeenCalledTimes(6);
  });

  it("auth reset clears drafts, attachments, and pending retry ids before another login", () => {
    const lease = bindCurrent();
    populate(lease);
    useAuthStore.getState().reset();
    expect(useChatComposerStore.getState().identity).toBeNull();
    expect(useChatComposerStore.getState().drafts).toEqual(createEmptyComposerDrafts());
    expect(isChatComposerLeaseCurrent(lease)).toBe(false);
    expect(revoked).toHaveBeenCalledTimes(3);
  });

  it.each(["user", "profile", "profile-couple", "couple", "journey-couple", "role", "demo"])(
    "invalidates the previous owner lease when %s changes", (field) => {
      const lease = bindCurrent();
      populate(lease);
      const state = actor();
      const updates = {
        user: { user: { ...state.user, id: "actor-b" } },
        profile: { profile: { ...state.profile, id: "actor-b" } },
        "profile-couple": { profile: { ...state.profile, couple_id: "couple-b" } },
        couple: { couple: { ...state.couple, id: "couple-b" } },
        "journey-couple": { journey: { ...state.journey, couple_id: "couple-b" } },
        role: { profile: { ...state.profile, role: "groom" as const } },
        demo: { isDemo: true },
      };
      useAuthStore.setState(updates[field as keyof typeof updates]);
      expect(useChatComposerStore.getState().drafts).toEqual(createEmptyComposerDrafts());
      expect(isChatComposerLeaseCurrent(lease)).toBe(false);
    },
  );

  it("keeps only the private draft when the partner unlinks and fences every old callback", () => {
    const lease = bindCurrent();
    populate(lease);
    const privateDraft = useChatComposerStore.getState().drafts.private_ai;
    useAuthStore.setState({ couple: { ...actor().couple, groom_id: null } });
    const current = useChatComposerStore.getState();
    expect(current.drafts.private_ai).toEqual(privateDraft);
    expect(current.drafts.shared_ai).toEqual(createEmptyComposerDrafts().shared_ai);
    expect(current.drafts.shared_partner).toEqual(createEmptyComposerDrafts().shared_partner);
    expect(isChatComposerLeaseCurrent(lease)).toBe(false);
    expect(revoked.mock.calls.map(([url]) => url).sort()).toEqual(["blob:shared_ai", "blob:shared_partner"]);
    updateChatComposerDrafts(lease, () => createEmptyComposerDrafts());
    expect(useChatComposerStore.getState().drafts.private_ai).toEqual(privateDraft);
    const fresh = bindCurrent();
    updateChatComposerDrafts(fresh, (drafts) => ({ ...drafts, private_ai: { ...drafts.private_ai, input: "새 개인 초안" } }));
    expect(useChatComposerStore.getState().drafts.private_ai.input).toBe("새 개인 초안");
  });

  it("rejects a stale lease updater before executing it against a new owner's draft", () => {
    const old = bindCurrent();
    populate(old);
    useAuthStore.setState(actor("actor-b", "couple-b", "groom"));
    const current = bindCurrent();
    populate(current);
    const before = useChatComposerStore.getState().drafts;
    const staleUpdate = vi.fn(() => createEmptyComposerDrafts());
    updateChatComposerDrafts(old, staleUpdate);
    expect(staleUpdate).not.toHaveBeenCalled();
    expect(useChatComposerStore.getState().drafts).toBe(before);
  });

  it("does not purge drafts for ordinary same-owner profile or journey refreshes", () => {
    const lease = bindCurrent();
    populate(lease);
    const before = useChatComposerStore.getState().drafts;
    useAuthStore.setState({ profile: { ...actor().profile, name: "수정한 이름" }, journey: { ...actor().journey, total_budget: 50_000_000 } });
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });
});
