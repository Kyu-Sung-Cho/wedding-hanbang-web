// =============================================
// Excavation Technique Classifier — 아모라 선호 발굴 기법 사용 로깅
// =============================================
// 목적: /api/chat 턴 종료 후 저비용 OpenAI 모델로 "아모라 응답이 5가지 Excavation 기법 중 무엇을 썼나?"
//       → ai_interactions_log.metadata.excavation_technique 에 기록
// 5가지 기법 (prompts.ts와 1:1 매칭):
//   1. constraint_first        — 제약 먼저 (싫어하는 것 먼저 묻기)
//   2. hypothetical_forcing    — 강제 2지선다 (극단 2개 비교)
//   3. counterfactual_probing  — 감정 역행 질문 (결과 → 원인 역추적)
//   4. friction_free_proxy     — 간접 추출 (작고 구체적인 1가지 질문)
//   5. longitudinal_pattern    — 시간 변화 감지 (과거 vs 현재 선호 대비)
//   null — 해당 없음
// 특징:
//   - Fire-and-forget (main chat flow 비차단)
//   - INITIAL_GREETING / MEDIATION_REQUEST / [quote_analysis] 스킵
//   - JSON 실패 → null 로 기록
//   - 예외 전부 내부 삼킴
// =============================================

import { createOpenAIStructuredResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import type { StageTag } from "@/types/moat.types";

const MAX_USER_CHARS = 400;
const MAX_AI_CHARS = 1_200;

const ALLOWED_TECHNIQUES = [
  "constraint_first",
  "hypothetical_forcing",
  "counterfactual_probing",
  "friction_free_proxy",
  "longitudinal_pattern",
] as const;
type Technique = (typeof ALLOWED_TECHNIQUES)[number];

// -------------------------------------------
// 저비용 모델 분류기
// -------------------------------------------
const CLASSIFY_SYSTEM_PROMPT = `당신은 웨딩 AI "아모라"의 응답이 5가지 "선호 발굴(Excavation)" 기법 중 어떤 것을 사용했는지 판별하는 JSON 분류기입니다.

[기법 정의]
1. constraint_first — 제약 먼저: "좋아하는 것" 대신 "피하고 싶은 것 / 싫은 것 / 별로인 것"을 먼저 묻는 질문.
   신호어: "피하고 싶은", "별로", "싫은", "아닌 것", "절대 ~하기 싫은"

2. hypothetical_forcing — 강제 2지선다: 무한 옵션 대신 극단적 2개 가상 시나리오 비교 제시.
   신호어: "만약 A면 / 반대로 B면", "5천이면 / 2천이면", "둘 중에 고른다면", "극단적으로"

3. counterfactual_probing — 감정 역행 질문: 결과/미래 장면을 상상하게 한 뒤 원인·가치관 역추적.
   신호어: "결혼식 다음날 아침", "10년 뒤 앨범", "~했을 때 기억에 남을", "어디서 눈뜨면"

4. friction_free_proxy — 간접 추출: 크고 부담스러운 질문 대신 작고 구체적인 1가지 질문.
   신호어: "딱 1가지만", "하나만 고른다면", "단 한 개만", "가장 ~한 하나"

5. longitudinal_pattern — 시간 변화 감지: 과거 발언·결정과 지금을 대비하며 변화 원인을 묻는 질문.
   신호어: "지난번엔", "3개월 전엔", "예전엔 ~셨는데 지금은", "처음엔 ~였는데 바뀌신"

[없음]
아모라 응답이 일반 답변·정보 제공·추천·공감·도구 사용 안내 등이고 위 5기법 중 어느 것도 아니면 null.

[판별 규칙]
- 사용자가 이미 명확한 답을 줬고 아모라가 바로 답만 한 경우 → null
- 아모라가 여러 기법을 섞으면 가장 **뚜렷하게 드러난 하나**만 선택
- 애매하면 null (오탐보다 미탐이 안전)
- confidence < 0.6 이면 null로 응답

JSON으로만 응답 (설명·코드블록 금지):
{
  "technique": "constraint_first" | "hypothetical_forcing" | "counterfactual_probing" | "friction_free_proxy" | "longitudinal_pattern" | null,
  "confidence": 0.0,
  "evidence": "판별 근거 (응답에서 인용한 1문장, 50자 이내)"
}`;

interface ClassifyResult {
  technique: Technique | null;
  confidence: number;
  evidence: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

const CLASSIFY_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["technique", "confidence", "evidence"],
  properties: {
    technique: {
      anyOf: [
        { type: "string", enum: [...ALLOWED_TECHNIQUES] },
        { type: "null" },
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      anyOf: [
        { type: "string", maxLength: 50 },
        { type: "null" },
      ],
    },
  },
};

export function validateExcavationClassification(value: unknown): Omit<ClassifyResult, "usage"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid excavation classification");
  }
  const record = value as Record<string, unknown>;
  const technique = record.technique;
  const confidence = record.confidence;
  const evidence = record.evidence;
  if (
    technique !== null &&
    (typeof technique !== "string" ||
      !(ALLOWED_TECHNIQUES as readonly string[]).includes(technique))
  ) {
    throw new Error("invalid excavation technique");
  }
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error("invalid excavation confidence");
  }
  if (evidence !== null && (typeof evidence !== "string" || evidence.length > 50)) {
    throw new Error("invalid excavation evidence");
  }
  return {
    technique:
      confidence >= 0.6 && typeof technique === "string"
        ? (technique as Technique)
        : null,
    confidence,
    evidence: typeof evidence === "string" ? evidence : null,
  };
}

