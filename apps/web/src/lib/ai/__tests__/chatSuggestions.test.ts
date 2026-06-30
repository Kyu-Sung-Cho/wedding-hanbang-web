import { describe, expect, it } from "vitest";
import { extractSuggestions, stripSuggestionArtifacts } from "../chatSuggestions";

describe("extractSuggestions", () => {
  it("extracts a suggestions block and returns clean text", () => {
    const result = extractSuggestions(`본문입니다.

[suggestions]
예산 다시 보기
견적 확인하기
[/suggestions]`);

    expect(result.cleanText).toBe("본문입니다.");
    expect(result.suggestions).toEqual(["예산 다시 보기", "견적 확인하기"]);
  });

  it("extracts fenced suggestion blocks", () => {
    const result = extractSuggestions(`답변
\`\`\`
[suggestion]
다음 질문
[/suggestion]
\`\`\``);

    expect(result.cleanText).toBe("답변");
    expect(result.suggestions).toEqual(["다음 질문"]);
  });

  it("strips orphan suggestion artifact lines without inventing suggestions", () => {
    expect(stripSuggestionArtifacts("[추천 질문]\n본문\n[/suggestions]")).toBe("\n본문\n");
    expect(extractSuggestions("본문만 있음")).toEqual({
      cleanText: "본문만 있음",
      suggestions: [],
    });
  });
});
