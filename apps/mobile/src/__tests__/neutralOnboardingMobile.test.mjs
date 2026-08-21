// 모바일에 중립 준비 공간 경로가 실제로 있는지 본다.
//
// 웹만 중립으로 고치고 모바일을 두면, 정본이 "주 제품"이라 부르는 쪽에서
// 사용자는 여전히 신부/신랑을 강요당한다. 실제로 그런 상태가 있었다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const onboarding = readFileSync(join(here, "../../app/onboarding/index.tsx"), "utf8");

test("모바일 온보딩이 서버가 판정한 capabilities 를 읽는다", () => {
  assert.match(onboarding, /parseNeutralPreparationSpaceCapability/u);
  // 임포트만으로는 통과시키지 않는다 — 판정값이 실제 상태로 들어가야 한다
  assert.match(
    onboarding,
    /setNeutralEnabled.{0,160}parseNeutralPreparationSpaceCapability/su,
  );
  assert.match(onboarding, /apiFetch\("\/api\/auth\/me"\)/u);
  // 앱이 자기 환경변수로 정하면 서버와 어긋난다
  assert.ok(
    !/AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED/u.test(onboarding),
    "모바일이 플래그를 직접 읽으면 안 된다",
  );
});

test("중립 경로는 웹과 같은 공유 구현으로 요청을 만든다", () => {
  assert.match(onboarding, /buildNeutralPreparationSpaceSubmission/u);
  // 손으로 조립하면 웹과 어긋난다
  assert.ok(
    !/membershipMode:\s*"neutral_preparation_space"/u.test(onboarding),
    "요청 본문을 직접 조립하지 말고 공유 구현을 쓸 것",
  );
});

test("중립일 때는 첫 화면에서 바로 제출한다", () => {
  assert.match(onboarding, /neutralEnabled && step === 1/u);
});

test("중립 화면에는 성별 문구가 없다", () => {
  // 중립 화면은 NeutralPlanningFoundation 이다 — 플래그가 켜지면 그리로 조기 반환한다.
  const start = onboarding.indexOf("function NeutralPlanningFoundation(");
  assert.ok(start > 0, "중립 화면 컴포넌트를 찾지 못했다");
  const end = start + 10 + onboarding.slice(start + 10).search(/^function /mu);
  assert.ok(end > start, "중립 화면의 끝을 찾지 못했다");
  const neutralBlock = onboarding.slice(start, end);

  for (const word of ["신부", "신랑", "역할을 알려주세요"]) {
    assert.ok(
      !neutralBlock.includes(word),
      `중립 화면에 "${word}"가 남아 있다`,
    );
  }
  assert.match(neutralBlock, /역할.{0,30}나중에/u);
});

test("기존 5단계 경로는 그대로 남아 있다", () => {
  // 플래그가 꺼진 기기에서 온보딩이 사라지면 안 된다
  assert.match(onboarding, /step === 1 && !neutralEnabled/u);
  assert.match(onboarding, /현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요/u);
});
