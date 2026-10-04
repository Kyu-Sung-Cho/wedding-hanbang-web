import { describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, WEDDING_CODE_V31_VERSION, type V31Choice, type V31Draft, type V31Response } from "@/constants/weddingCodeV31";
import { buildV31Profile, buildV31ShareUrl, createV31Draft, decodeV31, decodeV31Progress, encodeV31 } from "../v31";
import { clearV31LocalProgress, hasV31ResumableAnswer, LOCAL_KEY, LOCAL_SCHEMA, LOCAL_TTL_MS, readV31LocalProgress, writeV31LocalProgress, type V31LocalProgressSnapshot, type V31ProgressStorage } from "../v31LocalProgress";
import { V31_AVOIDANCE_INDEX, V31_CORE_RATING_IDS, V31_FULL_INDEXES, V31_PRIORITY_INDEX, getV31ResponseAt } from "../v31Flow";

const NOW = Date.parse("2026-09-24T10:00:00Z");
function memory() {
  const values = new Map<string, string>();
  const storage: V31ProgressStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  return { storage, values };
}
function snapshot(draft: V31Draft = createV31Draft()): V31LocalProgressSnapshot {
  return { draft, flow: "full", index: 0, screen: "questions", editing: false, needsPriorityReview: false };
}
function complete(): V31Draft {
  const draft = createV31Draft();
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = "skipped";
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "skipped" };
  draft.avoidances = { status: "skipped" };
  draft.priorities = { status: "skipped" };
  draft.spending = { status: "skipped" };
  return draft;
}
function envelope(value = snapshot(), savedAt = NOW): Record<string, unknown> {
  return { schema: LOCAL_SCHEMA, version: WEDDING_CODE_V31_VERSION, savedAt, answerCode: encodeV31(value.draft), flow: value.flow, index: value.index, screen: value.screen, editing: value.editing, needsPriorityReview: value.needsPriorityReview };
}
function setEnvelope(storage: V31ProgressStorage, patch: Record<string, unknown> = {}, value = snapshot(), savedAt = NOW) {
  const raw = JSON.stringify({ ...envelope(value, savedAt), ...patch });
  storage.setItem(LOCAL_KEY, raw);
  return raw;
}

