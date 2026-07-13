import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readWebSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("paid initial greeting contract", () => {
  it("does not expose or call an automatic provider-backed greeting", () => {
    const sources = [
      "src/stores/chatStore.ts",
      "src/components/app/chat/ChatContent.tsx",
      "src/components/app/chat/ChatSidePanel.tsx",
    ].map(readWebSource);

    for (const source of sources) {
      expect(source).not.toContain("requestInitialGreeting");
      expect(source).not.toContain("[INITIAL_GREETING]");
    }
  });
});
