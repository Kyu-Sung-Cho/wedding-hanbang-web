// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  mapPaymentLedgerRow,
  parsePaymentLedgerCreate,
  parsePaymentLedgerCreateRequest,
  parsePaymentLedgerUpdate,
} from "./paymentLedger";

const VALID_VALUES = {
  itemName: "예식장 계약",
  vendorDisplayName: "한방 웨딩홀",
  categoryKey: "venue",
  contractAmountWon: 20_000_000,
  paidAmountWon: 2_000_000,
  balanceDueDate: "2026-10-01",
  refundableAmountWon: 1_000_000,
  status: "partially_paid",
  evidenceStatus: "provider_written",
} as const;

describe("payment ledger input validation", () => {
  it("accepts exact won amounts and an actual ISO date", () => {
    expect(parsePaymentLedgerCreate(VALID_VALUES)).toEqual({
      ok: true,
      value: VALID_VALUES,
    });
  });

  it.each([
    ["fraction", { contractAmountWon: 1.5 }],
    ["over maximum", { contractAmountWon: 1_000_000_001 }],
    ["paid over contract", { paidAmountWon: 20_000_001 }],
    ["refund over paid", { refundableAmountWon: 2_000_001 }],
    ["impossible date", { balanceDueDate: "2026-02-30" }],
    ["control character", { itemName: "예식장\n계약" }],
    ["invalid category", { categoryKey: "../venue" }],
    ["inconsistent paid status", { status: "paid" }],
    ["unexpected identity", { coupleId: "attacker-controlled" }],
  ])("rejects %s", (_label, override) => {
    expect(
      parsePaymentLedgerCreate({ ...VALID_VALUES, ...override }),
    ).toMatchObject({ ok: false });
  });

  it("requires the optimistic revision only on updates", () => {
    expect(
      parsePaymentLedgerUpdate({ ...VALID_VALUES, revision: 7 }),
    ).toMatchObject({ ok: true, value: { revision: 7 } });
    expect(parsePaymentLedgerUpdate(VALID_VALUES)).toEqual({
      ok: false,
      error: "수정 버전이 올바르지 않습니다.",
    });
  });

  it("requires a stable UUID idempotency key for creates", () => {
    expect(parsePaymentLedgerCreateRequest({
      ...VALID_VALUES,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
    })).toMatchObject({
      ok: true,
      value: {
        clientRequestId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(parsePaymentLedgerCreateRequest({
      ...VALID_VALUES,
      clientRequestId: "rotating-or-invalid",
    })).toEqual({
      ok: false,
      error: "저장 요청 식별자가 올바르지 않습니다.",
    });
  });
});

describe("payment ledger response boundary", () => {
  const actorId = "11111111-1111-4111-8111-111111111111";
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    item_name: "예식장 계약",
    vendor_display_name: "한방 웨딩홀",
    category_key: "venue",
    contract_amount_won: 20_000_000,
    paid_amount_won: 2_000_000,
    balance_amount_won: 18_000_000,
    balance_due_date: "2026-10-01",
    refundable_amount_won: 1_000_000,
    status: "partially_paid",
    evidence_status: "provider_written",
    created_by: actorId,
    updated_by: "33333333-3333-4333-8333-333333333333",
    revision: 2,
    created_at: "2026-07-31T01:00:00.000Z",
    updated_at: "2026-07-31T02:00:00.000Z",
  };

  it("uses the generated balance and exposes only actor-relative audit flags", () => {
    expect(mapPaymentLedgerRow(row, actorId)).toMatchObject({
      id: row.id,
      balanceAmountWon: 18_000_000,
      createdByMe: true,
      updatedByMe: false,
    });
  });

  it("fails closed when a service response carries an impossible balance", () => {
    expect(
      mapPaymentLedgerRow({ ...row, balance_amount_won: 17_000_000 }, actorId),
    ).toBeNull();
  });
});
