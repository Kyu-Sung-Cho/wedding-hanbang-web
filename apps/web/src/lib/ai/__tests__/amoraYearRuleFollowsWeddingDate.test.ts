// 날짜 지침의 공개 조합 결과와 범위 대조다. 모델이 실제 연도를 유지하는지는 별도 실측한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
const READ_TOOLS = BETA_SAFE_TOOLS.filter(tool => !isMutatingTool(tool.name)).map(tool => tool.name);
const BASE: Context = {
  weddingDate: null, budget: 50_000_000, venue: null, progress: {}, preparationStatus: null,
  brideName: "신부", groomName: "신랑", senderName: "신부",
  bookings: [], scheduleEvents: [], chatSummaries: [], pastConflicts: [], pastDecisions: [],
};
const compose = (weddingDate: string | null, enabledToolNames = READ_TOOLS) =>
  buildAmoraSystemPrompt({ ...BASE, weddingDate }, {
    enabledToolNames, requestKind: "chat", persistenceMode: "durable", maxChars: 48_000,
  });
function dateRuleBlock(prompt: string): string {
  const start = prompt.indexOf("**🗓 날짜 처리 절대 규칙 (어기지 말 것)**");
  expect(start, "날짜 절대 규칙 블록이 합성 결과에 없다").toBeGreaterThan(-1);
  const end = prompt.indexOf("\n\n", start);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("날짜 저장값과 대화의 연도 근거를 구분한다", () => {
  it("정확 날짜가 미저장이어도 대화에서 확인한 연도를 미정으로 되돌리지 않는다", () => {
    const prompt = compose(null);
    expect(prompt).toContain("결혼 날짜: 정확한 날짜는 아직 저장되지 않음");
    expect(dateRuleBlock(prompt)).toContain("월·규모만 바뀌었다고 확인한 연도를 미정으로 되돌리지 마세요");
    expect(dateRuleBlock(prompt)).not.toContain("결혼식 시기는 연도를 단정하지 말고 한 번 확인하세요");
  });

  it.each([null, "2027-10-10"])("저장값 %s에서도 근거 없는 연도 추정과 확인된 연도 덮어쓰기를 함께 막는다", weddingDate => {
    const block = dateRuleBlock(compose(weddingDate));
    expect(block).toContain("현재 발화·제공된 이력에서 사용자가 밝힌 연도·계절을 유지하세요");
    expect(block).toContain('연도 근거가 전혀 없는 "10월"·"가을"만 있을 때는 어느 해인지 확인');
    expect(block).toContain("임의로 올해·내년을 붙이지 마세요");
    expect(block).not.toContain("그 날짜는 **미래**이고,");
    expect(block).not.toContain("못 들었으면 연도를 붙이지 말고 어느 해인지 확인하세요");
  });

  it("현재 발화의 명확한 상대연도는 오늘 KST 기준으로 해석하되 과거 인용과 구분한다", () => {
    const block = dateRuleBlock(compose(null));
    expect(block).toContain('현재 발화의 기준 연도는 **2026년**입니다. "올해"=2026, "내년"=2027');
    expect(block).toContain('현재 발화의 "내년 가을"처럼 기준 시점이 명확한 상대연도도 근거');
    expect(block).toContain('현재 발화에서 "내년 X월 Y일"이라고 하면 **2027-MM-DD**');
    expect(block).toContain("과거 이력의 상대연도는 발화 시점이나 함께 확인된 절대연도 없이 오늘 기준으로 재계산하지 마세요");
  });

  it("현재 해가 바뀌어도 과거 상대연도를 오늘 기준으로 다시 계산하라고 하지 않는다", () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const block = dateRuleBlock(compose(null));
    expect(block).toContain('현재 발화의 기준 연도는 **2027년**입니다. "올해"=2027, "내년"=2028');
    expect(block).toContain("발화 시점이나 함께 확인된 절대연도 없이 오늘 기준으로 재계산하지 마세요");
    expect(block).toContain("월·규모만 바뀌었다고 확인한 연도를 미정으로 되돌리지 마세요");
  });

  it.each([null, "2027-10-10"])("별도 일반 일정의 미래 날짜 해석은 유지하되 저장값 %s을 덮지 않는다", weddingDate => {
    const block = dateRuleBlock(compose(weddingDate));
    expect(block).toContain("결혼식 시기와 분리된 일반 일정·예약에만");
    expect(block).toContain("그 일정에 이미 확인된 연도가 없으면");
    expect(block).toContain("가장 가까운 미래 날짜");
    expect(block).toContain("이미 확인된 해당 일정이나 결혼 연도를 덮어쓰지 마세요");
  });

  it("일정 조회 지침도 이미 확인한 연도와 결혼 시기를 최근 미래 추정으로 덮지 않는다", () => {
    const rule = compose(null).split("\n").find(line => line.includes("연도 없는 일반 일정·예약만 가장 가까운 미래 날짜"));
    expect(rule).toContain("확인된 일정·결혼식 연도는 유지");
    expect(rule).toContain("연도 없는 일반 일정·예약만");
    expect(rule).toContain("결혼식 시기 추정 금지");
  });

  it("대략 시기나 월 선호로 정확한 날짜를 만들어 저장 제안하지 않는다", () => {
    // 원본이 아니라 조회 도구만 켠 합성 결과에 묻는다 — 저장 제안·날짜 인자 두 줄은
    // 2026-09-14까지 도구 이름을 달고 있어 조립기가 매 턴 버렸고 원본 grep 만 초록이었다.
    const block = dateRuleBlock(compose(null));
    expect(block).toContain("대략의 시기·월 선호는 후보로 남기세요");
    expect(block).toContain("정확한 YYYY-MM-DD를 꾸며 저장 제안하지 마세요");
    expect(block).toContain("정확한 결혼 예정일을 처음 말하면 그 날짜를 되짚고 저장 제안을 만드세요");
    expect(block).toContain("사용자가 저장·변경을 별도로 확인하기 전에는 예식일 변경을 실행하거나 저장됐다고 말하지 마세요");
    expect(block).toContain("날짜 인자는 반드시 **오늘(2026-09-09) 이후의 미래 날짜**");
  });

  it("composer를 거치지 않는 기본 프롬프트 소비자에도 같은 시기 근거 규칙을 전달한다", () => {
    const raw = dateRuleBlock(getWeddingPlannerSystemPrompt(BASE));
    const composed = dateRuleBlock(compose(null));
    for (const rule of [
      "월·규모만 바뀌었다고 확인한 연도를 미정으로 되돌리지 마세요",
      "과거 이력의 상대연도는 발화 시점이나 함께 확인된 절대연도 없이 오늘 기준으로 재계산하지 마세요",
      "정확한 YYYY-MM-DD를 꾸며 저장 제안하지 마세요",
    ]) {
      expect(raw).toContain(rule);
      expect(composed).toContain(rule);
    }
  });
});
