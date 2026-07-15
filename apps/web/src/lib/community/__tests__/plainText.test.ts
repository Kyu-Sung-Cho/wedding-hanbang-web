import { describe, expect, it } from "vitest";
import { communityHtmlToPlainText } from "@hanbang/shared";

describe("communityHtmlToPlainText", () => {
  it("keeps adjacent paragraphs separated in compact previews", () => {
    expect(communityHtmlToPlainText("<p>첫 문단</p><p>둘째 문단</p>")).toBe(
      "첫 문단 둘째 문단",
    );
    expect(communityHtmlToPlainText("<p>a</p><p>b</p>")).not.toBe("ab");
  });

  it("preserves readable paragraph boundaries for full mobile text", () => {
    expect(
      communityHtmlToPlainText("<div>첫 줄<br>다음 줄</div><blockquote>인용</blockquote>", {
        preserveParagraphs: true,
      }),
    ).toBe("첫 줄\n\n다음 줄\n\n인용");
  });

  it("decodes common entities after stripping tags", () => {
    expect(communityHtmlToPlainText("<p>A&nbsp;&amp;&nbsp;B</p>")).toBe("A & B");
  });
});
