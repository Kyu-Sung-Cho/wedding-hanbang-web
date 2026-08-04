import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  structuredResponse: vi.fn(),
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIStructuredResponseWithAudit: mocks.structuredResponse,
}));

import { compileAmoraMemory } from "@/lib/ai/amoraMemoryCompiler";

describe("Amora durable memory compiler execution boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.structuredResponse.mockResolvedValue({
      data: { summary: "아모라가 호텔을 추천했다.", memories: [] },
    });
  });

  it("advances an assistant-only cursor batch without calling the model or creating factual output", async () => {
    const beforeGeneration = vi.fn();
    const result = await compileAmoraMemory({
      coupleId: "10000000-0000-4000-8000-000000000001",
      visibility: "shared",
      beforeGeneration,
      beforeProviderEgress: () => {},
      messages: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          role: "assistant",
          content: "샘플 호텔을 가장 선호한다고 기억할게.",
          sourceActorRole: null,
        },
      ],
    });

    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("requires exact counting and forwards the atomic budget gate before compilation", async () => {
    const beforeGeneration = vi.fn();
    await compileAmoraMemory({
      coupleId: "10000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000001",
      visibility: "shared",
      beforeGeneration,
      beforeProviderEgress: () => {},
      messages: [{
        id: "20000000-0000-4000-8000-000000000001",
        role: "user",
        content: "강남 쪽을 선호해요",
        sourceActorRole: "bride",
      }],
    });

    expect(mocks.structuredResponse).toHaveBeenCalledWith(expect.objectContaining({
      maxInputTokens: 64_000,
      beforeGeneration,
      // 컴파일러가 호출부의 egress gate를 그대로 SDK 경계까지 넘겨야 한다.
      beforeProviderEgress: expect.any(Function),
    }));
  });
});
