/**
 * 웨딩코드 4.0 코어(states, present, value, score, gates, codec)와 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs)의 동등성 시험.
 *
 * 기준 계산기는 같은 규칙을 순수 JS 로 따로 구현한 것이다(README 9절). 같은 은행(V40_BANK_DATA)으로 두 조회 구조를 만들고
 * 시드 무작위 응답자 3,000명과 위치 패턴 응답자를 두 구현에 넣어 결과가 정확히 같은지 본다. 은행 문구에는 기대지 않는다(극, 형식, 배치만 쓴다).
 * 화면 답 왕복, 문항 값, 축 집계, 위치 반복 검사, 결과 전체, 링크 코드, 해시 읽기, 손상 코드 300건의 거절을 모두 대조한다.
 */
import { describe, expect, it } from "vitest";
import * as oracleModule from "../../../../../../scripts/lib/wedding-code-v40-ref.mjs";
import { V40_BANK_DATA } from "@/constants/weddingCodeV40Bank";
import { V40_STATE_ALPHABET, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import type { Bank, DecodedCode, FormBit, Format, Item, ResponseValue, Responses, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_LAYOUT } from "./layout";
import { buildGatedShareUrl, buildQuestionOnlyUrl, checksumChar, decodeCode, decodeShareParams, encodeCode, parseShareHash } from "./codec";
import { rhythmReport, skipHint, skippedCount } from "./gates";
import { fromStored, isViewAnswerComplete, toStored, viewPosition } from "./present";
import { buildResult, scoreResponses, selfLine } from "./score";
import {
  bestWorstPairOf,
  bestWorstStateOf,
  fromCodeChar,
  isResponseValueFor,
  isStateFor,
  splitCountsOf,
  splitStateOf,
  stateChar,
  stateIndex,
  toCodeChar,
} from "./states";
import { itemValue, selfChoice } from "./value";

// ---------------------------------------------------------------------------
// 기준 계산기 표면 (필요한 함수만 옮겨 적은 타입. 반환값은 unknown 으로 받아 toEqual 로 대조한다)
// ---------------------------------------------------------------------------

interface OracleRespondent {
  readonly seed: number;
  readonly formBit: FormBit;
  readonly responses: Record<string, ResponseValue>;
  readonly views: Record<string, ViewAnswer>;
}

interface OracleBank {
  readonly items: readonly Item[];
}

interface OracleApi {
  makeBank(data: unknown): OracleBank;
  mulberry32(seed: number): () => number;
  randomRespondent(
    bank: OracleBank,
    seed: number,
    options?: { mode?: "uniform" | "persona"; formBit?: FormBit; skipRate?: number; naRate?: number; spread?: number },
  ): OracleRespondent;
  stateChar(index: number): string;
  stateIndexOf(char: string): number | null;
  isStateFor(fmt: Format, char: string): boolean;
  isResponseValueFor(fmt: Format, value: string): boolean;
  splitStateOf(a: number, b: number): number;
  splitCountsOf(state: number): readonly number[];
  bestWorstStateOf(best: number, worst: number): number;
  bestWorstPairOf(state: number): { best: number; worst: number };
  toCodeChar(value: string): string;
  fromCodeChar(char: string): string | null;
  itemValue(item: Item, value: string | undefined): number | null;
  selfChoice(item: Item, value: string | undefined): unknown;
  isViewComplete(item: Item, view: unknown): boolean;
  viewToStored(item: Item, formBit: number, view: unknown): string | null;
  storedToView(item: Item, formBit: number, value: string): unknown;
  viewPosition(item: Item, formBit: number, value: string | undefined): number | null;
  scoreResponses(bank: OracleBank, responses: Responses): unknown;
  rhythmReport(bank: OracleBank, formBit: number, responses: Responses): unknown;
  skippedCount(bank: OracleBank, responses: Responses): number;
  skipHint(bank: OracleBank, responses: Responses): boolean;
  buildResult(bank: OracleBank, formBit: number, responses: Responses): unknown;
  selfLine(bank: OracleBank, responses: Responses, axis: unknown): unknown;
  checksumChar(body: string): string;
  encodeCode(bank: OracleBank, formBit: number, responses: Responses): string | null;
  decodeCode(bank: OracleBank, code: unknown): unknown;
  buildShareUrl(bank: OracleBank, origin: string, first: DecodedCode, second?: DecodedCode): string | null;
  buildQuestionOnlyUrl(origin: string, options?: { explicitVersion?: boolean }): string;
  decodeShareParams(bank: OracleBank, a: string | null, b: string | null): unknown;
  parseShareHash(bank: OracleBank, hash: unknown): unknown;
}

const ref = oracleModule as unknown as OracleApi;
const oracleBank = ref.makeBank(V40_BANK_DATA);
const bank: Bank = WEDDING_CODE_V40_BANK;
const ITEMS = bank.items;

// ---------------------------------------------------------------------------
// 응답자 만들기
// ---------------------------------------------------------------------------

interface Respondent {
  readonly label: string;
  readonly formBit: FormBit;
  readonly responses: Responses;
  /** 화면 답(있으면 왕복 대조에 쓴다). 응답자가 저장값으로만 만들어졌으면 비어 있다. */
  readonly views: Readonly<Record<string, ViewAnswer>>;
}

const RANDOM_COUNT = 3000;
const PATTERNED_COUNT = 900;
const MIRROR_COUNT = 900;

/** 무작위 응답자 3,000명: 유형 10가지를 돌리고 폼 비트는 유형과 어긋나게 바꾼다. 일부는 답하지 않은 문항이 섞인 부분 응답이다. */
function makeRandomRespondents(): Respondent[] {
  const kinds = [
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
  const list: Respondent[] = [];
  for (let i = 0; i < RANDOM_COUNT; i += 1) {
    const kind = kinds[i % kinds.length];
    const formBit = (Math.floor(i / kinds.length) % 2) as FormBit;
    const respondent = ref.randomRespondent(oracleBank, 1000 + i, { ...kind, formBit, spread: i % 5 === 0 ? 4 : 2 });
    let responses: Responses = respondent.responses;
    let views: Record<string, ViewAnswer> = respondent.views;
    if (i % 7 === 3) {
      // 부분 응답: 답하지 않은 문항(키 없음)을 섞는다.
      const rng = ref.mulberry32(50_000 + i);
      const kept: Record<string, ResponseValue> = {};
      const keptViews: Record<string, ViewAnswer> = {};
      for (const item of ITEMS) {
        if (rng() < 0.3) continue;
        kept[item.id] = respondent.responses[item.id];
        keptViews[item.id] = respondent.views[item.id];
      }
      responses = kept;
      views = keptViews;
    }
    list.push({ label: `random#${i}`, formBit, responses, views });
  }
  return list;
}

/** 위치 패턴 응답자: 형식마다 화면 위치를 같은 칸, 번갈아, 3·4·5번 주기, 무작위 중 하나로 눌러 위치 반복 힌트, 관문, 동점을 만든다. */
function makePatternedRespondents(): Respondent[] {
  const patterns = [1, 2, 3, 4, 5, 0] as const; // 주기(0 은 무작위)
  const list: Respondent[] = [];
  for (let i = 0; i < PATTERNED_COUNT; i += 1) {
    const rng = ref.mulberry32(900_000 + i);
    const pick = (n: number) => Math.floor(rng() * n);
    const formBit = (i % 2) as FormBit;
    const skipRate = [0, 0.02, 0.1, 0.3][pick(4)];
    const naRate = [0, 0.02, 0.1][pick(3)];
    const plan = {
      pair: { period: patterns[pick(6)], base: [0, 1, 2, 3, 4].map(() => pick(6)) },
      react: { period: patterns[pick(6)], base: [0, 1, 2, 3, 4].map(() => pick(5)) },
      choose: { period: patterns[pick(6)], base: [0, 1, 2, 3, 4].map(() => pick(4)) },
    };
    const used = { pair: 0, react: 0, choose: 0 };
    const responses: Record<string, ResponseValue> = {};
    const views: Record<string, ViewAnswer> = {};
    ITEMS.forEach((item, index) => {
      const r = rng();
      let view: ViewAnswer;
      if (index > 0 && r < skipRate) view = { fmt: "escape", which: "unsure" };
      else if (index > 0 && r < skipRate + naRate) view = { fmt: "escape", which: "na" };
      else {
        const family = item.fmt === "pair" ? "pair" : item.fmt === "react" ? "react" : item.fmt === "recall" || item.fmt === "instant" ? "choose" : null;
        const cell = (size: number, key: "pair" | "react" | "choose") => {
          const { period, base } = plan[key];
          const step = used[key];
          used[key] += 1;
          return period === 0 ? pick(size) : base[step % period];
        };
        switch (item.fmt) {
          case "pair":
          case "self":
            view = { fmt: item.fmt, cell: family === "pair" ? cell(6, "pair") : pick(6) };
            break;
          case "react":
            view = { fmt: "react", cell: cell(5, "react") };
            break;
          case "recall":
          case "instant":
            view = { fmt: item.fmt, option: cell(4, "choose") };
            break;
          case "bestworst": {
            const best = pick(4);
            let worst = pick(3);
            if (worst >= best) worst += 1;
            view = { fmt: "bestworst", best, worst };
            break;
          }
          default: {
            const counts: [number, number, number] = [0, 0, 0];
            for (let t = 0; t < 6; t += 1) counts[pick(3)] += 1;
            view = { fmt: "split", counts };
          }
        }
      }
      const stored = ref.viewToStored(item, formBit, view);
      if (stored === null) throw new Error(`패턴 응답자가 저장값으로 바뀌지 않는다: ${item.id}`);
      responses[item.id] = stored;
      views[item.id] = view;
    });
    list.push({ label: `patterned#${i}`, formBit, responses, views });
  }
  return list;
}

/**
 * 거울 응답자: 구간 0과 2, 구간 1과 3의 짝 문항에 같은 화면 답을 눌러 축 합이 정확히 0(동점)이 되게 한다(설계 5절 거울 구조).
 * 동점 사슬의 3, 4, 5단계를 지나가게 하고 일부는 자기 선택을 비우거나 한두 문항만 어긋나게 해 1, 2단계도 지난다.
 */
function makeMirrorRespondents(): Respondent[] {
  const list: Respondent[] = [];
  for (let i = 0; i < MIRROR_COUNT; i += 1) {
    const rng = ref.mulberry32(3_000_000 + i);
    const pick = (n: number) => Math.floor(rng() * n);
    const formBit = (i % 2) as FormBit;
    const chosen = new Map<string, ViewAnswer>();
    const viewFor = (item: Item): ViewAnswer => {
      switch (item.fmt) {
        case "pair":
        case "self":
          return { fmt: item.fmt, cell: pick(6) };
        case "react":
          return { fmt: "react", cell: pick(5) };
        case "recall":
        case "instant":
          return { fmt: item.fmt, option: pick(4) };
        case "bestworst": {
          const best = pick(4);
          let worst = pick(3);
          if (worst >= best) worst += 1;
          return { fmt: "bestworst", best, worst };
        }
        default: {
          const counts: [number, number, number] = [0, 0, 0];
          for (let t = 0; t < 6; t += 1) counts[pick(3)] += 1;
          return { fmt: "split", counts };
        }
      }
    };
    for (const slot of V40_LAYOUT) {
      const item = bank.byId.get(slot.id) as Item;
      if (chosen.has(item.id)) continue;
      const view = viewFor(item);
      chosen.set(item.id, view);
      if (slot.fmt !== "self" && slot.section < 2) {
        const partnerSlot = V40_LAYOUT.find((s) => s.section === slot.section + 2 && s.axis === slot.axis && s.screen === slot.screen + 20 && s.pos === slot.pos);
        if (partnerSlot) {
          const partner = bank.byId.get(partnerSlot.id) as Item;
          chosen.set(partner.id, view.fmt === "recall" || view.fmt === "instant" ? { fmt: partner.fmt as "recall" | "instant", option: view.option } : view);
        }
      }
    }
    const responses: Record<string, ResponseValue> = {};
    const views: Record<string, ViewAnswer> = {};
    const selfMode = pick(4); // 0 자기 선택 그대로, 1 자기 선택 건너뜀, 2 자기 선택 해당 없음, 3 자기 선택 없음(키 없음)
    const perturb = i % 3 === 0 ? pick(6) : 0; // 몇 문항을 다른 화면 답으로 바꿔 동점을 깬다
    let perturbed = 0;
    ITEMS.forEach((item) => {
      let view = chosen.get(item.id) as ViewAnswer;
      if (item.fmt === "self") {
        if (selfMode === 1) view = { fmt: "escape", which: "unsure" };
        else if (selfMode === 2) view = { fmt: "escape", which: "na" };
        else if (selfMode === 3) return;
      } else if (perturbed < perturb && pick(6) === 0) {
        view = viewFor(item);
        perturbed += 1;
      }
      const stored = ref.viewToStored(item, formBit, view);
      if (stored === null) throw new Error(`거울 응답자가 저장값으로 바뀌지 않는다: ${item.id}`);
      responses[item.id] = stored;
      views[item.id] = view;
    });
    list.push({ label: `mirror#${i}`, formBit, responses, views });
  }
  return list;
}

const RANDOM = makeRandomRespondents();
const PATTERNED = makePatternedRespondents();
const MIRROR = makeMirrorRespondents();
const ALL = [...RANDOM, ...PATTERNED, ...MIRROR];

/** 합쳐진 목록에서 처음 몇 건의 불일치만 모아 보여 준다. */
function collectMismatches(run: (respondent: Respondent, push: (message: string) => void) => void, list: readonly Respondent[] = ALL): string[] {
  const problems: string[] = [];
  for (const respondent of list) {
    run(respondent, (message) => {
      if (problems.length < 20) problems.push(`${respondent.label}: ${message}`);
    });
  }
  return problems;
}

const json = (value: unknown) => JSON.stringify(value);

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

describe("응답자 구성", () => {
  it("무작위 3,000명과 패턴 응답자를 갖추고 폼 비트 0, 1 이 모두 있다", () => {
    expect(RANDOM).toHaveLength(3000);
    expect(PATTERNED.length).toBeGreaterThanOrEqual(900);
    expect(RANDOM.filter((r) => r.formBit === 0).length).toBeGreaterThan(1000);
    expect(RANDOM.filter((r) => r.formBit === 1).length).toBeGreaterThan(1000);
    expect(RANDOM.some((r) => Object.keys(r.responses).length < 68)).toBe(true);
  });
});

describe("저장 상태 문자 도우미 대조", () => {
  it("stateChar, stateIndex, isStateFor, isResponseValueFor, toCodeChar, fromCodeChar 가 기준 계산기와 같다", () => {
    const formats: Format[] = ["pair", "react", "recall", "instant", "bestworst", "split", "self"];
    const probes = [...V40_STATE_ALPHABET, "-", "_", ".", " ", "가", "", "ab", "\u0000", "Ａ"];
    for (let index = 0; index < 62; index += 1) expect(stateChar(index)).toBe(ref.stateChar(index));
    for (const bad of [-1, 62, 1.5, Number.NaN]) {
      expect(() => stateChar(bad)).toThrow(RangeError);
      expect(() => ref.stateChar(bad)).toThrow(RangeError);
    }
    for (const probe of probes) {
      expect(stateIndex(probe)).toBe(ref.stateIndexOf(probe));
      expect(fromCodeChar(probe)).toBe(ref.fromCodeChar(probe));
      for (const fmt of formats) {
        expect(isStateFor(fmt, probe)).toBe(ref.isStateFor(fmt, probe));
        expect(isResponseValueFor(fmt, probe)).toBe(ref.isResponseValueFor(fmt, probe));
      }
    }
    for (const value of ["skip", "na", "0", "Z"]) expect(toCodeChar(value)).toBe(ref.toCodeChar(value));
  });

  it("칸 나누기와 가장·가장 아닌 것 색인 계산이 전수에서 기준 계산기와 같고 왕복한다", () => {
    for (let a = 0; a <= 6; a += 1) {
      for (let b = 0; a + b <= 6; b += 1) {
        const state = splitStateOf(a, b);
        expect(state).toBe(ref.splitStateOf(a, b));
        expect(splitCountsOf(state)).toEqual([a, b, 6 - a - b]);
        expect([...splitCountsOf(state)]).toEqual([...ref.splitCountsOf(state)]);
      }
    }
    for (let best = 0; best < 4; best += 1) {
      for (let worst = 0; worst < 4; worst += 1) {
        if (best === worst) {
          expect(() => bestWorstStateOf(best, worst)).toThrow(RangeError);
          continue;
        }
        const state = bestWorstStateOf(best, worst);
        expect(state).toBe(ref.bestWorstStateOf(best, worst));
        expect(bestWorstPairOf(state)).toEqual({ best, worst });
        expect(bestWorstPairOf(state)).toEqual(ref.bestWorstPairOf(state));
      }
    }
  });
});

describe("화면 답과 저장값 왕복 대조", () => {
  it("toStored 는 기준 계산기의 viewToStored 및 응답자의 저장값과 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      for (const item of ITEMS) {
        const view = respondent.views[item.id];
        if (view === undefined) continue;
        const mine = toStored(item, respondent.formBit, view);
        const theirs = ref.viewToStored(item, respondent.formBit, view);
        if (mine !== theirs) push(`${item.id} toStored ${String(mine)} 대 ${String(theirs)}`);
        if (mine !== respondent.responses[item.id]) push(`${item.id} 저장값 불일치 ${String(mine)} 대 ${respondent.responses[item.id]}`);
      }
    });
    expect(problems).toEqual([]);
  });

  it("fromStored 는 기준 계산기의 storedToView 및 응답자의 화면 답과 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      for (const item of ITEMS) {
        const value = respondent.responses[item.id];
        if (value === undefined) continue;
        const mine = fromStored(item, respondent.formBit, value);
        const theirs = ref.storedToView(item, respondent.formBit, value);
        if (json(mine) !== json(theirs)) push(`${item.id} fromStored ${json(mine)} 대 ${json(theirs)}`);
        const view = respondent.views[item.id];
        if (view !== undefined && json(mine) !== json(view)) push(`${item.id} 화면 답 불일치 ${json(mine)} 대 ${json(view)}`);
        if (mine !== null && toStored(item, respondent.formBit, mine) !== value) push(`${item.id} 왕복 실패 ${value}`);
      }
    });
    expect(problems).toEqual([]);
  });

  it("상태 전수(형식 x 상태 x 폼 비트)에서 왕복하고 기준 계산기와 같다", () => {
    const counts: Record<string, number> = { pair: 6, react: 5, recall: 4, instant: 4, bestworst: 12, split: 28, self: 6 };
    for (const item of ITEMS) {
      for (const formBit of [0, 1] as const) {
        for (let state = 0; state < counts[item.fmt]; state += 1) {
          const value = stateChar(state);
          const view = fromStored(item, formBit, value);
          expect(json(view)).toBe(json(ref.storedToView(item, formBit, value)));
          expect(view).not.toBeNull();
          expect(toStored(item, formBit, view as ViewAnswer)).toBe(value);
          expect(viewPosition(item, formBit, value)).toBe(ref.viewPosition(item, formBit, value));
        }
        // 형식에 없는 문자는 null
        const outside = stateChar(counts[item.fmt]);
        expect(fromStored(item, formBit, outside)).toBeNull();
        expect(ref.storedToView(item, formBit, outside)).toBeNull();
      }
    }
  });

  it("isViewAnswerComplete 와 toStored 는 망가진 화면 답에서도 기준 계산기와 같다(던지지 않는다)", () => {
    const rng = ref.mulberry32(777);
    const pickInt = (n: number) => Math.floor(rng() * n);
    const oddNumber = () => [-1, 0, 1, 2, 3, 4, 5, 6, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, "1", undefined][pickInt(15)];
    const fmts = ["pair", "self", "react", "recall", "instant", "bestworst", "split", "escape", "nope"];
    let compared = 0;
    for (let n = 0; n < 4000; n += 1) {
      const item = ITEMS[pickInt(ITEMS.length)];
      const fmt = rng() < 0.6 ? item.fmt : fmts[pickInt(fmts.length)];
      const view: Record<string, unknown> = { fmt };
      if (fmt === "escape") view.which = ["unsure", "na", "x", undefined][pickInt(4)];
      else if (fmt === "recall" || fmt === "instant") view.option = oddNumber();
      else if (fmt === "bestworst") {
        view.best = oddNumber();
        view.worst = rng() < 0.2 ? view.best : oddNumber();
      } else if (fmt === "split") {
        view.counts = rng() < 0.8 ? [oddNumber(), oddNumber(), oddNumber()] : rng() < 0.5 ? [2, 2] : [2, 2, 2, 0];
        if (rng() < 0.5) view.counts = [pickInt(7), pickInt(7), pickInt(7)];
      } else view.cell = oddNumber();
      const formBit = rng() < 0.5 ? 0 : 1;
      const asAnswer = view as unknown as ViewAnswer;
      expect(isViewAnswerComplete(item, asAnswer)).toBe(ref.isViewComplete(item, view));
      expect(toStored(item, formBit, asAnswer)).toBe(ref.viewToStored(item, formBit, view));
      compared += 1;
    }
    expect(compared).toBe(4000);
    for (const garbage of [null, undefined, 3, "x", []]) {
      expect(isViewAnswerComplete(ITEMS[0], garbage as unknown as ViewAnswer)).toBe(false);
      expect(toStored(ITEMS[0], 0, garbage as unknown as ViewAnswer)).toBeNull();
    }
  });
});

