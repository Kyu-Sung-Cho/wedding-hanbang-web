import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAmoraTextDraftRecovery } from "./useAmoraTextDraftRecovery";
import { useAuthStore } from "@/stores/authStore";
import type { Profile, Couple, WeddingJourney } from "@/types/database.types";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const stamp = "2026-10-12T01:00:00Z";
const profile: Profile = { id: "actor", name: "Synthetic", role: "bride", couple_id: "couple", avatar_url: null,
  confirmed_role: null, confirmed_role_revision: null, onboarding_completed: true, onboarding_step: 5,
  is_admin: false, created_at: stamp, updated_at: stamp };
const couple: Couple = { id: "couple", invite_code: null, bride_id: "actor", groom_id: "partner",
  membership_sealed_at: stamp, created_at: stamp, updated_at: stamp };
const journey: WeddingJourney = { id: "journey", couple_id: "couple", wedding_date: null, venue: null,
  total_budget: 0, progress: {}, state_revision: 1, created_at: stamp, updated_at: stamp };
type Surface = "conversation" | "panel";

function Harness({ surface }: { surface: Surface }) {
  const auth = useAuthStore();
  const owner = auth.profile?.id && auth.couple?.id && auth.profile.role
    ? `${auth.profile.id}:${auth.couple.id}:${auth.profile.role}` : null;
  const empty = () => ({ input: "", attachments: [], retryClientRequestId: null });
  const [drafts, setDrafts] = useState({ shared_ai: empty(), shared_partner: empty(), private_ai: empty() });
  useAmoraTextDraftRecovery({ surface, owner, partnerId: "partner", enabled: true, drafts, setDrafts });
  return <textarea aria-label="draft" value={drafts.private_ai.input}
    onChange={event => setDrafts(current => ({ ...current, private_ai: { ...current.private_ai, input: event.target.value } }))} />;
}

describe("verified same-owner journey recovery keeps the draft writer live", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    useAuthStore.getState().reset();
    useAuthStore.setState({ user: { id: "actor", email: "synthetic@example.invalid" }, profile, couple,
      journey, isInitialized: true, isLoading: false, isDemo: false });
    sessionStorage.clear();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  });
  const type = async (input: string) => act(async () => {
    const area = host.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, input);
    area?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const refresh = async (next: WeddingJourney | null) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      user: { id: "actor" }, profile, couple, partner: null, journey: next,
    }) }));
    await act(async () => { expect(await useAuthStore.getState().refreshJourney("actor")).toBe(true); });
  };
  it.each(["conversation", "panel"] as const)("restores newly written text after a transient journey lookup in %s", async surface => {
    await act(async () => root.render(<Harness surface={surface} />));
    await type("조회 전 미전송 글");
    await refresh(null);
    await type("조회 장애 중 미전송 글");
    expect(sessionStorage.getItem(`hanbang:amora-text-drafts:v1:${surface}`)).toContain("조회 장애 중 미전송 글");
    await refresh(journey);
    await type("조회 회복 후 새 미전송 글");
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<Harness surface={surface} />));
    expect(host.querySelector("textarea")?.value).toBe("조회 회복 후 새 미전송 글");
  });

  it("a mismatched journey cannot keep an old same-owner writer alive", async () => {
    await act(async () => root.render(<Harness surface="conversation" />));
    await type("이전 범위의 미전송 글");
    await act(async () => {
      useAuthStore.setState({ journey: { ...journey, couple_id: "different-couple" } });
      window.dispatchEvent(new Event("pagehide"));
    });
    await type("이전 writer가 새로 쓰려는 글");
    expect(sessionStorage.getItem("hanbang:amora-text-drafts:v1:conversation")).toBeNull();
    await act(async () => useAuthStore.setState({ journey }));
    await type("원래 준비 정보로 돌아온 이전 writer의 글");
    expect(sessionStorage.getItem("hanbang:amora-text-drafts:v1:conversation")).toBeNull();
  });

  it("logout still closes the writer before React cleans up the pagehide listener", async () => {
    await act(async () => root.render(<Harness surface="panel" />));
    await type("로그아웃 전 미전송 글");
    await act(async () => {
      useAuthStore.getState().reset();
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sessionStorage.getItem("hanbang:amora-text-drafts:v1:panel")).toBeNull();
  });
});
