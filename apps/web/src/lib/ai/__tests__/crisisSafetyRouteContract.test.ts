import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("Amora deterministic crisis-safety route", () => {
  it("checks only the latest user text after authentication and bounded validation", () => {
    const detectorIndex = routeSource.indexOf(
      "hasImmediateKoreanCrisisSignal(crisisCandidateText)"
    );
    const authenticationIndex = routeSource.indexOf("if (!user)");
    const ownershipIndex = routeSource.indexOf("userProfile?.couple_id !== coupleId");
    const responseBranchIndex = routeSource.indexOf("if (hasCrisisSafetySignal)");

    expect(detectorIndex).toBeGreaterThan(-1);
    expect(detectorIndex).toBeGreaterThan(authenticationIndex);
    expect(responseBranchIndex).toBeGreaterThan(detectorIndex);
    expect(responseBranchIndex).toBeLessThan(ownershipIndex);
  });

  it("returns before rate-limit logs, attachments, HMAC, quotas, or provider calls", () => {
    const responseBranchIndex = routeSource.indexOf("if (hasCrisisSafetySignal)");
    const rateLimitIndex = routeSource.indexOf(
      'checkRateLimitPersistent(rateLimitKey("chat", request, user.id)'
    );
    const attachmentIndex = routeSource.indexOf("await processAttachments(");
    const requestIdentityIndex = routeSource.indexOf(
      "({ requestKey, requestHash } = createChatRequestIdentity("
    );
    const modelConfigIndex = routeSource.indexOf("if (!hasOpenAIConfig(");
    const quotaIndex = routeSource.indexOf("await reserveAmoraUserTurn(");
    const providerIndex = routeSource.indexOf("await chatWithToolsStream(");

    expect(responseBranchIndex).toBeGreaterThan(-1);
    expect(responseBranchIndex).toBeLessThan(rateLimitIndex);
    expect(responseBranchIndex).toBeLessThan(attachmentIndex);
    expect(responseBranchIndex).toBeLessThan(requestIdentityIndex);
    expect(responseBranchIndex).toBeLessThan(modelConfigIndex);
    expect(responseBranchIndex).toBeLessThan(quotaIndex);
    expect(responseBranchIndex).toBeLessThan(providerIndex);

    const branchEnd = routeSource.indexOf("const limited", responseBranchIndex);
    const branch = routeSource.slice(responseBranchIndex, branchEnd);
    expect(branch).toContain("return createCrisisSafetySseResponse()");
    expect(branch).not.toContain("console.");
    expect(branch).not.toContain("logAIInteraction");
    expect(branch).not.toContain("crisisCandidateText");
  });

  it("marks the response as deterministic and provider-free without echoing input", () => {
    const helperStart = routeSource.indexOf("function createCrisisSafetySseResponse");
    const helperEnd = routeSource.indexOf(
      "export async function POST",
      helperStart
    );
    const helper = routeSource.slice(helperStart, helperEnd);

    expect(helper).toContain("KOREAN_CRISIS_SAFETY_RESPONSE");
    expect(helper).toContain('type: "done"');
    expect(helper).toContain("safetyResponse: true");
    expect(helper).toContain("providerCalled: false");
    expect(helper).not.toContain("userText");
    expect(helper).not.toContain("userInput");
    expect(helper).not.toContain("console.");
  });
});
