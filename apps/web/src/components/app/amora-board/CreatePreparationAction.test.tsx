import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreatePreparationAction from "./CreatePreparationAction";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CreatePreparationAction", () => {
  let root: Root;
  let container: HTMLDivElement;
  const create = vi.fn();
  const onCreated = vi.fn();
  const cancelCreate = vi.fn();
  const focusIntent = () => () => true;
  const render = (busy = false, available = true, isDemo = false, owner = "owner-a", locked = false) => act(async () => root.render(
    <CreatePreparationAction key={owner} create={create} cancelCreate={cancelCreate} locked={locked} busy={busy} available={available} isDemo={isDemo} onCreated={onCreated} focusIntent={focusIntent} />,
  ));
  const fill = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = () => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  beforeEach(() => {
    create.mockReset().mockResolvedValue(true); onCreated.mockReset(); cancelCreate.mockReset().mockReturnValue(true);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("requires a title, sends optional planning fields and restores focus only after success", async () => {
    await render(); await act(async () => container.querySelector("button")!.click());
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("함께 준비하는 사람에게도 보이는");
    await fill('input:not([data-plan-date])', "  상담 질문 정리  ");
    await fill("textarea", "식사와 주차 조건\n확인하기"); await fill("[data-plan-date]", "양가 일정 정한 뒤");
    await submit();
    expect(create).toHaveBeenCalledExactlyOnceWith({ title: "상담 질문 정리", description: "식사와 주차 조건\n확인하기", due_date: "양가 일정 정한 뒤" });
    expect(onCreated).toHaveBeenCalledOnce(); expect(container.querySelector("form")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("restores every approved field on remount and retries that exact intent", async () => {
    const pendingFields = { title: "원래 승인한 할 일", category_key: "venue", description: "확인할 조건", due_date: "2027-10-10" };
    await act(async () => root.render(<CreatePreparationAction create={create} cancelCreate={cancelCreate} locked busy={false} available isDemo={false} onCreated={onCreated} focusIntent={focusIntent} pendingFields={pendingFields} />));
    expect(container.querySelector<HTMLInputElement>('input:not([data-plan-date])')?.value).toBe(pendingFields.title);
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe("venue");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(pendingFields.description);
    expect(container.querySelector<HTMLInputElement>("[data-plan-date]")?.value).toBe(pendingFields.due_date);
    expect(container.querySelector<HTMLInputElement>('input:not([data-plan-date])')?.disabled).toBe(true);
    expect(container.textContent).toContain("새로고침하거나 로그아웃하면");
    await submit(); expect(create).toHaveBeenCalledExactlyOnceWith(pendingFields);
  });
  it("preserves explicitly empty optional fields when replaying an approved intent", async () => {
    const pendingFields = { title: "원래 할 일", category_key: "", description: "", due_date: "" };
    await act(async () => root.render(<CreatePreparationAction create={create} cancelCreate={cancelCreate} locked busy={false} available isDemo={false} onCreated={onCreated} focusIntent={focusIntent} pendingFields={pendingFields} />));
    await submit(); expect(create).toHaveBeenCalledExactlyOnceWith(pendingFields);
  });

  it("keeps every draft after failure and guards duplicate submit before a rerender", async () => {
    let finish!: (saved: boolean) => void;
    create.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await render(); await act(async () => container.querySelector("button")!.click());
    await fill('input:not([data-plan-date])', "상담 질문"); await fill("textarea", "보존할 설명"); await fill("[data-plan-date]", "2026-10-15");
    await submit(); await submit(); expect(create).toHaveBeenCalledOnce();
    await act(async () => finish(false));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("보존할 설명");
    expect(container.querySelector<HTMLInputElement>("[data-plan-date]")!.value).toBe("2026-10-15");
    expect(onCreated).not.toHaveBeenCalled();
    await render(true);
    expect([...container.querySelectorAll<HTMLInputElement>("input,textarea,select,button")].every(input => input.disabled)).toBe(true);
  });

  it("drops the previous owner's draft and never creates in the demo or unavailable state", async () => {
    await render(); await act(async () => container.querySelector("button")!.click()); await fill("textarea", "이전 커플 설명");
    await render(false, true, false, "owner-b");
    expect(container.querySelector("form")).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    await render(false, false, true, "demo");
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(container.textContent).toContain("로그인 후 추가"); expect(create).not.toHaveBeenCalled();
  });

  it("locks an uncertain body and requires explicit acknowledgement before cancelling into a new intent", async () => {
    await render(); await act(async () => container.querySelector("button")!.click());
    await fill('input:not([data-plan-date])', "상담 질문"); await fill("textarea", "원래 설명");
    create.mockResolvedValue(false);
    await submit(); await render(false, true, false, "owner-a", true);
    expect([...container.querySelectorAll<HTMLInputElement>("input,textarea,select")].every(input => input.disabled)).toBe(true);
    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("같은 요청 다시 확인");
    const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text)!;
    await act(async () => button("작성 취소").click());
    expect(cancelCreate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("삭제되지 않아요");
    await act(async () => button("같은 요청 유지").click());
    await submit();
    expect(create.mock.calls[0][0]).toEqual(create.mock.calls[1][0]);
    await act(async () => button("작성 취소").click());
    await act(async () => button("확인했어요 · 새 작성으로 전환").click());
    expect(cancelCreate).toHaveBeenCalledOnce(); expect(container.querySelector("form")).toBeNull();
    await render(); await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
  });
});
