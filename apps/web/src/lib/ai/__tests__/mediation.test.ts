import { describe, expect, it } from "vitest";

import { extractMediation } from "../mediation";

describe("extractMediation", () => {
  it("keeps an incomplete mediation block as ordinary text instead of a proposal", () => {
    const result = extractMediation([
      "요청 내용을 정리해 볼게요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "합의안: 가능한 예산 상한을 각자 적어 보세요.",
      "[/mediation]",
    ].join("\n"));

    expect(result.mediation).toBeNull();
    expect(result.cleanText).toContain("요청 내용을 정리해 볼게요.");
    expect(result.cleanText).toContain("요청자가 답답함을 느꼈다고 전했어요.");
    expect(result.cleanText).toContain("가능한 예산 상한을 각자 적어 보세요.");
    expect(result.cleanText).not.toContain("[mediation]");
  });
});
