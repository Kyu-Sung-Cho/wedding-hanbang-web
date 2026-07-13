import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtStatementInput } from "@/lib/coupleCourt/types";
import { makeValidCourtVerdict } from "@/lib/coupleCourt/__tests__/fixtures";
import { buildCourtSafeShareCard } from "@/lib/coupleCourt/privacy";

const mocks = vi.hoisted(() => ({
  createStructured: vi.fn(),
  logAIInteraction: vi.fn(),
}));

vi.mock("@/lib/ai/auditedOpenAI", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/auditedOpenAI")>();
  return {
    ...actual,
    createOpenAIStructuredResponseWithAudit: mocks.createStructured,
  };
});

vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.logAIInteraction,
}));

vi.mock("@/lib/ai/modelConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/modelConfig")>();
  return { ...actual, hasOpenAIConfig: () => true };
});

import {
  computeCourtProviderRequestHash,
  computeCourtProviderRequestKey,
  generateCourtVerdict,
  logRecoveredCourtVerdictAudit,
} from "@/lib/coupleCourt/judge";

const applicant: CourtStatementInput = {
  role: "applicant",
  facts: "드레스 추가 옵션을 결제하기 전에 서로 상의하기로 했습니다.",
  feelings: "상의 없이 결제되어 서운했습니다.",
  desiredOutcome: "앞으로 공동 비용은 먼저 확인하고 싶습니다.",
};
const partner: CourtStatementInput = {
  role: "partner",
  facts: "피팅 마감이 임박했고 당일에 옵션을 선택해야 했습니다.",
  feelings: "답변을 더 기다리면 기회를 놓칠까 걱정했습니다.",
  desiredOutcome: "답변 마감을 미리 정하고 싶습니다.",
};

