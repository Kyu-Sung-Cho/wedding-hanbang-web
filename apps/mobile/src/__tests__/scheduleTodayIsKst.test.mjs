import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const scheduleScreen = readFileSync(
  fileURLToPath(new URL("../../app/schedule/index.tsx", import.meta.url)),
  "utf8",
);

/**
 * 일정 화면의 "오늘"이 한국 기준인가.
 *
 * `toISOString()` 은 폰에서도 UTC 다. 한국은 UTC+9 라 **새벽 00:00~09:00 동안 어제**가
 * 된다. 이 화면에서는 그게 표시 문제로 끝나지 않았다 — 일정 추가 폼의 기본 날짜가
 * 그 값이라 **어제 날짜로 일정이 저장됐다.**
 */

test("일정 추가 폼의 기본 날짜가 한국 기준이다", () => {
  // 저장되는 값이다. 화면 표시보다 무겁다.
  assert.match(scheduleScreen, /const today = todayYmdInKst\(\);/u);
  assert.doesNotMatch(
    scheduleScreen,
    /const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/u,
    "UTC 로 읽는 옛 코드가 되살아났습니다",
  );
});

test("다가오는 날짜 목록이 어제부터 시작하지 않는다", () => {
  assert.match(scheduleScreen, /return upcomingYmdInKst\(n\);/u);
  // setDate + toISOString 조합이 되살아나면 잡는다.
  assert.doesNotMatch(scheduleScreen, /days\.push\(d\.toISOString\(\)/u);
});

test("공유 도우미를 실제로 불러온다", () => {
  // 화면이 도우미를 import 하지 않으면 위 검사는 문자열만 보고 통과할 수 있다.
  assert.match(scheduleScreen, /todayYmdInKst,/u);
  assert.match(scheduleScreen, /upcomingYmdInKst,/u);
  assert.match(scheduleScreen, /from "@hanbang\/shared\/utils";/u);
});
