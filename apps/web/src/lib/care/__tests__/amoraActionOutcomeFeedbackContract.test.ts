import { describe, expect, it } from "vitest";

import {
  validateAmoraActionOutcomeFeedbackResponse,
} from "@hanbang/shared/amora-action-outcome-feedback";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "30000000-0000-4000-8000-000000000001";
const NOW_MS = Date.parse("2026-08-15T03:00:00.000Z");

interface MutableFeedback {
  outcomeId: string;
  actionId: string;
  actionTitle: string;
  sourceRevision: number;
  actionRevision: number;
  actionStatus: string;
  outcome: string;
  blockerCode?: string;
  recordedAt: string;
  validUntil: string;
}

interface MutableReadyResponse {
  version: number;
  state: string;
  recipientUserId: string;
  coupleId: string;
  feedback: MutableFeedback;
}

function readyResponse(): MutableReadyResponse {
  return {
    version: 1,
    state: "ready",
    recipientUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    feedback: {
      outcomeId: OUTCOME_ID,
      actionId: "act_guest_list_draft",
      actionTitle: "Draft the first guest list",
      sourceRevision: 4,
      actionRevision: 4,
      actionStatus: "open",
      outcome: "blocked",
      blockerCode: "partner_check",
      recordedAt: "2026-08-15T02:00:00.000Z",
      validUntil: "2026-08-16T02:00:00.000Z",
    },
  };
}

describe("Amora action outcome feedback contract", () => {
  it("accepts a current result only for the exact owner and couple", () => {
    const result = validateAmoraActionOutcomeFeedbackResponse(
      readyResponse(),
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    );

    expect(result).toEqual({ ok: true, value: readyResponse() });
    expect(validateAmoraActionOutcomeFeedbackResponse(
      readyResponse(),
      "10000000-0000-4000-8000-000000000002",
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: false, reason: "owner" });
    expect(validateAmoraActionOutcomeFeedbackResponse(
      readyResponse(),
      OWNER_ID,
      "20000000-0000-4000-8000-000000000002",
      NOW_MS,
    )).toEqual({ ok: false, reason: "couple" });
  });

  it("rejects extra keys and impossible state payloads", () => {
    expect(validateAmoraActionOutcomeFeedbackResponse(
      { ...readyResponse(), unexpected: true },
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: false, reason: "state" });
    expect(validateAmoraActionOutcomeFeedbackResponse(
      {
        version: 1,
        state: "none",
        recipientUserId: OWNER_ID,
        coupleId: COUPLE_ID,
        feedback: readyResponse().feedback,
      },
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: false, reason: "state" });
    expect(validateAmoraActionOutcomeFeedbackResponse(
      {
        ...readyResponse(),
        feedback: { ...readyResponse().feedback, unexpected: true },
      },
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: false, reason: "feedback" });
  });

  it.each([
    ["malformed outcome id", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.outcomeId = "not-a-uuid";
    }, "feedback"],
    ["unsafe action id", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.actionId = "action/foreign";
    }, "feedback"],
    ["unsafe title", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.actionTitle = "stale\u202Etitle";
    }, "feedback"],
    ["zero source revision", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.sourceRevision = 0;
    }, "feedback"],
    ["non-completed revision mismatch", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.actionRevision = 5;
    }, "feedback"],
    ["non-completed done state", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.actionStatus = "done";
    }, "feedback"],
    ["unsupported outcome", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.outcome = "failed";
    }, "feedback"],
    ["blocked without blocker", (value: ReturnType<typeof readyResponse>) => {
      delete value.feedback.blockerCode;
    }, "feedback"],
    ["non-blocked with blocker", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.outcome = "changed";
    }, "feedback"],
    ["invalid recorded time", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.recordedAt = "yesterday";
    }, "feedback"],
    ["non-forward validity", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.validUntil = value.feedback.recordedAt;
    }, "feedback"],
    ["expired result", (value: ReturnType<typeof readyResponse>) => {
      value.feedback.validUntil = "2026-08-15T02:59:59.999Z";
    }, "expired"],
  ])("rejects %s", (_name, mutate, reason) => {
    const value = readyResponse();
    mutate(value);

    expect(validateAmoraActionOutcomeFeedbackResponse(
      value,
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: false, reason });
  });

  it("accepts a completed result only as a later done revision", () => {
    const value = readyResponse();
    value.feedback.outcome = "completed";
    delete value.feedback.blockerCode;
    value.feedback.actionStatus = "done";
    value.feedback.actionRevision = 5;

    expect(validateAmoraActionOutcomeFeedbackResponse(
      value,
      OWNER_ID,
      COUPLE_ID,
      NOW_MS,
    )).toEqual({ ok: true, value });
  });
});
