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
    | "mutual_conflict_evidence";
}

const OFFER_SIGNALS: Array<{ weight: number; patterns: string[] }> = [
  {
    weight: 5,
    patterns: [
      "싸우자", "싸웠", "다퉜", "말안해", "연락끊",
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
      "너때문에속상", "너한테서운", "서운해", "답답해",
      "화가나", "화났어", "짜증나", "지쳤어", "속상해",
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
