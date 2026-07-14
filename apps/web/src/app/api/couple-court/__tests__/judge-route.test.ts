import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeValidCourtVerdict } from "@/lib/coupleCourt/__tests__/fixtures";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  getAmoraModelConfig: vi.fn(),
  hasOpenAIConfig: vi.fn(),
  computeCourtInputHash: vi.fn(),
  computeCourtProviderRequestHash: vi.fn(),
  computeCourtProviderRequestKey: vi.fn(),
  generateCourtVerdict: vi.fn(),
  logRecoveredCourtVerdictAudit: vi.fn(),
  assessCourtSafety: vi.fn(),
  claimCourtVerdictForUser: vi.fn(),
  completeCourtVerdictForUser: vi.fn(),
  escalateCourtCaseSafetyFromAiPreflight: vi.fn(),
  failCourtVerdictForUser: vi.fn(),
  finalizeCourtProviderAudit: vi.fn(),
  getCourtCaseQuotaContextForUser: vi.fn(),
  getCourtCaseForUser: vi.fn(),
  getCourtParticipantNamesForPrivacy: vi.fn(),
  getCourtStatementsForJudgment: vi.fn(),
  getCourtUserContext: vi.fn(),
  markCourtVerdictProviderStartedForUser: vi.fn(),
  reserveCourtVerdictProviderCallForUser: vi.fn(),
  settleCourtHighRiskProviderResultForUser: vi.fn(),
  settleCourtUnstagedProviderResult: vi.fn(),
  stageCourtVerdictProviderResultForUser: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/ai/modelConfig", () => ({
  DEFAULT_AMORA_MODEL_BY_ROLE: {
    primary: "gpt-5.6-terra",
    fast: "gpt-5.6-luna",
  },
  getAmoraModelConfig: mocks.getAmoraModelConfig,
  hasOpenAIConfig: mocks.hasOpenAIConfig,
}));

vi.mock("@/lib/coupleCourt/hash", () => ({
  computeCourtInputHash: mocks.computeCourtInputHash,
}));

vi.mock("@/lib/coupleCourt/judge", () => ({
  computeCourtProviderRequestHash: mocks.computeCourtProviderRequestHash,
  computeCourtProviderRequestKey: mocks.computeCourtProviderRequestKey,
  generateCourtVerdict: mocks.generateCourtVerdict,
  logRecoveredCourtVerdictAudit: mocks.logRecoveredCourtVerdictAudit,
}));

