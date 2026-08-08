import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 식장 이름을 고치고 "저장하기"를 누르면 팝업이 뜬 뒤 설정 화면이 통째로
// "설정을 열지 못했어요"로 바뀌고, 입력한 값이 사라졌다.
//
// 원인은 저장 실패(409)를 화면 로드 실패로 취급한 것이다. 409에는 두 종류가 있다 —
// 화면 데이터가 낡아 정말 다시 불러와야 하는 경우와, 저장이 거부된 경우.

const testDir = dirname(fileURLToPath(import.meta.url));
const settings = readFileSync(resolve(testDir, "../../app/settings/index.tsx"), "utf8");

test("저장이 거부돼도 설정 화면과 입력을 잃지 않는다", () => {
  // 낡은 데이터일 때만 화면을 로드 오류로 바꾼다.
  assert.match(
    settings,
    /response\.status === 409 && errorCode === "SETTINGS_CHANGED"/,
  );
  // 상태 코드만 보고 화면을 날리던 옛 분기가 남아 있으면 안 된다.
  assert.doesNotMatch(settings, /if \(response\.status === 409\) setLoadError/);
});

test("서버가 준 코드를 실제로 읽는다", () => {
  assert.match(settings, /"code" in responseBody/);
});
