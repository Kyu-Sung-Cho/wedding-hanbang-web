import {
  looksLikeThirdPartyNarrative,
  normalizeConflictText,
} from "@/lib/ai/conflictSafety";

type CoupleRole = "bride" | "groom";

export interface MediationOfferMessage {
  content: string;
  sender_role: "bride" | "groom" | "ai";
  visibility: "shared" | "bride_private" | "groom_private";
  metadata?: { target?: string | null } | null;
}

export interface MediationOfferAssessment {
  shouldOffer: boolean;
  score: number;
  evidenceCount: number;
  evidenceRoles: CoupleRole[];
  reason:
    | "insufficient_direct_messages"
    | "one_sided_evidence"
    | "below_threshold"
    | "mutual_conflict_evidence"
    | "self_reported_conflict";
}

const OFFER_SIGNALS: Array<{ weight: number; patterns: string[] }> = [
  {
    weight: 5,
    patterns: [
      // 어형 구멍이 있었다 — `싸웠` 은 걸리는데 `싸워요`·`싸우고` 는 안 걸렸다
      // (2026-08-24). 이 저장소가 안전 어휘에서 이미 한 번 겪은 부류다. 어간으로
      // 넓히되 평범한 결혼 대화 20문장으로 오탐을 다시 쟀다(0건).
      "싸우자", "싸웠", "싸워", "싸우고", "싸우는", "다퉜", "다투", "말안해", "연락끊",
      "무시하", "대화가안", "말이안통", "헤어지자", "결혼취소", "파혼",
    ],
  },
  {
    weight: 4,
    patterns: [
      "왜맨날너만", "나만양보", "너는맨날", "내말은안듣",
      "관심이없", "신경도안써", "니가알아서", "너혼자해",
    ],
  },
  {
    weight: 3,
    patterns: [
      "난절대반대", "나는반대", "절대안돼", "그건절대싫",
      "왜그걸해야", "말도안돼", "돈이어디", "의견이안맞",
      "생각이안맞", "동의못해", "합의가안",
    ],
  },
  {
    weight: 2,
    patterns: [
      "너때문에속상", "너한테서운", "서운해", "서운했", "답답해", "답답했",
      "화가나", "화났어", "짜증나", "지쳤어", "지쳐요", "지쳐", "속상해", "속상했",
    ],
  },
];

function scoreMessage(content: string): number {
  const normalized = normalizeConflictText(content);
  if (looksLikeThirdPartyNarrative(content, normalized)) return 0;

  let score = 0;
  for (const signal of OFFER_SIGNALS) {
    if (signal.patterns.some((pattern) => normalized.includes(pattern))) {
      score += signal.weight;
    }
  }

  if (/[ㅋ]{2,}|[ㅎ]{2,}/.test(content)) score *= 0.5;
  return score;
}

/**
 * 클라이언트 배너는 판정이 아니라 선택적 도움 제안일 뿐이다.
 * 최근 상대방 대화 중 양측이 각각 갈등 신호를 낸 경우에만 노출한다.
 */
/**
 * 한 사람이 아모라에게 갈등을 이야기한 경우의 제안.
 *
 * 자동 배너(`assessMediationOffer`)는 **두 사람이 서로에게 직접** 보낸 갈등
 * 신호가 있어야 뜬다. 그건 의도된 설계다 — 한 사람 하소연에 중재를 들이미는
 * 것은 실례고, 중재는 두 사람의 입력이 있어야 뜻이 있다.
 *
 * 그런데 실제로는 그 조건이 거의 만들어지지 않는다. 커플이 앱 안에서
 * '파트너에게 보내기' 토글을 켜고 서로 싸워야만 열린다. 그래서 중재로 가는
 * 문이 사실상 닫혀 있었다 — 라이브에서 카드가 한 번도 뜨지 않았다
 * (2026-08-24 감사).
 *
 * 그래서 **혼자 이야기한 경우에도 문을 보여준다.** 시작하지는 않는다. 문구도
 * 다르다 — 두 사람 신호가 있을 때처럼 "두 분 사이에 의견 차이가 있는 것
 * 같아요" 라고 말하면 상대의 마음을 넘겨짚는 것이 된다.
 *
 * 문턱은 자동 배너보다 높게 둔다(1.5배 가중 없이 원점수 7). 혼자 한 말은
 * 근거가 절반이므로 더 분명할 때만 묻는다.
 */
export function assessSelfReportedConflictOffer(
  messages: MediationOfferMessage[],
  viewerRole: CoupleRole | null,
): MediationOfferAssessment {
  const mine = messages
    .filter(
      (message) =>
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
        && message.sender_role === viewerRole
        && (viewerRole === "bride" || viewerRole === "groom"),
    )
    .slice(-6);

  let score = 0;
  let evidenceCount = 0;
  for (const message of mine) {
    const messageScore = scoreMessage(message.content);
    if (messageScore <= 0) continue;
    score += messageScore;
    evidenceCount += 1;
  }
  score = Math.round(score * 10) / 10;

  if (evidenceCount < 2 || score < 7) {
    return {
      shouldOffer: false,
      score,
      evidenceCount,
      evidenceRoles: viewerRole ? [viewerRole] : [],
      reason: "below_threshold",
    };
  }
  return {
    shouldOffer: true,
    score,
    evidenceCount,
    evidenceRoles: viewerRole ? [viewerRole] : [],
    reason: "self_reported_conflict",
  };
}

export function assessMediationOffer(
  messages: MediationOfferMessage[],
): MediationOfferAssessment {
  const recentDirectMessages = messages
    .filter(
      (message) =>
        message.visibility === "shared"
        && message.metadata?.target === "partner"
        && (message.sender_role === "bride" || message.sender_role === "groom"),
    )
    .slice(-6);

  if (recentDirectMessages.length < 2) {
    return {
      shouldOffer: false,
      score: 0,
      evidenceCount: 0,
      evidenceRoles: [],
      reason: "insufficient_direct_messages",
    };
  }

  let score = 0;
  let evidenceCount = 0;
  const evidenceRoles = new Set<CoupleRole>();
  for (const message of recentDirectMessages) {
    const messageScore = scoreMessage(message.content);
    if (messageScore <= 0) continue;
    score += messageScore;
    evidenceCount++;
    evidenceRoles.add(message.sender_role as CoupleRole);
  }

  const bothSides =
    evidenceRoles.has("bride")
    && evidenceRoles.has("groom");
  if (!bothSides) {
    return {
      shouldOffer: false,
      score,
      evidenceCount,
      evidenceRoles: [...evidenceRoles],
      reason: "one_sided_evidence",
    };
  }

  score = Math.round(score * 1.5 * 10) / 10;
  if (score < 7) {
    return {
      shouldOffer: false,
      score,
      evidenceCount,
      evidenceRoles: [...evidenceRoles],
      reason: "below_threshold",
    };
  }

  return {
    shouldOffer: true,
    score,
    evidenceCount,
    evidenceRoles: [...evidenceRoles],
    reason: "mutual_conflict_evidence",
  };
}

export function shouldOfferMediation(
  messages: MediationOfferMessage[],
): boolean {
  return assessMediationOffer(messages).shouldOffer;
}
