import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_LETTER, LETTER_COPY, SELF_SEND_COPY, type LetterModel } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationLetterSheet from "../InvitationLetterSheet";
import { buttonNamed, cleanup, click, linkNamed, pressKey, render, testPhoto, testRoute, text } from "./dom";

const noop = () => undefined;

function renderLetter(model: LetterModel = EXAMPLE_LETTER, overrides: Partial<React.ComponentProps<typeof InvitationLetterSheet>> = {}) {
  return render(
    <InvitationLetterSheet model={model} resolveRoute={testRoute} onToggleShare={noop} photoSrc={testPhoto} {...overrides} />,
  );
}

/** 보내기 전 편지 확인(`Approve.dc`). 대화상자 역할·스위치·보내기 흐름을 본다. */
describe("InvitationLetterSheet", () => {
  afterEach(cleanup);

  it("이름 붙은 대화상자이고, 열리면 초점이 대화상자로 간다", async () => {
    const { container } = await renderLetter();

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe(LETTER_COPY.dialogLabel);
    expect(document.activeElement).toBe(dialog);
    expect(dialog?.getAttribute("tabindex")).toBe("-1");
  });

  it("받는 곳 수로 묻고, 편지의 받는 이·날짜·본문·서명을 그대로 보인다", async () => {
    const { container } = await renderLetter();

    expect(text(container.querySelector("h1"))).toBe(LETTER_COPY.title(2));
    expect(container.textContent).toContain("소담 하우스, 가온 웨딩홀께");
    expect(container.textContent).toContain("11. 15");
    expect(container.textContent).toContain(EXAMPLE_LETTER.body);
    expect(container.textContent).toContain("민지와 준호 드림");
    const backdrop = container.querySelector("img");
    expect(backdrop?.getAttribute("src")).toBe("/photos/hall-sample-garden.webp");
    expect(backdrop?.getAttribute("alt")).toBe("");
  });

  it("알려줄 정보는 스위치이고 aria-checked 가 모델을 따른다. 끈 정보는 알려주지 않는다고 쓴다", async () => {
    const { container } = await renderLetter();

    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches.map((node) => node.getAttribute("aria-label"))).toEqual([
      LETTER_COPY.switchLabel("이름"),
      LETTER_COPY.switchLabel("휴대폰 번호"),
      LETTER_COPY.switchLabel("예산"),
    ]);
    expect(switches.map((node) => node.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    expect(text(container.querySelector('[data-share="name"]'))).toContain("김민지");
    expect(text(container.querySelector('[data-share="budget"]'))).toContain(LETTER_COPY.notShared);
    expect(text(container.querySelector('[data-share="budget"]'))).not.toContain(LETTER_COPY.budgetUnset);
    expect(switches[0].className).toContain("justify-end!");
    expect(switches[2].className).toContain("justify-start!");
  });

  it("스위치를 누르면 그 정보를 알린다", async () => {
    const onToggleShare = vi.fn();
    const { container } = await renderLetter(EXAMPLE_LETTER, { onToggleShare });

    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    expect(onToggleShare).toHaveBeenCalledExactlyOnceWith("budget");
  });

  it("상대가 읽었으면 그 문장을, 아니면 아무것도 쓰지 않는다", async () => {
    const { container } = await renderLetter();
    expect(container.textContent).toContain(LETTER_COPY.partnerRead("준호"));

    await cleanup();
    const second = await renderLetter({ ...EXAMPLE_LETTER, partnerApprovedName: null });
    expect(second.container.textContent).not.toContain("읽고 좋다고 했어요");
  });

  it("보내기와 나중에: 기본은 상담 확정·비교로 가는 링크다", async () => {
    const { container } = await renderLetter();

    expect(linkNamed(container, LETTER_COPY.send(2)).getAttribute("href")).toBe("/test/status");
    expect(linkNamed(container, LETTER_COPY.later).getAttribute("href")).toBe("/test/compare");
  });

  it("넘겨준 일이 있으면 보내기·나중에·문구 고치기가 그 일을 한다", async () => {
    const onSend = vi.fn();
    const onLater = vi.fn();
    const onEditText = vi.fn();
    const { container } = await renderLetter(EXAMPLE_LETTER, { onSend, onLater, onEditText });

    await click(buttonNamed(container, LETTER_COPY.send(2)));
    await click(buttonNamed(container, LETTER_COPY.later));
    await click(buttonNamed(container, LETTER_COPY.editText));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onLater).toHaveBeenCalledOnce();
    expect(onEditText).toHaveBeenCalledOnce();
  });

  it("직접 보내기(D-83 1단계) 글자: 제목과 아래 단추 글자를 바꾸고 상대가 읽었다는 줄을 숨긴다. 넘기지 않으면 아티팩트 그대로다", async () => {
    const onSend = vi.fn();
    const { container } = await renderLetter(EXAMPLE_LETTER, {
      onSend,
      title: SELF_SEND_COPY.title(2),
      sendLabel: SELF_SEND_COPY.save,
      hidePartnerRead: true,
    });
    expect(text(container.querySelector("h1"))).toBe(SELF_SEND_COPY.title(2));
    expect(container.textContent).not.toContain(LETTER_COPY.partnerRead("준호"));
    expect(container.textContent).not.toContain(LETTER_COPY.send(2));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(onSend).toHaveBeenCalledOnce();
    // 나중에 할게요는 그대로다.
    expect(linkNamed(container, LETTER_COPY.later).getAttribute("href")).toBe("/test/compare");

    await cleanup();
    const second = await renderLetter(EXAMPLE_LETTER, { sendLabel: SELF_SEND_COPY.save });
    // 보낼 일을 넘기지 않으면 같은 글자의 링크이고, 상대가 읽었다는 줄은 숨기라고 하지 않았으니 보인다.
    expect(linkNamed(second.container, SELF_SEND_COPY.save).getAttribute("href")).toBe("/test/status");
    expect(text(second.container.querySelector("h1"))).toBe(LETTER_COPY.title(2));
    expect(second.container.textContent).toContain(LETTER_COPY.partnerRead("준호"));
  });

  it("Esc 는 나중에 할게요와 같다", async () => {
    const onLater = vi.fn();
    const { container } = await renderLetter(EXAMPLE_LETTER, { onLater });
    await pressKey(container.querySelector('[role="dialog"]'), "Escape");
    expect(onLater).toHaveBeenCalledOnce();

    await cleanup();
    const second = await renderLetter();
    const later = linkNamed(second.container, LETTER_COPY.later);
    const followed = vi.fn((event: Event) => event.preventDefault());
    later.addEventListener("click", followed);
    await pressKey(second.container.querySelector('[role="dialog"]'), "Escape");
    expect(followed).toHaveBeenCalledOnce();
  });
});
