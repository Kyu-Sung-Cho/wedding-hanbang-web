import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_NON_PUBLIC_CONSTRUCTS,
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
  weddingCodeV06OptionLabel,
  type WeddingCodeV06Axis,
  type WeddingCodeV06AxisKey,
} from "../weddingCodeV06";

const AXIS_BY_KEY = new Map<WeddingCodeV06AxisKey, WeddingCodeV06Axis>(
  WEDDING_CODE_V06_AXES.map((axis) => [axis.key, axis]),
);

describe("웨딩코드 v0.6 문항", () => {
  it("버전이 고정돼 있고 16문항이다", () => {
    expect(WEDDING_CODE_V06_VERSION).toBe("v0.6-scene");
    expect(WEDDING_CODE_V06_QUESTIONS).toHaveLength(16);
    expect(new Set(WEDDING_CODE_V06_QUESTIONS.map((q) => q.key)).size).toBe(16);
  });

  it("네 축에 각각 네 문항씩 배분된다", () => {
    for (const axis of WEDDING_CODE_V06_AXES) {
      const forAxis = WEDDING_CODE_V06_QUESTIONS.filter((q) => q.axis === axis.key);
      expect(forAxis, axis.key).toHaveLength(4);
    }
  });

  /**
   * v0.5가 죽은 지점. 균등 무작위 응답에서 지원 순서가 우측 59.4%로 쏠렸고, 그 결과
   * 「할 일 먼저 쪽이에요」는 사람 특성이 아니라 가중치 설계 산물이었다.
   * 각 문항이 좌 2 : 우 2로 고정되면 이 편향이 구조적으로 불가능해진다.
   */
  it("문항마다 자기 축의 좌·우에 정확히 두 개씩, 같은 크기로 실린다", () => {
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      const axis = AXIS_BY_KEY.get(question.axis)!;
      const left = axis.left.constructs as readonly string[];
      const right = axis.right.constructs as readonly string[];

      let leftOptions = 0;
      let rightOptions = 0;
      let leftTotal = 0;
      let rightTotal = 0;

      for (const option of question.options) {
        const onLeft = option.weights.filter((w) => left.includes(w.construct));
        const onRight = option.weights.filter((w) => right.includes(w.construct));
        expect(
          onLeft.length + onRight.length,
          `${question.key}${option.value}: 자기 축 가중치가 정확히 1개여야 한다`,
        ).toBe(1);
        if (onLeft.length === 1) {
          leftOptions += 1;
          leftTotal += onLeft[0].value;
        } else {
          rightOptions += 1;
          rightTotal += onRight[0].value;
        }
      }

      expect(leftOptions, `${question.key}: 좌측 선택지 수`).toBe(2);
      expect(rightOptions, `${question.key}: 우측 선택지 수`).toBe(2);
      expect(leftTotal, `${question.key}: 좌우 총량 불균형`).toBe(rightTotal);
    }
  });

  /**
   * **가중치 균형만으로는 편향이 안 없어진다.**
   *
   * 첫 판은 16문항이 전부 LLRR이었다 — 축의 왼쪽 선택지가 **항상** A·B칸에 있었다.
   * 사람은 위쪽 선택지를 더 고르므로, 좌 2 : 우 2로 가중치를 맞춰놔도 실제 응답은
   * 네 축 전부 왼쪽으로 쏠린다. 균등 무작위 기대값이 50:50이라는 계산은 좌 2 : 우 2에서
   * 자동으로 따라 나오는 항등식이라 아무것도 증명하지 못한다(그 테스트는 그래서 지웠다).
   *
   * 실제로 봐야 하는 건 **좌우가 칸에 어떻게 배치돼 있는가**다.
   */
  it("좌우 선택지가 늘 같은 칸에 오지 않는다", () => {
    const patterns = new Map<string, string[]>();
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      const axis = AXIS_BY_KEY.get(question.axis)!;
      const left = axis.left.constructs as readonly string[];
      const shape = question.options
        .map((option) =>
          option.weights.some((weight) => left.includes(weight.construct)) ? "L" : "R",
        )
        .join("");
      patterns.set(shape, [...(patterns.get(shape) ?? []), question.key]);
    }
    const worst = [...patterns.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    expect(patterns.size, `배치 ${patterns.size}종`).toBeGreaterThanOrEqual(4);
    expect(
      worst[1].length,
      `배치 ${worst[0]}가 ${worst[1].length}/16 (${worst[1].join(",")})`,
    ).toBeLessThanOrEqual(6);
  });

  /**
   * 창피한 답이 전부 마지막 칸에 있으면 있으나 마나다 — 목록 맨 아래가 제일 안 눌린다.
   * 첫 판은 8개 중 6개가 D칸이었다.
   */
  it("솔직한 답이 마지막 칸에만 몰려 있지 않다", () => {
    const candid = /솔직히|그냥|넘겼다|미뤘다|통보|다들 하던데|덜 바쁜|사실/;
    const slots = new Map<string, number>();
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      for (const option of question.options) {
        if (candid.test(option.label)) {
          slots.set(option.value, (slots.get(option.value) ?? 0) + 1);
        }
      }
    }
    const total = [...slots.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThanOrEqual(6);
    expect(
      slots.get("D") ?? 0,
      `D칸에 ${slots.get("D") ?? 0}/${total}`,
    ).toBeLessThanOrEqual(Math.floor(total / 2));
  });

  /**
   * 두 사람이 **같은 문항**에 답한다. 「드레스는 내가, 예식장은 네가」처럼 한쪽 시점으로
   * 고정된 장면은 상대가 답을 고를 수가 없다 — 취향 문제가 아니라 기능 결함이다.
   */
  it("장면이 한쪽 시점으로 고정되지 않는다", () => {
    const onesided = /는 내가[,\s]|내가 보고|네가 보|상대는 아직|나만 /;
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      expect(question.scene, `${question.key}: "${question.scene}"`).not.toMatch(onesided);
    }
  });

  it("비공개 구성개념은 축 판정에 절대 섞이지 않는다", () => {
    const publicConstructs = new Set<string>(
      WEDDING_CODE_V06_AXES.flatMap((axis) => [...axis.left.constructs, ...axis.right.constructs]),
    );
    for (const construct of WEDDING_CODE_V06_NON_PUBLIC_CONSTRUCTS) {
      expect(publicConstructs.has(construct), construct).toBe(false);
    }
  });

  /**
   * v0.5는 16문항이 전부 「가장 먼저 확인할 것은?」·「먼저 할 일은?」이었다.
   * 같은 어미 열여섯 번은 퀴즈가 아니라 체크리스트다.
   */
  it("질문 어미가 한 가지로 반복되지 않는다", () => {
    const questions = WEDDING_CODE_V06_QUESTIONS.map((q) => q.question);
    expect(new Set(questions).size).toBe(16);

    // v0.5의 병 그 자체. 이 틀이 하나라도 살아 있으면 체크리스트로 되돌아간다.
    for (const question of questions) {
      expect(question, `v0.5 틀 재발: "${question}"`).not.toMatch(
        /먼저 (확인할|해야 할|할) (것|일)은\?$/,
      );
    }

    // 문자열이 유일한 것만으로는 부족하다 — 「…한 일은?」 열여섯 개도 전부 유일하다.
    // 실제로 봐야 하는 건 **어미 모양**이다.
    const endings = questions.map((q) => q.replace(/\?$/, "").split(" ").pop()!);
    const counts = new Map<string, number>();
    for (const ending of endings) counts.set(ending, (counts.get(ending) ?? 0) + 1);
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(counts.size, `어미 ${counts.size}종`).toBeGreaterThanOrEqual(8);
    expect(worst[1], `"${worst[0]}"가 ${worst[1]}/16`).toBeLessThanOrEqual(4);
  });

  /**
   * v0.5의 치명상. B1·B3·B4가 「업체나 장소」라는 자리표시어를 써서 이사업체 비교에 그대로
   * 갖다 붙여도 성립했다. 그러면 「이거 우리 얘긴데」가 안 터진다.
   */
  it("장면이 실제 결혼 준비다 — 자리표시어 금지", () => {
    const placeholders = /업체나 장소|어떤 업체|무언가를|어떤 것을|상대방과 함께 무언/;
    const weddingWords = [
      "예식", "결혼", "웨딩", "드레스", "스드메", "스튜디오", "본식", "하객", "청첩", "상견례",
      "예단", "예물", "폐백", "신혼", "투어", "견적", "계약", "촬영", "메이크업", "식장",
      "보증인원", "위약금", "홀", "명단", "축의",
    ];
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      expect(question.scene, `${question.key}: 자리표시어`).not.toMatch(placeholders);
      const hit = weddingWords.some((word) => question.scene.includes(word));
      expect(hit, `${question.key}: "${question.scene}" — 결혼 고유어 없음`).toBe(true);
    }
  });

  it("장면이 20~40자다 — 짧으면 추상적이고 길면 안 읽힌다", () => {
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      expect(question.scene.length, `${question.key}: "${question.scene}"`)
        .toBeGreaterThanOrEqual(20);
      expect(question.scene.length, `${question.key}: "${question.scene}"`)
        .toBeLessThanOrEqual(40);
    }
  });

  /**
   * 결과 화면이 「너는 "…", 나는 "…"」로 두 사람 답을 그대로 붙인다.
   * 그래서 label은 혼자 떼어놔도 말이 되는 1인칭 문장이어야 한다.
   */
  it("선택지가 그대로 인용 가능한 문장이다", () => {
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      expect(question.options, question.key).toHaveLength(4);
      for (const option of question.options) {
        expect(option.label.length, `${question.key}${option.value}: "${option.label}"`)
          .toBeGreaterThanOrEqual(8);
        expect(option.label.length, `${question.key}${option.value}: "${option.label}"`)
          .toBeLessThanOrEqual(30);
        // 「~것」·「~지」로 끝나는 명사구는 인용하면 문장이 안 된다.
        expect(option.label, `${question.key}${option.value}: 명사구는 인용 못 한다`)
          .not.toMatch(/(것|하기로 함)$/);
      }
      expect(new Set(question.options.map((o) => o.label)).size, question.key).toBe(4);
    }
  });

  it("같은 선택지 문장이 두 문항에 걸쳐 반복되지 않는다", () => {
    const all = WEDDING_CODE_V06_QUESTIONS.flatMap((q) => q.options.map((o) => o.label));
    expect(new Set(all).size, "중복 선택지").toBe(all.length);
  });

  it("같은 장면이 두 번 나오지 않는다", () => {
    const scenes = WEDDING_CODE_V06_QUESTIONS.map((q) => q.scene);
    expect(new Set(scenes).size).toBe(16);
  });

  /**
   * 창피한 답·나를 들키는 답이 0개면 아무도 자기 결과를 캡처하지 않는다.
   * v0.5는 선택지 64개가 전부 사회적으로 옳은 신중한 행동이었다.
   */
  it("솔직한 답이 충분히 들어 있다", () => {
    const candid = /솔직히|그냥|넘겼다|미뤘다|통보|다들 하던데|덜 바쁜|삼켰|어차피|사실/;
    const withCandid = WEDDING_CODE_V06_QUESTIONS.filter((q) =>
      q.options.some((o) => candid.test(o.label)),
    );
    expect(withCandid.length, `${withCandid.length}/16 문항만 솔직한 답을 가짐`)
      .toBeGreaterThanOrEqual(6);
  });

  it("판정 언어를 쓰지 않는다", () => {
    const banned = /점수|등급|유형|궁합|정확도|성공률|이혼|안전한|위험한|올바른|잘못된|해야 한다/;
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      for (const text of [question.scene, question.question, ...question.options.map((o) => o.label)]) {
        expect(text, `${question.key}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  it("성역할·특정 가족 형태를 전제하지 않는다", () => {
    const banned = /신부는|신랑은|여자는|남자는|며느리|사위|시부모|장인|장모|아내가|남편이/;
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      for (const text of [question.scene, question.question, ...question.options.map((o) => o.label)]) {
        expect(text, `${question.key}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  it("답 하나를 문장으로 인용할 수 있다", () => {
    // 칸(A~D) 배치는 편향 때문에 축마다 돌아간다. 특정 칸의 문구를 박아두면
    // 배치를 바꿀 때마다 이 테스트가 아무 결함 없이 깨진다 — 조회 자체를 검증한다.
    for (const question of WEDDING_CODE_V06_QUESTIONS) {
      for (const option of question.options) {
        expect(weddingCodeV06OptionLabel(question.key, option.value)).toBe(option.label);
      }
    }
    expect(() => weddingCodeV06OptionLabel("B1", "Z" as never)).toThrow();
  });
});
