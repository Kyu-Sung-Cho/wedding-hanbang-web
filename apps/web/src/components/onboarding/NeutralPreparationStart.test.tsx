import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NeutralPreparationStart from "./NeutralPreparationStart";

describe("NeutralPreparationStart", () => {
  it("offers roleless create and join without requiring wedding details", () => {
    const html = renderToStaticMarkup(
      <NeutralPreparationStart
        coupleAction={null}
        partnerCode=""
        loading={false}
        onCreate={vi.fn()}
        onSelectJoin={vi.fn()}
        onPartnerCodeChange={vi.fn()}
        onJoin={vi.fn()}
      />,
    );

    expect(html).toContain("역할을 정하지 않아도 시작할 수 있어요");
    expect(html).toContain("아모라와 지금 시작하기");
    expect(html).toContain("초대 코드로 함께 시작하기");
    expect(html).toContain("예식일·장소·예산은 나중에");
    expect(html).not.toContain("신부");
    expect(html).not.toContain("신랑");
    expect(html).not.toContain("자동으로 저장");
  });

  it("shows one bounded join input and an explicit submit action", () => {
    const html = renderToStaticMarkup(
      <NeutralPreparationStart
        coupleAction="join"
        partnerCode="WH-AB12CD"
        loading={false}
        onCreate={vi.fn()}
        onSelectJoin={vi.fn()}
        onPartnerCodeChange={vi.fn()}
        onJoin={vi.fn()}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector("input")?.getAttribute("value")).toBe("WH-AB12CD");
    expect(html).toContain("이 코드로 함께 시작하기");
  });
});
