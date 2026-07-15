import { describe, expect, it } from "vitest";
import { validateAmoraMemoryCompilation } from "@/lib/ai/amoraMemoryCompiler";

const USER_MESSAGE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_MESSAGE_ID = "00000000-0000-4000-8000-000000000002";

function validMemory(overrides: Record<string, unknown> = {}) {
  return {
    source_message_id: USER_MESSAGE_ID,
    memory_key: "venue:preferred_area",
    kind: "preference",
    category: "venue",
    title: "선호 지역",
    value: "서울 동쪽 지역을 우선 검토",
    reasoning: "사용자가 직접 선호 지역을 말함",
    confidence: 0.91,
    explicit: true,
    ...overrides,
  };
}

describe("Amora memory compiler boundary", () => {
  it("accepts bounded explicit memories backed by a user message in the batch", () => {
    const result = validateAmoraMemoryCompilation(
      { summary: "예식장 지역 선호를 확인했다.", memories: [validMemory()] },
      new Set([USER_MESSAGE_ID]),
    );

    expect(result.memories[0]).toMatchObject({
      sourceMessageId: USER_MESSAGE_ID,
      memoryKey: "venue:preferred_area",
      explicit: true,
    });
  });

  it("rejects a source that is not an allowed user message", () => {
    expect(() => validateAmoraMemoryCompilation(
      { summary: "요약", memories: [validMemory({ source_message_id: OTHER_MESSAGE_ID })] },
      new Set([USER_MESSAGE_ID]),
    )).toThrow(/not a user message/);
  });

  it.each([
    ["low confidence", { confidence: 0.79 }],
    ["implicit inference", { explicit: false }],
    ["unstable key", { memory_key: "웨딩홀 지역" }],
    ["oversized value", { value: "가".repeat(161) }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateAmoraMemoryCompilation({
      summary: "요약",
      memories: [validMemory(override)],
    }, new Set([USER_MESSAGE_ID]))).toThrow();
  });

  it("rejects duplicate semantic keys in one compiler response", () => {
    expect(() => validateAmoraMemoryCompilation({
      summary: "요약",
      memories: [validMemory(), validMemory({ source_message_id: OTHER_MESSAGE_ID })],
    }, new Set([USER_MESSAGE_ID, OTHER_MESSAGE_ID]))).toThrow(/duplicate memory key/);
  });

  it("drops memories containing obvious personal identifiers and redacts them from summaries", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "연락처는 010-1234-5678이고 강남 예식장을 선호한다.",
      memories: [
        validMemory({ value: "010-1234-5678로 연락" }),
        validMemory({
          source_message_id: OTHER_MESSAGE_ID,
          memory_key: "venue:backup_area",
          value: "성수도 함께 검토",
        }),
      ],
    }, new Set([USER_MESSAGE_ID, OTHER_MESSAGE_ID]));

    expect(result.summary).toBe("연락처는 [민감정보 제외]이고 강남 예식장을 선호한다.");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.memoryKey).toBe("venue:backup_area");
  });
});