describe("문항 값과 자기 선택 대조", () => {
  it("itemValue 는 모든 응답자, 모든 문항에서 기준 계산기와 같고 빠진 값은 null 이다", () => {
    const problems = collectMismatches((respondent, push) => {
      for (const item of bank.scored) {
        const value = respondent.responses[item.id];
        const mine = itemValue(item, value);
        const theirs = ref.itemValue(item, value);
        if (mine !== theirs) push(`${item.id} ${String(value)} itemValue ${String(mine)} 대 ${String(theirs)}`);
        if ((value === "skip" || value === "na" || value === undefined) && mine !== null) push(`${item.id} 빠진 값이 ${String(mine)}`);
        if (mine !== null && (Object.is(mine, -0) || Math.abs(mine) > 6 || !Number.isInteger(mine))) push(`${item.id} 값 모양 이상 ${String(mine)}`);
      }
      for (const item of bank.self) {
        const value = respondent.responses[item.id];
        if (json(selfChoice(item, value)) !== json(ref.selfChoice(item, value))) push(`${item.id} selfChoice 불일치`);
      }
    });
    expect(problems).toEqual([]);
  });

  it("viewPosition 은 모든 응답자, 모든 문항, 두 폼 비트에서 기준 계산기와 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      for (const item of ITEMS) {
        for (const formBit of [0, 1] as const) {
          const value = respondent.responses[item.id];
          if (value === undefined) continue;
          const mine = viewPosition(item, formBit, value);
          const theirs = ref.viewPosition(item, formBit, value);
          if (mine !== theirs) push(`${item.id} viewPosition ${String(mine)} 대 ${String(theirs)}`);
        }
      }
    }, RANDOM.slice(0, 600));
    expect(problems).toEqual([]);
  });
});

