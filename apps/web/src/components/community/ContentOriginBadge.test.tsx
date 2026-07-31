import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContentOriginBadge from "./ContentOriginBadge";
import {
  getContentOriginPresentation,
  normalizeCommunityContentOrigin,
} from "@/lib/community/contentOrigin";

describe("ContentOriginBadge", () => {
  it.each([
    ["member", "일반 회원 · 경험 미인증"],
    ["operator", "웨딩한방 운영팀"],
    ["ai", "AI 생성"],
    ["industry_professional", "업계 종사자"],
    ["legacy_unverified", "출처 확인 전"],
  ] as const)("renders the DB origin %s without inference", (origin, label) => {
    const markup = renderToStaticMarkup(
      <ContentOriginBadge origin={origin} />,
    );

    expect(markup).toContain(`data-content-origin="${origin}"`);
    expect(markup).toContain(label);
  });

  it("fails closed to legacy_unverified for a missing or unknown DB value", () => {
    expect(normalizeCommunityContentOrigin(undefined)).toBe(
      "legacy_unverified",
    );
    expect(normalizeCommunityContentOrigin("verified_member")).toBe(
      "legacy_unverified",
    );
    expect(getContentOriginPresentation(null).label).toBe("출처 확인 전");

    const markup = renderToStaticMarkup(
      <ContentOriginBadge origin={undefined} />,
    );
    expect(markup).toContain('data-content-origin="legacy_unverified"');
    expect(markup).toContain("출처 확인 전");
  });
});
