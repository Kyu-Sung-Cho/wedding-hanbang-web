import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");

describe("Amora deterministic relationship-violence route", () => {
  it("checks server-canonical text and returns before paid or attachment work", () => {
    const branch = routeSource.indexOf(
      "hasImmediateKoreanRelationshipViolenceSignal(canonicalTranscript.currentUserText)",
    );
    const canonical = routeSource.indexOf("buildCanonicalChatTranscript({");
    const rateLimit = routeSource.indexOf(
      'checkRateLimitPersistent(rateLimitKey("chat", request, user.id)',
    );
    const attachments = routeSource.indexOf("await processAttachments(");
    const provider = routeSource.indexOf("await chatWithToolsStream(");

    expect(branch).toBeGreaterThan(canonical);
    expect(branch).toBeLessThan(rateLimit);
    expect(branch).toBeLessThan(attachments);
    expect(branch).toBeLessThan(provider);
  });

  it("uses a fixed provider-free response without echoing the source text", () => {
    const helperStart = routeSource.indexOf("function createRelationshipViolenceSafetySseResponse");
    const helperEnd = routeSource.indexOf("export async function POST", helperStart);
    const helper = routeSource.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain("KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE");
    expect(helper).toContain('safetyKind: "relationship_violence"');
    expect(helper).toContain("providerCalled: false");
    expect(helper).not.toContain("userText");
    expect(helper).not.toContain("userInput");
  });
});
