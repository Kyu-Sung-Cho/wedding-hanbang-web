// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  claimAmoraConflictCheck,
  checkpointAmoraConflictCheck,
  completeAmoraConflictCheck,
  createAmoraConflictMessageDigest,
  failAmoraConflictCheck,
} from "@/lib/ai/amoraConflictCheckClaim";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

function adminReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data, error })),
  };
}

describe("Amora conflict-check claim client", () => {
  it("creates the same bounded digest regardless of message order", () => {
    const ids = [
      "30000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000001",
    ];
    const expected = createHash("sha256")
      .update(`amora-conflict-check-v1\0${JSON.stringify([...ids].sort())}`, "utf8")
      .digest("hex");

    expect(createAmoraConflictMessageDigest(ids)).toBe(expected);
    expect(createAmoraConflictMessageDigest([...ids].reverse())).toBe(expected);
    expect(() => createAmoraConflictMessageDigest([])).toThrow(/message id/i);
    expect(() => createAmoraConflictMessageDigest([ids[0], ids[0]])).toThrow(/unique/i);
  });

  it("parses acquired, in-progress, and completed responses fail-closed", async () => {
    const acquiredAdmin = adminReturning({
      action: "acquired",
      attempt_count: 2,
      claim_token: CLAIM_TOKEN,
      reclaimed: true,
    });
    await expect(claimAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      requesterUserId: USER_ID,
    }, acquiredAdmin as never)).resolves.toEqual({
      action: "acquired",
      attemptCount: 2,
      claimToken: CLAIM_TOKEN,
      checkpoint: null,
      reclaimed: true,
    });

    const progressAdmin = adminReturning({ action: "in_progress", attempt_count: 1 });
    await expect(claimAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      requesterUserId: USER_ID,
    }, progressAdmin as never)).resolves.toEqual({
      action: "in_progress",
      attemptCount: 1,
      retryAfterMs: 2_000,
    });

    const result = { triggered: false, reason: "low_score", score: 3 };
    const completedAdmin = adminReturning({
      action: "completed",
      attempt_count: 1,
      result,
    });
    await expect(claimAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      requesterUserId: USER_ID,
    }, completedAdmin as never)).resolves.toEqual({
      action: "completed",
      attemptCount: 1,
      result,
    });

    const invalidAdmin = adminReturning({
      action: "acquired",
      attempt_count: 1,
      claim_token: "not-a-token",
    });
    await expect(claimAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      requesterUserId: USER_ID,
    }, invalidAdmin as never)).rejects.toMatchObject({
      code: "AMORA_CONFLICT_CHECK_CLAIM_FAILED",
    });
  });

  it("requires a current lease token to complete or fail a check", async () => {
    const checkpoint = {
      stage: "detection_complete" as const,
      triggered: false,
      score: 7,
      reason: "borderline 점수 7 → LLM: 갈등 아님",
      conflictContext: "서운해 / 반대야",
      llmVerified: true,
    };
    const checkpointAdmin = adminReturning(true);
    await checkpointAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      claimToken: CLAIM_TOKEN,
      checkpoint,
    }, checkpointAdmin as never);
    expect(checkpointAdmin.rpc).toHaveBeenCalledWith("checkpoint_amora_conflict_check", {
      p_couple_id: COUPLE_ID,
      p_message_digest: DIGEST,
      p_claim_token: CLAIM_TOKEN,
      p_checkpoint: checkpoint,
    });

    const completeAdmin = adminReturning(true);
    await completeAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      claimToken: CLAIM_TOKEN,
      result: { triggered: false, reason: "low_score" },
    }, completeAdmin as never);
    expect(completeAdmin.rpc).toHaveBeenCalledWith("complete_amora_conflict_check", {
      p_couple_id: COUPLE_ID,
      p_message_digest: DIGEST,
      p_claim_token: CLAIM_TOKEN,
      p_result: { triggered: false, reason: "low_score" },
    });

    const failAdmin = adminReturning(true);
    await failAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      claimToken: CLAIM_TOKEN,
      failureCode: "PROVIDER_FAILED",
    }, failAdmin as never);
    expect(failAdmin.rpc).toHaveBeenCalledWith("fail_amora_conflict_check", {
      p_couple_id: COUPLE_ID,
      p_message_digest: DIGEST,
      p_claim_token: CLAIM_TOKEN,
      p_failure_code: "PROVIDER_FAILED",
    });

    await expect(completeAmoraConflictCheck({
      coupleId: COUPLE_ID,
      messageDigest: DIGEST,
      claimToken: CLAIM_TOKEN,
      result: { triggered: false },
    }, adminReturning(false) as never)).rejects.toMatchObject({
      code: "AMORA_CONFLICT_CHECK_CLAIM_FAILED",
    });
  });
});
