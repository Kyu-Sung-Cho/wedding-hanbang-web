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
