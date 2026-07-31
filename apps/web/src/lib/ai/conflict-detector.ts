/**
 * 커플 갈등 감지기 — 서버사이드 단일 진실원본.
 *
 * 설계:
 *  - A안: 휴리스틱 강화 (정규화, 회상 필터, 턴 패턴, 농담 필터, pastConflicts 가중치)
 *  - B안: borderline(5~9점) 케이스만 저비용 OpenAI 검증으로 false positive 제거
 *  - 점수 < 5: 확실히 비-갈등 → 즉시 false
 *  - 점수 5~9: borderline → LLM 검증 (수동공격·반어·맥락 판단)
 *  - 점수 ≥ 10: 확실한 갈등 → LLM 호출 없이 즉시 true
 *
 * 출력: trigger 결정 + 점수 + 갈등 맥락 + 사유 (디버깅용).
 *
 * 호출처: /api/chat/check-couple-conflict
 *  ChatStore.sendMessage 가 커플 메시지 INSERT 직후 fire-and-forget 으로 호출.
 */

import {
  createOpenAIStructuredResponseWithAudit,
  type AuditedOpenAIStructuredResponse,
} from "@/lib/ai/auditedOpenAI";
import { AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL } from "@/lib/ai/amoraRequestPolicy";
import { hasOpenAIConfig } from "@/lib/ai/modelConfig";
import { AmoraCostGuardError } from "@/lib/ai/costGuard";
import type { AmoraConflictDetectionCheckpoint } from "@/lib/ai/amoraConflictCheckClaim";
import {
  looksLikeThirdPartyNarrative,
  normalizeConflictText as normalize,
} from "@/lib/ai/conflictSafety";

export { looksLikeThirdPartyNarrative } from "@/lib/ai/conflictSafety";

const MAX_LLM_MESSAGE_CHARS = 800;
const MAX_LLM_INPUT_CHARS = 8_000;

class ConflictVerificationBudgetError extends Error {
  constructor() {
    super("CONFLICT_VERIFICATION_COST_GUARD_REJECTED");
    this.name = "ConflictVerificationBudgetError";
  }
}

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
  /** Provider 직전 원자 예약이 거절되어 LLM을 호출하지 않은 경우. */
  providerBlockedReason?: "cost_guard" | "provider_error";
}

type ConflictVerificationProviderResult =
  AuditedOpenAIStructuredResponse<ConflictVerificationResponse>
  & { providerCheckpoint?: AmoraConflictDetectionCheckpoint };

export type ConflictVerificationProviderRunner = (
  call: (
    beforeGeneration: () => Promise<void>,
  ) => Promise<ConflictVerificationProviderResult>,
) => Promise<ConflictVerificationProviderResult>;

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
  conflictSenderRoles: Set<"bride" | "groom">;
  notes: string[];
}

function runHeuristics(
  coupleMessages: CoupleMessage[],
  pastConflicts: PastConflictSummary[],
): HeuristicResult {
  const notes: string[] = [];
  let score = 0;
  const hitCategories = new Set<string>();
  const conflictSenderRoles = new Set<"bride" | "groom">();
  let conflictMessageCount = 0;
  const conflictMessages: string[] = [];
  let jokingMsgs = 0;
  let thirdPartyMsgs = 0;

  for (const msg of coupleMessages) {
    if (msg.senderRole !== "bride" && msg.senderRole !== "groom") continue;
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

    // 제3자 서술 필터 — 시점 표현이 없어도 점수 무효화
    if (looksLikeThirdPartyNarrative(raw, norm)) {
      thirdPartyMsgs++;
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
    // "응 그래", "됐어" 같은 수동공격 힌트만으로는 그 사람이 갈등에
    // 참여했다고 단정하지 않는다. 최소 하나의 실질 카테고리가 필요하다.
    if ([...msgCategories].some((category) => category !== "passive")) {
      conflictSenderRoles.add(msg.senderRole);
    }
  }

  // 양쪽 모두의 갈등 신호가 있을 때만 가중한다.
  if (
    conflictSenderRoles.has("bride")
    && conflictSenderRoles.has("groom")
  ) {
    score *= 1.5;
    notes.push("양쪽 갈등 발화 ×1.5");
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

  if (thirdPartyMsgs > 0) notes.push(`제3자 서술 제외 ${thirdPartyMsgs}개`);
  if (jokingMsgs > 0) notes.push(`농담 ½ ${jokingMsgs}개`);

  return {
    score: Math.round(score * 10) / 10,
    hitCategories,
    conflictMessageCount,
    conflictMessages,
    conflictSenderRoles,
    notes,
  };
}

// ──────────────────────────────────────────────────────────────
// LLM 검증 (B안) — borderline 만 호출
// ──────────────────────────────────────────────────────────────

interface ConflictVerificationResponse {
  conflict: boolean;
  reason: string;
}

const CONFLICT_VERIFICATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["conflict", "reason"],
  properties: {
    conflict: { type: "boolean" },
    reason: { type: "string", minLength: 1, maxLength: 80 },
  },
};

export function validateConflictVerification(value: unknown): ConflictVerificationResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid conflict verification");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.conflict !== "boolean") throw new Error("invalid conflict flag");
  if (
    typeof record.reason !== "string" ||
    record.reason.trim().length === 0 ||
    record.reason.length > 80
  ) {
    throw new Error("invalid conflict reason");
  }
  return { conflict: record.conflict, reason: record.reason.trim() };
}

