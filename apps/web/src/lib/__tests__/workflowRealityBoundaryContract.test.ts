import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../..");
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("real workflow trust boundaries", () => {
  it("renders only a retired WeddingCode surface with no latent engine", () => {
    for (const relativePath of [
      "apps/web/src/app/wedding-code/page.tsx",
      "apps/web/src/app/wedding-code/result/page.tsx",
    ]) {
      const source = read(relativePath);
      expect(source, relativePath).toContain("PublicBetaUnavailable");
      expect(source, relativePath).toContain('feature="weddingCode"');
      expect(source, relativePath).not.toContain("PUBLIC_BETA_CAPABILITIES");
      expect(source, relativePath).not.toContain("WeddingCodeClient");
      expect(source, relativePath).not.toContain("ResultClient");
    }
  });

  it("counts only started checklist records and labels template timing as non-personal reference", () => {
    const schedule = read("apps/web/src/components/app/schedule/ScheduleContent.tsx");
    const timeline = read("apps/web/src/components/app/schedule/TimelineView.tsx");

    expect(schedule).toContain("getJourneyProgressCounts");
    expect(schedule).toContain("시작한 항목 완료율");
    expect(schedule).not.toContain("CATEGORY_KEYS.reduce");
    expect(timeline).toContain("개인 일정이나 필수 순서가 아닙니다");
    expect(timeline).not.toMatch(/12~10개월 전|D-360 ~ D-270|핵심 계약|시작전/);
  });

  it("does not promise a normality or average-price verdict in community navigation", () => {
    const web = read("apps/web/src/constants/communityCategories.ts");
    const mobileFiles = [
      "apps/mobile/app/(tabs)/community.tsx",
      "apps/mobile/app/community/post/[id].tsx",
      "apps/mobile/app/community/post/write.tsx",
      "apps/mobile/app/community/my-posts.tsx",
      "apps/mobile/app/community/my-bookmarks.tsx",
    ].map(read).join("\n");

    expect(web).toContain("계약·추가금 질문");
    expect(web).not.toMatch(/정상인가|평균과 비교|적절한지/);
    expect(mobileFiles).toContain("계약·추가금 질문");
    expect(mobileFiles).not.toMatch(/정상이야|정상인가/);
  });

  it("keeps mobile plan, signed-contract, and paid amounts as separate manual records", () => {
    const budget = read("apps/mobile/app/budget/index.tsx");

    expect(budget).toContain('sumEnteredField(activeRecords, "budget")');
    expect(budget).toContain('sumEnteredField(activeRecords, "contractedTotal")');
    expect(budget).toContain('sumEnteredField(activeRecords, "paidToDate")');
    expect(budget).toContain("계약·납부 금액은 사용자가 직접 입력한 미검증 기록입니다");
    expect(budget).toContain("추천 금액이 아니에요");
    expect(budget).not.toContain("totalBudget - totalSpent");
  });
});