async function classifyWithOpenAI(
  userText: string,
  aiText: string,
  audit: { userId?: string | null; coupleId: string; stageTag?: StageTag | null }
): Promise<ClassifyResult | null> {
  try {
    const truncatedUser =
      userText.length > MAX_USER_CHARS ? userText.slice(0, MAX_USER_CHARS) + "…" : userText;
    const truncatedAi =
      aiText.length > MAX_AI_CHARS ? aiText.slice(0, MAX_AI_CHARS) + "…" : aiText;

    const conversation = `사용자: ${truncatedUser}\n\n아모라: ${truncatedAi}`;

    const response = await createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      maxOutputTokens: 200,
      instructions: CLASSIFY_SYSTEM_PROMPT,
      input: conversation,
      responseFormat: {
        name: "amora_excavation_classification",
        description: "아모라 응답에 사용된 선호 발굴 기법 분류",
        schema: CLASSIFY_RESPONSE_SCHEMA,
      },
      validate: validateExcavationClassification,
      audit: {
        userId: audit.userId ?? null,
        coupleId: audit.coupleId,
        interactionType: "chat_turn",
        userInput: null,
        metadata: {
          endpoint: "chat/classify-excavation",
          stage_tag: audit.stageTag ?? null,
        },
      },
    });

    return {
      ...response.data,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  } catch (err) {
    console.error("[classify-excavation] OpenAI 호출 실패:", err);
    return null;
  }
}

// -------------------------------------------
// 공개 헬퍼: maybeClassifyExcavation
// -------------------------------------------
export interface MaybeClassifyExcavationInput {
  coupleId: string;
  userId?: string | null;
  lastUserText: string;
  aiResponseText: string;
  stageTag?: StageTag | null;
}

export async function maybeClassifyExcavation(
  input: MaybeClassifyExcavationInput
): Promise<void> {
  try {
    const userText = input.lastUserText.trim();
    const aiText = input.aiResponseText.trim();
    if (!userText || !aiText) return;
    if (userText.includes("[INITIAL_GREETING]")) return;
    if (userText.includes("[MEDIATION_REQUEST]")) return;
    if (userText.includes("[quote_analysis]")) return;

    // AI 응답이 너무 짧으면 기법 적용 가능성 낮음 (도구 카드 트리거, 단답 등)
    if (aiText.length < 30) return;

    const result = await classifyWithOpenAI(userText, aiText, {
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      stageTag: input.stageTag ?? null,
    });
    if (!result) return;
  } catch (err) {
    console.error("[classify-excavation] 예외 (무시):", err);
  }
}