describe("채점과 결과 대조", () => {
  it("scoreResponses 의 축 집계(합, 글자, 세기, 동점 단계, 임시, 사용 불가)가 기준 계산기와 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      const mine = scoreResponses(bank, respondent.responses);
      const theirs = ref.scoreResponses(oracleBank, respondent.responses);
      try {
        expect(mine).toEqual(theirs);
      } catch (error) {
        push(`scoreResponses 불일치: ${(error as Error).message.slice(0, 300)}`);
      }
    });
    expect(problems).toEqual([]);
  });

  it("buildResult(힌트, 관문, 코드, 대비, 품질 안내 포함)가 기준 계산기와 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      const mine = buildResult(bank, respondent.formBit, respondent.responses);
      const theirs = ref.buildResult(oracleBank, respondent.formBit, respondent.responses);
      try {
        expect(mine).toEqual(theirs);
      } catch (error) {
        push(`buildResult 불일치: ${(error as Error).message.slice(0, 300)}`);
      }
    });
    expect(problems).toEqual([]);
  });

  it("selfLine(마지막 정리에서 고른 쪽 줄)이 모든 응답자, 모든 주제에서 기준 계산기와 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      const mine = buildResult(bank, respondent.formBit, respondent.responses);
      const theirs = ref.buildResult(oracleBank, respondent.formBit, respondent.responses) as typeof mine;
      mine.axes.forEach((axis, index) => {
        try {
          expect(selfLine(bank, respondent.responses, axis)).toEqual(ref.selfLine(oracleBank, respondent.responses, theirs.axes[index]));
        } catch (error) {
          push(`selfLine 불일치(${axis.axis}): ${(error as Error).message.slice(0, 300)}`);
        }
      });
    });
    expect(problems).toEqual([]);
  });

  it("selfLine 을 불러도 buildResult 의 결과는 바뀌지 않고 링크 코드도 그대로다", () => {
    const problems = collectMismatches((respondent, push) => {
      const result = buildResult(bank, respondent.formBit, respondent.responses);
      const before = json(result);
      const codeBefore = encodeCode(bank, respondent.formBit, respondent.responses);
      for (const axis of result.axes) selfLine(bank, respondent.responses, axis);
      if (json(result) !== before) push("selfLine 이 결과를 바꿨다");
      if (encodeCode(bank, respondent.formBit, respondent.responses) !== codeBefore) push("selfLine 이 링크 코드를 바꿨다");
    });
    expect(problems).toEqual([]);
  });

  it("시험이 selfLine 의 모든 갈래를 지난다(줄이 있음, 대비 때문에 없음, 건너뜀·해당 없음·빠짐 때문에 없음, 글자를 못 정해서 없음)", () => {
    const seen = { line: 0, contrast: 0, escaped: 0, missing: 0, unusable: 0, even: 0, provisional: 0, provisionalWithLine: 0, levels: [0, 0, 0, 0], sides: { front: 0, back: 0 } };
    for (const respondent of ALL) {
      const result = buildResult(bank, respondent.formBit, respondent.responses);
      for (const axis of result.axes) {
        const line = selfLine(bank, respondent.responses, axis);
        const raw = respondent.responses[`self.${axis.axis}`];
        if (axis.provisional) seen.provisional += 1;
        if (line !== null) {
          seen.line += 1;
          seen.levels[line.level] += 1;
          seen.sides[line.side] += 1;
          if (axis.shownBand === "even") seen.even += 1;
          if (axis.provisional) seen.provisionalWithLine += 1;
          // 줄이 있으면 글자가 있고 대비가 없다.
          expect(axis.letter).not.toBeNull();
          expect(axis.contrast).toBeNull();
        } else if (axis.letter === null) seen.unusable += 1;
        else if (axis.contrast !== null) seen.contrast += 1;
        else if (raw === undefined) seen.missing += 1;
        else seen.escaped += 1;
      }
    }
    expect(seen.line).toBeGreaterThan(5000);
    expect(seen.contrast).toBeGreaterThan(20);
    expect(seen.escaped).toBeGreaterThan(200);
    expect(seen.missing).toBeGreaterThan(50);
    expect(seen.unusable).toBeGreaterThan(50);
    expect(seen.even).toBeGreaterThan(500);
    // 임시 글자(동점 사슬 5단계)는 자기 선택이 결정하지 못한 주제라서 자기 선택이 비어 있고, 그래서 줄이 없다.
    expect(seen.provisional).toBeGreaterThan(50);
    expect(seen.provisionalWithLine).toBe(0);
    expect(seen.levels[1]).toBeGreaterThan(500);
    expect(seen.levels[2]).toBeGreaterThan(500);
    expect(seen.levels[3]).toBeGreaterThan(500);
    expect(seen.sides.front).toBeGreaterThan(1000);
    expect(seen.sides.back).toBeGreaterThan(1000);
  });

  it("위치 지표, 힌트, 관문, 위치 반복 검사, 건너뜀 개수가 기준 계산기와 같다", () => {
    const problems = collectMismatches((respondent, push) => {
      const mine = rhythmReport(bank, respondent.formBit, respondent.responses);
      const theirs = ref.rhythmReport(oracleBank, respondent.formBit, respondent.responses);
      if (json(mine) !== json(theirs)) push(`rhythmReport ${json(mine)} 대 ${json(theirs)}`);
      if (skippedCount(bank, respondent.responses) !== ref.skippedCount(oracleBank, respondent.responses)) push("skippedCount 불일치");
      if (skipHint(bank, respondent.responses) !== ref.skipHint(oracleBank, respondent.responses)) push("skipHint 불일치");
      const result = buildResult(bank, respondent.formBit, respondent.responses);
      const expected = ref.buildResult(oracleBank, respondent.formBit, respondent.responses) as typeof result;
      if (result.gate.closed !== expected.gate.closed || result.gate.reason !== expected.gate.reason) push("관문 불일치");
      if (result.code !== expected.code) push(`코드 ${String(result.code)} 대 ${String(expected.code)}`);
    });
    expect(problems).toEqual([]);
  });

  it("시험이 실제로 여러 갈래를 지난다(힌트, 관문, 동점 단계 1에서 5, 임시, 사용 불가, 대비)", () => {
    const seen = {
      gateRhythm: 0,
      gateNoInfo: 0,
      hintRhythm: 0,
      hintSkip: 0,
      unusable: 0,
      provisional: 0,
      contrast: 0,
      clear: 0,
      lean: 0,
      even: 0,
      tie: [0, 0, 0, 0, 0, 0],
      formatFlags: [0, 0, 0, 0],
    };
    for (const respondent of ALL) {
      const result = buildResult(bank, respondent.formBit, respondent.responses);
      if (result.gate.reason === "rhythm") seen.gateRhythm += 1;
      if (result.gate.reason === "noInformation") seen.gateNoInfo += 1;
      if (result.notes.hintRhythm) seen.hintRhythm += 1;
      if (result.notes.hintSkip) seen.hintSkip += 1;
      seen.formatFlags[result.rhythm.flaggedCount] += 1;
      for (const axis of result.axes) {
        if (axis.unusable) seen.unusable += 1;
        if (axis.provisional) seen.provisional += 1;
        if (axis.contrast) seen.contrast += 1;
        if (axis.tieLevel !== null) seen.tie[axis.tieLevel] += 1;
        if (axis.band) seen[axis.band] += 1;
      }
    }
    expect(seen.gateRhythm).toBeGreaterThan(20);
    expect(seen.hintRhythm).toBeGreaterThan(20);
    expect(seen.hintSkip).toBeGreaterThan(20);
    expect(seen.unusable).toBeGreaterThan(50);
    expect(seen.contrast).toBeGreaterThan(20);
    expect(seen.clear).toBeGreaterThan(200);
    expect(seen.lean).toBeGreaterThan(200);
    expect(seen.even).toBeGreaterThan(200);
    expect(seen.tie[0]).toBeGreaterThan(1000);
    expect(seen.tie[1]).toBeGreaterThan(10);
    expect(seen.tie[2]).toBeGreaterThan(0);
    expect(seen.tie[3]).toBeGreaterThan(0);
    expect(seen.formatFlags[1]).toBeGreaterThan(20);
    // 동점 사슬 3, 4, 5단계와 임시 글자, 확정 글자가 없어 닫히는 관문은 거울 응답자와 건너뜀이 많은 응답자가 지난다.
    expect(seen.tie[4]).toBeGreaterThan(50);
    expect(seen.tie[5]).toBeGreaterThan(50);
    expect(seen.provisional).toBe(seen.tie[5]);
    expect(seen.gateNoInfo).toBeGreaterThan(50);
    expect(seen.formatFlags[2]).toBeGreaterThan(20);
    expect(seen.formatFlags[3]).toBe(seen.gateRhythm);
  });
});

