/**
 * probeLegacyV31Progress 가 v3.1 의 읽기 규칙과 어긋나지 않는지 v3.1 모듈과 나란히 맞춰 본다.
 *
 * v4 소스는 v3.1 모듈을 가져올 수 없다(소스 가드 규칙 4). 그래서 storage.ts 는 v3.1 진행 저장 봉투의 모양을 자기 안에 따로 풀어 본다.
 * 따로 풀어 본 규칙이 v3.1 과 다르면 v3.1 에서는 카드가 안 뜨는데 v4 에서는 「이전 웨딩코드에 남겨 둔 답이 있어요」가 뜨거나(거짓 카드),
 * 반대로 v3.1 이 보여 주는 답을 v4 가 놓친다. 이 파일은 시험만 v3.1 을 가져와서 v3.1 이 실제로 쓴 값을 가짜 저장소에 놓고 두 쪽의 대답을 견준다.
 *
 * v3.1 이 카드를 내는 규칙은 readV31LocalProgress 가 ready 이고 hasV31ResumableAnswer 가 참일 때다(WeddingCodeV31Client). v4 의 present 는 이것과 같아야 한다.
 * 다만 v4 는 일부러 얕게 본다(선택 번호의 범위, 이어 할 자리가 흐름의 화면인지 등은 보지 않는다). 그래서 얕게 보는 값에서는 v4 가 더 느슨하다.
 * 그 반대(v3.1 이 보여 주는데 v4 가 숨김)는 어떤 값에서도 없어야 한다. 아래 시험이 이 두 가지를 모두 잠근다.
 */
import { describe, expect, it } from "vitest";
import { V40_STORAGE } from "@/constants/weddingCodeV40";
import {
  WEDDING_CODE_V31_AVOIDANCES,
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_SPENDING,
  WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_VERSION,
  type V31Choice,
  type V31Draft,
  type V31Rating,
} from "@/constants/weddingCodeV31";
import { createV31Draft } from "@/lib/weddingCode/v31";
import {
  V31_AVOIDANCE_INDEX,
  V31_FULL_INDEXES,
  V31_LEGACY_ONLY_INDEXES,
  V31_PRIORITY_INDEX,
  V31_SPENDING_INDEX,
  getV31ScreenIndexes,
  type V31Flow,
} from "@/lib/weddingCode/v31Flow";
import {
  LOCAL_KEY,
  LOCAL_SCHEMA,
  LOCAL_TTL_MS,
  hasV31ResumableAnswer,
  readV31LocalProgress,
  writeV31LocalProgress,
  type V31LocalProgressSnapshot,
} from "@/lib/weddingCode/v31LocalProgress";
import { probeLegacyV31Progress } from "./storage";
import type { StorageLike } from "./types";

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function rawStore(raw: string): MemoryStorage {
  const storage = new MemoryStorage();
  storage.data.set(LOCAL_KEY, raw);
  return storage;
}

/** v3.1 의 진짜 쓰기 함수로 봉투를 만든다. 이 시험이 쓰는 값이 v3.1 에서 유효하지 않으면 시험이 틀린 것이라 곧바로 실패한다. */
function writtenByV31(snapshot: V31LocalProgressSnapshot, now = NOW): MemoryStorage {
  const storage = new MemoryStorage();
  expect(writeV31LocalProgress(storage, snapshot, null, now).status).toBe("saved");
  return storage;
}

function snapshotOf(draft: V31Draft, over: Partial<V31LocalProgressSnapshot> = {}): V31LocalProgressSnapshot {
  return { draft, flow: "full", index: 0, screen: "questions", editing: false, needsPriorityReview: false, ...over };
}

/** v3.1 이 이 저장소를 보고 「남겨 둔 답이 있어요」 카드를 내는가, 낸다면 저장 시각은 언제인가. */
function v31Verdict(storage: MemoryStorage, now: number): { show: boolean; savedAt: number | null } {
  const read = readV31LocalProgress(storage, now);
  return read.status === "ready" && hasV31ResumableAnswer(read.snapshot) ? { show: true, savedAt: read.savedAt } : { show: false, savedAt: null };
}

