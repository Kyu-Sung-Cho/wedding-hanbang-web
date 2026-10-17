import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookingsPage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockFetch = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
describe("예약 조회 실패 복구 화면", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });
  it("오류를 읽고 다시 요청한 뒤에만 정상 빈 목록으로 돌아간다", async () => {
    mockFetch.mockResolvedValueOnce(json(500, { error: "예약 정보를 불러오지 못했어요." }));
    await act(async () => { root.render(<BookingsPage />); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    expect(container.textContent).not.toContain("아직 예약 요청 기록이 없어요");
    mockFetch.mockResolvedValueOnce(json(200, { bookings: [] }));
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="예약 요청 기록 다시 불러오기"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("아직 예약 요청 기록이 없어요");
  });
  it("5xx에 error 필드가 없어도 정상 빈 내역으로 처리하지 않는다", async () => {
    mockFetch.mockResolvedValueOnce(json(503, { bookings: [] }));
    await act(async () => { root.render(<BookingsPage />); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오");
    expect(container.textContent).not.toContain("아직 예약 요청 기록이 없어요");
  });
});