describe("링크 코덱 대조", () => {
  const encoded = ALL.map((respondent) => ({
    respondent,
    mine: encodeCode(bank, respondent.formBit, respondent.responses),
    theirs: ref.encodeCode(oracleBank, respondent.formBit, respondent.responses),
  }));

  it("encodeCode 문자열이 모든 응답자에서 바이트까지 같고, 부분 응답은 null 이다", () => {
    const mismatched = encoded.filter((entry) => entry.mine !== entry.theirs);
    expect(mismatched.map((entry) => entry.respondent.label)).toEqual([]);
    expect(encoded.filter((entry) => entry.mine !== null).length).toBeGreaterThan(3000);
    for (const entry of encoded) {
      if (Object.keys(entry.respondent.responses).length < 68) expect(entry.mine).toBeNull();
      if (entry.mine !== null) expect(entry.mine).toHaveLength(70);
    }
  });

  it("decodeCode 결과가 같고 encodeCode 와 왕복한다", () => {
    const problems: string[] = [];
    for (const entry of encoded) {
      if (entry.mine === null) continue;
      const mine = decodeCode(bank, entry.mine);
      const theirs = ref.decodeCode(oracleBank, entry.mine);
      if (json(mine) !== json(theirs)) problems.push(`${entry.respondent.label} decode 불일치`);
      if (mine === null || mine.formBit !== entry.respondent.formBit || json(mine.responses) !== json(Object.fromEntries(ITEMS.map((item) => [item.id, entry.respondent.responses[item.id]])))) {
        problems.push(`${entry.respondent.label} 왕복 실패`);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("checksumChar 가 무작위 몸통에서 같고 잘못된 문자는 RangeError 로 같다", () => {
    const rng = ref.mulberry32(4242);
    const alphabet = `${V40_STATE_ALPHABET}-_`;
    for (let n = 0; n < 500; n += 1) {
      let body = "";
      const size = Math.floor(rng() * 80);
      for (let i = 0; i < size; i += 1) body += alphabet[Math.floor(rng() * alphabet.length)];
      expect(checksumChar(body)).toBe(ref.checksumChar(body));
    }
    for (const bad of ["ab!", "가", "a b", ".", "0.1"]) {
      expect(() => checksumChar(bad)).toThrow(RangeError);
      expect(() => ref.checksumChar(bad)).toThrow(RangeError);
    }
  });

  /**
   * 링크를 만드는 길은 buildGatedShareUrl 하나다. 기준 계산기의 buildShareUrl 은 관문을 보지 않으므로(조립만 한다) 기대값은
   * 「기준 계산기의 buildResult 가 코드를 내면(관문 열림) 기준 계산기의 링크, 아니면 null」이다. 관문 판정도 기준 계산기 쪽 것으로 세운다.
   */
  const oracleOpen = (person: DecodedCode): boolean => (ref.buildResult(oracleBank, person.formBit, person.responses) as { code: string | null }).code !== null;
  /**
   * 2026-10-04: 답이 든 링크는 `/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=…` 로 나간다(받는 사람의 첫 화면이 v3.1 이 아니라 v4 이게 하려고 쿼리에도 판 이름을 싣는다, 감사 A68).
   * 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs)는 쿼리가 없던 옛 모양을 내므로, 기대값은 기준 링크에서 `/wedding-code` 바로 뒤에 `?v=v4.0-tendency` 하나만 더한 것이다.
   * # 뒤(코드와 키 순서)는 기준 계산기와 글자 그대로 같아야 하고, 이 변환이 바꾸는 것은 쿼리 하나뿐이다.
   */
  const withVersionQuery = (link: string | null): string | null => {
    if (link === null) return null;
    const marker = "/wedding-code#";
    expect(link.split(marker)).toHaveLength(2);
    return link.replace(marker, `/wedding-code?v=${WEDDING_CODE_V40_VERSION}#`);
  };
  const expectedLink = (origin: string, first: DecodedCode, second?: DecodedCode): string | null => {
    if (!oracleOpen(first)) return null;
    if (second !== undefined && !oracleOpen(second)) return null;
    return withVersionQuery(second === undefined ? ref.buildShareUrl(oracleBank, origin, first) : ref.buildShareUrl(oracleBank, origin, first, second));
  };

  it("보내기 링크(관문이 열린 응답만)와 질문만 보내기 링크가 같다", () => {
    const origins = ["https://hanbang.ai", "https://hanbang.ai/", "https://hanbang.ai///", "http://localhost:3000", ""];
    const toPerson = (entry: (typeof encoded)[number]): DecodedCode => ({ formBit: entry.respondent.formBit, responses: entry.respondent.responses });
    const coded = encoded.filter((entry) => entry.mine !== null);
    const openOnes = coded.filter((entry) => oracleOpen(toPerson(entry))).slice(0, 150);
    const closedOnes = coded.filter((entry) => !oracleOpen(toPerson(entry))).slice(0, 60);
    // 두 갈래를 모두 지난다(지나지 않았다면 이 시험은 관문 갈래를 지키지 못한 것이다).
    expect(openOnes.length).toBeGreaterThan(100);
    expect(closedOnes.length).toBeGreaterThan(20);
    const sample = [...openOnes, ...closedOnes];
    const seen = { link: 0, gateNull: 0 };
    sample.forEach((entry, index) => {
      const first = toPerson(entry);
      const second = toPerson(sample[(index * 7 + 1) % sample.length]);
      for (const origin of origins) {
        const single = buildGatedShareUrl(bank, origin, first);
        expect(single).toBe(expectedLink(origin, first));
        const both = buildGatedShareUrl(bank, origin, first, second);
        expect(both).toBe(expectedLink(origin, first, second));
        if (single === null || both === null) seen.gateNull += 1;
        else seen.link += 1;
      }
    });
    expect(seen.link).toBeGreaterThan(300);
    expect(seen.gateNull).toBeGreaterThan(100);
    for (const origin of origins) {
      expect(buildQuestionOnlyUrl(origin)).toBe(ref.buildQuestionOnlyUrl(origin));
      expect(buildQuestionOnlyUrl(origin, { explicitVersion: false })).toBe(ref.buildQuestionOnlyUrl(origin, { explicitVersion: false }));
      expect(buildQuestionOnlyUrl(origin, { explicitVersion: true })).toBe(ref.buildQuestionOnlyUrl(origin, { explicitVersion: true }));
    }
    // 답이 하나라도 빠진 쪽이 있으면 null
    const partial = RANDOM.find((r) => Object.keys(r.responses).length < 68);
    const full = openOnes[0].respondent;
    if (partial) {
      const a = { formBit: full.formBit, responses: full.responses };
      const b = { formBit: partial.formBit, responses: partial.responses };
      expect(buildGatedShareUrl(bank, "https://x.test", a, b)).toBeNull();
      expect(ref.buildShareUrl(oracleBank, "https://x.test", a, b)).toBeNull();
      expect(buildGatedShareUrl(bank, "https://x.test", b)).toBeNull();
    }
  });

  it("decodeShareParams 와 parseShareHash 가 정상, 누락, 중복, 모르는 키, 판 태그 오류에서 같다", () => {
    const codes = encoded.filter((entry) => entry.mine !== null).map((entry) => entry.mine as string);
    const version = "v4.0-tendency";
    const damage = (code: string) => `${code.slice(0, 30)}${code[30] === "0" ? "1" : "0"}${code.slice(31)}`;
    let compared = 0;
    for (let i = 0; i < 300; i += 1) {
      const a = codes[i];
      const b = codes[(i * 7 + 3) % codes.length];
      const bad = damage(a);
      const hashes: (string | null | undefined)[] = [
        `#v=${version}&a=${a}`,
        `v=${version}&a=${a}`,
        `#v=${version}&a=${a}&b=${b}`,
        `#a=${a}&b=${b}&v=${version}`,
        `#b=${b}&v=${version}&a=${a}`,
        `#v=${version}&b=${b}`,
        `#v=${version}`,
        `#a=${a}`,
        `#v=v4.0&a=${a}`,
        `#v=${version}&a=${a}&a=${a}`,
        `#v=${version}&a=${a}&c=${b}`,
        `#v=${version}&a=${bad}`,
        `#v=${version}&a=${a}&b=${bad}`,
        `#v=${version}&a=${a}&&b=${b}`,
        `#v=${version}&a=${a}&b=`,
        `#v=${version}&a=${a}=x`,
        `#v=${version}&=${a}`,
        `#v=${version}&a`,
        `#v=${version}&a=${a}&b=${b}&`,
        `#V=${version}&a=${a}`,
        "#",
        "",
        null,
        undefined,
        `#v=${version}&a=${a}${"x".repeat(2000)}`,
      ];
      for (const hash of hashes) {
        expect(json(parseShareHash(bank, hash))).toBe(json(ref.parseShareHash(oracleBank, hash)));
        compared += 1;
      }
      const pairs: [string | null, string | null][] = [
        [null, null],
        [a, null],
        [null, b],
        [a, b],
        [bad, b],
        [a, bad],
        ["", null],
        [a.slice(0, 69), null],
      ];
      for (const [x, y] of pairs) {
        expect(json(decodeShareParams(bank, x, y))).toBe(json(ref.decodeShareParams(oracleBank, x, y)));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(9000);
  });
});

describe("손상 코드 300건", () => {
  const valid = ALL.map((respondent) => encodeCode(bank, respondent.formBit, respondent.responses)).filter((code): code is string => code !== null);
  const validChars = `${V40_STATE_ALPHABET}-_`;
  const outsideChars = ["!", "가", " ", ".", "=", "#", "&", "%", "ａ", "\u0000", "Ａ", "~"];

  function damagedCases(): { label: string; code: string }[] {
    const rng = ref.mulberry32(20_260_929);
    const pick = (n: number) => Math.floor(rng() * n);
    const cases: { label: string; code: string }[] = [];
    for (let n = 0; n < 300; n += 1) {
      const code = valid[pick(valid.length)];
      const kind = n % 10;
      let damaged = code;
      switch (kind) {
        case 0:
        case 1: {
          // 한 글자를 다른 유효 글자로 바꾼다(위치를 가리지 않는다)
          const at = pick(70);
          let replacement = validChars[pick(validChars.length)];
          while (replacement === code[at]) replacement = validChars[pick(validChars.length)];
          damaged = `${code.slice(0, at)}${replacement}${code.slice(at + 1)}`;
          break;
        }
        case 2: {
          // 서로 다른 글자 둘을 이웃끼리 바꾼다
          let at = pick(69);
          while (code[at] === code[at + 1]) at = pick(69);
          damaged = `${code.slice(0, at)}${code[at + 1]}${code[at]}${code.slice(at + 2)}`;
          break;
        }
        case 3: {
          // 잘라 낸다(길이 0에서 69)
          damaged = code.slice(0, pick(70));
          break;
        }
        case 4: {
          // 늘린다
          damaged = code + validChars[pick(validChars.length)].repeat(1 + pick(3));
          break;
        }
        case 5: {
          // 알파벳 밖 글자로 바꾼다
          const at = pick(70);
          damaged = `${code.slice(0, at)}${outsideChars[pick(outsideChars.length)]}${code.slice(at + 1)}`;
          break;
        }
        case 6: {
          // 폼 비트 문자만 뒤집고 체크섬은 그대로
          damaged = `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
          break;
        }
        case 7: {
          // 폼 비트 문자가 0, 1 이 아니다
          damaged = `${["2", "a", "-", "_", "가"][pick(5)]}${code.slice(1)}`;
          break;
        }
        case 8: {
          // 체크섬 문자만 바꾼다
          let replacement = V40_STATE_ALPHABET[pick(61)];
          while (replacement === code[69]) replacement = V40_STATE_ALPHABET[pick(61)];
          damaged = `${code.slice(0, 69)}${replacement}`;
          break;
        }
        default: {
          // 빈 문자열, 짧은 문자열, 너무 긴 문자열
          damaged = ["", "0", code.slice(0, 35), `${code}${code}`, " ".repeat(70)][pick(5)];
        }
      }
      if (damaged === code) damaged = `${code}!`;
      cases.push({ label: `damaged#${n}(kind ${kind})`, code: damaged });
    }
    return cases;
  }

  it("300건이 모두 거절되고 기준 계산기와 같은 결과다", () => {
    const cases = damagedCases();
    expect(cases).toHaveLength(300);
    for (const { label, code } of cases) {
      expect(decodeCode(bank, code), label).toBeNull();
      expect(ref.decodeCode(oracleBank, code), label).toBeNull();
      expect(parseShareHash(bank, `#v=v4.0-tendency&a=${code}`).kind, label).toBe("invalid");
    }
    for (const empty of [null, undefined, ""]) {
      expect(decodeCode(bank, empty)).toBeNull();
      expect(ref.decodeCode(oracleBank, empty)).toBeNull();
    }
  });

  it("한 글자를 다른 유효 글자로 바꾼 모든 경우를 거절한다(70자 x 위치별 유효 문자 전수, 응답자 한 명 기준)", () => {
    const code = valid[0];
    let checked = 0;
    for (let at = 0; at < 70; at += 1) {
      for (const replacement of validChars) {
        if (replacement === code[at]) continue;
        const damaged = `${code.slice(0, at)}${replacement}${code.slice(at + 1)}`;
        expect(decodeCode(bank, damaged)).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBe(70 * (validChars.length - 1));
  });
});
