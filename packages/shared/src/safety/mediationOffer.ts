import { classifyAmoraCrisis } from "./amoraCrisisSafety";
import { assessAmoraSafetyText } from "./amoraCrisisClassifier";
import { hasCoerciveControlSignal } from "./coerciveControlSignals";

type CoupleRole = "bride" | "groom";

export interface MediationOfferMessage {
  id: string;
  content: string;
  sender_role: "bride" | "groom" | "ai";
  visibility: "shared" | "bride_private" | "groom_private";
  metadata?: { target?: string | null } | null;
  created_at: string;
}

export interface MediationOfferAssessment {
  shouldOffer: boolean;
  score: number;
  evidenceCount: number;
  evidenceRoles: CoupleRole[];
  offerKey: string | null;
  reason:
    | "safety_signal"
    | "insufficient_direct_messages"
    | "stale_conflict_evidence"
    | "one_sided_evidence"
    | "below_threshold"
    | "mutual_conflict_evidence";
}

export interface AssessMediationOfferOptions {
  nowMs?: number;
}

export interface PrivateMediationSafetyHoldMessage {
  visibility: string;
  sender_role?: unknown;
  sender_type?: unknown;
  metadata?: unknown;
}

export const MEDIATION_OFFER_FRESHNESS_MS = 2 * 60 * 60 * 1000;
export const MEDIATION_OFFER_INCIDENT_GAP_MS = 30 * 60 * 1000;
const ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * 현재 사용자 비공개 레인에 안전 카드가 남아 있으면 중재 보류는 계속된다.
 * 뒤에 이어진 평범한 대화는 안전 문제가 해소됐다는 명시적 증거가 아니므로
 * 보류를 해제하지 않는다. 별도 해제 계약이 생기기 전에는 카드 제거만이 해제다.
 */
