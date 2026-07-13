import { describe, expect, it } from "vitest";
import {
  getRuntimeToolContract,
  serializeUntrustedToolResultForModel,
} from "../runtimeToolContract";

describe("getRuntimeToolContract", () => {
  it("lists only the tools exposed for the current turn and forbids mutation claims", () => {
    const prompt = getRuntimeToolContract(
      [{ name: "search_vendors" }, { name: "get_budget_status" }],
      { toolCards: true },
    );

    expect(prompt).toContain("get_budget_status, search_vendors");
    expect(prompt).toContain("모든 쓰기 작업이 비활성화");
    expect(prompt).toContain("완료했다고 주장하지 마세요");
    expect(prompt).toContain("신뢰할 수 없는 데이터");
    expect(prompt).not.toContain("create_booking,");
  });

  it("requires a text fallback when the client cannot render tool cards", () => {
    const prompt = getRuntimeToolContract([{ name: "analyze_quote" }], { toolCards: false });

    expect(prompt).toContain("카드를 표시하지 못합니다");
    expect(prompt).toContain("핵심 결과를 답변 텍스트에");
  });

  it("bounds tool data before returning it to the model", () => {
    const serialized = serializeUntrustedToolResultForModel(
      { rows: ["x".repeat(20_000)] },
      { success: true, displayMessage: "  요약\u0000 결과  " },
    );

    expect(serialized).toContain("[UNTRUSTED_TOOL_DATA]");
    expect(serialized).toContain('"truncated":true');
    expect(serialized).toContain('"displayMessage":"요약 결과"');
    expect(serialized.length).toBeLessThan(1_000);
  });

  it("always tells the model whether a normal-sized tool result failed", () => {
    const serialized = serializeUntrustedToolResultForModel(
      {},
      { success: false, displayMessage: "업체 정보를 불러오지 못했어요." },
    );

    expect(serialized).toContain('"success":false');
    expect(serialized).toContain('"displayMessage":"업체 정보를 불러오지 못했어요."');
    expect(serialized).toContain('"data":{}');
  });
});
