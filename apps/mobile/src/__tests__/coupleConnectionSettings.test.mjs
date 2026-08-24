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

// 두 사람이 각자 앱을 깔고 각자 "시작하기"를 누르면 둘 다 awaiting_partner 에 서서
// 서로의 코드를 기다린다. 그 화면에 나갈 문이 없으면 주 제품인 앱 안에서 커플이 영구히
// 갈라진다 — 온보딩은 다시 열리지 않고 서버는 ALREADY_LINKED_TO_ANOTHER_COUPLE 로 거절한다.
// 웹 설정에는 이 버튼이 국면과 무관하게 있었고 모바일에만 없었다.
test("mobile awaiting-partner offers a way out when both partners started separately", () => {
  const awaiting = settingsSource.slice(
    settingsSource.indexOf('phase === "awaiting_partner" ? ('),
    settingsSource.indexOf('phase === "linked" ? ('),
  );
  assert.ok(awaiting.length > 0, "awaiting_partner 분기를 찾지 못했습니다");
  assert.match(awaiting, /handleStartNewCouple/);
  assert.match(awaiting, /새 커플로 다시 시작/);
  // 왜 눌러야 하는지 말해 주지 않으면 찾지 못한다.
  assert.match(awaiting, /파트너도 따로 시작해서/);
});

test("mobile restart uses the authenticated atomic reset endpoint", () => {
  assert.match(settingsSource, /apiFetch\("\/api\/couple\/reset"/);
  assert.match(settingsSource, /confirmText:\s*"초기화합니다"/);
  assert.match(settingsSource, /router\.replace\("\/onboarding"\)/);
});
