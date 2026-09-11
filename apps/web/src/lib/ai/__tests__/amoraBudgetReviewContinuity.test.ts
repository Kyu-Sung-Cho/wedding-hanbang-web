import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { resolveAmoraWeddingClarificationContinuity, type AmoraClarificationContinuityRow } from "@/lib/ai/amoraClarificationContinuity";

const FIRST = "나는 프리랜서라 들어오는 돈이 달마다 달라. 결혼 준비에 최대 2천만 원을 잡으면 어떻게 나눠 생각하면 좋을까? 집 보증금은 별도고 여행을 넣을지는 아직 모르겠어. 예산표는 바꾸지 마.";
const SECOND = "부모님이 보태 주실 수도 있지만 아직 약속한 건 아니야. 그 돈은 없는 셈 치고, 식사는 중요하지만 촬영은 최소로 하고 싶어.";
const CURRENT = "여행은 이번 검토 예산에서 빼기로 할게. 이 조건으로 검토용 두 안만 보여줘. 식사 쪽을 더 쓰면 뭘 줄이는지도 알려줘.";
const user = (id: string, content: string): AmoraClarificationContinuityRow => ({
  id, content, role: "user", sender_type: "bride", sender_id: "owner", visibility: "shared", metadata: null,
});
const assistant = (id: string, repliedTo: string): AmoraClarificationContinuityRow => ({
  id, content: "주신 예산 범위와 우선순위를 확인했어요.", role: "assistant", sender_type: "ai", sender_id: null,
  visibility: "shared", metadata: { question_scope: "W0_wedding_core", in_reply_to_user_message_id: repliedTo },
});
const rows = (): AmoraClarificationContinuityRow[] => [
  user("u1", FIRST), assistant("a1", "u1"), user("u2", SECOND), assistant("a2", "u2"), user("u3", CURRENT),
];
function proof(input = rows(), currentText = CURRENT) {
  return resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: input, requesterUserId: "owner", currentUserMessageId: "u3", currentUserText: currentText,
  });
}

describe("검토 예산의 여행 제외와 결혼 예산 후속", () => {
  it.each([
    CURRENT,
    CURRENT.replace("빼기로 할게", "제외할게"),
    CURRENT.replace("빼기로 할게", "빼줘"),
  ])("제외절 자체는 W0가 아니며 기존 정본 두 쌍의 증명으로만 이어진다: %s", text => {
    expect(classifyAmoraQuestionScope({ userText: text })).toMatchObject({ scope: "W4_out_of_scope", confidence: "low", allowsLongTermMemory: false });
    const input = rows(); input[4].content = text;
    const continuity = proof(input, text);
    expect(continuity?.priorUserText).toBe(FIRST);
    expect(classifyAmoraQuestionScope({ userText: text, hasWeddingClarificationContinuity: Boolean(continuity) }))
      .toMatchObject({ scope: "W0_wedding_core", allowsLongTermMemory: false, rescuedByClarificationAnswer: true });
  });
  it.each([
    "여행 예산 검토용 두 안만 보여줘.",
    "여행은 이번 검토 예산에서 빼지 말고 검토용 두 안만 보여줘.",
    "여행은 이번 검토 예산에서 빼기로 할까? 검토용 두 안만 보여줘.",
    "‘여행은 이번 검토 예산에서 빼기로 할게.’라는 문장을 번역해줘. 검토용 두 안만 보여줘.",
    CURRENT + " 그리고 다른 여행 일정도 짜줘.",
    CURRENT + " 회사 예산에 적용해줘.",
    CURRENT + " 코인 매수 비율도 추천해줘.",
  ])("긍정 여행 과업·조건·인용·다른 과업으로 확대하지 않는다: %s", text => {
    const input = rows(); input[4].content = text;
    expect(proof(input, text)).toBeNull();
    expect(classifyAmoraQuestionScope({ userText: text }).scope).toBe("W4_out_of_scope");
  });
  it("현재 안전 신호가 있으면 이력으로 올리지 않는다", () => {
    const text = CURRENT + " 남편이 지금 나를 때리고 있어.";
    const input = rows(); input[4].content = text;
    expect(proof(input, text)).toBeNull();
    expect(classifyAmoraQuestionScope({ userText: text }).scope).toMatch(/^W[25]_/);
  });
  it.each(["reply", "actor", "visibility", "scope", "safety", "topic", "missing", "current", "anchor"] as const)("정본 증명 실패를 건너뛰지 않는다: %s", kind => {
    const input = rows();
    if(kind === "reply") input[3].metadata = {question_scope:"W0_wedding_core",in_reply_to_user_message_id:"wrong"};
    if(kind === "actor") input[2].sender_id = "partner";
    if(kind === "visibility") input[1].visibility = "bride_private";
    if(kind === "scope") input[1].metadata = {question_scope:"W4_out_of_scope",in_reply_to_user_message_id:"u1"};
    if(kind === "safety") input[2].content = "남편이 지금 나를 때리고 있어.";
    if(kind === "topic") input[2].content = "회사 회식 예산을 정하고 싶어.";
    if(kind === "missing") input.splice(0,2);
    if(kind === "current") input[4].content = "다른 말";
    if(kind === "anchor") input[0].content = "여름 여행 예산을 검토해줘.";
    expect(proof(input)).toBeNull();
  });
});
