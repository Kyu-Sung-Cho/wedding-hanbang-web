import { describe, expect, it, vi } from "vitest";

import { createAmoraProviderPreviewGate } from "../amoraProviderPreviewGate";

describe("createAmoraProviderPreviewGate", () => {
  it("holds an internal marker and JSON even when each arrives one character at a time", () => {
    const emit = vi.fn();
    const gate = createAmoraProviderPreviewGate(emit);
    gate.push("총예산은 3,500만 원이에요. ");
    const safePreview = emit.mock.calls.map(([value]) => value).join("");
    for (const character of '[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000}\n내부 자료예요.') {
      gate.push(character);
    }
    expect(emit.mock.calls.map(([value]) => value).join("")).toBe(safePreview);
    expect(safePreview).toBe("총예산은 3,500만 원이에요.");
    expect(gate.matchesTerminal("총예산은 3,500만 원이에요.")).toBe(false);
  });
  it("streams complete safe sentences and recognizes an exact terminal", () => {
    const emit = vi.fn();
    const gate = createAmoraProviderPreviewGate(emit);

    gate.push("먼저 예산 범위를 볼게요");
    expect(emit).not.toHaveBeenCalled();
    gate.push(". 다음 선택지도 비교해볼게요.");

    expect(emit.mock.calls.map(([value]) => value).join(""))
      .toBe("먼저 예산 범위를 볼게요. 다음 선택지도 비교해볼게요.");
    expect(gate.matchesTerminal(
      "먼저 예산 범위를 볼게요. 다음 선택지도 비교해볼게요.",
    )).toBe(true);
  });

  it("never previews an unsupported persistence completion claim", () => {
    const emit = vi.fn();
    const gate = createAmoraProviderPreviewGate(emit);

    gate.push("예산을 저장했어요. 다음 단계는 업체 비교예요.");

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(" 다음 단계는 업체 비교예요.");
    expect(gate.matchesTerminal("다음 단계는 업체 비교예요.")).toBe(false);
    expect(emit.mock.calls.flat().join(" ")).not.toContain("저장했어요");
  });

  it.each(["suggestions", "pending_action", "mediation"])(
    "buffers the whole remaining preview after a %s marker appears",
    (marker) => {
      const emit = vi.fn();
      const gate = createAmoraProviderPreviewGate(emit);

      gate.push(`안전한 앞문장입니다. [${marker}]`);
      gate.push("내부 데이터가 이어집니다. [/marker]");

      expect(emit).not.toHaveBeenCalled();
      expect(gate.matchesTerminal("안전한 앞문장입니다.")).toBe(false);
    },
  );

  it("also buffers the Korean suggestion marker accepted by the final parser", () => {
    const emit = vi.fn();
    const gate = createAmoraProviderPreviewGate(emit);

    gate.push("[추천 질문]\n예산을 더 볼까요?");

    expect(emit).not.toHaveBeenCalled();
    expect(gate.matchesTerminal("예산을 더 볼까요?")).toBe(false);
  });

  it("keeps an unfinished tail buffered for terminal reconciliation", () => {
    const emit = vi.fn();
    const gate = createAmoraProviderPreviewGate(emit);

    gate.push("확인된 사실부터 볼게요. 아직 끝나지 않은 문장");

    expect(emit).toHaveBeenCalledWith("확인된 사실부터 볼게요.");
    expect(gate.matchesTerminal(
      "확인된 사실부터 볼게요. 아직 끝나지 않은 문장",
    )).toBe(false);
  });
});
