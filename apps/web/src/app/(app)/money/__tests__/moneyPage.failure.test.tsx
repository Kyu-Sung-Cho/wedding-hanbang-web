import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ changeOwner: vi.fn<(id: string) => void>() }));
vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  const useAuthStore = create(() => ({
    user: { id: "user-1" }, couple: { id: "couple-1" }, isDemo: false,
  }));
  auth.changeOwner.mockImplementation((id) => {
    useAuthStore.setState({ user: { id }, couple: { id: id === "user-1" ? "couple-1" : "couple-2" }, isDemo: false });
  });
  return { useAuthStore };
});
import MoneyPage from "../page";
import { useMoneyStore } from "@/stores/moneyStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockFetch = vi.fn();
const ROW = {
  id: "money-1", couple_id: "couple-1", guest_name: "가상 하객", amount: 100_000,
  side: "bride", relation: null, method: "cash", memo: null,
  received_at: "2026-10-17", created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
};
function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
describe("축의금 오류 화면과 폼 보존", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    auth.changeOwner("user-1");
    useMoneyStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });
  async function mount(rows: unknown[] = []) {
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: rows }));
    await act(async () => { root.render(<MoneyPage />); });
  }
  function button(label: string): HTMLButtonElement {
    const result = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!result) throw new Error(`버튼 없음: ${label}`);
    return result;
  }
  async function click(label: string) {
    await act(async () => { button(label).click(); });
  }
  function input(placeholder: string): HTMLInputElement {
    const result = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
    if (!result) throw new Error(`입력 없음: ${placeholder}`);
    return result;
  }
  async function fill(placeholder: string, value: string) {
    await act(async () => {
      const field = input(placeholder);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("공동 축의금도 요약에 별도로 표시하고 총액·인원·평균은 유지한다", async () => {
    await mount([{ ...ROW, side: "both" }]);
    const summary = container.querySelector('[aria-label="축의금 요약"]');
    const cards = Array.from(summary?.firstElementChild?.children ?? []);
    expect(cards.map((card) => card.textContent)).toEqual([
      "총 축의금100,000원", "총 인원1명", "평균100,000원",
      "신랑 / 신부 / 공동신랑 0원신부 0원공동 100,000원",
    ]);
    expect(useMoneyStore.getState().moneyList).toHaveLength(1);
    expect(useMoneyStore.getState().moneyList[0].side).toBe("both");
  });
  it("신랑·신부·공동이 섞인 요약의 귀속별 금액을 빠짐없이 보여준다", async () => {
    await mount([
      { ...ROW, id: "groom-row", side: "groom", amount: 150_000 },
      { ...ROW, id: "bride-row", side: "bride", amount: 250_000 },
      { ...ROW, id: "both-row", side: "both", amount: 100_000 },
    ]);
    const summary = container.querySelector('[aria-label="축의금 요약"]');
    const cards = Array.from(summary?.firstElementChild?.children ?? []);
    expect(cards.map((card) => card.textContent)).toEqual([
      "총 축의금500,000원", "총 인원3명", "평균166,667원",
      "신랑 / 신부 / 공동신랑 150,000원신부 250,000원공동 100,000원",
    ]);
  });
  it("공동 합계가 없으면 기존 신랑·신부 요약을 유지한다", async () => {
    await mount([ROW, { ...ROW, id: "zero-joint", side: "both", amount: 0 }]);
    const summary = container.querySelector('[aria-label="축의금 요약"]');
    expect(summary?.lastElementChild?.lastElementChild?.textContent).toBe("신랑 / 신부신랑 0원신부 100,000원");
    expect(summary?.textContent).not.toContain("공동");
  });
  it("축의금 폼의 입력과 닫기 버튼에 정확한 접근성 이름을 제공한다", async () => {
    await mount();
    await click("축의금 추가 폼 열기");
    for (const [selector, label] of [
      ['input[placeholder="이름"]', "하객 이름"],
      ['input[placeholder="금액"]', "축의금 금액 (원)"],
      ["select", "관계"],
      ['input[type="date"]', "받은 날짜"],
      ['input[placeholder="메모 (선택)"]', "메모"],
    ]) {
      expect(container.querySelector(selector)?.getAttribute("aria-label")).toBe(label);
    }
    await click("축의금 폼 닫기");
    expect(container.querySelector('input[placeholder="이름"]')).toBeNull();
  });
  it("401 추가 실패 때 입력값과 폼을 유지한다", async () => {
    await mount();
    await click("축의금 추가 폼 열기");
    await fill("이름", "가상 하객");
    await fill("금액", "100000");
    mockFetch.mockResolvedValueOnce(response(401));
    await click("축의금 추가 저장");
    expect(input("이름").value).toBe("가상 하객");
    expect(input("금액").value).toBe("100000");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("로그인");
    expect(useMoneyStore.getState().moneyList).toEqual([]);
  });
  it("403 수정 실패 때 편집값을 보존하고 기존 행을 바꾸지 않는다", async () => {
    await mount([ROW]);
    await click("가상 하객 축의금 수정");
    await fill("금액", "200000");
    mockFetch.mockResolvedValueOnce(response(403));
    await click("축의금 수정 저장");
    expect(input("금액").value).toBe("200000");
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(100_000);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("접근");
  });
  it("401 삭제 실패 때 확인창과 원행을 유지한다", async () => {
    await mount([ROW]);
    await click("가상 하객 축의금 삭제");
    mockFetch.mockResolvedValueOnce(response(401));
    await click("가상 하객 축의금 삭제 확정");
    expect(button("가상 하객 축의금 삭제 취소")).toBeTruthy();
    expect(useMoneyStore.getState().moneyList).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("로그인");
  });
  it("조회 실패를 빈 내역 대신 오류로 표시하고 다시 불러온다", async () => {
    mockFetch.mockResolvedValueOnce(response(401));
    await act(async () => { root.render(<MoneyPage />); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("로그인");
    expect(container.textContent).not.toContain("축의금 내역이 없습니다");
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: [] }));
    await click("축의금 다시 불러오기");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("축의금 내역이 없습니다");
  });
  it("실제 CSV 다운로드에도 한글 BOM·셀 경계·수식 방어가 적용된다", async () => {
    let exported: Blob | undefined;
    let fileName = "";
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => {
      exported = blob;
      return "blob:synthetic-money-csv";
    } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      fileName = this.download;
    });
    try {
      await mount([{ ...ROW, guest_name: '가상, "하객"', memo: "\t=1+1\n두번째 줄" }]);
      await click("축의금 CSV 다운로드");
      const blob = exported;
      if (!blob) throw new Error("다운로드 Blob이 없음");
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("잘못된 Blob"));
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      expect([...new Uint8Array(bytes).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const csv = new TextDecoder().decode(bytes);
      expect(csv).toContain('"가상, ""하객"""');
      expect(csv).toContain('"\'\t=1+1\n두번째 줄"');
      expect(csv).toContain('"100000"');
      expect(fileName).toMatch(/^축의금_내역_\d{4}-\d{2}-\d{2}\.csv$/);
    } finally {
      anchor.mockRestore();
      if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate); else Reflect.deleteProperty(URL, "createObjectURL");
      if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
  it("계정 교체 때 이전 사용자의 미전송 폼도 닫는다", async () => {
    await mount();
    await click("축의금 추가 폼 열기");
    await fill("이름", "이전 계정 입력");
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: [] }));
    await act(async () => { auth.changeOwner("user-2"); });
    expect(container.querySelector('input[placeholder="이름"]')).toBeNull();
    await click("축의금 추가 폼 열기");
    expect(input("이름").value).toBe("");
  });
});
