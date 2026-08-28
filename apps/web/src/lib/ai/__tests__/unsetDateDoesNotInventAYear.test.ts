/**
 * 결혼 날짜가 미정일 때 아모라가 연도를 지어내지 않는가.
 *
 * 2026-08-24 팀 테스트에서 사용자가 "내년 가을쯤"이라고 말했고, 아모라도 그 턴에서는
 * "2027년 9~11월"이라고 맞게 받았다. 그런데 열일곱 턴 뒤 "9월보다 10월이 더 좋아"
 * 라는 말에 **"예식장에 문의할 때는 2026년 10월 후보 날짜를 전달하세요"** 라고 답했다.
 * 사용자는 예식 연도가 1년 틀린 채로 업체에 문의하게 된다.
 *
 * 저장할 자리가 없는 것이 원인이다 — `update_wedding_date` 는 `YYYY-MM-DD` 를 강제해서
 * "2027년 가을" 같은 대략의 시기를 넣을 수 없다. 그래서 그 조건은 대화문에만 남았다가
 * 길이 제한에 밀려 사라졌고, 모델은 "10월"을 가장 가까운 10월로 읽었다.
 *
 * ## 이 파일이 지키는 것
 *
 * 규칙이 **합성된 프롬프트**에 남는가. 원본 `prompts.ts` 를 grep 하는 것으로는 부족하다 —
 * 이 파일에는 `amoraPromptComposer` 가 통째로 지우는 구간이 있고, 거기 쓴 규칙을
 * 배포까지 했다가 발견한 적이 있다. 그리고 길이 상한(48,000자)에 걸려 잘리는 자리도
 * 있으므로 **무거운 문맥으로도** 확인한다.
 */
import { describe, expect, it } from "vitest";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const RULE = "월·계절만 들었을 때 연도를 스스로 정하지 마세요";

const CONTEXT = {
  weddingDate: null as string | null,
  budget: null,
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
  senderName: "신부",
};

const build = (
  overrides: Partial<typeof CONTEXT>,
  options: Record<string, unknown> = {},
) =>
  buildAmoraSystemPrompt({ ...CONTEXT, ...overrides } as never, {
    enabledToolNames: BETA_SAFE_TOOLS.map((tool) => tool.name),
    requestKind: "chat",
    persistenceMode: "durable",
    ...options,
  } as never) as string;

describe("날짜가 미정이면 연도를 지어내지 않는다", () => {
  it("규칙이 합성된 프롬프트에 남는다", () => {
    expect(build({})).toContain(RULE);
  });

  it("길이 상한을 걸어도 남는다", () => {
    // 필수 현재 문맥은 먼저 떼어 내 뒤에 붙이므로 잘리지 않아야 한다.
    expect(build({}, { maxChars: 48_000 })).toContain(RULE);
  });

  it("무거운 저장 문맥에서도 남는다", () => {
    // 상한에 실제로 닿는 모양으로 확인한다. 빈 문맥으로 재면 잘림이 안 보인다.
    const heavy = {
      scheduleEvents: Array.from({ length: 40 }, (_, i) => ({
        id: `evt-${i}`,
        title: `일정 ${i} — 예식장 견적 문의와 신혼집 지역 정리`,
        date: "2026-09-01",
        type: "couple_promise",
      })),
      chatSummaries: Array.from({ length: 12 }, (_, i) => ({
        summary: `요약 ${i}. `.repeat(80),
      })),
    };
    expect(build(heavy as never, { maxChars: 48_000 })).toContain(RULE);
  });

  it("날짜가 정해져 있으면 이 규칙을 붙이지 않는다", () => {
    // 날짜를 아는 커플에게 "연도를 정하지 마세요"는 혼란만 준다.
    const withDate = build({ weddingDate: "2027-10-10" });
    expect(withDate).not.toContain(RULE);
    expect(withDate).toContain("2027-10-10");
  });
});
