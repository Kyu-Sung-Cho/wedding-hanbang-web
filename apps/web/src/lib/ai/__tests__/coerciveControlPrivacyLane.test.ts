import { describe, expect, it } from "vitest";

import { hasCoerciveControlSignal } from "@hanbang/shared";
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

/**
 * **2026-11-16 결정: 통제만 있는 문장은 채팅에서 안전 레인으로 보내지 않는다.**
 *
 * U1 측정(`amora-muse-design-20261112/evidence/u1-corpora/fear-control.json`, 이 판정기를 보지 않고 쓴
 * 문장)이 통제 문장 여섯이 하나도 안전 분류에 걸리지 않는다고 적었다. 고쳐 잡지 않기로 했다. 까닭:
 *
 *  1. 같은 낱말이 평범한 커플 말에 그대로 나온다 — 서로 켜 둔 위치 공유, 모바일 청첩장 비밀번호, 축의금
 *     통장(위 `ORDINARY_WEDDING_TALK`, `coerciveControlRecall.test.ts` 의 평범한 대화). 낱말 목록은 실제
 *     통제 서술 45개 중 0개를 잡았고, 넓혔더니 평범한 결혼 대화 30개 중 15개를 걸었다
 *     (`coerciveControlSignals.ts` 머리말). 이 파일 위쪽이 그 탐지기를 채팅에 걸었다가 되돌린 기록이다.
 *  2. 잘못 걸리면 값이 크다 — 글이 공유 대화에서 조용히 사라져 나만 레인으로 옮겨지고, 상대에게 보내던
 *     글은 막히고, 답에 112·1366 이 붙고, 그 턴의 도구가 0개가 된다. "위치 공유를 항상 켜두라고 해서
 *     답답해" 에 긴급전화를 안내하는 것은 도움이 아니다.
 *  3. 여섯 중 셋(시어머니 SNS·엄마 통장·아빠 의절)은 통제하는 사람이 배우자가 아니다. 안전 레인이 주는
 *     보호(배우자가 못 읽게 하기)가 닿지 않는다.
 *
 * 이미 잡는 통제는 그대로다 — 닫힌 어휘로 된 배우자의 직접 통제(`친구 못 만나게 해`·`남편이 제 휴대폰
 * 검사해요`·`신랑이 돈 못 쓰게 해요`)와 통제에 폭력이 붙은 말은 안전 레인이다. 여기 여섯은 요청·조르기·
 * 캐묻기와 배우자 아닌 사람의 통제다.
 *
 * **값**: 이 여섯은 공유 레인에 남는다. 배우자가 통제하는 쪽이라면 그 사람이 읽는다. 이 문장들에 맞는
 * 도구는 "긴급 안내 없이 비공개로만 저장" 이지만, 지금은 비공개 저장과 긴급 안내가 한 스위치에 묶여 있다
 * (`amoraQuestionScope.ts` 의 `BARE_THREAT_DISCLOSURE_PATTERN` 머리말) — 파운더 판단 사안이다.
 *
 * 아래 단언은 "이 문장들이 안전하다" 가 아니라 "이 판정기가 이 문장들을 안전 레인으로 보내지 않기로 했다"
 * 를 고정한다. 바꾸려면 먼저 위 평범한 대화와 `coerciveControlRecall.test.ts` 에서 오탐을 재라.
 */
const CONTROL_ONLY_STATEMENTS = [
  "예랑이가 내 폰 비밀번호를 알려달라고 계속 졸라서 좀 무서워",
  "남자친구가 위치 공유를 항상 켜두라고 해서 답답해",
  "시어머니 되실 분이 내 SNS를 하나하나 다 보고 계신 것 같아서 소름 돋아",
  "엄마가 결혼 반대한다면서 내 통장을 가져가셨어",
  "아빠가 이 결혼 하면 의절하겠다고 하셔서 너무 무서워",
  "남친이 내가 친구 만나고 오면 누구랑 뭐 했는지 꼬치꼬치 캐물어서 숨 막혀",
] as const;

describe("통제만 있는 문장은 채팅 안전 레인으로 보내지 않는다 — 2026-11-16 결정, 값은 공유 레인", () => {
  it.each(CONTROL_ONLY_STATEMENTS)("%s", (text) => {
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
  });

  it("중재 전용 탐지기를 채팅에 걸어도 여섯 중 하나만 잡는다 — 낱말을 넓혀 풀 문제가 아니다", () => {
    expect(CONTROL_ONLY_STATEMENTS.filter((text) => hasCoerciveControlSignal(text))).toEqual([
      "엄마가 결혼 반대한다면서 내 통장을 가져가셨어",
    ]);
  });

  it("결정의 경계 — 통제에 폭력이 붙거나 배우자의 직접 통제면 안전 레인이다", () => {
    for (const text of [
      "예비신랑이 제 휴대폰 비밀번호를 안 알려주면 소리 지르고 물건을 던져요",
      "남편이 제 휴대폰 검사해요",
      "신랑이 돈 못 쓰게 해요",
      "친구 못 만나게 해",
    ]) {
      expect(hasAmoraSafetySignal(text, "chat"), text).toBe(true);
    }
  });
});

describe("W5 위기 신호는 그대로 잡는다", () => {
  it("되돌림이 진짜 안전 경로까지 끄지는 않았다", () => {
    expect(hasAmoraSafetySignal("남편이 저를 때렸어요", "chat")).toBe(true);
  });
});
