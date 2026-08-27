import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildOnboardingProgress,
  evaluateWeddingDateInput,
  formatWeddingDateInput,
} from "../lib/onboardingFirstValue.mjs";
import {
  describeOnboardingSubmitNotice,
  getOnboardingSteps,
} from "../lib/onboardingFlow.mjs";

const onboardingSource = readFileSync(
  fileURLToPath(new URL("../../app/onboarding/index.tsx", import.meta.url)),
  "utf8",
);

const preferences = {
  weddingStyle: null,
  priorities: [],
  budgetTendency: null,
  guestCount: null,
};

test("separators the member types are replaced by the app's own hyphens", () => {
  assert.equal(formatWeddingDateInput("20261015"), "2026-10-15");
  assert.equal(formatWeddingDateInput("2026/10/15"), "2026-10-15");
  assert.equal(formatWeddingDateInput("2026.10.15"), "2026-10-15");
  assert.equal(formatWeddingDateInput("2026년 10월 15일"), "2026-10-15");
});

test("deleting backwards never leaves a hyphen the member cannot remove", () => {
  assert.equal(formatWeddingDateInput("2026-1"), "2026-1");
  assert.equal(formatWeddingDateInput("2026-"), "2026");
  assert.equal(formatWeddingDateInput("2026"), "2026");
  assert.equal(formatWeddingDateInput(""), "");
});

test("extra digits past the eight a date needs are dropped instead of submitted", () => {
  assert.equal(formatWeddingDateInput("2026101599"), "2026-10-15");
});

test("an empty wedding date stays allowed and still explains the format", () => {
  const evaluation = evaluateWeddingDateInput("");
  assert.equal(evaluation.status, "empty");
  assert.equal(evaluation.requestDate, null);
  assert.match(evaluation.message, /20261015/);
});

test("a half-typed date blocks the step with a reason instead of a silent server 400", () => {
  const evaluation = evaluateWeddingDateInput("2026-10");
  assert.equal(evaluation.status, "incomplete");
  assert.equal(evaluation.requestDate, null);
  assert.notEqual(evaluation.message, "");
});

test("a day that does not exist in that month is named before the request leaves", () => {
  const evaluation = evaluateWeddingDateInput("2026-02-30");
  assert.equal(evaluation.status, "invalid");
  assert.equal(evaluation.requestDate, null);
  assert.match(evaluation.message, /2026년 2월은 28일까지예요/);
});

test("a leap day is a real date and a non-leap 2월 29일 is not", () => {
  assert.equal(evaluateWeddingDateInput("2028-02-29").status, "valid");
  assert.equal(evaluateWeddingDateInput("2027-02-29").status, "invalid");
});

test("an out-of-range month is rejected on this screen", () => {
  const evaluation = evaluateWeddingDateInput("2026-13-05");
  assert.equal(evaluation.status, "invalid");
  assert.match(evaluation.message, /01~12/);
});

test("a two-digit year that folds into 1926 never reaches the server as a valid date", () => {
  assert.equal(evaluateWeddingDateInput("0026-10-15").status, "invalid");
});

test("a valid date becomes the exact ISO string the onboarding API accepts", () => {
  const evaluation = evaluateWeddingDateInput("20261015");
  assert.equal(evaluation.status, "valid");
  assert.equal(evaluation.requestDate, "2026-10-15");
});

test("skipping the item screen saves the stage the member picked and nothing else", () => {
  const progress = buildOnboardingProgress({
    stage: "venue_booked",
    preferences,
    categoryStatuses: null,
  });

  assert.deepEqual(Object.keys(progress).sort(), ["__preferences", "__stage"]);
  assert.equal(progress.__stage, "venue_booked");
});

test("stage suggestions are never saved on their own — only confirmed items are sent", () => {
  const progress = buildOnboardingProgress({
    stage: "venue_booked",
    preferences,
    categoryStatuses: {
      venue: "completed",
      meeting: "completed",
      studio: "not_started",
      dress: "not_applicable",
    },
  });

  assert.deepEqual(progress.venue, { status: "completed" });
  assert.deepEqual(progress.meeting, { status: "completed" });
  assert.deepEqual(progress.dress, { status: "not_applicable" });
  // 아직 시작하지 않았다는 건 새로 생긴 사실이 아니라 기본 상태다.
  assert.equal(Object.hasOwn(progress, "studio"), false);
});

