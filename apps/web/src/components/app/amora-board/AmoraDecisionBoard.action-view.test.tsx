import { act } from "react";
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
    const notify = () => listener(mocks.auth); mocks.listeners.add(notify); return () => { mocks.listeners.delete(notify); };
  };
  return { useAuthStore: Object.assign(
    (selector: (state: typeof mocks.auth) => unknown) => useSyncExternalStore(subscribe, () => selector(mocks.auth)),
    { getState: () => mocks.auth, subscribe },
  ) };
});
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const version = "2026-10-12T00:00:00.123456Z";
const nextVersion = "2026-10-12T00:00:00.123457Z";
const action = { id: "act_board_view", title: "식사 포함 범위 확인", description: "처음 메모", categoryKey: "venue",
  status: "open", source: "manual", priority: "medium", createdAt: "2026-10-01T00:00:00Z", updatedAt: version, viewVersion: version };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const snapshot = (actions: unknown[]) => response({ actions, count: actions.length, open_count: actions.length });

describe("shared action board viewed approval and draft recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => {
    mocks.auth.profile.couple_id = "22222222-2222-4222-8222-222222222222";
    mocks.auth.isDemo = false;
    fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/wedding/chat/board?view=tasks");
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });
  const render = () => act(async () => root.render(<AmoraDecisionBoard />));
  const button = (name: string) => {
    const control = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(node => node.getAttribute("aria-label") === name || node.textContent === name);
    expect(control, name).toBeDefined(); return control!;
  };
  const click = (name: string) => act(async () => { const control = button(name); control.focus(); control.click(); });
  const fill = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
    input.focus(); Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const choose = (select: HTMLSelectElement, value: string) => act(async () => {
    select.focus(); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const draftTitle = () => container.querySelector<HTMLInputElement>("article input")!;
  const backgroundRead = async (items: unknown[]) => {
    fetchMock.mockResolvedValueOnce(snapshot(items));
    await act(async () => window.dispatchEvent(new Event("focus")));
  };
  const notifyAuth = () => { for (const notify of mocks.listeners) notify(); };

  it("saves only fields the user changed against the original view, retaining its raw version after background changes", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`);
    await fill(container.querySelector<HTMLTextAreaElement>("article textarea")!, "내가 작성한 메모");
    const current = { ...action, title: "파트너가 바꾼 제목", categoryKey: "makeup", updatedAt: nextVersion, viewVersion: nextVersion };
    await backgroundRead([current]);
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await click("수정 저장");
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
    expect(patch, "explicit approval reaches the guarded PATCH boundary").toBeDefined();
    expect(JSON.parse(patch![1].body)).toEqual({ description: "내가 작성한 메모", expectedUpdatedAt: version,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id });
    expect(draftTitle().value).toBe(action.title);
    expect(container.querySelector<HTMLTextAreaElement>("article textarea")?.value).toBe("내가 작성한 메모");
  });

  it("keeps an edit draft visible when a partner moves the card to another status and a filter omits it", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "계속 작성할 초안");
    await backgroundRead([{ ...action, status: "done", updatedAt: nextVersion, viewVersion: nextVersion }]);
    expect(draftTitle()?.value).toBe("계속 작성할 초안");
    const search = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    await fill(search, "없는 검색 조건");
    expect(draftTitle()?.value).toBe("계속 작성할 초안");
    expect(container.querySelector('[aria-label="수정 중인 할 일"]')).not.toBeNull();
    expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(false);
  });

  it("requires an explicit current-vs-draft review after conflict before a fresh-version save", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "내가 확인한 범위");
    const current = { ...action, title: "파트너가 확인한 범위", description: "파트너 메모", categoryKey: "makeup", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("수정 저장");
    expect(container.querySelector('[aria-label="현재 저장된 할 일"]')?.textContent).toContain(current.title);
    expect(container.querySelector('[aria-label="내 수정 초안"]')?.textContent).toContain("내가 확인한 범위");
    expect(button("수정 저장").disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
    await click("현재 내용 기준으로 초안 다시 확인");
    expect(draftTitle().value).toBe("내가 확인한 범위");
    expect(container.querySelector<HTMLTextAreaElement>("article textarea")?.value).toBe("파트너 메모");
    const finalVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...current, title: "내가 확인한 범위", updatedAt: finalVersion, viewVersion: finalVersion } }));
    await click("수정 저장");
    const patches = fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH");
    expect(JSON.parse(patches[1][1].body)).toEqual({ title: "내가 확인한 범위", expectedUpdatedAt: nextVersion,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id });
    expect(draftTitle()).toBeNull();
    expect(container.textContent).toContain("내가 확인한 범위");
  });

  it("keeps a real card without an authoritative view version read-only despite a valid display date", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, viewVersion: undefined }])); await render();
    expect(button(`${action.title} 수정`).disabled).toBe(true);
    expect(button("완료로 표시").disabled).toBe(true);
    expect(container.textContent).toContain("수정에 필요한 저장 버전을 확인하지 못했어요");
    expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(false);
  });

  it("retains a failed quick status change as an explicit reviewable intent instead of silently retrying", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    const current = { ...action, title: "파트너 수정", status: "dismissed", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("완료로 표시");
    expect(container.querySelector('[aria-label="수정 중인 할 일"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="내 수정 초안"]')?.textContent).toContain("상태: 완료");
    expect(container.querySelector('[data-board-announcement]')?.textContent).toBe("");
    await click("현재 내용 기준으로 초안 다시 확인");
    const finalVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...current, status: "done", updatedAt: finalVersion, viewVersion: finalVersion } }));
    await click("수정 저장");
    const patches = fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH");
    expect(JSON.parse(patches[1][1].body)).toEqual({ status: "done", expectedUpdatedAt: nextVersion,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id });
    expect(draftTitle()).toBeNull();
  });

  it("pins a chosen category and original view across background classification, then retains that intent after conflict", async () => {
    const unsorted = { ...action, categoryKey: undefined };
    fetchMock.mockResolvedValueOnce(snapshot([unsorted])); await render();
    await choose(container.querySelector<HTMLSelectElement>("article select")!, "makeup");
    const current = { ...action, title: "현재 분야가 있는 기록", updatedAt: nextVersion, viewVersion: nextVersion };
    await backgroundRead([current]);
    expect(container.querySelector<HTMLSelectElement>("article select")?.value).toBe("makeup");
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("저장");
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({ category_key: "makeup", expectedUpdatedAt: version,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id });
    expect(container.querySelector('[aria-label="내 수정 초안"]')?.textContent).toContain("분야: 헤어·메이크업");
    expect(button("수정 저장").disabled).toBe(true);
  });

  it("retains an uncertain matching read without declaring our request saved or retrying automatically", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "같은 내용일 수 있는 초안");
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));
    const current = { ...action, title: "같은 내용일 수 있는 초안", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("수정 저장");
    expect(draftTitle().value).toBe("같은 내용일 수 있는 초안");
    expect(container.textContent).toContain("이번 요청이 저장됐다는 뜻은 아니에요");
    expect(button("수정 저장").disabled).toBe(true);
    expect(container.querySelector('[data-board-announcement]')?.textContent).toBe("");
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
  });

  it("requires a new review after a second concurrent change while keeping the dirty draft", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "두 번 충돌해도 남길 초안");
    const current = { ...action, title: "첫 동시 수정", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("수정 저장");
    await click("현재 내용 기준으로 초안 다시 확인");
    const laterVersion = "2026-10-12T00:00:00.123458Z";
    const later = { ...current, title: "두 번째 동시 수정", updatedAt: laterVersion, viewVersion: laterVersion };
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: later })); await click("수정 저장");
    expect(draftTitle().value).toBe("두 번 충돌해도 남길 초안");
    expect(container.querySelector('[aria-label="현재 저장된 할 일"]')?.textContent).toContain(later.title);
    expect(button("수정 저장").disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(2);
  });

  it("drops an unfinished old-space editor after leaving and returning to the same account and couple", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "이전 연결에만 남겨 둘 초안");
    fetchMock.mockResolvedValueOnce(snapshot([action]));
    await act(async () => {
      const originalCouple = mocks.auth.profile.couple_id;
      mocks.auth.profile.couple_id = "33333333-3333-4333-8333-333333333333"; notifyAuth();
      mocks.auth.profile.couple_id = originalCouple; notifyAuth();
    });
    expect(draftTitle()).toBeNull();
    expect(container.textContent).not.toContain("이전 연결에만 남겨 둘 초안");
    expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(false);
  });

  it("uses a single read and explicit review to recover a draft omitted by the paginated list", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "빠진 목록에서도 남긴 초안");
    await backgroundRead([]);
    expect(draftTitle().value).toBe("빠진 목록에서도 남긴 초안");
    const current = { ...action, title: "현재 기록", updatedAt: nextVersion, viewVersion: nextVersion };
    fetchMock.mockResolvedValueOnce(response({ action: current })); await click("현재 기록 다시 확인");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`/api/amora/actions/${action.id}`);
    expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(false);
    expect(button("수정 저장").disabled).toBe(true);
    await click("현재 내용 기준으로 초안 다시 확인");
    const finalVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...current, title: "빠진 목록에서도 남긴 초안", updatedAt: finalVersion, viewVersion: finalVersion } }));
    await click("수정 저장");
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
    expect(JSON.parse(patch![1].body).expectedUpdatedAt).toBe(nextVersion);
    expect(draftTitle()).toBeNull();
  });

  it.each([404, 503])("retains the draft and closes reapproval when the current read cannot establish a card (%s)", async status => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    await click(`${action.title} 수정`); await fill(draftTitle(), "확인 못해도 남겨 둘 초안");
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ error: "not readable" }, status)); await click("수정 저장");
    expect(draftTitle().value).toBe("확인 못해도 남겨 둘 초안");
    expect(button("현재 내용 기준으로 초안 다시 확인").disabled).toBe(true);
    expect(button("수정 저장").disabled).toBe(true);
    expect(container.textContent).toContain(status === 404 ? "현재 준비 공간에서 이 기록을 찾지 못했어요" : "현재 저장 내용을 아직 확인하지 못했어요");
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
  });

  it("does not resurrect an old-space quick status intent after an account transition during its response", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    let resolvePatch!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolvePatch = resolve; }));
    await click("완료로 표시");
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, title: "새 준비 공간의 기록" }]));
    await act(async () => { mocks.auth.profile.couple_id = "33333333-3333-4333-8333-333333333333"; notifyAuth(); });
    await act(async () => resolvePatch(response({ code: "AMORA_ACTION_CONFLICT" }, 409)));
    expect(container.querySelector('[aria-label="수정 중인 할 일"]')).toBeNull();
    expect(container.textContent).not.toContain(action.title);
    expect(container.querySelector('[data-board-announcement]')?.textContent).toBe("");
  });

  it("keeps demo editing local even when sample cards have no server-issued view version", async () => {
    mocks.auth.isDemo = true; await render();
    const title = container.querySelector("article h3")!.textContent!;
    expect(button(`${title} 수정`).disabled).toBe(false); await click(`${title} 수정`);
    await fill(draftTitle(), "체험용 수정 제목"); await click("수정 저장");
    expect(container.textContent).toContain("체험용 수정 제목");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves independently changed fields in one render batch and supports explicit clears", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([{ ...action, dueDate: "다음 주" }])); await render();
    await click(`${action.title} 수정`);
    await act(async () => {
      const input = draftTitle(); const description = container.querySelector<HTMLTextAreaElement>("article textarea")!;
      const due = container.querySelector<HTMLInputElement>("article input[data-plan-date]")!;
      const select = container.querySelector<HTMLSelectElement>("article select")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "직접 바꾼 제목"); input.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, ""); description.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(due, ""); due.dispatchEvent(new Event("input", { bubbles: true }));
      select.value = "makeup"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "직접 바꾼 제목", description: undefined, dueDate: undefined, categoryKey: "makeup", updatedAt: nextVersion, viewVersion: nextVersion } }));
    await click("수정 저장");
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({ title: "직접 바꾼 제목", description: "", due_date: "", category_key: "makeup", expectedUpdatedAt: version,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id });
    expect(draftTitle()).toBeNull();
  });

  it("does not keep an old-space search term after an owner transition, including leaving and returning", async () => {
    fetchMock.mockResolvedValueOnce(snapshot([action])); await render();
    const search = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    await fill(search, "이전 준비 공간의 검색 내용");
    fetchMock.mockResolvedValueOnce(snapshot([action]));
    await act(async () => {
      const originalCouple = mocks.auth.profile.couple_id;
      mocks.auth.profile.couple_id = "33333333-3333-4333-8333-333333333333"; notifyAuth();
      mocks.auth.profile.couple_id = originalCouple; notifyAuth();
    });
    expect(search.value).toBe("");
    expect(container.textContent).not.toContain("이전 준비 공간의 검색 내용");
  });
});
