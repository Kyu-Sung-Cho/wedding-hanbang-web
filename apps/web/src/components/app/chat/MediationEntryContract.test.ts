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

  it.each(["ChatContent.tsx", "ChatSidePanel.tsx"])(
    "%s binds dismissal and consent to the assessed conflict event key",
    (fileName) => {
      const content = source(fileName);

      expect(content).toMatch(/assessMediationOffer\(\s*messages(?:\s*,|\s*\))/);
      expect(content).toContain("dismissedMediationOfferKey");
      expect(content).toContain("mediationConsentContext");
      expect(content).toContain("mediationConsentContext.ownerUserId === profile?.id");
      expect(content).toContain("mediationConsentContext.coupleId === coupleId");
      expect(content).toContain("setMediationConsentContext(null)");
      expect(content).not.toContain("setMediationDismissed(true)");
    },
  );

  it.each(["ChatContent.tsx", "ChatSidePanel.tsx"])(
    "%s keeps the manual entry separate from automatic event dismissal",
    (fileName) => {
      const content = source(fileName);

      expect(content).toContain('data-mediation-entry="manual"');
      expect(content).toContain("의견이 엇갈렸다면 조율 도움 받기");
      expect(content).toContain('source: "manual"');
      expect(content).toContain('source: "automatic"');
      expect(content).toContain('mediationConsentContext.source === "automatic"');
    },
  );

  it.each(["ChatContent.tsx", "ChatSidePanel.tsx"])(
    "%s suppresses every mediation entry for the current actor's unresolved private safety hold",
    (fileName) => {
      const content = source(fileName);

      expect(content).toContain("hasLocalPrivateMediationSafetyHold");
      expect(content).toContain("hasUnresolvedPrivateMediationSafetyHold(");
      expect(content).not.toContain("latestLocalPrivateMessage");
      expect(content).toMatch(
        /showMediationBanner\s*=[\s\S]{0,320}!hasLocalPrivateMediationSafetyHold/,
      );
      expect(content).toMatch(
        /showManualMediationEntry\s*=[\s\S]{0,320}!hasLocalPrivateMediationSafetyHold/,
      );
    },
  );

  it.each(["ChatContent.tsx", "ChatSidePanel.tsx"])(
    "%s suppresses automatic and manual mediation for a visible shared safety card",
    (fileName) => {
      const content = source(fileName);

      expect(content).toContain("hasVisibleSharedSafetyCard");
      expect(content).toMatch(
        /showMediationBanner\s*=[\s\S]{0,420}!hasVisibleSharedSafetyCard/,
      );
      expect(content).toMatch(
        /showManualMediationEntry\s*=[\s\S]{0,420}!hasVisibleSharedSafetyCard/,
      );
    },
  );
});
