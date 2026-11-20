import { describe, expect, it } from "vitest";

import {
  buildAmoraBoundedContinuity,
  type AmoraBoundedContinuityRow,
} from "@/lib/ai/amoraBoundedContinuity";
import { buildAmoraGatekeeperReplyMetadata } from "@/lib/ai/amoraGatekeeperContract";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { selectAmoraTrustedHistoryRows } from "@/lib/ai/amoraTrustedHistory";

/**
 * 문지기(D-89)가 막은 턴은 다음 턴의 모델 입력(이력·연결 문맥)으로 돌아오지 않는다.
 *
 * 쌍마다 "표식 없는 같은 쌍"을 나란히 두고 재서, 빠진 것이 표식 때문임을 보인다 — 다른 거름망
 * (안전 스크린·범위 목록)이 대신 뺀 것이면 이 시험은 아무것도 증명하지 않는다.
 */
const USER_ID = "10000000-0000-4000-8000-000000000001";
const SEGMENT_ID = "60000000-0000-4000-8000-000000000001";
const PRIOR_ID = "30000000-0000-4000-8000-000000000001";
const REPLY_ID = "30000000-0000-4000-8000-000000000002";
const CURRENT_ID = "30000000-0000-4000-8000-000000000003";

function userRow(id: string, content: string) {
  return {
    id,
    sender_id: USER_ID,
    sender_type: "bride",
    role: "user",
    content,
    metadata: null,
    visibility: "shared",
    segment_id: SEGMENT_ID,
  };
}

function replyRow(metadata: Record<string, unknown>) {
  return {
    id: REPLY_ID,
    sender_id: null,
    sender_type: "ai",
    role: "assistant",
    content: "서버가 쓴 답",
    metadata,
    visibility: "shared",
    segment_id: SEGMENT_ID,
  };
}

// 낱말 범위가 W4 로 보는 결혼 밖 질문. 범위 목록(W0·W1·W4)을 지나므로 표식만이 이 쌍을 뺀다.
const OFF_TOPIC = "파이썬으로 버블 정렬 짜줘";

describe("이력(selectAmoraTrustedHistoryRows)", () => {
  it("결혼 밖으로 거절한 쌍은 표식 때문에 빠진다", () => {
    expect(classifyAmoraQuestionScope({ userText: OFF_TOPIC }).scope).toBe("W4_out_of_scope");
    const gated = replyRow(buildAmoraGatekeeperReplyMetadata({ verdict: "out_of_scope", userMessageId: PRIOR_ID }));
    const plain = replyRow({ in_reply_to_user_message_id: PRIOR_ID, question_scope: "W4_out_of_scope", memory_eligible: false });
    const current = userRow(CURRENT_ID, "예식장 계약금은 보통 얼마야?");

    const withMarker = selectAmoraTrustedHistoryRows({
      oldestFirstRows: [userRow(PRIOR_ID, OFF_TOPIC), gated, current],
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    });
    const withoutMarker = selectAmoraTrustedHistoryRows({
      oldestFirstRows: [userRow(PRIOR_ID, OFF_TOPIC), plain, current],
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    });
    expect(withoutMarker.map((row) => row.id)).toEqual([PRIOR_ID, REPLY_ID, CURRENT_ID]);
    expect(withMarker.map((row) => row.id)).toEqual([CURRENT_ID]);
  });

  it("위험으로 막은 쌍은 W5 로 적혀 표식을 몰라도 빠진다(두 번째 겹)", () => {
    const metadata = buildAmoraGatekeeperReplyMetadata({ verdict: "blocked_risk", userMessageId: PRIOR_ID });
    const { response_origin: _origin, ...withoutOrigin } = metadata;
    const rows = selectAmoraTrustedHistoryRows({
      oldestFirstRows: [userRow(PRIOR_ID, "예식장 계약 조건 다시 보자"), replyRow(withoutOrigin), userRow(CURRENT_ID, "고마워")],
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    });
    expect(rows.map((row) => row.id)).toEqual([CURRENT_ID]);
  });
});

describe("연결 문맥(buildAmoraBoundedContinuity)", () => {
  // 직전 사용자 글은 낱말이 W0 으로 보는 결혼 문장이다. 그래서 문지기가 막았다는 표식만이 이 쌍을 끊는다.
  const PRIOR_TEXT = "예식장 계약 때문에 파트너와 의견이 달라요";

  function rows(replyMetadata: Record<string, unknown>): AmoraBoundedContinuityRow[] {
    return [
      { ...userRow(CURRENT_ID, "왜?") } as AmoraBoundedContinuityRow,
      { ...replyRow(replyMetadata) } as AmoraBoundedContinuityRow,
      { ...userRow(PRIOR_ID, PRIOR_TEXT) } as AmoraBoundedContinuityRow,
    ];
  }

  function build(replyMetadata: Record<string, unknown>) {
    return buildAmoraBoundedContinuity({
      newestFirstRows: rows(replyMetadata),
      currentMessageId: CURRENT_ID,
      currentUserText: "왜?",
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    });
  }

  it("표식 없는 같은 쌍은 이어 붙는다(기준선)", () => {
    expect(classifyAmoraQuestionScope({ userText: PRIOR_TEXT }).scope).toMatch(/^W[01]_/);
    expect(build({ in_reply_to_user_message_id: PRIOR_ID })).not.toBeNull();
  });

  it.each(["out_of_scope", "blocked_risk"] as const)("문지기가 막은 직전 턴(%s)은 이어 붙이지 않는다", (verdict) => {
    expect(build(buildAmoraGatekeeperReplyMetadata({ verdict, userMessageId: PRIOR_ID }))).toBeNull();
  });
});