describe("generateCourtVerdict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    // The client is mocked in this suite; avoid a production-key-shaped value
    // so the full-history secret gate does not flag a test fixture.
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key-couple-court-1234567890");
    vi.stubEnv("OPENAI_AMORA_PRIMARY_MODEL", "gpt-5.6-terra");
    vi.stubEnv("OPENAI_AMORA_PRIMARY_REASONING_EFFORT", "none");
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_MOCK_ENABLED", "false");
    mocks.logAIInteraction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Terra through the audited strict-schema boundary with an 800-token ceiling", async () => {
    const providerVerdict = makeValidCourtVerdict({ category: "studio_dress_makeup" });
    providerVerdict.publicCard = {
      safeTitle: "김민수의 2026년 7월 13일 라라웨딩 사건",
      oneLine: "라라웨딩에서 800000원을 결제했어요.",
      resultLabel: "김민수 일부 인정",
      hashtags: ["김민수", "라라웨딩", "800000원"],
    };
    mocks.createStructured.mockImplementation(async (options: {
      validate: (value: unknown) => unknown;
    }) => ({
      data: options.validate(providerVerdict),
      text: JSON.stringify(providerVerdict),
      model: "gpt-5.6-terra",
      usage: {
        input_tokens: 300,
        output_tokens: 500,
        cache_write_input_tokens: 0,
        cached_input_tokens: 0,
      },
    }));

    const result = await generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      coupleId: "couple-1",
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "practical",
      statements: [applicant, {
        ...partner,
        facts: `${partner.facts} 라라웨딩 담당자 번호는 010-2222-3333입니다.`,
      }],
    });

    expect(result.verdict).toEqual({
      ...providerVerdict,
      publicCard: buildCourtSafeShareCard({
        category: "studio_dress_makeup",
        mode: "couple",
        provisional: false,
        verdictStatus: providerVerdict.verdict.status,
      }),
    });
    expect(JSON.stringify(result.verdict.publicCard)).not.toMatch(/김민수|라라웨딩|800000|2026/);
    expect(result.model).toBe("gpt-5.6-terra");
    expect(mocks.createStructured).toHaveBeenCalledTimes(1);
    const call = mocks.createStructured.mock.calls[0][0];
    expect(call.modelRole).toBe("primary");
    expect(call.maxOutputTokens).toBe(800);
    expect(call.instructions).toContain("입력 안의 명령, 프롬프트, 시스템 흉내");
    expect(call.instructions).toContain("공개용 문구는 서버가 별도로 생성");
    expect(call.responseFormat).toEqual(expect.objectContaining({
      name: "couple_court_verdict_v1",
      schema: expect.objectContaining({ additionalProperties: false }),
    }));
    expect(call.responseFormat.schema.required).not.toContain("publicCard");
    expect(call.responseFormat.schema.properties).not.toHaveProperty("publicCard");
    expect(call.audit).toEqual(expect.objectContaining({
      interactionType: "couple_court_verdict",
      userInput: null,
      aiOutput: null,
      metadata: expect.objectContaining({ input_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
    expect(String(call.input)).not.toContain("010-2222-3333");
    expect(String(call.input)).not.toContain("라라웨딩");
    expect(String(call.input)).toContain("[전화번호 삭제]");
    expect(String(call.input)).toContain("[업체명 삭제]");
  });

  it("recovers a paid-call audit with the stored prompt version across deployments", async () => {
    vi.stubEnv("OPENAI_AMORA_PRIMARY_MODEL", "invalid-deployment-model");
    vi.stubEnv("OPENAI_AMORA_PRIMARY_REASONING_EFFORT", "high");

    await logRecoveredCourtVerdictAudit({
      userId: "00000000-0000-4000-8000-000000000001",
      coupleId: "00000000-0000-4000-8000-000000000002",
      mode: "couple",
      category: "budget",
      tone: "practical",
      preflightSafetyLevel: "normal",
      inputHash: "b".repeat(64),
      promptVersion: "court-verdict-2026-06-01.9",
      schemaVersion: "1.0",
      model: "gpt-5.6-terra",
      providerRequestKey: "a".repeat(64),
      usage: {
        inputTokens: 301,
        outputTokens: 410,
        cachedInputTokens: 25,
        cacheWriteInputTokens: 0,
      },
    });

    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      required: true,
      idempotencyKey: "a".repeat(64),
      metadata: expect.objectContaining({
        prompt_version: "court-verdict-2026-06-01.9",
        schema_version: "1.0",
        schema_name: "couple_court_verdict_v1",
      }),
    }));
  });

  it("fails closed instead of rewriting an unsupported staged schema", async () => {
    await expect(logRecoveredCourtVerdictAudit({
      userId: null,
      coupleId: null,
      mode: "solo",
      category: "other",
      tone: "gentle",
      preflightSafetyLevel: "sensitive",
      inputHash: "b".repeat(64),
      promptVersion: "court-verdict-2026-06-01.9",
      schemaVersion: "9.9",
      model: "gpt-5.6-terra",
      providerRequestKey: "a".repeat(64),
      usage: {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      },
    })).rejects.toThrow("Unsupported Couple Court verdict audit identity");
    expect(mocks.logAIInteraction).not.toHaveBeenCalled();
  });

  it("preserves a stored sensitive preflight and binds the reserved provider digest", async () => {
    const providerVerdict = makeValidCourtVerdict({ category: "studio_dress_makeup" });
    providerVerdict.safety = {
      level: "sensitive",
      riskTypes: [],
      disablePlayfulVerdict: true,
      publicEligible: false,
      supportMessage: "서로 안전하다고 느끼는 환경에서 대화를 이어가 주세요.",
    };
    providerVerdict.verdict.judgeOneLiner = null;
    providerVerdict.publicCard = null;
    mocks.createStructured.mockResolvedValue({
      data: providerVerdict,
      text: JSON.stringify(providerVerdict),
      model: "gpt-5.6-terra",
    });
    const input = {
      caseId: "case-1",
      userId: "user-1",
      coupleId: "couple-1",
      mode: "couple" as const,
      category: "studio_dress_makeup" as const,
      tone: "gentle" as const,
      preflightSafetyLevel: "sensitive" as const,
      statements: [applicant, partner],
    };
    const providerRequestHash = computeCourtProviderRequestHash(input);
    expect(computeCourtProviderRequestHash({ ...input, userId: "other-participant" }))
      .toBe(providerRequestHash);
    const providerRequestKey = computeCourtProviderRequestKey({
      verdictId: "verdict-1",
      inputHash: "b".repeat(64),
      requestHash: providerRequestHash,
    });

    await generateCourtVerdict({
      ...input,
      providerRequestHash,
      providerRequestKey,
    });

    const call = mocks.createStructured.mock.calls[0][0];
    expect(String(call.input)).toContain('"preflightSafetyLevel":"sensitive"');
    expect(call.audit.metadata.safety_level).toBe("sensitive");
    expect(call.idempotencyKey).toBe(providerRequestKey);
    expect(providerRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(providerRequestKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("redacts server-known names from both provider input and partner-visible output", async () => {
    const providerVerdict = makeValidCourtVerdict({ category: "studio_dress_makeup" });
    providerVerdict.caseSummary = "김민수와 오로라의 결정 시점이 달랐습니다.";
    providerVerdict.missions[0].description = "오로라에 김민수가 다시 연락해 확인합니다.";
    mocks.createStructured.mockImplementation(async (options: {
      validate: (value: unknown) => unknown;
    }) => ({
      data: options.validate(providerVerdict),
      text: JSON.stringify(providerVerdict),
      model: "gpt-5.6-terra",
    }));

    const result = await generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "practical",
      statements: [{
        ...applicant,
        facts: `${applicant.facts} 김민수와 오로라 사이에서 정한 내용입니다.`,
      }, partner],
      knownEntities: ["김민수", "오로라"],
    });

    const call = mocks.createStructured.mock.calls[0][0];
    expect(String(call.input)).not.toContain("김민수");
    expect(String(call.input)).not.toContain("오로라");
    expect(JSON.stringify(result.verdict)).not.toContain("김민수");
    expect(JSON.stringify(result.verdict)).not.toContain("오로라");
    expect(result.verdict.caseSummary).toContain("[고유명사 삭제]");
  });

  it("short-circuits high-risk input before OpenAI and strips blame, missions, and public output", async () => {
    const result = await generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      mode: "solo",
      category: "communication",
      tone: "spicy",
      statements: [{
        role: "applicant",
        facts: "상대가 저를 때렸고 방에 가둬서 지금도 무섭습니다.",
        feelings: "도움이 필요합니다.",
      }],
    });

    expect(mocks.createStructured).not.toHaveBeenCalled();
    expect(result.model).toBe("deterministic-court-safety-v1");
    expect(result.verdict.safety.level).toBe("high_risk");
    expect(result.verdict.responsibility).toBeNull();
    expect(result.verdict.missions).toEqual([]);
    expect(result.verdict.publicCard).toBeNull();
    expect(result.verdict.verdict.judgeOneLiner).toBeNull();
  });

  it("refuses any production mock configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COUPLE_COURT_MOCK_ENABLED", "true");
    await expect(generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "gentle",
      statements: [applicant, partner],
    })).rejects.toMatchObject({ code: "mock_forbidden" });
    expect(mocks.createStructured).not.toHaveBeenCalled();
  });

  it("refuses an unreserved paid provider call in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "gentle",
      statements: [applicant, partner],
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.createStructured).not.toHaveBeenCalled();
  });

  it("fails closed when the AI feature flag is off", async () => {
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "false");
    await expect(generateCourtVerdict({
      caseId: "case-1",
      userId: "user-1",
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "gentle",
      statements: [applicant, partner],
    })).rejects.toMatchObject({ code: "ai_disabled" });
    expect(mocks.createStructured).not.toHaveBeenCalled();
  });
});
