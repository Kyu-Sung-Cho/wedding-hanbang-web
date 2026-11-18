import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_CONSULTATION, STATUS_COPY } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationConsultation from "../InvitationConsultation";
import { buttonNamed, cleanup, click, linkNamed, render, testPhoto, testRoute, text } from "./dom";

/** 답장과 상담 확정(`Status.dc`). 확정 카드·사진 위 칩·아모라 소식·물어볼 것을 본다. */
describe("InvitationConsultation", () => {
  afterEach(cleanup);

  it("확정 카드에 날짜·시간·장소를 그대로 보인다", async () => {
    const { container } = await render(
      <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={testRoute} photoSrc={testPhoto} />,
    );

    const card = container.querySelector("article");
    expect(text(card)).toContain(STATUS_COPY.eyebrow);
    expect(text(card)).toContain("11. 22");
    expect(text(card)).toContain("일요일 오전 11시");
    expect(text(card)).toContain("소담 하우스");
    expect(text(card)).toContain("서울 마포구, 2층 상담실");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/photos/hall-sample-garden.webp");
  });

  it("사진 위 칩 둘: 상대 이름이 있을 때만 공유 칩이 있고, 누르면 알린다", async () => {
    const onOpenCalendar = vi.fn();
    const onShareWithPartner = vi.fn();
    const { container } = await render(
      <InvitationConsultation
        model={EXAMPLE_CONSULTATION}
        resolveRoute={testRoute}
        onOpenCalendar={onOpenCalendar}
        onShareWithPartner={onShareWithPartner}
      />,
    );

    await click(buttonNamed(container, STATUS_COPY.inCalendar));
    await click(buttonNamed(container, STATUS_COPY.shareWith("준호")));
    expect(onOpenCalendar).toHaveBeenCalledOnce();
    expect(onShareWithPartner).toHaveBeenCalledOnce();

    await cleanup();
    const solo = await render(
      <InvitationConsultation model={{ ...EXAMPLE_CONSULTATION, partnerName: null }} resolveRoute={testRoute} />,
    );
    expect(solo.container.textContent).not.toContain("님과 공유");
  });

  it("아모라 소식 아래 단추는 모델의 순서와 색을 따르고, 몇 번째인지 알린다", async () => {
    const onUpdateAction = vi.fn();
    const { container } = await render(
      <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={testRoute} onUpdateAction={onUpdateAction} />,
    );

    expect(container.textContent).toContain(EXAMPLE_CONSULTATION.update?.text);
    expect(container.textContent).toContain("오후 1:40");
    const request = buttonNamed(container, STATUS_COPY.requestThisTime);
    const other = buttonNamed(container, STATUS_COPY.askOtherTime);
    expect(request.className).toContain("bg-inv-ink");
    expect(other.className).toContain("border-inv-chip-line");

    await click(other);
    expect(onUpdateAction).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("물어볼 것은 번호 붙은 목록이다", async () => {
    const { container } = await render(
      <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={testRoute} />,
    );

    expect(text(container.querySelector("h2"))).toBe(STATUS_COPY.questionsHeading("소담 하우스"));
    const items = Array.from(container.querySelectorAll("ol > li"));
    expect(items.map((item) => text(item.querySelector("span")))).toEqual(["1", "2", "3", "4"]);
    expect(items.map((item) => text(item).slice(1).trim())).toEqual(EXAMPLE_CONSULTATION.questions);
  });

  it("뒤로 가기는 홈으로 간다", async () => {
    const { container } = await render(
      <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={testRoute} />,
    );
    expect(linkNamed(container, STATUS_COPY.back).getAttribute("href")).toBe("/test/home");
  });
});
