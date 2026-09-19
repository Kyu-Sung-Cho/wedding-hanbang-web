import { describe, expect, it } from "vitest";

import type { WeddingCodeV06Option, WeddingCodeV06Question } from "../weddingCodeV06";
import {
  WEDDING_CODE_V10_AXES,
  WEDDING_CODE_V10_NEXT_STEPS,
  WEDDING_CODE_V10_QUESTIONS,
  WEDDING_CODE_V10_VERSION,
} from "../weddingCodeV10";
import { WEDDING_CODE_V09_NEXT_STEPS, WEDDING_CODE_V09_QUESTIONS } from "../weddingCodeV09";

// v1.0 은 v0.9 의 규칙을 전부 그대로 지킨다. 아래 앞쪽 검사는 `weddingCodeV09.test.ts` 와 같은 검사를
// v1.0 문항에 건 것이고, 끝의 세 검사가 v1.0 에서 더한 규칙이다.

/** `as const`가 선택지를 리터럴로 좁혀서 `candid` 없는 갈래에는 그 속성이 아예 없다. */
const optionsOf = (question: (typeof WEDDING_CODE_V10_QUESTIONS)[number]) =>
  question.options as readonly WeddingCodeV06Option[];

describe("웨딩코드 v1.0 문항", () => {
  it("새 공유 링크 버전과 20개 문항을 고정한다", () => {
    expect(WEDDING_CODE_V10_VERSION).toBe("v1.0-code");
    expect(WEDDING_CODE_V10_QUESTIONS).toHaveLength(20);
    expect(new Set(WEDDING_CODE_V10_QUESTIONS.map((question) => question.key)).size).toBe(20);
  });

  it("각 축에 다섯 문항, 각 문항에 좌우 두 선택지를 둔다", () => {
    for (const axis of WEDDING_CODE_V10_AXES) {
      const questions = WEDDING_CODE_V10_QUESTIONS.filter((question) => question.axis === axis.key);
      expect(questions, axis.key).toHaveLength(5);

      const left = new Set<string>(axis.left.constructs);
      const right = new Set<string>(axis.right.constructs);
      for (const question of questions) {
        let leftCount = 0;
        let rightCount = 0;
        for (const option of question.options) {
          const ownWeights = option.weights.filter(
            (weight) => left.has(weight.construct) || right.has(weight.construct),
          );
          expect(ownWeights, `${question.key}${option.value}`).toHaveLength(1);
          if (left.has(ownWeights[0].construct)) leftCount += 1;
          if (right.has(ownWeights[0].construct)) rightCount += 1;
          expect(ownWeights[0].value).toBe(2);
        }
        expect(leftCount, `${question.key} left`).toBe(2);
        expect(rightCount, `${question.key} right`).toBe(2);
      }
    }
  });

  it("선택지 위치가 축 방향과 한 패턴으로 굳지 않는다", () => {
    const patterns = new Set<string>();
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const axis = WEDDING_CODE_V10_AXES.find((item) => item.key === question.axis)!;
      const left = new Set<string>(axis.left.constructs);
      patterns.add(
        question.options
          .map((option) =>
            option.weights.some((weight) => left.has(weight.construct)) ? "L" : "R",
          )
          .join(""),
      );
    }
    expect(patterns).toEqual(new Set(["LLRR", "LRLR", "RRLL", "RLRL"]));
  });

  it("초보자가 뜻을 추측해야 하는 웨딩 업계 용어와 모호한 대상을 쓰지 않는다", () => {
    const banned =
      /스드메|예식장|본식|폐백|상견례|전통 인사|원판|헬퍼비|피팅|컨펌|워크인|혼주|부토니에|얼리스타트|양가|업체나 장소|전체.*사진 파일|사진 파일.*전체|모르는 조항|두 집안이 처음 만날|이거|그거|저거|넘겼다|느낌이 오면|마음에 남을|믿음이 가면|걱정돼 보인다/;

    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      for (const text of [
        question.scene,
        question.question,
        ...question.options.map((option) => option.label),
      ]) {
        expect(text, `${question.key}: ${text}`).not.toMatch(banned);
      }
    }
  });

  it("금액과 횟수에는 단위를 적고 한글 숫자만 던지지 않는다", () => {
    const allText = WEDDING_CODE_V10_QUESTIONS.flatMap((question) => [
      question.scene,
      question.question,
      ...question.options.map((option) => option.label),
    ]).join("\n");

    expect(allText).not.toMatch(/삼백|백오십|삼십/);
    expect(allText).toContain("300만원");
    expect(allText).toContain("150만원");
    expect(allText).toContain("30만원");
  });

  it("모든 선택지는 혼자 읽어도 뜻이 있는 문장이고 서로 반복되지 않는다", () => {
    const labels = WEDDING_CODE_V10_QUESTIONS.flatMap((question) =>
      question.options.map((option) => option.label),
    );
    expect(new Set(labels).size).toBe(labels.length);

    for (const label of labels) {
      expect(label.length, label).toBeGreaterThanOrEqual(12);
      expect(label.length, label).toBeLessThanOrEqual(42);
      expect(label, label).toMatch(/다$/);
    }
  });

  /**
   * v0.7 초안이 실패한 방식이 정확히 이것이었다: 64개 선택지 중 54개(84%)가
   * 「~하고 싶다」·「~면 좋겠다」였다. 전부 바르고 신중한 희망 사항이라 고를 때
   * 자기를 돌아볼 일이 없고, 캡처해서 보낼 문장도 안 생긴다. 카피는 손대면 원래대로
   * 밋밋해지므로 비율을 통과 조건으로 고정한다.
   */
  it("선택지가 희망 사항으로 몰리지 않는다", () => {
    const labels = WEDDING_CODE_V10_QUESTIONS.flatMap((question) =>
      question.options.map((option) => option.label),
    );
    const wishful = labels.filter((label) => /(고 싶다|좋겠다|싶었다)$/.test(label));
    expect(wishful.length / labels.length).toBeLessThanOrEqual(0.4);

    // 한 문항 안에서 네 선택지가 전부 같은 어미로 끝나면 고르는 재미가 없다.
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const endings = new Set(
        question.options.map((option) => option.label.slice(-3)),
      );
      expect(endings.size, question.key).toBeGreaterThan(1);
    }
  });

  /**
   * 네 선택지가 전부 사회적으로 옳으면 사람들은 자기가 한 일이 아니라 좋아 보이는 답을
   * 고른다. 그 답이 그대로 아모라 도움 방식 제안이 되므로, 이건 재미 문제이면서
   * 동시에 신호 오염 문제다.
   */
  it("문항마다 조금 찔리는 답이 하나 이상 있다", () => {
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const candid = optionsOf(question).filter((option) => option.candid);
      expect(candid.length, question.key).toBeGreaterThanOrEqual(1);
      // 전부 찔리는 답이면 고를 수 있는 답이 없어진다.
      expect(candid.length, question.key).toBeLessThan(question.options.length);
    }
    /**
     * **축마다** 양쪽에 있어야 한다. 전체 합계만 보면 놓친다 — 실제로 v0.7에서
     * preparationMode 축의 candid 4개가 전부 「맡아서 정리한다」 쪽에만 있었다.
     * 사람들이 찔리는 답을 피하면 그 축은 반대쪽으로 구조적으로 기운다.
     */
    for (const axis of WEDDING_CODE_V10_AXES) {
      const left = new Set<string>(axis.left.constructs);
      const sides = WEDDING_CODE_V10_QUESTIONS
        .filter((question) => question.axis === axis.key)
        .flatMap((question) =>
          optionsOf(question)
            .filter((option) => option.candid)
            .map((option) =>
              option.weights.some((weight) => left.has(weight.construct)) ? "L" : "R",
            ),
        );
      expect(sides.filter((side) => side === "L").length, `${axis.key} 좌`).toBeGreaterThan(0);
      expect(sides.filter((side) => side === "R").length, `${axis.key} 우`).toBeGreaterThan(0);
    }
  });

  /**
   * 축당 문항이 짝수면 정확히 반반인 자리가 생기고, 그 자리에서는 코드 글자를 정할 수
   * 없다. 4문항일 때 축마다 26%였고, 네 글자가 모두 나올 확률은 30%뿐이었다.
   */
  it("축당 문항이 홀수라 다 답하면 글자를 정할 수 있다", () => {
    for (const axis of WEDDING_CODE_V10_AXES) {
      const count = WEDDING_CODE_V10_QUESTIONS.filter(
        (question) => question.axis === axis.key,
      ).length;
      expect(count % 2, axis.key).toBe(1);
    }
  });

  /**
   * 솔직한 답과 자책하는 답은 다르다. 같은 행동이라도 「고르는 게 지쳐서 그냥
   * 정해달라고 했다」처럼 쓰면 고르는 순간 자기 흠을 인정하는 문장이 된다. 그러면
   * 사람들이 그 답을 피하고, 피한 만큼 축이 기운다 — 불편함과 편향이 같이 온다.
   */
  it("선택지가 고른 사람을 탓하는 말로 쓰이지 않는다", () => {
    const blaming = /솔직히|그냥 |하소연|잘랐다|통보|지쳐서|어차피|귀찮/;
    const judging = /잘못|실수|후회할|틀린|현명|안일|무책임|이기적/;
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      for (const option of optionsOf(question)) {
        expect(option.label, `${question.key}${option.value}`).not.toMatch(blaming);
        expect(option.label, `${question.key}${option.value}`).not.toMatch(judging);
      }
      // 장면과 질문도 어느 행동이 옳다고 미리 정해두지 않는다.
      expect(question.scene, question.key).not.toMatch(judging);
      expect(question.question, question.key).not.toMatch(judging);
    }
  });

  /**
   * 부모님이 안 계시거나, 결혼식을 하지 않거나, 사진 촬영을 안 하는 사람도 있다.
   * 그런 사람에게 네 개 중 하나를 억지로 고르게 하면 불편할 뿐 아니라, 고르지도 않은
   * 답이 결과와 아모라 제안에 실린다. 다음 대화 문구도 안 겪은 상황을 단정하지 않는다.
   */
  it("다음 대화가 사용자의 상황을 단정하지 않는다", () => {
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const nextStep = WEDDING_CODE_V10_NEXT_STEPS[question.key];
      expect(nextStep, question.key).not.toMatch(/해야만|반드시|당연히|잘못/);
      // 제안이지 지시가 아니다.
      expect(nextStep, question.key).toMatch(/보세요|됩니다|하세요|마세요/);
    }
  });

  it("장면은 겪은 사람이 알아볼 만큼 구체적이다", () => {
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      expect(question.scene.length, question.key).toBeGreaterThanOrEqual(18);
      expect(question.scene.length, question.key).toBeLessThanOrEqual(48);
    }
    // 열여섯 번 같은 질문을 던지면 퀴즈가 아니라 체크리스트가 된다.
    const prompts = new Set(WEDDING_CODE_V10_QUESTIONS.map((question) => question.question));
    expect(prompts.size).toBeGreaterThanOrEqual(12);
  });

  it("각 문항에 그 장면에서 바로 쓸 다음 대화가 있다", () => {
    expect(Object.keys(WEDDING_CODE_V10_NEXT_STEPS)).toHaveLength(20);
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const nextStep = WEDDING_CODE_V10_NEXT_STEPS[question.key];
      expect(nextStep.length, question.key).toBeGreaterThanOrEqual(35);
      expect(nextStep, question.key).not.toMatch(/최소 세 번|매번|반드시 갈|성공|이혼|궁합|유형/);
    }
  });
  /**
   * 2026-09-17 팀원 피드백: 「그 시간에 내가 먼저 꺼낸 쪽은?」 같은 질문이 AI 가 쓴 것
   * 같다고 했다. v0.8 은 스무 질문 중 일곱이 「~한 것은?」「~한 방식은?」「~쪽은?」 틀이었다.
   * 질문과 선택지가 문장으로 이어지지 않는 추상 명사형 질문을 막는다.
   */
  it("질문이 추상 명사로 끝나는 설문지 말투가 아니다", () => {
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      expect(question.question, question.key).not.toMatch(/쪽은\?$|편은\?$|방식은\?$|것은\?$|측면|요소/);
    }
  });

  /**
   * 「300만원이면 신혼여행 한 번인데」는 틀린 숫자였다(둘이 가는 신혼여행은 그보다 훨씬
   * 든다). 비교가 필요하면 결혼 준비 안의 숫자로 한다 — 식대 1인 7만원 안팎이면 40명분.
   */
  it("300만원을 신혼여행 한 번과 같다고 쓰지 않는다", () => {
    const allText = WEDDING_CODE_V10_QUESTIONS.flatMap((question) => [
      question.scene,
      question.question,
      ...question.options.map((option) => option.label),
    ]).join("\n");
    expect(allText).not.toMatch(/300만원이면 신혼여행/);
  });

  /**
   * v0.8 C5 에 「여쭀다」가 있었다. `쭀`(U+CB40)은 `쭸`(U+CB78)과 모양이 비슷한 다른 글자라
   * 눈으로는 안 보이고 검사도 없었다. 세 판 어디에도 다시 들어오지 않게 한다.
   */
  it("v0.8·v0.9·v1.0 어디에도 모양만 비슷한 잘못된 글자(쭀)가 없다", async () => {
    const { WEDDING_CODE_V08_QUESTIONS, WEDDING_CODE_V08_NEXT_STEPS } = await import("../weddingCodeV08");
    const texts: string[] = [...WEDDING_CODE_V08_QUESTIONS, ...WEDDING_CODE_V09_QUESTIONS, ...WEDDING_CODE_V10_QUESTIONS].flatMap((question) => [
      question.scene,
      question.question,
      ...question.options.map((option) => option.label),
    ]);
    texts.push(...Object.values(WEDDING_CODE_V08_NEXT_STEPS), ...Object.values(WEDDING_CODE_V09_NEXT_STEPS),
      ...Object.values(WEDDING_CODE_V10_NEXT_STEPS));
    for (const text of texts) expect(text, text).not.toContain("쭀");
  });

  /**
   * v0.8 의 「준비가 한꺼번에 밀린 주」 네 답은 전부 규칙·방침이었다(「매주 …하기로 했다」,
   * 「끝까지 책임지기로 했다」). 방침은 동시에 여러 개가 참일 수 있어 하나만 고를 수 없다.
   * 한 문항 안에서 「~하기로 했다」가 둘 넘게 나오지 않게 한다.
   */
  it("한 문항에 방침형 선택지(~하기로 했다)가 몰리지 않는다", () => {
    for (const question of WEDDING_CODE_V10_QUESTIONS) {
      const policies = question.options.filter((option) => /하기로 했다$/.test(option.label));
      expect(policies.length, question.key).toBeLessThanOrEqual(1);
    }
  });

  /**
   * 새 판이 옛 판을 조용히 복사하면 판을 올린 이유가 없다. 팀원이 짚은 문항은 선택지가
   * 실제로 바뀌었는지 본다.
   */
  it("팀원이 짚은 문항은 v0.8 과 선택지가 다르다", async () => {
    const { WEDDING_CODE_V08_QUESTIONS } = await import("../weddingCodeV08");
    for (const key of ["A1", "A2", "A4", "B1", "B2", "C1", "C4", "C5", "D5"] as const) {
      const before = WEDDING_CODE_V08_QUESTIONS.find((question) => question.key === key)!;
      const after = WEDDING_CODE_V10_QUESTIONS.find((question) => question.key === key)!;
      const beforeLabels = new Set<string>(before.options.map((option) => option.label));
      const kept = after.options.filter((option) => beforeLabels.has(option.label));
      expect(kept.length, key).toBeLessThanOrEqual(1);
    }
  });

  /**
   * v0.9 → v1.0 에서 바뀐 것은 A2 의 B·D 두 문장뿐이다. 판을 올린 김에 다른 문항까지 조용히
   * 바뀌면, 옛 판과 새 판의 답을 문항별로 나란히 놓고 볼 수 없다. 문장이 한 글자라도 다르면
   * 그 문항도 판을 올린 이유에 적어야 한다.
   */
  it("v1.0 은 A2 의 B·D 문장만 v0.9 와 다르고 나머지는 한 글자도 같다", () => {
    expect(WEDDING_CODE_V10_QUESTIONS.map((question) => question.key))
      .toEqual(WEDDING_CODE_V09_QUESTIONS.map((question) => question.key));
    for (const [index, after] of WEDDING_CODE_V10_QUESTIONS.entries()) {
      const before = WEDDING_CODE_V09_QUESTIONS[index];
      expect([after.axis, after.scene, after.question], after.key).toEqual([before.axis, before.scene, before.question]);
      const beforeOptions = before.options as readonly WeddingCodeV06Option[];
      for (const [position, option] of optionsOf(after).entries()) {
        const old = beforeOptions[position];
        const where = `${after.key}${option.value}`;
        expect({ value: option.value, candid: option.candid, weights: option.weights }, where)
          .toEqual({ value: old.value, candid: old.candid, weights: old.weights });
        if (after.key === "A2" && (option.value === "B" || option.value === "D")) {
          expect(option.label, where).not.toBe(old.label);
        } else {
          expect(option.label, where).toBe(old.label);
        }
      }
    }
    expect(WEDDING_CODE_V10_NEXT_STEPS).toEqual(WEDDING_CODE_V09_NEXT_STEPS);
  });

  it("A2 의 네 선택지는 서로 다른 것을 잰다", () => {
    const a2 = WEDDING_CODE_V10_QUESTIONS.find((question) => question.key === "A2")!;
    const constructs = a2.options.map((option) => option.weights.map((weight) => weight.construct).join("+"));
    expect(constructs).toEqual(["costRisk", "experienceMeaning", "evidenceDecision", "aestheticMood"]);
    expect(new Set(constructs).size).toBe(a2.options.length);
  });

  /**
   * v0.9 A2 의 B 「'한 번뿐인 날인데 여기서 하자'고 했다」와 D 「'여기 봐' 하고 그 홀 사진 한 장만
   * 보냈다」는 둘 다 「이 홀로 하고 싶다」로 읽혀서, 결혼식 날의 의미와 분위기 중 무엇을 골랐는지
   * 갈리지 않았다. B 는 받은 인상, D 는 눈에 보인 모습만 말해야 한다.
   */
  it("A2 의 B·D 가 더는 둘 다 「이 홀로 하자」는 말이 아니다", () => {
    const wantsThisHall = /하자|여기 봐|여기서|여기로|이 홀로|이 홀에서|거기서|거기로|계약/;
    const labelOf = (questions: readonly WeddingCodeV06Question[], value: "B" | "D") =>
      questions.find((question) => question.key === "A2")!.options.find((option) => option.value === value)!.label;
    // 이 검사가 실제로 v0.9 의 문제를 알아보는지 먼저 확인한다.
    expect(labelOf(WEDDING_CODE_V09_QUESTIONS, "B")).toMatch(wantsThisHall);
    expect(labelOf(WEDDING_CODE_V09_QUESTIONS, "D")).toMatch(wantsThisHall);
    expect(labelOf(WEDDING_CODE_V10_QUESTIONS, "B")).not.toMatch(wantsThisHall);
    expect(labelOf(WEDDING_CODE_V10_QUESTIONS, "D")).not.toMatch(wantsThisHall);
    // B 는 결혼식 날에 거는 기대·받은 인상, D 는 사진·분위기 쪽 말이다. 둘이 서로를 흉내내지 않는다.
    expect(labelOf(WEDDING_CODE_V10_QUESTIONS, "B")).not.toMatch(/조명|사진|예뻤|예쁘|꽃|천장|분위기/);
    expect(labelOf(WEDDING_CODE_V10_QUESTIONS, "D")).not.toMatch(/실감|한 번뿐|평생|의미|결혼하는/);
  });
});