describe("v3.1 자동저장 전용 decoder", () => {
  it("빈 진행과 모름·건너뜀만 있는 진행을 복원하지만 공유 경계는 그대로다", () => {
    const partial = createV31Draft();
    partial.answers.V1 = "undecided";
    partial.answers.G1 = "not_applicable";
    partial.answers.G2 = "skipped";
    for (const draft of [createV31Draft(), partial, complete()]) {
      const code = encodeV31(draft);
      expect(decodeV31Progress(code)).toEqual(draft);
      expect(decodeV31(code)).toBeNull();
      expect(buildV31ShareUrl({ origin: "https://hanbang.ai", first: draft })).toBeNull();
    }
  });

  it("공유보다 느슨해지는 부분은 내용 유무뿐이고 잘못된 값은 보정 없이 거절한다", () => {
    const draft = complete();
    const valid = encodeV31(draft);
    const parts = valid.split("_");
    const malformed = [undefined, null, "", valid.repeat(40), valid.replace(/^31_/, "3_"), valid + "_extra"];
    for (const answerPart of ["1".repeat(24), "0".repeat(25), "p".repeat(25)]) malformed.push([parts[0], answerPart, ...parts.slice(2)].join("_"));
    const injected = [...parts];
    injected[4] = "c00";
    malformed.push(injected.join("_"));
    const duplicate = [...parts];
    duplicate[3] = "c0000";
    malformed.push(duplicate.join("_"));
    for (const code of malformed) expect(decodeV31Progress(code)).toBeNull();
  });
});
describe("v3.1 본인 진행 저장과 복원", () => {
  it("읽기만 해서는 저장 시각이나 raw를 바꾸지 않는다", () => {
    const { storage } = memory();
    const draft = createV31Draft();
    draft.answers.V1 = "undecided";
    const value = { ...snapshot(draft), index: 1, editing: true, needsPriorityReview: true };
    const raw = setEnvelope(storage, {}, value, NOW - 5000);
    vi.mocked(storage.setItem).mockClear();
    vi.mocked(storage.removeItem).mockClear();
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "ready", snapshot: value, savedAt: NOW - 5000, raw });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("검증한 자기 답과 최소 진행 상태만 직렬화하며 공유 URL·메모·상대 답은 담지 않는다", () => {
    const { storage } = memory();
    const draft = createV31Draft();
    draft.answers.B1 = 5;
    draft.tastes.photo = { status: "answered", values: ["both_styles"] };
    draft.priorities = { status: "answered", values: ["B1"] };
    const value = { ...snapshot(draft), index: 32, editing: true, needsPriorityReview: true };
    const written = writeV31LocalProgress(storage, value, null, NOW);
    expect(written.status).toBe("saved");
    if (written.status !== "saved") throw new Error("진행이 저장되어야 한다");
    const parsed: unknown = JSON.parse(written.raw);
    expect(parsed).toEqual(envelope(value));
    expect(Object.keys(Object(parsed)).sort()).toEqual(["schema", "version", "savedAt", "answerCode", "flow", "index", "screen", "editing", "needsPriorityReview"].sort());
    expect(written.raw).not.toMatch(/https?:|partner|consent|memo|account|userId/);
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "ready", snapshot: value, savedAt: NOW, raw: written.raw });
  });

  it("동일 raw에서 작성한 다음 답은 저장하고, 다른 탭의 새 답이나 삭제를 덮어쓰지 않는다", () => {
    const { storage } = memory();
    const first = writeV31LocalProgress(storage, snapshot(), null, NOW);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") throw new Error("초기 진행이 저장되어야 한다");
    const next = snapshot();
    next.draft.answers.V1 = 5;
    expect(writeV31LocalProgress(storage, next, first.raw, NOW + 100).status).toBe("saved");
    const current = storage.getItem(LOCAL_KEY);
    expect(writeV31LocalProgress(storage, snapshot(), first.raw, NOW + 200).status).toBe("conflict");
    expect(storage.getItem(LOCAL_KEY)).toBe(current);
    storage.removeItem(LOCAL_KEY);
    expect(writeV31LocalProgress(storage, next, current, NOW + 300).status).toBe("conflict");
    expect(storage.getItem(LOCAL_KEY)).toBeNull();
  });

  it("다른 탭의 데이터가 이미 있으면 최초 빈 화면의 자동저장도 덮어쓸 수 없다", () => {
    const { storage } = memory();
    const raw = setEnvelope(storage);
    expect(writeV31LocalProgress(storage, snapshot(), null, NOW + 100).status).toBe("conflict");
    expect(storage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it("34개를 모두 살펴본 결과만 저장하며 완료 전 수정 상태와 구분한다", () => {
    const { storage } = memory();
    const done: V31LocalProgressSnapshot = { ...snapshot(complete()), index: 33, screen: "result" };
    expect(writeV31LocalProgress(storage, done, null, NOW).status).toBe("saved");
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: done });
    const variants = [
      { ...done, editing: true }, { ...done, needsPriorityReview: true }, { ...done, draft: createV31Draft() },
    ];
    const missingRating = complete(); delete missingRating.answers.H4;
    const missingTaste = complete(); delete missingTaste.tastes.ceremony;
    const missingAvoidance = complete(); delete missingAvoidance.avoidances;
    const missingPriority = complete(); delete missingPriority.priorities;
    const missingSpending = complete(); delete missingSpending.spending;
    for (const draft of [missingRating, missingTaste, missingAvoidance, missingPriority, missingSpending]) variants.push({ ...done, draft });
    for (const variant of variants) {
      expect(writeV31LocalProgress(storage, variant, storage.getItem(LOCAL_KEY), NOW).status).toBe("invalid");
      setEnvelope(storage, {}, variant);
      expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
    }
  });

  it.each([0, 33])("질문 인덱스 경계 %i는 보존한다", (index) => {
    const { storage } = memory();
    setEnvelope(storage, { index });
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: { index } });
  });

  it("자료가 없거나 만료·손상된 상태를 구분하고 자동으로 수명을 연장하지 않는다", () => {
    const { storage } = memory();
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "empty", raw: null });
    const justValid = setEnvelope(storage, {}, snapshot(), NOW - LOCAL_TTL_MS + 1);
    expect(readV31LocalProgress(storage, NOW).status).toBe("ready");
    const expired = setEnvelope(storage, {}, snapshot(), NOW - LOCAL_TTL_MS);
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "expired", raw: expired });
    expect(storage.getItem(LOCAL_KEY)).toBe(expired);
    expect(expired).not.toBe(justValid);
    storage.setItem(LOCAL_KEY, "{bad json");
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "invalid", raw: "{bad json" });
  });

  it("잘못된 스키마·버전·시각·인덱스·화면·추가 필드·과대 payload를 엄격하게 거절한다", () => {
    const { storage } = memory();
    const patches: Record<string, unknown>[] = [
      { schema: 0 }, { schema: "1" }, { schema: 3 }, { version: "v3.0-preferences" }, { flow: "unknown" }, { flow: null },
      { savedAt: -1 }, { savedAt: 1.5 }, { savedAt: "yesterday" }, { savedAt: null },
      { index: -1 }, { index: 34 }, { index: 0.5 }, { index: "2" }, { screen: "intro" },
      { editing: 0 }, { needsPriorityReview: "false" }, { partnerDraft: {} }, { consent: true }, { memo: "내 메모" },
      { account: "private" }, { answerCode: null }, { answerCode: "x".repeat(300) },
    ];
    for (const patch of patches) {
      const raw = setEnvelope(storage, patch);
      expect(readV31LocalProgress(storage, NOW), JSON.stringify(patch)).toEqual({ status: "invalid", raw });
    }
    for (const raw of ["null", "[]", "1", JSON.stringify({}), "x".repeat(10000)]) {
      storage.setItem(LOCAL_KEY, raw);
      expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "invalid", raw });
    }
    const incomplete = envelope(); delete incomplete.editing;
    storage.setItem(LOCAL_KEY, JSON.stringify(incomplete));
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
  });

  it("기기 시계가 저장 뒤에 뒤로 가서 저장 시각이 하루 안의 미래로 보여도 멀쩡한 저장으로 읽고, 만료는 저장 시각부터 센다(감사 6-2)", () => {
    const { storage } = memory();
    const raw = setEnvelope(storage, { savedAt: NOW });
    const DAY = 24 * 60 * 60 * 1000;
    for (const back of [1, 60_000, 3_600_000, DAY]) {
      const read = readV31LocalProgress(storage, NOW - back);
      expect(read.status, String(back)).toBe("ready");
      expect(read.status === "ready" && read.savedAt).toBe(NOW);
      expect(read.raw, String(back)).toBe(raw);
    }
    // 하루를 넘는 미래는 전과 같이 읽지 않는다. 저장 기간을 사실상 늘리는 값이다.
    // 시계가 원인일 때만 clockAhead 표시가 붙는다(폰 날짜를 확인하라는 안내의 근거). 다른 이유로 읽지 못하는 저장에는 붙지 않는다.
    expect(readV31LocalProgress(storage, NOW - DAY - 1)).toEqual({ status: "invalid", raw, clockAhead: true });
    const badVersion = setEnvelope(storage, { savedAt: NOW, version: "v3.0-preferences" });
    expect(readV31LocalProgress(storage, NOW - DAY - 1)).toEqual({ status: "invalid", raw: badVersion });
    const badPosition = setEnvelope(storage, { savedAt: NOW, index: -1 });
    expect(readV31LocalProgress(storage, NOW - DAY - 1)).toEqual({ status: "invalid", raw: badPosition });
    setEnvelope(storage, { savedAt: NOW });
    // 나이는 음수로 본다: 시계가 따라잡아 저장 시각에서 30일이 되는 순간에야 지난 것으로 본다.
    expect(readV31LocalProgress(storage, NOW + LOCAL_TTL_MS - 1).status).toBe("ready");
    expect(readV31LocalProgress(storage, NOW + LOCAL_TTL_MS).status).toBe("expired");
  });

  it("미등록 저장 필드와 원답에서 확인할 수 없는 우선순위를 조용히 보정하지 않는다", () => {
    const { storage } = memory();
    const value = snapshot();
    value.draft.answers.V1 = 3;
    value.draft.priorities = { status: "answered", values: ["V1"] };
    expect(writeV31LocalProgress(storage, value, null, NOW).status).toBe("invalid");
    expect(storage.getItem(LOCAL_KEY)).toBeNull();
    const valid = snapshot();
    for (const extra of [{ memo: "비공개 메모" }, { partnerDraft: complete() }, { partnerCode: "받은 코드" }, { consent: true }]) {
      expect(writeV31LocalProgress(storage, Object.assign({}, valid, extra), null, NOW).status).toBe("invalid");
    }
    const hiddenDraft = snapshot();
    Reflect.set(hiddenDraft.draft, "memo", "비공개 메모");
    expect(writeV31LocalProgress(storage, hiddenDraft, null, NOW).status).toBe("invalid");
    const injected = encodeV31(complete()).split("_");
    injected[4] = "c00";
    setEnvelope(storage, { answerCode: injected.join("_") });
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])("유효하지 않은 현재 시각 %s로 복원하거나 저장하지 않는다", (now) => {
    const { storage } = memory();
    setEnvelope(storage);
    expect(readV31LocalProgress(storage, now).status).toBe("invalid");
    expect(writeV31LocalProgress(storage, snapshot(), storage.getItem(LOCAL_KEY), now).status).toBe("invalid");
  });

  it("저장소 읽기·쓰기·삭제 오류를 밖으로 던지지 않는다", () => {
    const { storage } = memory();
    vi.mocked(storage.getItem).mockImplementation(() => { throw new Error("unavailable"); });
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "unavailable", raw: null });
    expect(writeV31LocalProgress(storage, snapshot(), null, NOW).status).toBe("unavailable");
    vi.mocked(storage.getItem).mockImplementation(() => null);
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("quota exceeded"); });
    expect(writeV31LocalProgress(storage, snapshot(), null, NOW).status).toBe("unavailable");
    vi.mocked(storage.removeItem).mockImplementation(() => { throw new Error("denied"); });
    expect(clearV31LocalProgress(storage)).toEqual({ status: "unavailable" });
  });

  it("지울 때는 웨딩코드 진행 키 하나만 지우고 다른 브라우저 정보는 보존한다", () => {
    const { storage } = memory();
    setEnvelope(storage);
    storage.setItem("unrelated", "keep");
    expect(clearV31LocalProgress(storage)).toEqual({ status: "cleared" });
    expect(storage.getItem(LOCAL_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(LOCAL_KEY);
  });
});

