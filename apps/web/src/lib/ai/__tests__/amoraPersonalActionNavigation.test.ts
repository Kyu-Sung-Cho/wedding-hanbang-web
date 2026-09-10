import { describe, expect, it } from "vitest";
import { getSharedPersonalActionNavigationReply, type SharedPersonalActionNavigationContext } from "../amoraPersonalActionNavigation";

const request = "아래 할 일은 상대에게 보이지 않게 나만 저장하고 싶어. 공유 할 일이나 예산, 일정에는 넣지 마. 제목: 사진 살펴보기 / 내용: 내가 좋아하는 예식 사진을 혼자 살펴보기 / 마감: 2026-09-17. 지금 이 함께 대화에서는 어디로 가야 하는지만 알려줘.";
const context: SharedPersonalActionNavigationContext = {
  userText: request, visibility: "shared", requestKind: "chat",
  questionScope: "W0_wedding_core", durable: true, isDemo: false,
  hasPriorityAction: false, hasAttachments: false,
};

describe("shared personal action navigation", () => {
  it("points to the real private tab without implying existing shared messages become private", () => {
    const reply = getSharedPersonalActionNavigationReply(context);
    expect(reply).toContain("상단의 ‘나만 (상담)’");
    expect(reply).toContain("그곳에서 답변 아래");
    expect(reply).toContain("기존 메시지의 공개 범위는 바뀌지 않아요");
    expect(reply).not.toContain("共有");
    expect(reply).not.toContain("저장했");
    expect(reply).not.toContain("2026-09-17");
  });
  it("accepts a separate plain request for the private task route only", () => {
    expect(getSharedPersonalActionNavigationReply({ ...context, userText: "개인 할 일을 저장하려면 어떤 화면으로 가는지만 알려줘." })).not.toBeNull();
  });
  it.each([
    "내 개인 할 일 목록을 보여줘.",
    "내 개인 할 일 초안을 만들어줘.",
    "공유 할 일을 추가해줘. 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "총예산을 알려줘. 내 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "개인 할 일은 어디로 가야 하는지만 알려줘 그리고 총예산도 알려줘.",
    "내 개인 할 일 저장 방법만 알려주고 총예산을 정리해줘.",
    "총예산도 알려줘 그리고 내 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "총예산을 정리해주고 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "총예산을 정리하고 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "상대의 개인 할 일은 어디로 가야 하는지만 알려줘.",
    "‘개인 할 일을 저장하려면 어디로 가야 하는지만 알려줘.’ 이 문구를 설명해줘.",
    "> 개인 할 일을 저장하려면 어디로 가야 하는지만 알려줘.",
    "개인 할 일은 어디로 가야 하는지만 알려주지 마.",
    "사진 저장은 어디로 가야 하는지만 알려줘.",
  ])("does not replace a different task: %s", userText => {
    expect(getSharedPersonalActionNavigationReply({ ...context, userText })).toBeNull();
  });
  it.each<Partial<SharedPersonalActionNavigationContext>>([
    { visibility: "bride_private" }, { visibility: "groom_private" },
    { isDemo: true }, { durable: false }, { requestKind: "mediation" },
    { hasPriorityAction: true }, { hasAttachments: true },
    { questionScope: "W2_high_risk_adjacent" }, { questionScope: "W3_social_care" },
    { questionScope: "W4_out_of_scope" }, { questionScope: "W5_safety_override" },
  ])("preserves other scope and priority contracts: %j", overrides => {
    expect(getSharedPersonalActionNavigationReply({ ...context, ...overrides })).toBeNull();
  });
});
