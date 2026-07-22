import { describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import { deduplicateToolResults } from "./toolResultDeduplication";

function toolResult(title: string): ToolExecutionResult {
  return {
    toolName: "add_amora_action",
    toolInput: { title },
    toolOutput: { action: { id: title } },
    success: true,
    displayMessage: "아모라 행동 카드를 저장했어요.",
  };
}

describe("deduplicateToolResults", () => {
  it("keeps distinct actions when their display messages match", () => {
    const results = deduplicateToolResults([
      toolResult("스튜디오 예약"),
      toolResult("메이크업 상담 예약"),
    ]);

    expect(results.map((result) => result.toolInput.title)).toEqual([
      "스튜디오 예약",
      "메이크업 상담 예약",
    ]);
  });

  it("collapses an exact repeated result", () => {
    const duplicate = toolResult("스튜디오 예약");

    expect(deduplicateToolResults([duplicate, { ...duplicate }])).toEqual([
      duplicate,
    ]);
  });
});
