// 상담 요청 기록 — 새 요청을 받는 것처럼 보이지 않게.
//
// 업체 상담·예약 요청은 2026-07-15부터 꺼져 있다(파운더 결정; 웹 `BETA_DISABLED_TOOL_NAMES`에
// `create_booking`이 묶여 있고, 앱에는 요청을 만드는 화면이 처음부터 없다). 그런데 라운지의
// 준비 도구 격자는 모든 사람에게 「상담 요청 기록 · 아모라 내부 후보」 타일을 보여줬고,
// 그 화면의 빈 상태는 "업체 상세에서 상담 날짜와 상품 후보를 고르면 … 여기에 모여요"라고
// 적어 두었다. 앱 어디에도 그렇게 고를 곳이 없다 — 따라가면 막다른 길이다.
//
// 파운더 결정(2026-09-18): 숨긴다. 이미 남긴 기록이 있는 사람에게만 **지난 기록을 보는**
// 중립 입구를 남긴다. 화면·데이터는 지우지 않는다.
//
// 이 파일이 지키는 것:
//   1) 기록이 없거나 확인하지 못했으면 라운지에 타일이 없다.
//   2) 기록이 있으면 타일이 있고, 그 말은 새 요청을 권하지 않는다.
//   3) 라운지는 취소 표시까지 포함한 **아무 기록 하나**로 판정하고, 실패하면 숨긴다.
//   4) 기록 화면의 빈 상태가 새 요청을 권하지 않는다.
//   5) 불러오지 못했으면 빈 상태 대신 다시 시도를 보인다 — 실패를 "기록이 없어요"로 말하지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import { buildHomeServices, HOME_SERVICES } from "../lib/dashboardExperience.mjs";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function compileCommonJs(relativePath) {
  const result = ts.transpileModule(readSource(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(module.exports, module, (name) => {
    throw new Error(`unexpected dependency: ${name}`);
  });
  return module.exports;
}

const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const homeSource = readSource("../components/dashboard/WeddingHomeExperience.tsx");
const bookingsSource = readSource("../../app/bookings/index.tsx");
const { BOOKING_RECORDS_EMPTY_STATE } = compileCommonJs("../lib/bookingRecordsEntry.ts");

/** 새 요청을 만들 수 있다고 읽히는 말. */
const INVITES_NEW_REQUEST = /후보|고르면|요청하기|예약하기|요청해 ?보|남겨 ?보세요|탐색하기|업체 상세에서/;

/* ─────────────────────────────────────────────
   (1)(2) 라운지 타일
   ───────────────────────────────────────────── */

test("without past records the lounge has no request-record tile", () => {
  for (const input of [{ hasBookingRecords: false }, { hasBookingRecords: undefined }, {}, undefined]) {
    const routes = buildHomeServices(input).map((service) => service.route);
    assert.ok(!routes.includes("/bookings"), `${JSON.stringify(input)} 에도 타일이 보인다`);
    // 나머지 도구는 그대로다.
    assert.deepEqual(routes, HOME_SERVICES.filter((service) => service.key !== "bookings").map((service) => service.route));
  }
  // "true 비슷한 값"을 기록 있음으로 읽지 않는다.
  assert.ok(!buildHomeServices({ hasBookingRecords: "true" }).some((service) => service.key === "bookings"));
});

test("with past records the tile stays, and only offers to look back", () => {
  const services = buildHomeServices({ hasBookingRecords: true });
  const bookings = services.find((service) => service.key === "bookings");
  assert.ok(bookings, "기록이 있는 사람이 지난 기록으로 갈 길이 없다");
  assert.equal(bookings.route, "/bookings");
  assert.equal(bookings.description, "지난 기록 보기");
  assert.doesNotMatch(`${bookings.title} ${bookings.description}`, INVITES_NEW_REQUEST);
  // 정본 목록에도 예전 문구("아모라 내부 후보")가 남지 않는다.
  assert.doesNotMatch(JSON.stringify(HOME_SERVICES), INVITES_NEW_REQUEST);
});

test("the lounge grid is built from the record check, not the static catalog", () => {
  assert.match(homeSource, /buildHomeServices\(\{\s*hasBookingRecords: data\??\.hasBookingRecords === true,?\s*\}\)/);
  assert.doesNotMatch(homeSource, /HOME_SERVICES\.map/);
  assert.match(loungeSource, /hasBookingRecords,/);
});

/* ─────────────────────────────────────────────
   (3) 라운지의 기록 확인
   ───────────────────────────────────────────── */

function extractFunction(source, name) {
  const tree = ts.createSourceFile("lounge.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(tree);
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, `${name} 가 없다`);
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

function fakeSupabase(result) {
  const calls = [];
  const builder = {
    select(columns) { calls.push(["select", columns]); return builder; },
    eq(column, value) { calls.push(["eq", column, value]); return builder; },
    neq(column, value) { calls.push(["neq", column, value]); return builder; },
    or(filter) { calls.push(["or", filter]); return builder; },
    limit(count) {
      calls.push(["limit", count]);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    client: { from(table) { calls.push(["from", table]); return builder; } },
  };
}

async function runHasBookingRecords(result) {
  const fake = fakeSupabase(result);
  const code = extractFunction(loungeSource, "loadHasBookingRecords");
  const fn = new Function("bindings", `with (bindings) { ${code}; return loadHasBookingRecords; }`)({ supabase: fake.client });
  const value = await fn("couple-1");
  return { value, calls: fake.calls };
}

test("any record of this couple — cancelled ones included — keeps the entry", async () => {
  const { value, calls } = await runHasBookingRecords({ data: [{ id: "b1" }], error: null });
  assert.equal(value, true);
  assert.deepEqual(calls, [
    ["from", "vendor_bookings"],
    ["select", "id"],
    ["eq", "couple_id", "couple-1"],
    ["limit", 1],
  ], "상태로 거르면 취소 표시만 남은 사람이 자기 기록으로 가는 길을 잃는다");
});

test("no records, a failed read or a thrown read all hide the entry", async () => {
  assert.equal((await runHasBookingRecords({ data: [], error: null })).value, false);
  assert.equal((await runHasBookingRecords({ data: null, error: null })).value, false);
  assert.equal((await runHasBookingRecords({ data: [{ id: "b1" }], error: { message: "rls" } })).value, false);
  assert.equal((await runHasBookingRecords(new Error("offline"))).value, false);
});

/* ─────────────────────────────────────────────
   (4) 기록 화면의 빈 상태
   ───────────────────────────────────────────── */

test("the empty record screen says new requests are closed and points only at past records", () => {
  assert.equal(BOOKING_RECORDS_EMPTY_STATE.title, "예약 요청 기록이 없어요");
  assert.match(BOOKING_RECORDS_EMPTY_STATE.description, /새 상담 요청은 지금 남길 수 없어요/);
  assert.match(BOOKING_RECORDS_EMPTY_STATE.description, /예전에 남긴 요청 기록/);
  assert.doesNotMatch(BOOKING_RECORDS_EMPTY_STATE.description, INVITES_NEW_REQUEST);
  // 다음 행동은 읽을거리(공시가·위약금)이지, 요청할 업체를 찾으러 가는 길이 아니다.
  assert.doesNotMatch(BOOKING_RECORDS_EMPTY_STATE.actionLabel, INVITES_NEW_REQUEST);
});

test("the record screen uses that copy and drops the dead-end sentence", () => {
  assert.doesNotMatch(bookingsSource, /업체 상세에서 상담 날짜와 상품 후보를 고르면/);
  assert.doesNotMatch(bookingsSource, /업체 탐색하기/);
  assert.match(bookingsSource, /BOOKING_RECORDS_EMPTY_STATE\.description/);
  assert.match(bookingsSource, /BOOKING_RECORDS_EMPTY_STATE\.actionLabel/);
  // 화면과 데이터는 지우지 않는다 — 지난 기록 목록·결과 기록은 그대로다.
  assert.match(bookingsSource, /\.from\("vendor_bookings"\)/);
  assert.match(bookingsSource, /\/api\/bookings\/\$\{booking\.id\}\/outcome/);
});

/* ─────────────────────────────────────────────
   (5) 불러오지 못한 것을 "기록이 없어요"라고 말하지 않는다
   ───────────────────────────────────────────── */
//
// 기록 화면은 불러오기가 실패해도 console.error 만 남기고 목록을 빈 채로 두었다. 그러면
// 위 빈 상태 — "예약 요청 기록이 없어요" — 가 떴다. 라운지 타일은 기록이 **있다고 확인된**
// 사람에게만 보이므로, 타일로 들어온 사람에게 그 빈 상태는 거의 언제나 실패였고, 기록이 있는
// 사람에게 기록이 없다고 말했다.

const { resolveBookingRecordsBody, BOOKING_RECORDS_LOAD_ERROR_MESSAGE } = compileCommonJs("../lib/bookingRecordsEntry.ts");

test("the empty state appears only after a load that succeeded with zero records", () => {
  assert.equal(resolveBookingRecordsBody({ loadError: false, totalCount: 0, visibleCount: 0 }), "empty");
  // 불러오지 못했으면 빈 상태가 아니라 오류와 다시 시도다.
  assert.equal(resolveBookingRecordsBody({ loadError: true, totalCount: 0, visibleCount: 0 }), "load-error");
  // 새로고침만 실패했으면 이미 받은 기록은 그대로 보여준다 — 참인 기록을 치우지 않는다.
  assert.equal(resolveBookingRecordsBody({ loadError: true, totalCount: 2, visibleCount: 2 }), "list");
  assert.equal(resolveBookingRecordsBody({ loadError: true, totalCount: 2, visibleCount: 0 }), "filtered-empty");
  assert.equal(resolveBookingRecordsBody({ loadError: false, totalCount: 3, visibleCount: 0 }), "filtered-empty");
  assert.equal(resolveBookingRecordsBody({ loadError: false, totalCount: 3, visibleCount: 1 }), "list");

  // 오류 문구는 "없다"고 말하지 않고, 불러오지 못했다고만 말한다.
  assert.match(BOOKING_RECORDS_LOAD_ERROR_MESSAGE, /불러오지 못했어요/);
  assert.doesNotMatch(BOOKING_RECORDS_LOAD_ERROR_MESSAGE, /없어요|없습니다/);
});

function extractUseCallback(source, name) {
  const tree = ts.createSourceFile("bookings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") {
      found = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, `${name} 가 없다`);
  return ts.transpileModule(`const ${name} = ${found};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";

/**
 * 기록 화면의 loadData 를 그대로 꺼내 돌린다(신원 울타리·정리 함수도 화면의 것 그대로).
 * `results` 는 부를 때마다 하나씩 꺼내 쓰는 { profile, bookings } 목록이다.
 */
async function runBookingsLoads(results) {
  const { createOwnerCoupleSessionFence } = await import("../lib/ownerCoupleSessionFence.mjs");
  const state = { bookings: [], loadError: undefined, loading: true };
  let current;
  const settle = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const bindings = {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: OWNER } } } }) },
      from(table) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => {
            assert.equal(table, "profiles");
            return settle(current.profile);
          },
          order: () => {
            assert.equal(table, "vendor_bookings");
            return settle(current.bookings);
          },
        };
        return builder;
      },
    },
    sessionFenceRef: createOwnerCoupleSessionFence(),
    loadSequenceRef: { current: 0 },
    openedBookingIdRef: { current: null },
    setSessionOwnerId: () => {},
    setCoupleId: () => {},
    setTab: () => {},
    setSelectedBooking: () => {},
    setBookings: (next) => {
      state.bookings = typeof next === "function" ? next(state.bookings) : next;
    },
    setLoadError: (next) => {
      state.loadError = typeof next === "function" ? next(state.loadError) : next;
    },
    setLoading: (next) => {
      state.loading = next;
    },
    setRefreshing: () => {},
    normalizeStatus: (value) => value,
    readAmount: (value) => (typeof value === "number" ? value : null),
    console: { error: () => {}, warn: () => {}, log: () => {} },
  };
  const body = ["clearIdentityBoundState", "isOwnerCurrent", "isLoadCommitCurrent", "loadData"]
    .map((name) => extractUseCallback(bookingsSource, name))
    .join("\n");
  const loadData = new Function("bindings", `with (bindings) { ${body} return loadData; }`)(bindings);

  const seen = [];
  for (const result of results) {
    current = result;
    await loadData();
    seen.push({
      loading: state.loading,
      body: resolveBookingRecordsBody({
        loadError: state.loadError === true,
        totalCount: state.bookings.length,
        visibleCount: state.bookings.length,
      }),
    });
  }
  return seen;
}

const PROFILE_OK = { data: { couple_id: COUPLE }, error: null };
const ONE_RECORD = { data: [{ id: "b1", booking_date: "2026-05-01", status: "completed" }], error: null };

test("a failed record load shows the error, not 'no records'", async () => {
  // 목록 질의가 오류를 돌려줘도, 던져도, 프로필 읽기가 실패해도 — 모두 "불러오지 못했어요"다.
  for (const [label, result] of [
    ["returned error", { profile: PROFILE_OK, bookings: { data: null, error: { message: "timeout" } } }],
    ["thrown", { profile: PROFILE_OK, bookings: new Error("offline") }],
    ["profile read failed", { profile: { data: null, error: { message: "timeout" } }, bookings: ONE_RECORD }],
  ]) {
    const [seen] = await runBookingsLoads([result]);
    assert.deepEqual(seen, { loading: false, body: "load-error" }, label);
  }
});

test("a successful load with zero rows is the empty state, and a retry clears the error", async () => {
  const [empty] = await runBookingsLoads([{ profile: PROFILE_OK, bookings: { data: [], error: null } }]);
  assert.deepEqual(empty, { loading: false, body: "empty" });

  const seen = await runBookingsLoads([
    { profile: PROFILE_OK, bookings: new Error("offline") },
    // 다시 시도가 성공했고 정말 비어 있다 → 이제야 빈 상태다.
    { profile: PROFILE_OK, bookings: { data: [], error: null } },
    { profile: PROFILE_OK, bookings: new Error("offline again") },
    { profile: PROFILE_OK, bookings: ONE_RECORD },
    { profile: PROFILE_OK, bookings: new Error("offline once more") },
    // 커플이 풀려 신원이 바뀌면 지난 실패도 같이 비운다 — 기록이 없는 것은 사실이다.
    { profile: { data: { couple_id: null }, error: null }, bookings: ONE_RECORD },
  ]);
  assert.deepEqual(seen.map((entry) => entry.body), [
    "load-error",
    "empty",
    "load-error",
    "list",
    // 새로고침만 실패했으면 이미 받은 기록은 그대로다.
    "list",
    "empty",
  ]);
});

test("the record screen renders the error with a retry, and the empty copy only for 'empty'", () => {
  assert.match(bookingsSource, /import ErrorRetry from "@\/components\/ErrorRetry";/);
  assert.match(bookingsSource, /resolveBookingRecordsBody\(\{/);
  assert.match(
    bookingsSource,
    /recordsBody === "load-error" \? \(\s*<ErrorRetry\s+message=\{BOOKING_RECORDS_LOAD_ERROR_MESSAGE\}\s+onRetry=\{/,
  );
  // 빈 상태 문구는 "empty"일 때만 — 목록 길이만 보고 고르지 않는다.
  assert.match(bookingsSource, /recordsBody === "empty"\s*\?\s*BOOKING_RECORDS_EMPTY_STATE\.title/);
  assert.doesNotMatch(bookingsSource, /bookings\.length === 0 \? BOOKING_RECORDS_EMPTY_STATE/);
});
