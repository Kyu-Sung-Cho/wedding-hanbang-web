import { describe, expect, it } from "vitest";
import { assessExplicitTaskRequest } from "../amoraExplicitTaskRequest";

const INTRO = "아래 두 개를 공유 할 일에 추가해줘. 아직 완료하지 않았고, 하나씩 내용을 확인하고 저장할게.";
const ROW1 = "1. 제목: QA0910-R2 식장 추가금 확인 / 내용: 계약 전에 식대 외 추가금을 서면으로 확인 / 마감: 2026-09-15";
const ROW2 = "2. 제목: QA0910-R2 초대 명단 겹침 확인 / 내용: 두 사람 명단에서 겹치는 초대 대상을 확인 / 마감: 2026-09-16";
const REQUEST = [INTRO, ROW1, ROW2].join("\n");
const INPUTS = [
  { title: "QA0910-R2 식장 추가금 확인", description: "계약 전에 식대 외 추가금을 서면으로 확인", due_date: "2026-09-15" },
  { title: "QA0910-R2 초대 명단 겹침 확인", description: "두 사람 명단에서 겹치는 초대 대상을 확인", due_date: "2026-09-16" },
];
const ACTIONS = INPUTS.map(input => ({ tool: "add_amora_action", input }));
const TAG = `[pending_action]${JSON.stringify(ACTIONS[0])}[/pending_action]`;

describe("explicit shared task lists with colon labels", () => {
  it.each(["첫 번째 내용을 확인하고 저장할까요?", TAG])(
    "recovers both exact live rows when the provider omits all or part of the list: %s",
    model => {
      expect(assessExplicitTaskRequest(REQUEST, model)).toEqual({ kind: "ready", actions: ACTIONS });
    },
  );

  it.each([
    REQUEST.replace("아래 두 개를 공유 할 일에", "2개를 공유 할 일에"),
    REQUEST.replace(INTRO, "공유 할 일 두 개를 추가해줘."),
    REQUEST.replace(INTRO, "아래 2건을 함께 보는 할 일에 추가해주세요."),
    REQUEST.replaceAll("내용:", "설명:").replaceAll("마감:", "예정일:"),
    REQUEST.replaceAll(": ", "：").replaceAll(" / ", "/"),
    REQUEST.replaceAll("\n", "\r\n"),
    REQUEST.replace("2026-09-15", "2026년 9월 15일").replace("2026-09-16", "2026년 9월 16일"),
  ])("preserves exactly the same explicit fields across supported label spellings: %s", text => {
    expect(assessExplicitTaskRequest(text)).toEqual({ kind: "ready", actions: ACTIONS });
  });

  it.each([
    REQUEST.replace("두 개", "세 개"),
    REQUEST.replace("두 개", "11개"),
    REQUEST.replace("두 개", "0개"),
    REQUEST.replace("두 개", "열한 개"),
    REQUEST.replace(ROW2, ROW1),
    REQUEST.replace("2. 제목", "3. 제목"),
    REQUEST.replace(" / 내용: 계약 전에 식대 외 추가금을 서면으로 확인", ""),
    REQUEST.replace("2026-09-15", "내일"),
    REQUEST.replace("2026-09-15", "2026-02-30"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인, 담당자는 신부 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인 / 담당자: 두 사람 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인, 비공개로 저장해줘 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인, 확인 카드도 만들지 마 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인, 이번 할 일은 추가하지 말아줘 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인 / 추가하지 마 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인 / 실제로 저장하지 마 / 마감"),
    REQUEST.replace("식장 추가금 확인 / 내용", "식장 추가금 확인 / 추가하지 마 / 내용"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인, 9월 11일까지 끝내줘 / 마감"),
    REQUEST.replace("서면으로 확인 / 마감", "서면으로 확인 / 내용: 바꾼 설명 / 마감"),
    REQUEST.replace("식장 추가금 확인 / 내용", "식장 추가금 확인, 담당은 신랑 / 내용"),
    REQUEST.replace("2026-09-15\n", "2026-09-15 / 담당: 두 사람\n"),
    `${REQUEST}\n담당자는 신부로 해줘.`,
    `${REQUEST}\n상대에게는 숨기고 나만 보게 해줘.`,
    `${REQUEST}\n확인 카드도 만들지 마.`,
    REQUEST.replace("아직 완료하지 않았고,", "이미 완료한 일이니 완료로 저장하고,"),
    REQUEST.replace("하나씩 내용을 확인하고 저장할게.", "하나씩 내용을 확인하되 이번에는 추가하지 마."),
  ])("clarifies the entire recognized request instead of dropping or absorbing a condition: %s", text => {
    expect(assessExplicitTaskRequest(text)).toMatchObject({ kind: "needs_clarification" });
    expect(assessExplicitTaskRequest(text, TAG)).toMatchObject({ kind: "needs_clarification" });
    expect(assessExplicitTaskRequest(text, TAG)).not.toHaveProperty("actions");
  });

  it.each([
    "누락하지 말고 식대 확인",
    "9월 11일까지 유효한 견적서 내용 확인",
    "업체가 말한 ‘담당자는 신부’ 문구를 확인",
    "견적서의 ‘확인 카드도 만들지 마’ 문구가 맞는지 확인",
    "식대/대관료 포함 여부 확인",
    "업체 문구 ‘조건 / 저장하지 마 / 검토’를 확인",
  ])("keeps task content and complete quoted language as data: %s", description => {
    const text = REQUEST.replace(INPUTS[0].description, description);
    expect(assessExplicitTaskRequest(text)).toEqual({
      kind: "ready",
      actions: [{ tool: "add_amora_action", input: { ...INPUTS[0], description } }, ACTIONS[1]],
    });
  });

  it.each([
    { ...ACTIONS[0], input: { ...INPUTS[0], assignee: "bride" } },
    { ...ACTIONS[0], input: { ...INPUTS[0], due_date: "2026-09-14" } },
    { tool: "add_amora_action", input: { title: "추가 항목", description: "요청 밖", due_date: "2026-09-17" } },
  ])("does not prune conflicting provider metadata to force a ready list", action => {
    const model = `[pending_action]${JSON.stringify(action)}[/pending_action]`;
    expect(assessExplicitTaskRequest(REQUEST, model)).toMatchObject({ kind: "needs_clarification" });
  });

  it.each([
    `예시: ${REQUEST}`,
    `“${REQUEST}”라는 요청의 문구를 평가해줘.`,
    REQUEST.replace("공유 할 일", "개인 할 일"),
    "아래 두 개를 공유 할 일에 넣으면 좋을까?",
  ])("does not mistake quoted, private, or advisory text for this current shared write request", text => {
    expect(assessExplicitTaskRequest(text)).toBeNull();
  });
});
