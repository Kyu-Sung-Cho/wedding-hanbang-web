import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("retired congratulatory-money page", () => {
  it("shows only the unavailable surface and cannot load or collect ledger data", () => {
    const page = read("src/app/(app)/money/page.tsx");

    expect(page).toContain('<PublicBetaUnavailable feature="money" />');
    expect(page).not.toMatch(/useMoneyStore|CongratulatoryMoney|handleExportCSV|fetch\(|guest_name|amount/);
  });
});
