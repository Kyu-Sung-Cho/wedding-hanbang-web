// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let A = "10000000-0000-4000-8000-000000000001";
let B = "10000000-0000-4000-8000-000000000002";
let actorSequence = 0;
const C1 = "20000000-0000-4000-8000-000000000001";
const C2 = "20000000-0000-4000-8000-000000000002";
let AWAITING_COUPLE: Couple = { id: C1, bride_id: A, groom_id: null, invite_code: null,
  membership_sealed_at: null, created_at: "2026-09-20", updated_at: "2026-09-20" };
function profile(id: string): Profile {
  return { id, name: `name-${id}`, role: "bride", couple_id: null, avatar_url: null,
    onboarding_completed: true, onboarding_step: 9, is_admin: false,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z" };
}
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
describe("settings name save identity boundary", () => {
  let original: ReturnType<typeof useAuthStore.getState>;
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let resolveSave: (response: Response) => void;
  beforeEach(() => {
    // Unknown writes intentionally survive a store reset. Independent examples are
    // different actors; clearing the production lease registry would weaken that guard.
    const suffix = String(++actorSequence).padStart(12, "0");
    A = `11000000-0000-4000-8000-${suffix}`;
    B = `12000000-0000-4000-8000-${suffix}`;
    AWAITING_COUPLE = { ...AWAITING_COUPLE, bride_id: A };
    original = useAuthStore.getState();
    useAuthStore.setState({ user: { id: A, email: "a@example.invalid" }, profile: profile(A), couple: null, partner: null, journey: null, isDemo: false });
    const pending = new Promise<Response>(resolve => { resolveSave = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") return json({ user: useAuthStore.getState().user, capabilities: { accountDeletionIntake: false } });
      if (String(input) === "/api/profile" && init?.method === "PATCH") return pending;
      if (String(input) === "/api/couple/reset" && !init?.method) return json({ confirmationTarget: { ownerId: A, coupleId: C1, privacyEpoch: 7 } });
      if (String(input) === "/api/couple/reset" && init?.method === "POST") return new Response(JSON.stringify({ error: "재확인해주세요" }), { status: 409 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container); mounted = true;
  });
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    useAuthStore.setState(original); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it.each(["B", "signed-out-A"])("rejects an old care-consent button before repaint after transition to %s", async destination => {
    const consentingProfile = { ...profile(A), care_notifications_enabled: true, care_notifications_consented_at: "2026-09-19T00:00:00Z" };
    useAuthStore.setState({ profile: consentingProfile });
    await act(async () => root.render(<SettingsPage />));
    const oldButton = [...container.querySelectorAll("button")].find(button => button.textContent === "이메일 수신 동의 해제")!;
    expect(oldButton).toBeTruthy();
    await act(async () => {
      if (destination === "B") useAuthStore.setState({ user: { id: B, email: "b@example.invalid" }, profile: { ...consentingProfile, id: B } });
      else {
        useAuthStore.getState().reset();
        useAuthStore.setState({ user: { id: A, email: "a@example.invalid" }, profile: consentingProfile, isDemo: false });
      }
      oldButton.click();
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/profile" && init?.method === "PATCH")).toHaveLength(0);
    expect(useAuthStore.getState().profile?.care_notifications_enabled).toBe(true);
  });
  it("revokes consent normally only after the same owner's confirmed profile receipt", async () => {
    useAuthStore.setState({ profile: { ...profile(A), care_notifications_enabled: true, care_notifications_consented_at: "2026-09-19T00:00:00Z" } });
    await act(async () => root.render(<SettingsPage />));
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "이메일 수신 동의 해제")!;
    await act(async () => button.click());
    expect(useAuthStore.getState().profile?.care_notifications_enabled).toBe(true);
    const writes = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/profile" && init?.method === "PATCH");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ care_notifications_enabled: false, expectedOwnerId: A });
    await act(async () => resolveSave(json({ profile: { ...profile(A), care_notifications_enabled: false, care_notifications_consented_at: null } })));
    expect(useAuthStore.getState().profile?.care_notifications_enabled).toBe(false);
    expect(container.textContent).not.toContain("이메일 수신 동의 해제");
  });
  it("ignores a late old-owner consent receipt after the new settings page mounts", async () => {
    const consent = { care_notifications_enabled: true, care_notifications_consented_at: "2026-09-19T00:00:00Z" };
    useAuthStore.setState({ profile: { ...profile(A), ...consent } });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === "이메일 수신 동의 해제")!.click());
    await act(async () => useAuthStore.setState({ user: { id: B, email: "b@example.invalid" }, profile: { ...profile(B), ...consent } }));
    await act(async () => resolveSave(json({ profile: { ...profile(A), care_notifications_enabled: false, care_notifications_consented_at: null } })));
    expect(useAuthStore.getState().profile?.care_notifications_enabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "이메일 수신 동의 해제")?.disabled).toBe(false);
  });
  async function startSave() {
    await act(async () => root.render(<SettingsPage />));
    const edit = container.querySelector("h2")?.parentElement?.querySelector("button"); expect(edit).toBeTruthy();
    await act(async () => edit!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="text"]'); expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "새 이름");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  }
  it("keeps account B's profile when an unmounted account A name save finishes", async () => {
    await startSave();
    await act(async () => root.unmount()); mounted = false;
    useAuthStore.setState({ user: { id: B, email: "b@example.invalid" }, profile: profile(B) });
    await act(async () => resolveSave(json({ profile: { ...profile(A), name: "새 이름" } })));
    expect(useAuthStore.getState().user?.id).toBe(B);
    expect(useAuthStore.getState().profile).toEqual(profile(B));
  });
  it("applies a confirmed name save while its account binding is unchanged", async () => {
    await startSave();
    await act(async () => resolveSave(json({ profile: { ...profile(A), name: "새 이름" } })));
    expect(useAuthStore.getState().profile?.name).toBe("새 이름");
    expect(container.querySelector("h2")?.textContent).toBe("새 이름");
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });
  it("does not reuse an old save after account A signs out and signs in again", async () => {
    await startSave();
    await act(async () => {
      useAuthStore.getState().reset();
      useAuthStore.setState({ user: { id: A, email: "a@example.invalid" }, profile: { ...profile(A), name: "새 세션 이름" } });
    });
    await act(async () => resolveSave(json({ profile: { ...profile(A), name: "지난 세션 이름" } })));
    expect(useAuthStore.getState().profile?.name).toBe("새 세션 이름");
  });
  it("discards an already typed reset confirmation when its couple changes", async () => {
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 } });
    await act(async () => root.render(<SettingsPage />));
    const open = [...container.querySelectorAll("button")].find(b => b.textContent?.includes("새 커플로 다시 시작"));
    await act(async () => open!.click());
    const input = container.querySelector<HTMLInputElement>('input[placeholder="초기화합니다"]'); expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "초기화합니다");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => useAuthStore.setState({ profile: { ...profile(A), couple_id: C2 } }));
    const confirm = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "다시 시작");
    // AnimatePresence may retain the outgoing button briefly. It must have no authority.
    if (confirm) await act(async () => confirm.click());
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/couple/reset" && init?.method === "POST")).toHaveLength(0);
  });
  it("sends the server-read target only after the user confirms that same context", async () => {
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 } });
    await act(async () => root.render(<SettingsPage />));
    const open = [...container.querySelectorAll("button")].find(b => b.textContent?.includes("새 커플로 다시 시작"));
    await act(async () => open!.click());
    const input = container.querySelector<HTMLInputElement>('input[placeholder="초기화합니다"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "초기화합니다");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "다시 시작")!.click());
    const writes = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/couple/reset" && init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ confirmText: "초기화합니다", confirmationTarget: { ownerId: A, coupleId: C1, privacyEpoch: 7 } });
  });
  it("revokes the outgoing reset confirmation immediately when cancelled", async () => {
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 } });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.includes("새 커플로 다시 시작"))!.click());
    const input = container.querySelector<HTMLInputElement>('input[placeholder="초기화합니다"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "초기화합니다");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "다시 시작")!;
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "취소")!.click());
    await act(async () => confirm.click());
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/couple/reset" && init?.method === "POST")).toHaveLength(0);
  });
  it("allows a fresh confirmation after a pending reset's owner context is invalidated", async () => {
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/reset" && init?.method === "POST") return new Promise<Response>(() => {});
      if (String(url) === "/api/couple/reset") return json({ confirmationTarget: { ownerId: A, coupleId: useAuthStore.getState().profile?.couple_id, privacyEpoch: 7 } });
      return fallback(url, init);
    });
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 } });
    await act(async () => root.render(<SettingsPage />));
    const openAndType = async () => {
      await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.includes("새 커플로 다시 시작"))!.click());
      const input = container.querySelector<HTMLInputElement>('input[placeholder="초기화합니다"]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "초기화합니다");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await openAndType();
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "다시 시작")!.click());
    await act(async () => useAuthStore.setState({ profile: { ...profile(A), couple_id: C2 } }));
    await openAndType();
    expect([...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "다시 시작")?.disabled).toBe(false);
  });
  it("leaves a stalled invite fetch after ten seconds, retries, and ignores its late code", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    useAuthStore.setState({ couple: AWAITING_COUPLE, profile: { ...profile(A), couple_id: C1 } });
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveOld = resolve; });
    const requests: RequestInit[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) !== "/api/couple/code") return fallback(url, init);
      requests.push(init ?? {});
      return requests.length === 1 ? pending : json({ inviteCode: "WH-A3F91B2C7D40", isFullyLinked: false, isMembershipSealed: false });
    });
    await act(async () => root.render(<SettingsPage />));
    expect(container.textContent).toContain("연결 상태를 불러오는 중이에요");
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(container.textContent).toContain("연결 상태를 불러오지 못했어요");
    expect(requests[0].signal?.aborted).toBe(true);
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "다시 시도")!.click());
    expect(container.textContent).toContain("WH-A3F91B2C7D40");
    await act(async () => resolveOld(json({ inviteCode: "WH-B3F91B2C7D40", isFullyLinked: false, isMembershipSealed: false })));
    expect(container.textContent).not.toContain("WH-B3F91B2C7D40");
    expect(container.textContent).toContain("WH-A3F91B2C7D40");
  });
  it("uses one ten-second invite deadline across headers and a stalled JSON body", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    useAuthStore.setState({ couple: AWAITING_COUPLE, profile: { ...profile(A), couple_id: C1 } });
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    let resolveHeaders!: (response: Response) => void;
    let resolveBody!: (value: unknown) => void;
    const headers = new Promise<Response>(resolve => { resolveHeaders = resolve; });
    const body = new Promise<unknown>(resolve => { resolveBody = resolve; });
    const response = json({});
    vi.spyOn(response, "json").mockReturnValue(body);
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) !== "/api/couple/code") return fallback(url, init);
      signal = init?.signal;
      return headers;
    });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await act(async () => resolveHeaders(response));
    await act(async () => vi.advanceTimersByTimeAsync(4_001));
    expect(container.textContent).toContain("연결 상태를 불러오지 못했어요");
    expect(signal?.aborted).toBe(true);
    await act(async () => resolveBody({ inviteCode: "WH-B3F91B2C7D40", isFullyLinked: false, isMembershipSealed: false }));
    expect(container.textContent).not.toContain("WH-B3F91B2C7D40");
    expect(container.textContent).toContain("연결 상태를 불러오지 못했어요");
  });
  it("aborts an old invite lookup on couple change and unmount without reviving it", async () => {
    useAuthStore.setState({ couple: AWAITING_COUPLE, profile: { ...profile(A), couple_id: C1 } });
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    const signals: (AbortSignal | null | undefined)[] = [];
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) !== "/api/couple/code") return fallback(url, init);
      signals.push(init?.signal);
      return pending;
    });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => useAuthStore.setState({ couple: { ...AWAITING_COUPLE, id: C2 }, profile: { ...profile(A), couple_id: C2 } }));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => root.unmount()); mounted = false;
    expect(signals[1]?.aborted).toBe(true);
    await act(async () => resolveOld(json({ inviteCode: "WH-B3F91B2C7D40", isFullyLinked: false, isMembershipSealed: false })));
    expect(container.textContent).toBe("");
  });
  it("does not claim consent revocation failed or expose raw errors when its result is unknown", async () => {
    useAuthStore.setState({ profile: { ...profile(A), care_notifications_enabled: true, care_notifications_consented_at: "2026-09-20T00:00:00Z" } });
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/profile" && init?.method === "PATCH") throw new Error("RAW_PRIVATE_NETWORK_FAILURE");
      return fallback(url, init);
    });
    await act(async () => root.render(<SettingsPage />));
    const revoke = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "이메일 수신 동의 해제")!;
    await act(async () => revoke.click());
    const alert = revoke.parentElement?.querySelector('[role="alert"]')?.textContent;
    expect(alert).toMatch(/결과를.*확인/);
    expect(alert).not.toContain("해제하지 못했습니다");
    expect(alert).not.toContain("RAW_PRIVATE_NETWORK_FAILURE");
  });
  it("keeps the name draft and shows the safe pending-result guidance after its deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await startSave();
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    expect(container.textContent).toContain("확인 전에는 추가 저장하지 않아요");
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("새 이름");
    expect(useAuthStore.getState().profile?.name).toBe(profile(A).name);
  });
  it("shows the current saved name separately from the editable draft with named controls", async () => {
    await act(async () => root.render(<SettingsPage />));
    const edit = container.querySelector("h2")?.parentElement?.querySelector("button");
    await act(async () => edit!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "계속 검토할 초안");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      useAuthStore.setState({ profile: { ...profile(A), name: "서버에서 확인한 이름" } });
    });
    expect(container.textContent).toContain("현재 저장된 이름: 서버에서 확인한 이름");
    expect(input.value).toBe("계속 검토할 초안");
    expect(input.getAttribute("aria-label")).toBe("이름");
    expect(container.querySelector('button[aria-label="이름 저장"]')).toBeTruthy();
    const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="이름 수정 취소"]');
    expect(cancel).toBeTruthy();
    await act(async () => useAuthStore.setState({ profile: { ...profile(A), name: "" } }));
    expect(container.textContent).toContain("현재 저장된 이름: 미등록");
    expect(input.value).toBe("계속 검토할 초안");
    await act(async () => cancel!.click());
    expect(container.querySelector('button[aria-label="이름 수정"]')).toBeTruthy();
  });
  it("discards an unsent name draft when the settings owner changes", async () => {
    await act(async () => root.render(<SettingsPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="이름 수정"]')!.click());
    const oldInput = container.querySelector<HTMLInputElement>('input[aria-label="이름"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(oldInput, "이전 계정의 미전송 초안");
      oldInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => useAuthStore.setState({ user: { id: B, email: "b@example.invalid" }, profile: profile(B) }));
    expect(container.querySelector('input[aria-label="이름"]')).toBeNull();
    await act(async () => oldInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/profile" && init?.method === "PATCH")).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="이름 수정"]')!.click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="이름"]')?.value).toBe(profile(B).name);
  });
  it("keeps a personal name draft when a partner joins the same preparation space", async () => {
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 }, couple: AWAITING_COUPLE });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="이름 수정"]')!.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="이름"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "검토 중인 내 이름");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => useAuthStore.setState({ couple: { ...AWAITING_COUPLE, groom_id: B } }));
    expect(container.querySelector<HTMLInputElement>('input[aria-label="이름"]')?.value).toBe("검토 중인 내 이름");
  });
  it("invalidates destructive confirmation when the same couple's membership changes", async () => {
    useAuthStore.setState({ profile: { ...profile(A), couple_id: C1 }, couple: AWAITING_COUPLE });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.includes("새 커플로 다시 시작"))!.click());
    const input = container.querySelector<HTMLInputElement>('input[placeholder="초기화합니다"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "초기화합니다");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "다시 시작")!;
    expect(confirm.disabled).toBe(false);
    await act(async () => useAuthStore.setState({ couple: { ...AWAITING_COUPLE, groom_id: B } }));
    // 닫기 애니메이션이 옛 DOM을 잠깐 유지해도 이전 콜백에는 전송 권한이 없다.
    await act(async () => confirm.click());
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/couple/reset" && init?.method === "POST")).toHaveLength(0);
  });
  it("rejects the old name callback during a batched A → B → A transition before repaint", async () => {
    await act(async () => root.render(<SettingsPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="이름 수정"]')!.click());
    const oldInput = container.querySelector<HTMLInputElement>('input[aria-label="이름"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(oldInput, "이전 세션의 초안");
      oldInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const oldSave = container.querySelector<HTMLButtonElement>('button[aria-label="이름 저장"]')!;
    await act(async () => {
      useAuthStore.setState({ user: { id: B, email: "b@example.invalid" }, profile: profile(B) });
      useAuthStore.setState({ user: { id: A, email: "a@example.invalid" }, profile: profile(A) });
      oldSave.click();
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/profile" && init?.method === "PATCH")).toHaveLength(0);
    expect(container.querySelector('input[aria-label="이름"]')).toBeNull();
  });
  it.each([
    { card: "결혼 예정일", input: "결혼 예정일", draft: "2027-10-10", next: "2028-11-11" },
    { card: "설정 예산", input: "설정 예산 (만원)", draft: "5500", next: "1200" },
    { card: "결혼식장", input: "결혼식장", draft: "이전 커플 장소", next: "새 커플 장소" },
  ])("keeps an ordinary $card draft but discards it on relink before a queued save", async ({ card, input: inputLabel, draft, next }) => {
    const initialJourney = { id: C1, couple_id: C1, wedding_date: null, venue: null, total_budget: 10000000, progress: {}, state_revision: 0, created_at: "2026-09-20", updated_at: "2026-09-20" };
    useAuthStore.setState({ couple: AWAITING_COUPLE, profile: { ...profile(A), couple_id: C1 }, journey: initialJourney });
    await act(async () => root.render(<SettingsPage />));
    const edit = container.querySelector<HTMLButtonElement>(`button[aria-label="${card} 수정"]`);
    expect(edit).toBeTruthy();
    await act(async () => edit!.click());
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, draft);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => useAuthStore.setState({ profile: { ...profile(A), couple_id: C1, name: "같은 계정의 새 정본" }, journey: { ...initialJourney, state_revision: 1 } }));
    expect(container.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`)?.value).toBe(draft);
    const save = container.querySelector<HTMLButtonElement>(`button[aria-label="${card} 저장"]`)!;
    await act(async () => {
      useAuthStore.setState({ couple: { ...AWAITING_COUPLE, id: C2 }, profile: { ...profile(A), couple_id: C2 },
        journey: { ...initialJourney, id: C2, couple_id: C2, wedding_date: "2028-11-11", venue: "새 커플 장소", total_budget: 12000000 } });
      save.click();
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/journey" && init?.method === "PATCH")).toHaveLength(0);
    expect(container.querySelector(`input[aria-label="${inputLabel}"]`)).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${card} 수정"]`)!.click());
    expect(container.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`)?.value).toBe(next);
    expect(container.querySelector(`button[aria-label="${card} 수정 취소"]`)).toBeTruthy();
  });
});
