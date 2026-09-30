import { describe, expect, it } from "vitest";
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import type { FormBit, Item, ResponseValue, Responses, RhythmFamily, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { RHYTHM_MIN_ANSWERS, RHYTHM_THRESHOLD_16THS, gatesModule, isSkipHintCount, rhythmReport, skipHint, skippedCount } from "./gates";
import { toStored } from "./present";
import { buildResult } from "./score";
import { stateChar } from "./states";

const bank = WEDDING_CODE_V40_BANK;
const FORMS: readonly FormBit[] = [0, 1];

type Step = number | "skip" | "na";

interface Plan {
  readonly pair: readonly Step[];
  readonly react: readonly Step[];
  readonly choose: readonly Step[];
}

/** 화면에서 누른 위치(pair 는 0 위 카드, 1 아래 카드)를 화면 답으로 바꾼다. */
function viewFor(item: Item, step: number): ViewAnswer {
  switch (item.fmt) {
    case "pair":
      return { fmt: "pair", cell: step === 0 ? 0 : 5 };
    case "react":
      return { fmt: "react", cell: step };
    case "recall":
    case "instant":
      return { fmt: item.fmt, option: step };
    default:
      throw new Error(`위치 반복 검사 대상이 아니다: ${item.fmt}`);
  }
}

/**
 * 형식 묶음마다 질문 순서의 k 번째 문항에 누른 위치를 정해 68개 응답을 만든다. 그 밖의 형식은 위치 반복 검사와 무관해서 아무 답이나 넣는다.
 * 모든 응답은 화면 답을 toStored 로 바꾼 저장값이다(폼 비트가 반영된다).
 */
function respond(formBit: FormBit, plan: Plan): Responses {
  const counters = { pair: 0, react: 0, choose: 0 };
  const responses: Record<string, ResponseValue> = {};
  bank.items.forEach((item, index) => {
    const family: keyof Plan | null = item.fmt === "pair" ? "pair" : item.fmt === "react" ? "react" : item.fmt === "recall" || item.fmt === "instant" ? "choose" : null;
    if (family === null) {
      const filler: ViewAnswer =
        item.fmt === "bestworst"
          ? { fmt: "bestworst", best: index % 4, worst: (index + 1) % 4 }
          : item.fmt === "split"
            ? { fmt: "split", counts: [2, 2, 2] }
            : { fmt: "self", cell: index % 6 };
      responses[item.id] = toStored(item, formBit, filler) as string;
      return;
    }
    const step = plan[family][counters[family]];
    counters[family] += 1;
    if (step === "skip" || step === "na") responses[item.id] = step;
    else responses[item.id] = toStored(item, formBit, viewFor(item, step)) as string;
  });
  return responses;
}

const repeat = (value: number, times: number): number[] => Array.from({ length: times }, () => value);
/** 길이 16, 값 base 가 대부분이고 정한 위치만 다른 값. */
function withOthers(base: number, others: Record<number, number>, size = 16): number[] {
  return Array.from({ length: size }, (_, i) => (i in others ? others[i] : base));
}

/** 서로 다른 위치가 자주 섞여 주기 검사에 걸리지 않는 순서(react 는 0에서 4, choose 는 0에서 3, pair 는 0, 1). */
const SCATTER_PAIR = [0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0];
const SCATTER_REACT = [0, 3, 1, 4, 2, 2, 4, 0, 3, 1, 1, 4, 0, 2, 3, 2];
const SCATTER_CHOOSE = [0, 2, 3, 1, 1, 3, 0, 2, 3, 0, 2, 1, 2, 1, 0, 3];
const SCATTER: Plan = { pair: SCATTER_PAIR, react: SCATTER_REACT, choose: SCATTER_CHOOSE };

/** 시험이 따로 쓰는 일치도 계산(주기 1에서 4, 위치 묶음별 최다 값 수의 합의 최댓값과 가장 작은 최적 주기). */
function bruteForceAgree(sequence: readonly number[]): { period: number; agree: number } {
  let best = { period: 1, agree: -1 };
  for (let period = 1; period <= 4; period += 1) {
    let agree = 0;
    for (let residue = 0; residue < period; residue += 1) {
      const tally: Record<number, number> = {};
      for (let i = residue; i < sequence.length; i += period) tally[sequence[i]] = (tally[sequence[i]] ?? 0) + 1;
      agree += Math.max(...Object.values(tally));
    }
    if (agree > best.agree) best = { period, agree };
  }
  return best;
}

const reportOf = (report: ReturnType<typeof rhythmReport>, family: RhythmFamily) => report.formats.find((format) => format.family === family)!;

describe("위치 반복 검사: 상수", () => {
  it("검사 시작 답 수 12, 임계 pair 15 / react 14 / choose 14", () => {
    expect(RHYTHM_MIN_ANSWERS).toBe(12);
    expect(RHYTHM_MIN_ANSWERS).toBe(V40_COUNTS.minValidAnswers);
    expect(RHYTHM_THRESHOLD_16THS).toEqual({ pair: 15, react: 14, choose: 14 });
  });

  it("보고서는 pair, react, choose 순서의 세 묶음이다", () => {
    const report = rhythmReport(bank, 0, respond(0, SCATTER));
    expect(report.formats.map((format) => format.family)).toEqual(["pair", "react", "choose"]);
  });
});

describe("위치 반복 검사: 늘 같은 위치, 번갈아, 주기", () => {
  it("늘 위 카드, 늘 왼쪽 칸, 늘 첫 보기면 세 묶음 모두 표시하고 관문 조건(세 묶음)이 된다(두 폼 비트)", () => {
    for (const formBit of FORMS) {
      const report = rhythmReport(bank, formBit, respond(formBit, { pair: repeat(0, 16), react: repeat(0, 16), choose: repeat(0, 16) }));
      for (const format of report.formats) {
        expect(format.considered).toBe(16);
        expect(format.period).toBe(1);
        expect(format.agree).toBe(16);
        expect(format.flagged).toBe(true);
      }
      expect(report.flaggedCount).toBe(3);
    }
  });

  it("같은 화면 위치를 눌렀다면 폼 비트가 달라 저장 상태가 달라도 표시는 같다", () => {
    const plan: Plan = { pair: repeat(1, 16), react: repeat(4, 16), choose: repeat(3, 16) };
    const zero = respond(0, plan);
    const one = respond(1, plan);
    expect(zero).not.toEqual(one);
    expect(rhythmReport(bank, 0, zero)).toEqual(rhythmReport(bank, 1, one));
    expect(rhythmReport(bank, 0, zero).flaggedCount).toBe(3);
  });

  it("위/아래 번갈아 누르면 주기 2, 일치 16 이고 주기 1 로는 8 뿐이다", () => {
    const alternating = Array.from({ length: 16 }, (_, i) => i % 2);
    for (const formBit of FORMS) {
      const report = rhythmReport(bank, formBit, respond(formBit, { ...SCATTER, pair: alternating }));
      const pair = reportOf(report, "pair");
      expect(pair.period).toBe(2);
      expect(pair.agree).toBe(16);
      expect(pair.flagged).toBe(true);
      expect(bruteForceAgree(alternating)).toEqual({ period: 2, agree: 16 });
    }
  });

  it("react 를 0, 1, 2 순서로 돌려 누르면 주기 3 이 최적이다", () => {
    const cycle = Array.from({ length: 16 }, (_, i) => i % 3);
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: cycle }));
    const react = reportOf(report, "react");
    expect(react.period).toBe(3);
    expect(react.agree).toBe(16);
    expect(react.flagged).toBe(true);
  });

  it("choose 를 0, 1, 2, 3 순서로 돌려 누르면 주기 4 이고 일치 16", () => {
    const cycle = Array.from({ length: 16 }, (_, i) => i % 4);
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, choose: cycle }));
    const choose = reportOf(report, "choose");
    expect(choose.period).toBe(4);
    expect(choose.agree).toBe(16);
    expect(choose.flagged).toBe(true);
  });

  it("주기가 5 이상이면 잡지 않는다(1에서 4 까지만 본다)", () => {
    const cycle = Array.from({ length: 16 }, (_, i) => i % 5);
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: cycle }));
    const react = reportOf(report, "react");
    expect(react.flagged).toBe(false);
    expect(react.period).not.toBeNull();
    expect(react.agree).toBe(bruteForceAgree(cycle).agree);
  });

  it("무작위처럼 흩어진 답은 어느 묶음도 표시하지 않는다", () => {
    for (const formBit of FORMS) {
      const report = rhythmReport(bank, formBit, respond(formBit, SCATTER));
      expect(report.flaggedCount).toBe(0);
      for (const format of report.formats) {
        expect(format.flagged).toBe(false);
        expect(format.considered).toBe(16);
        expect(format.period).not.toBeNull();
      }
    }
  });

  it("최적 주기가 여럿이면 가장 작은 주기를 고른다", () => {
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: repeat(0, 16) }));
    expect(reportOf(report, "pair").period).toBe(1);
  });
});