describe("v3.1 단축 흐름 저장과 이전 진행 호환", () => {
  function coreComplete(): V31Draft {
    const draft = createV31Draft();
    for (const id of V31_CORE_RATING_IDS) draft.answers[id] = 4;
    for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "undecided" };
    draft.avoidances = { status: "no_preference" };
    draft.spending = { status: "no_preference" };
    return draft;
  }

  it.each([0, 1, 24, 25, 32, 33])("schema1의 기존 %i번 자리를 full로 읽으며 저장 기간과 raw를 바꾸지 않는다", index => {
    const { storage } = memory();
    const saved: V31LocalProgressSnapshot = { ...snapshot(complete()), index, editing: index === 32, needsPriorityReview: index === 32 };
    const legacy = envelope(saved, NOW - 5000);
    legacy.schema = 1;
    delete legacy.flow;
    const raw = JSON.stringify(legacy);
    storage.setItem(LOCAL_KEY, raw);
    vi.mocked(storage.setItem).mockClear();
    vi.mocked(storage.removeItem).mockClear();
    const read = readV31LocalProgress(storage, NOW);
    expect(read).toEqual({ status: "ready", snapshot: saved, savedAt: NOW - 5000, raw });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    if (read.status !== "ready") throw new Error("이전 진행이 보존되어야 한다");
    const written = writeV31LocalProgress(storage, read.snapshot, read.raw, NOW + 100);
    expect(written.status).toBe("saved");
    if (written.status !== "saved") throw new Error("다음 실제 저장에서 새 형식을 써야 한다");
    expect(JSON.parse(written.raw)).toMatchObject({ schema: 2, flow: "full", index, savedAt: NOW + 100 });
  });

  it("schema1의 완료 결과는 full로 복원하고, 23개뿐인 값을 구판 완료로 받아들이지 않는다", () => {
    const { storage } = memory();
    const value: V31LocalProgressSnapshot = { ...snapshot(complete()), screen: "result", index: 33 };
    const legacy = envelope(value); legacy.schema = 1; delete legacy.flow;
    storage.setItem(LOCAL_KEY, JSON.stringify(legacy));
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: value });
    legacy.answerCode = encodeV31(coreComplete());
    storage.setItem(LOCAL_KEY, JSON.stringify(legacy));
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
    legacy.flow = "core";
    storage.setItem(LOCAL_KEY, JSON.stringify(legacy));
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
  });

  it.each(["core", "extra"] as const)("%s 결과는 핵심 23개를 보존하고 추가 답을 몰래 채우지 않는다", flow => {
    const { storage } = memory();
    const value: V31LocalProgressSnapshot = { ...snapshot(coreComplete()), flow, screen: "result", index: 33 };
    const original = structuredClone(value);
    const written = writeV31LocalProgress(storage, value, null, NOW);
    expect(written.status).toBe("saved");
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: original });
    expect(value).toEqual(original);
    expect(value.draft.answers.B2).toBeUndefined();
    expect(value.draft.answers.D2).toBeUndefined();
    expect(value.draft.priorities).toBeUndefined();
    for (const field of ["G1", "H4"] as const) {
      const missing = structuredClone(value); delete missing.draft.answers[field];
      expect(writeV31LocalProgress(storage, missing, storage.getItem(LOCAL_KEY), NOW).status).toBe("invalid");
      setEnvelope(storage, {}, missing);
      expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
    }
    for (const patch of [{ editing: true }, { needsPriorityReview: true }]) {
      const pending = { ...value, ...patch };
      expect(writeV31LocalProgress(storage, pending, storage.getItem(LOCAL_KEY), NOW).status).toBe("invalid");
    }
  });

  it("질문 진행은 선택한 흐름 안의 자리를 요구하지만 한 문항 편집과 결과는 기존 자리를 보존한다", () => {
    const { storage } = memory();
    const core: V31LocalProgressSnapshot = { ...snapshot(coreComplete()), flow: "core", index: 1 };
    expect(writeV31LocalProgress(storage, core, null, NOW).status).toBe("saved");
    for (const value of [{ ...core, index: 0 }, { ...core, flow: "extra" as const }, { ...core, flow: "extra" as const, index: 7 }]) {
      expect(writeV31LocalProgress(storage, value, storage.getItem(LOCAL_KEY), NOW).status).toBe("invalid");
      setEnvelope(storage, {}, value);
      expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
    }
    const edit = { ...core, editing: true, index: 7 };
    expect(writeV31LocalProgress(storage, edit, storage.getItem(LOCAL_KEY), NOW).status).toBe("saved");
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: edit });
    const done: V31LocalProgressSnapshot = { ...edit, editing: false, screen: "result" };
    expect(writeV31LocalProgress(storage, done, storage.getItem(LOCAL_KEY), NOW).status).toBe("saved");
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: done });
    const missingFlow = envelope(core); delete missingFlow.flow;
    storage.setItem(LOCAL_KEY, JSON.stringify(missingFlow));
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
  });

  it("기본 흐름 끝의 우선순위 자리를 저장·복원하고, 선택 흐름에서 묻던 때의 자리는 그 한 문항 수정으로 이어 준다", () => {
    const { storage } = memory();
    const atPriority: V31LocalProgressSnapshot = { ...snapshot(coreComplete()), flow: "core", index: 32 };
    expect(writeV31LocalProgress(storage, atPriority, null, NOW).status).toBe("saved");
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: atPriority });
    // 선택 흐름에는 이제 우선순위 화면이 없으므로 새로 저장하지 않는다.
    const legacy: V31LocalProgressSnapshot = { ...atPriority, flow: "extra" };
    expect(writeV31LocalProgress(storage, legacy, storage.getItem(LOCAL_KEY), NOW).status).toBe("invalid");
    // 이전에 저장된 그 자리는 버리지 않고, 읽을 때만 한 문항 수정으로 바꾼다. 저장값은 건드리지 않는다.
    const raw = setEnvelope(storage, {}, legacy, NOW - 5000);
    vi.mocked(storage.setItem).mockClear();
    vi.mocked(storage.removeItem).mockClear();
    expect(readV31LocalProgress(storage, NOW)).toEqual({ status: "ready", raw, savedAt: NOW - 5000, snapshot: { ...legacy, editing: true } });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    // 다른 선택 흐름 밖 자리와 결과 화면 자리는 그대로 다룬다.
    setEnvelope(storage, {}, { ...legacy, index: 31 });
    expect(readV31LocalProgress(storage, NOW).status).toBe("invalid");
    const result: V31LocalProgressSnapshot = { ...legacy, screen: "result" };
    setEnvelope(storage, {}, result);
    expect(readV31LocalProgress(storage, NOW)).toMatchObject({ status: "ready", snapshot: result });
  });
});

