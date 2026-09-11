import { describe, expect, it } from "vitest";
import { composeAmoraPersistenceTerminal } from "../amoraPersistenceClaims";

describe("개인 취향 기억 부탁에 대한 현재 응답", () => {
  it.each([
    ["나는 웨딩 장식으로 청록색 종이별을 쓰는 소박한 분위기를 좋아해. 이건 내가 정한 개인 취향으로 다음 나만 상담에서도 기억해줘. 파트너와 합의한 결정은 아니고, 공동 예산·일정·할 일은 바꾸지 마.",
      "청록색 종이별을 좋아하시는 것으로 기억해둘게요. 파트너와 합의한 결정이나 공동 예산·일정·할 일로 반영하지 않았어요."],
    ["개인 취향을 하나 더 분명히 말할게. 나는 반짝이는 금색 장식보다 무광 종이 장식을 더 좋아해. 앞으로 나만 상담에서 장식을 이야기할 때 이 선호를 기억해서 참고해줘.",
      "무광 종이 장식을 더 좋아하시는 것으로 기억해둘게요. 공동 예산·일정·할 일에는 반영하지 않아요."],
  ])("실제 시험의 취향 기억 부탁을 보존한다: %s", (userText, providerText) => {
    // 사용자 입력은 운영에서 확인한 원문이며 삭제된 모델 문장은 미저장이라 합성한다.
    const result = terminal(providerText, userText);
    expect(result.text).toContain("말씀하신 취향으로 이해했어요");
    expect(result.text).toContain("저장됐다고는 아직 확인할 수 없어요");
    expect(result.text).not.toContain("기억해둘게요");
    expect(result.text).not.toContain("공동 예산");
  });

  const request = "내 개인 취향으로 무광 종이 장식을 선호해. 기억해줘.";
  const brokenReply = "무광 종이 장식을 선호하시는 것으로 기억해둘게요. 공동 예산·일정·할 일에는 반영하지 않아요.";
  function terminal(text: string, userText: string | undefined = request,
    overrides: Partial<Parameters<typeof composeAmoraPersistenceTerminal>[0]> = {}) {
    return composeAmoraPersistenceTerminal({ text, toolResults: [], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: false,
      privatePreferenceMemoryRequestText: userText, ...overrides });
  }

  it.each([
    "내 개인 취향은 무광 종이 장식이야. 기억해줘.",
    "나는 무광 종이 장식을 좋아해. 내 개인 취향으로 기억해줘.",
    "무광 종이 장식을 선호하는 걸 제 취향으로 기억해 주세요.",
    "내 취향은 번쩍이는 장식을 좋아하지 않는 거야. 기억해줘.",
    "내 취향은 무광 종이야. 공동 예산에 반영하지 말고 기억해줘.",
    "공동 예산·일정·할 일은 변경하지 마. 내 취향은 무광 종이야. 기억해줘.",
    "내 취향은 무광 종이야. 기억해줘. 공동 예산·일정·할 일은 바꾸지 마.",
  ])("현재 본인의 선호·비선호 확인은 저장 주장 없이 답한다: %s", userText => {
    const result = terminal(brokenReply, userText);
    expect(result.text).toContain("취향으로 이해했어요");
    expect(result.text).not.toContain("기억해둘게요");
    expect(result.text).not.toContain("무광");
    expect(result.removedClaimCount).toBe(1);
  });

  it.each([
    '친구가 "내 취향은 무광 종이야. 기억해줘."라고 했어.',
    "내 취향 말고 상대방 취향으로 무광 종이를 기억해줘.",
    "내 취향은 무광 종이지만 기억하지 마.",
    "내 개인 취향은 무광 종이야. 기억해줘라는 문구를 설명해줘.",
    "내 개인 취향이 무광 종이라는 것을 기억하고 있어?",
    "만약 내 취향이 무광 종이라면 기억해줘.",
    "내 취향은 무광 종이야. 총예산도 알려주고 기억해줘.",
    "내 취향은 무광 종이야. 기억해줘. 총예산도 알려줘.",
    "내 취향은 무광 종이야. 예산을 수정하고 기억해줘.",
    "내 취향은 무광 종이야. 공동 예산에 반영하지 말고 가격도 알려주고 기억해줘.",
    "내 취향은 무광 종이야. 기억해줘. 공동 예산은 바꾸지 마. 개인 기억에도 넣지 마.",
    "공동 예산은 바꾸지 말고 일정은 추가해줘. 내 취향은 무광 종이야. 기억해줘.",
    "내 개인 할 일에 무광 종이 확인을 추가하고 취향으로 기억해줘.",
    "내 취향은 무광 종이야. 기억해줘, 그리고 상대에게 공유해줘.",
    "취향을 기억해줘.",
    "실내 취향은 무광 종이야. 기억해줘.",
  ])("인용·타인·금지·질문·추가 과업을 확인 문구로 덮지 않는다: %s", userText => {
    expect(terminal(brokenReply, userText).text).not.toContain("취향으로 이해했어요");
  });

  it("서버가 개인 요청 경계를 제공하지 않으면 기존 제거 동작을 유지한다", () => {
    const result = terminal(brokenReply, undefined, { privatePreferenceMemoryRequestText: undefined });
    expect(result.text).toBe("공동 예산·일정·할 일에는 반영하지 않아요.");
  });

  it.each([
    { hasPendingAction: true },
    { hasEmittedPendingAction: true },
    { userRequestedChange: true },
    { droppedPendingActionTag: true },
    { persistenceMode: "demo" as const },
  ])("실제 확인·변경·체험 경계를 대신하지 않는다: %j", overrides => {
    expect(terminal(brokenReply, request, overrides).text).not.toContain("취향으로 이해했어요");
  });

  it("이미 답한 취향 확인과 질문은 보존한다", () => {
    const result = terminal("무광 종이 장식을 선호하시는군요. 기억해둘게요. 어떤 장식에 쓰려고 하세요?");
    expect(result.text).toBe("무광 종이 장식을 선호하시는군요. 어떤 장식에 쓰려고 하세요?");
  });

  it("거짓 기억 약속이 없으면 잘못된 답변도 이 경계에서 임의 재작성하지 않는다", () => {
    const reply = "공동 예산·일정·할 일에는 반영하지 않아요.";
    expect(terminal(reply).text).toBe(reply);
    expect(terminal("어떤 장식에 쓰려고 하세요?").text).toBe("어떤 장식에 쓰려고 하세요?");
  });

  it("전체가 기억 약속뿐이어도 빈 답변 대신 현재 요청을 확인한다", () => {
    const result = terminal("무광 종이 선호로 기억해둘게요.");
    expect(result.text).toContain("취향으로 이해했어요");
    expect(result.text).not.toContain("지금은 답을 만들지 못했어요");
  });

  it("메모리와 별개의 저장 주장·신뢰 위반을 기억 확인으로 숨기지 않는다", () => {
    expect(terminal("예산을 저장했어요. 기억해둘게요.").text).not.toContain("취향으로 이해했어요");
    expect(terminal("기억해둘게요, 예산도 저장했어요.").text).not.toContain("취향으로 이해했어요");
    expect(terminal("비밀을 영원히 지켜드릴게요. 기억해둘게요.").text).not.toContain("취향으로 이해했어요");
  });

  it("서버 변경 영수증은 그대로 사용한다", () => {
    const result = terminal(brokenReply, request, { toolResults: [{
      toolName: "update_budget", toolInput: { total_budget: 1000 }, toolOutput: { success: true },
      success: true, displayMessage: "총예산을 1,000원으로 변경했어요.",
    }] });
    expect(result.text).toBe("총예산을 1,000원으로 변경했어요.");
    expect(result.source).toBe("server_mutation_receipts");
  });

  it("기억 약속을 제거해도 무관한 공동 기록 안내만 남기지 않는다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "무광 종이 장식을 선호하시는 것으로 기억해둘게요. 공동 예산·일정·할 일에는 반영하지 않아요.",
      toolResults: [], hasPendingAction: false, persistenceMode: "durable",
      userRequestedChange: false,
      privatePreferenceMemoryRequestText: "내 개인 취향으로 무광 종이 장식을 선호해. 기억해줘.",
    });
    expect(result.text).toContain("말씀하신 취향으로 이해했어요");
    expect(result.text).toContain("장기 기억에 저장됐다고는 아직 확인할 수 없어요");
    expect(result.text).not.toContain("기억해둘게요");
    expect(result.text).not.toContain("공동 예산");
    expect(result.removedClaimCount).toBe(1);
    expect(result.source).toBe("server_correction");
  });
});
