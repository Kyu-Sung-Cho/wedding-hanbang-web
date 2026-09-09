// null 저장값과 대화의 시기 근거를 구분하는 지침의 전달 검사다.
// 포화 문맥에서도 보호되는지 확인하며 실제 모델의 답변 품질을 대신하지 않는다.
import { describe, expect, it } from "vitest";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
type Options = Parameters<typeof buildAmoraSystemPrompt>[1];
const READ_TOOLS = BETA_SAFE_TOOLS.filter(tool => !isMutatingTool(tool.name)).map(tool => tool.name);
const RULE = "현재 발화·제공된 이력의 사용자 연도와 시점이 명확한 상대연도는 유지";
const CONTEXT: Context = {
  weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
  brideName: "신부", groomName: "신랑", senderName: "신부",
  bookings: [], scheduleEvents: [], chatSummaries: [], pastConflicts: [], pastDecisions: [],
};
const HEAVY: Context = {
  ...CONTEXT,
  chatSummaries: Array.from({ length: 30 }, (_, index) => `합성 준비 요약 ${index}. `.repeat(100)),
};
const build = (context: Context = CONTEXT, overrides: Partial<Options> = {}) =>
  buildAmoraSystemPrompt(context, {
    enabledToolNames: READ_TOOLS, requestKind: "chat", persistenceMode: "durable", ...overrides,
  });

describe("미저장 날짜의 연도 근거 계약은 보호된 현재 문맥에 남는다", () => {
  it.each([undefined, 48_000])("상한 %s에서도 null을 연도 미정으로 바꾸지 않는다", maxChars => {
    const prompt = build(CONTEXT, { maxChars });
    expect(prompt).toContain(RULE);
    expect(prompt).toContain("월·규모 변경으로 지우지 마세요");
    expect(prompt).not.toContain("결혼식 시기는 연도를 단정하지 말고 한 번 확인하세요");
  });

  it.each([{ name: "조회 도구", enabledToolNames: READ_TOOLS }, { name: "도구 없음", enabledToolNames: [] }])("무거운 문맥의 48k 보호 구간에서도 근거와 한계를 유지한다: $name", ({ enabledToolNames }) => {
    const prompt = build(HEAVY, { enabledToolNames, maxChars: 48_000 });
    const unbounded = build(HEAVY, { enabledToolNames });
    expect(unbounded.length).toBeGreaterThan(48_000);
    expect(prompt.length).toBeLessThanOrEqual(48_000);
    expect(prompt).toContain("길이 제한으로 생략됨");
    const mandatory = prompt.slice(prompt.indexOf("[필수 현재 문맥]"));
    expect(mandatory).toContain(RULE);
    expect(mandatory).toContain("과거 상대연도는 발화 시점·확인된 절대연도 없이 재계산하지 마세요");
    expect(mandatory).toContain("연도 근거 없는 월·계절만 확인");
    expect(mandatory).toContain("대략 시기를 정확한 날짜로 꾸며 저장 제안하지 마세요");
    expect(prompt.split(RULE)).toHaveLength(2);
    if (enabledToolNames.length === 0) {
      for (const name of ["update_wedding_date", "add_schedule_event", "update_schedule_event"]) {
        expect(prompt).not.toContain(name);
      }
    }
  });

  it("정확 날짜가 저장돼 있으면 미저장 안내 대신 저장값을 유지한다", () => {
    const prompt = build({ ...CONTEXT, weddingDate: "2027-10-10" }, { maxChars: 48_000 });
    expect(prompt).not.toContain(RULE);
    expect(prompt).not.toContain("결혼 날짜: 정확한 날짜는 아직 저장되지 않음");
    expect(prompt).toContain('결혼 예정일: "2027-10-10"');
    expect(prompt).toContain("위 저장값이 정본입니다");
  });

  it.each([
    { scope: "W2_high_risk_adjacent", highRiskReason: "domain" },
    { scope: "W2_high_risk_adjacent", highRiskReason: "safety" },
    { scope: "W3_social_care" },
    { scope: "W4_out_of_scope" },
    { scope: "W5_safety_override" },
  ] as const)("$scope/$highRiskReason에 보호된 결혼 날짜 문맥을 추가하지 않는다", classification => {
    const questionScope: NonNullable<Options["questionScope"]> = {
      ...classification, allowsLongTermMemory: false, confidence: "high", needsClarification: false,
    };
    for (const maxChars of [undefined, 48_000]) {
      const prompt = build({ ...HEAVY, brideName: "범위밖이름", weddingDate: "2034-04-04" }, {
        enabledToolNames: [], questionScope, maxChars,
      });
      expect(prompt).not.toContain(RULE);
      expect(prompt).not.toContain("범위밖이름");
      expect(prompt).not.toContain("2034-04-04");
      expect(prompt).not.toContain("정확한 결혼 예정일을 처음 말하면");
      expect(prompt).not.toContain("update_wedding_date");
    }
  });

  it("구조화 중재의 requester-summary-only 범위에 날짜 문맥을 복원하지 않는다", () => {
    for (const maxChars of [undefined, 48_000]) {
      const prompt = build({ ...HEAVY, brideName: "범위밖이름", weddingDate: "2034-04-04" }, {
        enabledToolNames: [], requestKind: "mediation", maxChars,
      });
      expect(prompt).not.toContain(RULE);
      expect(prompt).not.toContain("범위밖이름");
      expect(prompt).not.toContain("2034-04-04");
      expect(prompt).not.toContain("update_wedding_date");
    }
  });
});
