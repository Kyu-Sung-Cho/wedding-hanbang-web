import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../kstDay.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  module.exports,
  module,
  () => {
    throw new Error("unexpected dependency");
  },
);
const { todayYmdInKst, upcomingYmdInKst } = module.exports;

/** 한국 시각 YYYY-MM-DD hh:00 에 해당하는 밀리초. */
const kst = (year, month, day, hour) =>
  Date.UTC(year, month - 1, day, hour) - 9 * 60 * 60 * 1000;

// 깨져 있던 구간을 정면으로 지난다. UTC 로 읽으면 0~8시가 전부 전날이 된다.
test("한국 새벽에도 오늘은 오늘이다", () => {
  for (const hour of [0, 1, 5, 8, 9, 12, 18, 23]) {
    assert.equal(
      todayYmdInKst(kst(2026, 8, 24, hour)),
      "2026-08-24",
      `${hour}시 KST 에서 날짜가 어긋났습니다`,
    );
  }
});

test("자정 직전과 직후에 하루가 넘어간다", () => {
  assert.equal(todayYmdInKst(kst(2026, 8, 24, 23) + 59 * 60 * 1000), "2026-08-24");
  assert.equal(todayYmdInKst(kst(2026, 8, 25, 0)), "2026-08-25");
});

test("월·연 경계에서도 맞는다", () => {
  assert.equal(todayYmdInKst(kst(2026, 8, 31, 23)), "2026-08-31");
  assert.equal(todayYmdInKst(kst(2026, 9, 1, 0)), "2026-09-01");
  assert.equal(todayYmdInKst(kst(2026, 12, 31, 22)), "2026-12-31");
  assert.equal(todayYmdInKst(kst(2027, 1, 1, 1)), "2027-01-01");
});

test("한 자리 월·일에 0 을 채운다", () => {
  // "2026-9-1" 을 내보내면 문자열 비교(event.date >= today)가 조용히 틀린다.
  assert.equal(todayYmdInKst(kst(2026, 9, 1, 12)), "2026-09-01");
  assert.match(todayYmdInKst(kst(2026, 9, 1, 12)), /^\d{4}-\d{2}-\d{2}$/u);
});

test("다가오는 날짜는 오늘부터 하루씩 이어진다", () => {
  assert.deepEqual(
    upcomingYmdInKst(4, kst(2026, 8, 30, 3)),
    ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"],
  );
});

test("다가오는 날짜도 새벽에 어제부터 시작하지 않는다", () => {
  const dawn = upcomingYmdInKst(3, kst(2026, 8, 24, 2));
  assert.equal(dawn[0], "2026-08-24");
  const afternoon = upcomingYmdInKst(3, kst(2026, 8, 24, 15));
  assert.deepEqual(dawn, afternoon, "같은 날인데 시각에 따라 목록이 달라집니다");
});

test("개수가 이상하면 빈 목록", () => {
  assert.deepEqual(upcomingYmdInKst(0), []);
  assert.deepEqual(upcomingYmdInKst(-1), []);
  assert.deepEqual(upcomingYmdInKst(1.5), []);
});
