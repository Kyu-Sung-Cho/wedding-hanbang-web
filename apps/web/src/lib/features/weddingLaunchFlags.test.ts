// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import {
  isWeddingCourtEnabled,
  isWeddingPaymentLedgerEnabled,
} from "./weddingLaunchFlags";

const originalCourtFlag = process.env.WEDDING_COURT_ENABLED;
const originalPaymentFlag = process.env.WEDDING_PAYMENT_LEDGER_ENABLED;

afterEach(() => {
  if (originalCourtFlag === undefined) {
    delete process.env.WEDDING_COURT_ENABLED;
  } else {
    process.env.WEDDING_COURT_ENABLED = originalCourtFlag;
  }

  if (originalPaymentFlag === undefined) {
    delete process.env.WEDDING_PAYMENT_LEDGER_ENABLED;
  } else {
    process.env.WEDDING_PAYMENT_LEDGER_ENABLED = originalPaymentFlag;
  }
});

describe("wedding launch flags", () => {
  it.each([undefined, "", "false", "TRUE", " true", "true "])(
    "keeps wedding court disabled for %s",
    (value) => {
      if (value === undefined) {
        delete process.env.WEDDING_COURT_ENABLED;
      } else {
        process.env.WEDDING_COURT_ENABLED = value;
      }

      expect(isWeddingCourtEnabled()).toBe(false);
    },
  );

  it("enables wedding court only for exact true", () => {
    process.env.WEDDING_COURT_ENABLED = "true";

    expect(isWeddingCourtEnabled()).toBe(true);
  });

  it("keeps the payment ledger default-off and exact-true", () => {
    delete process.env.WEDDING_PAYMENT_LEDGER_ENABLED;
    expect(isWeddingPaymentLedgerEnabled()).toBe(false);

    process.env.WEDDING_PAYMENT_LEDGER_ENABLED = "TRUE";
    expect(isWeddingPaymentLedgerEnabled()).toBe(false);

    process.env.WEDDING_PAYMENT_LEDGER_ENABLED = "true";
    expect(isWeddingPaymentLedgerEnabled()).toBe(true);
  });
});
