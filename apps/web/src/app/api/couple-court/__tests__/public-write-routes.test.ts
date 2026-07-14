import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  getCourtCaseForUser: vi.fn(),
  getCourtParticipantNamesForPrivacy: vi.fn(),
  prepareCourtPublicSnapshotForUser: vi.fn(),
  setCourtPublicConsentForUser: vi.fn(),
  buildPublicCourtSnapshot: vi.fn(),
  hashPublicCourtSnapshot: vi.fn(),
  validateCourtVerdict: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "public-write-key"),
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  getCourtCaseForUser: mocks.getCourtCaseForUser,
  getCourtParticipantNamesForPrivacy: mocks.getCourtParticipantNamesForPrivacy,
  prepareCourtPublicSnapshotForUser: mocks.prepareCourtPublicSnapshotForUser,
  setCourtPublicConsentForUser: mocks.setCourtPublicConsentForUser,
}));

vi.mock("@/lib/coupleCourt/privacy", () => ({
  buildPublicCourtSnapshot: mocks.buildPublicCourtSnapshot,
  hashPublicCourtSnapshot: mocks.hashPublicCourtSnapshot,
}));

vi.mock("@/lib/coupleCourt/schema", () => ({
  validateCourtVerdict: mocks.validateCourtVerdict,
}));

import { POST as consent } from "../cases/[caseId]/public-consent/route";
import { POST as preview } from "../cases/[caseId]/public-preview/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CASE_ID = "00000000-0000-4000-8000-000000000002";
const POST_ID = "00000000-0000-4000-8000-000000000003";
const SNAPSHOT_HASH = "a".repeat(64);
const context = { params: Promise.resolve({ caseId: CASE_ID }) };

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://hanbang.ai${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://hanbang.ai",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("Couple Court public write routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv("COUPLE_COURT_PUBLIC_ENABLED", "true");
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.getCourtParticipantNamesForPrivacy.mockResolvedValue([]);
  });

  it("rejects a consent mutation when the explicit boolean is missing", async () => {
    const response = await consent(request(
      `/api/couple-court/cases/${CASE_ID}/public-consent`,
      { public_post_id: POST_ID, snapshot_hash: SNAPSHOT_HASH },
    ), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_PUBLIC_CONSENT_INVALID",
    });
    expect(mocks.getCourtCaseForUser).not.toHaveBeenCalled();
    expect(mocks.setCourtPublicConsentForUser).not.toHaveBeenCalled();
  });

  it("preserves an explicit false consent as a withdrawal", async () => {
    mocks.getCourtCaseForUser.mockResolvedValue({ publicPost: { id: POST_ID } });
    mocks.setCourtPublicConsentForUser.mockResolvedValue({ status: "awaiting_consents" });

    const response = await consent(request(
      `/api/couple-court/cases/${CASE_ID}/public-consent`,
      { public_post_id: POST_ID, snapshot_hash: SNAPSHOT_HASH, consented: false },
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.setCourtPublicConsentForUser).toHaveBeenCalledWith({
      publicPostId: POST_ID,
      userId: USER_ID,
      snapshotHash: SNAPSHOT_HASH,
      consented: false,
    });
  });

  it("returns the version committed by the locked database transaction", async () => {
    const snapshot = {
      snapshotVersion: "1.0",
      category: "budget",
      mode: "couple",
      tone: "practical",
      provisional: false,
      safeTitle: "익명 예산 사건",
      oneLine: "결제 전 확인 규칙이 필요했어요.",
      resultLabel: "공동 규칙 권고",
      hashtags: ["예산"],
    };
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: {
        mode: "couple",
        category: "budget",
        tone: "practical",
        safety_level: "normal",
      },
      verdict: { result_json: { provider: "validated" } },
      publicPost: null,
    });
    mocks.validateCourtVerdict.mockReturnValue({ provider: "validated" });
    mocks.buildPublicCourtSnapshot.mockReturnValue(snapshot);
    mocks.hashPublicCourtSnapshot.mockReturnValue(SNAPSHOT_HASH);
    mocks.prepareCourtPublicSnapshotForUser.mockResolvedValue({
      id: POST_ID,
      public_post_id: POST_ID,
      snapshot_hash: SNAPSHOT_HASH,
      snapshot_version: 7,
      reused: false,
    });

    const response = await preview(request(
      `/api/couple-court/cases/${CASE_ID}/public-preview`,
      {},
    ), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      snapshot_version: 7,
      public_post: { public_post_id: POST_ID, snapshot_version: 7 },
    });
    expect(mocks.prepareCourtPublicSnapshotForUser).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotVersion: 1 }),
    );
  });

  it("fails closed when the database snapshot identity is malformed", async () => {
    mocks.getCourtCaseForUser.mockResolvedValue({
      case: {
        mode: "couple",
        category: "budget",
        tone: "practical",
        safety_level: "normal",
      },
      verdict: { result_json: {} },
      publicPost: null,
    });
    mocks.validateCourtVerdict.mockReturnValue({});
    mocks.buildPublicCourtSnapshot.mockReturnValue({ safeTitle: "익명 사건" });
    mocks.hashPublicCourtSnapshot.mockReturnValue(SNAPSHOT_HASH);
    mocks.prepareCourtPublicSnapshotForUser.mockResolvedValue({
      public_post_id: POST_ID,
      snapshot_hash: "b".repeat(64),
      snapshot_version: 1,
    });

    const response = await preview(request(
      `/api/couple-court/cases/${CASE_ID}/public-preview`,
      {},
    ), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_PUBLIC_SNAPSHOT_CONTRACT_INVALID",
    });
  });
});
