import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(
    resolve(process.cwd(), `src/components/app/chat/${fileName}`),
    "utf8",
  );
}

describe("structured mediation entry contract", () => {
  it.each(["ChatContent.tsx", "ChatSidePanel.tsx"])(
    "%s uses the consent dialog and structured store action",
    (fileName) => {
      const content = source(fileName);

      expect(content).toContain(
        "requestMediation: requestStructuredMediation",
      );
      expect(content).toContain("<MediationConsentDialog");
      expect(content).toContain("await requestStructuredMediation({");
      expect(content).not.toContain(
        'handleSend(`아모라, 우리가 "${lastTopic}" 관련해서 의견이 다른데 도움 줄 수 있어?`)',
      );
    },
  );

  it("keeps the shared visibility and wedding-only input copy explicit", () => {
    const main = source("ChatContent.tsx");
    const panel = source("ChatSidePanel.tsx");

    expect(main).toContain("현재 범위 · 함께 대화 — 파트너에게 보여요");
    expect(panel).toContain("현재 범위 · 함께 대화 — 파트너에게 보여요");
    expect(main).toContain("결혼 준비에서 궁금한 점을 물어보세요…");
    expect(panel).toContain("결혼 준비에서 궁금한 점을 물어보세요…");
  });
});
