import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureEvent } from "@/lib/analytics";
import { captureCourtEvent } from "../analytics";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

describe("couple court analytics privacy", () => {
  beforeEach(() => {
    vi.mocked(captureEvent).mockClear();
  });

  it("forwards only approved low-cardinality properties", () => {
    const attemptedProperties = {
      mode: "couple",
      category: "budget",
      tone: "gentle",
      status: "initial",
      caseId: "must-not-leave-the-browser",
      title: "private case title",
    };

    captureCourtEvent("couple_court_statement_submit", attemptedProperties);

    expect(captureEvent).toHaveBeenCalledWith("couple_court_statement_submit", {
      mode: "couple",
      category: "budget",
      tone: "gentle",
      status: "initial",
    });
  });

  it("drops unrecognized values instead of forwarding free text", () => {
    captureCourtEvent("couple_court_safety_redirect", {
      mode: "private raw mode",
      category: "010-1234-5678",
      tone: "private raw tone",
      status: "private raw status",
    });

    expect(captureEvent).toHaveBeenCalledWith("couple_court_safety_redirect", {});
  });
});
