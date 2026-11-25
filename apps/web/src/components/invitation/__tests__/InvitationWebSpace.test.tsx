import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_WEB_SPACE, WEB_COPY } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationWebSpace from "../InvitationWebSpace";
import { buttonNamed, cleanup, click, pressKey, render, testPhoto, testRoute, text } from "./dom";

function renderSpace(overrides: Partial<React.ComponentProps<typeof InvitationWebSpace>> = {}) {
  return render(
    <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={testRoute} photoSrc={testPhoto} {...overrides} />,
  );
}

function tabs(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

function visiblePanels(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[role="tabpanel"]'))
    .filter((panel) => !panel.hasAttribute("hidden"))
    .map((panel) => panel.getAttribute("data-panel"));
}

/** 웹 두 칸 화면(`Web.dc`). 두 구역, 예시 대화 줄, 진짜 탭 목록을 본다. */
describe("InvitationWebSpace", () => {
  afterEach(cleanup);

  it("왼쪽 대화와 오른쪽 준비 공간이 이름 붙은 구역이다", async () => {
    const { container } = await renderSpace();

    const regions = Array.from(container.querySelectorAll("section[aria-label]")).map((section) => section.getAttribute("aria-label"));
    expect(regions).toEqual([WEB_COPY.chatRegion, WEB_COPY.spaceRegion]);
    expect(container.textContent).toContain(EXAMPLE_WEB_SPACE.orbCaption);
    expect(text(container.querySelector('[data-invitation-card="web"]'))).toContain("2027. 05. __");
  });

  it("예시 대화: 아모라 말은 말풍선 없는 글줄, 사람 말은 말풍선, 행동 알약과 제안 칩", async () => {
    const onChatAction = vi.fn();
    const onSuggestion = vi.fn();
    const { container } = await renderSpace({ onChatAction, onSuggestion });

    const amoraLines = Array.from(container.querySelectorAll("section p")).map((p) => text(p));
    expect(amoraLines).toEqual(
      EXAMPLE_WEB_SPACE.chat.flatMap((line) => (line.kind === "amora" ? [line.text] : [])),
    );
    expect(container.textContent).toContain("답장 왔어?");

    await click(buttonNamed(container, "토요일 4시로 요청"));
    expect(onChatAction).toHaveBeenCalledExactlyOnceWith("토요일 4시로 요청");
    await click(buttonNamed(container, "상견례 날짜 모으기"));
    expect(onSuggestion).toHaveBeenCalledExactlyOnceWith("상견례 날짜 모으기");
  });

  it("입력칸은 이름이 이어진 칸이고, 보내면 글을 넘기고 비운다", async () => {
    const onSend = vi.fn();
    const { container } = await renderSpace({ onSend });

    const input = container.querySelector("input");
    const label = container.querySelector("label");
    expect(label?.getAttribute("for")).toBe(input?.id);
    expect(text(label)).toBe(WEB_COPY.inputLabel);
    expect(input?.getAttribute("placeholder")).toBe(WEB_COPY.inputPlaceholder);

    if (!input) throw new Error("입력칸이 없다");
    input.value = "  예산은 얼마가 좋을까?  ";
    await click(buttonNamed(container, WEB_COPY.send));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("예산은 얼마가 좋을까?");
    expect(input.value).toBe("");
  });

  it("실제 대화를 넣으면 예시 줄과 입력칸 대신 그것을 그린다", async () => {
    const { container } = await renderSpace({ children: <div data-real-chat>실제 대화</div> });

    expect(container.querySelector("[data-real-chat]")).not.toBeNull();
    expect(container.textContent).not.toContain("답장 왔어?");
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain(EXAMPLE_WEB_SPACE.orbCaption);
  });

  it("탭은 진짜 탭 목록이다: 고른 탭만 선택·초점 자리이고 패널과 서로 이어진다", async () => {
    const { container } = await renderSpace();

    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe(WEB_COPY.tabsLabel);
    const all = tabs(container);
    expect(all.map((tab) => text(tab))).toEqual(WEB_COPY.tabs.map((tab) => tab.label));
    expect(all.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(all.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    for (const tab of all) {
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    expect(visiblePanels(container)).toEqual(["today"]);
  });

  it("방향키·Home·End 로 탭을 옮기면 선택과 초점이 함께 간다", async () => {
    const { container } = await renderSpace();
    const all = tabs(container);

    await pressKey(all[0], "ArrowRight");
    expect(document.activeElement).toBe(all[1]);
    expect(all[1].getAttribute("aria-selected")).toBe("true");
    expect(visiblePanels(container)).toEqual(["halls"]);

    await pressKey(all[1], "End");
    expect(document.activeElement).toBe(all[2]);
    expect(visiblePanels(container)).toEqual(["plan"]);

    await pressKey(all[2], "ArrowRight");
    expect(document.activeElement).toBe(all[0]);
    expect(visiblePanels(container)).toEqual(["today"]);

    await pressKey(all[0], "ArrowLeft");
    expect(document.activeElement).toBe(all[2]);

    await pressKey(all[2], "Home");
    expect(document.activeElement).toBe(all[0]);
    expect(all.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("오늘 칸: 두 분이 정할 것과 오늘 한 일", async () => {
    const { container } = await renderSpace();

    const today = container.querySelector('[data-panel="today"]');
    const headings = Array.from(today?.querySelectorAll("h2") ?? []).map((h2) => text(h2));
    expect(headings).toEqual([WEB_COPY.decisionsHeading, WEB_COPY.activityHeading]);
    const gaon = today?.querySelector('[data-decision="gaon-time"]');
    expect(gaon?.tagName).toBe("A");
    expect(gaon?.getAttribute("href")).toBe("/test/status");
    expect(Array.from(today?.querySelectorAll("ol > li") ?? []).map((li) => text(li))).toEqual(
      EXAMPLE_WEB_SPACE.activity.map((item) => `${item.timeLabel}${item.text}`),
    );
  });

  it("오늘 한 일에 시각과 글이 같은 줄이 둘이어도(같은 분에 같은 홀 상담을 둘 넣음) 새 줄이 오면 줄 수가 그대로 맞다", async () => {
    const same = { timeLabel: "13:50", text: "가온 웨딩홀 상담이 일정에 들어갔어요" };
    const later = { timeLabel: "13:55", text: "소담 하우스 상담이 일정에 들어갔어요" };
    const rows = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-panel="today"] ol > li')).map((li) => text(li));
    const { container, rerender } = await renderSpace({ model: { ...EXAMPLE_WEB_SPACE, activity: [same, same] } });
    expect(rows(container)).toEqual([`13:50${same.text}`, `13:50${same.text}`]);

    await rerender(
      <InvitationWebSpace
        model={{ ...EXAMPLE_WEB_SPACE, activity: [later, same, same] }}
        resolveRoute={testRoute}
        photoSrc={testPhoto}
      />,
    );
    expect(rows(container)).toEqual([`13:55${later.text}`, `13:50${same.text}`, `13:50${same.text}`]);
  });

  it("웨딩홀 후보 칸과 준비 순서 칸을 누르면 그 내용이 보인다", async () => {
    const { container } = await renderSpace();

    await click(buttonNamed(container, "웨딩홀 후보"));
    const halls = container.querySelector('[data-panel="halls"]');
    expect(Array.from(halls?.querySelectorAll("strong") ?? []).map((node) => text(node))).toEqual([
      "소담 하우스",
      "가온 웨딩홀",
      "루체 컨벤션",
    ]);
    expect(text(halls)).toContain("11월 22일 상담 확정");
    expect(text(halls)).toContain("1,360 만 원");
    expect(halls?.querySelector("img")?.className).toContain("h-[170px]!");

    await click(buttonNamed(container, "준비 순서"));
    const plan = container.querySelector('[data-panel="plan"]');
    const steps = Array.from(plan?.querySelectorAll("li") ?? []);
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.getAttribute("data-now"))).toEqual(["false", "true", "false", "false", "false"]);
    expect(steps[1].className).toContain("bg-inv-step-now");
  });
});
