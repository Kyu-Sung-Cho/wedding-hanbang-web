/**
 * 결과 전 글자 고르기의 기준 계산기 대조(JS 오라클).
 *
 * 기존 JS 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs)는 **읽기만** 한다(새 기준 계산기 파일을 만들지 않는다). 같은 은행으로 시드 무작위 응답자 3,000명과
 * 위치 반복 응답자 1,200명(위치 반복 힌트로 세기가 낮아진 결과를 만든다)을 만들고 두 갈래로 요약한다.
 *   (가) TS: buildResult(TS) -> summarizeLetterGuess, isLetterGuessEligible
 *   (나) 기준: ref.buildResult 가 낸 결과를 이 파일 아래의 oracleSummary 가 계획 7.4의 표대로 읽은 것(TS 모듈을 가져오지 않고 표에서 다시 썼다)
 * 응답자마다 고르기 조합 81가지(주제마다 고르지 않음, 앞글자, 뒤글자)를 모두 넣어 두 갈래의 요약이 같은지 본다.
 * 채점이 어긋나면 이 시험도 빨개지지만 어디가 갈렸는지 알 수 있게 먼저 결과의 글자, 세기, 임시 여부, 코드를 따로 대조한다.
 */
import { describe, expect, it } from "vitest";
import * as oracleModule from "../../../../../../../scripts/lib/wedding-code-v40-ref.mjs";
import { V40_BANK_DATA } from "@/constants/weddingCodeV40Bank";
import { V40_AXIS_KEYS } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "../bank";
import { buildResult } from "../score";
import type { FormBit, Responses } from "../types";
import { isLetterGuessEligible, summarizeLetterGuess } from "./letterGuess";
import type { LetterGuess, LetterGuessSummary } from "./types";

// ---------------------------------------------------------------------------
// 기준 계산기 표면
// ---------------------------------------------------------------------------

interface OracleAxis {
  readonly axis: string;
  readonly letter: string | null;
  readonly provisional: boolean;
  readonly shownBand: string | null;
}

interface OracleResult {
  readonly code: string | null;
  readonly axes: readonly OracleAxis[];
  readonly notes: { readonly demoted: boolean };
}

interface OracleItem {
  readonly id: string;
  readonly fmt: string;
}

interface OracleRespondent {
  readonly formBit: FormBit;
  readonly responses: Responses;
}

interface OracleApi {
  readonly AXES: readonly string[];
  readonly LETTER_OF: Readonly<Record<string, { readonly front: string; readonly back: string }>>;
  makeBank(data: unknown): { readonly items: readonly OracleItem[] };
  viewToStored(item: OracleItem, formBit: number, view: unknown): string | null;
  randomRespondent(
    bank: unknown,
    seed: number,
    options?: { mode?: "uniform" | "persona"; formBit?: FormBit; skipRate?: number; naRate?: number; spread?: number },
  ): OracleRespondent;
  buildResult(bank: unknown, formBit: number, responses: Responses): OracleResult;
  mulberry32(seed: number): () => number;
}

const ref = oracleModule as unknown as OracleApi;
const oracleBank = ref.makeBank(V40_BANK_DATA);

// ---------------------------------------------------------------------------
// 응답자와 고르기 조합
// ---------------------------------------------------------------------------

const RESPONDENT_COUNT = 3000;

const KINDS = [
  { mode: "persona", skipRate: 0.04, naRate: 0.03 },
  { mode: "uniform", skipRate: 0.04, naRate: 0.03 },
  { mode: "persona", skipRate: 0.01, naRate: 0.01 },
  { mode: "uniform", skipRate: 0.15, naRate: 0.1 },
  { mode: "persona", skipRate: 0.15, naRate: 0.1 },
  { mode: "persona", skipRate: 0.35, naRate: 0.05 },
  { mode: "persona", skipRate: 0.03, naRate: 0.5 },
  { mode: "uniform", skipRate: 0.4, naRate: 0.4 },
  { mode: "persona", skipRate: 0.7, naRate: 0.25 },
  { mode: "persona", skipRate: 0.02, naRate: 0.02 },
] as const;

const PATTERNED_COUNT = 1200;

/**
 * 위치 반복 응답자. 성향이 뚜렷한 무작위 응답자를 바탕으로 두 형식 이상(두 가지 중 고르기, 이럴 때, 고르기)의 화면 위치를 같은 칸이나 번갈아 누르는 칸으로 바꾼다.
 * 두 형식이 위치 반복이면 모든 세기가 한 단계 낮아지고(힌트), 세 형식이면 관문이 닫힌다. 힌트로 세기가 낮아진 결과를 오라클이 읽도록 한다.
 */
