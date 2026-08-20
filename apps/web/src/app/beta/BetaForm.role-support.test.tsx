import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BetaForm from "./BetaForm";

describe("BetaForm role support boundary", () => {
  it("shows the current role limit before a person applies", () => {
    const html = renderToStaticMarkup(
      <BetaForm current={0} total={50} progress={0} />,
    );

    expect(html).toContain(
      "현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.",
    );
    expect(html).toContain(
      "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
    );
  });

  it("associates the limitation notice with the two available role choices", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <BetaForm current={0} total={50} progress={0} />,
    );

    const group = container.querySelector(
      'fieldset[aria-describedby="beta-role-support-note"]',
    );
    expect(group).not.toBeNull();
    expect(group?.querySelector("legend")?.textContent).toContain("역할");

    const roleButtons = [...(group?.querySelectorAll("button") ?? [])];
    expect(roleButtons).toHaveLength(2);
    expect(roleButtons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
    ]);
  });
});
