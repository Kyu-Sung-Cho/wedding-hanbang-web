import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCourtSafeShareCard: vi.fn(),
  createClientFromRequest: vi.fn(),
  getCourtCaseForUser: vi.fn(),
  getCourtVerdictRecoveryDelaySeconds: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  getCourtCaseForUser: mocks.getCourtCaseForUser,
  getCourtVerdictRecoveryDelaySeconds: mocks.getCourtVerdictRecoveryDelaySeconds,
}));

vi.mock("@/lib/coupleCourt/privacy", () => ({
  buildCourtSafeShareCard: mocks.buildCourtSafeShareCard,
}));

import { GET } from "../cases/[caseId]/verdict/route";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const VERDICT_ID = "00000000-0000-4000-8000-000000000003";
const context = { params: Promise.resolve({ caseId: CASE_ID }) };

function request(): Request {
  return new Request(`https://hanbang.ai/api/couple-court/cases/${CASE_ID}/verdict`);
}

function baseCase(safetyLevel: "normal" | "sensitive" | "high_risk") {
  return {
    mode: "couple",
    category: "budget",
    workflow_status: "verdict_ready",
    safety_level: safetyLevel,
  };
}

describe("GET /api/couple-court/cases/[caseId]/verdict", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replaces provider-authored publicCard variants with the server-generated card", async () => {
    const safeShareCard = {
      safeTitle: "예산 갈등 커플재판소 판결",
      oneLine: "두 사람의 진술을 바탕으로 정리했어요.",
      resultLabel: "공동 책임",
      hashtags: ["커플재판소", "예산"],
    };
    mocks.buildCourtSafeShareCard.mockReturnValue(safeShareCard);
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: baseCase("normal"),
      verdict: {
        id: VERDICT_ID,
        completed_at: "2026-07-14T02:00:00.000Z",
        created_at: "2026-07-14T01:00:00.000Z",
        result_json: {
          caseMeta: { provisional: false },
          safety: { level: "normal", publicEligible: true },
          verdict: {
            status: "shared_responsibility",
            headline: "함께 기준을 정해요",
            judgeOneLiner: "서로 확인하는 절차가 필요해요.",
          },
          publicCard: { oneLine: "provider leak 010-1234-5678" },
          public_card: { oneLine: "provider snake-case leak" },
        },
      },
      missions: [{ id: "mission-1" }],
    });

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict.publicCard).toEqual(safeShareCard);
    expect(body.verdict).not.toHaveProperty("public_card");
    expect(JSON.stringify(body)).not.toContain("provider leak");
    expect(JSON.stringify(body)).not.toContain("provider snake-case leak");
    expect(mocks.buildCourtSafeShareCard).toHaveBeenCalledWith({
      category: "budget",
      mode: "couple",
      provisional: false,
      verdictStatus: "shared_responsibility",
    });
  });

  it("blocks verdict disclosure for a high-risk case", async () => {
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: baseCase("high_risk"),
      verdict: {
        id: VERDICT_ID,
        result_json: {
          verdict: { status: "shared_responsibility" },
          publicCard: { oneLine: "must not be returned" },
        },
      },
      missions: [{ id: "mission-1" }],
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: "safety_redirect",
      verdict: null,
      safety: { level: "high_risk" },
    });
    expect(mocks.buildCourtSafeShareCard).not.toHaveBeenCalled();
  });

  it("fails closed for a malformed stored verdict result", async () => {
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: baseCase("normal"),
      verdict: {
        id: VERDICT_ID,
        result_json: [],
      },
      missions: [],
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_VERDICT_INVALID",
    });
    expect(mocks.buildCourtSafeShareCard).not.toHaveBeenCalled();
  });
});
