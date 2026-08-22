import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ImminentAlerts from "@/components/app/schedule/ImminentAlerts";
import type { ImminentCategory } from "@/utils/imminentChecklist";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 「날짜를 정할 항목」 패널이 이름값을 하는지 본다.
 *
 * 이 패널은 일정 화면에서 체크리스트가 아닌 거의 유일한 부분인데, 셋이 어긋나 있었다.
 *
 * 1. **날짜를 정할 방법이 없었다.** 행을 누르면 체크리스트 창이 열렸다
 *    (`ScheduleContent`의 `handleCategoryClick` → `CategoryChecklistModal`). 날짜를 잡으려면
 *    화면 위 `일정 추가`로 가서 분야를 처음부터 다시 골라야 했다 — 패널은 어느 분야인지
 *    이미 아는데도.
 * 2. **이미 날짜를 잡은 분야에도 "일정 필요"라고 말했다.** 행 배지가 `hasScheduledEvent`를
 *    보지 않고 늘 그려졌다. 머리의 개수는 날짜 없는 것만 세므로 둘이 서로 다른 말을 했다.
 * 3. **머리 개수가 뒤처진 커플에게만 보였다.** 배지가 "지남·급함이 하나라도 있을 때" 안에
 *    중첩돼 있어서, 마감을 아직 넘기지 않은 커플 — 즉 미리 알려줘야 할 사람 — 은 못 봤다.
 *
 * 문구가 아니라 **동작과 DOM**으로 고정한다. 소스에 무슨 낱말이 있는지 검사하면 조건을
 * 뒤집어도 통과한다 — 같은 저장소의 `socialProviderRender.test.tsx`가 그 교훈을 적어 두었다.
 */
describe("날짜를 정할 항목 패널", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function category(overrides: Partial<ImminentCategory> = {}): ImminentCategory {
    return {
      key: "venue",
      label: "결혼식장",
      icon: "Building2",
      status: "in_progress",
      doneCount: 2,
      totalCount: 9,
      deadlineDaysLeft: 45,
      hasScheduledEvent: false,
      urgency: "soon",
      ...overrides,
    };
  }

  function draw(items: ImminentCategory[], handlers: {
    onCategoryClick?: (key: string) => void;
    onScheduleClick?: (key: string) => void;
  } = {}) {
    act(() => {
      root.render(
        <ImminentAlerts
          items={items}
          onCategoryClick={handlers.onCategoryClick ?? (() => {})}
          onScheduleClick={handlers.onScheduleClick ?? (() => {})}
        />,
      );
    });
  }

  const buttons = () => Array.from(container.querySelectorAll("button"));
  const buttonWith = (text: string) =>
    buttons().find((button) => (button.textContent ?? "").includes(text));
  const click = (button: HTMLButtonElement) => {
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("패널이 실제로 그려진다", () => {
    // 아무것도 안 그려지면 아래 검사들이 빈 DOM을 보며 늘 통과한다. 먼저 확인한다.
    draw([category()]);
    expect(container.textContent).toContain("결혼식장");
    expect(buttons().length).toBeGreaterThan(1);
  });

  it("날짜가 없는 분야에서 바로 날짜를 잡을 수 있다", () => {
    const onScheduleClick = vi.fn();
    const onCategoryClick = vi.fn();
    draw([category()], { onScheduleClick, onCategoryClick });

    const scheduleButton = buttonWith("날짜 잡기");
    expect(scheduleButton, "「날짜 잡기」 버튼이 없다 — 패널이 이름값을 못 한다").toBeTruthy();
    click(scheduleButton as HTMLButtonElement);

    expect(onScheduleClick).toHaveBeenCalledWith("venue");
    // 날짜를 잡는 것과 체크리스트를 여는 것은 다른 일이다. 하나를 눌렀는데 둘 다
    // 일어나면 어느 쪽을 의도했는지 화면이 알 수 없다.
    expect(onCategoryClick).not.toHaveBeenCalled();
  });

  it("분야를 눌러 체크리스트를 보는 길은 그대로 남아 있다", () => {
    const onScheduleClick = vi.fn();
    const onCategoryClick = vi.fn();
    draw([category()], { onScheduleClick, onCategoryClick });

    const infoButton = buttons().find(
      (button) => (button.textContent ?? "").includes("결혼식장"),
    );
    expect(infoButton).toBeTruthy();
    click(infoButton as HTMLButtonElement);

    expect(onCategoryClick).toHaveBeenCalledWith("venue");
    expect(onScheduleClick).not.toHaveBeenCalled();
  });

  it("이미 날짜를 잡은 분야는 일정이 필요하다고 말하지 않는다", () => {
    draw([category({ hasScheduledEvent: true })]);

    expect(container.textContent).not.toContain("일정 필요");
    expect(buttonWith("날짜 잡기")).toBeUndefined();
  });

  it("마감을 안 넘긴 커플에게도 몇 건이 날짜가 없는지 알려준다", () => {
    // 셋 다 `soon` — 지남도 급함도 없다. 예전에는 이 경우 머리 개수가 통째로 숨었다.
    draw([
      category({ key: "venue", label: "결혼식장" }),
      category({ key: "studio", label: "웨딩 사진 촬영" }),
      category({ key: "dress", label: "드레스·예식 정장" }),
    ]);

    expect(container.textContent).toContain("3 일정 필요");
  });

  it("머리 개수와 행 배지가 같은 기준을 쓴다", () => {
    draw([
      category({ key: "venue", hasScheduledEvent: false }),
      category({ key: "studio", label: "웨딩 사진 촬영", hasScheduledEvent: true }),
    ]);

    expect(container.textContent).toContain("1 일정 필요");
    // 행 배지도 하나뿐이어야 머리와 본문이 같은 말을 한다.
    const rowBadges = Array.from(container.querySelectorAll("span")).filter(
      (span) => span.textContent === "일정 필요",
    );
    expect(rowBadges).toHaveLength(1);
  });
});
