import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_HOME, HOME_COPY, type HomeModel } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationHome from "../InvitationHome";
import { buttonNamed, cleanup, click, linkNamed, render, testRoute, text } from "./dom";

/**
 * 청첩장 홈(`Home.dc`). 예시 커플 모델로 그려서 아티팩트와 같은 글자·역할·이동이 나오는지 본다.
 */
describe("InvitationHome", () => {
  afterEach(cleanup);

  it("빈칸 수를 모델의 사실로 세고, 막대 다섯 개 중 채운 칸만 흰색이다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    expect(container.textContent).toContain(HOME_COPY.blanksLeft(2));
    const bars = Array.from(container.querySelectorAll("[data-filled]"));
    expect(bars).toHaveLength(5);
    expect(bars.map((bar) => bar.getAttribute("data-filled"))).toEqual(["true", "true", "true", "false", "false"]);
    expect(bars[0].parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("청첩장 카드와 두 사람 머리글자를 그린다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    const card = container.querySelector('[data-invitation-card="home"]');
    expect(text(card)).toContain("민지 그리고 준호");
    expect(text(card)).toContain("2027. 05. __");
    expect(text(card)).toContain("토요일 낮");
    // 머리글자는 보이는 글자, 읽어 주는 것은 이름 전체다.
    const names = Array.from(container.querySelectorAll(".sr-only")).map((node) => node.textContent);
    expect(names).toEqual(expect.arrayContaining(["민지", "준호"]));
  });

  it("무엇을 했나요? 를 누르면 단계 목록이 펼쳐지고 글자가 접기로 바뀐다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    const toggle = buttonNamed(container, HOME_COPY.whatDidYouDo);
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list?.hasAttribute("hidden")).toBe(true);

    await click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text(toggle)).toBe(HOME_COPY.fold);
    expect(list?.hasAttribute("hidden")).toBe(false);
    expect(list?.tagName).toBe("OL");
    expect(Array.from(list?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual(EXAMPLE_HOME.update?.steps);

    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list?.hasAttribute("hidden")).toBe(true);
  });

  it("단계가 없으면 펼치기 단추를 그리지 않는다", async () => {
    const model: HomeModel = {
      ...EXAMPLE_HOME,
      update: EXAMPLE_HOME.update ? { ...EXAMPLE_HOME.update, steps: [] } : null,
    };
    const { container } = await render(<InvitationHome model={model} resolveRoute={testRoute} />);

    expect(container.textContent).not.toContain(HOME_COPY.whatDidYouDo);
    expect(container.querySelector("ol")).toBeNull();
  });

  it("주 행동은 모델이 가리킨 화면으로 가는 먹색 링크다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    const primary = linkNamed(container, "3곳 비교하기");
    expect(primary.getAttribute("href")).toBe("/test/compare");
    expect(primary.className).toContain("bg-inv-ink");
  });

  it("두 분이 정할 것: 갈 곳이 있는 줄만 링크이고 꼬리표는 함께·이름이다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    const heading = container.querySelector("h2");
    expect(text(heading)).toBe(HOME_COPY.decisionsHeading);

    const consult = container.querySelector('[data-decision="consult-time"]');
    expect(consult?.tagName).toBe("A");
    expect(consult?.getAttribute("href")).toBe("/test/letter");
    expect(text(consult)).toContain("준호 님은 토요일 오후가 좋대요");
    expect(text(consult)).toContain(HOME_COPY.together);

    const family = container.querySelector('[data-decision="family-date"]');
    expect(family?.tagName).toBe("DIV");
    expect(text(family)).toContain("민지");
  });

  it("떠 있는 하단 메뉴: 네 칸, 지금 화면에만 aria-current, 일정은 상담 화면으로 간다", async () => {
    const { container } = await render(<InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} />);

    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe(HOME_COPY.nav.label);
    const links = Array.from(nav?.querySelectorAll("a") ?? []);
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      HOME_COPY.nav.home,
      HOME_COPY.nav.chat,
      HOME_COPY.nav.journey,
      HOME_COPY.nav.schedule,
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/test/home",
      "/test/chat",
      "/test/journey",
      "/test/status",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null, null, null]);
    for (const link of links) {
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("자기 메뉴를 가진 틀 안에서는 하단 메뉴를 끌 수 있다", async () => {
    const { container } = await render(
      <InvitationHome model={EXAMPLE_HOME} resolveRoute={testRoute} tabBar={false} />,
    );

    expect(container.querySelector("nav")).toBeNull();
  });
});
