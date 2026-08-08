// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import WeddingCourtClient from "./WeddingCourtClient";
import WeddingCourtPage from "./page";

const originalWeddingCourtFlag = process.env.WEDDING_COURT_ENABLED;

describe("WeddingCourtPage rollout guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEDDING_COURT_ENABLED;
  });

  afterAll(() => {
    if (originalWeddingCourtFlag === undefined) {
      delete process.env.WEDDING_COURT_ENABLED;
    } else {
      process.env.WEDDING_COURT_ENABLED = originalWeddingCourtFlag;
    }
  });

  it("fails closed to not found when the server flag is missing", () => {
    expect(() => WeddingCourtPage()).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders the court only for exact true", () => {
    process.env.WEDDING_COURT_ENABLED = "true";

    const result = WeddingCourtPage();

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(result.type).toBe(WeddingCourtClient);
  });
});
