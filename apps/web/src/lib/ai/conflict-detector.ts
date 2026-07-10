/**
 * 커플 갈등 감지기 — 서버사이드 단일 진실원본.
 *
 * 설계:
 *  - A안: 휴리스틱 강화 (정규화, 회상 필터, 턴 패턴, 농담 필터, pastConflicts 가중치)
 *  - B안: borderline(5~9점) 케이스만 GPT-5.6 Luna 검증으로 false positive 제거
 *  - 점수 < 5: 확실히 비-갈등 → 즉시 false
 *  - 점수 5~9: borderline → LLM 검증 (수동공격·반어·맥락 판단)
 *  - 점수 ≥ 10: 확실한 갈등 → LLM 호출 없이 즉시 true
 *
 * 출력: trigger 결정 + 점수 + 갈등 맥락 + 사유 (디버깅용).
 *
 * 호출처: /api/chat/check-couple-conflict
 *  ChatStore.sendMessage 가 커플 메시지 INSERT 직후 fire-and-forget 으로 호출.
 */

import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { hasOpenAIConfig } from "@/lib/ai/modelConfig";

// ──────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────

export interface CoupleMessage {
  content: string;
  senderRole: "bride" | "groom" | "ai" | null;
  createdAt: string;
  visibility: "shared" | "bride_private" | "groom_private";
  metadata?: { target?: string | null } | null;
}

export interface PastConflictSummary {
  title: string;
  createdAt: string;
}

export interface ConflictDetection {
  triggered: boolean;
  score: number;
  reason: string;
  conflictContext: string;
  /** LLM 검증을 거쳤는지 — 비용 통계용 */
  llmVerified: boolean;
}

// ──────────────────────────────────────────────────────────────
// 정규화 — 공백·문장부호·반복문자 처리
// ──────────────────────────────────────────────────────────────

