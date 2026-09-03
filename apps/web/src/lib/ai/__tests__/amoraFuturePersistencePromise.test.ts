import { describe, expect, it } from "vitest";

import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { isAmoraFailedProposalNotice } from "@/lib/ai/amoraPendingAction";
import type { ToolExecutionResult } from "@/types/database.types";

/**
 * "등록할게요" 는 저장이 아니다.
 *
 * 2026-09-03: 완료형만 잡던 저장 주장 가드가 미래형을 하나도 못 걸렀다. 표식이
 * 없는 턴에서는 경고 한 줄 없이 매끄러운 약속만 나가고 일정·예산은 그대로였다.
 */

const UNVERIFIED_NOTICE =
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.";

function terminal(
  text: string,
  overrides: {
    hasPendingAction?: boolean;
    toolResults?: readonly ToolExecutionResult[];
    userRequestedChange?: boolean;
  } = {},
) {
  return composeAmoraPersistenceTerminal({
    text,
    toolResults: overrides.toolResults ?? [],
    hasPendingAction: overrides.hasPendingAction ?? false,
    persistenceMode: "durable",
    userRequestedChange: overrides.userRequestedChange ?? true,
  });
}

/** 실제로 관측된 미래형 약속들. 전부 원문 그대로 나가던 문장이다. */
const FUTURE_PROMISES = [
  "예식장을 그랜드호텔로 등록할게요.",
  "예산 5000만원으로 저장할게요.",
  "일정에 반영해 드릴게요.",
  "게스트 명단에 추가하겠습니다.",
  "총예산을 6,000만 원으로 적용할게요.",
  "말씀하신 날짜를 일정에 입력해 둘게요.",
  "체크리스트에 그 항목을 추가해 놓을게요.",
  "메모에 저장해 드리겠습니다.",
  "그 값으로 반영하겠어요.",
];

/**
 * 오탐 코퍼스.
 *
 * 저장 동사가 들어 있어도 **주체가 아모라가 아니거나** 저장이 아닌 문장은 그대로
 * 남아야 한다. 하나라도 지워지면 아모라가 정상 답변을 잃는다.
 */
const MUST_SURVIVE = [
  "예식장에 문의할게요.",
  "확인해 드릴게요.",
  "언제 할지 알려주시면 등록할 수 있어요.",
  "직접 등록할 때는 예약금 영수증을 챙겨 두세요.",
  "혼인신고는 구청에서 등록해요.",
  "하객 명단은 두 분이 함께 정리하는 게 좋아요.",
  "그 업체는 계약금을 먼저 입금해야 예약이 잡혀요.",
  "예산을 조금 늘리는 방향도 생각해 볼 수 있어요.",
  "스드메 견적을 세 곳에서 받아 보시겠어요?",
  "청첩장 문구를 같이 다듬어 볼까요?",
  "상견례 장소는 양가 중간 지점이 무난해요.",
  "웨딩홀 계약 전에 보증 인원을 꼭 확인하세요.",
  "지금 진행 상황을 알려 주시면 다음 단계를 정리해 드릴 수 있어요.",
  "드레스 투어는 보통 세 벌 정도 입어 봐요.",
  "그 날짜는 주말이라 예약이 빨리 찰 수 있어요.",
  "예약금은 보통 총액의 10% 정도예요.",
  "혼수 목록은 두 분의 생활 방식에 따라 달라져요.",
  "신혼여행 항공권은 미리 알아보는 편이 좋아요.",
  "축의금 관리는 한 사람이 맡는 경우가 많아요.",
  "본식 스냅은 계약서에 원본 제공 여부를 적어 두는지 확인해 보세요.",
  "그 부분은 담당자에게 다시 물어보시는 게 정확해요.",
  "예단·예물은 생략하는 커플도 많아요.",
];

