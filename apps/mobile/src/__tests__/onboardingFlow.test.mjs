import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildOnboardingProgressPayload,
  describeOnboardingSubmitNotice,
  getNextOnboardingStep,
  getOnboardingStepPosition,
  getOnboardingSteps,
  getPreviousOnboardingStep,
  shouldAskPreparationProgress,
} from "../lib/onboardingFlow.mjs";

const read = (relativePath) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8",
);

const sharedPreparationSource = read(
  "../../../../packages/shared/src/constants/preparationProgress.ts",
);
const serverKeySource = read(
  "../../../../apps/web/src/types/onboarding.types.ts",
);
const listSource = read("../components/onboarding/PreparationProgressList.tsx");
const onboardingSource = read("../../app/onboarding/index.tsx");

/** TS 소스에서 문자열 배열 상수를 읽는다. 앱 테스트는 TS를 실행할 수 없어서 소스를 읽는다. */
function readStringArrayConstant(source, name) {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source);
  assert.ok(match, `${name} 배열을 찾지 못했습니다`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

const canonicalCategoryKeys = readStringArrayConstant(
  sharedPreparationSource,
  "PREPARATION_PROGRESS_CATEGORY_KEYS",
);

const preferences = {
  weddingStyle: null,
  priorities: [],
  budgetTendency: null,
  guestCount: null,
};

test("the keys the app can send are exactly the keys the server accepts", () => {
  // 서버(apps/web .../api/onboarding/route.ts)는 PROGRESS_CHECKLIST_ITEMS에서 허용
  // 키 집합을 만든다. 그 목록이 정본 생성기에서 나오는지 먼저 확인한다.
  assert.match(
    serverKeySource,
    /PROGRESS_CHECKLIST_ITEMS[^=]*=\s*\n?\s*createPreparationProgressItems\(\)/,
  );

  // 앱도 같은 정본을 쓴다. 예전처럼 카테고리 템플릿에서 키를 뽑아 라벨 사전으로
  // 거르면, 템플릿에 카테고리가 하나 늘 때 서버가 모르는 키가 나가고 온보딩 POST
  // 전체가 400이 된다.
  assert.match(listSource, /from "@hanbang\/shared"/);
  assert.match(listSource, /PREPARATION_PROGRESS_CATEGORY_KEYS/);
  assert.match(listSource, /createPreparationProgressItems\(\)/);
  assert.doesNotMatch(listSource, /CATEGORY_CHECKLISTS/);
  assert.doesNotMatch(listSource, /PLANNING_CATEGORY_LABELS/);
  assert.doesNotMatch(listSource, /Object\.hasOwn/);

  assert.equal(canonicalCategoryKeys.length, 19);
  assert.equal(new Set(canonicalCategoryKeys).size, 19);
  // 예비비는 준비 항목이 아니라 예산의 남은 자리다 — 서버 허용 집합에도 없다.
  assert.ok(!canonicalCategoryKeys.includes("reserve"));
});

test("the four status words come from the shared vocabulary, not a second copy", () => {
  assert.match(listSource, /PREPARATION_PROGRESS_STATUS_OPTIONS/);
  // 로컬 STATUS_OPTIONS 배열을 다시 두면 웹과 앱이 같은 항목을 다른 말로 부른다.
  assert.doesNotMatch(listSource, /const STATUS_OPTIONS/);
  assert.doesNotMatch(listSource, /label: "안 해요"/);

  const canonicalStatuses = readStringArrayConstant(
    sharedPreparationSource,
    "PREPARATION_PROGRESS_STATUSES",
  );
  assert.deepEqual(canonicalStatuses, [
    "not_started",
    "in_progress",
    "completed",
    "not_applicable",
  ]);
});

test("a partner joining with an invite code is never asked for preparation progress", () => {
  assert.equal(shouldAskPreparationProgress("join"), false);
  assert.equal(shouldAskPreparationProgress("create"), true);

  // 합류 경로에는 공유 값을 건드리는 화면이 하나도 없다 — 준비 현황(5)뿐 아니라
  // 결혼 정보(3)와 웨딩 스타일(4)도 목록에 없다. 셋 다 커플이 함께 쓰는 자리라,
  // 합류자가 다른 값을 넣으면 서버가 양쪽 승인이 필요한 변경으로 만든다.
  for (const sharedStep of [3, 4, 5]) {
    assert.ok(!getOnboardingSteps("join").includes(sharedStep));
    assert.ok(getOnboardingSteps("create").includes(sharedStep));
  }
  assert.equal(getPreviousOnboardingStep(2, "join"), 1);
  assert.equal(getNextOnboardingStep(2, "join"), null);
  assert.equal(getNextOnboardingStep(4, "create"), 5);
  assert.equal(getPreviousOnboardingStep(6, "create"), 5);

  // 진행 표시의 분모는 그 사람이 실제로 보는 화면 수다.
  assert.deepEqual(getOnboardingStepPosition(2, "join"), {
    position: 2,
    total: 2,
  });
  assert.deepEqual(getOnboardingStepPosition(4, "create"), {
    position: 4,
    total: 6,
  });
  assert.deepEqual(getOnboardingStepPosition(6, "create"), {
    position: 6,
    total: 6,
  });
});

test("the join payload carries neither the stage nor a single one of the 19 items", () => {
  const answeredEverything = Object.fromEntries(
    canonicalCategoryKeys.map((key) => [key, "completed"]),
  );

  const joinPayload = buildOnboardingProgressPayload({
    coupleAction: "join",
    stage: "venue_booked",
    preferences,
    categoryStatuses: answeredEverything,
  });

  // 커플 공유 데이터라, 나중에 합류한 사람의 입력이 먼저 적어둔 쪽을 덮으면 안 된다.
  assert.deepEqual(Object.keys(joinPayload), ["__preferences"]);
  assert.ok(!Object.hasOwn(joinPayload, "__stage"));
  for (const key of canonicalCategoryKeys) {
    assert.ok(
      !Object.hasOwn(joinPayload, key),
      `합류 payload에 ${key}가 들어갔습니다`,
    );
  }

  // 새로 시작하는 사람의 입력은 그대로 간다.
  const createPayload = buildOnboardingProgressPayload({
    coupleAction: "create",
    stage: "venue_booked",
    preferences,
    categoryStatuses: { venue: "completed" },
  });
  assert.equal(createPayload.__stage, "venue_booked");
  assert.deepEqual(createPayload.venue, { status: "completed" });
});

test("the preparation step is two screens, and going back returns to the stage screen", () => {
  // 국면 A(단계 한 줄) → "다음" → 국면 B(19항목). 한 화면에 펼쳐두면 제안값을
  // 확인하지 않고도 저장이 눌린다.
  assert.match(onboardingSource, /stagePhase === "stage"/);
  assert.match(onboardingSource, /stagePhase === "detail"/);
  assert.match(
    onboardingSource,
    /stagePhase === "stage"\) \{\s*\n\s*setStagePhase\("detail"\);/,
  );
  assert.match(
    onboardingSource,
    /stagePhase === "detail"\) \{\s*\n\s*setStagePhase\("stage"\);/,
  );
  // 저장 버튼 둘은 국면 B에만 있다.
  assert.match(
    onboardingSource,
    /stagePhase === "detail" && \(\s*\n\s*<Pressable\s*\n\s*onPress=\{\(\) => handleSubmit\(false\)\}/,
  );
  assert.match(onboardingSource, /건너뛰고 시작하기/);
  assert.match(onboardingSource, /저장하고 시작하기/);
});

test("a submit that only reached the partner's review does not read as saved", () => {
  const pending = describeOnboardingSubmitNotice({
    planChange: {
      status: "pending_partner",
      summary: "결혼 예정일 변경을 파트너에게 보냈어요.",
    },
  });
  assert.equal(pending.title, "파트너 확인을 요청했어요");
  assert.match(pending.message, /결혼 예정일 변경을 파트너에게 보냈어요\./);
  assert.match(
    pending.message,
    /아직 계획에는 반영되지 않았어요\. 두 사람이 모두 확인하면 자동으로 반영됩니다\./,
  );

  const deferred = describeOnboardingSubmitNotice({
    routineProgress: { status: "deferred", message: "준비 현황은 보류했어요." },
  });
  assert.equal(deferred.title, "저장되지 않은 입력이 있어요");
  assert.equal(deferred.message, "준비 현황은 보류했어요.");

  const both = describeOnboardingSubmitNotice({
    planChange: { status: "pending_partner", summary: "날짜 변경 요청" },
    routineProgress: { status: "deferred", message: "준비 현황은 보류했어요." },
  });
  assert.equal(both.title, "파트너 확인을 요청했어요");
  assert.match(both.message, /날짜 변경 요청/);
  assert.match(both.message, /준비 현황은 보류했어요\./);

  // 알릴 것이 없으면 조용히 넘어간다.
  assert.equal(describeOnboardingSubmitNotice({}), null);
  assert.equal(describeOnboardingSubmitNotice(null), null);
  assert.equal(
    describeOnboardingSubmitNotice({ planChange: { status: "applied" } }),
    null,
  );
  assert.equal(
    describeOnboardingSubmitNotice({
      planChange: { status: "pending_partner" },
    }),
    null,
  );

  // 화면은 알림을 확인하기 전에는 다음 화면으로 넘어가지 않는다.
  assert.match(
    onboardingSource,
    /const notice = describeOnboardingSubmitNotice\(data\);\s*\n\s*if \(notice\) \{/,
  );
  assert.match(
    onboardingSource,
    /\[\{ text: "확인하고 계속하기", onPress: goOn \}\]/,
  );
});
