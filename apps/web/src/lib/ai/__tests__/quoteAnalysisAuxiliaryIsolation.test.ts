import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  structuredResponse: vi.fn(),
  recordDecision: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIStructuredResponseWithAudit: mocks.structuredResponse,
}));
vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: mocks.recordDecision,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { maybeClassifyExcavation } from "@/lib/ai/classify-excavation";
import { maybeExtractDecision } from "@/lib/ai/extract-decision";
import { maybeUpdateAmoraProfile } from "@/lib/ai/amora-profile";

const v2Message = `견적 체크: 테스트 스튜디오 · 사진 촬영 · 서울 · 300만원
[quote_analysis_v2]
{"version":2,"category":"studio","region":"seoul","quotePriceManwon":300,"vendorName":"테스트 스튜디오","states":{"included":[],"notNeeded":[],"unknown":[]}}
[/quote_analysis_v2]`;

describe("quote analysis v2 auxiliary isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never sends the v2 machine context to excavation classification", async () => {
    await maybeClassifyExcavation({
      coupleId: "10000000-0000-4000-8000-000000000001",
      lastUserText: v2Message,
      aiResponseText: "이 문장은 분류기 호출을 통과할 만큼 충분히 긴 테스트 응답입니다.",
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
  });

  it("never turns the v2 machine context into a decision node", async () => {
    await maybeExtractDecision({
      coupleId: "10000000-0000-4000-8000-000000000001",
      lastUserText: v2Message,
      messages: [
        { role: "assistant", content: "체크리스트를 확인해 주세요." },
        { role: "user", content: v2Message },
      ],
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it("never compiles the v2 machine context into the legacy couple profile", async () => {
    await maybeUpdateAmoraProfile({
      coupleId: "10000000-0000-4000-8000-000000000001",
      visibility: "shared",
      lastUserText: v2Message,
      aiResponseText: "선택한 견적 항목을 확인했어요.",
      messages: [{ role: "user", content: v2Message }],
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
