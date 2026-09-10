import { describe, expect, it } from "vitest";
import { composeAmoraPersistenceTerminal, isExplicitAmoraChangeRequest } from "../amoraPersistenceClaims";
import { isAmoraFailedProposalNotice } from "../amoraPendingAction";

const noCard = { hasPendingAction: false, persistenceMode: "durable" as const, toolResults: [], userRequestedChange: true };

describe("terminal pending card evidence", () => {
  it.each([
    "저장 전 확인 카드입니다.", "아래 확인 카드를 확인해주세요.", "확인 카드를 준비했어요. 적용 버튼을 눌러주세요.",
    "저장 전 확인 카드를 보여드릴게요.", "적용 버튼이 있어요.",
    "예시가 아니라 실제 저장 전 확인 카드입니다.",
  ])("replaces nonexistent actionable UI claims: %s", text => {
    const result = composeAmoraPersistenceTerminal({ ...noCard, text });
    expect(result.text).not.toContain(text);
    expect(result.text).toContain("확인 카드를 만들지 못했어요");
    expect(result.source).toBe("server_correction");
    expect(isAmoraFailedProposalNotice(result.text)).toBe(true);
  });

  it.each([
    "확인 카드는 저장 전에 검토하는 용도예요.", "확인 카드를 보여드릴까요?", "확인 카드가 없어요.",
    "‘저장 전 확인 카드입니다’라는 문구는 어떤 뜻인가요?", "예시로 ‘적용 버튼을 눌러주세요’라고 안내할 수 있어요.",
    "아래 확인 카드가 있으면 적용 버튼을 누를 수 있어요.",
  ])("preserves explanations, questions, quotes and conditions: %s", text => {
    expect(composeAmoraPersistenceTerminal({ ...noCard, text }).text).toBe(text);
  });

  it("accepts a carried card only when the caller confirms it is actually emitted", () => {
    expect(composeAmoraPersistenceTerminal({ ...noCard, hasEmittedPendingAction: true, text: "아래 확인 카드를 확인해주세요." }).text)
      .toBe("아래 확인 카드를 확인해주세요.");
    expect(composeAmoraPersistenceTerminal({ ...noCard, hasEmittedPendingAction: false, text: "아래 확인 카드를 확인해주세요." }).text)
      .toContain("확인 카드를 만들지 못했어요");
  });
});

describe("read-only request intent", () => {
  it.each([
    "지금 실제 저장된 총예산/배정/미배정/지출, QA0910 두 할 일 완료상태, 일정날짜시간담당 조회만, 새 저장 수정 금지, 개인상담 암시 금지",
    "예산은 조회만 해줘. 저장하거나 수정하지 마.",
    "새로 저장하지 말고 지금 완료한 할 일만 알려줘.",
  ])("does not mistake a prohibited write for a change request: %s", text => {
    expect(isExplicitAmoraChangeRequest(text)).toBe(false);
    const result = composeAmoraPersistenceTerminal({ ...noCard, userRequestedChange: isExplicitAmoraChangeRequest(text),
      droppedPendingActionTag: true, text: "총예산은 3,500만원으로 설정되어 있어요. 예산을 저장했어요.",
      toolResults: [{ toolName: "get_budget_summary", toolInput: {}, toolOutput: { total: 35000000 }, success: true, displayMessage: "" }] });
    expect(result.text).toBe("총예산은 3,500만원으로 설정되어 있어요.");
    expect(result.text).not.toContain("다시 요청");
    expect(result.text).not.toContain("예산을 저장했어요");
  });

  it.each(["예산은 조회만 하고 할 일 하나 추가해줘.", "일정은 수정하지 마. 예산은 3500만원으로 변경해줘.", "담당자는 정하지 말고 할 일 두 개를 추가해줘.", "지출은 조회만 하고 저장하지 마. 항목 예산을 1000만원으로 올려줘."])("keeps independent affirmative changes: %s", text => {
    expect(isExplicitAmoraChangeRequest(text)).toBe(true);
  });
});