function makePatternedRespondents(): OracleRespondent[] {
  const familyOf = (fmt: string): "pair" | "react" | "choose" | null =>
    fmt === "pair" ? "pair" : fmt === "react" ? "react" : fmt === "recall" || fmt === "instant" ? "choose" : null;
  const frozenSets: readonly (readonly ("pair" | "react" | "choose")[])[] = [
    ["pair", "react"],
    ["pair", "choose"],
    ["react", "choose"],
    ["pair", "react", "choose"],
  ];
  const list: OracleRespondent[] = [];
  for (let i = 0; i < PATTERNED_COUNT; i += 1) {
    const formBit = (i % 2) as FormBit;
    const base = ref.randomRespondent(oracleBank, 700_000 + i, { mode: "persona", spread: 3 + (i % 3), skipRate: 0.01, naRate: 0.01, formBit });
    const rng = ref.mulberry32(800_000 + i);
    const pick = (n: number) => Math.floor(rng() * n);
    const frozen = frozenSets[i % frozenSets.length];
    const period = 1 + (Math.floor(i / frozenSets.length) % 2);
    const cells = { pair: [pick(6), pick(6)], react: [pick(5), pick(5)], choose: [pick(4), pick(4)] };
    const used = { pair: 0, react: 0, choose: 0 };
    const responses: Record<string, string> = { ...base.responses };
    for (const item of oracleBank.items) {
      const family = familyOf(item.fmt);
      if (family === null || !frozen.includes(family)) continue;
      const step = used[family];
      used[family] += 1;
      const cell = cells[family][step % period];
      const view = family === "pair" ? { fmt: "pair", cell } : family === "react" ? { fmt: "react", cell } : { fmt: item.fmt, option: cell };
      const stored = ref.viewToStored(item, formBit, view);
      if (stored === null) throw new Error(`위치 반복 응답이 저장값으로 바뀌지 않아요: ${item.id}`);
      responses[item.id] = stored;
    }
    list.push({ formBit, responses });
  }
  return list;
}

type PickSide = "front" | "back" | null;

/** 주제마다 (고르지 않음, 앞글자, 뒤글자) 3가지, 네 주제 81가지. */
function allPickSides(): PickSide[][] {
  const options: PickSide[] = [null, "front", "back"];
  const out: PickSide[][] = [];
  for (const a of options) for (const b of options) for (const c of options) for (const d of options) out.push([a, b, c, d]);
  return out;
}

const PICK_SIDES = allPickSides();

/** 기준 계산기의 글자표(LETTER_OF)로 고른 글자를 만든다. TS 의 axisInfo 를 쓰지 않는다. */
function lettersOf(sides: readonly PickSide[]): (string | null)[] {
  return sides.map((side, index) => (side === null ? null : ref.LETTER_OF[ref.AXES[index]][side]));
}

// ---------------------------------------------------------------------------
// 오라클: 계획 7.4의 표를 기준 계산기의 결과에 적용한다(TS 모듈을 가져오지 않았다)
// ---------------------------------------------------------------------------

type OracleSummary =
  | { readonly kind: "none" }
  | { readonly kind: "lines"; readonly lines: readonly { readonly axis: string; readonly guessed: string; readonly shown: string }[] }
  | { readonly kind: "same" }
  | { readonly kind: "unsettledOnly" };

function oracleSettled(axis: OracleAxis): boolean {
  return axis.letter !== null && axis.provisional === false && (axis.shownBand === "clear" || axis.shownBand === "lean");
}

function oracleEligible(result: OracleResult): boolean {
  return result.code !== null && result.axes.some(oracleSettled);
}

function oracleSummary(result: OracleResult, picks: readonly (string | null)[]): OracleSummary {
  if (result.code === null) return { kind: "none" };
  if (picks.every((pick) => pick === null)) return { kind: "none" };
  const differing: { axis: string; guessed: string; shown: string }[] = [];
  let sameCount = 0;
  for (let index = 0; index < 4; index += 1) {
    const pick = picks[index];
    if (pick === null) continue;
    const axis = result.axes[index];
    if (!oracleSettled(axis) || axis.letter === null) continue;
    if (pick === axis.letter) sameCount += 1;
    else differing.push({ axis: axis.axis, guessed: pick, shown: axis.letter });
  }
  if (differing.length > 0) return { kind: "lines", lines: differing };
  if (sameCount > 0) return { kind: "same" };
  return { kind: "unsettledOnly" };
}

