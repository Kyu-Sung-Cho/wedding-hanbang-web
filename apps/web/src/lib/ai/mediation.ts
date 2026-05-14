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
 * - 4필드 중 일부만 있어도 graceful (있는 것만 채워서 반환).
 * - 본문 텍스트에서 마커 블록은 통째로 제거해서 UI에 노출되지 않게 함.
 *
 * 파싱 실패해도 절대 throw하지 않음 — fallback은 일반 텍스트 그대로.
 */

export interface MediationBlock {
  empathy?: string;
  translation?: string;
  data?: string;
  resolution?: string;
}

const MEDIATION_RE = /\[mediation\]([\s\S]*?)\[\/mediation\]/i;

const FIELD_PATTERNS: Array<{ key: keyof MediationBlock; regex: RegExp }> = [
  { key: "empathy", regex: /^\s*공감\s*[:：]\s*(.+?)\s*$/m },
  { key: "translation", regex: /^\s*통역\s*[:：]\s*(.+?)\s*$/m },
  { key: "data", regex: /^\s*데이터\s*[:：]\s*(.+?)\s*$/m },
  { key: "resolution", regex: /^\s*합의안\s*[:：]\s*(.+?)\s*$/m },
];

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

  // 4필드 모두 비어 있으면 카드로 만들 가치 없음 — null 처리, 본문은 마커 제거만.
  const hasAny = Object.values(block).some((v) => Boolean(v && v.trim()));

  // 마커 블록 제거 + 주변 빈 줄 정리
  const cleanText = text
    .replace(MEDIATION_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    cleanText,
    mediation: hasAny ? block : null,
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
