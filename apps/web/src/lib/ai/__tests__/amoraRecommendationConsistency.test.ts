import { describe, expect, it } from "vitest";
import { applyAmoraOutputHygiene } from "../amoraOutputHygiene";
import { composeAmoraPersistenceTerminal } from "../amoraPersistenceClaims";
import { createAmoraProviderPreviewGate } from "../amoraProviderPreviewGate";

// 2026-09-08 df7 후보의 소유 합성 계정에서 canonical/SSE가 일치했던 문단.
const OBSERVED = "**추천 1순위는 1안**이에요. 두 사람 모두의 핵심을 완전히 포기하지 않고, 하객 수를 실제 명단으로 조정해볼 수 있기 때문이에요. 다만 3,500만 원 안에 신혼여행·신혼집·가전·가구 등이 포함되는지는 확인되지 않아, 현재로서는 확정 추천이 아니라 **먼저 견적을 받아볼 절충 후보**예요.";
const CAVEAT = "견적이 확인되지 않아 현재로서는 확정 추천이 아니라 먼저 비교할 후보예요.";
const BUDGET_TABLE = "| 항목 | 금액 | 비율 |\n|---|---|---|\n| 사진 | 300만 원 | 10% |\n| 전체 | 3,000만 원 | 100% |";
const POSITIVE = [
  [OBSERVED, OBSERVED.replace("추천 1순위", "우선 검토 후보")],
  [`추천 1순위는 A안이에요. ${CAVEAT}`, `우선 검토 후보는 A안이에요. ${CAVEAT}`],
  ["**최우선 추천: B안**. 날짜를 검증하지 못했으므로 이 제안은 실제 추천이 아닌 검토 후보입니다.", "**우선 검토 후보: B안**. 날짜를 검증하지 못했으므로 이 제안은 실제 추천이 아닌 검토 후보입니다."],
  ["1순위 추천은 가온홀입니다. 인원이 확인되지 않아 지금은 확정적인 추천이 아니고 비교할 후보예요.", "우선 검토 후보는 가온홀입니다. 인원이 확인되지 않아 지금은 확정적인 추천이 아니고 비교할 후보예요."],
] as const;
const UNCHANGED = [
  "추천 1순위는 A안이에요. 제공한 가상 서면 견적에서 A안은 1,000만 원, B안은 1,050만 원이고 두 안 모두 150명이 가능해요. 상한 1,200만 원 아래에서 A안이 50만 원 적어요.",
  "추천 1순위는 A안이에요. 제공한 견적의 총액과 인원 조건에 맞아요. 다만 주류 포함 여부는 아직 확인되지 않아 추가로 물어보세요.",
  "추천 1순위는 하객 명단 정리예요. 인원 기준을 정한 뒤 계약 전 견적을 비교하세요.",
  "확인할 1순위는 취소 조건이에요. 계약 후 되돌리기 어렵기 때문이에요.",
  "먼저 견적을 받아볼 후보는 1안이에요. 가격은 아직 미정이에요.",
  `“추천 1순위는 A안이에요. ${CAVEAT}”라는 사용자 원문은 그대로 보존해요.`,
  `> 추천 1순위는 A안이에요. ${CAVEAT}`,
  `\`\`\`text\n추천 1순위는 A안이에요. ${CAVEAT}\n\`\`\``,
  `~~~text\n설명\n\n추천 1순위는 A안이에요. ${CAVEAT}\n\n~~~`,
  "추천 1순위는 A안이에요. 확인된 견적 기준이에요.\n\n신혼여행 견적은 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  `추천 1순위는 A안이에요. B안은 ${CAVEAT}`,
  `추천 1순위는 가온홀입니다. 누리홀은 ${CAVEAT}`,
  `추천 1순위는 A안입니다. 촬영은 ${CAVEAT}`,
  `추천 1순위는 안 1입니다. 안 2는 ${CAVEAT}`,
  `추천 1순위는 안 1입니다. 촬영쪽은 ${CAVEAT}`,
  `추천 1순위는 식장이에요. ${CAVEAT}`,
  `추천 1순위는 안 1입니다.\n## 촬영 후보\n${CAVEAT}`,
  `추천 1순위는 안 1입니다.\n- 촬영: ${CAVEAT}`,
  "추천 1순위는 A안이에요. 견적은 미확인이나 현재로서는 확정 추천이 아니라고 볼 수는 없어요. 다른 후보도 비교해 보세요.",
  "추천 1순위는 A안이에요. 가격은 확인되지 않았지만, 현재로서는 확정 추천이 아니라 후보라는 뜻은 아니에요.",
  `추천 1순위는 A안이에요. ${CAVEAT} 방금 후보라고 한 설명은 틀렸고 제공된 최종 견적 기준으로 추천해요.`,
  "추천 1순위는 가온홀이에요. 가격은 확인된 견적대로이고, 촬영은 견적이 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  "추천 1순위는 가온홀이에요. 가격은 확인된 견적대로이고 촬영은 견적이 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  "추천 1순위는 가온홀이에요. 가격은 확인된 견적대로이며 촬영은 견적이 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  "추천 1순위는 가온홀이에요. 가격은 확인된 견적인 반면 촬영은 견적이 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  "추천 1순위는 스튜디오 기본 패키지예요. A안의 식장 견적이 확인되지 않아 현재로서는 확정 추천이 아니라 비교 후보예요.",
  `추천 1순위는 A안이라고 단정하지 않아요. ${CAVEAT}`,
  `\`\`\`text\n~~~\n\n추천 1순위는 A안이에요. ${CAVEAT}\n\n\`\`\``,
  `추천 1순위는 A안이에요. 2순위는 B안이에요. ${CAVEAT}`,
  "추천 1순위는 A안이에요. 견적이 확인되지 않아 가볍게 비교해 보세요.",
  "추천 1순위는 A안이에요. 다른 후보보다 50만 원 저렴해요.",
  "[추천1순위](https://example.com/?q=추천1순위)라는 링크 이름이에요.",
  `비율 합계는 100%예요.\n\n${BUDGET_TABLE}`,
];

