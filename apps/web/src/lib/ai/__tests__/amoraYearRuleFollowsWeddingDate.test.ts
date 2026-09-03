/**
 * 같은 프롬프트가 연도를 두고 **서로 반대를 요구했다.**
 *
 * 2026-08-24 1차 팀 테스트 Major 4: 사용자가 Turn 2 에서 "내년 가을쯤" 이라 했고
 * 아모라도 그 턴에는 "2027년 9~11월" 이라 맞게 받았다. 그런데 열일곱 턴 뒤
 * "날짜 후보는 9월보다 10월이 더 좋아" 에 **"2026년 10월 후보 날짜를 예식장에
 * 전달하세요"** 라고 답했다.
 *
 * 방어는 이미 있었다 — `## 커플 상황` 의 미정 갈래가 "월·계절만 들었을 때 연도를
 * 스스로 정하지 마세요" 를 싣는다(`unsetDateDoesNotInventAYear.test.ts` 가 고정).
 * 그런데 `**🗓 날짜 처리 절대 규칙**` 블록은 결혼 예정일 유무와 무관하게 늘
 * "올해 남은 달 안이면 올해로 해석합니다" 를 실었다. 오늘이 9월이고 사용자가
 * "10월" 이라 했으니 **절대 규칙이 오답 그대로를 지시했다.**
 *
 * 두 문장이 각각 다른 테스트로 **문자열 존재만** 고정돼 있어 모순 자체는 아무도
 * 재지 않았다. 그래서 이 파일은 존재가 아니라 **갈래**를 잰다 — 결혼 예정일 하나만
 * 바꾼 두 합성 프롬프트를 나란히 놓고, 두 규칙이 한 프롬프트에 함께 있지 않은지 본다.
 *
 * 일정·예약 날짜의 "가장 가까운 미래" 해석은 두 갈래 모두에 남아야 한다. 통째로
 * 빼면 2026-08-23 실측 오류("9월 20일"을 이미 지난 날짜라고 답함)가 되살아난다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

const BASE = {
  weddingDate: null as string | null,
  budget: 50_000_000,
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

const compose = (weddingDate: string | null): string =>
  buildAmoraSystemPrompt({ ...BASE, weddingDate } as never, {
    enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
    requestKind: "chat",
    persistenceMode: "durable",
    maxChars: 48_000,
  } as never) as string;

/** 날짜 절대 규칙 블록만 잘라낸다. 프롬프트 전체에 물으면 다른 절이 대신 답한다. */
function dateRuleBlock(prompt: string): string {
  const start = prompt.indexOf("**🗓 날짜 처리 절대 규칙 (어기지 말 것)**");
  expect(start, "날짜 절대 규칙 블록이 합성 결과에 없다").toBeGreaterThan(-1);
  const end = prompt.indexOf("\n\n", start);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

const UNDATED = compose(null);
const DATED = compose("2027-10-10");

/** 연도 없는 달을 올해로 못 박는 절대 규칙. 미정 커플에게는 오답을 지시한다. */
const ASSUMES_THIS_YEAR = "그 날짜는 **미래**이고,";
/** 미정일 때 결혼식 시기의 연도를 단정하지 말라는 예외. */
const CONFIRM_INSTEAD = "결혼식 시기는 연도를 단정하지 말고 한 번 확인하세요";

describe("연도 해석 규칙은 결혼 예정일 유무로 갈린다", () => {
  it("예정일이 없으면 연도를 단정하지 말라고만 한다", () => {
    const block = dateRuleBlock(UNDATED);
    expect(block, "미정인데 연도 단정을 막는 줄이 없다").toContain(CONFIRM_INSTEAD);
    expect(block, "같은 블록이 '연도 없는 달은 올해' 를 함께 지시한다 — 8/24 오답이 그대로 나온다")
      .not.toContain(ASSUMES_THIS_YEAR);
  });

  it("예정일이 있으면 기존 절대 규칙이 그대로 남는다", () => {
    const block = dateRuleBlock(DATED);
    expect(block, "날짜를 아는 커플에게서 올해 해석 규칙이 사라졌다")
      .toContain(ASSUMES_THIS_YEAR);
    expect(block, "날짜를 아는 커플에게 '연도를 단정하지 마세요' 는 혼란만 준다")
      .not.toContain(CONFIRM_INSTEAD);
  });

  it("두 규칙이 한 프롬프트에 함께 실리는 조합이 없다", () => {
    // 이 단언이 이 파일의 핵심이다. 각각의 존재만 고정하면 **둘 다 실린 상태**가
    // 두 테스트를 모두 통과한다 — 실제로 그렇게 통과해 왔다.
    for (const [label, prompt] of [["미정", UNDATED], ["확정", DATED]] as const) {
      const both = prompt.includes(ASSUMES_THIS_YEAR) && prompt.includes(CONFIRM_INSTEAD);
      expect(both, `${label}: 서로 반대를 요구하는 두 줄이 함께 실렸다`).toBe(false);
    }
  });

  it("일정·예약 날짜의 미래 해석은 두 갈래 모두에 남는다", () => {
    // 이걸 통째로 빼면 "9월 20일"을 이미 지난 날짜라고 답한 2026-08-23 오류가 돌아온다.
    for (const [label, prompt] of [["미정", UNDATED], ["확정", DATED]] as const) {
      expect(dateRuleBlock(prompt), `${label}: 연도 없는 일정 날짜 해석이 사라졌다`)
        .toContain("가장 가까운 미래 날짜");
    }
  });

  it("미정 갈래는 결혼식 날짜를 4자리 연도로 못 박지 않는다", () => {
    // 같은 블록의 "결혼식 날짜를 답할 때는 4자리 연도를 명시하세요" 도 미정일 때는
    // 연도를 지어내라는 지시가 된다. 갈래를 나누지 않으면 위 예외와 싸운다.
    expect(dateRuleBlock(UNDATED)).toContain("사용자가 직접 말한 연도만 4자리로 쓰고");
    expect(dateRuleBlock(DATED)).toContain("같이 4자리 연도를 명시하세요");
  });
});
