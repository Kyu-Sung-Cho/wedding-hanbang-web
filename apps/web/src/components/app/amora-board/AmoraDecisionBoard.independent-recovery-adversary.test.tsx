import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listeners: new Set<() => void>(), auth: {
  user: { id: "11111111-1111-4111-8111-111111111111" },
  profile: { id: "11111111-1111-4111-8111-111111111111", couple_id: "22222222-2222-4222-8222-222222222222" },
  couple: null, isDemo: false, isInitialized: true, journey: { progress: {} },
} }));
vi.mock("@/stores/authStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: (next: typeof mocks.auth) => void) => {
    const notify = () => listener(mocks.auth); mocks.listeners.add(notify);
    return () => { mocks.listeners.delete(notify); };
  };
  return { useAuthStore: Object.assign(
    (selector: (state: typeof mocks.auth) => unknown) => useSyncExternalStore(subscribe, () => selector(mocks.auth)),
    { getState: () => mocks.auth, subscribe },
  ) };
});
import AmoraDecisionBoard from "./AmoraDecisionBoard";
import { useAmoraPreparationActions } from "@/hooks/useAmoraPreparationActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const version = "2026-10-12T00:00:00.123456Z";
const nextVersion = "2026-10-12T00:00:00.123457Z";
const action = { id: "act_independent_recovery", title: "식사 포함 범위 확인", description: "처음 메모", categoryKey: "venue",
  status: "open", source: "manual", priority: "medium", createdAt: "2026-10-01T00:00:00Z", updatedAt: version, viewVersion: version };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const snapshot = (actions: unknown[]) => response({ actions, count: actions.length, open_count: actions.length });
let latestHook: ReturnType<typeof useAmoraPreparationActions>;
function ActionHookHarness() {
  const result = useAmoraPreparationActions();
  useEffect(() => { latestHook = result; }, [result]);
  return null;
}

describe("independent shared action recovery adversary", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/wedding/chat/board?view=tasks");
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });
  const button = (name: string) => {
    const control = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(node => node.getAttribute("aria-label") === name || node.textContent === name);
    expect(control, name).toBeDefined(); return control!;
  };
  const click = (name: string) => act(async () => { const control = button(name); control.focus(); control.click(); });
  const fillTitle = (value: string) => act(async () => {
    const input = container.querySelector<HTMLInputElement>("[data-action-edit-title]")!;
    input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("recovers an explicitly reviewed current authority when a stale list row has no view token", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action]));
    await act(async () => root.render(<AmoraDecisionBoard />));
    await click(`${action.title} 수정`); await fillTitle("남겨 둘 수정 초안");
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, viewVersion: null }]));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(button("수정 저장").disabled).toBe(true);
    const current = { ...action, title: "다시 확인한 현재 기록", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await click("현재 기록 다시 확인");
    expect(button("수정 저장").disabled).toBe(true);
    await click("현재 내용 기준으로 초안 다시 확인");
    expect(container.querySelector<HTMLInputElement>("[data-action-edit-title]")?.value).toBe("남겨 둘 수정 초안");
    expect(button("수정 저장").disabled).toBe(false);
    const finalVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...current, title: "남겨 둘 수정 초안", updatedAt: finalVersion, viewVersion: finalVersion } }));
    await click("수정 저장");
    const patches = fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body).expectedUpdatedAt).toBe(nextVersion);
  });

  it.each([
    { ...action, viewVersion: null },
    { ...action, viewVersion: "not-a-timestamp" },
    { ...action, id: "act_other_record", updatedAt: nextVersion, viewVersion: nextVersion },
    { ...action, updatedAt: nextVersion, viewVersion: version },
  ])("does not turn an unconfirmed single-read result into edit authority (%j)", async current => {
    fetchMock.mockResolvedValueOnce(snapshot([action]));
    await act(async () => root.render(<AmoraDecisionBoard />));
    await click(`${action.title} 수정`); await fillTitle("보존해야 하는 초안");
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, viewVersion: null }]));
    await act(async () => window.dispatchEvent(new Event("focus")));
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await click("현재 기록 다시 확인");
    expect(button("현재 내용 기준으로 초안 다시 확인").disabled).toBe(true);
    expect(button("수정 저장").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[data-action-edit-title]")?.value).toBe("보존해야 하는 초안");
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("accepts only the same-owner single-read raw token when the loaded token is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, viewVersion: null }]));
    await act(async () => root.render(<ActionHookHarness />));
    const current = { ...action, updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await act(async () => { expect(await latestHook.inspectUpdate(action.id)).toBe(true); });
    const finalVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...current, title: "재확인 후 수정", updatedAt: finalVersion, viewVersion: finalVersion } }));
    await act(async () => {
      expect(await latestHook.update(action.id, { title: "재확인 후 수정" }, {
        version: nextVersion, ownerScope: latestHook.ownerScope,
      })).toBe(true);
    });
    const patches = fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body).expectedUpdatedAt).toBe(nextVersion);
  });

  it("does not use another raw token merely because some single-read authority exists", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, viewVersion: null }]));
    await act(async () => root.render(<ActionHookHarness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, updatedAt: nextVersion, viewVersion: nextVersion } }));
    await act(async () => { expect(await latestHook.inspectUpdate(action.id)).toBe(true); });
    await act(async () => {
      expect(await latestHook.update(action.id, { title: "이전 버전으로 보내면 안 됨" }, {
        version, ownerScope: latestHook.ownerScope,
      })).toBe(false);
    });
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });
});
