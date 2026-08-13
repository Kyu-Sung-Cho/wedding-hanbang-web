// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MANNERS_PARTS } from "@/lib/manners/data";
import MannersPartView from "./MannersPartView";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("MannersPartView action links", () => {
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

  it("shows the full label for newly added journey checklist categories", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "planning-timeline");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const link = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "함께 정할 것 체크리스트",
    );
    expect(link?.getAttribute("href")).toBe("/wedding/checklist/foundation");
  });

  it("keeps the checklist action and a separate allowlisted Amora action", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "planning-timeline");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const links = Array.from(container.querySelectorAll("a"));
    const checklistLink = links.find((candidate) =>
      candidate.textContent?.includes("체크리스트"),
    );
    const amoraLink = links.find(
      (candidate) => candidate.textContent?.trim() === "아모라로 우리 상황에 적용",
    );

    expect(checklistLink).toBeDefined();
    expect(amoraLink?.getAttribute("href")).toBe(
      "/wedding/chat?manners_slug=planning-timeline",
    );
    expect(amoraLink?.getAttribute("href")).not.toContain("prefill");
  });

  it("shows the allowlisted Amora action on every guide, including guides without checklist mapping", async () => {
    for (const part of MANNERS_PARTS) {
      await act(async () => root.render(<MannersPartView part={part} />));

      const amoraLink = Array.from(container.querySelectorAll("a")).find(
        (candidate) => candidate.textContent?.trim() === "아모라로 우리 상황에 적용",
      );
      const href = amoraLink?.getAttribute("href");

      expect(href, part.slug).toBe(`/wedding/chat?manners_slug=${part.slug}`);
      const url = new URL(href!, "https://hanbang.ai");
      expect([...url.searchParams.keys()], part.slug).toEqual(["manners_slug"]);
    }
  });

  it("uses every exact checklist backlink once and progressively reveals long link sets", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "cost-saving");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const checklistHrefs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/wedding/checklist/"]'),
    ).map((link) => link.getAttribute("href"));

    expect(checklistHrefs).toEqual([
      "/wedding/checklist/contracts",
      "/wedding/checklist/venue",
      "/wedding/checklist/studio",
      "/wedding/checklist/dress",
      "/wedding/checklist/makeup",
      "/wedding/checklist/ring",
      "/wedding/checklist/hanbok",
      "/wedding/checklist/houseware",
      "/wedding/checklist/housing",
    ]);
    expect(new Set(checklistHrefs).size).toBe(checklistHrefs.length);

    const moreChecklistDetails = Array.from(container.querySelectorAll("details")).find(
      (details) => details.querySelector("summary")?.textContent?.includes("체크리스트 6개 더 보기"),
    );
    expect(moreChecklistDetails).toBeDefined();
    expect(moreChecklistDetails?.querySelectorAll('a[href^="/wedding/checklist/"]')).toHaveLength(6);
    expect(moreChecklistDetails?.querySelector("summary")?.nextElementSibling?.className).toContain(
      "hidden",
    );
    expect(moreChecklistDetails?.querySelector("summary")?.nextElementSibling?.className).toContain(
      "group-open:flex",
    );
  });

  it("provides a compact mobile table of contents, semantic block headings, and a back-to-top target", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "planning-timeline");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const tocDetails = Array.from(container.querySelectorAll("details")).find(
      (details) => details.querySelector("summary")?.textContent?.includes("목차"),
    );
    const tocLinks = tocDetails?.querySelectorAll('nav[aria-label="이 글의 목차"] a');

    expect(tocDetails).toBeDefined();
    expect(tocDetails?.querySelector("summary")?.className).toContain("min-h-11");
    expect(tocLinks).toHaveLength(part!.sections.length);
    expect(tocLinks?.[0]?.getAttribute("href")).toBe("#section-1");
    expect(container.querySelector("#section-1")?.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelectorAll("h4")).toHaveLength(6);
    expect(container.querySelector("h4")?.textContent).toContain("두 사람의 기준과 생활 기반");
    expect(container.querySelector('a[href="#manners-top"]')?.textContent).toContain("맨 위로");
    expect(container.querySelector("#manners-top")).not.toBeNull();
  });

  it("keeps specialized legal sections collapsed without hiding the common guide", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "marriage-registration");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const conditional = Array.from(container.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.includes("자녀의 성과 본"),
    );
    expect(conditional).toBeDefined();
    expect(conditional?.hasAttribute("open")).toBe(false);
    expect(conditional?.querySelector("summary")?.textContent).toContain("해당할 때만");
    const conditionalTocLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="이 글의 목차"] a'),
    ).find((link) => link.textContent?.includes("자녀의 성과 본"));
    expect(conditionalTocLink?.textContent).toContain("조건부");
    expect(container.textContent).toContain("결혼식과 혼인신고는 다른 일입니다");
  });

  it("renders the full journey map as 27 direct checklist actions", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "planning-timeline");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const journeyMap = container.querySelector('section[aria-labelledby="planning-journey-map-title"]');
    const hrefs = Array.from(
      journeyMap?.querySelectorAll<HTMLAnchorElement>('a[href^="/wedding/checklist/"]') ?? [],
    ).map((link) => link.getAttribute("href"));

    expect(journeyMap?.textContent).toContain("먼저 정할 것");
    expect(journeyMap?.textContent).toContain("실제 마감 기준");
    expect(hrefs).toHaveLength(27);
    expect(new Set(hrefs).size).toBe(27);
  });

  it("shows evidence-level badges and warns when a numeric table only has secondary reporting", async () => {
    const returnGift = MANNERS_PARTS.find((candidate) => candidate.slug === "return-gift");
    const giftMoney = MANNERS_PARTS.find((candidate) => candidate.slug === "gift-money");
    const religiousWedding = MANNERS_PARTS.find(
      (candidate) => candidate.slug === "religious-weddings",
    );
    expect(returnGift).toBeDefined();
    expect(giftMoney).toBeDefined();
    expect(religiousWedding).toBeDefined();

    await act(async () => root.render(<MannersPartView part={returnGift!} />));

    expect(container.querySelector('[data-source-kind="secondary"]')?.textContent).toContain(
      "보도·2차 근거",
    );
    expect(container.querySelector('[data-source-kind="official"]')?.textContent).toContain(
      "공식 근거",
    );
    expect(container.querySelector('[data-evidence-basis="secondary-only"]')?.textContent).toContain(
      "보도·2차 자료만으로 확인",
    );
    expect(container.textContent).toContain("공식 근거는 정부·공공기관 자료");

    await act(async () => root.render(<MannersPartView part={giftMoney!} />));
    expect(container.querySelector('[data-evidence-basis="secondary-only"]')).toBeNull();

    await act(async () => root.render(<MannersPartView part={religiousWedding!} />));
    expect(container.querySelector('[data-source-kind="original"]')?.textContent).toContain(
      "기관 원문",
    );
  });
});
