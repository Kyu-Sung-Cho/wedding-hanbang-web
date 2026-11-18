import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_FIRST_CHAT, FIRST_CHAT_COPY } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationFirstChat from "../InvitationFirstChat";
import { allButtons, buttonNamed, cleanup, click, linkNamed, render, testRoute, text } from "./dom";

const noop = () => undefined;

function renderChat(overrides: Partial<React.ComponentProps<typeof InvitationFirstChat>> = {}) {
  return render(
    <InvitationFirstChat
      model={EXAMPLE_FIRST_CHAT}
      stage="start"
      month={5}
      onPickStage={noop}
      onPickMonth={noop}
      resolveRoute={testRoute}
      {...overrides}
    />,
  );
}

/** 첫 대화(`Chat.dc`). 고른 값은 부모가 들고, 화면은 고르기를 알리고 그 값을 그린다. */
describe("InvitationFirstChat", () => {
  afterEach(cleanup);

  it("준비 단계 칩: 고른 칩만 눌림이고, 누르면 그 단계를 알린다", async () => {
    const onPickStage = vi.fn();
    const { container } = await renderChat({ onPickStage });

    const chips = FIRST_CHAT_COPY.stages.map((stage) => buttonNamed(container, stage.label));
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(chips[0].className).toContain("bg-inv-ink");
    expect(chips[1].className).toContain("border-inv-chip-line");

    await click(chips[1]);
    expect(onPickStage).toHaveBeenCalledExactlyOnceWith("researching");
  });

  it("사람 말풍선은 고른 단계의 대답이다", async () => {
    const { container, rerender } = await renderChat();
    expect(container.textContent).toContain("이제 시작이에요");

    await rerender(
      <InvitationFirstChat
        model={EXAMPLE_FIRST_CHAT}
        stage="booked"
        month={5}
        onPickStage={noop}
        onPickMonth={noop}
        resolveRoute={testRoute}
      />,
    );
    expect(container.textContent).toContain("이미 예약한 곳이 있어요");
    expect(container.textContent).not.toContain("이제 시작이에요");
  });

  it("달 고르기: 여덟 달, 고른 달만 눌림, 누르면 그 달을 알린다", async () => {
    const onPickMonth = vi.fn();
    const { container } = await renderChat({ onPickMonth });

    const months = FIRST_CHAT_COPY.months.map((month) => buttonNamed(container, FIRST_CHAT_COPY.monthLabel(month)));
    expect(months).toHaveLength(8);
    expect(months.filter((button) => button.getAttribute("aria-pressed") === "true").map(text)).toEqual(["5월"]);

    await click(buttonNamed(container, "10월"));
    expect(onPickMonth).toHaveBeenCalledExactlyOnceWith(10);
    expect(text(container)).toContain(String(EXAMPLE_FIRST_CHAT.year));
    expect(text(container)).toContain(FIRST_CHAT_COPY.monthsNote);
  });

  it("청첩장 초안의 달은 고른 달을 따르고, 고르기 전에는 빈칸이다", async () => {
    const { container, rerender } = await renderChat();
    const draft = () => text(container.querySelector('[data-invitation-card="draft"]'));
    expect(draft()).toContain("민지 그리고 준호");
    expect(draft()).toContain("2027. 05. __");
    expect(draft()).toContain(FIRST_CHAT_COPY.draftLine("서울", 200));

    const props = {
      model: EXAMPLE_FIRST_CHAT,
      stage: "start" as const,
      onPickStage: noop,
      onPickMonth: noop,
      resolveRoute: testRoute,
    };
    await rerender(<InvitationFirstChat {...props} month={10} />);
    expect(draft()).toContain("2027. 10. __");

    await rerender(<InvitationFirstChat {...props} month={null} />);
    expect(draft()).toContain("2027. __. __");
  });

  it("지역과 하객 수는 모델에서 읽는다", async () => {
    const { container } = await renderChat();
    expect(container.textContent).toContain(FIRST_CHAT_COPY.regionGuestsAnswer("서울", 200));
  });

  it("아래 두 행동: 기본은 홈으로 가는 링크, 넘겨주면 그 일을 한다", async () => {
    const onEdit = vi.fn();
    const { container } = await renderChat({ onEdit });

    expect(linkNamed(container, FIRST_CHAT_COPY.confirm).getAttribute("href")).toBe("/test/home");
    await click(buttonNamed(container, FIRST_CHAT_COPY.edit));
    expect(onEdit).toHaveBeenCalledOnce();

    await cleanup();
    const onConfirm = vi.fn();
    const second = await renderChat({ onConfirm });
    await click(buttonNamed(second.container, FIRST_CHAT_COPY.confirm));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("뒤로 가기는 이름이 있고 기본은 홈, 넘겨준 주소가 있으면 그곳이다", async () => {
    const { container } = await renderChat();
    expect(linkNamed(container, FIRST_CHAT_COPY.back).getAttribute("href")).toBe("/test/home");

    await cleanup();
    const second = await renderChat({ backHref: "/landing" });
    expect(linkNamed(second.container, FIRST_CHAT_COPY.back).getAttribute("href")).toBe("/landing");
  });

  it("손으로 만든 단추가 없다: 모든 단추가 공유 버튼의 포커스 링을 갖는다", async () => {
    const { container } = await renderChat();
    for (const button of allButtons(container)) {
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.getAttribute("type")).toBe("button");
    }
  });
});