describe("미래형 저장 약속을 지운다", () => {
  it("영수증도 카드도 없는 턴에서 약속 문장이 사라지고 안내가 붙는다", () => {
    for (const promise of FUTURE_PROMISES) {
      const result = terminal(`알겠어요. ${promise}`);

      expect(result.text).not.toContain(promise);
      expect(result.text).toContain(UNVERIFIED_NOTICE);
      expect(result.removedClaimCount).toBe(1);
      expect(result.source).toBe("server_correction");
    }
  });

  it("제안 도구가 안 열린 턴에서도 안내를 억제하지 않는다", () => {
    // 억제 규칙은 "요청하지도 않은 변경의 실패를 사과하지 말자" 는 것인데,
    // 미래형 약속은 정의상 사용자가 무언가를 부탁했다는 뜻이다.
    // 남는 문장을 하나 둔다. 문장이 전부 지워지면 빈 본문 방지 관문이 대신
    // 같은 안내를 넣어 주기 때문에, 억제 여부를 이 입력으로는 가릴 수 없다.
    const result = terminal(
      "그랜드호텔은 보증 200명이에요. 예식장을 그랜드호텔로 등록할게요.",
      { userRequestedChange: false },
    );

    expect(result.text).toContain("그랜드호텔은 보증 200명이에요.");
    expect(result.text).toContain(UNVERIFIED_NOTICE);
  });

  it("남은 문장은 그대로 살린다", () => {
    const result = terminal(
      "그랜드호텔은 보증 200명이에요. 예식장을 그랜드호텔로 등록할게요.",
    );

    expect(result.text).toContain("그랜드호텔은 보증 200명이에요.");
    expect(result.text).not.toContain("등록할게요");
  });
});

describe("지우면 안 되는 문장", () => {
  it("정상 문장 코퍼스에서 오탐이 0이다", () => {
    const removed = MUST_SURVIVE.filter((sentence) =>
      terminal(sentence).removedClaimCount > 0);

    expect(removed).toEqual([]);
  });

  it("정상 문장은 제공자 원문 그대로 나간다", () => {
    for (const sentence of MUST_SURVIVE) {
      const result = terminal(sentence);

      expect(result.text).toBe(sentence);
      expect(result.source).toBe("provider");
      expect(result.corrected).toBe(false);
    }
  });

  it("자기 규칙을 설명하는 인용은 남긴다", () => {
    const explaining = "저는 \"등록할게요\" 라는 말은 하지 않아요.";

    expect(terminal(explaining).removedClaimCount).toBe(0);
  });
});

describe("카드·영수증이 있는 턴에는 손대지 않는다", () => {
  it("확인 카드가 난 턴의 서버 확인문은 그대로다", () => {
    // 카드가 난 턴의 본문은 서버가 만든 확인문이다. 여기에 저장 동사가 있어도
    // 지우면 서버 소유 문구를 훼손한다.
    const confirmation = "다음 변경을 적용할까요? 상견례 일정을 추가할게요.";
    const result = terminal(confirmation, { hasPendingAction: true });

    expect(result.text).toBe(confirmation);
    expect(result.removedClaimCount).toBe(0);
  });

  it("mutation 영수증이 있으면 제공자 산문은 애초에 버려진다", () => {
    const result = terminal("예산을 저장할게요.", {
      toolResults: [{
        toolName: "update_budget",
        toolInput: { total_budget: 60_000_000 },
        toolOutput: { success: true },
        success: true,
        displayMessage: "총예산을 6,000만 원으로 변경했어요.",
      } as never],
    });

    expect(result.text).toBe("총예산을 6,000만 원으로 변경했어요.");
    expect(result.source).toBe("server_mutation_receipts");
  });
});

describe("실패 턴은 프로바이더 이력에서 뺀다", () => {
  it("안내가 붙은 턴을 이력 필터가 잡는다", () => {
    const result = terminal("예식장을 그랜드호텔로 등록할게요.");

    expect(isAmoraFailedProposalNotice(result.text)).toBe(true);
  });

  it("안내가 없는 정상 턴은 이력에 남는다", () => {
    const result = terminal("상견례 장소는 양가 중간 지점이 무난해요.");

    expect(isAmoraFailedProposalNotice(result.text)).toBe(false);
  });
});
