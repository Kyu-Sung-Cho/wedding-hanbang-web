import { describe, expect, it } from "vitest";
import {
  findAmoraTrustClaims,
  screenAmoraTrustClaims,
} from "@/lib/ai/amoraTrustClaims";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";

// §11의 금지 표현은 프롬프트에만 적혀 있었다. 프롬프트는 요청이지 강제가 아니다 —
// 모델이 어기면 그대로 사용자에게 나갔다. 여기서 막는 말들은 성격이 같다:
// 사용자가 검증할 수 없는 약속이거나, 사람에 대한 판정이다.

function screen(text: string) {
  return screenAmoraTrustClaims(text).text;
}

describe("검증할 수 없는 약속을 걷어낸다", () => {
  it.each([
    ["보증", "제가 다 책임질게요.", "guarantee"],
    ["절대 안전", "100% 개인정보가 안전합니다.", "guarantee"],
    ["누락 없음", "아무것도 놓치지 않습니다.", "guarantee"],
    ["완벽 보장", "완벽하게 비용을 줄여드릴게요.", "guarantee"],
    ["안심 보증", "걱정 마세요, 아무 문제 없어요.", "guarantee"],
    ["경험 사칭", "제가 결혼해봐서 아는데요, 이건 이렇게 하셔야 해요.", "impersonation"],
    ["전문가 사칭", "전문가가 이미 확인했습니다.", "impersonation"],
    ["24시간 사칭", "제가 24시간 대기하고 있을게요.", "impersonation"],
    ["비밀 약속", "이건 우리 둘만의 비밀이에요.", "secrecy"],
    ["의존 유도", "아모라 없으면 놓치실 수 있어요.", "dependency"],
    ["맹신 유도", "제 말만 믿으세요.", "dependency"],
    ["역할 강요", "신부라면 당연히 준비하셔야죠.", "role_obligation"],
    ["역할 강요2", "신랑 측에서 해야 해요.", "role_obligation"],
    ["비교 압박", "다른 커플들은 다 이 정도는 씁니다.", "comparison_pressure"],
    ["궁합 판정", "두 분은 궁합이 좋으세요.", "verdict"],
    ["성향 판정", "상대방 성향은 이렇습니다.", "verdict"],
  ])("%s", (_label, text, kind) => {
    expect(findAmoraTrustClaims(text)).toContain(kind);
    expect(screen(text)).toBe("");
  });
});

describe("따뜻한 말과 사실 서술은 남긴다", () => {
  // 오탐의 대가도 실재한다 — 아모라가 사람다운 말을 못 하게 되면 그것도 실패다.
  it.each([
    "많이 걱정되셨겠어요.",
    "걱정 마세요, 하나씩 같이 정리해봐요.",
    "신랑 측에서 준비하는 경우가 많지만 가족마다 달라요.",
    "예단은 생략하는 커플도 많아요.",
    "계약서에 추가금 조건이 적혀 있는지 확인해보시면 좋겠어요.",
    "지금 확인된 예산은 3,000만원이에요.",
    "이 부분은 제가 확인할 수 없어서 업체에 직접 물어보셔야 해요.",
    "두 분이 각각 확인하시면 공동 결정으로 저장돼요.",
  ])("남긴다: %s", (text) => {
    expect(findAmoraTrustClaims(text)).toEqual([]);
    expect(screen(text)).toBe(text);
  });

  it("자기 규칙을 설명하는 문장은 지우지 않는다", () => {
    // 인용·부정 문맥까지 지우면 아모라가 자기 한계를 설명할 수 없다.
    const text = "저는 \"100% 안전합니다\"라는 말은 하지 않아요.";
    expect(screen(text)).toBe(text);
  });
});

describe("문장 단위로만 잘라낸다", () => {
  it("나머지 답변은 살린다", () => {
    const result = screenAmoraTrustClaims(
      "계약서에 추가금 조건이 있는지 보세요. 제가 다 책임질게요. 잔금일은 3월 2일이에요.",
    );
    expect(result.text).toContain("계약서에 추가금 조건");
    expect(result.text).toContain("잔금일은 3월 2일");
    expect(result.text).not.toContain("책임질게요");
    expect(result.removedCount).toBe(1);
  });

  it("적대적인 입력에도 던지지 않는다", () => {
    for (const hostile of [null, undefined, 42, {}, []]) {
      expect(() => screenAmoraTrustClaims(hostile as never)).not.toThrow();
      expect(screenAmoraTrustClaims(hostile as never).text).toBe("");
    }
  });
});

describe("실제 출력 경로에 붙어 있다", () => {
  it("제공자 산문이 검사를 거친다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "잔금일을 확인해보세요. 제가 다 책임질게요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain("책임질게요");
    expect(result.text).toContain("잔금일");
    // 서버가 문장을 걷어냈으면 그 답변은 더 이상 제공자 원문이 아니다.
    expect(result.source).toBe("server_correction");
    expect(result.corrected).toBe(true);
  });

  it("서버가 소유한 실행 결과 문구는 검사하지 않는다", () => {
    // 도구 결과 메시지는 모델이 쓴 것이 아니다. 검사하면 오히려 훼손된다.
    const result = composeAmoraPersistenceTerminal({
      text: "무시되는 제공자 문장",
      toolResults: [{
        toolName: "update_budget",
        toolInput: {},
        toolOutput: {},
        success: true,
        displayMessage: "총 예산을 3,000만원으로 변경했어요.",
      } as never],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).toBe("총 예산을 3,000만원으로 변경했어요.");
    expect(result.source).toBe("server_mutation_receipts");
  });

  it("깨끗한 답변은 그대로 통과한다", () => {
    const clean = "잔금일이 사흘 남았어요. 계좌를 업체에 확인해보시겠어요?";
    const result = composeAmoraPersistenceTerminal({
      text: clean,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).toBe(clean);
    expect(result.source).toBe("provider");
    expect(result.corrected).toBe(false);
  });
});
