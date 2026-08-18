import { describe, expect, it } from "vitest";

import {
  buildPreparationScheduleDecisionReceiptPage,
  parsePreparationScheduleDecisionReceiptCandidate,
} from "@/lib/amora/preparationScheduleDecisionReceipt";

const RECIPIENT = "10000000-0000-4000-8000-000000000001";
const COUPLE = "20000000-0000-4000-8000-000000000002";
const DECISION = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";

const event = {
  id: "meeting-event",
  date: "2026-09-05",
  time: "12:00",
  title: "양가 부모님 첫 만남",
  categoryKey: "meeting",
  status: "planned",
  createdAt: "2026-08-15T08:00:00.000Z",
  updatedAt: "2026-08-15T09:05:00.000Z",
};

function receipt(overrides: Record<string, unknown> = {}) {
  const base = {
    id: DECISION,
    couple_id: COUPLE,
    category: "meeting",
    decision_type: "scheduled",
    title: "일정 추가 · 양가 부모님 첫 만남",
    visibility: "shared",
    source: "schedule",
    source_ref_id: SOURCE,
    source_actor_role: "bride",
    memory_key: null,
    chosen_value: {
      schemaVersion: 1,
      operation: "add",
      eventId: event.id,
      after: event,
      expectedRevision: 7,
      appliedRevision: 8,
    },
    metadata: {
      origin: "amora_shared_action",
      actionId: SOURCE,
      eventId: event.id,
      receiptExpectedRevision: 7,
      receiptAppliedRevision: 8,
    },
    user_confirmed_at: "2026-08-15T09:00:00.000Z",
    decided_at: "2026-08-15T09:05:00.000Z",
    superseded_at: null,
  };
  return { ...base, ...overrides };
}

describe("preparation schedule decision receipt", () => {
  it("projects only an exact user-confirmed decision matching the current journey event", () => {
    expect(parsePreparationScheduleDecisionReceiptCandidate({
      coupleId: COUPLE,
      currentJourneyRevision: 8,
      progress: { __events: [event] },
      decisionRow: receipt(),
      nowMs: Date.parse("2026-08-18T08:00:00.000Z"),
    })).toEqual({
      decisionId: DECISION,
      eventId: event.id,
      topicKey: "meeting",
      title: "일정 추가 · 양가 부모님 첫 만남",
      date: "2026-09-05",
      confirmedAt: "2026-08-15T09:00:00.000Z",
      scope: "couple_shared",
      canOpenSchedule: true,
    });
  });

  it("uses the newest raw event candidate without falling back to an older valid receipt", () => {
    const older = receipt();
    const newestInvalid = receipt({
      id: "50000000-0000-4000-8000-000000000005",
      user_confirmed_at: "2026-08-16T09:00:00.000Z",
      decided_at: "2026-08-16T09:05:00.000Z",
      metadata: { ...(older.metadata as Record<string, unknown>), origin: "memory_compiler" },
    });
    const page = buildPreparationScheduleDecisionReceiptPage({
      coupleId: COUPLE,
      recipientUserId: RECIPIENT,
      query: "",
      snapshotAt: "2026-08-18T08:00:00.000Z",
      currentJourneyRevision: 8,
      progress: { __events: [event] },
      limit: 24,
      scanLimit: 80,
      decisionRows: [newestInvalid, older],
      topicLabels: { meeting: "상견례" },
      nowMs: Date.parse("2026-08-18T08:00:00.000Z"),
    });
    expect(page).toEqual({ entries: [], nextBoundary: null, partial: true });
  });

  it("builds one bounded searchable page and never exposes private or generic decisions", () => {
    const input = {
      coupleId: COUPLE,
      recipientUserId: RECIPIENT,
      query: "상견례 일정",
      snapshotAt: "2026-08-18T08:00:00.000Z",
      currentJourneyRevision: 8,
      progress: { __events: [event] },
      limit: 24,
      scanLimit: 80,
      decisionRows: [receipt()],
      topicLabels: { meeting: "상견례" },
      nowMs: Date.parse("2026-08-18T08:00:00.000Z"),
    };
    expect(buildPreparationScheduleDecisionReceiptPage(input)).toEqual({
      entries: [{
        decisionId: DECISION,
        eventId: event.id,
        topicKey: "meeting",
        title: "일정 추가 · 양가 부모님 첫 만남",
        date: "2026-09-05",
        confirmedAt: "2026-08-15T09:00:00.000Z",
        scope: "couple_shared",
        canOpenSchedule: true,
      }],
      nextBoundary: null,
      partial: false,
    });
    for (const invalid of [
      receipt({ visibility: "bride_private" }),
      receipt({ decision_type: "decided" }),
      receipt({ source: "chat" }),
      receipt({ user_confirmed_at: null }),
    ]) {
      expect(buildPreparationScheduleDecisionReceiptPage({
        ...input,
        decisionRows: [invalid],
      })).toEqual({ entries: [], nextBoundary: null, partial: true });
    }
  });
});
