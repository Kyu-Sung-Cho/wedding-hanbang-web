import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const middlewareMock = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock("@/lib/supabase/middleware", () => middlewareMock);

import { proxy } from "./proxy";

describe("proxy WeddingCode capability-token containment", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  it.each(["/wedding-code", "/wedding-code/result"])(
    "removes ct before rendering or redirecting %s",
    async (pathname) => {
      const response = await proxy(
        new NextRequest(
          `https://hanbang.ai${pathname}?ct=sensitive-capability-token&utm_source=legacy-invite`
        )
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://hanbang.ai/wedding-code?utm_source=legacy-invite"
      );
      expect(response.headers.get("location")).not.toContain("ct=");
      expect(response.headers.get("location")).not.toContain(
        "sensitive-capability-token"
      );
      expect(middlewareMock.updateSession).not.toHaveBeenCalled();
    }
  );

  it("redirects the retired result route before its React tree can stream", async () => {
    const response = await proxy(
      new NextRequest(
        "https://hanbang.ai/wedding-code/result?utm_source=saved-result"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding-code?utm_source=saved-result"
    );
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("keeps ordinary WeddingCode campaign parameters and continues session handling", async () => {
    const request = new NextRequest(
      "https://hanbang.ai/wedding-code?utm_source=validation-notice"
    );

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });
});