describe("위치 반복 검사: 임계 경계 (정수 비교 agree x 16 >= considered x 임계)", () => {
  it("pair: 답 16개에서 일치 15 는 표시, 14 는 표시하지 않는다", () => {
    const fifteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: withOthers(0, { 7: 1 }) }));
    expect(reportOf(fifteen, "pair").agree).toBe(15);
    expect(reportOf(fifteen, "pair").flagged).toBe(true);
    const fourteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: withOthers(0, { 1: 1, 3: 1 }) }));
    expect(reportOf(fourteen, "pair").agree).toBe(14);
    expect(reportOf(fourteen, "pair").flagged).toBe(false);
  });

  it("react: 답 16개에서 일치 14 는 표시, 13 은 표시하지 않는다", () => {
    const fourteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: withOthers(0, { 3: 1, 12: 3 }) }));
    expect(reportOf(fourteen, "react").agree).toBe(14);
    expect(reportOf(fourteen, "react").flagged).toBe(true);
    const thirteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: withOthers(0, { 3: 1, 8: 2, 13: 3 }) }));
    expect(reportOf(thirteen, "react").agree).toBe(13);
    expect(reportOf(thirteen, "react").flagged).toBe(false);
  });

  it("choose: 답 16개에서 일치 14 는 표시, 13 은 표시하지 않는다", () => {
    const fourteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, choose: withOthers(0, { 3: 1, 12: 3 }) }));
    expect(reportOf(fourteen, "choose").agree).toBe(14);
    expect(reportOf(fourteen, "choose").flagged).toBe(true);
    const thirteen = rhythmReport(bank, 0, respond(0, { ...SCATTER, choose: withOthers(0, { 3: 1, 8: 2, 13: 3 }) }));
    expect(reportOf(thirteen, "choose").agree).toBe(13);
    expect(reportOf(thirteen, "choose").flagged).toBe(false);
  });

  it("답이 12개(건너뜀 4개)일 때도 같은 비율을 쓴다: pair 는 12 중 12 만, react 와 choose 는 12 중 11 부터 표시", () => {
    const skips = (values: readonly Step[]): Step[] => values.map((value, i) => (i < 4 ? "skip" : value));
    // pair 12 개 모두 같은 위치: 12 x 16 = 192 >= 12 x 15 = 180
    const allSame = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: skips(repeat(0, 16)) }));
    expect(reportOf(allSame, "pair")).toMatchObject({ considered: 12, agree: 12, flagged: true });
    // pair 12 개 중 11: 11 x 16 = 176 < 180
    const elevenOfTwelve = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: skips(withOthers(0, { 5: 1 })) }));
    expect(reportOf(elevenOfTwelve, "pair")).toMatchObject({ considered: 12, agree: 11, flagged: false });
    // react 12 개 중 11: 176 >= 168 표시, 10: 160 < 168 표시하지 않음
    const react11 = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: skips(withOthers(0, { 5: 1 })) }));
    expect(reportOf(react11, "react")).toMatchObject({ considered: 12, agree: 11, flagged: true });
    const react10 = rhythmReport(bank, 0, respond(0, { ...SCATTER, react: skips(withOthers(0, { 5: 1, 9: 2 })) }));
    expect(reportOf(react10, "react")).toMatchObject({ considered: 12, agree: 10, flagged: false });
    const choose11 = rhythmReport(bank, 0, respond(0, { ...SCATTER, choose: skips(withOthers(0, { 5: 1 })) }));
    expect(reportOf(choose11, "choose")).toMatchObject({ considered: 12, agree: 11, flagged: true });
  });

  it("답이 12개 미만이면 검사하지 않는다(period null, agree 0, flagged false)", () => {
    const skips = (values: readonly Step[], count: number): Step[] => values.map((value, i) => (i < count ? "skip" : value));
    const report = rhythmReport(
      bank,
      0,
      respond(0, { pair: skips(repeat(0, 16), 5), react: skips(repeat(0, 16), 5), choose: skips(repeat(0, 16), 5) }),
    );
    for (const format of report.formats) {
      expect(format).toEqual({ family: format.family, considered: 11, period: null, agree: 0, flagged: false });
    }
    expect(report.flaggedCount).toBe(0);
  });

  it("해당 없음(na)도 검사에서 빠진다", () => {
    const na = (values: readonly Step[], count: number): Step[] => values.map((value, i) => (i < count ? "na" : value));
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: na(repeat(0, 16), 4) }));
    expect(reportOf(report, "pair")).toMatchObject({ considered: 12, flagged: true });
  });
});

