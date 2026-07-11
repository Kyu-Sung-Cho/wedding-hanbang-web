import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chatContent = readFileSync(
  join(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
  "utf8"
);
const chatRoute = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("demo chat truthfulness", () => {
  it("keeps the unauthenticated demo read-only and offers a real login path", () => {
    expect(chatContent).toContain("if (isDemo) return;");
    expect(chatContent).toContain("이 화면은 샘플 기록을 둘러보는 데모예요");
    expect(chatContent).toContain("로그인하고 상담하기");
    expect(chatContent).toContain("disabled={isDemo || isStreaming}");
    expect(chatContent).toContain("disabled={isDemo || (!input.trim()");
    expect(chatRoute).toContain('code: "demo_chat_disabled"');
    expect(chatRoute.indexOf("if (isDemo)")).toBeLessThan(
      chatRoute.indexOf("const limited = await checkRateLimitPersistent")
    );
    expect(chatRoute).not.toContain("completeChatExecutionWithoutReplay");
  });
});
