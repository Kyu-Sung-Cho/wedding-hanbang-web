import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPARE_COPY, EXAMPLE_COMPARE, type CompareModel } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationCompare from "../InvitationCompare";
import { buttonNamed, cleanup, click, linkNamed, render, testPhoto, testRoute, text } from "./dom";

const noop = () => undefined;

function renderCompare(model: CompareModel = EXAMPLE_COMPARE, overrides: Partial<React.ComponentProps<typeof InvitationCompare>> = {}) {
  return render(
    <InvitationCompare
      model={model}
      sort="total"
      onSort={noop}
      onToggleHall={noop}
      resolveRoute={testRoute}
      photoSrc={testPhoto}
      {...overrides}
    />,
  );
}

/** 웨딩홀 비교(`Compare.dc`). 카드·하트·정렬·문의 단추를 본다. */
describe("InvitationCompare", () => {
  afterEach(cleanup);

  it("같은 조건 안내와 카드 세 장을 모델 순서대로 그린다", async () => {
    const { container } = await renderCompare();

    expect(container.textContent).toContain(COMPARE_COPY.intro(200, 5));
    const cards = Array.from(container.querySelectorAll("article[data-hall]"));
    expect(cards.map((card) => text(card.querySelector("strong")))).toEqual(["소담 하우스", "가온 웨딩홀", "루체 컨벤션"]);
    expect(text(cards[0])).toContain("1,360");
    expect(text(cards[0])).toContain(COMPARE_COPY.manwon);
    // 시안은 "가장 합리적이에요"다. 파운더 결정(11-18)으로 일부러 다르게 했다(가격 판정 대신 자료에서 나오는 사실).
    expect(text(cards[0])).toContain("총액이 가장 낮아요");
    const photo = cards[0].querySelector("img");
    expect(photo?.getAttribute("src")).toBe("/photos/hall-sample-garden.webp");
    expect(photo?.getAttribute("alt")).toBe(COMPARE_COPY.photoAlt("소담 하우스"));
    expect(photo?.className).toContain("h-full!");
  });

  it("카드의 조건 네 줄은 정의 목록이고, 보증 인원이 많은 곳만 경고색이다", async () => {
    const { container } = await renderCompare();

    const luce = container.querySelector('article[data-hall="c"]');
    const terms = Array.from(luce?.querySelectorAll("dt") ?? []).map((dt) => text(dt));
    expect(terms).toEqual([COMPARE_COPY.rows.meal, COMPARE_COPY.rows.rent, COMPARE_COPY.rows.minimum, COMPARE_COPY.rows.transit]);
    const warned = Array.from(container.querySelectorAll("dd[data-warn]"));
    expect(warned.map((dd) => text(dd))).toEqual(["250명 (50명 많음)"]);
    expect(warned[0].className).toContain("text-inv-warn");
  });

  it("하트: 담은 곳만 눌림이고 이름 붙은 단추이며, 누르면 그 홀을 알린다", async () => {
    const onToggleHall = vi.fn();
    const { container } = await renderCompare(EXAMPLE_COMPARE, { onToggleHall });

    const hearts = ["소담 하우스", "가온 웨딩홀", "루체 컨벤션"].map((name) => buttonNamed(container, COMPARE_COPY.heartLabel(name)));
    expect(hearts.map((heart) => heart.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);
    expect(hearts[0].querySelector("svg")?.getAttribute("class")).toContain("fill-inv-heart");
    expect(hearts[2].querySelector("svg")?.getAttribute("class")).toContain("fill-none");

    await click(hearts[2]);
    expect(onToggleHall).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("정렬 칩: 고른 칩만 눌림, 누르면 그 정렬을 알린다", async () => {
    const onSort = vi.fn();
    const { container } = await renderCompare(EXAMPLE_COMPARE, { onSort });

    const chips = COMPARE_COPY.sorts.map((sort) => buttonNamed(container, sort.label));
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    await click(buttonNamed(container, "교통"));
    expect(onSort).toHaveBeenCalledExactlyOnceWith("transit");
  });

  it("가격 출처 문장을 글자 그대로 보인다", async () => {
    const { container } = await renderCompare();
    expect(container.textContent).toContain("업체가 공개한 가격으로 계산했어요. 11월 14일 기준이에요.");
  });

  it("문의 단추는 담은 곳 수를 말하고 편지 화면으로 간다. 0곳이면 잠긴다", async () => {
    const { container } = await renderCompare();
    const inquire = linkNamed(container, COMPARE_COPY.inquire(2));
    expect(inquire.getAttribute("href")).toBe("/test/letter");

    await cleanup();
    const none: CompareModel = { ...EXAMPLE_COMPARE, halls: EXAMPLE_COMPARE.halls.map((hall) => ({ ...hall, picked: false })) };
    const second = await renderCompare(none);
    const locked = buttonNamed(second.container, COMPARE_COPY.inquire(0));
    expect(locked.disabled).toBe(true);
    expect(second.container.querySelector(`a[href="/test/letter"]`)).toBeNull();
  });

  it("카드 줄은 아티팩트 값 그대로다: 옆으로 넘기며 붙고, 스크롤 여백을 더하지 않는다", async () => {
    // 아티팩트 값이면 크롬이 첫 카드를 화면 끝(x=0)에 붙여 맞추고, 파운더가 캔버스에서 본 모습도 그렇다
    // (2026-11-17 코디네이터 캡처 비교). 22px 스크롤 여백을 더했다가 그 모습과 어긋나 걷어냈다.
    const { container } = await renderCompare();
    const scroller = container.querySelector("article[data-hall]")?.parentElement;
    const classes = scroller?.className.split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["overflow-x-auto", "snap-x", "snap-mandatory", "px-[22px]"]));
    expect(classes.filter((name) => name.startsWith("scroll-p"))).toEqual([]);
  });

  it("사진을 주소로 바꿀 수 없으면 그리지 않는다", async () => {
    const { container } = await renderCompare(EXAMPLE_COMPARE, { photoSrc: () => null });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("article[data-hall]")).toHaveLength(3);
  });

  it("뒤로 가기는 홈으로 가고, 오브는 옆 이름과 겹쳐 읽히지 않는다", async () => {
    const { container } = await renderCompare();
    expect(linkNamed(container, COMPARE_COPY.back).getAttribute("href")).toBe("/test/home");
    const orb = container.querySelector("svg[data-amora-orb]");
    expect(orb?.getAttribute("aria-hidden")).toBe("true");
  });
});
