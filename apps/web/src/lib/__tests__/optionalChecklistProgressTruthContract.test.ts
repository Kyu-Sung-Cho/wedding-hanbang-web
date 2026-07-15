import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("optional checklist progress truth boundary", () => {
  it("uses the shared started-item calculation in the lounge", () => {
    const source = read("src/app/(app)/lounge/page.tsx");

    expect(source).toContain("getJourneyProgressCounts");
    expect(source).toContain('label="시작한 항목 완료율"');
    expect(source).toContain('value={summary.total > 0 ? `${progressPercent}%` : "기록 없음"}');
    expect(source).not.toContain("function getProgressSummary");
  });

  it("describes Amora's progress lookup as user-recorded progress", () => {
    const tools = read("src/lib/ai/tools.ts");
    expect(tools).toContain("직접 시작한 항목 기준 완료율");
    expect(tools).not.toContain("전체 진행률");
  });
});