test("no stage means no reserved stage key in the saved progress", () => {
  const progress = buildOnboardingProgress({ stage: null, preferences });
  assert.equal(Object.hasOwn(progress, "__stage"), false);
});

test("mobile onboarding runs six steps and asks for the preparation stage before finishing", () => {
  // 걷는 화면 수는 이제 화면이 아니라 흐름 모듈이 정한다 — 합류한 사람은 준비 현황을
  // 걷지 않으므로 스텝 수도 다르다(onboardingFlow.test.mjs 참고).
  assert.deepEqual(getOnboardingSteps("create"), [1, 2, 3, 4, 5, 6]);
  assert.match(onboardingSource, /const DONE_STEP = ONBOARDING_DONE_STEP;/);
  // 단계는 **묻되 강제하지 않는다.**
  //
  // 이 줄은 원래 `case 5: return stagePhase === "detail" || preparationStage !== null;`
  // 이었다. 그런데 웹은 같은 질문을 `return true`로 물어서(감사 기록:
  // "1,2단계만 필수, 3·4·5는 전부 return true"), 한 커플이 두 화면에서 서로 다른
  // 관문을 만나고 있었다. 이 테스트를 만든 커밋의 제목이 "웹·앱 같은 모양으로
  // 받는다"였으니, 어긋난 쪽은 앱이다.
  //
  // 이 테스트의 이름이 지키려는 것은 "묻는다"이지 "강제한다"가 아니다. 묻는 화면이
  // 살아 있는지는 바로 아래 `PREPARATION_STAGE_OPTIONS.map`이 지킨다. 웹과 다시
  // 어긋나면 `apps/web/src/app/(auth)/onboarding/__tests__/onboardingGateParity.test.ts`가
  // 잡는다 — 한쪽만 고치는 것이 이 버그의 원인이었으므로 그쪽에 가드를 뒀다.
  assert.match(onboardingSource, /case 5: return true;/);
  assert.match(onboardingSource, /PREPARATION_STAGE_OPTIONS\.map/);
});

test("the skip button on the preparation step submits without the item statuses", () => {
  assert.match(onboardingSource, /onPress=\{\(\) => handleSubmit\(false\)\}/);
  // 저장을 누른 경우에도 **화면 기본값과 같은 값은 빼고** 보낸다. 기본값이 분야마다
  // 달라서(안 하는 집이 더 많은 자리는 "안 해요"로 시작한다) `not_started` 하나만
  // 거르는 `onboardingFirstValue.mjs` 로는 부족하고, 그대로 보내면 파트너가 켜 둔
  // 분야가 이쪽 기본값으로 되돌아간다.
  assert.match(
    onboardingSource,
    /categoryStatuses: saveCategories\s*\?\s*withoutDefaultPreparationStatuses\(categoryStatuses\)\s*:\s*null,/,
  );
});

test("a deferred server response tells the member the input was not saved", () => {
  // 판정과 문구는 onboardingFlow로 옮겼다(파트너 확인 대기도 같은 자리에서 다룬다).
  // 화면은 그 결과를 그대로 띄우고, 확인하기 전에는 다음으로 넘어가지 않는다.
  const notice = describeOnboardingSubmitNotice({
    routineProgress: {
      status: "deferred",
      message: "이미 연결된 커플이라 준비 현황은 저장하지 않았어요.",
    },
  });
  assert.equal(notice.title, "저장되지 않은 입력이 있어요");
  assert.equal(notice.message, "이미 연결된 커플이라 준비 현황은 저장하지 않았어요.");
  assert.match(onboardingSource, /describeOnboardingSubmitNotice\(data\)/);
  assert.match(onboardingSource, /"확인하고 계속하기"/);
});

test("re-tapping the stage already chosen leaves the hand-edited items alone", () => {
  // 웹에서 같은 결함을 고쳤는데(onboardingStore.setPreparationStage) 앱에는 남아 있었다.
  // 2국면이 되면서 재현이 더 쉬워졌다 — 19항목 화면에서 뒤로 가면 고른 단계가 선택된
  // 채 보이고, 그 카드를 한 번 더 누르면 손으로 고친 상태가 제안값으로 덮인다.
  assert.match(
    onboardingSource,
    /function handleStagePress\([^)]*\)\s*\{[\s\S]{0,400}?if \(preparationStage === value\) return;/,
  );
});
