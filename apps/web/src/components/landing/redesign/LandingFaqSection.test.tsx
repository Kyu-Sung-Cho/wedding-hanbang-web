import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNeutralPreparationSpaceSubmission } from "@/lib/onboarding/neutralPreparationSpace";
import LandingFaqSection from "./LandingFaqSection";

describe("LandingFaqSection", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<LandingFaqSection />);
    document.body.appendChild(container);
  });

  afterEach(() => container.remove());

  it("opens and closes native disclosures from server HTML without hydration", () => {
    const disclosures = Array.from(container.querySelectorAll("details"));
    expect(disclosures).toHaveLength(6);

    for (const disclosure of disclosures) {
      expect(disclosure.open).toBe(false);
      expect(disclosure.firstElementChild?.tagName).toBe("SUMMARY");
      const summary = disclosure.querySelector("summary");
      expect(summary?.textContent?.trim()).toBeTruthy();
      expect(summary?.classList.contains("min-h-11")).toBe(true);
      expect(summary?.className).toContain("focus-visible:");
      expect(summary?.querySelector("button, a")).toBeNull();
    }

    const first = disclosures[0];
    const second = disclosures[1];
    first.querySelector("summary")?.click();
    expect(first.open).toBe(true);
    second.querySelector("summary")?.click();
    expect(second.open).toBe(true);
    expect(first.open).toBe(true);
    first.querySelector("summary")?.click();
    expect(first.open).toBe(false);
    expect(second.open).toBe(true);
  });

  it("keeps AI and privacy disclosures linked to their real source policies", () => {
    const ai = container.querySelector("#faq-ai");
    const privacy = container.querySelector("#faq-privacy");
    expect(ai?.querySelector('a[href="/ai-policy"]')).not.toBeNull();
    expect(ai?.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(privacy?.querySelector('a[href="/privacy"]')).not.toBeNull();

    const aiPolicy = readFileSync(resolve("src/app/ai-policy/page.tsx"), "utf8");
    const privacyPolicy = readFileSync(resolve("src/app/privacy/page.tsx"), "utf8");
    const terms = readFileSync(resolve("src/app/terms/page.tsx"), "utf8");

    // 문장을 고정하지 않고, 링크한 정책과 FAQ가 같은 한계를 알리는지 확인한다.
    expect(ai?.textContent).toMatch(/틀리|오류|빠진/u);
    expect(aiPolicy).toMatch(/틀리거나 빠진/u);
    expect(ai?.textContent).toMatch(/원문/u);
    expect(terms).toMatch(/최신 원문/u);
    expect(privacy?.textContent).toMatch(/상대.*보이지/u);
    expect(privacyPolicy).toMatch(/비공개로 표시된 정보는 공유하지/u);
    expect(privacy?.textContent).toMatch(/서비스.*처리.*보관/u);
    expect(privacyPolicy).toMatch(/대화 원문은.*보관/u);
  });

  it("backs starting with an undecided date and budget with the real submission builder", () => {
    const submission = buildNeutralPreparationSpaceSubmission({
      coupleAction: "create",
      partnerInviteCode: "",
    });
    expect(submission.weddingDate).toBeNull();
    expect(submission.totalBudget).toBeNull();
    expect(container.querySelector("#faq-start")?.textContent).toMatch(/미정/u);
  });
});
