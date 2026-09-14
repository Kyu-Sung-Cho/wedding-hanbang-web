import { describe, expect, it } from "vitest";
import {
  SERVER_OWNED_EMPTY_ANSWER_NOTICE,
  SERVER_OWNED_UNVERIFIED_NOTICE,
  composeAmoraPersistenceTerminal,
  isExplicitAmoraChangeRequest,
} from "@/lib/ai/amoraPersistenceClaims";

/**
 * **영향만 물어본 턴에 "반영되지 않았어요" 가 나가면 안 된다.**
 *
 * 2026-09-03 보고: "예식 월만 6월에서 5월로 바꿀게, 영향만 짧게" — 변경을 요청하지
 * 않고 영향만 물은 턴에 저장 주장 가드가 걸려 "실제 실행 결과가 확인되지 않아 이
 * 변경은 아직 반영되지 않았어요…" 가 붙었다.
 *
 * 이 워크트리에서 그 턴 모양을 직접 태워 재현한 것은 **가정절**이다.
 * "5월로 변경했을 때 달라지는 항목은 없어요."·"바꿨을 때 영향은 크지 않아요." 가
 * `변경했`·`바꿨` 만으로 저장 주장이 됐고, 결과는 문장 하나가 지워지는 정도가
 * 아니라 **답변이 통째로 사라지고** 그 자리에 위 안내가 나가는 것이었다.
 * (보고에 적힌 "바뀌는 내용은 없습니다" 형태 자체는 이 판본에서 원래 안 걸린다 —
 * 아래 코퍼스가 그것도 함께 못 박는다.)
 *
 * 양쪽을 함께 잠근다 — 가정·무변경 서술은 그대로 나가고, 진짜 주장은 그대로 잡힌다.
 */

function terminal(text: string) {
  return composeAmoraPersistenceTerminal({
    text,
    toolResults: [],
    hasPendingAction: false,
    persistenceMode: "durable",
    userRequestedChange: true,
  });
}

