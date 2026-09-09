// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings/amora-memory" }

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import AmoraMemorySettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT_A = { id: "10000000-0000-4000-8000-000000000001", email: "a@example.com" };
const ACCOUNT_B = { id: "10000000-0000-4000-8000-000000000002", email: "b@example.com" };
const SPACE_A: Couple = {
  id: "30000000-0000-4000-8000-000000000001", bride_id: ACCOUNT_A.id, groom_id: null,
  invite_code: null, membership_sealed_at: null, created_at: "2026-09-01", updated_at: "2026-09-01",
};
const SPACE_B: Couple = { ...SPACE_A, id: "30000000-0000-4000-8000-000000000002" };
const PROFILE_A: Profile = {
  id: ACCOUNT_A.id, name: "테스트", role: "bride", couple_id: SPACE_A.id, avatar_url: null,
  onboarding_completed: true, onboarding_step: 5, is_admin: false,
  created_at: "2026-09-01", updated_at: "2026-09-01",
};

function memoryResponse(marker = "A의 개인 기억") {
  return new Response(JSON.stringify({
    runtimeEnabled: true,
    settings: [
      { visibility: "shared", enabled: false, consentedByMe: false, consentedCount: 0,
        requiredCount: 2, enabledAt: null, memoryResetAt: null, legacyPurgedAt: null,
        pendingPurge: { memories: 1, summaries: 0, profiles: 0, total: 1 } },
      { visibility: "bride_private", enabled: true, consentedByMe: true, consentedCount: 1,
        requiredCount: 1, enabledAt: null, memoryResetAt: null, legacyPurgedAt: "2026-09-01",
        pendingPurge: { memories: 0, summaries: 0, profiles: 0, total: 0 } },
    ],
    memories: [{ id: "20000000-0000-4000-8000-000000000001", visibility: "bride_private",
      memoryKey: "photo:style", kind: "preference", title: marker, value: "자연스러운 사진",
      reasoning: null, confidence: 0.9, userConfirmedAt: null, userCorrected: false,
      sourceMessageId: null, updatedAt: "2026-09-01T00:00:00Z" }],
    profiles: [],
  }), { headers: { "content-type": "application/json" } });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("memory settings scope and account boundaries", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: ReturnType<typeof useAuthStore.getState>;
  let read: () => Promise<Response>;
  let write: () => Promise<Response>;
  let writes: Record<string, unknown>[];
  let reads: number;

  beforeEach(() => {
    originalState = useAuthStore.getState();
    useAuthStore.setState({ user: ACCOUNT_A, profile: null, couple: null, isDemo: false });
    read = async () => memoryResponse();
    write = async () => new Response(JSON.stringify({ success: true }));
    writes = [];
    reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      expect(String(input)).toBe("/api/amora/memory");
      if (options?.method === "PATCH") {
        writes.push(z.record(z.string(), z.unknown()).parse(JSON.parse(String(options.body))));
        return write();
      }
      reads += 1;
      return read();
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    vi.unstubAllGlobals();
    container.remove();
  });

  function findButton(label: string) {
    return [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim() === label || button.getAttribute("aria-label") === label);
  }

  async function click(label: string) {
    const button = findButton(label);
    expect(button, `Missing button: ${label}`).toBeTruthy();
    await act(async () => button!.click());
  }

  async function render() { await act(async () => root.render(<AmoraMemorySettingsPage />)); }

  it("a shared enable confirmation cannot carry into the personal scope", async () => {
    await render();
    await click("내 공유 기억 동의");
    expect(findButton("지우고 켜기")).toBeTruthy();
    expect(writes).toEqual([]);
    await click("나만 상담");
    expect(findButton("지우고 켜기")).toBeUndefined();
    expect(writes).toEqual([]);
    expect(findButton("나만 상담 기억")?.getAttribute("aria-checked")).toBe("true");
  });

  it("confirmed shared activation sends only the selected scope and reloads", async () => {
    await render();
    await click("내 공유 기억 동의");
    await click("지우고 켜기");
    expect(writes).toEqual([{ action: "toggle", visibility: "shared", enabled: true }]);
    expect(reads).toBe(2);
    expect(findButton("지우고 켜기")).toBeUndefined();
  });

  it("an account switch removes old private memory and old consent confirmation", async () => {
    await render();
    await click("나만 상담");
    expect(container.textContent).toContain("A의 개인 기억");
    await click("둘이 함께");
    await click("내 공유 기억 동의");
    const pendingB = deferredResponse();
    read = () => pendingB.promise;
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    expect(findButton("지우고 켜기")).toBeUndefined();
    expect(container.textContent).not.toContain("A의 개인 기억");
    expect(reads).toBe(2);
    await act(async () => pendingB.resolve(memoryResponse("B의 개인 기억")));
    await click("나만 상담");
    expect(container.textContent).toContain("B의 개인 기억");
    expect(container.textContent).not.toContain("A의 개인 기억");
    expect(writes).toEqual([]);
  });

  it("a late read from the previous account cannot replace the current account's memory", async () => {
    const pendingA = deferredResponse();
    read = () => pendingA.promise;
    await render();
    read = async () => memoryResponse("B의 개인 기억");
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    await act(async () => pendingA.resolve(memoryResponse("A의 개인 기억")));
    await click("나만 상담");
    expect(container.textContent).toContain("B의 개인 기억");
    expect(container.textContent).not.toContain("A의 개인 기억");
  });

  it("a pending mutation cannot move its UI confirmation to another scope", async () => {
    const pending = deferredResponse();
    write = () => pending.promise;
    await render();
    await click("내 공유 기억 동의");
    await click("지우고 켜기");
    const privateTab = findButton("나만 상담");
    expect(privateTab?.disabled).toBe(true);
    await click("나만 상담");
    expect(findButton("둘이 함께")?.getAttribute("aria-selected")).toBe("true");
    await act(async () => pending.resolve(new Response(JSON.stringify({ success: true }))));
    expect(writes).toEqual([{ action: "toggle", visibility: "shared", enabled: true }]);
  });

  it("a late mutation response from another account cannot refetch or show an error", async () => {
    const pending = deferredResponse();
    write = () => pending.promise;
    await render();
    await click("내 공유 기억 동의");
    await click("지우고 켜기");
    read = async () => memoryResponse("B의 개인 기억");
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    expect(reads).toBe(2);
    await act(async () => pending.resolve(new Response(JSON.stringify({ error: "A의 지연 실패" }), { status: 503 })));
    expect(reads).toBe(2);
    expect(container.textContent).not.toContain("A의 지연 실패");
    await click("나만 상담");
    expect(container.textContent).toContain("B의 개인 기억");
  });

  it("removes visible private content immediately while the next account is still loading", async () => {
    await render();
    await click("나만 상담");
    expect(container.textContent).toContain("A의 개인 기억");
    const pendingB = deferredResponse();
    read = () => pendingB.promise;
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    expect(container.textContent).not.toContain("A의 개인 기억");
    expect(findButton("기억 고치기")).toBeUndefined();
    expect(findButton("기억 삭제")).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it("clears a reset confirmation when selecting another scope", async () => {
    await render();
    await click("기억 초기화");
    expect(findButton("모두 지우기")).toBeTruthy();
    await click("나만 상담");
    expect(findButton("모두 지우기")).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it.each(["update_memory", "delete_memory", "clear_scope", "toggle"] as const)(
    "preserves the confirmed personal %s action and reloads its result",
    async (action) => {
      await render();
      await click("나만 상담");
      if (action === "update_memory") {
        await click("기억 고치기");
        const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="기억 내용"]');
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "담백한 사진");
          input!.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await click("저장");
      } else if (action === "delete_memory") {
        await click("기억 삭제");
        expect(writes).toEqual([]);
        await click("삭제");
      } else if (action === "clear_scope") {
        await click("기억 초기화");
        expect(writes).toEqual([]);
        await click("모두 지우기");
      } else {
        await click("나만 상담 기억");
      }
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ action, visibility: "bride_private" });
      if (action === "update_memory") expect(writes[0]?.value).toBe("담백한 사진");
      if (action === "toggle") expect(writes[0]?.enabled).toBe(false);
      expect(reads).toBe(2);
    },
  );

  it("hides the old space and reset confirmation while profile and couple disagree", async () => {
    useAuthStore.setState({ profile: PROFILE_A, couple: SPACE_A });
    await render();
    await click("나만 상담");
    await click("기억 초기화");
    expect(container.textContent).toContain("A의 개인 기억");
    expect(findButton("모두 지우기")).toBeTruthy();
    read = async () => memoryResponse("새 준비 공간의 기억");
    await act(async () => useAuthStore.setState({ couple: SPACE_B }));
    expect(container.textContent).not.toContain("A의 개인 기억");
    expect(findButton("모두 지우기")).toBeUndefined();
    expect(reads).toBe(1);
    await act(async () => useAuthStore.setState({ profile: { ...PROFILE_A, couple_id: SPACE_B.id } }));
    expect(reads).toBe(2);
    await click("나만 상담");
    expect(container.textContent).toContain("새 준비 공간의 기억");
    expect(writes).toEqual([]);
  });

  it("ignores a delayed old-space read during the same account's transition", async () => {
    useAuthStore.setState({ profile: PROFILE_A, couple: SPACE_A });
    const oldRead = deferredResponse();
    read = () => oldRead.promise;
    await render();
    await act(async () => useAuthStore.setState({ couple: SPACE_B }));
    await act(async () => oldRead.resolve(memoryResponse("이전 준비 공간의 기억")));
    expect(findButton("나만 상담")).toBeUndefined();
    expect(container.textContent).not.toContain("이전 준비 공간의 기억");
    read = async () => memoryResponse("새 준비 공간의 기억");
    await act(async () => useAuthStore.setState({ profile: { ...PROFILE_A, couple_id: SPACE_B.id } }));
    await click("나만 상담");
    expect(container.textContent).toContain("새 준비 공간의 기억");
    expect(writes).toEqual([]);
  });

  it("discards an enable confirmation when the same couple gains a partner", async () => {
    useAuthStore.setState({ profile: PROFILE_A, couple: SPACE_A });
    await render();
    await click("내 공유 기억 동의");
    expect(findButton("지우고 켜기")).toBeTruthy();
    const nextRead = deferredResponse();
    read = () => nextRead.promise;
    await act(async () => useAuthStore.setState({ couple: { ...SPACE_A, groom_id: ACCOUNT_B.id } }));
    expect(findButton("지우고 켜기")).toBeUndefined();
    expect(reads).toBe(2);
    await act(async () => nextRead.resolve(memoryResponse()));
    expect(findButton("지우고 켜기")).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it("ignores an old roster's read after its replacement has loaded", async () => {
    useAuthStore.setState({ profile: PROFILE_A, couple: SPACE_A });
    const oldRead = deferredResponse();
    read = () => oldRead.promise;
    await render();
    read = async () => memoryResponse("현재 구성원의 기억");
    await act(async () => useAuthStore.setState({ couple: { ...SPACE_A, groom_id: ACCOUNT_B.id } }));
    await act(async () => oldRead.resolve(memoryResponse("이전 구성원의 기억")));
    await click("나만 상담");
    expect(container.textContent).toContain("현재 구성원의 기억");
    expect(container.textContent).not.toContain("이전 구성원의 기억");
  });

  it("keeps the newest same-owner read when StrictMode requests overlap", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    read = () => reads === 1 ? first.promise : second.promise;
    await act(async () => root.render(<StrictMode><AmoraMemorySettingsPage /></StrictMode>));
    expect(reads).toBe(2);
    await act(async () => second.resolve(memoryResponse("최신 조회 기억")));
    await click("나만 상담");
    await act(async () => first.resolve(memoryResponse("오래된 조회 기억")));
    expect(container.textContent).toContain("최신 조회 기억");
    expect(container.textContent).not.toContain("오래된 조회 기억");
  });

  it("preserves an edit when only the same owner's display name or update time changes", async () => {
    useAuthStore.setState({ profile: PROFILE_A, couple: SPACE_A });
    await render();
    await click("나만 상담");
    await click("기억 고치기");
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="기억 내용"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "직접 고친 사진 취향");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      useAuthStore.setState({
        profile: { ...PROFILE_A, name: "바뀐 표시 이름" },
        couple: { ...SPACE_A, updated_at: "2026-09-10" },
      });
    });
    expect(reads).toBe(1);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="기억 내용"]')?.value)
      .toBe("직접 고친 사진 취향");
    await click("저장");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      action: "update_memory", visibility: "bride_private", value: "직접 고친 사진 취향",
    });
    expect(reads).toBe(2);
  });
});
