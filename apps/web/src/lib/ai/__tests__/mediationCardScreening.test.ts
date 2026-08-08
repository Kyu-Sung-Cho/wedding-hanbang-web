import { describe, expect, it } from "vitest";
import {
  extractMediation,
  screenMediationBlock,
  toUserRequestedMediationV2,
} from "../mediation";

// 중재 카드는 본문에서 잘려 나가기 때문에, 본문을 보는 출력 검사층이 카드 안을
// 한 번도 보지 못했다. 그래서 이 저장소가 금지한 말들이 카드 안에서만 살아남았다.
// 카드는 수락하면 두 사람의 공동 결정으로 기록되므로, 검사를 건너뛰기에 가장 나쁜
// 자리였다.

function blockFrom(text: string) {
  const { mediation } = extractMediation(text);
  if (!mediation) throw new Error("테스트 입력에서 mediation 블록을 못 읽었다");
  return mediation;
}

function card(fields: {
  empathy: string;
  translation: string;
  data: string;
  resolution: string;
}) {
  return [
    "[mediation]",
    `공감: ${fields.empathy}`,
    `통역: ${fields.translation}`,
    `데이터: ${fields.data}`,
    `합의안: ${fields.resolution}`,
    "[/mediation]",
  ].join("\n");
}

const SAFE = {
  empathy: "두 분 다 서운하셨겠어요.",
  translation: "요청자는 예산을 먼저 정하고 싶다고 전했어요.",
  data: "지금 확인된 예산 항목은 예식장뿐이에요.",
  resolution: "이번 주에 각자 생각하는 상한을 적어 와서 맞춰보시면 어떨까요?",
};

describe("중재 카드도 출력 검사층을 지난다", () => {
  it("보증 문장을 카드 안에서 걷어낸다", () => {
    const block = blockFrom(card({ ...SAFE, data: "이대로면 100% 문제 없어요." }));
    const { block: screened, removedKinds } = screenMediationBlock(block);

    expect(screened.data ?? "").not.toContain("100%");
    expect(removedKinds.length).toBeGreaterThan(0);
  });

  it("다른 커플과 비교해 압박하는 문장을 걷어낸다", () => {
    const block = blockFrom(
      card({ ...SAFE, resolution: "다른 커플들은 보통 5천만원 정도는 씁니다." }),
    );
    const { block: screened } = screenMediationBlock(block);

    expect(screened.resolution ?? "").not.toContain("다른 커플");
  });

  it("사람에 대한 판정을 걷어낸다", () => {
    const block = blockFrom(card({ ...SAFE, translation: "두 분은 정말 잘 맞아요." }));
    const { block: screened } = screenMediationBlock(block);

    expect(screened.translation ?? "").not.toContain("잘 맞아요");
  });

  it("걸러서 필드가 비면 카드를 만들지 않는다", () => {
    // 기워 붙인 카드보다 카드가 없는 편이 안전하다. 카드가 없으면 그 턴은
    // 일반 답변으로 나가고, 두 사람이 수락할 대상 자체가 생기지 않는다.
    const block = blockFrom(card({ ...SAFE, resolution: "이대로면 100% 문제 없어요." }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("멀쩡한 카드는 그대로 통과한다", () => {
    const block = blockFrom(card(SAFE));
    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(SAFE.resolution);
    expect(mediation?.empathy).toBe(SAFE.empathy);
  });
});
