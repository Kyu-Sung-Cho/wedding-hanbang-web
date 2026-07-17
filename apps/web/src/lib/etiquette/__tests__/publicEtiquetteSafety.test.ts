import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public family-coordination guide safety", () => {
  it("ships the neutral review page instead of the legacy etiquette corpus", () => {
    const page = source("src/app/(community)/etiquette/page.tsx");
    const layout = source("src/app/(community)/etiquette/layout.tsx");
    const sitemap = source("src/app/sitemap.ts");

    expect(page).toContain("가족 조율 가이드");
    expect(page).toContain("가족·지역·문화마다 다를 수 있어요");
    expect(page).not.toContain("EtiquetteClient");
    expect(page).not.toContain("EtiquetteSeoContent");
    expect(layout).toContain("index: false");
    expect(sitemap).not.toContain("/wedding/etiquette");
  });

  it("does not inject or surface legacy etiquette chapters from active journeys", () => {
    const prompts = source("src/lib/ai/prompts.ts");
    const weeklyCard = source("src/components/app/WeeklyCard.tsx");
    const checklistModal = source("src/components/app/schedule/CategoryChecklistModal.tsx");
    const chatBubble = source("src/components/app/chat/ChatBubble.tsx");

    expect(prompts).not.toContain("예절 관련 답변 시 `[etiquette:번호]`");
    expect(weeklyCard).not.toContain("@/constants/etiquetteData");
    expect(checklistModal).not.toContain("@/constants/etiquetteData");
    expect(chatBubble).not.toContain("@/constants/etiquetteData");
  });

  it("does not retain the unsupported legacy corpus as reactivatable dead code", () => {
    expect(existsSync(resolve(process.cwd(), "src/constants/etiquetteData.ts"))).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/components/app/etiquette/EtiquetteClient.tsx")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/components/app/etiquette/EtiquetteSeoContent.tsx")),
    ).toBe(false);
  });
});
