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
  it("큰 변화 뒤 이유를 들으면 이미 답한 유지 조건 대신 다음 확인으로 이어간다", () => {
    for (const { label, prompt } of VARIANTS) {
      const rolesStart = prompt.indexOf("### 먼저 이번 턴의 역할 하나를 고르기");
      const rolesEnd = prompt.indexOf("### 순서를 말할 때는", rolesStart);
      const listeningStart = prompt.indexOf("### 듣는 방식");
      const listeningEnd = prompt.indexOf("### 자연스러운 말투", listeningStart);
      expect(rolesStart, label).toBeGreaterThan(-1);
      expect(rolesEnd, label).toBeGreaterThan(rolesStart);
      expect(listeningStart, label).toBeGreaterThan(-1);
      expect(listeningEnd, label).toBeGreaterThan(listeningStart);
      const roles = prompt.slice(rolesStart, rolesEnd);
      const listening = prompt.slice(listeningStart, listeningEnd);
      expect(roles, label).toContain("이유가 비어 있는 큰 실무 방향 전환");
      expect(roles, label).toContain("새 취향 질문 전에 바뀐 이유를 한 번");
      expect(listening, label).toContain("바꾼 부분만 대화 기준에 반영");
      expect(listening, label).toContain("이유를 이미 말했으면 다시 묻지");
      expect(listening, label).toContain("알려진 조건의 유지 여부를 되묻거나 새 공동 합의로 만들지");
      expect(listening, label).toContain("인원·장소에 따른 식사 구성·최소 인원·견적");
      expect(listening, label).toContain("다음 행동 한 가지는 우선순위");
      expect(listening, label).toContain("그것만 하면 되거나 다른 준비가 필요 없다는 뜻이 아닙니다");
    }
  });

  it("쉬운말로 풀어도 사용자가 정한 항목의 원명칭과 범위를 보존한다", () => {
    for (const { label, prompt } of VARIANTS) {
      const line = prompt.split("\n").find(value => value.includes("원명칭과 범위를 유지")) ?? "";
      expect(line, label).toContain("예단 생략을 모든 가족 선물 생략으로");
      expect(line, label).toContain("폐백 생략을 감사 인사 생략으로");
      expect(line, label).toContain("확대하지 마세요");
      expect(line, label).toContain("명시적으로 더 넓게 정했다면 그 범위");
    }
  });

  it("요청받은 상태 요약에서 거부 조건과 결정 상태·전달 여부를 섞지 않는다", () => {
    for (const { label, prompt } of VARIANTS) {
      const line = prompt.split("\n").find(value => value.includes("상태 요약을 요청하면")) ?? "";
      expect(line, label).toContain("선호와 거부 조건을 함께");
      expect(line, label).toContain("확정·가설·미정과 상대에게 전달했는지는 따로 구분");
      expect(line, label).toContain("미정은 미전달의 증거가 아닙니다");
      expect(line, label).toContain("확인되지 않으면 미확인");
      expect(line, label).not.toMatch(/항상|반드시.*표/u);
    }
  });

  it("단순 선호 변경은 저장 약속으로 바꾸지 않되 명시 실행 요청은 유지한다", () => {
    for (const { label, prompt } of VARIANTS) {
      const line = prompt.split("\n").find(value => value.startsWith("- **실행**:")) ?? "";
      expect(line, label).toContain("저장·수정·조회·문구 작성처럼 할 일이 분명하면");
      expect(line, label).toContain("실행 뒤에는 실제 반영 여부를 확인");
      expect(line, label).toContain("단순 선호·후보만 달라지면 대화 기준으로");
      expect(line, label).toContain("저장 요청이 없는 턴에 저장 약속·실패 안내를 만들지");
    }
  });

  it("저장 실패·대기와 사용자의 계획 철회를 구분한다", () => {
    for (const { label, prompt } of VARIANTS) {
      const line = prompt.split("\n").find(value => value.includes("저장 실패·확인 대기")) ?? "";
      expect(line, label).toContain("사용자의 철회가 아닙니다");
      expect(line, label).toContain("아직 반영되지 않은 요청");
    }
  });
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
