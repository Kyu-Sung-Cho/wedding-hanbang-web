import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseExplicitScheduleRequest as parseRequest } from "@/lib/ai/amoraExplicitScheduleRequest";
import type { AmoraQueuedAction } from "@/lib/ai/amoraPendingAction";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

const TEXT = "다음 일정 3건을 모두 추가할 수 있게 순서대로 확인 카드를 만들어줘. 2026년 10월 10일 예식장 견적 상담, 2026년 10월 11일 드레스 투어 상담, 2026년 10월 12일 신혼여행 후보 비교. 시간과 메모는 지정하지 않을게. 한 건씩 확인할게.";
const INPUTS = [
  { date: "2026-10-10", title: "예식장 견적 상담" },
  { date: "2026-10-11", title: "드레스 투어 상담" },
  { date: "2026-10-12", title: "신혼여행 후보 비교" },
];
const actions = INPUTS.map(input => ({ tool: "add_schedule_event", input }));

function parseExplicitScheduleRequest(text: string, model: readonly AmoraQueuedAction[] = []) {
  return parseRequest(text, model.map(action => `[pending_action]${JSON.stringify(action)}[/pending_action]`).join("\n"));
}

describe("explicit current-turn multiple schedules", () => {
  it("retains every exact date and title when the provider proposes only the first event", () => {
    const first = { ...actions[0], input: { ...INPUTS[0], category_key: "venue", schedule_scope: "external_commitment" } };
    const result = parseExplicitScheduleRequest(TEXT, [first]);
    expect(result).toEqual([first, ...actions.slice(1)]);
    const validate = new Ajv({ strict: false }).compile(WEDDING_TOOLS.find(tool => tool.name === "add_schedule_event")!.input_schema);
    for (const action of result!) expect(validate(action.input), JSON.stringify(validate.errors)).toBe(true);
  });

  it("recovers all three without a model marker, without inventing optional fields", () => {
    expect(parseExplicitScheduleRequest(TEXT)).toEqual(actions);
  });

  it("preserves a lawful empty model memo without treating it as additional user information", () => {
    const first = { ...actions[0], input: { ...INPUTS[0], memo: "" } };
    expect(parseExplicitScheduleRequest(TEXT, [first])).toEqual([first, ...actions.slice(1)]);
  });

  it.each([
    ["다음 일정 2건을 모두 추가해줘. 2027-10-10 예식장 견적 상담, 2027-10-11 드레스 투어 상담.", "2027-10-10", "2027-10-11"],
    ["다음 일정을 모두 등록해주세요. 예식장 견적 상담: 2028년 2월 29일\n드레스 투어 상담: 2028-03-01. 한 건씩 확인할게.", "2028-02-29", "2028-03-01"],
  ])("consumes a supported complete date/title format: %s", (text, firstDate, secondDate) => {
    expect(parseExplicitScheduleRequest(text)).toEqual([
      { tool: "add_schedule_event", input: { date: firstDate, title: INPUTS[0].title } },
      { tool: "add_schedule_event", input: { date: secondDate, title: INPUTS[1].title } },
    ]);
  });

  it("preserves optional metadata for matching events without appending duplicate model events", () => {
    const model = [actions[2], { ...actions[0], input: { ...INPUTS[0], category_key: "venue" } }];
    expect(parseExplicitScheduleRequest(TEXT, model)).toEqual([model[1], actions[1], model[0]]);
  });

  it("accepts ten distinct events and distinct titles on the same date", () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ date: "2026-10-10", title: `견적 상담 ${index + 1}` }));
    const text = `다음 일정 10건을 모두 추가해줘. ${ten.map(input => `${input.date} ${input.title}`).join(", ")}.`;
    expect(parseExplicitScheduleRequest(text)).toEqual(ten.map(input => ({ tool: "add_schedule_event", input })));
  });

  it.each([
    `[pending_action]${JSON.stringify(actions[0])}`,
    `[ PENDING_ACTION ]${JSON.stringify(actions[0])}[/ PENDING_ACTION ]`,
    JSON.stringify(actions[0]),
    '[pending_action]{"tool":"add_schedule_event","input":}[/pending_action]',
    `[pending_action]${JSON.stringify({ ...actions[0], extra: "not preserved" })}[/pending_action]`,
    `[pending_action]${JSON.stringify(actions[0])}[/pending_action][pending_action]`,
  ])("does not turn malformed or coerced raw model markers into a new complete queue: %s", modelText => {
    expect(parseRequest(TEXT, modelText)).toBeNull();
  });

  it.each([
    TEXT.replace("3건", "2건"),
    "다음 일정 1건을 모두 추가해줘. 2026-10-10 견적 상담.",
    `다음 일정 11건을 모두 추가해줘. ${Array.from({ length: 11 }, (_, i) => `2026-10-10 견적 상담 ${i + 1}`).join(", ")}.`,
    TEXT.replace("2026년 10월 11일", "2027년 2월 29일"),
    TEXT.replace("2026년 10월 11일", "2026년 4월 31일"),
    TEXT.replace("2026년 10월 11일", "10월 11일"),
    TEXT.replace("2026년 10월 11일", "내일"),
    TEXT.replace("2026년 10월 11일", "다음 날"),
    TEXT.replace("드레스 투어 상담", "오후 2시 드레스 투어 상담"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 14:30"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 열한 시"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 월요일"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 10/12"),
    TEXT.replace("드레스 투어 상담", "친구와 함께 드레스 투어 상담"),
    TEXT.replace("드레스 투어 상담", "신부만 참석하는 드레스 투어 상담"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 안 하기"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 메모 준비물"),
    TEXT.replace("드레스 투어 상담", "강남에서 드레스 투어 상담"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 외부 약속"),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담은 앞 일정 이후"),
    TEXT.replace("시간과 메모는 지정하지 않을게.", "각각 30분으로 해줘."),
    TEXT.replace("시간과 메모는 지정하지 않을게.", "모두 오후 2시로 해줘."),
    TEXT.replace("한 건씩 확인할게.", "예산도 3500만 원으로 바꿔줘."),
    TEXT.replace("한 건씩 확인할게.", "두 번째는 취소해줘."),
    TEXT.replace("한 건씩 확인할게.", "나만 볼 수 있게 해줘."),
    TEXT.replace("한 건씩 확인할게.", "셋 중 하나만 골라줘."),
    TEXT.replace("드레스 투어 상담", "드레스 투어 상담 또는 다른 날짜"),
    TEXT.replace("2026년 10월 11일 드레스 투어 상담", "2026년 10월 10일 예식장 견적 상담"),
    `예시야. ${TEXT}`,
    `"${TEXT}"`,
    `지난 대화: ${TEXT}`,
    TEXT.replace("추가할 수 있게", "변경할 수 있게"),
    TEXT.replace("추가할 수 있게", "취소할 수 있게"),
    TEXT.replace("만들어줘.", "만들지 마."),
    TEXT.replace("견적 상담", "견적\u200b 상담"),
    TEXT.replace("견적 상담", "견적 <상담>"),
    "신혼집 지역·예산은 8월 26일, 예식장 견적 문의는 8월 27일, 사진 예산 상한 합의는 8월 29일에 할게. 세 개 모두 추가해줘.",
    "응, 세 개 모두 두 사람의 약속으로 등록해줘.",
  ])("does not recover a partial, ambiguous, mixed, quoted, or refused request: %s", text => {
    expect(parseExplicitScheduleRequest(text)).toBeNull();
  });

  it.each([
    [{ ...actions[0], input: { ...INPUTS[0], time: "14:30" } }],
    [{ ...actions[0], input: { ...INPUTS[0], memo: "준비물 지참" } }],
    [{ ...actions[0], input: { ...INPUTS[0], category_key: "unknown" } }],
    [{ ...actions[0], input: { ...INPUTS[0], schedule_scope: "unknown" } }],
    [{ ...actions[0], input: { ...INPUTS[0], schedule_scope: "confirmed_fact" } }],
    [{ ...actions[0], input: { ...INPUTS[0], location: "명시 장소" } }],
    [actions[0], { ...actions[0], input: { ...INPUTS[0], schedule_scope: "external_commitment" } }],
    [{ tool: "update_schedule_event", input: { ...INPUTS[0], event_id: "existing" } }],
  ])("does not discard unsupported or conflicting existing proposal information (%j)", (...model) => {
    expect(parseExplicitScheduleRequest(TEXT, model)).toBeNull();
  });
});
