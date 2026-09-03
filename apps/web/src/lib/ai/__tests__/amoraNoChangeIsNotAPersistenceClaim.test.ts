import { describe, expect, it } from "vitest";
import {
  SERVER_OWNED_UNVERIFIED_NOTICE,
  composeAmoraPersistenceTerminal,
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
