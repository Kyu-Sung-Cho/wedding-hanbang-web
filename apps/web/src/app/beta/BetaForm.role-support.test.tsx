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
      <BetaForm current={0} />,
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
      <BetaForm current={0} />,
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

  it("없는 정원과 마감을 만들어내지 않는다", () => {
    // "N / 50쌍" 과 진척 막대, 그리고 50건을 넘으면 뜨는 "마감되었어요" 화면이
    // 있었다. 세는 것은 preregistrations 의 이메일 행이지 커플이 아니고,
    // 50 은 정원이 아니다 — 심사도 정원도 없고 계정은 승인 없이 바로 만든다.
    // 없는 희소성으로 사람을 돌려보내면 안 된다.
    const counterShown = renderToStaticMarkup(<BetaForm current={42} />);
    expect(counterShown).not.toContain("쌍");
    expect(counterShown).not.toContain("/ 50");
    expect(counterShown).toContain("지금까지 사전등록");

    // 넘쳐도 문을 닫지 않는다.
    const overCapacity = renderToStaticMarkup(<BetaForm current={999} />);
    expect(overCapacity).not.toContain("마감");
    expect(overCapacity).toContain("이메일");
  });

  it("예식일을 2026년 안으로 가두지 않는다", () => {
    const html = renderToStaticMarkup(
      <BetaForm current={0} />,
    );

    // 2026-06-01 ~ 2026-12-31 하드코딩 탓에 2027년 예식은 입력조차 못 했다.
    expect(html).not.toContain("2026년 6~12월");
    expect(html).not.toContain("2026-06-01");
    expect(html).not.toContain("2026-12-31");
  });
});
