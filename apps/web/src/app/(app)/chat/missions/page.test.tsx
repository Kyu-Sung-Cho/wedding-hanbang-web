import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import AmoraMissionsPage from "./page";

describe("legacy missions destination", () => {
  it("opens the named lounge mission section without mounting another mission reader", () => {
    AmoraMissionsPage();
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/wedding/lounge#today-missions");
  });
});
