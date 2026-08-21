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
  // 중립 분기와 기존 분기 사이만 잘라서 본다
  const start = onboarding.indexOf("{/* Step 1(중립)");
  const end = onboarding.indexOf("{/* Step 1(기존)");
  assert.ok(start > 0, "중립 분기를 찾지 못했다");
  assert.ok(end > start, "기존 분기를 찾지 못했다");
  const neutralBlock = onboarding.slice(start, end);

  for (const word of ["신부", "신랑", "역할을 알려주세요"]) {
    assert.ok(
      !neutralBlock.includes(word),
      `중립 화면에 "${word}"가 남아 있다`,
    );
  }
  assert.match(neutralBlock, /역할을 정하지 않아도 시작할 수 있어요/u);
});

test("기존 5단계 경로는 그대로 남아 있다", () => {
  // 플래그가 꺼진 기기에서 온보딩이 사라지면 안 된다
  assert.match(onboarding, /step === 1 && !neutralEnabled/u);
  assert.match(onboarding, /현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요/u);
});

test("중립 화면이 예식일과 관심사를 받는다", () => {
  // 웹만 고치면 또 갈라진다. 예식일을 여기서 묻는 이유는 응답률(87%)이 아니라
  // 아모라가 대신 받아낼 수 없다는 것이다 — 첫 인사는 저장 정보를 못 꺼내고,
  // 도구 게이트는 자족 확정문만 통과시킨다.
  const start = onboarding.indexOf("{/* Step 1(중립)");
  const end = onboarding.indexOf("{/* Step 1(기존)");
  const neutralBlock = onboarding.slice(start, end);

  assert.ok(neutralBlock.includes("결혼식 날짜, 정하셨어요?"), "예식일을 묻지 않는다");
  assert.ok(neutralBlock.includes("지금 제일 신경 쓰이는 건 뭐예요"), "관심사를 묻지 않는다");
  assert.ok(neutralBlock.includes("WEDDING_PRIORITY_OPTIONS.map"), "칩이 공유 상수를 쓰지 않는다");

  // 안 묻기로 한 것이 슬그머니 돌아오지 않았는지
  assert.ok(!neutralBlock.includes("총 예산"), "중립 화면에서 예산을 묻고 있다");
  assert.ok(!neutralBlock.includes("예식 장소"), "중립 화면에서 장소를 묻고 있다");
});

test("중립 제출이 공유 구현에 날짜와 관심사를 넘긴다", () => {
  assert.ok(
    onboarding.includes("focusPriority: neutralFocus,"),
    "관심사가 제출 본문에 실리지 않는다",
  );
  const submitStart = onboarding.indexOf("buildNeutralPreparationSpaceSubmission({");
  const submitBlock = onboarding.slice(submitStart, submitStart + 300);
  assert.ok(submitBlock.includes("weddingDate:"), "예식일이 제출 본문에 실리지 않는다");
});
