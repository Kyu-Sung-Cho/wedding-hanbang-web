import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const profileUrl = new URL("../../app/profile.tsx", import.meta.url);

test("profile exposes one canonical official vendor discovery entry", async () => {
  const source = await readFile(profileUrl, "utf8");
  assert.equal((source.match(/pathname: "\/market-prices"/g) ?? []).length, 1);
  // 진입점은 하나여야 한다는 게 이 테스트의 뜻이다. 라벨은 2026-07-27에
  // "업체 탐색" → "공시가·위약금 보기"로 바꿨다 — 웹이 위약금 원문을 공개한 뒤에도
  // 앱 라벨이 그대로여서 앱 사용자는 그 값이 있는 줄 몰랐다.
  assert.equal((source.match(/label="공시가·위약금 보기"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /label="시세 정보"/);
  assert.doesNotMatch(source, /label="업체 탐색"/);
});
