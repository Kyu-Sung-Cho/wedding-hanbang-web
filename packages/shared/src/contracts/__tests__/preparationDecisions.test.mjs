import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as budgetShare from "../budgetShare.mjs";

/**
 * 공동 결정 기록 계약(`preparationDecisions.ts`). 웹 준비 보드와 앱 준비 기록이 이 한 벌을 쓴다.
 *
 * 웹에서 옮기면서 zod 를 뺐다. 그래서 이 파일이 가장 먼저 지키는 것은 **행 검사가 예전 스키마보다
 * 느슨해지지 않았는가**다 — 다른 커플 행·개인 상담·자동 추출 기억·대체된 결정 하나라도 섞이면
 * 페이지 전체를 거부해야 한다. 웹의 기존 테스트(`preparationDecisionDisplay.test.ts` 등)는 같은 함수를
 * 다시 내보낸 경로로 그대로 돈다.
 *
 * `.ts`를 `node --test`에서 바로 못 읽어 소스를 옮겨 실행한다(형제 `utils/__tests__/kstDay.test.mjs`와 같다).
 */
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
function load(relative, deps = {}) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unexpected dependency: ${specifier}`);
  });
  return module.exports;
}

const source = read("../preparationDecisions.ts");
const planning = load("../../constants/weddingPlanning.ts");
const chatTimestamp = load("../../utils/chatTimestamp.ts");
const decisions = load("../preparationDecisions.ts", {
  "../constants/weddingPlanning": planning,
  "../utils/chatTimestamp": chatTimestamp,
  "./budgetShare.mjs": budgetShare,
});
const {
  DECISION_PAGE_SIZE, DECISION_SELECT_COLUMNS, DECISION_STATUSES, DECISION_TYPES,
  DECISION_SOURCE_LABELS, DECISION_SOURCE_FALLBACK, decisionSourceLabel,
  DECISION_INITIAL_ERROR, DECISION_MORE_ERROR, DECISION_PREVIOUS_VALUE_LABEL, DECISION_LATEST_VALUE_LABEL,
  DECISION_CURRENT_VALUE_NOTE, DECISION_SUMMARY_LINES, decisionEmptyText,
  parsePreparationDecisions, arrangePreparationDecisions, decisionCursorFilter,
  preparationDate, preparationDayKey,
  PREPARATION_DECISION_CATEGORIES, preparationDecisionCategory, decisionBelongsTo, filterPreparationDecisions, decisionPreview,
} = decisions;

const coupleId = "11111111-1111-4111-8111-111111111111";
const otherCouple = "22222222-2222-4222-8222-222222222222";
const uuid = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const row = (over = {}) => ({
  id: uuid(900), couple_id: coupleId, visibility: "shared", category: "venue", title: "결혼식장은 가을 예식으로 정했어요",
  reasoning: "두 사람이 직접 남긴 이유", decision_type: "decided", source: "manual",
  created_at: "2026-09-07T00:00:00.123456+00:00", superseded_at: null, memory_key: null, metadata: {}, ...over,
});
const parse = (rows, cursor = null) => parsePreparationDecisions(rows, coupleId, cursor);

// ── 행 검사 ──────────────────────────────────────────────────────────────

test("PostgREST 가 주는 마이크로초·+00:00 시각과 Z 시각을 받는다", () => {
  for (const created_at of ["2026-09-07T00:00:00.123456+00:00", "2026-09-07T00:00:00+00:00", "2026-09-07T00:00:00Z", "2026-09-07T09:00:00.5+09:00"]) {
    const { records } = parse([row({ created_at })]);
    assert.equal(records.length, 1, created_at);
    assert.equal(records[0].createdAt, created_at);
  }
});

test("여섯 가지 저장 종류를 세 갈래로 나누고 이름을 붙인다", () => {
  const expected = { exploring: ["exploring", "탐색 중"], considering: ["considering", "고려 중"], decided: ["confirmed", "결정 기록"],
    booked: ["confirmed", "예약 기록"], completed: ["confirmed", "완료 기록"], scheduled: ["confirmed", "일정 기록"] };
  assert.deepEqual([...DECISION_TYPES].sort(), Object.keys(expected).sort());
  for (const [type, [status, stateLabel]] of Object.entries(expected)) {
    assert.deepEqual((({ status: s, stateLabel: l }) => [s, l])(parse([row({ decision_type: type })]).records[0]), [status, stateLabel], type);
  }
});

test("제목은 앞뒤 공백을 걷고, 비었으면 거부하며, 이유·출처·분류가 없으면 빈 값으로 둔다", () => {
  const [record] = parse([row({ title: "  예산 정리  ", reasoning: "", source: null, category: null })]).records;
  assert.equal(record.title, "예산 정리");
  assert.equal(record.detail, null);
  assert.equal(record.source, "");
  assert.equal(record.category, "");
  for (const title of ["", "   ", "\n\t", " ", "　", null, 3]) {
    assert.throws(() => parse([row({ title })]), undefined, JSON.stringify(title));
  }
});

test("모양이 다른 행 하나라도 섞이면 페이지 전체를 거부한다", () => {
  const broken = [
    ["id 가 uuid 가 아님", { id: "not-a-uuid" }],
    ["id 가 전부 0", { id: "00000000-0000-0000-0000-000000000000" }],
    ["id 변형 자리가 틀림", { id: "33333333-3333-4333-c333-333333333333" }],
    ["couple_id 가 uuid 가 아님", { couple_id: "couple-a" }],
    ["개인 상담(bride_private)", { visibility: "bride_private" }],
    ["개인 상담(groom_private)", { visibility: "groom_private" }],
    ["공개 범위 없음", { visibility: undefined }],
    ["대체된 결정", { superseded_at: "2026-09-08T00:00:00Z" }],
    ["대체 여부 없음", { superseded_at: undefined }],
    ["자동 기억 키", { memory_key: "personal_preference" }],
    ["기억 키 없음", { memory_key: undefined }],
    ["모르는 저장 종류", { decision_type: "guessed" }],
    ["저장 종류 없음", { decision_type: null }],
    ["시간대 없는 시각", { created_at: "2026-09-07T00:00:00" }],
    ["초 없는 시각", { created_at: "2026-09-07T00:00Z" }],
    ["없는 날짜", { created_at: "2026-02-30T00:00:00Z" }],
    ["24시", { created_at: "2026-09-07T24:00:00Z" }],
    ["공백 구분 시각", { created_at: "2026-09-07 00:00:00+00:00" }],
    ["시간대 분 없음", { created_at: "2026-09-07T00:00:00+09" }],
    ["메타데이터 배열", { metadata: [] }],
    ["메타데이터 없음", { metadata: undefined }],
    ["이유 없음", { reasoning: undefined }],
    ["분류 숫자", { category: 3 }],
    ["출처 없음", { source: undefined }],
  ];
  for (const [name, change] of broken) {
    const value = { ...row(), ...change };
    for (const [key, item] of Object.entries(change)) if (item === undefined) delete value[key];
    assert.throws(() => parse([row({ id: uuid(901) }), value]), undefined, name);
  }
  assert.throws(() => parse({}), undefined, "배열이 아님");
  assert.throws(() => parse(null), undefined, "null");
  assert.throws(() => parse(["row"]), undefined, "행이 객체가 아님");
  assert.throws(() => parse([[]]), undefined, "행이 배열");
});

test("다른 커플 행·자동 추출 기억·같은 id 두 번은 범위 오류로 거부한다", () => {
  assert.throws(() => parse([row({ couple_id: otherCouple })]), /DECISION_SCOPE_MISMATCH/);
  assert.throws(() => parse([row({ metadata: { extracted_by: "ai" } })]), /DECISION_SCOPE_MISMATCH/);
  assert.throws(() => parse([row(), row()]), /DECISION_SCOPE_MISMATCH/);
  // DB 조회 조건(`metadata->>extracted_by is null`)이 JSON null 도 돌려주므로 값이 null 이면 받는다(웹과 같다).
  assert.equal(parse([row({ metadata: { extracted_by: null } })]).records.length, 1);
});

test("페이지는 최신순이어야 하고, 커서보다 앞선 행이나 같은 행을 다시 받으면 거부한다", () => {
  const first = row({ id: uuid(910), created_at: "2026-09-07T00:00:00.123900Z" });
  const second = row({ id: uuid(909), created_at: "2026-09-07T00:00:00.123900Z" });
  assert.equal(parse([first, second]).records.length, 2);
  assert.throws(() => parse([second, first]), /DECISION_PAGE_ORDER/, "같은 시각이면 id 내림차순");
  assert.throws(() => parse([row({ id: uuid(1), created_at: "2026-09-06T00:00:00Z" }), row({ id: uuid(2), created_at: "2026-09-07T00:00:00Z" })]), /DECISION_PAGE_ORDER/);
  const cursor = { id: uuid(909), createdAt: "2026-09-07T00:00:00.123900Z" };
  assert.throws(() => parse([second], cursor), /DECISION_PAGE_ORDER/, "커서 행을 다시 받음");
  assert.throws(() => parse([row({ id: uuid(100), created_at: "2026-09-07T00:00:00.123901Z" })], cursor), /DECISION_PAGE_ORDER/, "마이크로초 하나라도 새것");
  assert.equal(parse([row({ id: uuid(908), created_at: "2026-09-07T00:00:00.123900Z" })], cursor).records.length, 1);
});

test("31행까지 읽고 30행만 보여 주며 마지막 보인 행이 다음 커서다. 32행은 거부한다", () => {
  const rows = Array.from({ length: DECISION_PAGE_SIZE + 1 }, (_, index) => row({ id: uuid(1000 - index) }));
  const page = parse(rows);
  assert.equal(DECISION_PAGE_SIZE, 30);
  assert.equal(page.records.length, 30);
  assert.deepEqual(page.nextCursor, { id: uuid(971), createdAt: rows[29].created_at });
  assert.equal(parse(rows.slice(0, 30)).nextCursor, null);
  assert.throws(() => parse([...rows, row({ id: uuid(1) })]));
});

test("커서 조건은 검사한 uuid·시각으로만 만든다", () => {
  const cursor = { id: uuid(909), createdAt: "2026-09-07T00:00:00.123456+00:00" };
  assert.equal(decisionCursorFilter(cursor),
    "created_at.lt.2026-09-07T00:00:00.123456+00:00,and(created_at.eq.2026-09-07T00:00:00.123456+00:00,id.lt.33333333-3333-4333-8333-000000000909)");
  for (const bad of [
    { id: "x),id.gt.(0", createdAt: cursor.createdAt }, { id: `${cursor.id},or`, createdAt: cursor.createdAt }, { id: 7, createdAt: cursor.createdAt },
    { id: cursor.id, createdAt: "2026-09-07" }, { id: cursor.id, createdAt: "2026-09-07T00:00:00Z,id.gt.0" }, { id: cursor.id, createdAt: null },
  ]) assert.throws(() => decisionCursorFilter(bad), /DECISION_CURSOR_INVALID/, JSON.stringify(bad));
});

test("읽는 열은 한 곳에 있고 표시 계산에 필요한 저장값까지 담는다", () => {
  assert.deepEqual(DECISION_SELECT_COLUMNS.split(",").map((column) => column.trim()), [
    "id", "couple_id", "visibility", "category", "title", "reasoning", "decision_type", "source",
    "created_at", "superseded_at", "memory_key", "metadata", "chosen_value",
  ]);
});

// ── 한국 날짜 ─────────────────────────────────────────────────────────────

test("날짜는 +9시간 고정 오프셋으로 만든다: 15:30Z 는 다음 날 9. 11. 이다", () => {
  assert.equal(preparationDayKey("2026-09-10T15:30:00Z"), "2026-09-11");
  assert.equal(preparationDate("2026-09-10T15:30:00Z"), "9. 11.");
  assert.equal(preparationDate("2026-09-10T14:59:59.999999+00:00"), "9. 10.");
  assert.equal(preparationDate("2026-12-31T15:00:00Z"), "1. 1.");
  assert.equal(preparationDayKey("2026-12-31T15:00:00Z"), "2027-01-01");
  assert.equal(preparationDate("날짜 아님"), null);
  assert.equal(preparationDayKey("날짜 아님"), "");
});

test("날짜 표기는 웹이 쓰던 Intl ko-KR·Asia/Seoul 출력과 바이트까지 같다", () => {
  const label = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
  const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });
  // 2026~2027 두 해를 5시간 17분 간격으로 훑는다(자정 전후가 여러 번 걸린다).
  for (let time = Date.UTC(2026, 0, 1); time < Date.UTC(2028, 0, 1); time += (5 * 60 + 17) * 60 * 1000) {
    const iso = new Date(time).toISOString();
    assert.equal(preparationDate(iso), label.format(new Date(time)), iso);
    assert.equal(preparationDayKey(iso), key.format(new Date(time)), iso);
  }
});

// ── 이전 값·체크 저장 접기 ─────────────────────────────────────────────────

const dress = (id, created_at, before, after) => {
  const title = `드레스·예식 정장 예산 ${after.toLocaleString("en-US")}원 반영`;
  return row({ id, created_at, category: "budget", source: "budget", decision_type: "decided", title, reasoning: "승인한 구성원의 예산 배정 변경",
    metadata: { origin: "amora_shared_budget_action" },
    chosen_value: { schemaVersion: 1, budgetScope: "category", value: title, categoryKey: "dress", amount: after,
      budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [{ key: "dress", label: "드레스·예식 정장", beforeBudget: before, afterBudget: after }] } } });
};
const routine = (id, created_at, patch) => row({ id, created_at, category: "plan", source: "manual", decision_type: "decided",
  title: `진행 상황: ${Object.keys(patch).length}개 수정`, reasoning: null, metadata: { origin: "couple_plan_change_request" },
  chosen_value: { schemaVersion: 1, changes: { progress_patch: patch, progress_remove_keys: [] } } });

test("드레스 예산 400 → 450 → 400 은 가장 새 기록만 마지막 기록이고 앞 둘은 이전 값이다", () => {
  const { records } = parse([
    dress(uuid(3), "2026-09-12T03:00:00Z", 4500000, 4000000),
    dress(uuid(2), "2026-09-12T02:00:00Z", 4000000, 4500000),
    dress(uuid(1), "2026-09-12T01:00:00Z", null, 4000000),
  ]);
  const { decisions: arranged } = arrangePreparationDecisions(records);
  assert.deepEqual(arranged.map((item) => [item.displayTitle, item.valueState]), [
    ["드레스·예식 정장 예산 450만원 → 400만원", "latest"],
    ["드레스·예식 정장 예산 400만원 → 450만원", "previous"],
    ["드레스·예식 정장 예산 미정 → 400만원", "previous"],
  ]);
  assert.deepEqual(records[0].relatedCategories, ["dress"]);
  assert.deepEqual(records[0].valueSlots, ["budget:dress"]);
});

test("체크 저장은 결정 개수에서 빼고 한국 날짜별로 접는다. '안 해요'는 분야 이름을 붙여 결정으로 남긴다", () => {
  const { records } = parse([
    routine(uuid(9), "2026-09-13T15:30:00Z", { dress: { category: "dress", status: "in_progress" } }),
    routine(uuid(8), "2026-09-13T01:00:00Z", { dress: { category: "dress", status: "in_progress" }, venue: { category: "venue", status: "completed" } }),
    routine(uuid(7), "2026-09-12T20:00:00Z", { pyebaek: { category: "pyebaek", status: "not_applicable" } }),
    routine(uuid(6), "2026-09-12T14:59:00Z", { makeup: { category: "makeup", checklist: [{ id: "a", done: true }] } }),
  ]);
  const { decisions: arranged, routineDays, routineCount } = arrangePreparationDecisions(records);
  assert.deepEqual(arranged.map((item) => [item.id, item.displayTitle]), [[uuid(7), "결혼식 뒤 전통 인사: '안 해요'로 표시"]]);
  assert.equal(routineCount, 3);
  assert.deepEqual(routineDays, [
    { key: "2026-09-14", label: "9. 14.", records: 1, changes: 1 },
    { key: "2026-09-13", label: "9. 13.", records: 1, changes: 2 },
    { key: "2026-09-12", label: "9. 12.", records: 1, changes: 1 },
  ]);
});

// ── 분야 ─────────────────────────────────────────────────────────────────

test("분야 목적지는 경로 없이 종류만 준다. 준비 계획·일반 준비·모르는 분류에는 목적지가 없다", () => {
  assert.deepEqual(preparationDecisionCategory("venue"), { key: "venue", label: planning.PLANNING_CATEGORY_LABELS.venue,
    destination: { kind: "checklist", category: "venue", label: "분야 체크리스트 보기" } });
  assert.deepEqual(preparationDecisionCategory("budget")?.destination, { kind: "budget", label: "예산 보기" });
  assert.deepEqual(preparationDecisionCategory("schedule")?.destination, { kind: "schedule", label: "일정 보기" });
  assert.equal(preparationDecisionCategory("plan")?.destination, null);
  assert.equal(preparationDecisionCategory("general")?.destination, null);
  for (const key of ["conflict_resolution", "vendor", "booking", "", null, undefined, "__proto__", "BUDGET", "budget "]) {
    assert.equal(preparationDecisionCategory(key), undefined, String(key));
  }
  assert.deepEqual(PREPARATION_DECISION_CATEGORIES.slice(0, planning.CATEGORY_CHECKLISTS.length).map((item) => item.key),
    planning.CATEGORY_CHECKLISTS.map((item) => item.key));
  for (const item of PREPARATION_DECISION_CATEGORIES) {
    assert.ok(!item.destination || ["checklist", "budget", "schedule"].includes(item.destination.kind), item.key);
    assert.doesNotMatch(JSON.stringify(item), /href|\/wedding|bookings|vendors/u, item.key);
  }
});

test("예산 결정은 저장 분류 말고도 예산과 해당 분야에 속한다. 분야 미정은 알려진 분야가 아닌 기록이다", () => {
  const records = [
    { id: "a", category: "budget", relatedCategories: ["dress"], title: "드레스 예산", detail: null, status: "confirmed" },
    { id: "b", category: "plan", relatedCategories: ["budget", "venue"], title: "결혼식장 예산: 1,300만원", detail: null, status: "confirmed" },
    { id: "c", category: "conflict_resolution", title: "주말마다 한 시간 이야기하기", detail: "서로 바쁠 때", status: "considering" },
    { id: "d", category: "", title: "분류 없는 옛 기록", detail: null, status: "exploring", displayTitle: "다시 적은 제목" },
  ];
  assert.ok(decisionBelongsTo(records[0], "budget") && decisionBelongsTo(records[0], "dress"));
  assert.ok(decisionBelongsTo(records[1], "budget") && decisionBelongsTo(records[1], "venue") && decisionBelongsTo(records[1], "plan"));
  assert.ok(!decisionBelongsTo(records[1], "dress"));
  const ids = (category, query = "") => filterPreparationDecisions(records, category, query).map((item) => item.id);
  assert.deepEqual(ids("all"), ["a", "b", "c", "d"]);
  assert.deepEqual(ids("budget"), ["a", "b"]);
  assert.deepEqual(ids("venue"), ["b"]);
  assert.deepEqual(ids("unsorted"), ["c", "d"]);
  assert.deepEqual(ids("all", "  서로 "), ["c"], "설명에서 찾는다");
  assert.deepEqual(ids("all", "다시 적은"), ["d"], "다시 적은 제목에서 찾는다");
  assert.deepEqual(ids("all", planning.PLANNING_CATEGORY_LABELS.dress), ["a"], "관련 분야 이름으로 찾는다");
  assert.deepEqual(ids("unsorted", "옛"), ["d"]);
});

test("긴 글은 자르되 두 칸짜리 글자를 반으로 가르지 않는다", () => {
  assert.equal(decisionPreview("가나다", 3), "가나다");
  assert.equal(decisionPreview("가나다라", 3), "가나다…");
  const emoji = `${"가".repeat(179)}😀끝`;
  const cut = decisionPreview(emoji, 180);
  assert.equal(cut, `${"가".repeat(179)}…`);
  assert.ok(![...cut].some((char) => /[\uD800-\uDFFF]/u.test(char)), "외톨이 서로게이트가 없다");
});

// ── 두 화면이 같이 쓰는 문구 ─────────────────────────────────────────────

test("상태 이름과 규칙 문장은 웹 보드가 보여 주던 그대로다", () => {
  assert.deepEqual(DECISION_STATUSES.map((item) => [item.status, item.label, item.rule]), [
    ["confirmed", "확정", "결정·예약·완료와 일정 변경 이력이에요. 현재 일정 상태는 일정에서 확인해 주세요."],
    ["considering", "논의 중", "고려 중으로 저장된 기록이에요. 합의나 반영 완료를 뜻하지 않아요."],
    ["exploring", "미정", "탐색 중으로 저장된 기록이에요. 아직 결정하지 않았어요."],
  ]);
  for (const item of DECISION_STATUSES) assert.deepEqual(Object.keys(item), ["status", "label", "rule"], "색 클래스는 화면이 둔다");
});

test("출처 이름·오류·이전 값·요약·빈 상태 문구", () => {
  assert.deepEqual(DECISION_SOURCE_LABELS, { chat: "대화에서 남긴 기록", budget: "예산에서 남긴 기록", schedule: "일정에서 남긴 기록", manual: "직접 남긴 기록" });
  assert.equal(DECISION_SOURCE_FALLBACK, "공동 결정 기록");
  assert.equal(decisionSourceLabel("budget"), "예산에서 남긴 기록");
  for (const unknown of ["", "vendor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(decisionSourceLabel(unknown), "공동 결정 기록", unknown);
  assert.equal(DECISION_INITIAL_ERROR, "결정 기록을 확인하지 못했어요. 커플 연결을 확인한 뒤 다시 불러와 주세요.");
  assert.equal(DECISION_MORE_ERROR, "이전 결정을 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.equal(DECISION_PREVIOUS_VALUE_LABEL, "이전 값");
  assert.equal(DECISION_LATEST_VALUE_LABEL, "마지막 기록");
  assert.equal(DECISION_CURRENT_VALUE_NOTE, "지금 값은 예산 화면에서 확인해 주세요.");
  assert.deepEqual([...DECISION_SUMMARY_LINES], [
    "함께 준비하며 남긴 기록을, 저장 당시의 구분으로 모았어요.",
    "일정 취소·복원 이력도 포함되며, 두 사람이 모두 확인했다는 뜻은 아니에요.",
  ]);
  assert.equal(decisionEmptyText({ filtered: false, hasMore: false }), "이 상태로 저장된 결정이 없어요.");
  assert.equal(decisionEmptyText({ filtered: true, hasMore: false }), "이 조건에 맞는 결정이 없어요.");
  assert.equal(decisionEmptyText({ filtered: false, hasMore: true }), "불러온 기록에는 이 상태로 저장된 결정이 없어요. 아래에서 이전 결정을 더 불러올 수 있어요.");
  assert.equal(decisionEmptyText({ filtered: true, hasMore: true }), "불러온 기록에는 이 조건에 맞는 결정이 없어요. 아래에서 이전 결정을 더 불러올 수 있어요.");
});

test("공용 모듈은 앱 코드·zod·웹 경로·Tailwind 클래스·Intl 시간대를 가져오지 않는다", () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["../constants/weddingPlanning", "../utils/chatTimestamp", "./budgetShare.mjs"]);
  assert.doesNotMatch(code, /zod|weddingPath|\/wedding\/|bg-\[|var\(--|timeZone|Intl\./u);
});
