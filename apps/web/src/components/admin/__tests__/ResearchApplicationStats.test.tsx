import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResearchApplicationStats from "../ResearchApplicationStats";

describe("ResearchApplicationStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T14:00:00.000Z"));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("shows zero for a quiet KST today and averages over all seven calendar days", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ResearchApplicationStats
        totalCount={8}
        pendingVerificationCount={2}
        dailyCounts={[{ date: "2026-07-11", count: 8 }]}
      />
    );

    expect(document.querySelector('[data-testid="research-today-count"]')?.textContent).toBe("0");
    expect(
      document.querySelector('[data-testid="research-seven-day-average"]')?.textContent
    ).toBe("1");
  });
});