vi.mock("@/lib/coupleCourt/safety", () => ({
  assessCourtSafety: mocks.assessCourtSafety,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  claimCourtVerdictForUser: mocks.claimCourtVerdictForUser,
  completeCourtVerdictForUser: mocks.completeCourtVerdictForUser,
  escalateCourtCaseSafetyFromAiPreflight: mocks.escalateCourtCaseSafetyFromAiPreflight,
  failCourtVerdictForUser: mocks.failCourtVerdictForUser,
  finalizeCourtProviderAudit: mocks.finalizeCourtProviderAudit,
  getCourtCaseQuotaContextForUser: mocks.getCourtCaseQuotaContextForUser,
  getCourtCaseForUser: mocks.getCourtCaseForUser,
  getCourtParticipantNamesForPrivacy: mocks.getCourtParticipantNamesForPrivacy,
  getCourtStatementsForJudgment: mocks.getCourtStatementsForJudgment,
  getCourtUserContext: mocks.getCourtUserContext,
  markCourtVerdictProviderStartedForUser: mocks.markCourtVerdictProviderStartedForUser,
  reserveCourtVerdictProviderCallForUser: mocks.reserveCourtVerdictProviderCallForUser,
  settleCourtHighRiskProviderResultForUser: mocks.settleCourtHighRiskProviderResultForUser,
  settleCourtUnstagedProviderResult: mocks.settleCourtUnstagedProviderResult,
  stageCourtVerdictProviderResultForUser: mocks.stageCourtVerdictProviderResultForUser,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { CourtApiError } from "../_shared";
import { POST } from "../cases/[caseId]/judge/route";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "00000000-0000-4000-8000-000000000003";
const VERDICT_ID = "00000000-0000-4000-8000-000000000004";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000005";
const INPUT_HASH = "a".repeat(64);
const REQUEST_HASH = "b".repeat(64);
const REQUEST_KEY = "c".repeat(64);

function request() {
  return new Request(`https://hanbang.ai/api/couple-court/cases/${CASE_ID}/judge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://hanbang.ai",
      "Sec-Fetch-Site": "same-origin",
    },
    body: "{}",
  });
}

function context() {
  return { params: Promise.resolve({ caseId: CASE_ID }) };
}

function executeClaim() {
  return {
    verdictId: VERDICT_ID,
    generationVersion: 1,
    claimStatus: "execute" as const,
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: null,
    result: null,
    missions: [],
    model: null,
    auditModel: null,
    auditUserId: null,
    auditCoupleId: null,
    auditPreflightSafetyLevel: null,
    providerAuditState: null,
    providerRequestKey: null,
    inputHash: null,
    promptVersion: null,
    schemaVersion: null,
    stagedAt: null,
    usage: null,
  };
}

function unavailableClaim() {
  return {
    verdictId: null,
    generationVersion: null,
    claimStatus: "unavailable" as const,
    leaseToken: null,
    leaseExpiresAt: null,
    result: null,
    missions: [],
    model: null,
    auditModel: null,
    auditUserId: null,
    auditCoupleId: null,
    auditPreflightSafetyLevel: null,
    providerAuditState: null,
    providerRequestKey: null,
    inputHash: null,
    promptVersion: null,
    schemaVersion: null,
    stagedAt: null,
    usage: null,
  };
}

function stagedClaim() {
  const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
  return {
    verdict,
    claim: {
      verdictId: VERDICT_ID,
      generationVersion: 1,
      claimStatus: "staged" as const,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2026-07-13T15:30:00.000Z",
      result: verdict as unknown as Record<string, unknown>,
      missions: verdict.missions as unknown as Record<string, unknown>[],
      model: "gpt-5.6-terra",
      auditModel: "gpt-5.6-terra",
      auditUserId: USER_ID,
      auditCoupleId: COUPLE_ID,
      auditPreflightSafetyLevel: "normal" as const,
      providerAuditState: "pending" as const,
      providerRequestKey: REQUEST_KEY,
      inputHash: INPUT_HASH,
      promptVersion: "court-verdict-2026-07-13.4",
      schemaVersion: "1.0",
      stagedAt: "2026-07-13T15:00:00.000Z",
      usage: {
        inputTokens: 301,
        outputTokens: 410,
        cacheWriteInputTokens: 0,
        cachedInputTokens: 25,
      },
    },
  };
}

describe("POST /api/couple-court/cases/[caseId]/judge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_MOCK_ENABLED", "false");

    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
    mocks.getAmoraModelConfig.mockReturnValue({ model: "gpt-5.6-terra" });
    mocks.hasOpenAIConfig.mockReturnValue(true);
    mocks.computeCourtInputHash.mockReturnValue(INPUT_HASH);
    mocks.computeCourtProviderRequestHash.mockReturnValue(REQUEST_HASH);
    mocks.computeCourtProviderRequestKey.mockReturnValue(REQUEST_KEY);
    mocks.assessCourtSafety.mockReturnValue({
      level: "normal",
      categories: [],
      resourceMessage: null,
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rateLimitKey.mockReturnValue("couple-court:judge:user");
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: {
        mode: "couple",
        category: "budget",
        tone: "practical",
        workflow_status: "judging",
        safety_level: "normal",
      },
      verdict: null,
    });
    mocks.getCourtStatementsForJudgment.mockResolvedValue({
      participants: [
        { id: "participant-applicant", role: "applicant" },
        { id: "participant-partner", role: "partner" },
      ],
      statements: [
        {
          participant_id: "participant-applicant",
          facts: "공동 비용 결제 전 서로 확인하기로 약속했습니다.",
          feelings: "상의가 없어 서운했습니다.",
          expectations: "결제 전에 확인하고 싶습니다.",
          attempts: "대화 시간을 요청했습니다.",
          desired_agreement: "답변 마감과 상한을 정하고 싶습니다.",
        },
        {
          participant_id: "participant-partner",
          facts: "선택 마감이 임박해서 당일 결제가 필요했습니다.",
          feelings: "기회를 놓칠까 걱정했습니다.",
          expectations: "답변 시점을 미리 알고 싶습니다.",
          attempts: "메시지로 결제 여부를 물었습니다.",
          desired_agreement: "무응답일 때의 기준을 정하고 싶습니다.",
        },
      ],
    });
    mocks.getCourtParticipantNamesForPrivacy.mockResolvedValue([]);
    mocks.getCourtCaseQuotaContextForUser.mockResolvedValue({
      coupleId: COUPLE_ID,
      safetyScopeId: COUPLE_ID,
    });
    mocks.getCourtUserContext.mockResolvedValue({ coupleId: COUPLE_ID });
    mocks.claimCourtVerdictForUser.mockResolvedValue(executeClaim());
    mocks.reserveCourtVerdictProviderCallForUser.mockResolvedValue({ allowed: true });
    mocks.markCourtVerdictProviderStartedForUser.mockResolvedValue({ provider_state: "started" });
    mocks.stageCourtVerdictProviderResultForUser.mockResolvedValue({ provider_state: "result_staged" });
    mocks.completeCourtVerdictForUser.mockResolvedValue(undefined);
    mocks.failCourtVerdictForUser.mockResolvedValue(true);
    mocks.finalizeCourtProviderAudit.mockResolvedValue({ provider_audit_state: "audited" });
    mocks.settleCourtHighRiskProviderResultForUser.mockResolvedValue({
      provider_state: "failed_invalid",
      provider_audit_state: "pending",
    });
    mocks.settleCourtUnstagedProviderResult.mockResolvedValue({
      provider_state: "failed_invalid",
      provider_audit_state: "pending",
    });
    mocks.escalateCourtCaseSafetyFromAiPreflight.mockResolvedValue({ safety_level: "high_risk" });
    mocks.logRecoveredCourtVerdictAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the rate-limit response before claim, provider, or audit work", async () => {
    const limited = new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(limited);

    const response = await POST(request(), context());

    expect(response).toBe(limited);
    expect(response.status).toBe(429);
    expect(mocks.getCourtCaseForUser).not.toHaveBeenCalled();
    expect(mocks.claimCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.reserveCourtVerdictProviderCallForUser).not.toHaveBeenCalled();
    expect(mocks.markCourtVerdictProviderStartedForUser).not.toHaveBeenCalled();
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
    expect(mocks.logRecoveredCourtVerdictAudit).not.toHaveBeenCalled();
    expect(mocks.finalizeCourtProviderAudit).not.toHaveBeenCalled();
  });

  it("orders execute -> reserve -> start -> validate/stage -> audit -> complete", async () => {
    const events: string[] = [];
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    mocks.claimCourtVerdictForUser.mockImplementation(async () => {
      events.push("claim");
      return executeClaim();
    });
    mocks.reserveCourtVerdictProviderCallForUser.mockImplementation(async () => {
      events.push("reserve");
      return { allowed: true };
    });
    mocks.markCourtVerdictProviderStartedForUser.mockImplementation(async () => {
      events.push("start");
      return { provider_state: "started" };
    });
    mocks.stageCourtVerdictProviderResultForUser.mockImplementation(async () => {
      events.push("stage");
      return { provider_state: "result_staged" };
    });
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      events.push("provider");
      await options.onValidated?.(verdict, {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 301,
          output_tokens: 410,
          cache_write_input_tokens: 0,
          cached_input_tokens: 25,
        },
      });
      events.push("audit");
      return { verdict, model: "gpt-5.6-terra" };
    });
    mocks.completeCourtVerdictForUser.mockImplementation(async () => {
      events.push("complete");
    });
    mocks.finalizeCourtProviderAudit.mockImplementation(async () => {
      events.push("audit-finalize");
      return { provider_audit_state: "audited" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(events).toEqual([
      "claim",
      "reserve",
      "start",
      "provider",
      "stage",
      "audit",
      "audit-finalize",
      "complete",
    ]);
    expect(mocks.stageCourtVerdictProviderResultForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictId: VERDICT_ID,
        inputHash: INPUT_HASH,
        model: "gpt-5.6-terra",
        auditModel: "gpt-5.6-terra",
      }),
    );
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("preserves an audited-stage failure and completes it on retry without another provider call", async () => {
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    const recovered = stagedClaim();
    mocks.claimCourtVerdictForUser
      .mockResolvedValueOnce(executeClaim())
      .mockResolvedValueOnce(recovered.claim);
    mocks.generateCourtVerdict.mockImplementationOnce(async (options) => {
      await options.onValidated?.(verdict, {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 301,
          output_tokens: 410,
          cache_write_input_tokens: 0,
          cached_input_tokens: 25,
        },
      });
      throw new Error("required audit unavailable");
    });

    const first = await POST(request(), context());
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual(expect.objectContaining({
      code: "COURT_VERDICT_FINALIZATION_PENDING",
    }));
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();

    const second = await POST(request(), context());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "ready" });
    expect(mocks.generateCourtVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCourtVerdictProviderCallForUser).toHaveBeenCalledTimes(1);
    expect(mocks.markCourtVerdictProviderStartedForUser).toHaveBeenCalledTimes(1);
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        coupleId: COUPLE_ID,
        model: "gpt-5.6-terra",
        providerRequestKey: REQUEST_KEY,
        inputHash: INPUT_HASH,
        promptVersion: "court-verdict-2026-07-13.4",
        schemaVersion: "1.0",
        usage: recovered.claim.usage,
      }),
    );
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      requestKey: REQUEST_KEY,
    });
    expect(mocks.completeCourtVerdictForUser).toHaveBeenCalledTimes(1);
  });

  it("audits and fences a paid response when private staging fails", async () => {
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    const usage = {
      input_tokens: 301,
      output_tokens: 410,
      cache_write_input_tokens: 0,
      cached_input_tokens: 25,
    };
    mocks.stageCourtVerdictProviderResultForUser.mockRejectedValueOnce(
      new Error("stage unavailable"),
    );
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(verdict, { model: "gpt-5.6-terra", usage });
      return { verdict, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_PROVIDER_RESULT_UNSTAGED",
    }));
    expect(mocks.settleCourtUnstagedProviderResult).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      auditModel: "gpt-5.6-terra",
      usage,
    });
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledTimes(1);
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("retries the payload-free settlement after a lost first acknowledgement", async () => {
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    mocks.stageCourtVerdictProviderResultForUser.mockRejectedValueOnce(
      new Error("stage unavailable"),
    );
    mocks.settleCourtUnstagedProviderResult
      .mockRejectedValueOnce(new Error("settlement acknowledgement lost"))
      .mockResolvedValueOnce({
        provider_state: "failed_invalid",
        provider_audit_state: "pending",
      });
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(verdict, {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 301,
          output_tokens: 410,
          cache_write_input_tokens: 0,
          cached_input_tokens: 25,
        },
      });
      return { verdict, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(mocks.settleCourtUnstagedProviderResult).toHaveBeenCalledTimes(2);
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledTimes(1);
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("repairs a known paid response after the failure-fence acknowledgement is lost", async () => {
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    mocks.stageCourtVerdictProviderResultForUser.mockRejectedValueOnce(
      new Error("stage unavailable"),
    );
    mocks.settleCourtUnstagedProviderResult
      .mockRejectedValueOnce(new Error("first settlement unavailable"))
      .mockRejectedValueOnce(new Error("second settlement unavailable"))
      .mockResolvedValueOnce({
        provider_state: "failed_invalid",
        provider_audit_state: "pending",
      });
    mocks.failCourtVerdictForUser.mockRejectedValueOnce(
      new Error("failure fence acknowledgement lost"),
    );
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(verdict, {
        model: "gpt-5.6-terra",
        usage: undefined,
      });
      return { verdict, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(mocks.settleCourtUnstagedProviderResult).toHaveBeenCalledTimes(3);
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestKey: REQUEST_KEY,
        usage: {
          inputTokens: null,
          outputTokens: null,
          cacheWriteInputTokens: null,
          cachedInputTokens: null,
        },
      }),
    );
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledTimes(1);
  });

  it("preserves a staged result when only the staging acknowledgement is lost", async () => {
    const verdict = makeValidCourtVerdict({ mode: "couple", category: "budget" });
    mocks.stageCourtVerdictProviderResultForUser.mockRejectedValueOnce(
      new Error("stage acknowledgement lost"),
    );
    mocks.settleCourtUnstagedProviderResult.mockResolvedValueOnce({
      provider_state: "result_staged",
      provider_audit_state: "pending",
    });
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(verdict, {
        model: "gpt-5.6-terra",
        usage: undefined,
      });
      return { verdict, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_VERDICT_FINALIZATION_PENDING",
    }));
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("recovers a staged paid result with its stored release identity", async () => {
    const recovered = stagedClaim();
    const historicalInputHash = "d".repeat(64);
    recovered.claim.inputHash = historicalInputHash;
    recovered.claim.promptVersion = "court-verdict-2026-07-12.9";
    recovered.claim.auditModel = "gpt-5.6-terra-2026-06";
    mocks.claimCourtVerdictForUser.mockResolvedValue(recovered.claim);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
    expect(mocks.reserveCourtVerdictProviderCallForUser).not.toHaveBeenCalled();
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputHash: historicalInputHash,
        promptVersion: "court-verdict-2026-07-12.9",
        schemaVersion: "1.0",
        model: "gpt-5.6-terra-2026-06",
      }),
    );
    expect(mocks.completeCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        inputHash: historicalInputHash,
        model: "gpt-5.6-terra",
      }),
    );
  });

  it("recovers a staged paid result while AI creation and provider config are disabled", async () => {
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "false");
    mocks.hasOpenAIConfig.mockReturnValue(false);
    const recovered = stagedClaim();
    mocks.claimCourtVerdictForUser.mockResolvedValue(recovered.claim);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowNewClaim: false }),
    );
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledTimes(1);
    expect(mocks.completeCourtVerdictForUser).toHaveBeenCalledTimes(1);
  });

  it("recovers a staged result even when stale model config is invalid", async () => {
    mocks.hasOpenAIConfig.mockReturnValue(false);
    mocks.getAmoraModelConfig.mockImplementation(() => {
      throw new Error("invalid stale model configuration");
    });
    const recovered = stagedClaim();
    mocks.claimCourtVerdictForUser.mockResolvedValue(recovered.claim);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.getAmoraModelConfig).not.toHaveBeenCalled();
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        allowNewClaim: false,
        model: "gpt-5.6-terra",
      }),
    );
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
  });

  it("does not let a forbidden production mock setting strand a staged paid result", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COUPLE_COURT_MOCK_ENABLED", "true");
    const recovered = stagedClaim();
    mocks.claimCourtVerdictForUser.mockResolvedValue(recovered.claim);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowNewClaim: false }),
    );
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).toHaveBeenCalledTimes(1);
  });

  it("blocks a new claim when production mock configuration is forbidden", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COUPLE_COURT_MOCK_ENABLED", "true");
    mocks.claimCourtVerdictForUser.mockResolvedValue(unavailableClaim());

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_MOCK_FORBIDDEN",
    }));
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowNewClaim: false }),
    );
    expect(mocks.reserveCourtVerdictProviderCallForUser).not.toHaveBeenCalled();
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
  });

  it("rejects an executable lease returned during lookup-only mode", async () => {
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "false");
    mocks.claimCourtVerdictForUser.mockResolvedValue(executeClaim());

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COUPLE_COURT_AI_UNAVAILABLE",
    }));
    expect(mocks.reserveCourtVerdictProviderCallForUser).not.toHaveBeenCalled();
    expect(mocks.markCourtVerdictProviderStartedForUser).not.toHaveBeenCalled();
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("fails closed before a new lease when AI creation is disabled", async () => {
    vi.stubEnv("COUPLE_COURT_AI_ENABLED", "false");
    mocks.claimCourtVerdictForUser.mockResolvedValue(unavailableClaim());

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COUPLE_COURT_AI_UNAVAILABLE",
    }));
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowNewClaim: false }),
    );
    expect(mocks.reserveCourtVerdictProviderCallForUser).not.toHaveBeenCalled();
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
  });

  it("reports missing provider config only after allowing durable recovery lookup", async () => {
    mocks.hasOpenAIConfig.mockReturnValue(false);
    mocks.claimCourtVerdictForUser.mockResolvedValue(unavailableClaim());

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_PROVIDER_UNCONFIGURED",
    }));
    expect(mocks.claimCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowNewClaim: false }),
    );
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
  });

  it("settles a strict structured-output rejection as known invalid", async () => {
    const error = new Error("invalid structured output");
    error.name = "OpenAIStructuredOutputError";
    mocks.generateCourtVerdict.mockRejectedValue(error);

    const response = await POST(request(), context());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_VERDICT_FORMAT_INVALID",
    }));
    expect(mocks.failCourtVerdictForUser).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      errorCode: "structured_output_invalid",
    });
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("blocks an automatic provider retry after a started timeout", async () => {
    const timeout = new Error("provider timeout");
    timeout.name = "AbortError";
    mocks.generateCourtVerdict.mockRejectedValueOnce(timeout);

    const first = await POST(request(), context());
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual(expect.objectContaining({
      code: "COURT_PROVIDER_RESULT_UNKNOWN",
    }));
    expect(mocks.failCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "provider_request_aborted" }),
    );

    mocks.claimCourtVerdictForUser.mockRejectedValueOnce(new CourtApiError(
      503,
      "COURT_PROVIDER_RESULT_UNKNOWN",
      "운영팀 확인이 필요합니다.",
    ));
    const second = await POST(request(), context());

    expect(second.status).toBe(503);
    expect(mocks.generateCourtVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCourtVerdictProviderCallForUser).toHaveBeenCalledTimes(1);
    expect(mocks.markCourtVerdictProviderStartedForUser).toHaveBeenCalledTimes(1);
  });

  it("durably escalates a provider-discovered high risk and never stages a playful verdict", async () => {
    const highRisk = {
      ...makeValidCourtVerdict({ mode: "couple", category: "budget" }),
      safety: {
        level: "high_risk" as const,
        riskTypes: ["violence" as const],
        disablePlayfulVerdict: true,
        publicEligible: false,
        supportMessage: "지금은 안전을 먼저 확인해 주세요.",
      },
      responsibility: null,
      verdict: {
        status: "safety_redirect" as const,
        headline: "안전을 먼저 확인해 주세요",
        reasons: ["즉각적인 안전 확인이 필요한 신호가 있습니다."],
        judgeOneLiner: null,
      },
      missions: [],
      publicCard: null,
    };
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(highRisk, {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 280,
          output_tokens: 190,
          cache_write_input_tokens: 0,
          cached_input_tokens: 0,
        },
      });
      return { verdict: highRisk, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "COURT_SAFETY_REDIRECT",
    }));
    expect(mocks.settleCourtHighRiskProviderResultForUser).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      categories: ["violence"],
      auditModel: "gpt-5.6-terra",
      usage: {
        input_tokens: 280,
        output_tokens: 190,
        cache_write_input_tokens: 0,
        cached_input_tokens: 0,
      },
    });
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      requestKey: REQUEST_KEY,
    });
    expect(mocks.escalateCourtCaseSafetyFromAiPreflight).not.toHaveBeenCalled();
    expect(mocks.stageCourtVerdictProviderResultForUser).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.failCourtVerdictForUser).not.toHaveBeenCalled();
  });

  it("repairs a high-risk settlement after persisting the terminal lease", async () => {
    const highRisk = {
      ...makeValidCourtVerdict({ mode: "couple", category: "budget" }),
      safety: {
        level: "high_risk" as const,
        riskTypes: ["violence" as const],
        disablePlayfulVerdict: true,
        publicEligible: false,
        supportMessage: "지금은 안전을 먼저 확인해 주세요.",
      },
      missions: [],
      publicCard: null,
    };
    mocks.settleCourtHighRiskProviderResultForUser
      .mockRejectedValueOnce(new Error("safety write unavailable"))
      .mockRejectedValueOnce(new Error("safety retry unavailable"));
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(highRisk, {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 280,
          output_tokens: 190,
          cache_write_input_tokens: 0,
          cached_input_tokens: 0,
        },
      });
      return { verdict: highRisk, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(mocks.settleCourtHighRiskProviderResultForUser).toHaveBeenCalledTimes(3);
    expect(mocks.failCourtVerdictForUser).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      errorCode: "safety_escalation_failed",
    });
    expect(mocks.stageCourtVerdictProviderResultForUser).not.toHaveBeenCalled();
    expect(mocks.completeCourtVerdictForUser).not.toHaveBeenCalled();
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeCourtProviderAudit).toHaveBeenCalledWith({
      verdictId: VERDICT_ID,
      requestKey: REQUEST_KEY,
    });
  });

  it("keeps the high-risk request manual when every database settlement attempt fails", async () => {
    const highRisk = {
      ...makeValidCourtVerdict({ mode: "couple", category: "budget" }),
      safety: {
        level: "high_risk" as const,
        riskTypes: ["violence" as const],
        disablePlayfulVerdict: true,
        publicEligible: false,
        supportMessage: "지금은 안전을 먼저 확인해 주세요.",
      },
      missions: [],
      publicCard: null,
    };
    mocks.settleCourtHighRiskProviderResultForUser.mockRejectedValue(
      new Error("database unavailable"),
    );
    mocks.generateCourtVerdict.mockImplementation(async (options) => {
      await options.onValidated?.(highRisk, {
        model: "gpt-5.6-terra",
        usage: undefined,
      });
      return { verdict: highRisk, model: "gpt-5.6-terra" };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(mocks.settleCourtHighRiskProviderResultForUser).toHaveBeenCalledTimes(3);
    expect(mocks.failCourtVerdictForUser).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "safety_escalation_failed" }),
    );
    expect(mocks.logRecoveredCourtVerdictAudit).not.toHaveBeenCalled();
    expect(mocks.finalizeCourtProviderAudit).not.toHaveBeenCalled();
  });

  it("does not claim a staged result is pending after the case is archived", async () => {
    const recovered = stagedClaim();
    mocks.claimCourtVerdictForUser.mockResolvedValue(recovered.claim);
    mocks.getCourtCaseForUser
      .mockResolvedValueOnce({
        case: {
          mode: "couple",
          category: "budget",
          tone: "practical",
          workflow_status: "judging",
          safety_level: "normal",
        },
        verdict: null,
      })
      .mockResolvedValueOnce({
        case: {
          mode: "couple",
          category: "budget",
          tone: "practical",
          workflow_status: "archived",
          safety_level: "normal",
        },
        verdict: null,
      });
    mocks.completeCourtVerdictForUser.mockRejectedValueOnce(
      new CourtApiError(409, "COURT_STATE_CONFLICT", "사건이 보관되었습니다."),
    );

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COURT_CASE_ARCHIVED");
    expect(body.code).not.toBe("COURT_VERDICT_FINALIZATION_PENDING");
    expect(mocks.generateCourtVerdict).not.toHaveBeenCalled();
  });
});
