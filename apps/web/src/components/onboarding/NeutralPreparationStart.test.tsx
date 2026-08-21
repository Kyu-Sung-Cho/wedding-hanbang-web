import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NeutralPreparationStart from "./NeutralPreparationStart";

// 이 화면이 묻는 것과 안 묻는 것은 운영 실측으로 정했다(52건):
// 예식일 87% · 예산 44% · 체크리스트 42% · 장소 17% · 스타일 10%.
// 예식일만 남긴 이유는 응답률이 아니라 **아모라가 대신 받아낼 수 없다**는 것이다.
function render(overrides: Partial<Parameters<typeof NeutralPreparationStart>[0]> = {}) {
  return renderToStaticMarkup(
    <NeutralPreparationStart
      coupleAction={null}
      partnerCode=""
      loading={false}
      onCreate={vi.fn()}
      onSelectJoin={vi.fn()}
      onPartnerCodeChange={vi.fn()}
      onJoin={vi.fn()}
      weddingDate=""
      onWeddingDateChange={vi.fn()}
      focusPriority={null}
      onFocusPriorityChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("NeutralPreparationStart", () => {
  it("offers roleless create and join", () => {
    const html = render();

    expect(html).toContain("역할을 정하지 않아도 시작할 수 있어요");
    expect(html).toContain("아모라와 지금 시작하기");
    expect(html).toContain("초대 코드로 함께 시작하기");
    expect(html).not.toContain("신부");
    expect(html).not.toContain("신랑");
    expect(html).not.toContain("자동으로 저장");
  });

  it("화면에서 묻는 것과 부제가 어긋나지 않는다", () => {
    const html = render();

    // 예식일을 여기서 물으므로 "예식일은 나중에"는 거짓이 된다.
    expect(html).not.toContain("예식일·장소·예산은 나중에");
    expect(html).toContain("장소·예산은 나중에");
    expect(html).toContain("결혼식 날짜, 정하셨어요?");
    // 안 묻기로 한 것이 슬그머니 돌아오지 않는지
    expect(html).not.toContain("총 예산");
    expect(html).not.toContain("예식 장소");
  });

  it("예식일은 비워 두고 시작할 수 있다", () => {
    const container = document.createElement("div");
    container.innerHTML = render();

    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).not.toBeNull();
    expect(dateInput?.hasAttribute("required")).toBe(false);
    // 시작 버튼이 날짜 때문에 잠기면 안 된다 — 마찰 증가 0이 이 설계의 조건이다.
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("아모라와 지금 시작하기"),
    );
    expect(startButton?.hasAttribute("disabled")).toBe(false);
  });

  it("관심사는 6개 중 하나만 고르고, 고른 것이 눌린 상태로 보인다", () => {
    const container = document.createElement("div");
    container.innerHTML = render({ focusPriority: "housing" });

    const pressed = Array.from(container.querySelectorAll('[aria-pressed="true"]'));
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain("신혼집");

    const chips = container.querySelectorAll("[aria-pressed]");
    expect(chips).toHaveLength(6);
  });

  it("shows one bounded join input and an explicit submit action", () => {
    const container = document.createElement("div");
    container.innerHTML = render({ coupleAction: "join", partnerCode: "WH-AB12CD" });

    // 개수를 세지 않는다 — 날짜 입력이 생기면서 개수 단정은 의미를 잃었다.
    // 지켜야 하는 것은 "초대 코드 입력이 정확히 하나이고 길이가 제한된다"이다.
    const codeInputs = container.querySelectorAll("#neutral-partner-code");
    expect(codeInputs).toHaveLength(1);
    expect(codeInputs[0]?.getAttribute("value")).toBe("WH-AB12CD");
    expect(codeInputs[0]?.hasAttribute("maxlength")).toBe(true);
    expect(container.innerHTML).toContain("이 코드로 함께 시작하기");
  });
});
