import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RoleSelection from "./RoleSelection";

describe("RoleSelection beta support boundary", () => {
  it("states the current two-role limit and the privacy-safe expansion direction", () => {
    const html = renderToStaticMarkup(
      <RoleSelection selected={null} onSelect={vi.fn()} />,
    );

    expect(html).toContain(
      "현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.",
    );
    expect(html).toContain(
      "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
    );
  });

  it("exposes the support notice and selected role to assistive technology", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <RoleSelection selected="bride" onSelect={vi.fn()} />,
    );

    expect(
      container.querySelector(
        'section[aria-labelledby="couple-role-heading"][aria-describedby="couple-role-support-note"]',
      ),
    ).not.toBeNull();

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.getAttribute("type"))).toEqual([
      "button",
      "button",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
  });
});
