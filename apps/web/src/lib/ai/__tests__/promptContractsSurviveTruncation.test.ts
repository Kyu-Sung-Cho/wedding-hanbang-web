import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 자리가 모자라도 제품 계약은 잘리지 않는다.
 *
 * ## 무엇이 문제였나 (2026-08-30 실측)
 *
 * 절단은 `truncateAtLineBoundary` 가 **꼬리부터 통째로** 자른다. 그런데 계약
 * 섹션이 전부 문서 뒤쪽에 몰려 있다 — 읽기 도구셋에서 앞쪽 네 덩어리(대화 원칙·
 * 커플 상황·준비 항목·사고방식)가 26,862자를 쓰고, 계약 아홉은 31,996자 지점부터
 * 끝까지 6,620자다. 전체 47,401자에 상한이 48,000자라 **여유가 599자**뿐이다.
 *
 * 그래서 기억이든 도구 계약이든 조금만 늘면 계약부터 조용히 사라진다. 보호 목록을
 * 원래대로(2개) 두고 기억을 채워 재면:
 *
 *     헤딩 21 -> 8 · 계약 2/11 · [suggestions] 없음
 *
 * 없어진 것 중에 `## 커플 갈등 중재`, `## 출처 표기`, `## 공시 가격 사용 규칙`,
 * `## 업체·계약 상담 안전 원칙`, 그리고 메시지 타겟 판별이 든 `## 대화 규칙` 이
 * 있었다. 마지막 것이 없으면 아모라가 커플끼리 하는 대화에 끼어든다.
 *
 * ## 무엇을 지키나
 *
 * 자리가 없을 때 잘려야 하는 것은 계약이 아니라 참조표다. `## 준비 항목에서
 * 확인할 것`(9,163자)은 프롬프트가 이미 "여기 없는 항목의 확인 포인트를 지어내지
 * 말고 무엇을 물어보면 되는지만 제안하라"고 적어 두어 없어도 안전하게 물러선다.
 *
 * 이 테스트는 `PRODUCT_SAFETY_HEADINGS` 에서 항목을 빼면 실패한다 — 아홉을
 * 한꺼번에 되돌리면 기억 가득 경우가 2/11 로 떨어진다.
 */

const CONTRACT_HEADINGS = [
  "## 판정 금지 · 업체 상대 발언 금지",
  "## 할루시네이션 방지",
  "## 공시 가격 사용 규칙",
  "## 견적의 포함·불포함 확인 원칙",
  "## 업체·계약 상담 안전 원칙",
  "## 업체 추천·예약은 지금 제공하지 않습니다",
  "## 출처 표기 (Source Citation) — 사용자 신뢰의 핵심",
  "## 대화 규칙",
  "## 커플 갈등 중재",
  "## 요청 기반 조율 (MEDIATION_REQUEST)",
  "## 이어서 할 수 있는 것 (선택)",
] as const;

/** 운영이 실제로 넘기는 집합 — 쓰기 도구는 `!isMutatingTool` 로 걸러진다. */
const PRODUCTION_READ_TOOLS = BETA_SAFE_TOOLS
  .map((tool) => tool.name)
  .filter((name) => !isMutatingTool(name));

/** 투영 상한(`AMORA_PROFILE_FIELD_MAX_CHARS`)까지 채운 기억. */
const SATURATED_FIELD = "가".repeat(2_000);
const SATURATED_PROFILE = {
  personaSummary: SATURATED_FIELD,
  budgetPosture: SATURATED_FIELD,
  decisionStyle: SATURATED_FIELD,
  tasteProfile: SATURATED_FIELD,
  communicationStyle: SATURATED_FIELD,
  conflictPattern: SATURATED_FIELD,
  sensitiveTopics: [SATURATED_FIELD],
  recommendationRules: [SATURATED_FIELD],
  openQuestions: [SATURATED_FIELD],
  confidenceScore: 0.9,
};

function promptContext(extra: Record<string, unknown> = {}) {
  return {
    weddingDate: "2027-05-15",
    budget: 50_000_000,
    venue: null,
    progress: {},
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
    ...extra,
  } as never;
}

function build(tools: readonly string[], extra: Record<string, unknown> = {}) {
  return buildAmoraSystemPrompt(promptContext(extra), {
    enabledToolNames: tools,
    requestKind: "chat",
    persistenceMode: "durable",
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);
}

const CASES: Array<[string, readonly string[], Record<string, unknown>]> = [
  ["도구 0개", [], {}],
  ["운영 읽기 도구", PRODUCTION_READ_TOOLS, {}],
  ["전체 도구", BETA_SAFE_TOOLS.map((tool) => tool.name), {}],
  ["읽기 도구 + 기억 상한까지", PRODUCTION_READ_TOOLS, {
    amoraProfiles: { shared: SATURATED_PROFILE, private: SATURATED_PROFILE },
  }],
];

describe("제품 계약은 길이 예산에 밀려 사라지지 않는다", () => {
  for (const [label, tools, extra] of CASES) {
    const prompt = build(tools, extra);

    it(`${label} — 계약 ${CONTRACT_HEADINGS.length}개가 전부 남는다`, () => {
      const missing = CONTRACT_HEADINGS.filter((heading) => !prompt.includes(heading));
      expect(missing, `사라진 계약: ${missing.join(" / ")}`).toEqual([]);
    });

    it(`${label} — [suggestions] 출력 계약이 남는다`, () => {
      expect(prompt).toContain("[suggestions]");
    });

    it(`${label} — 상한을 넘지 않는다`, () => {
      expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
    });
  }
});

describe("기억이 가득 차도 계약이 먼저 잘리지 않는다", () => {
  // 이 경우가 이 파일의 핵심이다. 보호 목록이 2개뿐이던 시절 여기서 계약 9개가
  // 한꺼번에 사라졌다(헤딩 21 -> 8).
  const saturated = build(PRODUCTION_READ_TOOLS, {
    amoraProfiles: { shared: SATURATED_PROFILE, private: SATURATED_PROFILE },
  });

  it("기억이 실제로 실렸다 — 이게 아니면 위 단언이 헛초록불이다", () => {
    expect(saturated).toContain("## 사용자가 명시한 맞춤 정보");
    expect(saturated.length).toBeGreaterThan(build(PRODUCTION_READ_TOOLS).length);
  });

  it("잘리는 쪽은 참조표·안내다", () => {
    // 없어도 안전하게 물러설 수 있는 것들만 사라져야 한다.
    const headings = new Set(saturated.match(/^## .*/gm) ?? []);
    for (const heading of CONTRACT_HEADINGS) {
      expect(headings.has(heading), `계약이 잘렸다: ${heading}`).toBe(true);
    }
  });
});
