import { describe, expect, it } from "vitest";

import { MOMENT_LIST } from "@/constants/moments";

function customerFacingCopy(moment: (typeof MOMENT_LIST)[number]): string {
  return [moment.d3, moment.d1, moment.dAfter]
    .flatMap((cell) =>
      cell
        ? [cell.message, ...(cell.checklist ?? []), cell.script ?? "", cell.question ?? ""]
        : [],
    )
    .join("\n");
}

describe("Amora moment catalog safety", () => {
  it("does not present variable customs, prices, health advice, or travel rules as universal facts", () => {
    const forbiddenClaims = [
      /10\s*[~～-]\s*20\s*만/,
      /3\s*[~～-]\s*5\s*만/,
      /1인\s*5\s*만/,
      /10명\s*중\s*8명/,
      /국룰/,
      /호구/,
      /유일한\s*방법/,
      /부부싸움\s*1순위/,
      /원래\s*다\s*싸워/,
      /여권.*6개월/,
      /사흘\s*안.*예의/,
      /린스\s*금지/,
      /과식\s*금지/,
      /다이어트.*정답/,
      /깜빡.*(?:1[·ㆍ,\s]*2위|제일\s*많)/,
      /제일\s*많이\s*당/,
    ];

    for (const moment of MOMENT_LIST) {
      const copy = customerFacingCopy(moment);
      for (const claim of forbiddenClaims) {
        expect(copy, `${moment.type}: ${claim}`).not.toMatch(claim);
      }
    }
  });

  it("uses gender-neutral, consent-aware language in every automated care message", () => {
    for (const moment of MOMENT_LIST) {
      const copy = customerFacingCopy(moment);
      expect(copy, moment.type).not.toMatch(/신부|신랑|아버님|어머님/);
      expect(copy, moment.type).not.toMatch(/사진\s*한\s*장만|장부\s*사진만\s*찍/);
    }
  });

  it("keeps a provenance boundary for every moment and every money-related moment", () => {
    for (const moment of MOMENT_LIST) {
      expect(moment.sourceRefs.length, moment.type).toBeGreaterThan(0);
      if (moment.moneyInvolved) {
        expect(
          moment.sourceRefs.some((source) =>
            /provider|contract|user_choice|official|venue_quote/.test(source),
          ),
          `${moment.type} needs a variable-price/custom source boundary`,
        ).toBe(true);
      }
    }
  });
});
