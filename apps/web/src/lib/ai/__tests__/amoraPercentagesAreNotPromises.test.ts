import { describe, expect, it } from "vitest";
import { screenAmoraTrustClaims } from "@/lib/ai/amoraTrustClaims";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { createAmoraProviderPreviewGate } from "@/lib/ai/amoraProviderPreviewGate";

describe("100%라는 숫자와 결과 보증을 구분한다", () => {
  const facts = [
    "두 사람이 제시한 비율의 합은 100%예요.",
    "제안한 8개 항목은 전체 예산의 100%에 해당해요.",
    "| 항목 | 비율 |\n|---|---|\n| 합계 | 100% |",
    "이 안은 예산을 100% 배분한 계산 예시예요. 아직 저장하지 않았어요.",
    "비율이 100%를 넘으면 항목별 금액을 다시 비교해 보세요.",
    "총액을 100%로 두고 식사와 촬영 비중을 비교할 수 있어요.",
    "사진 비용의 100%를 한 사람이 부담하겠다는 제안으로 이해했어요.",
    "합계 비율을 100%로 정확히 맞추려면 예비비 비율을 조정해 보세요.",
  ];

  it.each(facts)("계산·비중·제안을 보존한다: %s", text => {
    expect(screenAmoraTrustClaims(text)).toEqual({ text, removedKinds: [], removedCount: 0 });
  });

  it.each([
    "100% 개인정보가 안전합니다.",
    "이 방법이면 100% 성공해요.",
    "예산 배분도 100% 정확해요.",
    "이번에는 100 % 실수 없이 해결돼요.",
    "아모라가 100% 보장해요.",
    "개인정보는 100% 안전해요.",
    "100%라는 확신을 드릴게요.",
    "이 답변이 맞을 확률은 100%예요.",
    "개인정보를 100% 보호해요.",
    "개인정보는 100% 유출되지 않아요.",
    "이 답변은 100% 맞아요.",
    "아모라는 100% 믿으셔도 돼요.",
    "제가 100% 정확히 판단해 드려요.",
    "100% 정확히 예측할 수 있어요.",
  ])("근거 없는 확신·결과 보증은 차단한다: %s", text => {
    expect(screenAmoraTrustClaims(text).removedKinds).toContain("guarantee");
    expect(screenAmoraTrustClaims(text).text).toBe("");
  });

  it("숫자 뒤 보증만 지우며 스트리밍 미리보기와 최종 본문이 같은 비율을 보존한다", () => {
    const text = facts[0];
    const deltas: string[] = [];
    const preview = createAmoraProviderPreviewGate(delta => deltas.push(delta));
    for (const piece of [text.slice(0, 16), text.slice(16)]) preview.push(piece);
    const final = composeAmoraPersistenceTerminal({ text, toolResults: [], hasPendingAction: false, persistenceMode: "durable" });
    expect(final.text).toBe(text);
    expect(final.source).toBe("provider");
    expect(deltas.join("")).toBe(text);
    expect(preview.matchesTerminal(final.text)).toBe(true);
    expect(screenAmoraTrustClaims(`${text} 100% 안전해요.`).text).toBe(text);
  });
});
