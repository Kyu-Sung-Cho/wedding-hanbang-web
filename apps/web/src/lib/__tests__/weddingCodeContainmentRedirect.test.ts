import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("WeddingCode containment redirect", () => {
  it("redirects the retired result page before rendering its route", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/wedding-code/result",
      destination: "/wedding-code",
      permanent: false,
    });
  });
});