/** 두 쪽이 같은 대답을 하는가(present 와 savedAt 모두). 어느 쪽에서든 present 는 savedAt 이 있는 것과 같아야 한다. */
function expectAgree(storage: MemoryStorage, now: number, label: string): { show: boolean; present: boolean } {
  const v31 = v31Verdict(storage, now);
  const v4 = probeLegacyV31Progress(storage, now);
  expect(v4, label).toEqual({ present: v31.show, savedAt: v31.savedAt });
  expect(v4.present, label).toBe(v4.savedAt !== null);
  return { show: v31.show, present: v4.present };
}

// ---------------------------------------------------------------------------
// 칸마다 채울 수 있는 값
// ---------------------------------------------------------------------------

const STATUSES = ["undecided", "not_applicable", "skipped", "no_preference", "no_match"] as const;

type Variant = { readonly name: string; readonly apply: (draft: V31Draft) => void };

/** 칸 하나(0에서 33)에 v3.1 이 받아들이는 값들. 칸 수나 순서가 바뀌면 여기서 던져 시험이 빨개진다. */
function variantsOf(index: number): Variant[] {
  const questionCount = WEDDING_CODE_V31_QUESTIONS.length;
  if (index < questionCount) {
    const id = WEDDING_CODE_V31_QUESTIONS[index].id;
    return [
      ...([1, 2, 3, 4, 5] as const).map((score): Variant => ({ name: `${id} ${score}점`, apply: (draft) => void (draft.answers[id] = score as V31Rating) })),
      ...(["undecided", "not_applicable", "skipped"] as const).map((status): Variant => ({ name: `${id} ${status}`, apply: (draft) => void (draft.answers[id] = status) })),
    ];
  }
  const tasteIndex = index - questionCount;
  if (tasteIndex < WEDDING_CODE_V31_TASTES.length) {
    const taste = WEDDING_CODE_V31_TASTES[tasteIndex];
    const values = taste.options.map((option) => option.value as string);
    return [
      { name: `${taste.key} 하나`, apply: (draft) => void (draft.tastes[taste.key] = { status: "answered", values: [values[0]] }) },
      { name: `${taste.key} 고를 수 있는 만큼`, apply: (draft) => void (draft.tastes[taste.key] = { status: "answered", values: values.slice(0, taste.max) }) },
      ...STATUSES.map((status): Variant => ({ name: `${taste.key} ${status}`, apply: (draft) => void (draft.tastes[taste.key] = { status } as V31Choice) })),
    ];
  }
  if (index === V31_AVOIDANCE_INDEX) {
    const values = WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value as string);
    return [
      { name: "피하고 싶은 것 하나", apply: (draft) => void (draft.avoidances = { status: "answered", values: [values[0]] }) },
      { name: "피하고 싶은 것 전부", apply: (draft) => void (draft.avoidances = { status: "answered", values }) },
      ...STATUSES.map((status): Variant => ({ name: `피하고 싶은 것 ${status}`, apply: (draft) => void (draft.avoidances = { status } as V31Choice) })),
    ];
  }
  if (index === V31_PRIORITY_INDEX) {
    // 고른 우선순위는 다른 칸의 답에 기대므로(별점 4 이상 등) 이 칸만 채우는 사례에서는 상태만 쓴다. 고른 우선순위는 따로 시험한다.
    return STATUSES.map((status): Variant => ({ name: `우선순위 ${status}`, apply: (draft) => void (draft.priorities = { status } as V31Choice) }));
  }
  if (index === V31_SPENDING_INDEX) {
    const values = WEDDING_CODE_V31_SPENDING.map((option) => option.value as string);
    return [
      { name: "쓰고 싶은 곳 하나", apply: (draft) => void (draft.spending = { status: "answered", values: [values[0]] }) },
      { name: "쓰고 싶은 곳 둘", apply: (draft) => void (draft.spending = { status: "answered", values: values.slice(0, 2) }) },
      ...STATUSES.map((status): Variant => ({ name: `쓰고 싶은 곳 ${status}`, apply: (draft) => void (draft.spending = { status } as V31Choice) })),
    ];
  }
  throw new Error(`v3.1 에 새 칸(${index})이 생겼다. storage.ts 의 LEGACY_V31_* 개수와 이 시험의 칸 목록을 함께 고쳐야 한다.`);
}

