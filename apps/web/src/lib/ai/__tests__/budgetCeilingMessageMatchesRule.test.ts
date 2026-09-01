import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAX_WEDDING_BUDGET_WON,
  formatWeddingBudgetCeiling,
  isValidWeddingWonAmount,
} from "@/lib/weddingBudget";

/**
 * **아모라가 말하는 상한과 실제로 거절하는 상한이 같아야 한다.**
 *
 * 2026-09-01 실측: 아모라의 두 거절 문구만 `"0원 이상 1조원 이하"` 라고 말하고
 * 있었다. 실제 검증은 `MAX_WEDDING_BUDGET_WON`(10억)이라, 예를 들어 50억을 넣은
 * 사람은 **"1조까지 된다"는 안내를 받으며 계속 거절당한다.** 안내대로 했는데
 * 안 되는 것이라 사용자가 자기 입력을 의심할 수 없다.
 *
 * 제품의 다른 표면(온보딩·설정·여정·가격 조합)은 전부 10억으로 맞게 말하고
 * 있었고, 아모라 두 곳만 어긋나 있었다. 손으로 적은 문구는 상수가 바뀔 때 같이
 * 안 바뀌므로 값에서 만들게 했고, 여기서 그 계약을 못 박는다.
 */
const AMORA_MESSAGE_SOURCES = [
  "src/lib/ai/toolExecutor.ts",
  "src/lib/ai/amoraAtomicToolOperation.ts",
] as const;

/** 문구에 적힌 "N억원"·"N조원" 을 원 단위 숫자로 되돌린다. */
function parseKoreanWon(label: string): number | null {
  const 억 = label.match(/([\d,.]+)\s*억\s*원/);
  if (억) return Math.round(Number(억[1].replace(/,/g, "")) * 100_000_000);
  const 조 = label.match(/([\d,.]+)\s*조\s*원/);
  if (조) return Math.round(Number(조[1].replace(/,/g, "")) * 1_000_000_000_000);
  return null;
}

describe("예산 상한 — 말한 것과 거절하는 것이 같다", () => {
  it("상한 문구가 실제 상수와 같은 금액을 가리킨다", () => {
    const spoken = parseKoreanWon(formatWeddingBudgetCeiling());
    expect(spoken).toBe(MAX_WEDDING_BUDGET_WON);
  });

  it("지금 값에서는 10억원이라고 말한다", () => {
    expect(formatWeddingBudgetCeiling()).toBe("10억원");
  });

  it("문구가 가리키는 금액은 실제로 통과해야 한다 — 안내보다 낮게 거절하면 안 된다", () => {
    const spoken = parseKoreanWon(formatWeddingBudgetCeiling());
    expect(spoken).not.toBeNull();
    // 안내한 상한 자체는 받아들여져야 한다.
    expect(isValidWeddingWonAmount(spoken)).toBe(true);
    // 그 위는 거절돼야 한다 — 안내가 실제보다 높으면 여기서 깨진다.
    expect(isValidWeddingWonAmount((spoken as number) + 1)).toBe(false);
  });

  it.each(AMORA_MESSAGE_SOURCES)(
    "%s 의 거절 문구에 손으로 적은 상한이 남아 있지 않다",
    (relative) => {
      const source = readFileSync(join(process.cwd(), relative), "utf8");
      // 상한을 말하는 문장은 반드시 상수에서 만들어야 한다.
      const hardCoded = source.match(/총예산은[^`"']*?(\d+\s*(?:억|조)\s*원)/g);
      expect(hardCoded ?? []).toEqual([]);
      expect(source).toContain("formatWeddingBudgetCeiling()");
    },
  );
});
