import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat-to-community privacy copy", () => {
  it("warns about sensitive text and image OCR limitations before publishing", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
      "utf8",
    );

    expect(source).toContain("건강·임신·성생활 정보");
    expect(source).toContain("민감한 가족관계");
    expect(source).toContain("계약·예약번호가");
    expect(source).toContain("사진 속 글자도 직접 확인해");
  });

  it("never offers feedback or a community draft from a W2/W5 safety answer", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
      "utf8",
    );

    expect(source).toContain("function isSafetyScopedChatMessage");
    expect(source).toContain("isAmoraCommunityBridgeSafetyScoped(message)");
    expect(source).toMatch(
      /\.filter\(\(m\) =>[\s\S]*m\.sender_role === "ai"[\s\S]*!isSafetyScopedChatMessage\(m\)/,
    );
    expect(source).toContain(
      "const isCommunityFallbackEligible = !isSafetyScopedChatMessage(msg)",
    );
    expect(source).toContain(
      "!isSafetyScopedChatMessage(previousHumanMessage)",
    );
  });
});
