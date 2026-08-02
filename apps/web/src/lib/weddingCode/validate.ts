// CANDIDATE4_RETIRED: containment-only legacy; never import from Candidate 5 research code.
// 웨딩코드 응답 제출 검증 — 시스템 경계(API)에서 스키마를 강제한다.
// 프로토타입이라도 쓰레기 데이터가 스모크 판독을 오염시키면 테스트 전체가 무효가 되므로
// enum·범위·길이를 전부 잠근다. 채점은 결과 화면에서 클라이언트 참고용으로만 수행한다.

import {
  WC_STAGES,
  WC_ANSWERING_MODES,
  WC_QUOTE_STATUSES,
  WC_PARENT_INVOLVEMENTS,
  WC_CONCERNS,
  WC_FEEDBACK_ITEMS,
  WC_CTA_ITEMS,
  WC_FREE_TEXT_ITEMS,
} from "@/constants/weddingCodeForm";
import { WEDDING_CODE_V05_QUESTIONS } from "@/constants/weddingCodeV05";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";
import { sanitizeUtmFields } from "@/utils/campaignAttribution";

const OPTION_VALUES = new Set(["A", "B", "C", "D"]);
const STAGE_SET = new Set<string>(WC_STAGES.map((s) => s.value));
const MODE_SET = new Set<string>(WC_ANSWERING_MODES.map((s) => s.value));
const QUOTE_SET = new Set<string>(WC_QUOTE_STATUSES.map((s) => s.value));
const PARENT_SET = new Set<string>(WC_PARENT_INVOLVEMENTS.map((s) => s.value));
const CONCERN_SET = new Set<string>(WC_CONCERNS);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface WcSubmission {
  participant_stage: string;
  answering_mode: string;
  quote_status: string;
  parent_involvement: string;
  biggest_concern: string[];
  biggest_concern_other: string | null;
  answers: Record<string, string>;
  stage_flags: Record<string, string>;
  feedback: Record<string, number>;
  cta_interest: Record<string, number>;
  free_text: Record<string, string>;
  duration_ms: number | null;
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null };
  /** 파트너 유입(?ct=) 페어링 토큰 — UUID v4만 허용, 형식 오류는 제출 거부가 아니라 무시(null) */
  couple_token: string | null;
}

export function validateWcSubmission(
  body: unknown
): { ok: true; data: WcSubmission } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "잘못된 요청입니다." };
  if (body.consent !== true) return { ok: false, error: "참여 동의가 필요합니다." };

  const stage = typeof body.participant_stage === "string" ? body.participant_stage : "";
  if (!STAGE_SET.has(stage)) return { ok: false, error: "준비 단계를 선택해주세요." };
  const mode = typeof body.answering_mode === "string" ? body.answering_mode : "";
  if (!MODE_SET.has(mode)) return { ok: false, error: "답변 방식을 선택해주세요." };
  const quote = typeof body.quote_status === "string" ? body.quote_status : "";
  if (!QUOTE_SET.has(quote)) return { ok: false, error: "견적 경험을 선택해주세요." };
  const parent = typeof body.parent_involvement === "string" ? body.parent_involvement : "";
  if (!PARENT_SET.has(parent)) return { ok: false, error: "가족 관여도를 선택해주세요." };

  const concerns = Array.isArray(body.biggest_concern)
    ? body.biggest_concern.filter((c): c is string => typeof c === "string" && CONCERN_SET.has(c)).slice(0, 9)
    : [];
  const concernOther =
    typeof body.biggest_concern_other === "string"
      ? sanitizeText(body.biggest_concern_other).slice(0, 200).trim() || null
      : null;

  // v0.5: 16문항 모두 필수. stage_flags는 구버전 호환 저장 필드라 있으면 정화만 한다.
  const rawAnswers = isRecord(body.answers) ? body.answers : {};
  const rawFlags = isRecord(body.stage_flags) ? body.stage_flags : {};
  const answers: Record<string, string> = {};
  const stageFlags = Object.create(null) as Record<string, string>;

  for (const q of WEDDING_CODE_V05_QUESTIONS) {
    const v = rawAnswers[q.key];
    if (v === undefined || v === null || v === "") {
      return { ok: false, error: "필수 문항에 모두 답해주세요." };
    }
    if (typeof v !== "string" || !OPTION_VALUES.has(v)) {
      return { ok: false, error: "답변 값이 올바르지 않습니다." };
    }
    answers[q.key] = v;
  }
  for (const [key, value] of Object.entries(rawFlags)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    const cleanedKey = sanitizeText(key).slice(0, 40).trim();
    const cleanedValue = sanitizeText(value).slice(0, 40).trim();
    if (cleanedKey && cleanedValue && !UNSAFE_OBJECT_KEYS.has(cleanedKey)) {
      stageFlags[cleanedKey] = cleanedValue;
    }
  }

  const feedback = readScales(body.feedback, WC_FEEDBACK_ITEMS.map((f) => f.key));
  if (!feedback) return { ok: false, error: "피드백 값이 올바르지 않습니다." };
  const cta = readScales(body.cta_interest, WC_CTA_ITEMS.map((f) => f.key));
  if (!cta) return { ok: false, error: "관심도 값이 올바르지 않습니다." };

  const freeText: Record<string, string> = {};
  const rawFree = isRecord(body.free_text) ? body.free_text : {};
  for (const item of WC_FREE_TEXT_ITEMS) {
    const v = rawFree[item.key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return { ok: false, error: "피드백 형식이 올바르지 않습니다." };
    const cleaned = sanitizeText(v).slice(0, 1000).trim();
    if (cleaned) freeText[item.key] = cleaned;
  }

  const durationRaw = Number(body.duration_ms);
  const duration =
    Number.isFinite(durationRaw) && durationRaw > 0 && durationRaw < 6 * 60 * 60 * 1000
      ? Math.round(durationRaw)
      : null;

  const utm = sanitizeUtmFields({
    source: body.utm_source,
    medium: body.utm_medium,
    campaign: body.utm_campaign,
    content: body.utm_content,
  });

  return {
    ok: true,
    data: {
      participant_stage: stage,
      answering_mode: mode,
      quote_status: quote,
      parent_involvement: parent,
      biggest_concern: concerns,
      biggest_concern_other: concernOther,
      answers,
      stage_flags: stageFlags,
      feedback,
      cta_interest: cta,
      free_text: freeText,
      duration_ms: duration,
      utm,
      // 잘못된 토큰으로 테스트 자체를 막지 않는다 — 페어링만 조용히 포기
      couple_token: isUuid(body.couple_token) ? (body.couple_token as string) : null,
    },
  };
}

// 1~5 정수 척도 묶음 읽기 — 미응답 키는 생략 허용, 값이 있으면 범위 강제
function readScales(raw: unknown, keys: readonly string[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  const obj = isRecord(raw) ? raw : {};
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) return null;
    out[key] = n;
  }
  return out;
}
