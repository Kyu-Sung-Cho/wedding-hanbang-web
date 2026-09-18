// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommunityNav from "./CommunityNav";

// 정적 렌더는 zustand 의 초기 상태만 읽어서 `setState` 로는 로그인 상태를 만들 수 없다.
const auth = vi.hoisted(() => ({ profile: null as { id: string } | null }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: { profile: { id: string } | null }) => unknown) => selector({ profile: auth.profile }),
}));
// 로그인한 머리글은 사용자 메뉴를 그린다 — 라우터가 필요한 그 메뉴는 이 검사의 대상이 아니다.
vi.mock("@/components/community/UserMenu", () => ({ default: () => null }));

const brandHref = (html: string) => {
  const tag = /<a\b[^>]*aria-label="웨딩한방 홈으로 이동"[^>]*>/.exec(html)?.[0] ?? "";
  return /\shref="([^"]*)"/.exec(tag)?.[1];
};

describe("CommunityNav brand link", () => {
  afterEach(() => { auth.profile = null; });

  it("keeps the public community as home before sign-in", () => {
    expect(brandHref(renderToStaticMarkup(<CommunityNav weddingCourtEnabled={false} />))).toBe("/wedding");
  });

  it("sends a signed-in person to the wedding lounge, like the app sidebar", () => {
    auth.profile = { id: "p1" };
    expect(brandHref(renderToStaticMarkup(<CommunityNav weddingCourtEnabled={false} />))).toBe("/wedding/lounge");
  });
});

describe("CommunityNav wedding court rollout", () => {
  it("omits the wedding court navigation when the server disables it", () => {
    const html = renderToStaticMarkup(
      <CommunityNav weddingCourtEnabled={false} />,
    );

    expect(html).not.toContain("/community/wedding-court");
    expect(html).not.toContain("오늘의 웨딩 선택 법정");
  });

  it("shows the wedding court navigation when the server enables it", () => {
    const html = renderToStaticMarkup(
      <CommunityNav weddingCourtEnabled />,
    );

    expect(html).toContain("/community/wedding-court");
    expect(html).toContain("오늘의 웨딩 선택 법정");
  });
});
