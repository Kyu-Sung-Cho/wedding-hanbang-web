import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("web chat retry consumer contract", () => {
  it("offers the same accessible retry action in the full chat and side panel", () => {
    for (const path of [
      "src/components/app/chat/ChatContent.tsx",
      "src/components/app/chat/ChatSidePanel.tsx",
    ]) {
      const source = readSource(path);
      expect(source).toContain("답변 다시 받기");
      expect(source).toContain("저장된 질문으로 아모라 답변 다시 받기");
      expect(source).toContain("retryAiResponse");
      expect(source).toContain('role="alert"');
      expect(source).toContain('aria-live="assertive"');
    }
  });

  it("restores the draft only when the user message itself was not stored", () => {
    const fullChat = readSource("src/components/app/chat/ChatContent.tsx");
    const sidePanel = readSource("src/components/app/chat/ChatSidePanel.tsx");

    for (const source of [fullChat, sidePanel]) {
      expect(source).toContain("const userMessageStored = await sendMessage");
      expect(source).toContain("setAttachments((current) =>");
      expect(source).toContain("current || content");
    }
  });
});