async function verifyWithLLM(
  coupleMessages: CoupleMessage[],
  options: {
    reserveProviderTurn?: () => Promise<boolean>;
    runProviderCall?: ConflictVerificationProviderRunner;
  },
  audit?: { coupleId?: string | null; userId?: string | null },
): Promise<{
  isConflict: boolean;
  reason: string;
  providerBlockedReason?: "cost_guard" | "provider_error";
}> {
  if (!hasOpenAIConfig("fast")) {
    return { isConflict: false, reason: "OpenAI 비활성 — LLM 검증 스킵" };
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
      const content = m.content.trim().slice(0, MAX_LLM_MESSAGE_CHARS);
      return `${role}: ${content}`;
    })
    .join("\n")
    .slice(-MAX_LLM_INPUT_CHARS);

  const instructions = `아래 커플 채팅에서 지금 둘 사이에 갈등이 진행 중인지 판단하세요.

판단 기준:
- 진짜 갈등: 두 사람이 서로 의견 대립·비난·감정 표출을 주고받음. 한쪽이 답답해하고 다른 쪽이 방어하거나 무시하는 패턴
- 갈등 아님: 회상(과거·제3자 일 이야기), 농담, 단순 결정 토의, 한쪽 푸념(상대방 향하지 않음), 단순 거절

판단 이유는 한국어 한 줄, 80자 이내로 작성하세요.`;

  const callProvider = (beforeGeneration: () => Promise<void>) =>
    createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      maxInputTokens: AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      maxOutputTokens: 100,
      beforeGeneration,
      auditPersistence: options.runProviderCall
        ? "external_provider_receipt"
        : "internal",
      instructions,
      input: formatted,
      responseFormat: {
        name: "amora_conflict_verification",
        description: "커플의 현재 갈등 진행 여부",
        schema: CONFLICT_VERIFICATION_SCHEMA,
      },
      validate: validateConflictVerification,
      audit: {
        userId: audit?.userId ?? null,
        coupleId: audit?.coupleId ?? null,
        interactionType: "amora_director",
        userInput: null,
        metadata: { source: "conflict_detector_verify" },
      },
    });

  try {
    const res = options.runProviderCall
      ? await options.runProviderCall(callProvider)
      : await callProvider(async () => {
          let providerTurnReserved = false;
          try {
            providerTurnReserved = await options.reserveProviderTurn?.() ?? false;
          } catch {
            // A reservation-store outage must never become an unmetered call.
          }
          if (!providerTurnReserved) throw new ConflictVerificationBudgetError();
        });
    return {
      isConflict: res.data.conflict,
      reason: res.data.reason,
    };
  } catch (error) {
    if (
      error instanceof ConflictVerificationBudgetError
      || error instanceof AmoraCostGuardError
    ) {
      return {
        isConflict: false,
        reason: "비용 가드 예약 실패",
        providerBlockedReason: "cost_guard",
      };
    }
    return {
      isConflict: false,
      reason: "LLM 검증 실패",
      providerBlockedReason: "provider_error",
    };
  }
}

