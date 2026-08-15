import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
  MEDIATION_OUTCOME_FOLLOW_UP_CHOICES,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraMediationOutcomeFollowUpEnabled } from "@/lib/features/amoraCareFlags";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimit } from "@/utils/rateLimit";
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraMediationOutcomeFollowUpEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "mediation-follow-up:test"),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const DECISION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const PROPOSAL_VERSION = "50000000-0000-4000-8000-000000000001";
const ROSTER_FINGERPRINT = "7704026f6654810dd28e75fbf0cd700f";

function query(data: unknown) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({ data, error: null });
  builder.single.mockResolvedValue({ data, error: null });
  return builder;
}

function request(actor = USER_ID) {
  return new Request("http://localhost/api/amora/mediation/follow-up", {
    headers: {
      "sec-fetch-site": "same-origin",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
    },
  });
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: USER_ID, groom_id: PARTNER_ID });
  const authRpc = vi.fn().mockResolvedValue({ data: 5, error: null });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc: authRpc,
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return { client, profile, couple };
}

describe("GET /api/amora/mediation/follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraMediationOutcomeFollowUpEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("stays unavailable until its independent rollout flag is exact true", async () => {
    vi.mocked(isAmoraMediationOutcomeFollowUpEnabled).mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("compiles identifier-only provenance and claims a validated recipient-private card", async () => {
    installClient();
    const decisions = query([{
      id: DECISION_ID,
      couple_id: COUPLE_ID,
      category: "conflict_resolution",
      decision_type: "decided",
      source: "chat",
      source_ref_id: MESSAGE_ID,
      visibility: "shared",
      decided_at: "2026-08-10T00:00:00.000Z",
      superseded_at: null,
      metadata: {
        confirmed_by_both: true,
        acceptance_count: 2,
        proposal_version: PROPOSAL_VERSION,
        roster_fingerprint: ROSTER_FINGERPRINT,
      },
    }]);
    const claim = vi.fn().mockResolvedValue({
      data: { version: 1, state: "none", recipientUserId: USER_ID, coupleId: COUPLE_ID },
      error: null,
    });
    const admin = {
      from: vi.fn(() => decisions),
      rpc: claim,
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      state: "none",
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
    });
    expect(decisions.select).toHaveBeenCalledWith(
      "id, couple_id, category, decision_type, source, source_ref_id, visibility, decided_at, superseded_at, metadata",
    );
    expect(decisions.select.mock.calls[0]?.[0]).not.toMatch(/title|chosen_value|reasoning/u);
    expect(claim).toHaveBeenCalledWith(
      "claim_amora_mediation_outcome_follow_up",
      expect.objectContaining({
        p_couple_id: COUPLE_ID,
        p_recipient_user_id: USER_ID,
        p_expected_privacy_epoch: 5,
        p_candidate_decision_id: DECISION_ID,
        p_expected_source_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it("rejects an account switch and persistent limiter before any service read", async () => {
    installClient();
    let response = await GET(request(OTHER_ID));
    expect(response.status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();

    vi.clearAllMocks();
    installClient();
    vi.mocked(checkRateLimit).mockReturnValue(NextResponse.json(
      { error: "요청이 너무 많습니다." },
      { status: 429 },
    ));
    response = await GET(request());
    expect(response.status).toBe(429);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("continues to an older eligible decision when the database rejects a newer candidate", async () => {
    installClient();
    const olderDecisionId = "30000000-0000-4000-8000-000000000002";
    const olderMessageId = "40000000-0000-4000-8000-000000000002";
    const olderProposalVersion = "50000000-0000-4000-8000-000000000002";
    const decisions = query([
      {
        id: DECISION_ID,
        couple_id: COUPLE_ID,
        category: "conflict_resolution",
        decision_type: "decided",
        source: "chat",
        source_ref_id: MESSAGE_ID,
        visibility: "shared",
        decided_at: "2026-08-10T01:00:00.000Z",
        superseded_at: null,
        metadata: {
          confirmed_by_both: true,
          acceptance_count: 2,
          proposal_version: PROPOSAL_VERSION,
          roster_fingerprint: ROSTER_FINGERPRINT,
        },
      },
      {
        id: olderDecisionId,
        couple_id: COUPLE_ID,
        category: "conflict_resolution",
        decision_type: "decided",
        source: "chat",
        source_ref_id: olderMessageId,
        visibility: "shared",
        decided_at: "2026-08-10T00:00:00.000Z",
        superseded_at: null,
        metadata: {
          confirmed_by_both: true,
          acceptance_count: 2,
          proposal_version: olderProposalVersion,
          roster_fingerprint: ROSTER_FINGERPRINT,
        },
      },
    ]);
    const ready = {
      version: 1,
      state: "ready",
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      card: {
        id: "60000000-0000-4000-8000-000000000001",
        revision: 1,
        sourceDigest: "b".repeat(64),
        outcomeIdempotencyKey: "70000000-0000-4000-8000-000000000001",
        kind: "mediation_outcome_follow_up",
        visibility: "private",
        title: "둘이 확인한 조율, 지금은 어떤가요?",
        question: "지금 그 조율은 어떻게 되었나요?",
        confirmed: ["두 분이 직접 확인한 조율안이 있어요."],
        unknown: ["지금 실제 결과는 아직 확인하지 않았어요."],
        impact: "내 선택은 나에게만 보이며 공동 기록이나 상대 카드에는 영향을 주지 않아요.",
        choices: MEDIATION_OUTCOME_FOLLOW_UP_CHOICES.map((choice) => ({ ...choice })),
        safeguards: { automaticSharedMutation: false, automaticRemediation: false },
        eligibleAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-09-10T00:00:00.000Z",
      },
    };
    const claim = vi.fn()
      .mockResolvedValueOnce({
        data: { version: 1, state: "none", recipientUserId: USER_ID, coupleId: COUPLE_ID },
        error: null,
      })
      .mockResolvedValueOnce({ data: ready, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => decisions),
      rpc: claim,
    } as never);

    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ready);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim.mock.calls[1]?.[1]).toMatchObject({
      p_candidate_decision_id: olderDecisionId,
    });
  });
});