describe("가정·무변경 서술은 저장 주장이 아니다", () => {
  const notAClaimCorpus = [
    // 가정절 — 이번 결함의 실제 모양.
    "5월로 변경했을 때 달라지는 항목은 없어요.",
    "예식 월을 5월로 바꿨을 때 영향은 크지 않아요.",
    "5월로 변경했다면 계약금 일정이 달라졌을 거예요.",
    "6월에서 5월로 수정했을 경우 준비 기간이 한 달 줄어요.",
    "지금 적용했으면 예산에는 변화가 없어요.",
    "일정을 추가했는지 먼저 확인해 볼게요.",
    // 무변경·부정 서술.
    "현재 일정에서 바뀌는 내용은 없습니다.",
    "변경된 것은 없어요.",
    "반영할 것이 없어요.",
    "아직 아무것도 변경하지 않았어요.",
    "이 변경은 아직 저장되지 않았어요.",
    "지금 저장된 정보에서 변경되는 부분은 없어요.",
  ];

  it.each(notAClaimCorpus)("그대로 내보낸다: %s", (text) => {
    const result = terminal(text);
    expect(result.removedClaimCount).toBe(0);
    expect(result.text).toBe(text);
    expect(result.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
    expect(result.source).toBe("provider");
  });

  const realClaimCorpus = [
    "예산을 5,000만원으로 반영했어요.",
    "예식일을 5월 3일로 변경했어요.",
    "체크리스트를 완료 처리했습니다.",
    "일정에 등록할게요.",
    "게스트 명단에 추가하겠습니다.",
    "말씀하신 내용을 기억해 둘게요.",
  ];

  it.each(realClaimCorpus)("진짜 주장은 그대로 잡는다: %s", (text) => {
    const result = terminal(text);
    expect(result.removedClaimCount).toBeGreaterThan(0);
    expect(result.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
    expect(result.source).toBe("server_correction");
  });

  it("한 문장에 가정과 주장이 섞이면 주장만 지운다", () => {
    const result = terminal(
      "5월로 변경했을 때 달라지는 항목은 없어요. 예산은 5,000만원으로 반영했어요.",
    );
    expect(result.text).toContain("5월로 변경했을 때 달라지는 항목은 없어요.");
    expect(result.text).not.toContain("예산은 5,000만원으로 반영했어요.");
    expect(result.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
    expect(result.removedClaimCount).toBe(1);
  });

  it("문장 뒤쪽의 부정은 앞의 주장을 가려 주지 않는다", () => {
    // 예외는 매치 지점에 붙여서만 본다. 이 문장이 통과하면 예외가 너무 넓은 것이다.
    const result = terminal("예산은 5,000만원으로 반영했고 더 남은 건 없어요.");
    expect(result.removedClaimCount).toBe(1);
    expect(result.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("같은 입력에 같은 결과", () => {
    for (const text of [...notAClaimCorpus, ...realClaimCorpus]) {
      const first = terminal(text);
      const second = terminal(text);
      expect(second).toEqual(first);
    }
  });
});

describe("변경을 요청한 문장만 요청으로 센다 (2026-09-04 팀원 2차 대본 재실행)", () => {
  it("사실을 말한 문장은 요청이 아니다 — 도구가 열렸어도 '반영되지 않았어요' 를 붙이지 않는다", () => {
    for (const text of [
      "시기는 2028년 5월이나 6월쯤. 날짜는 아직.",
      "지역은 대전 아니면 청주. 하객은 90명 안팎으로 보고 있어.",
      "친구는 스드메에 600만원 썼대",
      "우리 예산은 대충 4천 정도야",
    ]) {
      expect(isExplicitAmoraChangeRequest(text), text).toBe(false);
    }
  });

  it("추가·등록·바꿔·반영·저장 같은 요청 동사가 있으면 요청이다", () => {
    for (const text of [
      "10월 3일에 드레스 투어 일정 넣어줘",
      "우리 총 예산 4000만원으로 잡아줘",
      "예식장 예산을 1500만원에서 1800만원으로 바꿔줘",
      "앞에서 만든 배분표 그대로 예산에 반영해줘",
      "할 일에 '양가 어머님 한복 맞추기' 추가해줘",
      "그 일정 취소해줘",
    ]) {
      expect(isExplicitAmoraChangeRequest(text), text).toBe(true);
    }
  });

  // 3차 검토(2026-09-14): 부분일치라 "설정돼 있는 거 맞아?" 의 `설정` 이 요청으로 읽혔다.
  // 상태를 **묻는** 발화는 요청이 아니다 — 뒤에 변경 요청이 이어지면 그것만 요청이다.
  it("상태를 묻는 문장은 요청이 아니다", () => {
    for (const text of [
      "예산 설정돼 있는 거 맞아?",
      "상견례 일정 등록돼 있어?",
      "드레스 예산 반영됐어?",
      "총예산 설정돼 있나요?",
    ]) {
      expect(isExplicitAmoraChangeRequest(text), text).toBe(false);
    }
    for (const text of [
      "예산 설정돼 있어? 아니면 5천으로 바꿔줘",
      "드레스 예산 반영됐어? 안 됐으면 반영해줘",
    ]) {
      expect(isExplicitAmoraChangeRequest(text), text).toBe(true);
    }
  });

  it("요청이 아닌 턴에는 안내가 안 붙고, 요청한 턴에는 붙는다", () => {
    const neutral = "다음은 예상 하객 수를 대략 잡는 단계예요. 양쪽 합쳐 몇 명 정도로 생각하세요?";
    const notRequested = composeAmoraPersistenceTerminal({
      text: neutral,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: false,
    });
    expect(notRequested.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
    expect(notRequested.text).toBe(neutral);
  });
});

describe("읽기 턴과 되묻기 턴은 저장 안내를 받지 않는다 (2026-09-05 페르소나 실측)", () => {
  const readReceipt = { toolName: "get_budget_summary", toolInput: {}, toolOutput: { categories: { dress: { allocated: 4500000 } } }, success: true, displayMessage: "" };

  it("읽기 도구가 성공한 턴의 상태 서술('…으로 설정되어 있어요')은 지우지 않는다", () => {
    const text = "드레스·예식 정장 예산은 현재 450만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [readReceipt as never], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: false,
    });
    expect(result.text).toBe(text);
    expect(result.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  // 2026-09-14: 프롬프트가 예산 요약·등록된 일정을 문맥에 인라인하므로 읽기 턴은 도구를
  // 안 돌린다. 영수증이 없다는 이유로 이 문장을 지우면 답이 통째로 사라진다
  // (amoraPersistenceClaims.test.ts 의 2026-09-14 블록이 상세를 든다).
  it("읽기 영수증이 없어도 변경 요청이 아닌 턴의 상태 서술은 남긴다", () => {
    const text = "드레스 예산은 450만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: false, userTurnIsChangeRequest: false,
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
  });

  // 3차 검토(2026-09-14): 2차 수정이 "…반영되어 있어요" 를 무조건 지우고, 이월 카드가 실린
  // 턴의 상태 서술도 영수증과 무관하게 지웠다. 성공한 읽기 영수증은 HEAD 처럼 검증으로 친다.
  it("읽기 영수증이 있으면 '…반영되어 있어요' 도 상태 서술이다", () => {
    const text = "드레스 예산은 450만 원으로 반영되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [readReceipt as never], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: false, userTurnIsChangeRequest: false,
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
  });

  it("이월 카드가 실린 턴이라도 성공한 읽기 영수증이 있으면 상태 서술을 남긴다", () => {
    const text = "드레스 예산은 450만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [readReceipt as never], hasPendingAction: false, hasEmittedPendingAction: true,
      persistenceMode: "durable", userRequestedChange: false, userTurnIsChangeRequest: false,
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
  });

  it("상태 질문 턴의 참 답은 거짓 사과로 바뀌지 않는다", () => {
    const ask = "드레스 예산 반영됐어?";
    const text = "드레스 예산은 450만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [readReceipt as never], hasPendingAction: false, persistenceMode: "durable",
      userRequestedChange: isExplicitAmoraChangeRequest(ask),
      userTurnIsChangeRequest: isExplicitAmoraChangeRequest(ask),
    });
    expect(result.text).toBe(text);
    expect(result.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("변경 요청 턴에서는 읽기 영수증이 있어도 실행 주장('변경했어요')은 지운다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "드레스 예산을 450만 원으로 변경했어요.", toolResults: [readReceipt as never], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: true,
    });
    expect(result.text).not.toContain("변경했어요");
  });

  it("되묻기로 끝난 답(물음표)에는 '다시 요청해주세요' 안내를 붙이지 않는다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "등록할게요. “다음 달 15일”은 2026년 10월 15일로 이해하면 될까요?",
      toolResults: [], hasPendingAction: false, persistenceMode: "durable", userRequestedChange: true, droppedPendingActionTag: true,
    });
    expect(result.text).toContain("이해하면 될까요?");
    expect(result.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("변경을 요청하지 않은 턴의 빈 본문은 '반영되지 않았어요'가 아니라 중립 문장으로 남긴다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산을 저장했어요.", toolResults: [], hasPendingAction: false,
      persistenceMode: "durable", userRequestedChange: false,
    });
    expect(result.removedClaimCount).toBe(1);
    expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
  });
});

describe("요청 없는 제안 실패는 대화 접수를 실행 실패로 바꾸지 않는다", () => {
  const acknowledgement = "두 사람이 예단과 폐백을 생략하기로 했다고 말씀하셨어요. 생략 기준으로 이해했어요.";
  const baseInput = {
    toolResults: [],
    hasPendingAction: false,
    persistenceMode: "durable" as const,
    droppedPendingActionTag: true,
  };

  it("요청 없이 표식만 버린 턴은 접수 원문을 보존한다", () => {
    const result = composeAmoraPersistenceTerminal({
      ...baseInput,
      text: acknowledgement,
      userRequestedChange: false,
    });

    expect(result.text).toBe(acknowledgement);
    expect(result.removedClaimCount).toBe(0);
  });

  it.each([
    "체크리스트에 반영했어요.",
    "체크리스트에 반영할게요.",
  ])("사용자 합의의 접수는 보존하되 별도의 가짜 실행은 계속 제거한다: %s", (claim) => {
    const result = composeAmoraPersistenceTerminal({
      ...baseInput,
      text: `${acknowledgement} ${claim}`,
      userRequestedChange: false,
    });

    expect(result.text).toBe(acknowledgement);
    expect(result.removedClaimCount).toBe(1);
    expect(result.source).toBe("server_correction");
  });

  it.each([
    ["", 0],
    ["체크리스트에 반영했어요.", 1],
    ["체크리스트에 반영할게요.", 1],
  ] as const)("요청 없는 표식 폐기 뒤 본문이 비어도 중립 안내를 쓴다: %s", (text, removedClaimCount) => {
    const result = composeAmoraPersistenceTerminal({
      ...baseInput,
      text,
      userRequestedChange: false,
    });

    expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
    expect(result.removedClaimCount).toBe(removedClaimCount);
    expect(result.source).toBe("server_correction");
  });

  it.each([true, undefined])("실제 요청 또는 생략된 기존 인수의 표식 실패 안내는 유지한다: %s", (userRequestedChange) => {
    const result = composeAmoraPersistenceTerminal({
      ...baseInput,
      text: acknowledgement,
      userRequestedChange,
    });

    expect(result.text).toBe(`${acknowledgement}\n\n${SERVER_OWNED_UNVERIFIED_NOTICE}`);
    expect(result.removedClaimCount).toBe(0);
  });

  it.each([true, undefined])("실제 요청 또는 생략된 기존 인수의 빈 표식 실패 안내는 유지한다: %s", (userRequestedChange) => {
    expect(composeAmoraPersistenceTerminal({
      ...baseInput,
      text: "",
      userRequestedChange,
    }).text).toBe(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("요청 인수와 표식이 모두 없었던 빈본문의 기존 중립 안내는 유지한다", () => {
    expect(composeAmoraPersistenceTerminal({
      text: "", toolResults: [], hasPendingAction: false, persistenceMode: "durable",
    }).text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
  });

  it("요청 인수를 생략한 기존 미래 약속 호출은 안내를 유지한다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: `${acknowledgement} 체크리스트에 반영할게요.`,
      toolResults: [], hasPendingAction: false, persistenceMode: "durable",
    });
    expect(result.text).toBe(`${acknowledgement}\n\n${SERVER_OWNED_UNVERIFIED_NOTICE}`);
    expect(result.removedClaimCount).toBe(1);
  });

  it("요청 여부가 false여도 유효 카드의 확인 문장은 그대로 둔다", () => {
    const text = "다음 변경을 적용할까요? 상견례 일정을 추가할게요.";
    const result = composeAmoraPersistenceTerminal({
      text, toolResults: [], hasPendingAction: true,
      persistenceMode: "durable", userRequestedChange: false,
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
  });

  it.each([true, false])("요청 여부가 false여도 실제 실행 영수증이 본문을 소유한다: success=%s", (success) => {
    const displayMessage = success ? "총예산을 3,000만 원으로 변경했어요." : "예산을 변경하지 못했어요.";
    const result = composeAmoraPersistenceTerminal({
      text: `${acknowledgement} 체크리스트에 반영할게요.`,
      toolResults: [{
        toolName: "update_budget", toolInput: { total_budget: 30_000_000 },
        toolOutput: { success }, success, displayMessage,
      }],
      hasPendingAction: false, persistenceMode: "durable", userRequestedChange: false,
    });
    expect(result.text).toBe(displayMessage);
    expect(result.source).toBe("server_mutation_receipts");
  });
});
