import { describe, expect, it } from "vitest";

import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 모델이 낸 변경 표식이 서버 검증에서 버려지면 카드가 안 나온다.
 *
 * 지어낸 도구 이름이나 선언되지 않은 필드가 하나만 있어도 표식이 통째로
 * 버려진다(`hasOnlyDeclaredTopLevelKeys`). 그건 옳다 — 검증을 느슨하게 만들면
 * 지어낸 값으로 카드가 나간다.
 *
 * 문제는 **그 뒤에 아무 말도 안 나가는 것**이었다. 모델 본문이 거짓 성공을
 * 주장하면 `composeAmoraPersistenceTerminal` 이 지우고 안내를 붙이지만,
 * 중립적으로 쓰여 있으면 지울 것이 없어 안내도 없다:
 *
 *   사용자: 신혼여행 예산 500만원으로 잡아줘
 *   아모라: 신혼여행 예산을 500만 원으로 정리해 볼게요.   ← 카드 없음, 안내 없음
 *   (아무것도 저장되지 않음)
 *
 * 사용자는 평범한 답을 읽고 저장됐다고 믿는다. 2026-08-25 적대적 검토.
 */

const MUTATING_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const NOTICE = "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요";

function extract(markerText: string) {
  return extractAmoraPendingAction({
    text: markerText,
    allowedTools: MUTATING_TOOLS,
    now: 1_787_600_000_000,
    createActionId: () => "11111111-2222-4333-8444-555555555555",
  });
}

function compose(text: string, dropped: boolean) {
  return composeAmoraPersistenceTerminal({
    text,
    toolResults: [],
    hasPendingAction: false,
    persistenceMode: "durable",
    userRequestedChange: true,
    droppedPendingActionTag: dropped,
  });
}

describe("서버가 표식을 버릴 때", () => {
  it("지어낸 필드가 있으면 표식이 버려진다 — 전제 확인", () => {
    // 이 전제가 무너지면(검증이 느슨해지면) 아래 검사의 의미가 달라진다.
    const dropped = extract(
      '신혼여행 예산을 정리해 볼게요.[pending_action]{"tool":"update_category_budget","input":{"category":"honeymoon","amount":5000000}}[/pending_action]',
    );
    expect(dropped.hadPendingActionTag).toBe(true);
    expect(dropped.pendingAction).toBeNull();
  });

  it("올바른 표식은 그대로 카드가 된다 — 대조군", () => {
    const ok = extract(
      '신혼여행 예산을 정리해 볼게요.[pending_action]{"tool":"update_category_budget","input":{"category":"honeymoon","budget":5000000}}[/pending_action]',
    );
    expect(ok.pendingAction).not.toBeNull();
  });

  it("중립적으로 쓰인 본문에도 반영되지 않았다고 알린다", () => {
    // 여기가 조용했던 자리다. 지울 거짓 주장이 없으니 안내도 없었다.
    const result = compose("신혼여행 예산을 500만 원으로 정리해 볼게요.", true);
    expect(result.text).toContain(NOTICE);
    expect(result.corrected).toBe(true);
  });

  it("표식이 멀쩡했던 턴에는 그 안내를 붙이지 않는다", () => {
    const result = compose("신혼여행 예산을 500만 원으로 정리해 볼게요.", false);
    expect(result.text).not.toContain(NOTICE);
    expect(result.text).toBe("신혼여행 예산을 500만 원으로 정리해 볼게요.");
  });

  it("모델이 쓴 본문은 지우지 않는다", () => {
    // 안내만 덧붙인다. 사용자가 읽던 내용을 통째로 없애면 무슨 일이 있었는지
    // 알 수 없다.
    const body = "신혼여행 예산을 500만 원으로 정리해 볼게요.";
    expect(compose(body, true).text.startsWith(body)).toBe(true);
  });

  it("거짓 성공 주장이 있으면 예전처럼 지우고 안내한다", () => {
    const result = compose("신혼여행 예산을 500만 원으로 저장했어요.", true);
    expect(result.text).not.toContain("저장했어요");
    expect(result.text).toContain(NOTICE);
  });
});
