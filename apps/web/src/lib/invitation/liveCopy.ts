import { directionParticle, objectParticle, topicParticle } from "@/lib/korean/particles";

/**
 * 실제 커플 데이터로 서버가 화면 모델을 만들 때 쓰는 문장. 고정 화면 글자는 `@hanbang/shared/invitation` 의
 * copy 에 있고, 여기는 실제 데이터에서만 생기는 문장이다. 아티팩트에 같은 꼴이 있으면 그 꼴을 그대로 쓴다.
 *
 * 업체를 점수, 순위, 판정 낱말로 말하지 않는다. 비교 꼬리표는 아티팩트 문구 가운데 자료에서 사실로
 * 따라 나오는 둘("교통이 가장 편해요"는 역에서 걷는 시간이 가장 짧을 때, "보증 인원 확인 필요"는 보증 인원이
 * 하객 수보다 많을 때)만 쓴다. 아티팩트의 "가장 합리적이에요"는 가격의 적정성을 판정하는 말이라 실제 자료에는 쓰지 않는다.
 */

export const LIVE_COPY = {
  unknownCell: "업체 확인 필요",
  rentIncluded: "식대에 포함",
  manwon: (formatted: string) => `${formatted}만 원`,
  won: (formatted: string) => `${formatted}원`,
  people: (count: number) => `${count}명`,
  minimumOver: (minimum: number, over: number) => `${minimum}명 (${over}명 많음)`,
  stationWalk: (minutes: number) => `역에서 ${minutes}분`,
  venueInProgress: (count: number) => `지금 하고 있어요. 후보 ${count}곳`,
  hallBadges: {
    closestStation: "교통이 가장 편해요",
    minimumCheck: "보증 인원 확인 필요",
  },
  hallStatus: {
    confirmed: (monthDay: string) => `${monthDay} 상담 확정`,
    proposed: "다른 시간을 제안했어요",
    declined: "이번에는 어렵다고 답했어요",
    replied: "답장이 왔어요",
    sent: "답장을 기다리고 있어요",
    queued: "담당자가 보내기 전에 확인하고 있어요",
    minimumOver: (over: number) => `보증 인원이 ${over}명 많아요`,
  },
  letter: {
    opening: (when: string | null, timeLabel: string | null) => {
      if (!when) return "결혼식을 준비하고 있는 커플입니다.";
      return timeLabel ? `${when} ${timeLabel}에 예식을 생각하고 있는 커플입니다.` : `${when}에 예식을 생각하고 있는 커플입니다.`;
    },
    guests: (count: number) => `하객은 ${count}명 정도예요.`,
    askAvailability: "상담 가능한 시간을 알려 주시면 두 사람이 맞춰 가겠습니다.",
    /** 이름을 알려주지 않을 때의 맺음말. */
    anonymousSignature: "결혼을 준비하는 두 사람 드림",
    /** 판에 남기는 예산 값. 운영자가 그대로 읽는다. */
    budgetStored: (manwon: string) => `${manwon}만 원`,
    budgetUnsetStored: "아직 정하지 않았어요",
    /** 화면에 보이는 예산 값. 정하지 않았으면 copy 의 budgetUnset 을 쓴다. */
    budgetDisplay: (manwon: string) => `${manwon}만 원이라고 알려요`,
  },
  update: {
    confirmed: (hall: string, when: string) => `${hall} 상담이 ${when}${directionParticle(when)} 잡혔어요.`,
    proposed: (hall: string, when: string) => `${hall}${topicParticle(hall)} ${when}${objectParticle(when)} 제안했어요.`,
    declined: (hall: string) => `${hall}${topicParticle(hall)} 이번에는 상담이 어렵다고 답했어요.`,
    replied: (hall: string) => `${hall}에서 답장이 왔어요. 원문을 확인해 주세요.`,
    /** 한 사람이 탈퇴해서 원문을 지운 답장. */
    repliedWithoutText: (hall: string) => `${hall}에서 답장이 왔어요.`,
    sent: (count: number) => `담당자가 승인한 편지를 ${count}곳에 보냈어요. 답장이 오면 알려 드릴게요.`,
    queued: (count: number) => `담당자가 승인한 편지를 ${count}곳에 보내기 전에 한 번 더 확인하고 있어요.`,
    paused: "편지가 승인됐어요. 지금은 문의 보내기를 멈춰 두어서 아직 보내지 않았어요.",
    capped: "편지가 승인됐어요. 오늘 보낼 수 있는 문의 수를 넘어서 아직 보내지 않았어요.",
    noOtherEvents: "그날 다른 일정은 없어요.",
    otherEvents: (count: number) => `그날 일정이 ${count}개 있어요.`,
    viewConsultation: "상담 보기",
    viewReply: "답장 보기",
    viewHalls: "후보 다시 보기",
    viewLetter: "편지 확인하기",
  },
  /**
   * 소식의 "무엇을 했나요?" 줄과 오늘 한 일 줄. 주어를 문장에 드러낸다. 담당자의 일은 "담당자가"로 쓰고,
   * 두 분의 일은 일이 일어난 꼴("승인됐어요", "들어갔어요")로 써서 아모라가 한 일로 읽히지 않게 한다.
   */
  steps: {
    approved: (names: string) => `${names}에 보낼 편지가 승인됐어요`,
    sent: (count: number) => `담당자가 승인한 편지를 ${count}곳에 보냈어요`,
    reply: (hall: string) => `담당자가 ${hall} 답장을 정리했어요`,
  },
  activity: {
    sent: (count: number) => `담당자가 승인한 편지를 ${count}곳에 보냈어요`,
    reply: (hall: string) => `담당자가 ${hall} 답장을 정리했어요`,
    schedule: (hall: string) => `${hall} 상담이 일정에 들어갔어요`,
  },
  decisions: {
    alternativeTime: (hall: string) => `${hall} 대체 시간`,
    proposedSub: (when: string) => `${when} 제안`,
    letterApproval: "상담 문의 편지 확인",
    letterWaitingFor: (name: string) => `${name} 님의 승인을 기다려요`,
    letterYourTurn: "읽어 보고 승인해 주세요",
    letterEitherOne: "두 사람 중 한 사람이 승인하면 돼요",
  },
  /** 상담에서 물어볼 것(VEN-07). 아티팩트의 네 줄이고 첫 줄만 보증 인원 자료로 채운다. */
  consultationQuestions: (minimum: number | null): readonly string[] => [
    minimum === null ? "최소 보증 인원이 몇 명인지" : `보증 인원 ${minimum}명을 줄일 수 있는지`,
    "식대에 음료와 주류가 포함되는지",
    "꽃장식과 포토테이블 추가 비용",
    "계약금, 잔금 날짜와 취소 조건",
  ],
  consultationTitle: (hall: string) => `${hall} 상담`,
  partnerFallback: "파트너",
} as const;

/** 쉼표를 넣은 정수("1,360"). 실행 환경의 언어 설정에 기대지 않는다. */
export function withCommas(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 원 단위 금액을 아티팩트의 꼴로 쓴다. 만 원으로 나누어떨어지면 "300만 원", 백 원 단위면 "6.8만 원",
 * 그 밖에는 "12,345원". 반올림하지 않으므로 화면 숫자와 저장된 숫자가 어긋나지 않는다.
 */
export function formatWon(won: number): string {
  if (won >= 10_000 && won % 10_000 === 0) return LIVE_COPY.manwon(withCommas(won / 10_000));
  if (won >= 10_000 && won % 100 === 0) {
    const manwon = (won / 10_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const [whole, fraction] = manwon.split(".");
    return LIVE_COPY.manwon(fraction ? `${withCommas(Number(whole))}.${fraction}` : withCommas(Number(whole)));
  }
  return LIVE_COPY.won(withCommas(won));
}
