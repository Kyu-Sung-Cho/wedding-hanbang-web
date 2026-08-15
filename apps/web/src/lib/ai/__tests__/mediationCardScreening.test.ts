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

  it("방법이 맞다는 사실 검증을 사람에 대한 도덕 판정으로 오인하지 않는다", () => {
    const translation = "이 방법이 맞아요.";
    const block = blockFrom(card({ ...SAFE, translation }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.translation).toBe(translation);
  });

  it("예산 계산이 맞다는 검증도 사람에 대한 도덕 판정으로 오인하지 않는다", () => {
    const data = "예산 계산이 맞아요.";
    const block = blockFrom(card({ ...SAFE, data }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.data).toBe(data);
  });

  it("일정이 맞다는 검증도 사람에 대한 도덕 판정으로 오인하지 않는다", () => {
    const data = "이 일정이 맞아요.";
    const block = blockFrom(card({ ...SAFE, data }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.data).toBe(data);
  });

  it("걸러서 필드가 비면 카드를 만들지 않는다", () => {
    // 기워 붙인 카드보다 카드가 없는 편이 안전하다. 카드가 없으면 그 턴은
    // 일반 답변으로 나가고, 두 사람이 수락할 대상 자체가 생기지 않는다.
    const block = blockFrom(card({ ...SAFE, resolution: "이대로면 100% 문제 없어요." }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("한쪽을 모욕하고 다른 쪽이 옳다고 판정한 카드는 승인하지 않는다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        translation: "신랑이 이기적이고 신부가 옳아요.",
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    "요청자가 맞아요.",
    "사용자가 이기적이에요.",
  ])("요청자·사용자라는 별칭으로 한 인격·우열 판정도 승인하지 않는다: %s", (translation) => {
    const block = blockFrom(card({ ...SAFE, translation }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    ["민수님이 이기적이에요.", SAFE.resolution],
    ["지연님이 맞아요.", SAFE.resolution],
    ["민수는 이기적이에요.", SAFE.resolution],
    ["김하늘님이 맞아요.", SAFE.resolution],
    ["민수님의 요구가 더 타당해요.", SAFE.resolution],
    [SAFE.translation, "민수님이 먼저 사과하는 게 좋겠어요."],
    [SAFE.translation, "지연님이 양보해야 합니다."],
    [SAFE.translation, "철수는 먼저 사과해야 해요."],
  ])("실제 이름을 주어로 쓴 인격·우열·일방 요구도 승인하지 않는다: %s / %s", (translation, resolution) => {
    const block = blockFrom(card({ ...SAFE, translation, resolution }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("한쪽에만 양보와 사과를 강요한 합의안은 승인하지 않는다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        resolution: "신랑이 양보하고 사과하세요.",
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("함께라는 말만 같은 문장에 넣어 한쪽의 사과 의무를 숨길 수 없다", () => {
    const block = blockFrom(card({
      ...SAFE,
      resolution: "함께 해결하려면 신랑이 먼저 사과해야 해요.",
    }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("두 사람이라는 서두 뒤에 한쪽 주체를 다시 세워도 사과 의무를 숨길 수 없다", () => {
    const block = blockFrom(card({
      ...SAFE,
      resolution: "두 사람이 함께 해결하려면 신랑이 먼저 사과해야 해요.",
    }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("동등이라는 선언 뒤의 한쪽 양보 의무도 승인하지 않는다", () => {
    const block = blockFrom(card({
      ...SAFE,
      resolution: "동등하게 대화하되 신부가 먼저 양보해야 해요.",
    }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("돈을 더 부담한 사람에게 일방적인 결정 우선권을 주는 합의안은 승인하지 않는다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        resolution: "돈을 더 내는 신랑의 의견을 우선해야 해요.",
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    "어머니 의견을 우선해야 해요.",
    "우선해야 할 의견은 신랑의 의견이에요.",
    "결정권은 신랑에게 있어야 해요.",
  ])("주체와 강제어의 순서나 제3자 여부로 일방 권위 관계를 숨길 수 없다: %s", (resolution) => {
    const block = blockFrom(card({ ...SAFE, resolution }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("높은 소득을 근거로 한쪽에게 최종 결정을 맡기는 합의안은 승인하지 않는다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        resolution: "연봉이 높은 사람이 최종 결정해야 해요.",
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    "돈을 70% 내는 쪽이 최종 결정하면 됩니다.",
    "소득이 낮은 쪽은 상대의 결정을 따라야 해요.",
    "비용을 대부분 부담한 신부에게 최종 선택권이 있어야 해요.",
    "경제력이 큰 사람이 의견을 정하고 다른 사람은 존중하는 게 좋겠어요.",
    "더 많이 기여한 쪽의 제안을 기준으로 정하면 돼요.",
  ])("금전 기여의 표현이나 권한 동사를 바꿔도 결정 지배를 승인하지 않는다: %s", (resolution) => {
    const block = blockFrom(card({ ...SAFE, resolution }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("예산을 먼저 결정하자는 절차 제안을 금전 권력 부여로 오인하지 않는다", () => {
    const resolution = "예산을 먼저 결정해야 해요.";
    const block = blockFrom(card({ ...SAFE, resolution }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(resolution);
  });

  it("이중부정으로 한쪽의 사과 의무를 복원한 합의안은 승인하지 않는다", () => {
    const block = blockFrom(card({
      ...SAFE,
      resolution: "신랑이 먼저 사과하지 않아도 된다는 뜻은 아니에요.",
    }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    "신랑이 먼저 사과해야 한다고 단정하지 않아요.",
    "예산 항목을 우선해야 해요.",
  ])("일방 의무를 부정하거나 비인물 항목의 순서를 정한 문장은 승인한다: %s", (resolution) => {
    expect(toUserRequestedMediationV2(blockFrom(card({ ...SAFE, resolution })))).not.toBeNull();
  });

  it("플래너의 계산이 맞다는 사실 검증에서 단어 내부의 '너'를 당사자로 오인하지 않는다", () => {
    const data = "플래너의 계산이 맞아요.";
    const mediation = toUserRequestedMediationV2(blockFrom(card({ ...SAFE, data })));

    expect(mediation).not.toBeNull();
    expect(mediation?.data).toBe(data);
  });

  it("소득 차이가 있어도 함께 최종 결정하자는 제안은 그대로 승인한다", () => {
    const resolution = "연봉이 높은 쪽이 있어도 최종 결정은 함께 해야 해요.";
    const block = blockFrom(card({ ...SAFE, resolution }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(resolution);
  });

  it.each([
    ["신부의 요구가 더 타당해요.", "신랑이 먼저 사과하는 게 좋겠어요."],
    ["신랑의 입장이 더 합리적이에요.", "신부가 먼저 양보하는 것이 바람직해요."],
  ])(
    "완곡한 우열 판정과 일방 권고도 승인하지 않는다: %s / %s",
    (translation, resolution) => {
      const block = blockFrom(card({ ...SAFE, translation, resolution }));

      expect(toUserRequestedMediationV2(block)).toBeNull();
    },
  );

  it("말하지 않은 숨은 동기를 한쪽의 의도라고 단정한 카드는 승인하지 않는다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        translation: "신랑은 신부를 통제하려고 일부러 예산 결정을 미루는 거예요.",
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it.each([
    ["신부가 무책임하고 신랑이 맞아요.", SAFE.resolution],
    ["신부는 신랑을 조종하려고 일부러 결정을 미루는 거예요.", SAFE.resolution],
    [SAFE.translation, "아내가 양보하고 사과하세요."],
    [SAFE.translation, "신부는 잘못을 인정해야 합니다."],
  ])(
    "역할을 바꾸거나 표현 순서를 바꿔도 편향된 카드를 승인하지 않는다: %s / %s",
    (translation, resolution) => {
      const block = blockFrom(card({ ...SAFE, translation, resolution }));

      expect(toUserRequestedMediationV2(block)).toBeNull();
    },
  );

  it("출처가 있어도 모욕과 일방 요구가 든 직접 인용은 공유 카드에 반복하지 않는다", () => {
    const quotedTranslation = '요청자는 "신랑이 이기적이고 잘못을 인정해야 한다"고 말했어요.';
    const block = blockFrom(
      card({
        ...SAFE,
        translation: quotedTranslation,
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("실제 이름을 넣은 모욕·일방 요구 직접 인용도 공유 카드에 반복하지 않는다", () => {
    const quotedTranslation =
      '요청자는 "민수님이 이기적이고 먼저 사과해야 한다"고 말했어요.';
    const block = blockFrom(card({ ...SAFE, translation: quotedTranslation }));

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("검증 가능한 예산 선호를 옮긴 중립 직접 인용은 그대로 승인한다", () => {
    const quotedTranslation =
      '요청자는 "신랑은 예산 상한을 3천만원으로 생각한다고 했다"고 말했어요.';
    const block = blockFrom(card({ ...SAFE, translation: quotedTranslation }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.translation).toBe(quotedTranslation);
  });

  it("직접 인용 뒤에 붙인 아모라 자신의 판정은 인용 예외로 숨기지 못한다", () => {
    const block = blockFrom(
      card({
        ...SAFE,
        translation:
          '요청자는 "신랑이 이기적이다"라고 말했고 신랑은 실제로 틀렸어요.',
      }),
    );

    expect(toUserRequestedMediationV2(block)).toBeNull();
  });

  it("두 사람의 관찰 가능한 입장과 상호 선택지는 과잉 차단하지 않는다", () => {
    const neutral = {
      ...SAFE,
      translation:
        "신랑은 예산 상한을 먼저 정하고 싶다고 전했고, 신부는 장소 후보를 먼저 보고 싶다고 전했어요.",
      resolution:
        "두 사람이 각자 양보 가능한 항목과 지키고 싶은 항목을 하나씩 고른 뒤 함께 비교해 보세요.",
    };
    const block = blockFrom(card(neutral));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.translation).toBe(neutral.translation);
    expect(mediation?.resolution).toBe(neutral.resolution);
  });

  it("서로 다른 금전 기여 사실과 함께 정할 우선순위는 권력 부여로 오인하지 않는다", () => {
    const neutral = {
      ...SAFE,
      data: "신랑은 2천만원, 신부는 1천만원까지 부담할 수 있다고 적었어요.",
      resolution: "두 사람이 각자 중요하게 생각하는 의견의 우선순위를 함께 정해 보세요.",
    };
    const block = blockFrom(card(neutral));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.data).toBe(neutral.data);
    expect(mediation?.resolution).toBe(neutral.resolution);
  });

  it.each([
    "사용자가 입력한 예산 상한은 3천만원이에요.",
    "민수님은 예산 상한을 3천만원으로 적었어요.",
    "김하늘은 예산 상한을 3천만원으로 적었어요.",
  ])("별칭이나 이름이 든 일반 데이터 문장은 그대로 승인한다: %s", (data) => {
    const block = blockFrom(card({ ...SAFE, data }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.data).toBe(data);
  });

  it("실제 이름을 쓴 상호 양보·사과 제안은 일방 요구로 오인하지 않는다", () => {
    const resolution =
      "민수님과 지연님이 서로 양보하고 필요하면 각자 사과해야 합니다.";
    const block = blockFrom(card({ ...SAFE, resolution }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(resolution);
  });

  it("함께 나눌 책임을 정하는 상호 합의안은 도덕 판정으로 오인하지 않는다", () => {
    const resolution = "신랑과 신부가 각자 맡을 책임을 함께 정해 보세요.";
    const block = blockFrom(card({ ...SAFE, resolution }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(resolution);
  });

  it("두 사람 모두에게 적용되는 상호 양보 문장은 일방 강요로 오인하지 않는다", () => {
    const resolution = "신랑과 신부가 서로 양보하고 필요하면 사과해야 합니다.";
    const block = blockFrom(card({ ...SAFE, resolution }));

    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(resolution);
  });

  it("멀쩡한 카드는 그대로 통과한다", () => {
    const block = blockFrom(card(SAFE));
    const mediation = toUserRequestedMediationV2(block);

    expect(mediation).not.toBeNull();
    expect(mediation?.resolution).toBe(SAFE.resolution);
    expect(mediation?.empathy).toBe(SAFE.empathy);
  });
});