export function hasUnresolvedPrivateMediationSafetyHold(
  messages: readonly PrivateMediationSafetyHoldMessage[],
  actorRole: CoupleRole | null | undefined,
): boolean {
  if (!actorRole) return false;
  const privateVisibility = `${actorRole}_private`;
  return messages.some((message) => (
    message.visibility === privateVisibility
    && (message.sender_role === "ai" || message.sender_type === "ai")
    && typeof message.metadata === "object"
    && message.metadata !== null
    && "pinned_safety_card" in message.metadata
    && message.metadata.pinned_safety_card === true
  ));
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

const THIRD_PARTY_SUBJECTS = [
  "엄마가", "아빠가", "아버지가", "어머니가",
  "부모님이", "시어머니가", "시아버지가", "장모님이", "장인어른이",
  "시댁에서", "친정에서",
  "친구가", "동료가", "회사에서", "상사가",
  "플래너가", "업체가", "직원이", "담당자가",
  "걔가", "쟤가", "그애가", "그분이",
];
const THIRD_PARTY_RELATION_PATTERN =
  /(?:그\s*)?(?:플래너|업체|직원|담당자|상사|동료|친구|부모님|시댁|친정)(?:이|가|은|는|을|를|와|과|랑|하고|한테|에게|쪽|에서|때문)/u;
const FICTION_OR_MEDIA_CONTEXT_PATTERN =
  /(?:영화|드라마|소설|웹툰|연극|뮤지컬|대본|시나리오|게임)(?:에서|에서는|속|속에서|에|의)?|(?:주인공|등장인물|캐릭터|배우)(?:가|이|는|은)/u;
const EXPLICIT_DIRECT_COUPLE_TURN_PATTERN =
  /(?:(?:하지만|그런데|근데)\s*|[.!?\n]\s*)(?:너(?:는|가|도|한테)|당신(?:은|이|도|한테)|자기(?:는|가|도|한테)|(?:나는|난|내가)\s*(?:반대|동의\s*못|합의\s*못|너한테\s*서운))/u;

// 중재는 상대에게 공유될 수 있으므로 일반 채팅보다 보수적으로 멈춘다. 기존 위기
// 분류기가 맥락 부족으로 inconclusive를 내는 짧은 과거 폭력 서술도 포함한다.
const EXPLICIT_MEDIATION_DANGER_PATTERN =
  /(?:(?:나|저|날|절)(?:를)?\s*(?:때리|때렸|밀치|밀쳤|발로\s*차|주먹으로\s*치|목을?\s*조르|죽이|해치)|(?:내|제)\s*목을?\s*(?:조르|졸라|조였)|(?:배우자|남편|아내|남자친구|여자친구|남친|여친|신랑|신부|상대|너|네가|니가|당신)(?:가|이|는)?[^.!?\n]{0,32}(?:폭력|폭행|손찌검|때리|밀치|목을?\s*조르|칼|흉기|협박|위협|감금|가둬|못\s*나가게|스토킹|성폭|성추행|강간)|(?:가정|데이트)\s*폭력|강제로\s*성관계)/u;
const EXPLICIT_SEXUAL_OR_REPRODUCTIVE_COERCION_PATTERN =
  /(?:(?:(?:원치\s*않는|싫다는데|동의\s*없이)\s*)?(?:성관계|성적\s*행위|관계)(?:를|을)?[^.!?\n]{0,24}(?:강요|요구|압박)|(?:성관계|성적\s*행위|관계)(?:가|를|을|은|는)?[^.!?\n]{0,16}(?:싫다고(?:\s*했)?|거부했)[^.!?\n]{0,16}(?:억지로|강제로)\s*(?:관계(?:를|을)?\s*)?(?:했|하)|강제로\s*(?:성관계|성적\s*행위|관계)|(?:피임|콘돔)(?:을|를)?\s*(?:못\s*하게|금지|방해)|임신(?:을|를)?\s*(?:강요|압박))/u;
const EXPLICIT_MOVEMENT_SURVEILLANCE_PATTERN =
  /(?:어디\s*(?:에\s*)?(?:가는지|있는지)|외출|동선|위치)(?:를|을)?[^.!?\n]{0,20}(?:매번|매일|계속|늘)[^.!?\n]{0,12}(?:검사|확인|보고|감시|추적)|(?:매번|매일|계속|늘)[^.!?\n]{0,12}(?:어디\s*(?:에\s*)?(?:가는지|있는지)|외출|동선|위치)[^.!?\n]{0,16}(?:검사|확인|보고|감시|추적)|(?:외출(?:할)?|나갈)\s*때마다[^.!?\n]{0,12}위치(?:를|을)?[^.!?\n]{0,8}(?:보내|공유하|알리|보고하)(?:라고|라)\s*(?:해|했|요구)/u;
const FIRST_PERSON_PARTNER_HARM_PATTERN =
  /(?:내가|제가|나는|저는)\s*(?:(?:남편|아내|배우자|파트너|남자친구|여자친구|남친|여친|신랑|신부|상대(?:방)?|너|당신)(?:(?:을|를)\s*[^.!?\n]{0,20}(?:때리|때렸|밀치|밀쳤|발로\s*(?:차|찼)|주먹으로\s*(?:치|쳤)|목을?\s*(?:조르|조른|졸랐|조였))|(?:한테|에게)\s*[^.!?\n]{0,20}(?:물건|휴대폰|핸드폰|컵|병|의자)(?:을|를)?\s*(?:던지|던졌))|(?:물건|휴대폰|핸드폰|컵|병|의자)(?:을|를)\s*[^.!?\n]{0,12}(?:남편|아내|배우자|파트너|남자친구|여자친구|남친|여친|신랑|신부|상대(?:방)?|너|당신)(?:한테|에게)\s*(?:던지|던졌))/u;
const NATURAL_MEDIATION_DANGER_PATTERNS = [
  /(?:^|[\s,.!?])(?:나|저|날|절)(?:를)?\s*(?:벽(?:으로|에)\s*)?밀(?:었|쳐|쳤|치|어|렸)/u,
  /(?:남친|여친|남편|아내|배우자|신랑|신부|파트너|상대)(?:이|가)?\s*(?:또|다시)\s*손(?:을)?\s*올렸/u,
  /(?:남친|여친|남편|아내|배우자|신랑|신부|파트너|상대)(?:이|가|은|는)?[^.!?\n]{0,20}(?:물건|휴대폰|핸드폰|컵|병|의자)(?:을|를)?\s*(?:나|저)(?:한테|에게|쪽(?:으)?로|를\s*향해)\s*던(?:졌|져|지)/u,
  /(?:남친|여친|남편|아내|배우자|신랑|신부|파트너|상대)(?:이|가|은|는)?[^.!?\n]{0,24}(?:(?:숨(?:을)?\s*못\s*쉬게\s*)?목(?:을|를)?\s*(?:누르|눌렀|누르고|누른)|머리채(?:를|을)?\s*잡(?:았|고|아|는)|팔(?:을|를)?\s*비틀(?:었|고|어|는))/u,
  /(?:^|[\s,.!?])(?:나|저|날|절)(?:를)?\s*다치게\s*할\s*거(?:야|예요|라고\s*(?:했|말)|라며)/u,
  /(?:화나면|화가\s*나면|화낼\s*때|싸우면|다투면)[^.!?\n]{0,20}물건(?:을|를)?\s*던(?:져|졌|지(?:고|는)?)(?![^.!?\n]{0,12}(?:건|게|것은)\s*아니)/u,
  /(?:내|제)\s*(?:사진|영상|대화|메시지|개인정보|비밀)[^.!?\n]{0,36}(?:보내|퍼뜨리|뿌리|유포|공개|올리)[^.!?\n]{0,24}(?:협박|위협|겁(?:을)?\s*줘|겁주)/u,
  /(?:나|저|날|절)(?:를)?[^.!?\n]{0,28}(?:협박|보복)(?![^.!?\n]{0,10}(?:아니|않))/u,
] as const;

export function normalizeMediationConflictText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[?!.,~^_\-:;'"`*]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1")
    .toLowerCase();
}

export function looksLikeMediationThirdPartyNarrative(
  rawMessage: string,
  normalizedMessage = normalizeMediationConflictText(rawMessage),
): boolean {
  return THIRD_PARTY_RELATION_PATTERN.test(rawMessage)
    || THIRD_PARTY_SUBJECTS.some((keyword) =>
    rawMessage.includes(keyword)
    || normalizedMessage.includes(normalizeMediationConflictText(keyword))
  );
}

export function hasMediationSafetySignal(content: string): boolean {
  const assessment = assessAmoraSafetyText(content);
  return assessment.resolution === "immediate_crisis"
    || assessment.resolution === "non_immediate_safety"
    || classifyAmoraCrisis(content) !== null
    || hasCoerciveControlSignal(content)
    || EXPLICIT_MEDIATION_DANGER_PATTERN.test(content)
    || EXPLICIT_SEXUAL_OR_REPRODUCTIVE_COERCION_PATTERN.test(content)
    || EXPLICIT_MOVEMENT_SURVEILLANCE_PATTERN.test(content)
    || FIRST_PERSON_PARTNER_HARM_PATTERN.test(content)
    || NATURAL_MEDIATION_DANGER_PATTERNS.some((pattern) => pattern.test(content));
}

function scoreConflictClause(content: string): number {
  const normalized = normalizeMediationConflictText(content);
  if (
    looksLikeMediationThirdPartyNarrative(content, normalized)
    || FICTION_OR_MEDIA_CONTEXT_PATTERN.test(content)
  ) return 0;

  // 체념형 표현은 짧은 문장 전체가 그 뜻일 때만 본다. "해도 돼"처럼 명시적으로
  // 선택권을 주는 문장을 부분 문자열로 잡으면 평범한 양보가 갈등으로 바뀐다.
  let score = /^(?:그래)?네가원하는대로해(?:라)?$/u.test(normalized)
    || /^또내가다정하는사람이됐(?:네|어|구나)?$/u.test(normalized)
    ? 3
    : 0;
  for (const signal of OFFER_SIGNALS) {
    if (signal.patterns.some((pattern) => normalized.includes(pattern))) {
      score += signal.weight;
    }
  }

  return score;
}

function scoreMessage(content: string): number {
  // 제3자와의 다툼 뒤에 붙는 "너무 답답해" 같은 감정의 연속 문장은
  // 커플 갈등 증거가 아니다. 다만 접속어 뒤에 파트너를 직접 부르거나 자신의
  // 반대 입장을 명시하면 그 뒤 절만 별도로 점수화한다.
  if (
    looksLikeMediationThirdPartyNarrative(content)
    && !EXPLICIT_DIRECT_COUPLE_TURN_PATTERN.test(content)
  ) return 0;

  const score = content
    .split(/(?:[\n.!?;,]+|하지만|그런데|근데)/u)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .reduce((total, clause) => total + scoreConflictClause(clause), 0);

  return /[ㅋ]{2,}|[ㅎ]{2,}/.test(content) ? score * 0.5 : score;
}

function noOffer(
  reason: Exclude<MediationOfferAssessment["reason"], "mutual_conflict_evidence">,
  score = 0,
  evidenceCount = 0,
  evidenceRoles: CoupleRole[] = [],
): MediationOfferAssessment {
  return {
    shouldOffer: false,
    score,
    evidenceCount,
    evidenceRoles,
    offerKey: null,
    reason,
  };
}

/**
 * 이 결과는 관계에 대한 판정이 아니라, 사용자가 거절할 수 있는 도움 제안 조건이다.
 * 공유된 상대방 직접 발화만 읽고, 안전 신호가 하나라도 있으면 일반 중재를 멈춘다.
 */
export function assessMediationOffer(
  messages: MediationOfferMessage[],
  options: AssessMediationOfferOptions = {},
): MediationOfferAssessment {
  const nowMs = options.nowMs ?? Date.now();
  const eligibleDirectMessages = messages
    .filter(
      (message) =>
        message.visibility === "shared"
        && message.metadata?.target === "partner"
        && (message.sender_role === "bride" || message.sender_role === "groom"),
    );
  const freshDirectMessages = eligibleDirectMessages
    .filter((message) => {
      const createdAtMs = Date.parse(message.created_at);
      if (!Number.isFinite(createdAtMs)) return false;
      const ageMs = nowMs - createdAtMs;
      return ageMs >= -ALLOWED_CLOCK_SKEW_MS
        && ageMs <= MEDIATION_OFFER_FRESHNESS_MS;
    })
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));

  if (freshDirectMessages.some((message) => hasMediationSafetySignal(message.content))) {
    return noOffer("safety_signal");
  }

  if (eligibleDirectMessages.length < 2) {
    return noOffer("insufficient_direct_messages");
  }
  if (freshDirectMessages.length < 2) return noOffer("stale_conflict_evidence");

  let incidentStartIndex = freshDirectMessages.length - 1;
  while (incidentStartIndex > 0) {
    const currentAt = Date.parse(freshDirectMessages[incidentStartIndex].created_at);
    const previousAt = Date.parse(freshDirectMessages[incidentStartIndex - 1].created_at);
    if (currentAt - previousAt > MEDIATION_OFFER_INCIDENT_GAP_MS) break;
    incidentStartIndex--;
  }
  const eventAnchor = freshDirectMessages[incidentStartIndex];
  const recentDirectMessages = freshDirectMessages
    .slice(incidentStartIndex)
    .slice(-6);
  if (recentDirectMessages.length < 2) {
    return noOffer("insufficient_direct_messages");
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

  const roles = [...evidenceRoles];
  const bothSides = evidenceRoles.has("bride") && evidenceRoles.has("groom");
  if (!bothSides) {
    return noOffer("one_sided_evidence", score, evidenceCount, roles);
  }

  score = Math.round(score * 1.5 * 10) / 10;
  if (score < 7) {
    return noOffer("below_threshold", score, evidenceCount, roles);
  }

  return {
    shouldOffer: true,
    score,
    evidenceCount,
    evidenceRoles: roles,
    offerKey: `mediation-offer:v1:${eventAnchor.id}:${eventAnchor.created_at}`,
    reason: "mutual_conflict_evidence",
  };
}

export function shouldOfferMediation(messages: MediationOfferMessage[]): boolean {
  return assessMediationOffer(messages).shouldOffer;
}
