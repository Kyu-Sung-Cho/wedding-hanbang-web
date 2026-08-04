import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const detail = readFileSync(
  resolve(appRoot, "app/community/post/[id].tsx"),
  "utf8",
);
const sheet = readFileSync(
  resolve(appRoot, "src/components/community/CommunitySafetySheet.tsx"),
  "utf8",
);
const blockedUsers = readFileSync(
  resolve(appRoot, "app/community/blocked-users.tsx"),
  "utf8",
);
const profile = readFileSync(
  resolve(appRoot, "app/(tabs)/profile.tsx"),
  "utf8",
);

test("post and answer safety menus keep block and report as separate actions", () => {
  assert.match(detail, /kind: "post"/);
  assert.match(detail, /kind: "comment"/);
  assert.match(detail, /\/api\/community\/posts\/\$\{target\.contentId\}\/report/);
  assert.match(detail, /\/api\/community\/comments\/\$\{target\.contentId\}\/report/);
  assert.match(detail, /"\/api\/community\/blocks"/);
  assert.match(detail, /body\.blocked_user_id\?\.toLowerCase\(\) !== target\.userId\.toLowerCase\(\)/);
  assert.match(detail, /body\.blocked !== true/);
  assert.match(detail, /typeof body\.changed !== "boolean"/);
  assert.match(detail, /clearCommunityCaches\(\)/);
  assert.match(detail, /setComments\(\(current\) => current\.filter/);

  assert.match(sheet, /차단은 내 보기·연락 설정이고, 신고는 운영 검토 요청이에요/);
  assert.match(sheet, /로그아웃한 공개 주소에서 계속 보일 수 있어요/);
  assert.match(sheet, /차단과 별도로 신고/);
  assert.match(sheet, /상대에게 차단[\s\S]*알림/);
});

test("the private block list is reachable from My and unblocks through explicit intent", () => {
  assert.match(profile, /label="차단 관리"/);
  assert.match(profile, /\/community\/blocked-users/);
  assert.match(blockedUsers, /apiFetchForExpectedUser\([\s\S]*"\/api\/community\/blocks"/);
  assert.match(blockedUsers, /blocked_user_id: blockedUserId/);
  assert.match(blockedUsers, /blocked: false/);
  assert.match(blockedUsers, /body\.blocked !== false/);
  assert.match(blockedUsers, /차단 중 숨겨진 과거 알림은 다시 뜨지 않아요/);
  assert.match(blockedUsers, /연결된 파트너에게도 공유하지 않아요/);
});
