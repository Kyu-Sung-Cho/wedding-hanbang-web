import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import { useCommunityRealtime } from "../useCommunityRealtime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useCommunityRealtime();
  return null;
}

describe("useCommunityRealtime", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps the ordinary feed alive when realtime setup throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.createClient.mockImplementation(() => {
      throw new Error("realtime unavailable");
    });

    expect(() => {
      act(() => root.render(<Harness />));
    }).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[community.realtime] subscription unavailable; continuing without realtime.",
    );
  });
});
