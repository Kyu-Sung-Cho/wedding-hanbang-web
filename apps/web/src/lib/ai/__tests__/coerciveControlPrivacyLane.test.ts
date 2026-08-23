import { describe, expect, it } from "vitest";

import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { resolveAmoraWeddingClarificationContinuity } from "@/lib/ai/amoraClarificationContinuity";

/**
 * 2026-08-23 오전에 나는 `hasCoerciveControlSignal` 을 `hasAmoraSafetySignal` 의
 * 마지막 갈래로 붙였다. 그리고 이 파일에 "평범한 결혼 대화는 비공개로 새지
 * 않는다" 는 테스트를 15문장으로 써서 **오탐 0건**을 확인했다.
 *
 * 그 15문장은 트리거를 밟지 않는 문장들이었다. 트리거는 명사(문자·카톡·메시지·
 * 위치·폰 / 돈·카드·계좌·통장)와 동사(다 확인, 공유해야)가 한 창 안에 있을 때
 * 걸리는데, 내가 고른 반례에는 그 조합이 하나도 없었다. 실패할 수 없는 측정이었다.
 *
 * 적대적 감사가 조합을 밟는 문장을 만들자 전부 걸렸다. 그래서 되돌렸다.
 *
 * 이 파일은 이제 **되돌린 것이 되돌아온 채로 있는지**를 지킨다. 반례는 내가
 * 상상한 문장이 아니라 실제로 터졌던 문장이다.
 */

/** 실측으로 걸렸던 문장들. 전부 결혼 준비 한복판의 표현이다. */
const ORDINARY_WEDDING_TALK = [
  "청첩장 문자 문구를 다 확인했어요",
  "카톡으로 청첩장 보낼 명단 다 확인했어",
  "하객들한테 보낼 문자 명단을 다 확인했어요",
  "예식장에서 보낸 계약 문자 내용을 다 확인했어요",
  "스드메 견적 카톡으로 받은 거 다 확인했어",
  "혼주 한복 대여점 위치를 지도로 다 확인했어요",
  "축의금 들어온 돈은 부모님이 가져가시는 게 맞나요?",
  "축의금 계좌를 하나로 모아서 부모님께 맡기라고 하시는데 어떻게 하나요",
  "웨딩홀 계약할 때 카드로 결제하려면 부모님 허락받아야 하나요?",
  "부모님이 지원해 주기로 한 돈을 아직 안 줘서 예약금을 못 넣었어요",
  "결혼식 당일 부케 전달할 친구한테 메시지 다 확인받았어요",
  "신혼집 잔금 낼 돈을 은행에서 안 줘서 애먹었어요",
] as const;

/** 아모라가 실제로 낼 법한 되묻기. 여기 걸리면 대화가 끊긴다. */
const AMORA_CLARIFYING_QUESTIONS = [
  "문자로 보낼 분들을 먼저 다 확인해 드릴까요?",
  "예식장 위치를 지도로 공유해야 할까요?",
  "모바일 청첩장 링크를 카톡으로 공유해야 할까요?",
  "청첩장 문자 초안을 신랑님과 공유해야 할까요?",
  "하객 명단을 문자 보낼 분과 카톡 보낼 분으로 나눠서 다 확인해 드릴까요?",
] as const;

describe("평범한 결혼 대화가 안전 경로로 새지 않는다", () => {
  it.each(ORDINARY_WEDDING_TALK)("공유 대화에서 사라지지 않는다: %s", (text) => {
    // 걸리면 사용자 문장이 공유 탭에서 조용히 없어지고 비공개로 옮겨진다.
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
  });

  it.each(ORDINARY_WEDDING_TALK)("상대에게 보내는 것도 막히지 않는다: %s", (text) => {
    // 걸리면 "폭력·위협·통제와 관련된 민감한 안전 내용" 이라며 전송이 막힌다.
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
  });
});

describe("되묻기가 대화를 끊지 않는다", () => {
  const anchor = "청첩장 보낼 하객 명단 정리해줘";
  const USER_ID = "11111111-2222-4333-8444-555555555555";

  it.each(AMORA_CLARIFYING_QUESTIONS)("연속성이 살아 있다: %s", (question) => {
    // `amoraClarificationContinuity` 가 아모라의 되묻기 문장에 이 함수를 건다.
    // 걸리면 사용자가 "응" 이라고 답해도 W4로 떨어져 도구가 0개가 된다 —
    // PR #148 이 고쳤던 "되묻는 순간 죽는" 고리다.
    expect(hasAmoraSafetySignal(question, "chat")).toBe(false);

    const continuity = resolveAmoraWeddingClarificationContinuity({
      rawOldestFirstRows: [
        {
          id: "m1", sender_id: USER_ID, sender_type: "groom", role: "user",
          content: anchor, metadata: null, visibility: "shared",
        },
        {
          id: "m2", sender_id: null, sender_type: "ai", role: "assistant",
          content: question,
          metadata: {
            in_reply_to_user_message_id: "m1",
            question_scope: "W0_wedding_core",
            memory_eligible: true,
          },
          visibility: "shared",
        },
        {
          id: "m3", sender_id: USER_ID, sender_type: "groom", role: "user",
          content: "응 그렇게 해줘", metadata: null, visibility: "shared",
        },
      ],
      requesterUserId: USER_ID,
      currentUserMessageId: "m3",
      currentUserText: "응 그렇게 해줘",
    });
    expect(continuity).not.toBeNull();
  });
});

describe("W5 위기 신호는 그대로 잡는다", () => {
  it("되돌림이 진짜 안전 경로까지 끄지는 않았다", () => {
    expect(hasAmoraSafetySignal("남편이 저를 때렸어요", "chat")).toBe(true);
  });
});
