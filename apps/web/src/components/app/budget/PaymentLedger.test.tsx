// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/authStore";
import type { Couple } from "@/types/database.types";

import PaymentLedger from "./PaymentLedger";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";

const COUPLE: Couple = {
  id: COUPLE_ID,
  invite_code: "WH-TEST01",
  bride_id: USER_ID,
  groom_id: null,
  membership_sealed_at: null,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PaymentLedger", () => {
  let container: HTMLDivElement;
  let root: Root;
  const original = useAuthStore.getState();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({
      user: { id: USER_ID, email: "member@example.test" },
      couple: COUPLE,
      isDemo: false,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({
      user: original.user,
      couple: original.couple,
      isDemo: original.isDemo,
    });
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows an actionable empty state and the non-transaction boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ payments: [] })));

    await act(async () => {
      root.render(<PaymentLedger />);
    });
    await flushEffects();

    expect(container.textContent).toContain("아직 계약·지급 기록이 없어요");
    expect(container.textContent).toContain(
      "실제 결제, 예약, 전자계약을 실행하지 않습니다",
    );
    expect(container.textContent).toContain(
      "삭제 기능 대신 상태를 ‘취소됨’으로 바꿔 기록 자체를 남깁니다",
    );
    expect(container.textContent).not.toContain("변경 이력을 유지합니다");

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("첫 기록 추가"),
    );
    await act(async () => addButton?.click());

    expect(container.querySelector('[data-testid="payment-ledger-form"]'))
      .not.toBeNull();
    expect(container.textContent).toContain(
      "확정된 환불 권리나 법률 판단이 아닙니다",
    );
    expect(container.textContent).toContain(
      "저장하면 연결된 상대도 볼 수 있습니다",
    );
  });

  it("renders server-calculated balance and labels provider text as unverified", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      payments: [{
        id: "33333333-3333-4333-8333-333333333333",
        itemName: "예식장 계약",
        vendorDisplayName: "한방 웨딩홀",
        categoryKey: "venue",
        contractAmountWon: 20_000_000,
        paidAmountWon: 2_000_000,
        balanceAmountWon: 18_000_000,
        balanceDueDate: "2026-10-01",
        refundableAmountWon: 1_000_000,
        status: "partially_paid",
        evidenceStatus: "provider_written",
        revision: 1,
        createdAt: "2026-07-31T01:00:00.000Z",
        updatedAt: "2026-07-31T01:00:00.000Z",
        createdByMe: true,
        updatedByMe: true,
      }],
    })));

    await act(async () => {
      root.render(<PaymentLedger />);
    });
    await flushEffects();

    expect(container.textContent).toContain("잔액 18,000,000원");
    expect(container.textContent).toContain(
      "웨딩한방이 검증한 금액은 아닙니다",
    );
    expect(container.textContent).toContain("잔금일 2026.10.01");
    expect(container.textContent).not.toContain("결제가 완료되었습니다");
  });

  it("does not call the API in demo mode and explains that saving is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useAuthStore.setState({ isDemo: true });

    await act(async () => {
      root.render(<PaymentLedger />);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("체험에서는 계약·지급 기록을 저장하지 않아요");
  });
});
