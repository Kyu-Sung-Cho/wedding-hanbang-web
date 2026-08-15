import { describe, expect, it, vi } from "vitest";

import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
import { resolveAmoraScheduleCareFollowUp } from "@/lib/care/scheduleCareFollowUp";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const CARD_ID = "20000000-0000-4000-8000-000000000001";
const SIGNAL_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-15T01:00:00.000Z");
const EXPIRES_AT = "2026-08-15T15:00:00.000Z";

const journey = {
  wedding_date: "2027-04-10",
  total_budget: null,
  state_revision: 7,
  progress: {
    __events: [{
      id: "schedule-event-sanggyeonrye",
      date: "2026-08-14",
      time: "12:30",
      title: "상견례",
      momentType: "sanggyeonrye",
      status: "completed",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-14T05:00:00.000Z",
    }],
  },
};

function buildFixtureCandidate() {
  const value = buildTodayOneScheduleCandidates({
    weddingDate: journey.wedding_date,
    progress: journey.progress,
    stateRevision: journey.state_revision,
    now: NOW,
  }).find(({ attentionWindow }) => attentionWindow === "dAfter");
  if (!value) throw new Error("test fixture must compile a D+1 candidate");
  return value;
}

const candidate = buildFixtureCandidate();

function query(result: { data: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({ data: result.data, error: result.error ?? null })),
    maybeSingle: vi.fn(async () => ({ data: result.data, error: result.error ?? null })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

type ResolverClientOptions = {
  profile?: unknown;
  couple?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
  journey?: unknown;
  card?: unknown;
  signal?: unknown;
};

function resolverClient(options: ResolverClientOptions = {}) {
  const defaultCard = {
    id: CARD_ID,
    signal_id: SIGNAL_ID,
    couple_id: COUPLE_ID,
    recipient_user_id: USER_ID,
    revision: 2,
    source_revision: 7,
    state_digest: candidate.sourceStateDigest,
    state: "ready",
    claimed_for_date: "2026-08-15",
    expires_at: EXPIRES_AT,
  };
  const defaultSignal = {
    id: SIGNAL_ID,
    couple_id: COUPLE_ID,
    recipient_user_id: USER_ID,
    source_key: candidate.sourceKey,
    state_digest: candidate.sourceStateDigest,
    source_revision: 7,
    kind: "schedule_moment",
    muted_at: null,
  };
  const tables = {
    profiles: query({
      data: options.profile ?? { couple_id: COUPLE_ID, role: "bride" },
    }),
    couples: query({
      data: options.couple ?? { bride_id: USER_ID, groom_id: PARTNER_ID },
    }),
    wedding_journeys: query({ data: options.journey ?? journey }),
    amora_today_one_recipient_states: query({
      data: options.card ?? defaultCard,
    }),
    amora_today_one_signals: query({
      data: options.signal ?? defaultSignal,
    }),
  };
  return {
    from: vi.fn((table: keyof typeof tables) => tables[table]),
    rpc: vi.fn(async () => ({
      data: options.privacyEpoch ?? 5,
      error: options.privacyError ?? null,
    })),
  };
}

describe("resolveAmoraScheduleCareFollowUp", () => {
  it("resolves one current owner-bound sanggyeonrye D+1 card into a canonical private prompt", async () => {
    const result = await resolveAmoraScheduleCareFollowUp({
      client: resolverClient() as never,
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: {
        cardId: CARD_ID,
        cardRevision: 2,
        sourceRevision: 7,
      },
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        recipientUserId: USER_ID,
        coupleId: COUPLE_ID,
        actorRole: "bride",
        privacyEpoch: 5,
        binding: {
          cardId: CARD_ID,
          cardRevision: 2,
          sourceRevision: 7,
        },
        expiresAt: EXPIRES_AT,
        momentType: "sanggyeonrye",
        attentionWindow: "dAfter",
        eventTitle: "상견례",
        eventDate: "2026-08-14 12:30",
      },
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.prompt).toContain("실제로 합의된 내용");
    expect(result.value.prompt).toContain("아직 의견만 나온 내용");
    expect(result.value.prompt).toBe([
      "어제 상견례에서 실제로 합의된 것과 아직 이야기 중인 것을 나만 아모라와 정리할게요.",
      "",
      result.value.question,
      "",
      "내 답:",
    ].join("\n"));
    expect(result.value.prompt).toContain(result.value.question);
  });

  it("normalizes a valid database offset timestamp to the canonical preview ISO form", async () => {
    const result = await resolveAmoraScheduleCareFollowUp({
      client: resolverClient({
        card: {
          id: CARD_ID,
          signal_id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 2,
          source_revision: 7,
          state_digest: candidate.sourceStateDigest,
          state: "ready",
          claimed_for_date: "2026-08-15",
          expires_at: "2026-08-15T15:00:00+00:00",
        },
      }) as never,
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: { cardId: CARD_ID, cardRevision: 2, sourceRevision: 7 },
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { expiresAt: EXPIRES_AT },
    });
  });

  it.each([
    [
      "profile moved to another couple",
      { profile: { couple_id: "10000000-0000-4000-8000-000000000099", role: "bride" } },
      "scope_changed",
    ],
    [
      "roster slot changed",
      { couple: { bride_id: PARTNER_ID, groom_id: null } },
      "scope_changed",
    ],
    [
      "privacy epoch unavailable",
      { privacyError: { code: "PGRST" } },
      "privacy_unavailable",
    ],
    [
      "journey revision changed",
      { journey: { ...journey, state_revision: 8 } },
      "journey_stale",
    ],
    [
      "card revision changed",
      {
        card: {
          id: CARD_ID,
          signal_id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 3,
          source_revision: 7,
          state_digest: candidate.sourceStateDigest,
          state: "ready",
          claimed_for_date: "2026-08-15",
          expires_at: EXPIRES_AT,
        },
      },
      "card_stale",
    ],
    [
      "card expired",
      {
        card: {
          id: CARD_ID,
          signal_id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 2,
          source_revision: 7,
          state_digest: candidate.sourceStateDigest,
          state: "ready",
          claimed_for_date: "2026-08-15",
          expires_at: "2026-08-15T00:59:59.999Z",
        },
      },
      "card_stale",
    ],
    [
      "signal digest changed",
      {
        signal: {
          id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          source_key: candidate.sourceKey,
          state_digest: "b".repeat(64),
          source_revision: 7,
          kind: "schedule_moment",
          muted_at: null,
        },
      },
      "signal_stale",
    ],
    [
      "recomputed moment disappeared",
      { journey: { ...journey, progress: {} } },
      "moment_stale",
    ],
  ])("fails closed when the %s", async (_label, options, reason) => {
    const result = await resolveAmoraScheduleCareFollowUp({
      client: resolverClient(options) as never,
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: { cardId: CARD_ID, cardRevision: 2, sourceRevision: 7 },
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason });
  });

  it("does not promote a D+1 moment that has no supported sanggyeonrye care", async () => {
    const noCareJourney = {
      ...journey,
      progress: {
        __events: [{
          id: "schedule-event-venue-tour",
          date: "2026-08-14",
          title: "예식장 투어",
          momentType: "venue_tour",
          status: "completed",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-14T05:00:00.000Z",
        }],
      },
    };
    const noCareCandidate = buildTodayOneScheduleCandidates({
      weddingDate: noCareJourney.wedding_date,
      progress: noCareJourney.progress,
      stateRevision: noCareJourney.state_revision,
      now: NOW,
    }).find(({ attentionWindow }) => attentionWindow === "dAfter");
    if (!noCareCandidate) throw new Error("fixture must compile a D+1 venue candidate");
    const card = {
      id: CARD_ID,
      signal_id: SIGNAL_ID,
      couple_id: COUPLE_ID,
      recipient_user_id: USER_ID,
      revision: 2,
      source_revision: 7,
      state_digest: noCareCandidate.sourceStateDigest,
      state: "ready",
      claimed_for_date: "2026-08-15",
      expires_at: EXPIRES_AT,
    };
    const signal = {
      id: SIGNAL_ID,
      couple_id: COUPLE_ID,
      recipient_user_id: USER_ID,
      source_key: noCareCandidate.sourceKey,
      state_digest: noCareCandidate.sourceStateDigest,
      source_revision: 7,
      kind: "schedule_moment",
      muted_at: null,
    };

    await expect(resolveAmoraScheduleCareFollowUp({
      client: resolverClient({ journey: noCareJourney, card, signal }) as never,
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: { cardId: CARD_ID, cardRevision: 2, sourceRevision: 7 },
      now: NOW,
    })).resolves.toEqual({ ok: false, reason: "moment_stale" });
  });
});
