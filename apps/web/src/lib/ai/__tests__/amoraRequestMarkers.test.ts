import { describe, expect, it } from "vitest";
import { applyAmoraOutputHygiene } from "../amoraOutputHygiene";
import { composeAmoraPersistenceTerminal } from "../amoraPersistenceClaims";
import { createAmoraProviderPreviewGate } from "../amoraProviderPreviewGate";

const RESERVED = /\[\/?(?:MEDIATION_REQUEST|INITIAL_GREETING)\]/iu;
const BUDGET = "| 항목 | 예산 |\n|---|---|\n| 사진 | 300만 원 |\n| 합계 | 300만 원 |";

describe("아모라 답변의 예약 요청 표식", () => {
  it.each(["MEDIATION_REQUEST", "INITIAL_GREETING", "mediation_request"])(
    "%s의 여닫는 표식만 제거하고 안쪽 문장과 예산 표를 보존한다",
    marker => {
      const expected = `이어서 말해줘\n[예약 전] [A] 기준이에요.\n\n${BUDGET}`;
      const text = `[${marker}]이어서 말해줘[/${marker}]\n[예약 전] [A] 기준이에요.\n\n${BUDGET}`;
      const hygiene = applyAmoraOutputHygiene(text, { userText: text });
      const terminal = composeAmoraPersistenceTerminal({
        text: hygiene.text, toolResults: [], hasPendingAction: false, persistenceMode: "durable",
      });
      expect(hygiene.text).toBe(expected);
      expect(hygiene.actions).toContainEqual({ kind: "reserved_request_markers_removed" });
      expect(terminal.text).toBe(expected);
      expect(terminal.source).toBe("provider");
    },
  );

  it("짝이 없는 예약 표식도 제거하되 일반 대괄호와 다른 마커 이름은 바꾸지 않는다", () => {
    expect(applyAmoraOutputHygiene("[MEDIATION_REQUEST]문장은 남아요.").text).toBe("문장은 남아요.");
    expect(applyAmoraOutputHygiene("문장은 남아요.[/INITIAL_GREETING]").text).toBe("문장은 남아요.");
    for (const text of [
      "[예약 전] [A] 기준이에요.", "[MEDIATION_REQUEST_EXTRA] [INITIAL_GREETING_NOTE]",
      "[촬영 기준](https://example.com/photo)", "- [ ] 예산 검토\n- [x] 후보 정리", BUDGET,
      "[etiquette:2] [mediation] [pending_action]",
    ]) expect(applyAmoraOutputHygiene(text).text).toBe(text);
  });

  it.each(["MEDIATION_REQUEST", "INITIAL_GREETING"])(
    "%s는 한 덩어리·모든 두 조각 경계·글자별 토큰에서도 미리보기로 노출하지 않는다",
    marker => {
      const text = `[${marker}]이어서 말해줘.[/${marker}] 다음 기준이에요.`;
      const splits = [[text], [...text], ...Array.from({ length: text.length - 1 }, (_, index) => [
        text.slice(0, index + 1), text.slice(index + 1),
      ])];
      for (const pieces of splits) {
        const emitted: string[] = [];
        const gate = createAmoraProviderPreviewGate(delta => emitted.push(delta));
        for (const piece of pieces) gate.push(piece);
        expect(emitted.join(""), JSON.stringify(pieces)).not.toMatch(RESERVED);
        expect(emitted).toEqual([]);
        expect(gate.matchesTerminal("이어서 말해줘. 다음 기준이에요.")).toBe(false);
      }
    },
  );

  it("정상 미리보기와 최종 답변의 일반 대괄호·비율을 그대로 보존한다", () => {
    const text = "[예약 전] [A] 기준이에요. 비율 합계는 100%예요.";
    const splits = [[text], [...text], ...Array.from({ length: text.length - 1 }, (_, index) => [
      text.slice(0, index + 1), text.slice(index + 1),
    ])];
    for (const pieces of splits) {
      const emitted: string[] = [];
      const gate = createAmoraProviderPreviewGate(delta => emitted.push(delta));
      pieces.forEach(piece => gate.push(piece));
      const hygiene = applyAmoraOutputHygiene(text);
      expect(hygiene.text).toBe(text);
      expect(emitted.join("")).toBe(text);
      expect(gate.matchesTerminal(hygiene.text)).toBe(true);
    }
  });
});
