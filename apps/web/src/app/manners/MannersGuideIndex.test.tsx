// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import MannersGuideIndex, { type MannersIndexGroup } from "./MannersGuideIndex";
import { buildMannersSearchText, MANNERS_QUICK_PATHS } from "./page";

const groups: MannersIndexGroup[] = [
  {
    id: "common-flow",
    tier: "core",
    label: "핵심",
    description: "먼저 보는 안내",
    parts: [
      { slug: "family-meeting", title: "상견례", subtitle: "가족이 만나요", audience: "couple", searchText: "상견례 가족" },
      { slug: "marriage-registration", title: "혼인신고", subtitle: "행정 절차", audience: "both", searchText: "혼인신고 행정" },
    ],
  },
  {
    id: "after-wedding-life",
    tier: "lifecycle",
    label: "결혼 후 생활",
    description: "식 뒤 안내",
    parts: [{ slug: "housewarming", title: "집들이", subtitle: "초대 준비", audience: "couple", searchText: "집들이 초대" }],
  },
  {
    id: "conditional-guides",
    tier: "situation",
    label: "해당할 때만",
    description: "선택한 경우의 안내",
    parts: [{ slug: "religious-weddings", title: "종교 예식", subtitle: "선택한 형식", audience: "both", searchText: "종교 예식" }],
  },
];

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("MannersGuideIndex", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("starts with common guides and exposes exactly three accessible range filters", async () => {
    await act(async () => root.render(<MannersGuideIndex groups={groups} />));

    const rangeGroup = container.querySelector('[role="group"][aria-label="가이드 범위"]');
    const buttons = Array.from(rangeGroup?.querySelectorAll("button") ?? []);

    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("상견례");
    expect(container.textContent).not.toContain("종교 예식");
  });

  it("keeps the public index in three tiers and limits quick paths to eight common routes", () => {
    expect(MANNERS_CATEGORIES.map((category) => category.tier)).toEqual([
      "core",
      "lifecycle",
      "situation",
    ]);
    expect(MANNERS_QUICK_PATHS.map((path) => path.slug)).toEqual([
      "planning-timeline",
      "first-family-visit",
      "cost-saving",
      "invitation-sending",
      "wedding-day",
      "gift-money",
      "guest-manners",
      "marriage-registration",
    ]);

    const situationSlugs = MANNERS_CATEGORIES.find((category) => category.tier === "situation")?.slugs ?? [];
    expect(MANNERS_QUICK_PATHS.some((path) => situationSlugs.includes(path.slug))).toBe(false);

    expect(MANNERS_CATEGORIES.find((category) => category.tier === "core")?.slugs).toEqual([
      "planning-timeline",
      "planning-conflicts",
      "first-family-visit",
      "family-meeting",
      "money-home-conversation",
      "shared-home-items",
      "cost-saving",
      "invitation-sending",
      "honeymoon-preparation",
      "wedding-day",
      "gift-money",
      "guest-manners",
      "photo-manners",
      "marriage-registration",
      "digital-manners",
    ]);
    expect(situationSlugs).toEqual([
      "gifts-and-traditions",
      "traditional-greetings",
      "congratulatory-speech",
      "return-gift",
      "small-wedding",
      "religious-weddings",
    ]);
  });

  it("keeps conditional guides separate until the user selects that range", async () => {
    await act(async () => root.render(<MannersGuideIndex groups={groups} />));
    const situationButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "해당할 때만",
    );

    await act(async () => situationButton?.click());

    expect(situationButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("종교 예식");
    expect(container.textContent).not.toContain("상견례");
  });

  it("searches all ranges while keeping conditional guides out of the default list", async () => {
    await act(async () => root.render(<MannersGuideIndex groups={groups} />));
    const input = container.querySelector<HTMLInputElement>("#manners-guide-search");
    const label = container.querySelector('label[for="manners-guide-search"]');

    expect(label?.textContent).toContain("필요한 내용 검색");
    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "혼인");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("혼인신고");
    expect(container.textContent).not.toContain("상견례");
    expect(container.textContent).toContain("SEARCH ALL GUIDES");
    expect(container.textContent).not.toContain("START HERE");

    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "종교");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("종교 예식");
    expect(container.textContent).toContain("해당할 때만 · 모두에게");

    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "없는내용");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("찾은 가이드가 없어요.");
  });

  it("returns to the selected range when a range button is pressed during global search", async () => {
    await act(async () => root.render(<MannersGuideIndex groups={groups} />));
    const input = container.querySelector<HTMLInputElement>("#manners-guide-search");
    const lifecycleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "결혼 후 생활",
    );

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "혼인");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("혼인신고");

    await act(async () => lifecycleButton?.click());

    expect(input?.value).toBe("");
    expect(lifecycleButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("집들이");
    expect(container.textContent).not.toContain("혼인신고");
  });

  it("indexes section-level conditional content without showing it in the default list", () => {
    const registration = MANNERS_PARTS.find((part) => part.slug === "marriage-registration");
    expect(registration).toBeDefined();

    const searchText = buildMannersSearchText(registration!);
    expect(searchText).toContain("국제혼인");
    expect(searchText).toContain("출입국·체류 절차");
    expect(searchText).toContain("자녀의 성과 본");
  });

  it("indexes the visible Korean labels of all 27 checklist fields in the journey map", () => {
    const timeline = MANNERS_PARTS.find((part) => part.slug === "planning-timeline");
    expect(timeline).toBeDefined();

    const searchText = buildMannersSearchText(timeline!);
    for (const label of [
      "드레스·예식 정장",
      "한복",
      "결혼반지·기념 선물",
      "종이·모바일 초대장",
      "결혼식 뒤 정산·감사·기록",
    ]) {
      expect(searchText).toContain(label);
    }
  });

  it("keeps post-wedding thanks in the common lifecycle and honeymoon advice conditional", () => {
    const lifecycleSlugs =
      MANNERS_CATEGORIES.find((category) => category.tier === "lifecycle")?.slugs ?? [];
    const aftercare = MANNERS_PARTS.find((part) => part.slug === "post-honeymoon-thanks");
    const returnGift = MANNERS_PARTS.find((part) => part.slug === "return-gift");

    expect(lifecycleSlugs).toContain("post-honeymoon-thanks");
    expect(aftercare?.title).toBe("결혼식 뒤 감사와 마감");
    expect(aftercare?.sections.some((section) => section.heading === "감사는 짧고 구체적으로 전해요")).toBe(
      true,
    );
    expect(
      aftercare?.sections.some(
        (section) => section.heading === "신혼여행을 다녀왔다면" && section.visibility === "conditional",
      ),
    ).toBe(true);
    expect(returnGift?.sections.map((section) => section.heading)).not.toContain("결혼식 뒤 감사 인사");
    expect(returnGift?.sections.map((section) => section.heading)).not.toContain("감사 메시지 예시");
  });
});
