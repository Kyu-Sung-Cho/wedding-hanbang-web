import { describe, expect, it } from "vitest";
import { getAmoraPlanningTurn, type AmoraPlanningTurnInput } from "../amoraPlanningTurn";

const PIVOT = "생각이 바뀌었어. 180명 일반웨딩 말고 그냥 40명만 부르는 가족식으로 할래.";
const QUESTION = "40명 가족식으로 바꾸신 이유를 먼저 여쭤봐도 될까요? 이유를 알아야 기존에 유지할 기준과 다시 확인할 항목을 정확히 나눌 수 있어요.";
const REASON = "비용도 부담되고 준비 과정도 너무 복잡하게 느껴져서 그래. 큰 결혼식이 우리 취향도 아닌 것 같아. 날짜 후보는 9월보다 10월이 더 좋아. 이건 그냥 선호가 바뀐 거야.";

function fixture(prior = PIVOT, question = QUESTION, current = REASON): AmoraPlanningTurnInput {
  const rows = [
    { id: "prior", sender_id: "actor", sender_type: "bride", role: "user", content: prior, visibility: "shared", segment_id: "segment", metadata: { target: "ai" } },
    { id: "answer", sender_id: null, sender_type: "ai", role: "assistant", content: question, visibility: "shared", segment_id: "segment", metadata: { target: "ai", in_reply_to_user_message_id: "prior", question_scope: "W0_wedding_core" } },
    { id: "current", sender_id: "actor", sender_type: "bride", role: "user", content: current, visibility: "shared", segment_id: "segment", metadata: { target: "ai" } },
  ];
  return { requestKind: "chat", durable: true, scope: "W0_wedding_core", allowsStoredProviderContext: true,
    preparationStatus: "preparing", hasPriorityAction: false, hasAttachments: false, actorId: "actor",
    currentUserMessageId: "current", currentUserText: current, oldestFirstRows: rows,
    providerMessages: rows.map(row => ({ id: row.id, role: row.role, content: row.role === "user" ? `[신부] ${row.content}` : row.content })) };
}