describe("자기 답변의 명시적 후보 상태와 추천 명칭 정합화", () => {
  it.each(POSITIVE)("같은 안의 명시적 자기 낮춤만 앞 명칭에 반영한다: %s", (text, expected) => {
    const hygiene = applyAmoraOutputHygiene(text);
    expect(hygiene.text).toBe(expected);
    expect(hygiene.actions).toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
    const terminal = composeAmoraPersistenceTerminal({ text: hygiene.text, toolResults: [], hasPendingAction: false, persistenceMode: "durable" });
    expect(terminal.text).toBe(expected);
    expect(terminal.source).toBe("provider");
    const again = applyAmoraOutputHygiene(hygiene.text);
    expect(again.text).toBe(expected);
    expect(again.actions).not.toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
  });

  it.each(UNCHANGED)("확인된 추천·인용·다른 대상·모호한 관계를 byte-identical로 보존한다: %s", text => {
    expect(applyAmoraOutputHygiene(text).text).toBe(text);
  });

  it("앞뒤 표·금액·비율·선택 이유·확인 질문은 라벨과 별도로 원문 그대로 남긴다", () => {
    const text = `${BUDGET_TABLE}\n\n${OBSERVED}\n\n다음으로 180~200명 중 초대할 사람을 나눠 보세요.`;
    expect(applyAmoraOutputHygiene(text).text).toBe(text.replace("추천 1순위", "우선 검토 후보"));
  });

  it.each(["추천 1순위는 A안이에요.", "**최우선 추천: B안**이에요.", "1순위 추천은 가온홀이에요."])(
    "뒤 단서가 도착하기 전 모든 분할 경계에서 ranked preview를 보류한다: %s", text => {
      const splits = [[text], [...text], ...Array.from({ length: text.length - 1 }, (_, index) => [text.slice(0, index + 1), text.slice(index + 1)])];
      for (const pieces of splits) {
        const emitted: string[] = [];
        const gate = createAmoraProviderPreviewGate(delta => emitted.push(delta));
        gate.push("먼저 기준을 볼게요. ");
        pieces.forEach(piece => gate.push(piece));
        expect(emitted.join(""), JSON.stringify(pieces)).toBe("먼저 기준을 볼게요.");
        gate.push(` ${CAVEAT}`);
        expect(emitted.join("")).toBe("먼저 기준을 볼게요.");
        expect(gate.matchesTerminal(applyAmoraOutputHygiene(`먼저 기준을 볼게요. ${text} ${CAVEAT}`).text)).toBe(false);
      }
    },
  );

  it("정상 추천은 preview 지연 뒤에도 최종 본문에서 후보로 바뀌거나 삭제되지 않는다", () => {
    const text = UNCHANGED[0];
    const emitted: string[] = [];
    const gate = createAmoraProviderPreviewGate(delta => emitted.push(delta));
    [...text].forEach(piece => gate.push(piece));
    expect(emitted).toEqual([]);
    const terminal = composeAmoraPersistenceTerminal({ text: applyAmoraOutputHygiene(text).text, toolResults: [], hasPendingAction: false, persistenceMode: "durable" });
    expect(terminal.text).toBe(text);
    expect(gate.matchesTerminal(terminal.text)).toBe(false);
  });
});
