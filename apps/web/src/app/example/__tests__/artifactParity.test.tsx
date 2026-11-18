import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_COMPARE,
  EXAMPLE_CONSULTATION,
  EXAMPLE_FIRST_CHAT,
  EXAMPLE_HOME,
  EXAMPLE_JOURNEY,
  EXAMPLE_LETTER,
  EXAMPLE_WEB_SPACE,
  FIRST_CHAT_COPY,
  STATUS_COPY,
} from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationCompare from "@/components/invitation/InvitationCompare";
import InvitationConsultation from "@/components/invitation/InvitationConsultation";
import InvitationFirstChat from "@/components/invitation/InvitationFirstChat";
import InvitationHome from "@/components/invitation/InvitationHome";
import InvitationJourney from "@/components/invitation/InvitationJourney";
import InvitationLetterSheet from "@/components/invitation/InvitationLetterSheet";
import InvitationWebSpace from "@/components/invitation/InvitationWebSpace";
import { buttonNamed, cleanup, render, testPhoto, testRoute } from "@/components/invitation/__tests__/dom";

import ExampleLayout from "../layout";

/**
 * 아티팩트와 픽셀을 맞춘 값들. 2026-11-17 코디네이터가 같은 헤드리스 크롬으로 아티팩트와 예시 화면을
 * 찍어 비교했고(처음 차이: 홈 0.85%, 순서 0.73%, 상담 1.27%, 편지 4.10%, 대화 4.67%, 웹 8.50%,
 * 비교 11.64%), 원인 넷을 고친 뒤 여섯 화면이 0 픽셀, 비교가 글자 안티앨리어싱 703 픽셀만 남았다.
 * 여기 값은 그 원인들이다. 하나라도 되돌리면 화면이 아티팩트와 다시 어긋난다.
 */

const noop = () => undefined;
const DESCENDANT_WRAP = "[&_*]:[overflow-wrap:normal]!";

function classesOf(element: Element | null | undefined): string[] {
  return element?.getAttribute("class")?.split(/\s+/) ?? [];
}

const PHONE_SCREENS = {
  home: () => <InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />,
  chat: () => (
    <InvitationFirstChat
      model={EXAMPLE_FIRST_CHAT}
      stage="start"
      month={5}
      onPickStage={noop}
      onPickMonth={noop}
      resolveRoute={testRoute}
    />
  ),
  journey: () => (
    <InvitationJourney model={EXAMPLE_JOURNEY} resolveRoute={testRoute} onToggleStage={noop} onToggleAddOn={noop} />
  ),
  compare: () => (
    <InvitationCompare
      model={EXAMPLE_COMPARE}
      sort="total"
      onSort={noop}
      onToggleHall={noop}
      resolveRoute={testRoute}
      photoSrc={testPhoto}
    />
  ),
  letter: () => (
    <InvitationLetterSheet model={EXAMPLE_LETTER} resolveRoute={testRoute} onToggleShare={noop} photoSrc={testPhoto} />
  ),
  status: () => <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={testRoute} photoSrc={testPhoto} />,
} as const;

describe("아티팩트와 같은 글 흐름", () => {
  afterEach(cleanup);

  it.each(Object.keys(PHONE_SCREENS) as Array<keyof typeof PHONE_SCREENS>)(
    "%s: 한글을 음절 사이에서 줄바꿈하고 안쪽 요소의 끊기 규칙도 기본값이다",
    async (name) => {
      const { container } = await render(PHONE_SCREENS[name]());
      const root = container.querySelector(`[data-invitation-screen="${name}"]`);
      expect(classesOf(root)).toEqual(expect.arrayContaining(["break-normal", DESCENDANT_WRAP]));
    },
  );

  it("웹: 자기가 그리는 부분만 기본 글 흐름이고, 끼운 실제 대화는 앱 기본(낱말 단위)을 지킨다", async () => {
    const plain = await render(
      <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={testRoute} photoSrc={testPhoto} />,
    );
    const root = plain.container.querySelector('[data-invitation-screen="web"]');
    expect(classesOf(root)).toContain("break-normal");
    const [chat, space] = Array.from(plain.container.querySelectorAll("section"));
    expect(classesOf(space)).toContain(DESCENDANT_WRAP);
    expect(Array.from(chat.children).filter((part) => classesOf(part).includes(DESCENDANT_WRAP)).length).toBe(4);
    await cleanup();

    const slotted = await render(
      <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={testRoute}>
        <p data-real-chat>실제 대화</p>
      </InvitationWebSpace>,
    );
    const slot = slotted.container.querySelector("[data-invitation-chat-slot]");
    expect(classesOf(slot)).toContain("break-keep");
    for (let node = slot; node && node !== slotted.container; node = node.parentElement) {
      expect(classesOf(node)).not.toContain(DESCENDANT_WRAP);
    }
  });
});