// ──────────────────────────────────────────────────────────────
// 통합 — A + B
// ──────────────────────────────────────────────────────────────

const HARD_TRIGGER_SCORE = 10; // 이 이상이면 LLM 검증 없이 즉시 트리거
const HARD_REJECT_SCORE = 5; // 미만이면 무조건 비-갈등

function getBorderlineReason(score: number, llmReason: string): string {
  return `borderline 점수 ${score} → LLM: ${llmReason}`;
}

export async function detectCoupleConflict(params: {
  coupleId?: string | null;
  userId?: string | null;
  /** 최근 shared visibility 메시지 (시간 오름차순) */
  recentSharedMessages: CoupleMessage[];
  /** 같은 커플의 과거 conflict_resolution decision_nodes */
  pastConflicts: PastConflictSummary[];
  /** 최대 윈도우 (분) — 이 시간 이전 메시지는 무시. 기본 5분 */
  windowMinutes?: number;
  /** 첫 provider 호출 직전 한 번만 실행되고 이후 호출에서 재사용되는 원자 예약. */
  reserveProviderTurn?: () => Promise<boolean>;
  /** Durable per-provider receipt wrapper used by production callers. */
  runProviderCall?: ConflictVerificationProviderRunner;
}): Promise<ConflictDetection> {
  const windowMs = (params.windowMinutes ?? 5) * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  // 윈도우 안 + user 발화만 (AI 메시지 제외)
  const coupleMessages = params.recentSharedMessages.filter(
    (m) =>
      (m.senderRole === "bride" || m.senderRole === "groom") &&
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

  const speakingRoles = new Set(coupleMessages.map((message) => message.senderRole));
  if (!speakingRoles.has("bride") || !speakingRoles.has("groom")) {
    return {
      triggered: false,
      score: 0,
      reason: "양측 발화 부족 — 신부와 신랑의 최근 발화가 모두 필요",
      conflictContext: "",
      llmVerified: false,
    };
  }

  const h = runHeuristics(coupleMessages, params.pastConflicts);

  // 최소 2개 메시지 + 다중 카테고리 또는 fight hit 게이트
  const multiCategoryOk = h.hitCategories.size >= 2 || h.hitCategories.has("fight");
  const bothSidesHaveConflictEvidence =
    h.conflictSenderRoles.has("bride")
    && h.conflictSenderRoles.has("groom");

  // 한 사람의 강한 표현과 상대방의 중립적 답변만으로 자동 중재하지 않는다.
  if (!bothSidesHaveConflictEvidence) {
    return {
      triggered: false,
      score: h.score,
      reason: `양측 갈등 발화 부족 — 갈등 신호 발화자 ${h.conflictSenderRoles.size}/2, ${h.notes.join(", ")}`,
      conflictContext: h.conflictMessages.join(" / "),
      llmVerified: false,
    };
  }

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
  const conflictContext = h.conflictMessages.join(" / ").slice(0, 2_000);
  const runProviderCall = params.runProviderCall
    ? (call: Parameters<ConflictVerificationProviderRunner>[0]) =>
        params.runProviderCall!(async (beforeGeneration) => {
          const response = await call(beforeGeneration);
          return {
            ...response,
            providerCheckpoint: {
              stage: "detection_complete",
              triggered: response.data.conflict,
              score: Math.round(h.score),
              reason: getBorderlineReason(h.score, response.data.reason).slice(0, 2_000),
              conflictContext,
              llmVerified: true,
            },
          };
        })
    : undefined;
  const llm = await verifyWithLLM(coupleMessages, {
    reserveProviderTurn: params.reserveProviderTurn,
    runProviderCall,
  }, {
    coupleId: params.coupleId ?? null,
    userId: params.userId ?? null,
  });
  if (llm.providerBlockedReason) {
    return {
      triggered: false,
      score: h.score,
      reason: `borderline 점수 ${h.score} → ${llm.reason}`,
      conflictContext: h.conflictMessages.join(" / "),
      llmVerified: false,
      providerBlockedReason: llm.providerBlockedReason,
    };
  }
  return {
    triggered: llm.isConflict,
    score: h.score,
    reason: getBorderlineReason(h.score, llm.reason),
    conflictContext,
    llmVerified: true,
  };
}