describe("현재 정본과 실제 provider 입력에 함께 남은 방향 변경 이유 후속", () => {
  it("실제 실패 대본의 이유 답변만 선택하며 값을 추출하거나 저장하지 않는다", () => {
    const input = fixture(); const before = structuredClone(input);
    expect(getAmoraPlanningTurn(input)).toBe("pivot_reason_followup");
    expect(input).toEqual(before);
  });
  it.each([
    ["결혼식 지역을 부산에서 강릉으로 바꿀래.", "결혼식 지역을 바꾼 이유를 여쭤봐도 될까요?", "부모님이 장거리 이동하기 어려워서야."],
    ["결혼식 하객을 240명에서 90명으로 줄일래.", "하객 규모를 줄인 이유가 무엇인가요?", "준비 부담이 커서 그래."],
    ["결혼식 하객을 50명에서 150명으로 늘릴래.", "하객 규모를 늘린 이유를 알려주실래요?", "초대할 가족이 늘었기 때문이야."],
    [PIVOT, QUESTION, "준비 부담 때문이야. 사진은 이제 중요하지 않아. 날짜 후보는 11월이 더 좋아."],
  ])("다른 실제 준비 전환과 현재 바뀐 선호도 수용한다: %s", (prior, question, reason) => {
    expect(getAmoraPlanningTurn(fixture(prior, question, reason))).toBe("pivot_reason_followup");
  });
  it("중립 접두어와 원문 입력도 같은 ID에서만 허용한다", () => {
    for (const prefix of ["[사용자] ", ""]) {
      const input = fixture(); input.providerMessages = input.providerMessages.map((m, i) => ({ ...m, content: m.role === "user" ? prefix + input.oldestFirstRows[i].content : m.content }));
      expect(getAmoraPlanningTurn(input)).toBe("pivot_reason_followup");
    }
  });
  it.each([
    { durable: false }, { requestKind: "mediation" }, { requestKind: "initial_greeting" },
    { scope: "W2_high_risk_adjacent" }, { scope: "W3_social_care" }, { scope: "W4_out_of_scope" }, { scope: "W5_safety_priority" },
    { allowsStoredProviderContext: false }, { preparationStatus: "paused" }, { preparationStatus: "called_off" }, { preparationStatus: null },
    { hasPriorityAction: true }, { hasAttachments: true }, { actorId: "other" }, { currentUserMessageId: "old" }, { currentUserText: "다른 현재 발화" },
  ])("요청·현재 권한·상태가 달라지면 기존 경로: %j", patch => {
    expect(getAmoraPlanningTurn({ ...fixture(), ...patch })).toBeNull();
  });
  it.each([
    "비용 때문이야. 지금은 그냥 들어줘.", "비용 때문이야. 이유를 더 말하기 싫어.",
    "비용 때문이야. 결혼식을 취소했어.", "비용 때문이야. 준비를 연기할래.",
    "폭력을 당해서 그래.", "비용 때문이야. 회사 보고서도 써줘.",
    "비용 때문이야. 예산에 저장해 주실래요?", "비용 때문이야. 근처 식당 찾아줘.",
    "비용 때문이야. 내 개인 할 일 초안을 만들어줘.", "비용 때문이야. 두 안을 비교해줘.",
    "친구가 비용 때문이라고 했어.", "만약 비용 때문이라면 어떻게 해?", "비용 때문일 수도 있다고 가정해봐.",
    '친구가 "비용 때문이야"라고 했어.', "> 비용 때문이야", "```\n비용 때문이야\n```",
    "날짜 후보는 10월이 더 좋아.", "왜 바꿨냐고 묻는 이유가 뭐야?", "그 이유는 앞에서 이미 말했어.",
    "비용 때문이 아니야.",
  ])("현재의 다른 부탁·거부·인용·미응답을 이유 답변으로 합치지 않는다: %s", current => {
    expect(getAmoraPlanningTurn(fixture(PIVOT, QUESTION, current))).toBeNull();
  });
  it.each([
    ["결혼식 후보를 9월에서 10월로 바꿀래.", QUESTION],
    ["결혼식 하객을 180명에서 170명으로 줄일래.", "하객 규모를 줄인 이유가 무엇인가요?"],
    ["결혼식 하객은 180명이고 가족식도 좋아.", QUESTION],
    ["친구가 결혼식을 가족식으로 바꿀 거래.", QUESTION],
    ["만약 결혼식을 가족식으로 바꾼다면?", QUESTION],
    [PIVOT, "신혼집이 중요한 이유가 무엇인가요?"],
    [PIVOT, "제가 제안한 결혼식 방향을 바꾼 이유가 무엇인가요?"],
    [PIVOT, "40명 가족식으로 바꾼 이유를 이미 들었어요."],
    [PIVOT, '친구가 "40명 가족식으로 바꾼 이유가 뭔가요?"라고 했어요.'],
    [PIVOT, "결혼식 날짜를 바꾼 이유가 무엇인가요?"],
    [PIVOT, "결혼식 사진 촬영 구성을 바꾼 이유가 무엇인가요?"],
    [PIVOT, "40명 가족식으로 바꾸신 건 알겠어요. 신혼집이 중요한 이유를 먼저 여쭤볼까요?"],
    ["결혼식 지역을 부산에서 강릉으로 바꿀래.", "하객 규모를 줄인 이유가 무엇인가요?"],
    ["결혼식은 가족식도 좋아. 초대장 디자인을 바꿀래.", QUESTION],
    ["결혼식을 가족식으로 바꾸려는 건 아니야.", QUESTION],
    ["비용 부담 때문이야. 결혼식을 가족식으로 바꿀래.", QUESTION],
    ["신랑은 결혼식을 가족식으로 바꿀 생각이야.", "가족식으로 바꾼 이유가 무엇인가요?"],
  ])("이전 과업 또는 질문 대상이 다르면 선택하지 않는다: %s", (prior, question) => {
    expect(getAmoraPlanningTurn(fixture(prior, question))).toBeNull();
  });
  it("W1과 같은 본인 개인 레인도 같은 원문 증거를 요구한다", () => {
    const input = fixture(); input.scope = "W1_wedding_adjacent";
    input.oldestFirstRows = input.oldestFirstRows.map(row => ({ ...row, visibility: "bride_private", segment_id: null }));
    expect(getAmoraPlanningTurn(input)).toBe("pivot_reason_followup");
  });
  it.each([
    { index: 0, values: { sender_id: "other" } }, { index: 1, values: { sender_id: "actor" } },
    { index: 1, values: { metadata: { target: "ai", in_reply_to_user_message_id: "other", question_scope: "W0_wedding_core" } } },
    { index: 0, values: { metadata: { target: "partner" } } }, { index: 2, values: { metadata: { target: "partner" } } },
    { index: 1, values: { visibility: "bride_private" } }, { index: 0, values: { visibility: "bride_private" } },
    { index: 0, values: { segment_id: "old-segment" } }, { index: 1, values: { segment_id: null } },
  ])("원본 소유/레인/응답/segment 경계를 지킨다: %j", ({ index, values }) => {
    const input = fixture(); input.oldestFirstRows = input.oldestFirstRows.map((r, i) => i === index ? { ...r, ...values } : r);
    expect(getAmoraPlanningTurn(input)).toBeNull();
  });
  it("원본 사이에 숨겨진 행이 있으면 필터 뒤의 인접함을 믿지 않는다", () => {
    const input = fixture(); input.oldestFirstRows = [input.oldestFirstRows[0], { ...input.oldestFirstRows[0], id: "intervening" }, ...input.oldestFirstRows.slice(1)];
    expect(getAmoraPlanningTurn(input)).toBeNull();
  });
  it.each(["missing-id", "wrong-id", "wrong-role", "truncated-user", "changed-assistant", "extra-prefix", "missing-pair", "duplicate-raw-id"])("실제 provider 입력과 정확히 같은 메시지여야 한다: %s", change => {
    const input = fixture(); const messages = input.providerMessages.map(m => ({ ...m }));
    if (change === "missing-id") delete messages[0].id;
    if (change === "wrong-id") messages[0].id = "other";
    if (change === "wrong-role") messages[1].role = "user";
    if (change === "truncated-user") messages[0].content = "[이전 메시지 앞부분 생략]\n" + PIVOT.slice(5);
    if (change === "changed-assistant") messages[1].content += "\n[이전 도구 기록]";
    if (change === "extra-prefix") messages[0].content = `[신부] [신부] ${PIVOT}`;
    if (change === "missing-pair") messages.shift();
    if (change === "duplicate-raw-id") input.oldestFirstRows = [input.oldestFirstRows[0], ...input.oldestFirstRows];
    input.providerMessages = messages; expect(getAmoraPlanningTurn(input)).toBeNull();
  });
});
