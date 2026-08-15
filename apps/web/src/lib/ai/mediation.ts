/**
 * 커플 갈등 중재 응답에 포함되는 [mediation]...[/mediation] 마커 블록을
 * 안전하게 파싱·제거하는 헬퍼.
 *
 * 시스템 프롬프트(prompts.ts의 "갈등 중재 응답 형식") 명세에 따라:
 *   [mediation]
 *   공감: ...
 *   통역: ...
 *   데이터: ...
 *   합의안: ...
 *   [/mediation]
 *
 * - 마커가 없으면 그대로 통과 (null 반환).
 * - 4필드가 모두 검증된 경우에만 승인 가능한 카드 데이터로 반환.
 * - 일부 필드만 있으면 마커를 제거한 일반 텍스트로 강등.
 * - 본문 텍스트에서 마커 블록은 통째로 제거해서 UI에 노출되지 않게 함.
 *
 * 파싱 실패해도 절대 throw하지 않음 — fallback은 일반 텍스트 그대로.
 */

import { AMORA_REQUESTER_SUMMARY_MEDIATION } from "@hanbang/shared/mediation-provenance";
import {
  screenAmoraTrustClaims,
  type AmoraTrustClaimKind,
} from "./amoraTrustClaims";
import {
  findMediationNeutralityViolations,
  type MediationNeutralityViolationKind,
} from "./mediationNeutrality";

export interface MediationBlock {
  empathy?: string;
  translation?: string;
  data?: string;
  resolution?: string;
}

// 표식 자체는 공유 계약에 둔다. 앱도 같은 기준으로 "이 초안이 누구 말인가"를
// 판별해야 하는데, 각자 갖고 있으면 한쪽만 고쳐진다.
export const AMORA_USER_REQUESTED_MEDIATION_V2 = AMORA_REQUESTER_SUMMARY_MEDIATION;

export const AMORA_MEDIATION_OUTPUT_GUARD_FALLBACK =
  "지금 내용만으로는 어느 한쪽의 잘잘못이나 속마음을 단정하지 않고 정리하는 게 중요해요. 각자 확인된 사실과 원하는 기준을 한 가지씩 적어 주세요. 그 내용을 바탕으로 두 사람이 함께 고를 수 있는 선택지로 다시 정리해 드릴게요.";

export type UserRequestedMediationV2 = Required<MediationBlock>
  & typeof AMORA_USER_REQUESTED_MEDIATION_V2;

const MAX_MEDIATION_FIELD_CHARS = 500;

const MEDIATION_RE = /\[mediation\]([\s\S]*?)\[\/mediation\]/i;

const FIELD_PATTERNS: Array<{ key: keyof MediationBlock; regex: RegExp }> = [
  { key: "empathy", regex: /^\s*공감\s*[:：]\s*(.+?)\s*$/m },
  { key: "translation", regex: /^\s*통역\s*[:：]\s*(.+?)\s*$/m },
  { key: "data", regex: /^\s*데이터\s*[:：]\s*(.+?)\s*$/m },
  { key: "resolution", regex: /^\s*합의안\s*[:：]\s*(.+?)\s*$/m },
];

const FIELD_LABELS: Record<keyof MediationBlock, string> = {
  empathy: "공감",
  translation: "통역",
  data: "데이터",
  resolution: "합의안",
};

function isCompleteMediationBlock(
  block: MediationBlock,
): block is Required<MediationBlock> {
  return FIELD_PATTERNS.every(({ key }) => Boolean(block[key]?.trim()));
}

/**
 * 카드 네 필드를 아모라 출력 검사층에 통과시킨다.
 *
 * `extractMediation`이 `[mediation]` 블록을 본문에서 잘라내기 때문에, 본문을 보는
 * 검사층(`composeAmoraPersistenceTerminal`)은 카드 안을 한 번도 보지 못했다. 그래서
 * 보증("100% 문제 없어요"), 비교 압박("다른 커플들은 보통 …"), 사람에 대한 판정
 * ("두 분은 잘 맞아요"), 그리고 반영되지 않은 저장 주장("예산 3천만원으로
 * 저장해뒀어요")이 카드 안에서는 그대로 살아남아 양쪽에게 저장됐다. 중재 카드는
 * 수락하면 공동 결정으로 기록되므로, 검사를 건너뛰기에 가장 나쁜 자리였다.
 *
 * 검사로 필드가 통째로 비면 카드를 만들지 않는다(`isCompleteMediationBlock` 실패).
 * 걸러낸 문장을 기워 붙인 카드보다 카드가 없는 편이 안전하다.
 */
