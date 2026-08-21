import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BetaForm from "./BetaForm";

// 이 화면은 한때 신부/신랑을 **필수**로 물었다. 중립 준비 공간이 켜진 뒤
// 온보딩은 역할을 묻지 않으므로, 사전등록에서만 묻는 것은 제품과 어긋나고
// 어느 쪽도 고르지 않으려는 사람의 신청 자체를 막았다.
// 남는 사실은 "한 공간에 두 사람"이라는 정원 제한뿐이다.
describe("BetaForm role support boundary", () => {
  it("성별 역할을 묻지 않는다", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <BetaForm current={0} total={50} progress={0} />,
    );
    const html = container.innerHTML;

    expect(html).not.toContain("신부");
    expect(html).not.toContain("신랑");
    // 역할 선택 fieldset 자체가 없어야 한다 — 라벨만 바꾸고 남겨두면
    // 같은 강제가 다른 이름으로 돌아온다.
    expect(
      container.querySelector('fieldset[aria-describedby="beta-role-support-note"]'),
    ).toBeNull();
    expect([...container.querySelectorAll("legend")].map((n) => n.textContent))
      .not.toContain("역할");
  });

  it("지원 범위 고지는 그대로 남는다", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <BetaForm current={0} total={50} progress={0} />,
    );

    const note = container.querySelector("#beta-role-support-note");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(
      "지금은 한 공간에서 두 사람이 함께 준비하는 구성부터 지원해요.",
    );
    expect(note?.textContent).toContain(
      "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
    );
  });

  it("예식일을 2026년 안으로 가두지 않는다", () => {
    const html = renderToStaticMarkup(
      <BetaForm current={0} total={50} progress={0} />,
    );

    // 2026-06-01 ~ 2026-12-31 하드코딩 탓에 2027년 예식은 입력조차 못 했다.
    expect(html).not.toContain("2026년 6~12월");
    expect(html).not.toContain("2026-06-01");
    expect(html).not.toContain("2026-12-31");
  });
});
