import { describe, expect, it } from "vitest";

import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";

describe("weddingPath", () => {
  it.each([
    "/wedding?sort=top&period=week",
    "/wedding#community-feed",
    "/wedding/community/cohort",
  ])("keeps an already visible wedding URL idempotent: %s", (path) => {
    expect(weddingPath(path)).toBe(path);
  });

  it("does not duplicate the wedding prefix in link props", () => {
    expect(weddingLinkProps("/wedding?sort=top&period=week")).toEqual({
      href: "/community?sort=top&period=week",
      as: "/wedding?sort=top&period=week",
      prefetch: false,
    });
  });

  it("keeps a checklist category route internal while exposing its canonical URL", () => {
    expect(weddingLinkProps("/checklist/meeting")).toEqual({
      href: "/checklist/meeting",
      as: "/wedding/checklist/meeting",
      prefetch: false,
    });
  });
});
