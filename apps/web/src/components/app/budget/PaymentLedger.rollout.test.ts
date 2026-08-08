// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("payment ledger server-side rollout boundary", () => {
  it("passes a server-only exact-true decision into a default-off client prop", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(app)/budget/page.tsx"),
      "utf8",
    );
    const budget = readFileSync(
      resolve(
        process.cwd(),
        "src/components/app/budget/BudgetContent.tsx",
      ),
      "utf8",
    );

    expect(page).not.toContain('"use client"');
    expect(page).toContain("isWeddingPaymentLedgerEnabled()");
    expect(page).toContain("paymentLedgerEnabled=");
    expect(budget).toMatch(/paymentLedgerEnabled\s*=\s*false/u);
    expect(budget).toContain(
      "{paymentLedgerEnabled && <PaymentLedger />}",
    );
  });
});
