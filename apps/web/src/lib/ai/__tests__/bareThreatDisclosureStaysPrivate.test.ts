import { describe, expect, it } from "vitest";

import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";

/**
 * 협박당한다고 처음 말하는 사람의 글이 **협박하는 배우자 화면에 뜨면 안 된다.**
 *
 * ## 무엇이 있었나 (2026-08-31 운영 실측)
 *
 * PR #250 이 `HIGH_RISK_SAFETY_PATTERN` 의 협박·위협에 `저를/나를` 목적어를
 * 요구하도록 좁혔다. 그런데 한국어는 그 목적어를 일상적으로 생략한다. 배포 직후
 * 재니 고백 8문장 중 **7문장이 `shared`** — 커플이 함께 보는 레인 — 으로 갔다.
 * 목적어를 붙여 쓴 한 문장만 보호받았다.
 *
 * 되돌리는 것도 답이 아니었다. 맨 `협박` 을 목록에 넣으면
 * `amoraSafetyLaunchCorpus` 의 "절대 잡으면 안 된다" 12문장이 전부 걸린다.
 *
 * 두 무리를 가르는 것은 낱말이 아니라 **문장 구조**다. 걸리면 안 되는 쪽은 11/12
 * 가 `~다고 협박`(요구를 전하는 전언)이고 나머지 하나는 업체 상대 분쟁이다.
 * 고백하는 쪽은 그 틀 없이 맨 협박을 쓴다.
 *
 * 그래서 세 겹이다: 맨 협박으로 잡고 → 전언·업체 틀에서 무르고 →
 * **전해진 내용이 신체 위험이면 다시 무른다**(`남편이 때린다고 협박해요`).
 */

/** 운영과 같은 기본값. 웹·모바일 모두 별도 지정이 없으면 `shared` 로 보낸다. */
function landsInSharedLane(userText: string): boolean {
  const plan = planAmoraCrisisDelivery({
    userText,
    requestedVisibility: "shared",
    target: "ai",
    senderRole: "bride",
    externalSafetySignal: hasAmoraSafetySignal(userText),
  });
  return plan.effectiveVisibility === "shared";
}

describe("목적어 없는 협박 고백은 공유 레인에 남지 않는다", () => {
  it.each([
    "협박당하고 있어요",
    "남편이 협박해요",
    "남편이 자꾸 협박하는데 어떡하죠",
    "예비신랑이 협박해서 무서워요",
    "시댁에서 협박해요",
    "요즘 계속 협박당해서 잠을 못 자요",
    "협박이 무서워서 집에 못 들어가겠어요",
    // 목적어를 쓴 형태 — 예전에도 보호되던 유일한 모양
    "남편이 저를 협박해요",
  ])("배우자가 못 읽는다: %s", (userText) => {
    expect(landsInSharedLane(userText), "협박하는 쪽이 읽을 수 있다").toBe(false);
  });

  /** 전언 틀이어도 전해진 내용이 신체 위험이면 무르지 않는다. */
  it.each([
    "남편이 죽인다고 협박해요",
    "남편이 때린다고 협박해요",
    "남편이 칼 들고 협박했어요",
  ])("전언이어도 폭력 서술이면 보호한다: %s", (userText) => {
    expect(landsInSharedLane(userText)).toBe(false);
  });
});

/**
 * 반대쪽. 이 문장들이 안전 레인으로 가면 사용자가 쓴 글이 함께 보는 대화에서
 * 사라져 "내 말이 없어졌다"가 된다. `amoraSafetyLaunchCorpus` 와 같은 계약이고,
 * 여기서는 **레인**으로 다시 확인한다(그쪽은 신호 여부만 본다).
 */
describe("결혼 준비 문장은 그대로 함께 보는 대화에 남는다", () => {
  it.each([
    "웨딩홀이 위약금 물린다고 협박하는데 방법이 없을까요",
    "스드메 업체를 상대로 환불 요구했는데 계속 협박당해요",
    "상대 스튜디오가 원본 안 준다고 협박해요",
    "업체를 상대로 소송하겠다고 협박해요",
    "신랑이 파혼한다고 협박했어요",
    "남편이 이혼한다고 협박해요",
    "시어머니가 예단 안 하면 결혼 못 시킨다고 협박하세요",
    "남친이 다이어트 안 하면 드레스 못 입는다고 협박해요",
    // `위협` 은 신호 목록에 넣지 않았다 — 넣으면 아래가 전부 걸린다.
    "예산 초과가 제일 큰 위협이에요",
    "계약서에 위협적인 조항이 많아요",
  ])("남는다: %s", (userText) => {
    expect(landsInSharedLane(userText), "평범한 문장을 안전 레인으로 보냈다").toBe(true);
  });
});