describe("결과 전 글자 고르기: 기준 계산기와 같은 요약을 낸다", () => {
  it(
    "시드 무작위 응답자 3,000명 x 고르기 81가지: 결과의 글자, 세기, 임시 여부, 코드, 열기 판정, 요약이 모두 같다",
    () => {
      const stats = { respondents: 0, eligible: 0, closed: 0, demoted: 0, demotedEligible: 0, comparisons: 0, none: 0, lines: 0, same: 0, unsettledOnly: 0, lineCountAtLeastTwo: 0 };
      const everyone: OracleRespondent[] = [];
      for (let i = 0; i < RESPONDENT_COUNT; i += 1) {
        const kind = KINDS[i % KINDS.length];
        const formBit = (Math.floor(i / KINDS.length) % 2) as FormBit;
        everyone.push(ref.randomRespondent(oracleBank, 1000 + i, { ...kind, formBit, spread: i % 5 === 0 ? 4 : 2 }));
      }
      everyone.push(...makePatternedRespondents());
      for (const [i, respondent] of everyone.entries()) {
        const formBit = respondent.formBit;
        const expected = ref.buildResult(oracleBank, formBit, respondent.responses);
        const actual = buildResult(WEDDING_CODE_V40_BANK, formBit, respondent.responses);

        // 먼저 요약이 읽는 값을 따로 대조한다(어디가 갈렸는지 알 수 있게).
        expect(actual.code, `응답자 ${i} 코드`).toBe(expected.code);
        actual.axes.forEach((axis, index) => {
          expect(axis.letter, `응답자 ${i} 주제 ${index} 글자`).toBe(expected.axes[index].letter);
          expect(axis.shownBand, `응답자 ${i} 주제 ${index} 세기`).toBe(expected.axes[index].shownBand);
          expect(axis.provisional, `응답자 ${i} 주제 ${index} 임시`).toBe(expected.axes[index].provisional);
          expect(axis.axis, `응답자 ${i} 주제 ${index} 이름`).toBe(V40_AXIS_KEYS[index]);
        });

        const eligible = oracleEligible(expected);
        expect(isLetterGuessEligible(actual), `응답자 ${i} 열기`).toBe(eligible);
        stats.respondents += 1;
        if (eligible) stats.eligible += 1;
        if (expected.code === null) stats.closed += 1;
        if (expected.notes.demoted) {
          stats.demoted += 1;
          if (eligible) stats.demotedEligible += 1;
        }

        for (const sides of PICK_SIDES) {
          const picks = lettersOf(sides);
          const want = oracleSummary(expected, picks);
          const got: LetterGuessSummary = summarizeLetterGuess(actual, picks as unknown as LetterGuess);
          expect(got, `응답자 ${i} 고르기 ${sides.join("/")}`).toStrictEqual(want);
          stats.comparisons += 1;
          stats[got.kind] += 1;
          if (got.kind === "lines" && got.lines.length >= 2) stats.lineCountAtLeastTwo += 1;
        }
      }
      // 측정기가 비어 있지 않다: 네 종류의 요약과 닫힌 결과와 열 수 없는 결과가 모두 실제로 많이 나왔다.
      expect(stats.respondents).toBe(RESPONDENT_COUNT + PATTERNED_COUNT);
      expect(stats.comparisons).toBe((RESPONDENT_COUNT + PATTERNED_COUNT) * 81);
      expect(stats.closed).toBeGreaterThan(0);
      expect(stats.eligible).toBeGreaterThan(RESPONDENT_COUNT * 0.3);
      expect(stats.eligible).toBeLessThan(RESPONDENT_COUNT + PATTERNED_COUNT);
      // 힌트로 세기가 낮아진 결과도 많고, 그 가운데 글자가 확정된 주제가 남은 결과도 있다.
      expect(stats.demoted).toBeGreaterThan(300);
      expect(stats.demotedEligible).toBeGreaterThan(50);
      expect(stats.none).toBeGreaterThan(1000);
      expect(stats.lines).toBeGreaterThan(1000);
      expect(stats.same).toBeGreaterThan(1000);
      expect(stats.unsettledOnly).toBeGreaterThan(100);
      expect(stats.lineCountAtLeastTwo).toBeGreaterThan(100);
    },
    180_000,
  );

  it("오라클이 손으로 만든 결과에서도 표 그대로 읽는다(오라클 자체의 점검)", () => {
    const axis = (letter: string | null, shownBand: string | null, provisional = false): OracleAxis => ({ axis: "x", letter, provisional, shownBand });
    const result: OracleResult = {
      code: "VWFA",
      axes: [axis("V", "clear"), axis("W", "even"), axis("F", "lean", true), axis(null, null)],
      notes: { demoted: false },
    };
    expect(oracleEligible(result)).toBe(true);
    expect(oracleSummary(result, ["S", null, null, null])).toStrictEqual({ kind: "lines", lines: [{ axis: "x", guessed: "S", shown: "V" }] });
    expect(oracleSummary(result, ["V", "D", "U", "H"])).toStrictEqual({ kind: "same" });
    expect(oracleSummary(result, [null, "D", "U", "H"])).toStrictEqual({ kind: "unsettledOnly" });
    expect(oracleSummary(result, [null, null, null, null])).toStrictEqual({ kind: "none" });
    expect(oracleSummary({ ...result, code: null }, ["S", null, null, null])).toStrictEqual({ kind: "none" });
    expect(oracleEligible({ ...result, code: null })).toBe(false);
  });
});
