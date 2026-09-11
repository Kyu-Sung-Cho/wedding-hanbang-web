import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "../amoraPromptComposer";

/**
 * **아모라가 있는 기능을 없다고 말하지 않게 한다.**
 *
 * 2026-09-02 운영 실측 — 30일간 3건에서 아모라가 이렇게 답했다:
 *
 *   "이 대화에서는 할 일을 실제로 저장하는 도구가 없어 아직 반영되지 않았어요."
 *   "이 대화에서는 체크리스트 상태를 변경하는 도구가 없어 …"
 *
 * 그 기능은 **있다.** 사용자가 확인 카드를 누르면 저장된다. 이번 턴에 그 도구가
 * 안 실렸을 뿐인데, 처음 온 사람은 "이 제품엔 그런 기능이 없다" 로 읽는다.
 *
 * ## 왜 원본이 아니라 합성된 프롬프트를 보는가
 *
 * 이 저장소의 `prompts.ts` 에는 **조립기가 통째로 지우는 죽은 구간**이 있다
 * (`## 도구 사용 핵심 규칙` ~ `### 카테고리 키`). 거기에 규칙을 써서 배포까지
 * 했다가 나중에 발견한 적이 있다. 그래서 검사는 **원본 파일이 아니라 실제로
 * 조립된 문자열**에 묻는다.
 */
const BASE_CONTEXT = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "사용자",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
};

/**
 * 운영이 부르는 모양 그대로 부른다 — `route.ts:3094` 를 보고 맞췄다.
 *
 * 테스트 입력이 운영과 다르면 초록불이 아무것도 증명하지 않는다. 이 저장소에서
 * 여러 번 그랬다(운영은 행 3개를 넘기는데 테스트는 5~7개를 넘겨, 다홉 구제가
 * 운영에서 한 번도 안 돌았는데 테스트는 초록이었다).
 */
function compose(toolNames: string[]): string {
  return buildAmoraSystemPrompt(
    { ...BASE_CONTEXT },
    {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: toolNames,
    } as Parameters<typeof buildAmoraSystemPrompt>[1],
  );
}

describe("기능을 부정하지 않는다", () => {
  it("이 검사가 쓰는 도구 이름이 실재한다", () => {
    // 지어낸 이름은 `KNOWN_TOOL_NAME_SET` 에서 걸러져 도구 계약 블록 자체가
    // 안 나간다 — 그러면 아래 검사들이 **다른 이유로** 빨개지거나, 더 나쁘게는
    // 규칙이 빠졌는데도 통과할 수 있다. 처음 쓸 때 실제로 그렇게 틀렸다.
    expect(compose(["get_budget_summary"])).toContain("현재 실행 가능한 도구 계약");
  });

  it("도구가 실린 턴의 프롬프트에 그 규칙이 들어간다", () => {
    const prompt = compose(["get_budget_summary", "update_budget"]);
    expect(prompt).toContain("제품에 그 기능이 없다는 뜻이 아닙니다");
  });

  it("규칙이 무엇을 하지 말라고 하는지 명시한다", () => {
    // 도구 선택 결과를 기능 부재로 옮기지 않고 가능한 확인 경로를 안내한다.
    const prompt = compose(["get_budget_summary"]);
    expect(prompt).toContain("이번 턴에 도구가 없어도 **제품에 그 기능이 없다는 뜻이 아닙니다.");
    expect(prompt).toContain("기능 부정 대신 변경 대상을 물어 확인 카드로 좁히세요");
  });

  it("저장 경로가 확인 카드라는 것을 함께 말한다", () => {
    // "안 된다" 만 알려 주면 모델이 이유 없이 거절한다. 대신 무엇을 하면
    // 되는지를 줘야 대화가 이어진다.
    expect(compose(["get_budget_summary"])).toContain("확인 카드");
  });

  it("개인 대화가 공유 계획을 안 바꾸는 이유를 말한다", () => {
    const privacyRule = compose(["get_budget_summary"]).split("\n")
      .find((line) => line.startsWith("- 개인 대화는")) ?? "";
    expect(privacyRule).toContain("상대방에게 비공개");
    expect(privacyRule).toContain("공유 예산·일정·할 일 변경은 함께 대화로 안내하세요");
    expect(privacyRule).toContain("탭 이동은 기존 공유 메시지의 공개 범위를 바꾸지 않습니다");
    expect(privacyRule).toContain("개인 할 일로 저장");
    expect(privacyRule).toContain("결과 없는 저장 성공은 금지");
  });

  it("도구가 하나도 없는 턴에는 이 계약이 실리지 않는다", () => {
    // 도구 계약 블록 자체가 안 나가는 자리다. 여기까지 규칙을 밀어 넣으면
    // 프롬프트 예산만 먹고 아무 일도 안 한다.
    expect(compose([])).not.toContain("제품에 그 기능이 없다는 뜻이 아닙니다");
  });
});
