import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";
import { selectAmoraPendingProposalTools, selectAmoraTools } from "../amoraToolPolicy";
import { BETA_SAFE_TOOLS } from "../tools";
import { isMutatingTool } from "../mutationTools";
import { hasExplicitAmoraSharedTaskRequest, hasAmoraSharedTaskProposalRequest } from "../amoraSharedTaskIntent";

const QA_PROPOSAL = '[합성 결정보드 연결 QA] 제목은 "[QA 20261011 CHAT] 대화 승인 연결 시험", 설명은 "합성 시험용이며 실제 준비 계획이나 합의가 아님"인 공유 할 일 하나를 제안해줘. 날짜와 업체는 넣지 말고, 먼저 저장할 문구와 상태의 미리보기만 보여줘. 내가 승인하기 전에는 저장하지 마.';
const QA_APPROVAL = '[합성 QA 승인] 방금 미리보기의 "[QA 20261011 CHAT] 대화 승인 연결 시험" 하나만 그대로 공유 할 일에 실제 저장해줘. 상태는 미완료, 날짜와 업체는 없음. 기존 다른 항목은 바꾸지 말고 저장 결과를 확인해줘.';
const QA_ADDITION = '공유 할 일에 "[QA 20261011 CHAT2] 추가 표현 연결 시험"을 추가해줘. 설명은 "합성 기능 시험 전용, 실제 준비 계획이나 합의 아님", 미완료 상태, 날짜와 업체 없음. 이 시험 항목 하나만 실제 추가하는 데 동의하며 기존 항목은 바꾸지 마.';
const QA_CONFIRMATION_CARD = '우리 결혼 준비 공유 할 일에 추가할 항목의 확인 카드를 보여줘. 제목은 "[QA] 결혼 준비 연결 시험", 설명은 "합성 기능 시험용", 상태 미완료, 날짜와 업체 없음이야. 기존 항목은 바꾸지 말고 아직 저장하지 마.';

describe("공유 할 일 제품 동작의 질문 범위", () => {
  it("실제 저장 요청도 같은 공유 할 일 동작으로 연결한다", () => {
    expect(classifyAmoraQuestionScope({ userText: "공유 할 일에 실제 저장해줘" }))
      .toEqual(expect.objectContaining({ scope: "W0_wedding_core", allowsLongTermMemory: false }));
  });

  it.each([
    QA_PROPOSAL, QA_APPROVAL, QA_ADDITION,
    '공유 할 일에 "두 분의 참석 가능 시간을 정리하고 확인하기"를 추가해줘.',
    '공유 할 일의 제목은 "두 분의 참석 가능 시간을 정리하고 확인하기", 설명은 "두 사람에게 확인할 질문"인 할 일 하나를 제안해줘. 먼저 미리보기만 보여줘.',
  ])("제안·긴 제목도 결혼 도메인 낱말 없이 해당 제품에 연결한다: %s", (text) => {
    expect(classifyAmoraQuestionScope({ userText: text }).scope).toBe("W0_wedding_core");
  });
});

describe("확인 카드 제안과 실제 쓰기 권한을 분리한다", () => {
  it.each([QA_PROPOSAL, QA_CONFIRMATION_CARD])("미리보기는 할 일 추가 제안만 허용한다: %s", (userText) => {
    const input = { availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" as const, specialistMatchedByKeyword: false };
    expect(selectAmoraPendingProposalTools(input).map(tool => tool.name)).toEqual(["add_amora_action"]);
    expect(selectAmoraTools(input).filter(tool => isMutatingTool(tool.name))).toEqual([]);
  });

  it.each([
    "회사 공유 할 일에 실제 저장해줘.",
    "업무 공유 할 일 하나를 제안해줘. 미리보기만 보여줘.",
    "프로젝트 공유 할 일 하나를 제안해줘.",
    '"공유 할 일에 실제 저장해줘"라는 문장을 다듬어줘.',
    '친구가 "공유 할 일 하나를 제안해줘"라고 했어. 답장 문구만 알려줘.',
    "공유 할 일에 저장하지 마.",
    "공유 할 일 제안은 하지 말아줘.",
    "공유 할 일의 미리보기 기능이 뭐야?",
    "예시로 공유 할 일 하나를 제안해줘.",
    "가정: 공유 할 일 하나를 제안해줘.",
  ])("다른 분야·인용·부정·예시는 새 제품 요청으로 읽지 않는다: %s", (userText) => {
    expect(hasExplicitAmoraSharedTaskRequest(userText)).toBe(false);
    expect(hasAmoraSharedTaskProposalRequest(userText)).toBe(false);
  });

  it.each([
    "회사 공유 할 일에 실제 저장해줘.",
    "업무 공유 할 일 하나를 제안해줘. 미리보기만 보여줘.",
    "프로젝트 공유 할 일 하나를 제안해줘.",
  ])("다른 분야의 공유 할 일은 계속 범위 밖이다: %s", (userText) => {
    expect(classifyAmoraQuestionScope({ userText }).scope).toBe("W4_out_of_scope");
  });
});
