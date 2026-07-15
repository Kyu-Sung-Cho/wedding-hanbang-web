// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Amora mediation card wiring", () => {
  it("renders the confirmation card inside the AI-message branch", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ChatBubble.tsx"),
      "utf8",
    );
    const aiBranchStart = source.indexOf('if (sender_role === "ai")');
    const userBranchStart = source.indexOf("// 사용자 메시지", aiBranchStart);
    expect(aiBranchStart).toBeGreaterThanOrEqual(0);
    expect(userBranchStart).toBeGreaterThan(aiBranchStart);

    const aiBranch = source.slice(aiBranchStart, userBranchStart);
    expect(aiBranch).toContain("message.metadata?.mediation");
    expect(aiBranch).toContain("<MediationCard block={mediationBlock} messageId={message.id} />");
  });

  it("posts only the server message id when a person accepts", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/MediationCard.tsx"),
      "utf8",
    );
    expect(source).toContain('fetch("/api/amora/mediation/accept"');
    expect(source).toContain("body: JSON.stringify({ messageId })");
  });
});