describe("v3.1 이어 하기 카드의 「답이 있다」 기준", () => {
  /** 34칸 중 한 칸(index)에만 값을 둔 진행. 칸의 위치 규칙은 getV31ResponseAt 과 독립해서 다시 적었다. */
  function onlyAt(index: number, value: V31Response | V31Choice): V31Draft {
    const draft = createV31Draft();
    const question = WEDDING_CODE_V31_QUESTIONS[index];
    const taste = WEDDING_CODE_V31_TASTES[index - WEDDING_CODE_V31_QUESTIONS.length];
    if (question) draft.answers[question.id] = value as V31Response;
    else if (taste) draft.tastes[taste.key] = value as V31Choice;
    else if (index === V31_AVOIDANCE_INDEX) draft.avoidances = value as V31Choice;
    else if (index === V31_PRIORITY_INDEX) draft.priorities = value as V31Choice;
    else draft.spending = value as V31Choice;
    return draft;
  }
  const responseValues: V31Response[] = [1, 2, 3, 4, 5, "undecided", "not_applicable", "skipped"];
  /** 우선순위의 고른 값은 다른 답에서 파생돼 한 칸만으로는 만들 수 없으므로 상태 값만 쓴다. */
  const choiceValues: V31Choice[] = [{ status: "undecided" }, { status: "not_applicable" }, { status: "skipped" }, { status: "no_preference" }, { status: "no_match" }];

  it("칸이 하나도 채워지지 않은 진행은 위치가 어디든 답이 아니다", () => {
    expect(hasV31ResumableAnswer(snapshot())).toBe(false);
    expect(hasV31ResumableAnswer({ draft: createV31Draft() })).toBe(false);
    expect(V31_FULL_INDEXES.some(index => getV31ResponseAt(createV31Draft(), index) !== undefined)).toBe(false);
  });

  it("34칸 어디든 값이 하나만 있으면 답이 있다고 본다. 별점, 모름·계획에 없음·답하지 않음, 고른 보기 모두 센다", () => {
    // 칸이 늘거나 줄면 이 숫자가 먼저 알려 준다.
    expect(V31_FULL_INDEXES).toHaveLength(WEDDING_CODE_V31_QUESTIONS.length + WEDDING_CODE_V31_TASTES.length + 3);
    let checked = 0;
    for (const index of V31_FULL_INDEXES) {
      const isQuestion = index < WEDDING_CODE_V31_QUESTIONS.length;
      const values: Array<V31Response | V31Choice> = isQuestion ? responseValues : [...choiceValues];
      const taste = WEDDING_CODE_V31_TASTES[index - WEDDING_CODE_V31_QUESTIONS.length];
      if (taste) values.push({ status: "answered", values: [taste.options[0].value] });
      if (index === V31_AVOIDANCE_INDEX) values.push({ status: "answered", values: ["loud_music"] });
      for (const value of values) {
        const draft = onlyAt(index, value);
        // 이 진행이 정말 그 한 칸만 채우는지 먼저 본다.
        expect(V31_FULL_INDEXES.filter(slot => getV31ResponseAt(draft, slot) !== undefined), `칸 ${index}: ${JSON.stringify(value)}`).toEqual([index]);
        expect(hasV31ResumableAnswer(snapshot(draft)), `칸 ${index}: ${JSON.stringify(value)}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(V31_FULL_INDEXES.length * 5);
  });

  it("결과 화면의 「답을 남긴 질문은 N개」(respondedCount)와 같은 셈이다", () => {
    const drafts: V31Draft[] = [createV31Draft(), complete()];
    const partial = createV31Draft(); partial.answers.V1 = "undecided"; partial.answers.G1 = "not_applicable"; partial.answers.G2 = "skipped";
    drafts.push(partial);
    for (const index of V31_FULL_INDEXES) drafts.push(onlyAt(index, index < WEDDING_CODE_V31_QUESTIONS.length ? 3 : { status: "skipped" }));
    for (const draft of drafts) expect(hasV31ResumableAnswer(snapshot(draft))).toBe(buildV31Profile(draft).respondedCount > 0);
  });
});
