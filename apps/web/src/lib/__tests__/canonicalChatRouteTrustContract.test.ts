import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Amora canonical chat route trust contract", () => {
  it("does not accept a browser transcript as model or tool context", () => {
    const route = read("src/app/api/chat/route.ts");
    const webStore = read("src/stores/chatStore.ts");
    const mobileChat = read("../mobile/app/(tabs)/chat.tsx");

    expect(route).not.toContain("messages: rawMessages");
    expect(route).toContain("buildCanonicalChatTranscript({");
    expect(route).toContain("const messages = canonicalTranscript.messages");
    expect(route).toContain("const lastUserText = canonicalTranscript.currentUserText");
    expect(route).not.toContain("currentUserText: lastUserText");

    expect(webStore).toContain("currentUserMessageId,");
    expect(webStore).not.toContain("messages: recentMessages");
    expect(mobileChat).toContain("currentUserMessageId: userMsg.id");
    expect(mobileChat).not.toContain("messages: recentContext");
  });

  it("keeps transcript-derived mutation and hidden memory work fail-closed", () => {
    const route = read("src/app/api/chat/route.ts");
    const webStore = read("src/stores/chatStore.ts");

    expect(route).toContain("const ENABLE_AUXILIARY_MEMORY = false");
    expect(route).not.toContain("allowMutations");
    expect(route).toContain("selectAmoraToolsForTurn(WEDDING_TOOLS");
    expect(route).not.toContain("claimToolExecution");
    expect(webStore).toContain("자동 갈등 중재는 현재 제공하지 않아요");
    expect(webStore).not.toContain('const clientRequestId = createChatRequestId("mediation")');
  });
});
