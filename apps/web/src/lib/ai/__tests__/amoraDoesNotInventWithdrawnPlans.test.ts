/**
 * 아모라가 **사용자가 말한 적 없는 항목을 "철회한 안"으로 만들어 냈다.**
 *
 * 2026-09-03 2차 팀 테스트 Major 3 / Turn 21: "확정 / 미정 / 철회한 안을 나눠서
 * 요약해줘" 에 확정·미정은 대체로 맞았는데 철회 칸에 폐백 진행, 커플링 외 별도 예물,
 * 집·가구를 총액에 포함이 들어갔다 — 전부 사용자가 꺼낸 적 없는, **지금 정한 것의
 * 반대말**이다.
 *
 * 저장 층에 근거가 없다. 결정 영수증에 `superseded_at` 을 세우는 코드가 없어서
 * "철회 목록" 은 제품 상태가 아니라 모델의 추론이다. 프롬프트에도 철회·폐기 상태를
 * 규율하는 문장이 한 줄도 없었다(`apps/web/src/lib/ai/*.ts` 에서 `철회` 0건).
 *
 * ## 이 파일이 지키는 것
 *
 * 원본 `amoraVoice.ts` 를 grep 하지 않는다. 도구 0개 턴에서는 같은 상수의 일부
 * 구간(`### 도구 실행 뒤 말하는 법` ~ `### 대화의 결 예시`)이 통째로 지워지고,
 * 문맥이 무거우면 꼬리가 잘린다. 그래서 **합성된 프롬프트**에 묻고, 도구 유무·문맥
 * 무게를 바꿔도 **같은 답**이 나오는지 본다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

const BASE = {
  weddingDate: "2027-05-15",
  budget: 62_000_000,
  venue: null,
  progress: {},
  preparationStatus: null,
  brideName: "신부",
  groomName: "신랑",
  senderName: "신부",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  pastConflicts: [],
  pastDecisions: [],
};

/** 문맥이 실제로 상한에 닿는 모양. 가벼운 문맥으로만 재면 절단이 안 보인다. */
const HEAVY = {
  scheduleEvents: Array.from({ length: 40 }, (_, index) => ({
    id: `evt-${index}`,
    title: `일정 ${index} — 예식장 견적 문의와 신혼집 지역 정리`,
    date: "2026-09-01",
    type: "couple_promise",
  })),
  // `chatSummaries` 는 `string[]` 이다. 객체를 넣으면 "[object Object]" 로 렌더돼
  // 길이가 거의 안 늘고, 그러면 절단이 일어나지 않은 채 초록불이 난다.
  chatSummaries: Array.from(
    { length: 30 },
    (_, index) => `요약 ${index}. 예식장 후보와 스드메 견적을 비교한 대화. `.repeat(30),
  ),
};

function compose(
  context: Record<string, unknown>,
  options: Record<string, unknown>,
): string {
  return buildAmoraSystemPrompt({ ...BASE, ...context } as never, {
    requestKind: "chat",
    persistenceMode: "durable",
    ...options,
  } as never) as string;
}

/**
 * 철회 규칙 **한 줄**을 꺼낸다. 프롬프트 전체에 `toContain` 을 걸면 "이전 턴",
 * "비우고" 같은 조각이 다른 자리에서 대신 대답한다.
 */
function withdrawalRuleLine(prompt: string): string {
  return prompt
    .split("\n")
    .find((line) => line.includes("철회·폐기·취소 목록")) ?? "";
}

const VARIANTS: Array<{ label: string; prompt: string }> = [
  {
    label: "운영 도구셋",
    prompt: compose({}, { enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES }),
  },
  {
    label: "도구 0개",
    prompt: compose({}, { enabledToolNames: [] }),
  },
  {
    label: "무거운 문맥 · 상한 48,000자",
    prompt: compose(HEAVY, {
      enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
      maxChars: 48_000,
    }),
  },
  {
    label: "체험(demo) 턴",
    prompt: compose({}, {
      enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
      persistenceMode: "demo",
    }),
  },
];

describe("철회 목록을 지어내지 않는다", () => {
  it("어떤 갈래에서도 규칙이 정확히 한 번 실린다", () => {
    for (const { label, prompt } of VARIANTS) {
      const hits = prompt.split("철회·폐기·취소 목록").length - 1;
      expect(hits, `${label}: 철회 규칙이 ${hits}번 실렸다`).toBe(1);
    }
  });

  it("규칙 한 줄이 세 가지를 모두 시킨다", () => {
    // 하나라도 빠지면 모델은 나머지로 빈칸을 채운다. Turn 21 이 정확히 그랬다 —
    // "실제로 말한 값만" 이 없으면 반대말을 만들고, "비우고 그렇다고 말하세요" 가
    // 없으면 빈 칸을 그냥 지우거나 아무거나 넣는다.
    for (const { label, prompt } of VARIANTS) {
      const line = withdrawalRuleLine(prompt);
      expect(line, `${label}: 실제 발화로 한정하는 조건이 없다`)
        .toContain("실제로 말한 값만");
      expect(line, `${label}: 반대말로 채우는 것을 막지 않는다`)
        .toContain("반대말을 만들어 채우지 마세요");
      expect(line, `${label}: 이전 값이 없을 때 무엇을 할지 없다`)
        .toContain("비우고 그렇다고 말하세요");
    }
  });

  it("절단에 닿지 않는 앞쪽에 있다", () => {
    // `truncateAtLineBoundary` 는 꼬리부터 통째로 자른다. 이 규칙이 날짜 절대 규칙
    // 뒤로 밀리면 문맥이 무거운 커플에게서 조용히 사라진다.
    const { prompt } = VARIANTS[2];
    expect(prompt, "이 표본은 절단 구간에 닿지 않는다 — 아래 단언이 헛돈다")
      .toContain("길이 제한으로 생략됨");
    expect(prompt.indexOf("철회·폐기·취소 목록"))
      .toBeLessThan(prompt.indexOf("🗓 날짜 처리 절대 규칙"));
  });
});