describe("위치 반복 검사: 질문 순서와 빠진 값", () => {
  it("건너뛴 문항은 뺀 나머지 순서로 주기를 잰다", () => {
    const base = Array.from({ length: 16 }, (_, i) => i % 2);
    // 색인 3 을 건너뛰면 남은 15개의 순서가 밀린다
    const plan: Plan = { ...SCATTER, pair: base.map((value, i) => (i === 3 ? "skip" : value)) };
    const report = rhythmReport(bank, 0, respond(0, plan));
    const remaining = base.filter((_, i) => i !== 3);
    const pair = reportOf(report, "pair");
    expect(pair.considered).toBe(15);
    expect(pair.agree).toBe(bruteForceAgree(remaining).agree);
    expect(pair.period).toBe(bruteForceAgree(remaining).period);
    expect(pair.agree).toBeLessThan(16);
  });

  it("choose 는 recall 과 instant 를 질문 순서로 합쳐 하나의 열로 본다", () => {
    const choose = bank.scored.filter((item) => item.fmt === "recall" || item.fmt === "instant");
    expect(choose).toHaveLength(16);
    // 지난 일(recall)은 0번, 그때 나는(instant)은 1번 보기를 누른다
    const steps = choose.map((item) => (item.fmt === "recall" ? 0 : 1));
    const report = rhythmReport(bank, 0, respond(0, { ...SCATTER, choose: steps }));
    const merged = reportOf(report, "choose");
    expect(merged.considered).toBe(16);
    expect(merged.agree).toBe(bruteForceAgree(steps).agree);
    expect(merged.period).toBe(bruteForceAgree(steps).period);
    // recall 만 따로 세면 늘 같은 위치라 16개 중 8개 모두 일치하지만, 합친 열에서는 둘이 섞여 있다
    expect(merged.agree).toBeLessThan(16);
  });

  it("가장·가장 아닌 것, 칸 나누기, 자기 선택은 검사에 들어가지 않는다", () => {
    const report = rhythmReport(bank, 0, respond(0, SCATTER));
    expect(report.formats.reduce((sum, format) => sum + format.considered, 0)).toBe(48);
  });

  it("그 형식에 없는 문자나 답하지 않은 문항은 빠진 값으로 본다(던지지 않는다)", () => {
    const responses: Record<string, ResponseValue> = { ...respond(0, { pair: repeat(0, 16), react: repeat(0, 16), choose: repeat(0, 16) }) };
    const pairItems = bank.scored.filter((item) => item.fmt === "pair");
    responses[pairItems[0].id] = stateChar(6); // pair 는 0에서 5
    delete responses[pairItems[1].id];
    responses[pairItems[2].id] = "zzz";
    const report = rhythmReport(bank, 0, responses);
    expect(reportOf(report, "pair").considered).toBe(13);
  });

  it("응답이 비어 있어도 던지지 않고 검사하지 않은 보고서를 낸다", () => {
    const report = rhythmReport(bank, 0, {});
    expect(report.flaggedCount).toBe(0);
    for (const format of report.formats) expect(format).toMatchObject({ considered: 0, period: null, agree: 0, flagged: false });
  });

  it("폼 비트가 달라도 같은 저장 상태의 검사 결과는 같다(모든 위치가 같은 규칙으로 옮겨질 뿐이다)", () => {
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 200; n += 1) {
      const responses: Record<string, ResponseValue> = {};
      for (const item of bank.items) {
        const r = next();
        if (r < 0.05) responses[item.id] = "skip";
        else if (r < 0.08) responses[item.id] = "na";
        else {
          const counts = { pair: 6, react: 5, recall: 4, instant: 4, bestworst: 12, split: 28, self: 6 };
          responses[item.id] = stateChar(Math.floor(next() * counts[item.fmt]));
        }
      }
      expect(rhythmReport(bank, 0, responses)).toEqual(rhythmReport(bank, 1, responses));
    }
  });

  it("순수하다: 얼려 둔 응답을 넣어도 바꾸지 않고 같은 결과를 낸다", () => {
    const responses = Object.freeze({ ...respond(1, SCATTER) });
    expect(rhythmReport(bank, 1, responses)).toEqual(rhythmReport(bank, 1, responses));
  });
});

