import { describe, expect, it } from "vitest";
import { extractAmoraPendingAction } from "../amoraPendingAction";
import { BETA_SAFE_TOOLS } from "../tools";
import { isMutatingTool } from "../mutationTools";
import { getUnsupportedScheduleFieldsReply, UNSUPPORTED_SCHEDULE_FIELDS_NOTICE } from "../amoraUnsupportedScheduleFields";

const tools = BETA_SAFE_TOOLS.filter(tool => isMutatingTool(tool.name));
const actionId = "11111111-1111-4111-8111-111111111111";
const now = Date.UTC(2026, 8, 10);
const extract = (tool: string, input: Record<string, unknown>) => extractAmoraPendingAction({
  text: `[pending_action]${JSON.stringify({ tool, input })}[/pending_action]`,
  allowedTools: tools, now, createActionId: () => actionId,
});

describe("일정 카드의 미지원 담당·완료 기준을 부분 저장으로 바꾸지 않는다", () => {
  it.each(["add_schedule_event", "update_schedule_event"])("%s는 명시된 미지원 필드를 제거해 나머지 카드만 내지 않는다", tool => {
    const supported = tool === "add_schedule_event"
      ? { date: "2026-09-14", time: "19:30", title: "둘이 예산 확인" }
      : { event_id: "event-existing", time: "19:45" };
    for (const [field, value] of [
      ["assignee", "couple"], ["assignee", null],
      ["completion_criteria", "조정할 항목 한 개 정하기"],
      ["completionCriteria", "확인표 작성"],
      ["assignee_confirmation", { profileId: "user-unverified" }],
    ] as const) {
      const result = extract(tool, { ...supported, [field]: value });
      expect(result.pendingAction, `${tool}:${field}`).toBeNull();
      expect(result.remainingActions).toBeUndefined();
    }
  });

  it("일반 일정 날짜·시간·메모와 무관한 미선언 메타키의 기존 보정은 유지한다", () => {
    const input = { date: "2026-09-14", time: "19:30", title: "담당자에게 견적 질문", memo: "완료 기준을 상담에서 확인" };
    expect(extract("add_schedule_event", { ...input, decorative_hint: "compact" }).pendingAction?.input).toEqual(input);
  });

  it("다른 도구의 일반 미선언 키를 전역 거절하지 않는다", () => {
    expect(extract("add_amora_action", { title: "준비 항목 확인", location: "집" }).pendingAction?.input).toEqual({ title: "준비 항목 확인" });
  });

  it("지원하는 항목과 미지원 조건이 섞인 표식에서 일부만 저장하도록 카드·큐를 내지 않는다", () => {
    const result = extractAmoraPendingAction({
      text: [
        { tool: "add_schedule_event", input: { date: "2026-09-14", title: "견적 확인" } },
        { tool: "add_schedule_event", input: { date: "2026-09-15", title: "포함 항목 확인", assignee: "couple" } },
      ].map(marker => `[pending_action]${JSON.stringify(marker)}[/pending_action]`).join("\n"),
      allowedTools: tools, now, createActionId: () => actionId,
    });
    expect(result.pendingAction).toBeNull();
    expect(result.remainingActions).toBeUndefined();
    expect(result.dropReason).toBe("unsupported_schedule_fields");
    expect(result.cleanText).toBe(UNSUPPORTED_SCHEDULE_FIELDS_NOTICE);
  });
});