/** "안 돼!!" / "안돼" / "안되" 같은 변이를 동일 키워드로 만듦. 매칭 전에 적용. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, "") // 공백 제거
    .replace(/[?!.,~^_\-:;'"`*]/g, "") // 흔한 문장부호 제거
    .replace(/(.)\1{2,}/g, "$1$1") // "안돼돼돼돼" → "안돼돼"
    .toLowerCase();
}

// ──────────────────────────────────────────────────────────────
// 패턴 라이브러리 — 정규화된 텍스트에 substring 매칭
// ──────────────────────────────────────────────────────────────

const CONFLICT_CATEGORIES: Array<{ id: string; weight: number; patterns: string[] }> = [
  {
    id: "fight",
    weight: 5,
    patterns: [
      "싸우자", "싸웠어", "크게싸", "다퉜어", "다투고",
      "말안해", "연락끊", "연락도안",
      "무시하지마", "무시하는거", "무시당하", "무시해",
      "대화가안돼", "말이안통해", "소통이안",
      "이해를못해", "이해를안해", "이해가안돼",
      "헤어지자", "결혼안해", "결혼취소", "파혼",
    ],
  },
  {
    id: "blame",
    weight: 4,
    patterns: [
      "왜맨날너만", "나만양보", "너는맨날", "너만맨날",
      "맨날나한테", "내말은안듣", "내말을안듣",
      "관심이없는거", "관심도없", "신경도안써", "신경을안써",
      "니가알아서해", "너혼자해",
      "왜항상나만", "너는왜그래",
      "맨날이래", "또이러네", "또시작이야",
      "말을안해줘", "얘기를안해",
      "남편이맨날", "와이프가맨날", "신랑이맨날", "신부가맨날",
      "안들어줘", "말을안들어",
    ],
  },
  {
    id: "disagree",
    weight: 3,
    patterns: [
      "난절대반대", "나는반대야", "절대안돼",
      "그건절대싫", "왜꼭그걸", "왜그걸해야",
      "말도안되는", "말이되냐", "말이돼",
      "돈이어디서나", "돈이어디있", "그돈으로뭘",
      "내가언제그랬", "그렇게정한적없",
      "의견이달라", "의견이안맞", "생각이달라", "생각이안맞",
      "동의못해", "동의안해", "합의가안",
      "안된다니까", "싫다니까", "하기싫",
    ],
  },
  {
    id: "emotion",
    weight: 2,
    patterns: [
      "너때문에속상", "너한테서운", "서운한게", "서운했어", "서운해",
      "답답해진짜", "진짜답답", "너무답답", "답답해서",
      "화가나", "화나는", "너때문에화", "화났어", "화가많이",
      "짜증나진짜", "진짜짜증", "너무짜증", "짜증이나",
      "지쳤어이제", "진짜지쳤", "너무힘들어", "힘들다",
      "스트레스", "속상해", "속상하다", "울었어", "울고싶",
      "불안해", "걱정돼",
    ],
  },
];

// 수동공격·반어 신호 — LLM 보조 신호로만 사용 (단독 트리거 X, 점수 0.5점)
const PASSIVE_AGGRESSIVE_HINTS = [
  "응그래", "그래그렇게", "알아서해", "마음대로해", "네맘대로",
  "됐어", "됐다", "관둬", "포기할게", "포기해야겠",
  "솔직히짜증", "솔직히답답",
];

// ──────────────────────────────────────────────────────────────
// 회상 필터 — 시점/제3자 키워드 + 갈등 키워드 = 회상 모드 → 트리거 X
// ──────────────────────────────────────────────────────────────

const RECALL_TIME_KEYWORDS = [
  "오늘", "어제", "그제", "엊그제", "지난주", "지난번",
  "예전에", "전에", "옛날에", "그때", "저번에",
];

const RECALL_THIRD_PARTY = [
  "엄마가", "아빠가", "아버지가", "어머니가",
  "시어머니", "시아버지", "친정", "시댁",
  "친구가", "동료가", "회사에서", "상사가",
  "걔가", "쟤가", "그애가", "그분이",
];

function looksLikeRecall(rawMsg: string, normalizedMsg: string): boolean {
  const hasTimeKeyword = RECALL_TIME_KEYWORDS.some((kw) =>
    rawMsg.includes(kw) || normalizedMsg.includes(normalize(kw))
  );
  const hasThirdParty = RECALL_THIRD_PARTY.some((kw) =>
    rawMsg.includes(kw) || normalizedMsg.includes(normalize(kw))
  );
  // 시점 키워드만 있고 제3자 없으면 모호 (둘 사이 일도 회상 가능) — false 처리
  // 시점 + 제3자 동시면 회상 모드 확실
  return hasTimeKeyword && hasThirdParty;
}

// ──────────────────────────────────────────────────────────────
// 농담 필터 — ㅋㅋ ㅎㅎ 빈도 ≥ N 이면 농담 맥락으로 점수 감산
// ──────────────────────────────────────────────────────────────

function hasJokingMarkers(rawMsg: string): boolean {
  // ㅋ 또는 ㅎ 2개 이상 연속 — "ㅋㅋ" "ㅎㅎ" "ㅋㅋㅋ"
  return /[ㅋ]{2,}|[ㅎ]{2,}/.test(rawMsg);
}

// ──────────────────────────────────────────────────────────────
// 턴 패턴 시그널 — 짧은 답·응답 간격·연속 발화
// ──────────────────────────────────────────────────────────────

interface TurnSignals {
  bonus: number;
  notes: string[];
}

function analyzeTurnPatterns(
  coupleMessages: CoupleMessage[],
): TurnSignals {
  const notes: string[] = [];
  let bonus = 0;

  // 1. 갑작스러운 짧은 답 (마지막 3개 메시지 중 5자 이하가 2개 이상)
  const recent3 = coupleMessages.slice(-3);
  const shortCount = recent3.filter((m) => m.content.trim().length <= 5).length;
  if (shortCount >= 2) {
    bonus += 2;
    notes.push(`짧은 답 ${shortCount}개`);
  }

  // 2. 응답 간격 — 마지막 메시지 간 간격이 2시간 이상이면 침묵 신호 +2점
  //    (커플끼리 평소 빠르게 답하다가 갑자기 끊김)
  if (coupleMessages.length >= 2) {
    const last = coupleMessages[coupleMessages.length - 1];
    const prev = coupleMessages[coupleMessages.length - 2];
    const gapMs = new Date(last.createdAt).getTime() - new Date(prev.createdAt).getTime();
    const gapHours = gapMs / (1000 * 60 * 60);
    if (gapHours >= 2 && gapHours <= 48) {
      bonus += 2;
      notes.push(`응답 간격 ${gapHours.toFixed(1)}시간`);
    }
  }

  // 3. 한쪽 연속 발화 — 마지막 5개 메시지 중 같은 sender 가 4개 이상이면 한쪽 침묵 신호
  const last5 = coupleMessages.slice(-5);
  if (last5.length === 5) {
    const senderCount: Record<string, number> = {};
    for (const m of last5) {
      const r = m.senderRole ?? "unknown";
      senderCount[r] = (senderCount[r] ?? 0) + 1;
    }
    const maxSender = Math.max(...Object.values(senderCount));
    if (maxSender >= 4) {
      bonus += 2;
      notes.push(`한쪽 연속 발화 ${maxSender}/5`);
    }
  }

  return { bonus, notes };
}

// ──────────────────────────────────────────────────────────────
// pastConflicts 가중치 — 재발 패턴이면 임계점 살짝 낮춤
// ──────────────────────────────────────────────────────────────

function pastConflictBonus(pastConflicts: PastConflictSummary[]): number {
  // 최근 7일 내 갈등 1건 이상이면 임계점 -1점 (= 점수 +1점)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = pastConflicts.filter(
    (c) => new Date(c.createdAt).getTime() >= cutoff
  ).length;
  if (recentCount >= 2) return 2;
  if (recentCount >= 1) return 1;
  return 0;
}

// ──────────────────────────────────────────────────────────────
// 점수 계산 (A안)
// ──────────────────────────────────────────────────────────────

interface HeuristicResult {
  score: number;
  hitCategories: Set<string>;
  conflictMessageCount: number;
  conflictMessages: string[];
  senderDiversity: number;
  notes: string[];
}

function runHeuristics(
  coupleMessages: CoupleMessage[],
  pastConflicts: PastConflictSummary[],
): HeuristicResult {
  const notes: string[] = [];
  let score = 0;
  const hitCategories = new Set<string>();
  const senderHits: Record<string, number> = {};
  let conflictMessageCount = 0;
  const conflictMessages: string[] = [];
  let jokingMsgs = 0;
  let recallMsgs = 0;

  for (const msg of coupleMessages) {
    const raw = msg.content;
    const norm = normalize(raw);
    let msgScore = 0;
    const msgCategories = new Set<string>();

    for (const cat of CONFLICT_CATEGORIES) {
      for (const pattern of cat.patterns) {
        if (norm.includes(pattern)) {
          msgScore += cat.weight;
          msgCategories.add(cat.id);
          break;
        }
      }
    }

    // 수동공격 hint — 0.5점만 (단독 트리거 안 되도록)
    for (const hint of PASSIVE_AGGRESSIVE_HINTS) {
      if (norm.includes(hint)) {
        msgScore += 0.5;
        msgCategories.add("passive");
        break;
      }
    }

    if (msgScore === 0) continue;

    // 회상 모드 필터 — 점수 무효화
    if (looksLikeRecall(raw, norm)) {
      recallMsgs++;
      continue;
    }

    // 농담 맥락 — 점수 50% 감산 (완전 무효화는 너무 강함)
    if (hasJokingMarkers(raw)) {
      msgScore *= 0.5;
      jokingMsgs++;
    }

    score += msgScore;
    for (const c of msgCategories) hitCategories.add(c);
    conflictMessageCount++;
    conflictMessages.push(raw.slice(0, 60));

    const role = msg.senderRole ?? "unknown";
    senderHits[role] = (senderHits[role] ?? 0) + 1;
  }

  const senderDiversity = Object.keys(senderHits).length;

  // 양쪽 발화자 → 1.5×
  if (senderDiversity >= 2) {
    score *= 1.5;
    notes.push("양쪽 발화 ×1.5");
  }

  // 턴 패턴 보너스
  const turn = analyzeTurnPatterns(coupleMessages);
  score += turn.bonus;
  notes.push(...turn.notes);

  // 재발 패턴 보너스
  const pastBonus = pastConflictBonus(pastConflicts);
  if (pastBonus > 0) {
    score += pastBonus;
    notes.push(`재발 패턴 +${pastBonus}`);
  }

  if (recallMsgs > 0) notes.push(`회상 제외 ${recallMsgs}개`);
  if (jokingMsgs > 0) notes.push(`농담 ½ ${jokingMsgs}개`);

  return {
    score: Math.round(score * 10) / 10,
    hitCategories,
    conflictMessageCount,
    conflictMessages,
    senderDiversity,
    notes,
  };
}

// ──────────────────────────────────────────────────────────────
// LLM 검증 (B안) — borderline 만 호출
// ──────────────────────────────────────────────────────────────

async function verifyWithLLM(
  coupleMessages: CoupleMessage[],
  audit?: { coupleId?: string | null; userId?: string | null }
): Promise<{ isConflict: boolean; reason: string }> {
  if (!hasOpenAIConfig("fast")) {
    return { isConflict: false, reason: "OpenAI 보조 모델 설정 없음 — LLM 검증 스킵" };
  }

  // 최근 10개만 + 라벨링
  const formatted = coupleMessages
    .slice(-10)
    .map((m) => {
      const role =
        m.senderRole === "bride"
          ? "신부"
          : m.senderRole === "groom"
            ? "신랑"
            : m.senderRole === "ai"
              ? "아모라"
              : "?";
      return `${role}: ${m.content}`;
    })
    .join("\n");

  const prompt = `아래는 한 커플의 채팅 마지막 부분입니다. 지금 둘 사이에 갈등이 진행 중인지 판단하세요.

${formatted}

판단 기준:
- 진짜 갈등: 두 사람이 서로 의견 대립·비난·감정 표출을 주고받음. 한쪽이 답답해하고 다른 쪽이 방어하거나 무시하는 패턴
- 갈등 아님: 회상(과거·제3자 일 이야기), 농담, 단순 결정 토의, 한쪽 푸념(상대방 향하지 않음), 단순 거절

응답은 정확히 한 줄 JSON만:
{"conflict": true|false, "reason": "한국어 한 줄로 판단 이유 (30자 이내)"}`;

  try {
    const res = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      maxOutputTokens: 100,
      instructions: "커플 대화의 갈등 여부를 보수적으로 판별하고 요청된 JSON 형식으로만 답하세요.",
      input: prompt,
      audit: {
        userId: audit?.userId ?? null,
        coupleId: audit?.coupleId ?? null,
        interactionType: "chat_turn",
        userInput: formatted,
        metadata: { source: "conflict_detector_verify", visibility: "shared" },
      },
    });

    const text = res.text;

    // JSON 추출 — 응답 앞뒤에 다른 텍스트 있을 수 있어 robust 파싱
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isConflict: false, reason: "LLM 응답 JSON 파싱 실패" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as { conflict?: boolean; reason?: string };
    return {
      isConflict: parsed.conflict === true,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 80) : "이유 없음",
    };
  } catch (err) {
    return {
      isConflict: false,
      reason: `LLM 검증 에러: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// 통합 — A + B
// ──────────────────────────────────────────────────────────────

const HARD_TRIGGER_SCORE = 10; // 이 이상이면 LLM 검증 없이 즉시 트리거
const HARD_REJECT_SCORE = 5; // 미만이면 무조건 비-갈등

export async function detectCoupleConflict(params: {
  coupleId?: string | null;
  userId?: string | null;
  /** 최근 shared visibility 메시지 (시간 오름차순) */
  recentSharedMessages: CoupleMessage[];
  /** 같은 커플의 과거 conflict_resolution decision_nodes */
  pastConflicts: PastConflictSummary[];
  /** 최대 윈도우 (분) — 이 시간 이전 메시지는 무시. 기본 5분 */
  windowMinutes?: number;
  /** borderline 검증 LLM을 실제 호출하기 직전 원자 비용 예약 */
  reserveLLMCall?: () => Promise<boolean>;
}): Promise<ConflictDetection> {
  const windowMs = (params.windowMinutes ?? 5) * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  // 윈도우 안 + user 발화만 (AI 메시지 제외)
  const coupleMessages = params.recentSharedMessages.filter(
    (m) =>
      m.senderRole !== "ai" &&
      new Date(m.createdAt).getTime() >= cutoff,
  );

  if (coupleMessages.length < 2) {
    return {
      triggered: false,
      score: 0,
      reason: "메시지 2개 미만",
      conflictContext: "",
      llmVerified: false,
    };
  }

  const h = runHeuristics(coupleMessages, params.pastConflicts);

  // 최소 2개 메시지 + 다중 카테고리 또는 fight hit 게이트
  const multiCategoryOk = h.hitCategories.size >= 2 || h.hitCategories.has("fight");

  // 점수 너무 낮으면 즉시 거절
  if (h.score < HARD_REJECT_SCORE || h.conflictMessageCount < 2 || !multiCategoryOk) {
    return {
      triggered: false,
      score: h.score,
      reason: `점수 ${h.score}/${HARD_REJECT_SCORE}, 메시지 ${h.conflictMessageCount}, 카테고리 ${h.hitCategories.size} — ${h.notes.join(", ")}`,
      conflictContext: h.conflictMessages.join(" / "),
      llmVerified: false,
    };
  }

  // 확실한 갈등 → LLM 없이 즉시 트리거
  if (h.score >= HARD_TRIGGER_SCORE) {
    return {
      triggered: true,
      score: h.score,
      reason: `확실한 갈등 (점수 ${h.score} ≥ ${HARD_TRIGGER_SCORE}) — ${h.notes.join(", ")}`,
      conflictContext: h.conflictMessages.join(" / "),
      llmVerified: false,
    };
  }

  // borderline — LLM 검증
  const reserved = await params.reserveLLMCall?.();
  if (reserved !== true) {
    return {
      triggered: false,
      score: h.score,
      reason: `borderline 점수 ${h.score} — 비용 보호 장치로 LLM 검증 생략`,
      conflictContext: h.conflictMessages.join(" / "),
      llmVerified: false,
    };
  }
  const llm = await verifyWithLLM(coupleMessages, {
    coupleId: params.coupleId ?? null,
    userId: params.userId ?? null,
  });
  return {
    triggered: llm.isConflict,
    score: h.score,
    reason: `borderline 점수 ${h.score} → LLM: ${llm.reason}`,
    conflictContext: h.conflictMessages.join(" / "),
    llmVerified: true,
  };
}
