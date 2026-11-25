import { describe, expect, it } from "vitest";

import { stripWeddingBasePath, weddingLinkProps, weddingPath } from "@/lib/weddingPaths";

describe("weddingPath", () => {
  it.each([
    "/wedding?sort=top&period=week",
    "/wedding#top",
    "/wedding/lounge",
    "/wedding/community/cohort",
  ])("keeps an already visible wedding URL idempotent: %s", (path) => {
    expect(weddingPath(path)).toBe(path);
  });

  it("does not duplicate the wedding prefix in link props", () => {
    expect(weddingLinkProps("/wedding/lounge")).toEqual({
      href: "/lounge",
      as: "/wedding/lounge",
      prefetch: false,
    });
  });

  // 2026-11-22 커뮤니티를 닫기 전에는 빈 값과 `/community` 가 둘 다 커뮤니티 피드(`/wedding`)였다.
  // 지금 `/wedding` 은 라운지·랜딩으로 가는 문이고, 커뮤니티 주소는 '닫았어요' 화면 아래로 간다.
  it("treats an empty path as the /wedding door, not the community feed", () => {
    expect(weddingPath()).toBe("/wedding");
    expect(weddingLinkProps()).toEqual({ href: "/wedding" });
    expect(stripWeddingBasePath("/wedding")).toBe("/wedding");
    expect(stripWeddingBasePath("/wedding/")).toBe("/wedding");
  });

  it("sends community paths under /wedding/community like any other route", () => {
    expect(weddingPath("/community")).toBe("/wedding/community");
    expect(weddingPath("/community?feed=all")).toBe("/wedding/community?feed=all");
  });

  it("links the moved quote-check tool under /wedding/quote-check", () => {
    expect(weddingLinkProps("/quote-check")).toEqual({
      href: "/quote-check",
      as: "/wedding/quote-check",
      prefetch: false,
    });
  });
});