describe("새 일정 변경의 명시 담당·완료 기준만 제한 안내한다", () => {
  it.each([
    "내일 견적 확인 일정을 삭제해줘. 담당자는 상대방이야.",
    "담당자는 상대방이야. 내일 견적 확인 일정을 제거해줘.",
    "내일 견적 확인 일정을 지워줘. 완료 기준은 견적 확인이었어.",
  ])("일정 자체 삭제의 기존 담당 설명을 새 설정으로 바꾸지 않는다: %s", text => {
    expect(getUnsupportedScheduleFieldsReply(text)).toBeNull();
  });

  it.each([
    "일정의 완료 기준을 지워줘. 담당자는 그대로 둬.",
    "내일 일정을 삭제해줘. 다음 주 일정을 추가해줘. 담당자는 상대방으로 해줘.",
    "내일 일정을 제거해줘. 다른 일정의 담당자를 상대방으로 설정해줘.",
    "담당자를 상대방으로 설정해주고 내일 일정을 삭제해줘.",
    "내일 일정을 삭제해줘. 담당자는 상대방으로 해줘.",
  ])("일정 삭제와 미지원 필드 변경이 섞여도 부분 처리하지 않는다: %s", text => {
    expect(getUnsupportedScheduleFieldsReply(text)).toBe(UNSUPPORTED_SCHEDULE_FIELDS_NOTICE);
  });

  it.each([
    "2026년 9월 14일 저녁 7시 30분에 둘이 예산 확인 일정을 추가해줘. 메모는 총예산과 미배정 금액을 함께 확인, 완료 기준은 조정할 항목 한 개 정하기, 담당은 두 사람이야. 업체 예약은 아니야.",
    "2026년 9월 18일 오후 7시에 견적 확인 일정을 추가해줘. 담당자는 상대방으로 하고, 완료 기준은 식장 견적서를 받아 두 사람이 포함 항목을 확인하는 거야. 날짜와 제목만 저장하고 나머지 조건을 빠뜨리면 안 돼. 실제 저장 전에 모든 조건이 들어간 확인 카드를 보여줘.",
    "견적 확인 일정의 담당자를 상대방으로 바꿔줘.",
    "견적 확인 일정의 완료 기준을 서면 확인으로 설정해줘.",
    "둘이 확인할 일정을 등록해줘. 담당: 두 사람 / 완료 기준: 체크표 작성",
    "일정을 추가해줘. 담당자는 '상대방'.",
    "일정을 추가해줘. 완료 기준은 ‘견적서를 읽고 확인’.",
    "내일 확인 일정을 추가해줘. 나를 담당자로 정해줘.",
    "견적 확인 일정의 담당자를 미정으로 바꿔줘.",
    "일정의 완료 기준을 지워줘. 담당자는 그대로 둬.",
  ])("조건이 카드에서 없어질 수 있는 요청을 닫는다: %s", text => {
    expect(getUnsupportedScheduleFieldsReply(text)).toBe(UNSUPPORTED_SCHEDULE_FIELDS_NOTICE);
  });

  it.each([
    "2026년 9월 14일 저녁 7시 30분에 견적 확인 일정을 추가해줘. 메모는 포함 항목 확인이야.",
    "2026년 9월 14일 담당자에게 질문할 일정을 추가해줘.",
    "2026년 9월 14일 완료 기준 상담 일정을 추가해줘.",
    "일정의 날짜를 바꿔줘. 담당자는 정하지 말고 완료 기준은 그대로 둬.",
    "일정의 날짜를 바꿔줘. 담당자는 누구인지 알려줘.",
    "일정 담당자는 누구야? 변경하지 말고 알려줘.",
    "일정의 완료 기준은 어떻게 정하면 좋을까? 저장하지 말고 상담해줘.",
    "일정 담당자는 상대방으로 정했었어. 지금 누구로 저장되어 있는지만 알려줘.",
    "'일정을 추가해줘. 담당자는 상대방'이라는 문구가 자연스러워?",
    "일정에 '담당자는 두 사람'이라는 메모만 추가해줘.",
    "일정의 메모는 ‘완료 기준은 서면 확인’이라고 수정해줘.",
    "일정 담당자를 바꿔줘라는 문구를 검토해줘.",
    "할 일의 담당자는 상대방으로 바꿔줘.",
    "예산을 수정해줘. 일정 담당자는 누구인지 알려줘.",
  ])("상담·조회·인용·일반 일정 요청을 가로채지 않는다: %s", text => {
    expect(getUnsupportedScheduleFieldsReply(text)).toBeNull();
  });

  it("모델이 새로 넣은 미지원 필드도 부분 카드로 만들지 않는다", () => {
    const marker = `[pending_action]${JSON.stringify({ tool: "add_schedule_event", input: { date: "2026-09-14", title: "견적 확인", assignee: "partner" } })}[/pending_action]`;
    expect(getUnsupportedScheduleFieldsReply("견적 확인 일정을 추가해줘.", marker)).toBe(UNSUPPORTED_SCHEDULE_FIELDS_NOTICE);
    expect(getUnsupportedScheduleFieldsReply("일정의 담당자는 누구인지 알려줘.", marker)).toBeNull();
  });
});
