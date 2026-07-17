import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProactiveCare } from "../requestProactiveCare";

describe("requestProactiveCare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a same-origin non-cacheable POST for the proactive-care mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestProactiveCare();

    expect(fetchMock).toHaveBeenCalledWith("/api/chat/proactive", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("does not surface a network failure into the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(requestProactiveCare()).resolves.toBeUndefined();
  });
});
