// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PriceUploadConfirmationQueue } from "./PriceUploadConfirmationQueue";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const row = {
  confirmation_id: "00000000-0000-4000-8000-000000000099",
  entry_index: 2,
  vendor_name: "샘플 스튜디오 A",
  version: 0 as const,
  candidates: [{
    vendorId: "00000000-0000-4000-8000-000000000001",
    vendorName: "샘플 스튜디오",
    vendorSlug: "sample-studio",
    aliases: ["샘플사진관"],
    category: "studio",
    regionCode: "seoul_gangnam3",
    similarity: 0.72,
    matchKind: "similar" as const,
  }],
};

describe("PriceUploadConfirmationQueue", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("requires a detailed second confirmation before durable staging", async () => {
    let finish: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(
      <PriceUploadConfirmationQueue initialConfirmations={[row]} />,
    ));
    const action = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("이 후보 검토"));

    await act(async () => {
      action?.click();
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("샘플사진관");
    expect(container.textContent).toContain("스튜디오");
    expect(container.textContent).toContain("seoul_gangnam3");
    expect(container.textContent).toContain("이 화면에서 되돌릴 수 없습니다");

    const confirm = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("연결 확정"));
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(confirm?.textContent).toContain("연결 중");
    expect(confirm?.getAttribute("aria-busy")).toBe("true");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/price/upload/confirmations/${row.confirmation_id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          vendor_id: row.candidates[0].vendorId,
          expected_version: 0,
        }),
      }),
    );

    await act(async () => {
      finish?.(new Response(JSON.stringify({
        resolved: true,
        staged_prices: 1,
        version: 1,
      }), { status: 200, headers: { "content-type": "application/json" } }));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("연결 완료");
  });

  it("keeps a failed row retryable and refreshes the pending queue", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "목록을 새로고침한 뒤 다시 시도해 주세요.",
      }), { status: 409, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ confirmations: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(
      <PriceUploadConfirmationQueue initialConfirmations={[row]} />,
    ));
    const action = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("이 후보 검토"));
    await act(async () => {
      action?.click();
      await Promise.resolve();
    });
    const confirm = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("연결 확정"));
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("새로고침");
    expect(confirm?.hasAttribute("disabled")).toBe(false);

    const refresh = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("대기 목록 새로고침"));
    await act(async () => {
      refresh?.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/price/upload/confirmations",
      { cache: "no-store" },
    );
    expect(container.textContent).toContain("확인이 필요한 업로드가 없습니다");
  });

  it("lets the admin cancel a candidate review without a mutation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(
      <PriceUploadConfirmationQueue initialConfirmations={[row]} />,
    ));
    const action = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("이 후보 검토"));
    await act(async () => action?.click());
    const cancel = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("선택 취소"));
    await act(async () => cancel?.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("최종 연결 확인");
  });
});