describe("표시 개수와 힌트, 관문의 입력", () => {
  it("표시된 묶음이 1개면 flaggedCount 1, 2개면 2, 3개면 3", () => {
    const one = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: repeat(0, 16) }));
    const two = rhythmReport(bank, 0, respond(0, { ...SCATTER, pair: repeat(0, 16), react: repeat(2, 16) }));
    const three = rhythmReport(bank, 0, respond(0, { pair: repeat(0, 16), react: repeat(2, 16), choose: repeat(1, 16) }));
    expect([one.flaggedCount, two.flaggedCount, three.flaggedCount]).toEqual([1, 2, 3]);
  });
});

describe("건너뜀 개수와 건너뜀 힌트", () => {
  /** 채점 문항 앞에서부터 count 개를 건너뜀으로 바꾼 응답. */
  function withSkips(count: number, extra: Record<string, ResponseValue> = {}): Responses {
    const responses: Record<string, ResponseValue> = { ...respond(0, SCATTER), ...extra };
    bank.scored.slice(0, count).forEach((item) => {
      responses[item.id] = "skip";
    });
    return responses;
  }

  it("skippedCount 는 채점 문항의 skip 만 센다(na, 자기 선택 건너뜀은 세지 않는다)", () => {
    expect(skippedCount(bank, respond(0, SCATTER))).toBe(0);
    expect(skippedCount(bank, withSkips(7))).toBe(7);
    const withNa: Record<string, ResponseValue> = { ...respond(0, SCATTER) };
    bank.scored.slice(0, 10).forEach((item) => {
      withNa[item.id] = "na";
    });
    for (const item of bank.self) withNa[item.id] = "skip";
    expect(skippedCount(bank, withNa)).toBe(0);
  });

  it("skipHint 는 16개까지는 false, 17개부터 true 다", () => {
    expect(V40_COUNTS.skipHintOver).toBe(16);
    expect(skipHint(bank, withSkips(0))).toBe(false);
    expect(skipHint(bank, withSkips(16))).toBe(false);
    expect(skipHint(bank, withSkips(17))).toBe(true);
    expect(skipHint(bank, withSkips(64))).toBe(true);
  });

  it("isSkipHintCount 는 규칙이 사는 유일한 자리이고 skipHint 와 buildResult 의 notes.hintSkip 이 모든 개수에서 같은 답을 낸다", () => {
    expect(isSkipHintCount(16)).toBe(false);
    expect(isSkipHintCount(17)).toBe(true);
    expect(isSkipHintCount(0)).toBe(false);
    for (let count = 0; count <= bank.scored.length; count += 1) {
      const responses = withSkips(count);
      expect(skipHint(bank, responses), `skip ${count}`).toBe(isSkipHintCount(count));
      expect(buildResult(bank, 0, responses).notes.hintSkip, `skip ${count}`).toBe(skipHint(bank, responses));
    }
  });

  it("해당 없음을 많이 눌러도 건너뜀 힌트가 켜지지 않는다", () => {
    const responses: Record<string, ResponseValue> = { ...respond(0, SCATTER) };
    for (const item of bank.scored) responses[item.id] = "na";
    expect(skippedCount(bank, responses)).toBe(0);
    expect(skipHint(bank, responses)).toBe(false);
  });

  it("응답이 비어 있으면 0 이고 힌트도 없다", () => {
    expect(skippedCount(bank, {})).toBe(0);
    expect(skipHint(bank, {})).toBe(false);
  });
});

describe("계약 묶음", () => {
  it("gatesModule 은 rhythmReport, skippedCount, skipHint, isSkipHintCount 를 가진다", () => {
    expect(Object.keys(gatesModule).sort()).toEqual(["isSkipHintCount", "rhythmReport", "skipHint", "skippedCount"]);
  });
});
