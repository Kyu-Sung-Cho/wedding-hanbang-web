import { describe, expect, it } from "vitest";
import { detectDissatisfaction } from "../dissatisfaction";

describe("detectDissatisfaction", () => {
  it("detects correction and retry signals", () => {
    expect(detectDissatisfaction("아니 그게 아니라")?.signal).toBe("correction");
    expect(detectDissatisfaction("다시 설명해줘")?.signal).toBe("retry");
  });

  it("detects frustration and negative signals", () => {
    expect(detectDissatisfaction("말을 못 알아듣네")?.signal).toBe("frustration");
    expect(detectDissatisfaction("도움이 안 돼")?.signal).toBe("negative");
  });

  it("uses previous AI length for confusion and disengagement", () => {
    const longAnswer = "상세한 답변입니다.".repeat(30);

    expect(detectDissatisfaction("?", longAnswer)?.signal).toBe("confusion");
    expect(detectDissatisfaction("ㅇㅇ", longAnswer)?.signal).toBe("disengagement");
    expect(detectDissatisfaction("ㅇㅇ", "짧은 답변")).toBeNull();
  });

  it("returns null for ordinary follow-up text", () => {
    expect(detectDissatisfaction("그럼 견적 기준으로 다시 비교해줘")).toBeNull();
  });
});
