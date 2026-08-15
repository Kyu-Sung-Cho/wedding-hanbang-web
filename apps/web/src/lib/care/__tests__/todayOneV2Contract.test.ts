import { describe, expect, it } from "vitest";
import {
  validateTodayOneCareV2OutcomeRequest,
  validateTodayOneCareV2Response,
} from "@hanbang/shared";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function readyResponse() {
  return {
    version: 2,
    state: "ready",
    recipientUserId: USER_ID,
    card: {
      id: "20000000-0000-4000-8000-000000000001",
      revision: 1,
      sourceRevision: 3,
      sourceDigest: "a".repeat(64),
      outcomeIdempotencyKey: "30000000-0000-4000-8000-000000000001",
      kind: "action_follow_up",
      title: "이번 주 하객 명단 초안 만들기",
      whyNow: "아모라와 정한 준비 한 가지가 지금 어떻게 됐는지 확인해 주세요.",
      confirmed: ["할 일: 이번 주 하객 명단 초안 만들기"],
      unknown: [],
      impact: "선택한 상태만 기록하며 다른 준비 내용은 바꾸지 않아요.",
      choices: [
        { outcome: "completed", label: "완료했어요" },
        { outcome: "blocked", label: "막혀 있어요" },
        { outcome: "changed", label: "계획이 바뀌었어요" },
        { outcome: "not_sure", label: "아직 모르겠어요" },
      ],
      expiresAt: "2026-08-13T10:00:00.000Z",
    },
  };
}

describe("TodayOneCare v2 shared contract", () => {
  it("accepts an owner-scoped action follow-up with immutable source evidence", () => {
    expect(validateTodayOneCareV2Response(readyResponse(), USER_ID)).toMatchObject({
      ok: true,
      value: {
        version: 2,
        state: "ready",
        recipientUserId: USER_ID,
        card: { sourceRevision: 3, sourceDigest: "a".repeat(64) },
      },
    });
  });

  it("requires explicit confirmation for status-changing outcomes and rejects raw reasons", () => {
    const completed = {
      cardId: "20000000-0000-4000-8000-000000000001",
      cardRevision: 1,
      sourceRevision: 3,
      outcome: "completed",
      confirmed: true,
      idempotencyKey: "30000000-0000-4000-8000-000000000001",
    };

    expect(validateTodayOneCareV2OutcomeRequest(completed)).toMatchObject({ ok: true });
    expect(validateTodayOneCareV2OutcomeRequest({ ...completed, confirmed: undefined }))
      .toEqual({ ok: false, reason: "outcome" });
    expect(validateTodayOneCareV2OutcomeRequest({ ...completed, reason: "개인 사정" }))
      .toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts emoji ZWJ titles but rejects bare ZWJ and bidi controls", () => {
    const emoji = readyResponse();
    emoji.card.title = "👰‍♀️ 드레스 피팅 일정 확인";
    expect(validateTodayOneCareV2Response(emoji, USER_ID)).toMatchObject({ ok: true });

    const bareZwj = readyResponse();
    bareZwj.card.title = "하객\u200D명단";
    expect(validateTodayOneCareV2Response(bareZwj, USER_ID))
      .toEqual({ ok: false, reason: "card" });

    const bidi = readyResponse();
    bidi.card.title = "하객\u202E명단";
    expect(validateTodayOneCareV2Response(bidi, USER_ID))
      .toEqual({ ok: false, reason: "card" });

    const zeroWidth = readyResponse();
    zeroWidth.card.title = "하객\u200B명단";
    expect(validateTodayOneCareV2Response(zeroWidth, USER_ID))
      .toEqual({ ok: false, reason: "card" });
  });
});