export function screenMediationBlock(block: MediationBlock): {
  block: MediationBlock;
  removedKinds: AmoraTrustClaimKind[];
  neutralityViolations: MediationNeutralityViolationKind[];
} {
  const screened: MediationBlock = {};
  const removedKinds = new Set<AmoraTrustClaimKind>();
  const neutralityViolations = new Set<MediationNeutralityViolationKind>();

  for (const { key } of FIELD_PATTERNS) {
    const value = block[key];
    if (typeof value !== "string" || !value.trim()) continue;
    for (const kind of findMediationNeutralityViolations(value)) {
      neutralityViolations.add(kind);
    }
    const result = screenAmoraTrustClaims(value);
    for (const kind of result.removedKinds) removedKinds.add(kind);
    if (result.text) screened[key] = result.text;
  }

  return {
    // 편향 문장 하나만 지워서는 남은 필드에 같은 결론이 유지될 수 있다.
    // 그래서 중립성 위반은 문장이 아니라 카드 전체를 닫는다.
    block: neutralityViolations.size > 0 ? {} : screened,
    removedKinds: [...removedKinds],
    neutralityViolations: [...neutralityViolations],
  };
}

export function toUserRequestedMediationV2(
  block: MediationBlock,
): UserRequestedMediationV2 | null {
  const { block: screened } = screenMediationBlock(block);
  if (!isCompleteMediationBlock(screened)) return null;
  return { ...screened, ...AMORA_USER_REQUESTED_MEDIATION_V2 };
}

export function mediationBlockToOrdinaryText(block: MediationBlock): string {
  return FIELD_PATTERNS
    .flatMap(({ key }) => block[key] ? [`${FIELD_LABELS[key]}: ${block[key]}`] : [])
    .join("\n\n");
}

export function readUserRequestedMediationV2(
  value: unknown,
): UserRequestedMediationV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.origin !== AMORA_USER_REQUESTED_MEDIATION_V2.origin
    || candidate.evidenceScope !== AMORA_USER_REQUESTED_MEDIATION_V2.evidenceScope
    || candidate.schemaVersion !== AMORA_USER_REQUESTED_MEDIATION_V2.schemaVersion
  ) return null;

  const block: MediationBlock = {};
  for (const { key } of FIELD_PATTERNS) {
    const field = candidate[key];
    if (typeof field !== "string") return null;
    const normalized = field.trim();
    if (!normalized || normalized.length > MAX_MEDIATION_FIELD_CHARS) return null;
    block[key] = normalized;
  }
  return toUserRequestedMediationV2(block);
}

/**
 * 응답 텍스트에서 mediation 블록을 추출.
 * 추출된 4필드 + 마커 제거된 텍스트 반환.
 */
export function extractMediation(text: string): {
  cleanText: string;
  mediation: MediationBlock | null;
} {
  if (typeof text !== "string" || !text) return { cleanText: text ?? "", mediation: null };

  const match = MEDIATION_RE.exec(text);
  if (!match) return { cleanText: text, mediation: null };

  const inner = match[1] ?? "";
  const block: MediationBlock = {};

  for (const { key, regex } of FIELD_PATTERNS) {
    const fieldMatch = regex.exec(inner);
    if (fieldMatch && fieldMatch[1]) {
      const value = fieldMatch[1].trim();
      if (value && value.length <= 500) {
        block[key] = value;
      }
    }
  }

  // 마커 블록 제거 + 주변 빈 줄 정리
  const cleanText = text
    .replace(MEDIATION_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!isCompleteMediationBlock(block)) {
    const ordinaryText = mediationBlockToOrdinaryText(block);
    return {
      cleanText: [cleanText, ordinaryText].filter(Boolean).join("\n\n"),
      mediation: null,
    };
  }

  return {
    cleanText,
    mediation: block,
  };
}

/**
 * 스트리밍 중 partial text에서 마커가 부분적으로 보일 수 있음.
 * 진행 중 텍스트는 마커 시작(`[mediation]` 또는 `[mediat`까지)이 보이는 순간부터
 * 잘라서 보여주면 UI에 raw 마커가 노출되지 않음.
 */
export function stripStreamingMediation(text: string): string {
  if (!text) return text;
  const idx = text.search(/\[m(ediation)?$|\[mediation\]/i);
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}
