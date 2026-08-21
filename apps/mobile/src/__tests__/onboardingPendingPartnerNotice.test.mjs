// 서버가 200 안에서 "상대의 확인을 기다린다"고 말했는데 앱이 침묵하면,
// 나중에 합류한 사람은 결혼 날짜를 입력하고도 아무 말을 못 듣고 홈은 계속
// "결혼식 날짜를 알려주세요"라고 말한다. 두 사람이 확인해야 반영된다는
// 제품의 약속이 **데이터 유실로 읽힌다.**
//
// 웹은 이 값을 이미 읽어 안내하고 있었고 모바일만 버리고 있었다 — 정본이
// "주 제품"이라 부르는 쪽이 침묵한 상태였다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const onboarding = readFileSync(join(here, "../../app/onboarding/index.tsx"), "utf8");
const webOnboarding = readFileSync(
  join(here, "../../../web/src/app/(auth)/onboarding/page.tsx"),
  "utf8",
);

test("모바일이 planChange.status 를 읽는다", () => {
  assert.match(onboarding, /planChange/u);
  assert.match(onboarding, /pending_partner/u);
  assert.match(onboarding, /planChange\.summary/u);
});

test("모바일이 routineProgress 지연도 읽는다", () => {
  assert.match(onboarding, /routineProgress/u);
  assert.match(onboarding, /deferred/u);
});

test("안내를 본 뒤에만 다음 화면으로 넘어간다", () => {
  // 안내를 띄우고 곧바로 이동하면 사용자는 문구를 못 읽는다.
  assert.match(onboarding, /onPress:\s*proceed/u);
  const alertIndex = onboarding.indexOf("pendingPartnerSummary\n            ? \"파트너 확인을 요청했어요\"");
  assert.ok(alertIndex > 0, "안내 Alert 가 있어야 한다");
  const returnAfter = onboarding.slice(alertIndex, alertIndex + 900);
  assert.match(returnAfter, /return;/u, "안내 뒤에는 자동 이동하지 않고 멈춰야 한다");
});

test("승인 대기를 실패처럼 말하지 않는다", () => {
  // "오류"/"실패" 로 말하면 정상 동작인 승인 경계가 사고로 읽힌다.
  assert.match(onboarding, /파트너 확인을 요청했어요/u);
  assert.match(onboarding, /두 사람이 모두 확인하면 자동으로 반영됩니다/u);
  assert.ok(
    !/Alert\.alert\(\s*"오류",\s*[^)]*pending_partner/u.test(onboarding),
    "승인 대기를 오류로 띄우면 안 된다",
  );
});

test("웹과 같은 문구를 쓴다", () => {
  // 두 표면이 같은 상태를 다르게 말하면 커플이 서로 다른 것을 본다.
  for (const phrase of [
    "파트너 확인을 요청했어요",
    "아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.",
    "저장되지 않은 입력이 있어요",
  ]) {
    assert.ok(webOnboarding.includes(phrase), `웹에 없는 문구: ${phrase}`);
    assert.ok(onboarding.includes(phrase), `모바일에 없는 문구: ${phrase}`);
  }
});
