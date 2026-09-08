import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalAction } from "@hanbang/shared/amora-personal-actions";

vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  return { useAuthStore: create(() => ({ user: null, profile: null, isInitialized: true, isDemo: false })) };
});

import { useAuthStore } from "@/stores/authStore";
import { useAmoraPersonalActions } from "@/hooks/useAmoraPersonalActions";
import PersonalActionSaveButton from "@/components/app/chat/PersonalActionSaveButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const couple = "55555555-5555-4555-8555-555555555555";
const draft = { title: "내가 확인한 기준", description: "나만 볼 메모", dueDate: "2026-09-12" };
const action: PersonalAction = { id, ownerUserId: owner, sourceMessageId: source, ...draft, status: "open", revision: 1,
  createdAt: "2026-09-08T09:00:00Z", updatedAt: "2026-09-08T09:00:00Z" };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const page = (actions: PersonalAction[]) => response({ actions, count: actions.length, next_cursor: null });

function identity(user: string) {
  useAuthStore.setState({ user: { id: user } as never, profile: { id: user, couple_id: couple } as never });
}
function untilAborted<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(node => node.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
let latest: ReturnType<typeof useAmoraPersonalActions>;
function Harness() {
  const data = useAmoraPersonalActions();
  useEffect(() => { latest = data; }, [data]);
  return <div>{data.actions.map(item => item.title).join("|")}{data.error}{data.writeError}</div>;
}

describe("personal action stalled-response recovery", () => {
  let host: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useFakeTimers();
    identity(owner);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases a stalled save without claiming failure, keeps reviewed fields, and reuses its request ID", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_input, init) => {
      signal = init!.signal!;
      return untilAborted<Response>(signal);
    });
    await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="나만 상담 답변" personalActionDraft={draft} />));
    await click("개인 할 일로 저장");
    expect(fetchMock).not.toHaveBeenCalled();
    await click("개인 할 일 저장");
    expect(document.querySelector<HTMLButtonElement>("[aria-label='확인 창 닫기']")!.disabled).toBe(true);
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(signal!.aborted).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("[data-amora-confirm]")!.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("[aria-label='확인 창 닫기']")!.disabled).toBe(false);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("처리 결과를 확인하지 못");
    expect(document.body.textContent).not.toContain("저장되지 않았");
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(draft.title);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(draft.description);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(response({ saved: true, action }));
    await click("개인 할 일 저장");
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).requestId).toBe(firstRequest.requestId);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(host.textContent).toContain("개인 할 일을 저장했어요");
  });

  it("bounds an unfinished JSON body and keeps existing rows available for a later read", async () => {
    fetchMock.mockResolvedValueOnce(page([action]));
    await act(async () => root.render(<Harness />));
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(async (_input, init) => {
      signal = init!.signal!;
      const headersArrived = response({});
      vi.spyOn(headersArrived, "json").mockImplementation(() => untilAborted(signal!));
      return headersArrived;
    });
    let pending!: Promise<void>;
    await act(async () => { pending = latest.load(); });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(latest.loading).toBe(false);
    expect(latest.actions).toEqual([action]);
    expect(latest.error).toContain("불러오지 못");
    await pending;
    fetchMock.mockResolvedValueOnce(page([action]));
    await act(async () => latest.load());
    expect(latest.error).toBeNull();
  });

  it("re-reads a server-committed save whose response was lost, without automatically replaying the write", async () => {
    let committed = false;
    fetchMock.mockImplementation((_input, init) => {
      if (init!.method === "POST") {
        committed = true;
        return untilAborted<Response>(init!.signal!);
      }
      return Promise.resolve(page(committed ? [action] : []));
    });
    await act(async () => root.render(<Harness />));
    let pending!: ReturnType<typeof latest.save>;
    await act(async () => { pending = latest.save(source, couple, draft, id); });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(latest.busyIds).toEqual([]);
    expect(await pending).toBeNull();
    expect(latest.actions).toEqual([action]);
    expect(latest.count).toBe(1);
    expect(latest.writeError).toContain("처리 결과를 확인하지 못");
    expect(fetchMock.mock.calls.filter(([, init]) => init!.method === "POST")).toHaveLength(1);
  });

  it("clears deadlines after successful reads and writes instead of aborting completed requests later", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_input, init) => {
      signals.push(init!.signal!);
      return Promise.resolve(init!.method === "POST" ? response({ saved: true, action }) : page([action]));
    });
    await act(async () => root.render(<Harness />));
    await act(async () => { expect(await latest.save(source, couple, draft, id)).toEqual(action); });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    expect(latest.actions).toEqual([action]);
    expect(latest.writeError).toBeNull();
  });

  it("clears a pending deadline on account change and never exposes the previous owner's result", async () => {
    fetchMock.mockImplementation((_input, init) => untilAborted<Response>(init!.signal!));
    await act(async () => root.render(<Harness />));
    let pending!: ReturnType<typeof latest.save>;
    await act(async () => { pending = latest.save(source, couple, draft, id); });
    fetchMock.mockResolvedValue(page([]));
    await act(async () => { identity(other); identity(owner); });
    expect(await pending).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(latest.actions).toEqual([]);
    expect(latest.busyIds).toEqual([]);
    expect(latest.writeError).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
