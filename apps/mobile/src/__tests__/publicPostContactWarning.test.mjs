import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const writeScreen = readFileSync(
  fileURLToPath(new URL("../../app/community/post/write.tsx", import.meta.url)),
  "utf8",
);

/**
 * 커뮤니티 글은 로그인 없이도 읽힌다. 그런데 앱의 작성 화면에는 개인정보 관문이
 * **하나도 없었다**(2026-08-23 확인 — 웹에는 확인 체크박스가 있다).
 */

test("올리기 전에 연락처를 확인한다", () => {
  assert.match(writeScreen, /findPublicPostContactDetails\(title, content, sponsorDetail\)/u);
  assert.match(writeScreen, /describePublicPostContactWarning\(/u);
});

test("확인을 통과하지 못하면 올리지 않는다", () => {
  // 관문이 handleSubmit 안에 있고, 거절하면 그 자리에서 끝나야 한다.
  assert.match(writeScreen, /if \(!\(await confirmPublicContact\(\)\)\) return;/u);
});

test("막지 않고 결정을 넘긴다", () => {
  // 두 선택지를 모두 준다. 제품이 글을 대신 고치지 않는다.
  assert.match(writeScreen, /"다시 볼게요"/u);
  assert.match(writeScreen, /"그대로 올리기"/u);
  assert.doesNotMatch(writeScreen, /setContent\([^)]*replace\(/u);
});

test("제목·본문·협찬란을 모두 본다", () => {
  // 본문만 보면 제목에 적은 번호가 그대로 나간다.
  assert.match(writeScreen, /findPublicPostContactDetails\(title, content, sponsorDetail\)/u);
});
