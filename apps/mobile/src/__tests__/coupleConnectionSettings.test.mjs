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
  assert.match(settingsSource, /https:\/\/hanbang\.ai\/support/);
});

test("mobile restart uses the authenticated atomic reset endpoint", () => {
  assert.match(settingsSource, /apiFetch\("\/api\/couple\/reset"/);
  assert.match(settingsSource, /confirmText:\s*"초기화합니다"/);
  assert.match(settingsSource, /router\.replace\("\/onboarding"\)/);
});