function draftWith(...variants: Variant[]): V31Draft {
  const draft = createV31Draft();
  for (const variant of variants) variant.apply(draft);
  return draft;
}

// ---------------------------------------------------------------------------
// 상수와 개수
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 상수", () => {
  it("v4 가 따로 적어 둔 값(키, 30일, 버전, 스키마, 칸 수)이 v3.1 의 값과 같다", () => {
    expect(V40_STORAGE.legacyV31ProgressKey).toBe(LOCAL_KEY);
    expect(V40_STORAGE.ttlMs).toBe(LOCAL_TTL_MS);
    expect(WEDDING_CODE_V31_VERSION).toBe("v3.1-preferences");
    expect(LOCAL_SCHEMA).toBe(2);
    // storage.ts 가 25 + 6 + 3 으로 적어 둔 칸 수. 바뀌면 probe 의 모양 검사를 함께 고쳐야 한다.
    expect(WEDDING_CODE_V31_QUESTIONS).toHaveLength(25);
    expect(WEDDING_CODE_V31_TASTES).toHaveLength(6);
    expect(V31_FULL_INDEXES).toHaveLength(34);
    expect(V31_AVOIDANCE_INDEX).toBe(31);
    expect(V31_PRIORITY_INDEX).toBe(32);
    expect(V31_SPENDING_INDEX).toBe(33);
  });

  it("v3.1 흐름은 core, extra, full 셋이고 흐름마다 첫 화면 자리가 있다", () => {
    for (const flow of ["core", "extra", "full"] as const) expect(getV31ScreenIndexes(flow).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 칸 하나씩
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 34칸 하나씩", () => {
  it("시작만 누른 빈 진행은 두 쪽 모두 카드를 내지 않는다", () => {
    for (const flow of ["core", "extra", "full"] as const) {
      const index = getV31ScreenIndexes(flow)[0];
      const outcome = expectAgree(writtenByV31(snapshotOf(createV31Draft(), { flow, index })), NOW, `빈 진행 ${flow}`);
      expect(outcome).toEqual({ show: false, present: false });
    }
  });

  it("칸 하나만 채워도 34칸 모두 두 쪽이 카드를 낸다(칸마다 모든 종류의 값으로)", () => {
    let checked = 0;
    for (const index of V31_FULL_INDEXES) {
      const variants = variantsOf(index);
      expect(variants.length, `칸 ${index}`).toBeGreaterThan(0);
      for (const variant of variants) {
        const outcome = expectAgree(writtenByV31(snapshotOf(draftWith(variant))), NOW, `칸 ${index} ${variant.name}`);
        expect(outcome, `칸 ${index} ${variant.name}`).toEqual({ show: true, present: true });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("고른 우선순위(다른 칸의 별점에 기댄 값)도 카드를 낸다", () => {
    const id = WEDDING_CODE_V31_QUESTIONS[1].id;
    const draft = draftWith({ name: "별점", apply: (d) => void (d.answers[id] = 5) }, { name: "우선순위", apply: (d) => void (d.priorities = { status: "answered", values: [id] }) });
    expect(expectAgree(writtenByV31(snapshotOf(draft)), NOW, "고른 우선순위")).toEqual({ show: true, present: true });
  });

  it("34칸을 모두 채운 진행도 같은 대답이다(결과 화면 자리)", () => {
    const draft = createV31Draft();
    for (const index of V31_FULL_INDEXES) variantsOf(index)[0].apply(draft);
    expect(expectAgree(writtenByV31(snapshotOf(draft, { screen: "result" })), NOW, "모두 채움")).toEqual({ show: true, present: true });
  });
});

// ---------------------------------------------------------------------------
// 흐름, 스키마, 자리
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 흐름, 스키마, 이어 할 자리", () => {
  it("흐름 셋과 화면 자리마다 같은 대답이다", () => {
    const draft = draftWith(variantsOf(0)[2]);
    for (const flow of ["core", "extra", "full"] as const satisfies readonly V31Flow[]) {
      for (const index of getV31ScreenIndexes(flow)) {
        expect(expectAgree(writtenByV31(snapshotOf(draft, { flow, index })), NOW, `${flow} ${index}`)).toEqual({ show: true, present: true });
      }
    }
  });

  it("고치는 중(editing)이나 우선순위를 다시 보는 중인 진행도 같은 대답이다", () => {
    const draft = draftWith(variantsOf(0)[2]);
    expect(expectAgree(writtenByV31(snapshotOf(draft, { editing: true, index: 20 })), NOW, "editing"), "editing").toEqual({ show: true, present: true });
    expect(expectAgree(writtenByV31(snapshotOf(draft, { needsPriorityReview: true })), NOW, "needsPriorityReview")).toEqual({ show: true, present: true });
  });

  it("스키마 1 봉투(흐름 키가 없고 전체 흐름으로 읽는다)도 같은 대답이다", () => {
    for (const draft of [createV31Draft(), draftWith(variantsOf(3)[0]), draftWith(variantsOf(31)[0])]) {
      const written = writtenByV31(snapshotOf(draft)).data.get(LOCAL_KEY) ?? "";
      const envelope = JSON.parse(written) as Record<string, unknown>;
      envelope.schema = 1;
      delete envelope.flow;
      const outcome = expectAgree(rawStore(JSON.stringify(envelope)), NOW, "스키마 1");
      expect(outcome.show).toBe(hasV31ResumableAnswer({ draft }));
    }
  });

  it("v3.1 이 예전에 우선순위 자리로 저장한 선택 흐름 봉투도 같은 대답이다", () => {
    // 선택 흐름(extra)의 우선순위 자리는 이제 화면이 없어서 v3.1 이 고치는 화면으로 이어 준다. 읽을 수 있는 봉투로 남아 있다.
    const draft = draftWith(variantsOf(0)[2]);
    const written = writtenByV31(snapshotOf(draft, { flow: "extra", index: 0 })).data.get(LOCAL_KEY) ?? "";
    const envelope = JSON.parse(written) as Record<string, unknown>;
    envelope.index = V31_PRIORITY_INDEX;
    expect(expectAgree(rawStore(JSON.stringify(envelope)), NOW, "우선순위 자리")).toEqual({ show: true, present: true });
  });
});

// ---------------------------------------------------------------------------
// 시각, 길이, 깨진 값
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 시각과 길이", () => {
  it("저장 시각 경계: 하루를 넘는 미래는 읽지 않고, 기기 시계가 하루 안으로 뒤로 간 것과 지금과 29일 23시간 59분 59초 999 밀리초 뒤까지 읽고, 30일이 되는 순간 지난 것으로 본다", () => {
    const storage = writtenByV31(snapshotOf(draftWith(variantsOf(0)[2])), NOW);
    // 두 쪽(v3.1 읽기와 v4 탐침)이 같은 경계를 쓴다(감사 6-2).
    expect(expectAgree(storage, NOW - 1, "시계가 1밀리초 뒤로")).toEqual({ show: true, present: true });
    expect(expectAgree(storage, NOW - DAY, "시계가 하루 뒤로")).toEqual({ show: true, present: true });
    expect(expectAgree(storage, NOW - DAY - 1, "하루를 넘는 미래")).toEqual({ show: false, present: false });
    expect(expectAgree(storage, NOW, "지금")).toEqual({ show: true, present: true });
    expect(expectAgree(storage, NOW + DAY, "하루 뒤")).toEqual({ show: true, present: true });
    expect(expectAgree(storage, NOW + LOCAL_TTL_MS - 1, "30일 하나 전")).toEqual({ show: true, present: true });
    expect(expectAgree(storage, NOW + LOCAL_TTL_MS, "30일")).toEqual({ show: false, present: false });
    expect(expectAgree(storage, NOW + LOCAL_TTL_MS + DAY, "31일")).toEqual({ show: false, present: false });
  });

  it("시각이 올바르지 않은 now 는 두 쪽 모두 읽지 않는다", () => {
    const storage = writtenByV31(snapshotOf(draftWith(variantsOf(0)[2])), NOW);
    for (const now of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(expectAgree(storage, now, `now ${now}`)).toEqual({ show: false, present: false });
    }
  });

  it("봉투 길이 상한: 2048자까지 읽고 2049자부터 읽지 않는다(두 쪽 모두)", () => {
    const written = writtenByV31(snapshotOf(draftWith(variantsOf(0)[2]))).data.get(LOCAL_KEY) ?? "";
    expect(written.length).toBeLessThan(2048);
    const exact = written + " ".repeat(2048 - written.length);
    expect(exact).toHaveLength(2048);
    expect(expectAgree(rawStore(exact), NOW, "2048자")).toEqual({ show: true, present: true });
    expect(expectAgree(rawStore(`${exact} `), NOW, "2049자")).toEqual({ show: false, present: false });
  });

  it("없거나 비었거나 깨진 값은 두 쪽 모두 읽지 않는다", () => {
    expect(expectAgree(new MemoryStorage(), NOW, "없음")).toEqual({ show: false, present: false });
    for (const raw of ["", " ", "not json", "{", "[]", "null", "7", "true", '"text"', "{}", '{"savedAt":1}', "x".repeat(5000)]) {
      expect(expectAgree(rawStore(raw), NOW, raw.slice(0, 20)), raw.slice(0, 20)).toEqual({ show: false, present: false });
    }
  });
});

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 손으로 망가뜨린 봉투", () => {
  /** v3.1 이 실제로 쓴 봉투(답 셋). 시험마다 새로 만든다. */
  const baseEnvelope = (): Record<string, unknown> =>
    JSON.parse(writtenByV31(snapshotOf(draftWith(variantsOf(0)[2], variantsOf(26)[0], variantsOf(33)[0]))).data.get(LOCAL_KEY) ?? "") as Record<string, unknown>;
  const tamper = (changes: Record<string, unknown>, drop: readonly string[] = []): string => {
    const merged: Record<string, unknown> = { ...baseEnvelope(), ...changes };
    for (const key of drop) delete merged[key];
    return JSON.stringify(merged);
  };

  it("진짜 봉투는 두 쪽 모두 읽는다(아래 망가뜨린 값과 견주는 기준)", () => {
    expect(expectAgree(rawStore(JSON.stringify(baseEnvelope())), NOW, "기준")).toEqual({ show: true, present: true });
  });

  it("봉투 겉모양이 틀리면 두 쪽 모두 읽지 않는다", () => {
    const cases: Array<[string, string]> = [
      ["스키마 3", tamper({ schema: 3 })],
      ["스키마 0", tamper({ schema: 0 })],
      ["스키마 문자열", tamper({ schema: "2" })],
      ["버전 다름", tamper({ version: "v3.0-preferences" })],
      ["v4 버전", tamper({ version: "v4.0-tendency" })],
      ["모르는 키", tamper({ memo: "x" })],
      ["키 하나 빠짐", tamper({}, ["needsPriorityReview"])],
      ["스키마 2 인데 흐름 없음", tamper({}, ["flow"])],
      ["모르는 흐름", tamper({ flow: "all" })],
      ["저장 시각이 문자열", tamper({ savedAt: String(NOW) })],
      ["저장 시각이 소수", tamper({ savedAt: NOW + 0.5 })],
      ["저장 시각이 음수", tamper({ savedAt: -1 })],
      ["자리가 음수", tamper({ index: -1 })],
      ["자리가 34", tamper({ index: 34 })],
      ["자리가 소수", tamper({ index: 0.5 })],
      ["화면 이름 다름", tamper({ screen: "intro" })],
      ["editing 이 숫자", tamper({ editing: 1 })],
      ["needsPriorityReview 가 문자열", tamper({ needsPriorityReview: "false" })],
      ["답 코드가 숫자", tamper({ answerCode: 31 })],
      ["답 코드가 null", tamper({ answerCode: null })],
    ];
    for (const [name, raw] of cases) expect(expectAgree(rawStore(raw), NOW, name), name).toEqual({ show: false, present: false });
  });

  it("답 코드의 모양이 틀리면 두 쪽 모두 읽지 않는다", () => {
    const answerCode = baseEnvelope().answerCode as string;
    const parts = answerCode.split("_");
    expect(parts).toHaveLength(6);
    const withParts = (replace: (copy: string[]) => void): string => {
      const copy = [...parts];
      replace(copy);
      return tamper({ answerCode: copy.join("_") });
    };
    const cases: Array<[string, string]> = [
      ["문장 24칸", withParts((p) => void (p[1] = p[1].slice(1)))],
      ["문장 26칸", withParts((p) => void (p[1] = `${p[1]}-`))],
      ["문장 칸에 6점", withParts((p) => void (p[1] = `6${p[1].slice(1)}`))],
      ["문장 칸에 p", withParts((p) => void (p[1] = `p${p[1].slice(1)}`))],
      ["첫 조각 32", withParts((p) => void (p[0] = "32"))],
      ["조각 5개", withParts((p) => void p.pop())],
      ["조각 7개", withParts((p) => void p.push("-"))],
      ["취향 5칸", withParts((p) => void (p[2] = p[2].split(".").slice(1).join(".")))],
      ["취향 7칸", withParts((p) => void (p[2] = `${p[2]}.-`))],
      ["선택 칸에 모르는 글자", withParts((p) => void (p[3] = "x"))],
      ["선택 칸이 빈 문자열", withParts((p) => void (p[3] = ""))],
      ["선택 칸의 c 뒤에 번호 없음", withParts((p) => void (p[4] = "c"))],
      ["선택 칸의 c 뒤 번호가 한 글자", withParts((p) => void (p[4] = "c0"))],
      ["대문자", withParts((p) => void (p[5] = "C00"))],
      ["답 코드 길이 256 초과", tamper({ answerCode: `${answerCode}${"0".repeat(260)}` })],
    ];
    for (const [name, raw] of cases) expect(expectAgree(rawStore(raw), NOW, name), name).toEqual({ show: false, present: false });
  });
});

