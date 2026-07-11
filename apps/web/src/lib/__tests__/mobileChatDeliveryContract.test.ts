import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mobileChatSource = readFileSync(
  join(process.cwd(), "../mobile/app/(tabs)/chat.tsx"),
  "utf8"
);

describe("mobile Amora delivery contract", () => {
  it("limits the query before restoring chronological display order", () => {
    expect(mobileChatSource).toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(200\)/);
    expect(mobileChatSource).toContain("(history ?? []).slice().reverse()");
  });

  it("streams when a response reader exists and retains a text fallback", () => {
    expect(mobileChatSource).toContain("body.getReader()");
    expect(mobileChatSource).toContain("parseChatSse(await response.text())");
    expect(mobileChatSource).toContain("clientCapabilities: { toolCards: false, incrementalSse: true }");
  });

  it("keeps failed input retryable and disables an unavailable partner tab", () => {
    expect(mobileChatSource).toContain("입력한 내용은 그대로 두었어요.");
    expect(mobileChatSource).toContain("disabled={!partnerName || targetLocked}");
    expect(mobileChatSource).toContain("pendingAiRequest ? retrySend : handleSend");
  });
});
