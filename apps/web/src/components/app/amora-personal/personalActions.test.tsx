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
import AmoraPersonalActions from "./AmoraPersonalActions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const couple = "55555555-5555-4555-8555-555555555555";
const draft = { title: "혼자 정할 기준", description: null, dueDate: null };
const action = (patch: Partial<PersonalAction> = {}): PersonalAction => ({ id, ownerUserId: owner, sourceMessageId: source, ...draft, status: "open", revision: 1, createdAt: "2026-09-06T15:00:00Z", updatedAt: "2026-09-06T15:00:00Z", ...patch });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (actions: PersonalAction[] = [], next_cursor: string | null = null, count = actions.length) => response({ actions, next_cursor, count });
function identity(user: string | null) { useAuthStore.setState({ user: user ? { id: user } as never : null, profile: user ? { id: user, couple_id: couple } as never : null }); }
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; }
let latest: ReturnType<typeof useAmoraPersonalActions>;
function Harness({ load = true }: { load?: boolean }) { const data = useAmoraPersonalActions(load); useEffect(() => { latest = data; }, [data]); return <div>{data.actions.map(item => item.title).join("|")}{data.error}{data.writeError}</div>; }
async function click(text: string) { const button = [...document.querySelectorAll("button")].find(node => node.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function input(value: string) { const element = document.querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }

describe("owner-only personal actions", () => {
  let root: Root; let host: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => { identity(owner); useAuthStore.setState({ isDemo: false, isInitialized: true }); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("distinguishes malformed pages from empty success, retains rows on error and retries", async () => {
    fetchMock.mockResolvedValueOnce(page([action()])).mockResolvedValueOnce(response({})).mockResolvedValueOnce(page([]));
    await act(async () => root.render(<Harness />));
    await act(async () => latest.load());
    expect(latest.error).toContain("불러오지 못"); expect(latest.actions).toEqual([action()]);
    await act(async () => latest.load()); expect(latest.actions).toEqual([]); expect(latest.error).toBeNull();
  });

  it("ignores old read and write across immediate A-B-A identity changes", async () => {
    const reading = deferred(); const writing = deferred();
    fetchMock.mockImplementation((_path, options) => options.method === "POST" ? writing.promise : reading.promise);
    await act(async () => root.render(<Harness />));
    let pending!: ReturnType<typeof latest.save>;
    await act(async () => { pending = latest.save(source, couple, draft, id); identity(other); identity(owner); });
    await act(async () => { reading.resolve(page([action()])); writing.resolve(response({ saved: true, action: action() })); expect(await pending).toBeNull(); });
    expect(latest.actions).toEqual([]); expect(latest.busyIds).toEqual([]); expect(latest.writeError).toBeNull();
  });

  it("appends deduplicated cursor pages and rejects a non-advancing cursor", async () => {
    fetchMock.mockResolvedValueOnce(page([action()], "one+", 2)).mockResolvedValueOnce(page([action(), action({ id: other })], null, 2)).mockResolvedValueOnce(page([action()], "repeat", 2));
    await act(async () => root.render(<Harness />)); await act(async () => latest.load("one+"));
    expect(latest.actions).toHaveLength(2); expect(fetchMock.mock.calls[1][0]).toContain("cursor=one%2B");
    await act(async () => latest.load("repeat")); expect(latest.error).toContain("불러오지 못"); expect(latest.actions).toHaveLength(2);
  });

  it("waits for exact status and deletion receipts and guards foreign owner actions", async () => {
    fetchMock.mockResolvedValueOnce(page([action()])); await act(async () => root.render(<Harness load={false} />)); await act(async () => latest.load());
    fetchMock.mockResolvedValueOnce(response({ updated: true, action: action({ status: "done", revision: 1 }) }));
    await act(async () => { expect(await latest.update(action())).toBeNull(); }); expect(latest.actions[0].status).toBe("open");
    fetchMock.mockResolvedValueOnce(response({ updated: true, action: action({ status: "done", revision: 2 }) }));
    await act(async () => latest.update(action())); expect(latest.actions[0].status).toBe("done");
    fetchMock.mockResolvedValueOnce(response({ deleted: true, id: other })); await act(async () => latest.remove(latest.actions[0])); expect(latest.actions).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(response({ deleted: true, id })); await act(async () => latest.remove(latest.actions[0])); expect(latest.actions).toEqual([]);
    const count = fetchMock.mock.calls.length; await act(async () => { identity(other); expect(await latest.update(action())).toBeNull(); expect(await latest.remove(action())).toBeNull(); }); expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it("opening private preview never writes or invents fields; only exact reviewed save closes the sheet", async () => {
    await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="내 개인 상담 내용" />));
    await click("개인 할 일로 저장"); expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(""); expect(document.querySelector<HTMLButtonElement>("[data-amora-confirm]")!.disabled).toBe(true);
    await input(draft.title);
    fetchMock.mockResolvedValueOnce(response({ saved: true, action: action({ title: "다른 제목" }) })); await click("개인 할 일 저장");
    expect(document.querySelector("[role=dialog]")).not.toBeNull(); expect(document.querySelector("[role=alert]")?.textContent).toContain("확인하지 못");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body); expect(body).toMatchObject({ expectedOwnerId: owner, expectedCoupleId: couple, messageId: source, ...draft }); expect(body).not.toHaveProperty("content");
    fetchMock.mockResolvedValueOnce(response({ saved: true, action: action() })); await click("개인 할 일 저장");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(body.requestId);
    expect(document.querySelector("[role=dialog]")).toBeNull(); expect(host.textContent).toContain("개인 할 일을 저장했어요"); expect(host.querySelector("a")?.getAttribute("href")).toBe("/chat/personal");
  });

  it("a pending save blocks double clicks and account change hides its result", async () => {
    const pending = deferred(); fetchMock.mockReturnValue(pending.promise);
    await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="내 상담" />)); await click("개인 할 일로 저장"); await input(draft.title);
    await act(async () => { const button = document.querySelector<HTMLButtonElement>("[data-amora-confirm]")!; button.click(); button.click(); }); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => identity(other)); expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => pending.resolve(response({ saved: true, action: action() }))); expect(host.textContent).not.toContain("저장했어요");
  });

  it("source provenance denial stays in the preview with a new-private-answer recovery", async () => {
    fetchMock.mockResolvedValue(response({ error: "secret db detail", code: "PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE" }, 409));
    await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="예전 답변" />)); await click("개인 할 일로 저장"); await input(draft.title); await click("개인 할 일 저장");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("새로 나만 상담"); expect(document.body.textContent).not.toContain("secret db detail");
  });

  it("personal list shows canonical state, confirms deletion, and re-reads after success", async () => {
    let rows = [action()];
    fetchMock.mockImplementation((_path, options) => { if (options.method === "PATCH") { rows = [action({ status: "done", revision: 2 })]; return Promise.resolve(response({ updated: true, action: rows[0] })); } if (options.method === "DELETE") { rows = []; return Promise.resolve(response({ deleted: true, id })); } return Promise.resolve(page(rows)); });
    await act(async () => root.render(<AmoraPersonalActions />)); expect(host.textContent).toContain(draft.title);
    await click("완료로 표시"); expect(host.textContent).toContain("진행 중으로 되돌리기"); await click("삭제");
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE")).toHaveLength(0);
    await click("개인 할 일 삭제"); expect(document.querySelector("[role=dialog]")).toBeNull(); expect(host.textContent).toContain("저장한 개인 할 일이 없어요");
  });

  it("demo never calls the personal API or pretends a private save succeeded", async () => {
    useAuthStore.setState({ isDemo: true }); await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="예시" />)); await click("개인 할 일로 저장");
    expect(document.querySelector<HTMLButtonElement>("[data-amora-confirm]")!.disabled).toBe(true); expect(document.body.textContent).toContain("체험에서는 개인 할 일을 저장하지 않아요"); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("storage limit preserves the reviewed draft and explains delete-then-retry recovery", async () => {
    fetchMock.mockResolvedValue(response({ code: "PERSONAL_ACTION_LIMIT_REACHED" }, 409));
    await act(async () => root.render(<PersonalActionSaveButton messageId={source} coupleId={couple} content="답변" />)); await click("개인 할 일로 저장"); await input(draft.title); await click("개인 할 일 저장");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("300개"); expect(document.querySelector("[role=alert]")?.textContent).toContain("삭제한 뒤");
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(draft.title);
  });
});
