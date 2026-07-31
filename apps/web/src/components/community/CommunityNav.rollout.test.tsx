// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CommunityNav from "./CommunityNav";

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
