// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentLedgerForm from "./PaymentLedgerForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

describe("PaymentLedgerForm create retries", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => REQUEST_ID),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("reuses one idempotency key after a lost or failed response", async () => {
    const savedPayment = {
      id: "66666666-6666-4666-8666-666666666666",
      itemName: "예식장 계약",
      vendorDisplayName: null,
      categoryKey: "venue",
      contractAmountWon: 0,
      paidAmountWon: 0,
      balanceAmountWon: 0,
      balanceDueDate: null,
      refundableAmountWon: null,
      status: "planned",
      evidenceStatus: "user_stated",
      revision: 1,
      createdAt: "2026-07-31T01:00:00.000Z",
      updatedAt: "2026-07-31T01:00:00.000Z",
      createdByMe: true,
      updatedByMe: true,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "응답을 확인하지 못했습니다." }),
        { status: 503, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ payment: savedPayment }),
        { status: 201, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();

    await act(async () => {
      root.render(
        <PaymentLedgerForm
          entry={null}
          onCancel={vi.fn()}
          onSaved={onSaved}
          onRevisionConflict={vi.fn(async () => undefined)}
        />,
      );
    });
    const itemInput = container.querySelector<HTMLInputElement>(
      'input[placeholder^="예:"]',
    );
    await act(async () => {
      if (!itemInput) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(itemInput, "예식장 계약");
      itemInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("공유 기록 저장"),
    );
    await act(async () => saveButton?.click());
    await act(async () => saveButton?.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestBodies = fetchMock.mock.calls.map((call) => {
      const init = call[1];
      if (typeof init?.body !== "string") return null;
      const parsed: unknown = JSON.parse(init.body);
      return parsed;
    });
    expect(requestBodies).toEqual([
      expect.objectContaining({ clientRequestId: REQUEST_ID }),
      expect.objectContaining({ clientRequestId: REQUEST_ID }),
    ]);
    expect(onSaved).toHaveBeenCalledWith(savedPayment);
  });
});
