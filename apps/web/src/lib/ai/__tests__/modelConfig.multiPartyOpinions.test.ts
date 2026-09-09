import { describe, expect, it } from "vitest";
import { chooseAmoraChatModelRole } from "../modelConfig";

function roleFor(userText: string, correctionCount = 0) {
  return chooseAmoraChatModelRole({
    specialistType: "general",
    userText,
    correctionCount,
  });
}

describe("multi-party opinion routing recovery", () => {
  it.each([
    "공개된 두 사람의 의견을 차례로 전달할게. A의 의견: “나는 이동이 편한 대전 시내에서 120명 안팎의 정식 예식을 하고 싶어. 가족 접근성과 격식을 중요하게 생각해.”",
    "공개된 두 사람의 의견을 차례로 전달할게. B의 의견: “나는 우리 집안 친척 관계 때문에 180~200명은 초대해야 한다고 생각해. 대신 총예산 3,500만 원은 지키고 싶어.”",
    "앞에서 전달한 A와 B의 공개 의견을 기준으로 이제 둘의 의견을 중재해줘. 누가 양보하라고만 하지 말고, 각자 밑바탕 가치가 뭔지 짚고 예산·하객·장소를 묶은 절충안 3개와 추천 1순위를 제시해.",
  ])("keeps the frozen public opinion delivery/review turn on fast: %s", (text) => {
    expect(roleFor(text)).toBe("fast");
  });

  it.each([
    "각자의 입장을 비교해 주세요.",
    "서로의 조건을 정리해줘.",
    "두 분의 의견을 조율해줄래?",
    "우리 둘의 입장을 전달합니다.",
    "두 사람의 의견을 먼저 정리해줘. 중재하지는 마.",
  ])("keeps ordinary opinion delivery and review on fast: %s", (text) => {
    expect(roleFor(text)).toBe("fast");
  });

  it.each([
    "두 사람의 의견을 중재하지 마. 내 예산만 저장해줘.",
    "서로의 의견을 비교하는 법을 설명해줘.",
    "중재는 무슨 뜻이야?",
    "만약 서로의 의견을 중재한다면 어떻게 될까?",
    "필요하다면 두 사람의 의견을 정리해줘.",
    "나중에 두 사람의 의견을 전달할게.",
    "두 사람의 의견은 나중에 전할게. 지금 내 예산을 정리해줘.",
    "의견 정리를 하지 않아도 돼.",
    "우리 둘의 예산을 3,500만 원으로 저장해줘.",
    "결혼 준비 순서를 정리해줘.",
    "두 사람의 의견이 달라. 내 예산 조건을 정리해줘.",
    "‘두 사람의 의견을 전달할게.’라는 문장을 다듬어줘.",
    '"각자의 입장을 비교해 주세요."라는 표현의 의미를 알려줘.',
    "예문: 서로의 의견을 중재해줘.",
    "예시로 서로의 의견을 중재해줘.",
    "> 두 사람의 의견을 정리해줘.\n위 문장을 공손하게 바꿔줘.",
    "```text\n둘의 의견을 중재해줘.\n```\n이 예문을 번역해줘.",
    "`두 사람의 의견을 전달할게.`의 띄어쓰기를 확인해줘.",
  ])("does not promote quoted, hypothetical or unrelated tasks: %s", (text) => {
    expect(roleFor(text)).toBe("fast");
  });

  it.each([
    "두 사람의 의견을 정리해줘. 예산 탭에 저장해줘.",
    "각자의 입장을 비교해 주세요. 결정한 예산을 반영해 주세요.",
    "서로의 조건을 조율해줘. 제안도 승인해줘.",
    "둘의 의견을 정리해줘. 이 일정은 등록 좀 해줘.",
    "예산에 반영 부탁해. 두 분의 의견을 비교해줘.",
    "두 사람의 의견을 정리해줘. 예산에 저장해.",
    "두 사람의 의견을 정리해줘. 결정한 예산을 반영해 줄 수 있어?",
    "두 사람의 의견을 정리해줘. 제안을 승인해 주실래요?",
    "예산을 저장하고 두 사람의 의견을 정리해줘.",
  ])("keeps explicit execution mixed into opinion review on the existing route: %s", (text) => {
    expect(roleFor(text)).toBe("fast");
  });

  it("keeps a quoted storage request inside opinion delivery on fast", () => {
    expect(roleFor("두 사람의 의견을 차례로 전달할게. 한 사람은 ‘예산에 저장해줘.’라고 했어.")).toBe("fast");
  });

  it("does not cancel existing correction or crisis escalation", () => {
    expect(roleFor("둘의 의견을 정리해줘. 예산에 저장해줘.", 2)).toBe("primary");
    expect(roleFor("둘의 의견을 정리해줘. 상대가 협박하고 있어. 예산에 저장해줘.")).toBe("primary");
  });
});
