import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const settingsPath = fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url));
const settingsSource = readFileSync(settingsPath, "utf8");

test("mobile settings consumes the sealed roster state from the code API", () => {
  assert.match(settingsSource, /resolveCoupleConnectionState/);
  assert.match(settingsSource, /isMembershipSealed/);
  assert.match(settingsSource, /phase === "sealed_single"/);
  assert.match(settingsSource, /phase === "awaiting_partner"/);
});

test("mobile sealed-single UI never tells the member to share an invite code", () => {
  assert.match(settingsSource, /새 멤버를 이 커플에 초대할 수 없어요/);
  assert.match(settingsSource, /새 커플로 다시 시작/);
  assert.match(settingsSource, /고객지원/);
  // 2026-07-27: `https://hanbang.ai/support`는 대상 페이지가 없어 외부 브라우저로
  // 404를 열고 있었다 — 하필 막힌 사용자가 누르는 자리다. 웹이 이미 공개한 연락처
  // (개인정보처리방침·AI 정책의 mailto)로 바꿨다. 요구는 그대로 "문의할 곳을 준다"이다.
  assert.match(settingsSource, /mailto:ceo@hanbang\.ai/);
  assert.doesNotMatch(settingsSource, /hanbang\.ai\/support/);
});

test("mobile restart uses the authenticated atomic reset endpoint", () => {
  assert.match(
    settingsSource,
    /apiFetchForExpectedUser\(expectedActorUserId, "\/api\/couple\/reset"/,
  );
  assert.match(settingsSource, /confirmText:\s*"초기화합니다"/);
  assert.match(settingsSource, /router\.replace\("\/onboarding"\)/);
});
