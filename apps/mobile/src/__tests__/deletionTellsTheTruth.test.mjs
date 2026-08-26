// 되돌릴 수 없는 탈퇴 앞에서 모바일도 사실을 말하는지 본다.
//
// 예전 모바일 확인창은 "계정과 직접 소유한 데이터 삭제를 요청해요" 한 줄뿐이었다.
// **배우자 화면에 내 대화가 그대로 남는다는 것**과 **업체를 등록했으면 탈퇴가
// 완료되지 않는다는 것**을 모른 채 두 번 눌러 진행했다. 웹은 같은 자리에서
// 그 사실들을 보여주고 있었다.
//
// 문구는 지어내지 않는다 — 두 앱이 같은 공유 상수를 쓴다.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const settings = read("../../app/settings/index.tsx");
const policy = read("../../../../packages/shared/src/constants/accountDeletionPolicy.ts");

test("검사가 실제로 파일을 읽는다", () => {
  assert.ok(settings.length > 5000, "설정 화면을 못 읽었다");
  assert.ok(policy.includes("ACCOUNT_DELETION_FACTS"), "정책 상수를 못 찾았다");
});

test("사실 목록이 공유 자리에 있다", () => {
  // 웹에만 있으면 두 앱이 다른 말을 하게 된다.
  assert.match(policy, /export const ACCOUNT_DELETION_FACTS/);
  assert.match(policy, /파트너 화면에 그대로 남아요/);
  assert.match(policy, /업체가 있으면 탈퇴가 완료되지 않아요/);
});

test("모바일 확인창이 그 목록을 그대로 쓴다", () => {
  // 문장을 베껴 쓰면 한쪽만 고쳐져 갈린다. 상수를 그대로 펼쳐야 한다.
  const dialog = settings.slice(
    settings.indexOf("function handleDeleteAccount"),
    settings.indexOf("최종 확인"),
  );
  assert.ok(dialog.length > 100, "탈퇴 확인창을 못 찾았다");
  assert.match(dialog, /ACCOUNT_DELETION_FACTS\.map/);
});

test("공유 상수에서 실제로 가져온다", () => {
  assert.match(settings, /ACCOUNT_DELETION_FACTS,?\s*\n?\s*\}? from "@hanbang\/shared"|ACCOUNT_DELETION_FACTS/);
  assert.ok(
    settings.includes('from "@hanbang/shared"'),
    "공유 패키지에서 가져오지 않는다",
  );
});