describe("아티팩트의 content-box 크기를 바깥 크기로 옮긴다", () => {
  afterEach(cleanup);

  it("첫 대화 말풍선: 최대 폭 260 + 좌우 여백 32 = 292", async () => {
    const { container } = await render(PHONE_SCREENS.chat());
    const bubbles = Array.from(container.querySelectorAll("div")).filter(
      (div) => div.textContent === "이제 시작이에요" || div.textContent === FIRST_CHAT_COPY.regionGuestsAnswer("서울", 200),
    );
    expect(bubbles).toHaveLength(2);
    for (const bubble of bubbles) expect(classesOf(bubble)).toContain("max-w-[292px]");
  });

  it("편지 스위치 줄: 최소 높이 52 + 아래 선 1 = 53", async () => {
    const { container } = await render(PHONE_SCREENS.letter());
    const rows = Array.from(container.querySelectorAll("[data-share]"));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(classesOf(row)).toContain("min-h-[53px]");
  });

  it("웹: 머리 사진 330 + 위아래 72 = 402, 카드 360 + 16 = 376, 입력칸 44 + 기본 여백 2 = 46", async () => {
    const { container } = await render(
      <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={testRoute} photoSrc={testPhoto} />,
    );
    const card = container.querySelector('[data-invitation-card="web"]');
    expect(classesOf(card)).toContain("max-w-[376px]");
    expect(classesOf(card?.parentElement)).toContain("min-h-[402px]");
    expect(classesOf(container.querySelector("input"))).toEqual(expect.arrayContaining(["h-[46px]", "py-px", "px-0.5"]));
  });
});

describe("폰 화면은 높이가 정해진 세로 단이다", () => {
  afterEach(cleanup);

  it.each(Object.keys(PHONE_SCREENS) as Array<keyof typeof PHONE_SCREENS>)(
    "%s: 부모 높이를 채우고 가운데 칸 하나만 흰 바탕으로 스크롤한다",
    async (name) => {
      const { container } = await render(PHONE_SCREENS[name]());
      const root = container.querySelector(`[data-invitation-screen="${name}"]`);
      expect(classesOf(root)).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "overflow-hidden"]));
      const scrollers = Array.from(container.querySelectorAll("[data-invitation-scroll]"));
      expect(scrollers).toHaveLength(1);
      expect(classesOf(scrollers[0])).toEqual(
        expect.arrayContaining(["min-h-0", "overflow-y-auto", "scrollbar-hide", "bg-inv-white"]),
      );
    },
  );

  it.each([
    ["chat", "좋아요, 홀 찾아 주세요"],
    ["journey", "이 순서로 할게요"],
    ["compare", "담은 2곳에 상담 문의하기"],
  ] as const)("%s: 아래 행동은 스크롤 칸 뒤에 붙어 줄지 않는다", async (name, label) => {
    const { container } = await render(PHONE_SCREENS[name]());
    const root = container.querySelector(`[data-invitation-screen="${name}"]`) as HTMLElement;
    const scroller = root.querySelector("[data-invitation-scroll]") as HTMLElement;
    const action = Array.from(root.querySelectorAll("a")).find((link) => link.textContent === label) as HTMLElement;
    let bottom: HTMLElement = action;
    while (bottom.parentElement && bottom.parentElement !== root) bottom = bottom.parentElement;
    expect(bottom.parentElement).toBe(root);
    expect(classesOf(bottom)).toContain("shrink-0");
    expect(scroller.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("홈 하단 메뉴는 화면 틀 바닥에 붙는다(창이 아니라 틀 기준)", async () => {
    const { container } = await render(PHONE_SCREENS.home());
    const nav = container.querySelector("nav");
    expect(classesOf(nav)).toContain("absolute");
    expect(classesOf(nav)).not.toContain("fixed");
  });

  it("예시 레이아웃은 창 높이에 묶이고, 예시 줄은 줄지 않는 한 줄, 화면은 남은 높이를 채운다", async () => {
    const { container } = await render(
      <ExampleLayout>
        <div>화면</div>
      </ExampleLayout>,
    );
    expect(classesOf(container.firstElementChild)).toContain("h-dvh");
    expect(classesOf(container.querySelector("[data-example-banner]"))).toContain("shrink-0");
    expect(classesOf(container.querySelector("main"))).toEqual(expect.arrayContaining(["min-h-0", "flex-1"]));
  });
});

describe("아티팩트가 글자색을 적지 않은 단추는 기본 단추색이다", () => {
  afterEach(cleanup);

  it("상담 확정: 사진 위 칩 둘과 다른 시간 묻기", async () => {
    const { container } = await render(PHONE_SCREENS.status());
    for (const label of [STATUS_COPY.inCalendar, STATUS_COPY.shareWith("준호"), STATUS_COPY.askOtherTime]) {
      expect(classesOf(buttonNamed(container, label))).toContain("text-[color:buttontext]!");
    }
    expect(classesOf(buttonNamed(container, STATUS_COPY.requestThisTime))).not.toContain("text-[color:buttontext]!");
  });

  it("웹: 다른 시간 묻기와 제안 칩", async () => {
    const { container } = await render(
      <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={testRoute} photoSrc={testPhoto} />,
    );
    for (const label of ["다른 시간 묻기", ...EXAMPLE_WEB_SPACE.suggestions]) {
      expect(classesOf(buttonNamed(container, label))).toContain("text-[color:buttontext]!");
    }
  });
});

describe("청첩장 날짜 줄은 아티팩트와 같은 글자 덩어리다", () => {
  afterEach(cleanup);

  it("채운 칸은 한 덩어리 글자, 빈칸만 흐린 조각이다", async () => {
    const { container } = await render(PHONE_SCREENS.home());
    const date = container.querySelector('[data-invitation-card="home"] span:nth-of-type(3)');
    const nodes = Array.from(date?.childNodes ?? []);
    expect(nodes.map((node) => node.nodeType)).toEqual([Node.TEXT_NODE, Node.ELEMENT_NODE]);
    expect(nodes.map((node) => node.textContent)).toEqual(["2027. 05. ", "__"]);
  });
});
