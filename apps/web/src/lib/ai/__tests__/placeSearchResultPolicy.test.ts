import { describe, expect, it } from "vitest";
import {
  getModelSafeToolOutput,
  getPersistableToolResults,
  hasEphemeralPlaceSearchResult,
} from "@/lib/ai/placeSearchResultPolicy";
import type { ToolExecutionResult } from "@/types/database.types";

const placeResult: ToolExecutionResult = {
  toolName: "search_nearby_places",
  toolInput: { query: "강남 상견례 식당" },
  toolOutput: {
    places: [{ name: "외부 입력", address: "서울", imageUrl: "https://example.com/a.jpg" }],
    query: "강남 상견례 식당",
  },
  success: true,
  displayMessage: "검색 결과 1곳을 찾았습니다.",
};

const budgetResult: ToolExecutionResult = {
  toolName: "update_budget",
  toolInput: { total_budget: 30_000_000 },
  toolOutput: { total_budget: 30_000_000 },
  success: true,
  displayMessage: "예산을 변경했습니다.",
};

describe("place search result policy", () => {
  it("keeps NAVER results out of persisted chat metadata", () => {
    expect(getPersistableToolResults([placeResult, budgetResult])).toEqual([budgetResult]);
  });

  it("sends only a fixed render status to the model", () => {
    const safeOutput = getModelSafeToolOutput(placeResult);
    expect(safeOutput).toEqual({ success: true, status: "rendered_in_client" });
    expect(JSON.stringify(safeOutput)).not.toContain("외부 입력");
    expect(JSON.stringify(safeOutput)).not.toContain("강남");
    expect(JSON.stringify(safeOutput)).not.toContain("http");
  });

  it("detects the result that must lock later tool rounds", () => {
    expect(hasEphemeralPlaceSearchResult([placeResult])).toBe(true);
    expect(hasEphemeralPlaceSearchResult([budgetResult])).toBe(false);
  });
});