// ---------------------------------------------------------------------------
// 무작위로 맞춰 보기
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress 와 v3.1 읽기 규칙: 무작위 대조", () => {
  it("v3.1 이 쓴 무작위 진행 400개에서 두 쪽이 한 번도 어긋나지 않고, 답이 있는 경우와 없는 경우가 모두 나온다", () => {
    let seed = 20261002;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    let shown = 0;
    let hidden = 0;
    for (let round = 0; round < 400; round += 1) {
      const draft = createV31Draft();
      for (const index of V31_FULL_INDEXES) if (random() < 0.08) pick(variantsOf(index)).apply(draft);
      const flow = pick(["core", "extra", "full"] as const);
      const snapshot = snapshotOf(draft, { flow, index: pick(getV31ScreenIndexes(flow)), needsPriorityReview: random() < 0.2 });
      const savedAt = NOW - Math.floor(random() * 40 * DAY);
      const storage = writtenByV31(snapshot, savedAt);
      const outcome = expectAgree(storage, NOW, `무작위 ${round}`);
      if (outcome.show) shown += 1;
      else hidden += 1;
    }
    expect(shown).toBeGreaterThan(50);
    expect(hidden).toBeGreaterThan(50);
  });

  it("진짜 봉투의 글자 하나를 바꾼 값 어디서도 v3.1 이 카드를 내는 값을 v4 가 놓치지 않는다", () => {
    const draft = draftWith(variantsOf(0)[2], variantsOf(7)[0], variantsOf(26)[0], variantsOf(31)[1], variantsOf(33)[1]);
    const written = writtenByV31(snapshotOf(draft)).data.get(LOCAL_KEY) ?? "";
    let stillShown = 0;
    let broken = 0;
    for (let at = 0; at < written.length; at += 1) {
      for (const char of ["0", "1", "3", "5", "9", "x", "u", "p", "-", "_", ".", '"', "c"]) {
        if (written[at] === char) continue;
        const mutated = `${written.slice(0, at)}${char}${written.slice(at + 1)}`;
        const storage = rawStore(mutated);
        const v31 = v31Verdict(storage, NOW);
        const v4 = probeLegacyV31Progress(storage, NOW);
        expect(v4.present, mutated).toBe(v4.savedAt !== null);
        if (v31.show) {
          stillShown += 1;
          expect(v4, mutated).toEqual({ present: true, savedAt: v31.savedAt });
        } else {
          broken += 1;
        }
      }
    }
    // 글자 하나를 바꿔도 v3.1 이 읽는 값(바꾼 글자가 별점 등 값이 되는 자리)과 못 읽는 값이 모두 나와야 이 시험이 의미가 있다.
    expect(stillShown).toBeGreaterThan(20);
    expect(broken).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// 알려진 한계: 일부러 얕게 보는 곳
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress: v3.1 보다 느슨한 곳(알려진 한계, 손으로 망가뜨린 값에만 해당)", () => {
  const written = (): Record<string, unknown> => JSON.parse(writtenByV31(snapshotOf(draftWith(variantsOf(0)[2]))).data.get(LOCAL_KEY) ?? "") as Record<string, unknown>;
  const withCode = (replace: (parts: string[]) => void): string => {
    const envelope = written();
    const parts = String(envelope.answerCode).split("_");
    replace(parts);
    envelope.answerCode = parts.join("_");
    return JSON.stringify(envelope);
  };

  // v4 는 v3.1 이 쓰는 값만 만나는 것을 전제로 얕게 본다. 아래는 v3.1 이 읽지 못하는 값을 v4 가 읽는다고 하는 것을 못 박아 둔 것이라,
  // v4 의 풀이를 더 깊게 고치면 이 시험이 빨개지고 그때 이 시험을 새 동작에 맞게 고치면 된다. 거짓 카드가 아니라 손으로 망가뜨린 값에서만 일어난다.
  it("취향 선택 번호가 보기 개수 밖이거나 겹치거나 고를 수 있는 개수를 넘으면 v3.1 은 읽지 못하는데 v4 는 모양만 보고 답이 있다고 한다", () => {
    for (const taste of ["czz", "c0000", "c0001"]) {
      const storage = rawStore(withCode((parts) => void (parts[2] = [taste, ...parts[2].split(".").slice(1)].join("."))));
      expect(v31Verdict(storage, NOW).show, taste).toBe(false);
      expect(probeLegacyV31Progress(storage, NOW).present, taste).toBe(true);
    }
  });

  it("이어 할 자리가 그 흐름의 화면이 아니거나 결과 화면인데 답이 덜 찼으면 v3.1 은 읽지 못하는데 v4 는 읽는다", () => {
    const outOfFlow = written();
    outOfFlow.flow = "core";
    outOfFlow.index = V31_LEGACY_ONLY_INDEXES[0];
    const early = written();
    early.screen = "result";
    for (const [name, envelope] of [["흐름 밖 자리", outOfFlow], ["덜 찬 결과", early]] as const) {
      const storage = rawStore(JSON.stringify(envelope));
      expect(v31Verdict(storage, NOW).show, name).toBe(false);
      expect(probeLegacyV31Progress(storage, NOW).present, name).toBe(true);
    }
  });
});
