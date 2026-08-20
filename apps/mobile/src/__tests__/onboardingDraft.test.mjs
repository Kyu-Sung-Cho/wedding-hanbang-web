// 온보딩 초안 — 무엇을 남기고, 무엇은 절대 남기지 않고, 언제 지우는가.
//
// 이 파일이 지키는 것은 저장 형식이 아니라 **약속 세 가지**다.
//   1. 절반쯤 걷다 앱이 내려가도 적은 것이 남는다(웹의 sessionStorage와 같은 자리).
//   2. 초대 코드는 어디에도 남지 않는다 — 커플 공간의 열쇠다.
//   3. 저장이 실패해도 온보딩은 걸어간다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function compileCommonJs(source, resolveDependency = () => {
  throw new Error("unexpected dependency");
}) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(
    module.exports,
    module,
    resolveDependency,
  );
  return module.exports;
}

const planningModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/weddingPlanning.ts"),
);
const resolvePlanning = (specifier) => {
  if (specifier === "./weddingPlanning") return planningModule;
  throw new Error(`unexpected dependency: ${specifier}`);
};
const preparationProgressModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/preparationProgress.ts"),
  resolvePlanning,
);
const preparationStageModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/preparationStage.ts"),
  resolvePlanning,
);
const weddingPreferencesModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/weddingPreferences.ts"),
);
const sharedModule = {
  ...planningModule,
  ...preparationProgressModule,
  ...preparationStageModule,
  ...weddingPreferencesModule,
};

const draft = compileCommonJs(readSource("../lib/onboardingDraft.ts"), (specifier) => {
  if (specifier === "@hanbang/shared") return sharedModule;
  throw new Error(`unexpected dependency: ${specifier}`);
});

const onboardingSource = readSource("../../app/onboarding/index.tsx");
const rootGateSource = readSource("../../app/index.tsx");

function createMemoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

const FILLED_DRAFT = {
  step: 4,
  role: "bride",
  coupleAction: "create",
  weddingDate: "2027-05-15",
  weddingDateUndecided: false,
  venue: "어느 홀",
  budget: "3000",
  weddingStyle: "natural",
  priorities: ["venue", "sdm"],
  budgetTendency: "balanced",
  guestCount: sharedModule.WEDDING_GUEST_COUNT_OPTIONS[0].value,
  preparationStage: "venue_hunting",
  categoryStatuses: { venue: "completed" },
  stagePhase: "detail",
};

/* ─────────────────────────────────────────────
   (a) 절반쯤 걷다 끊겨도 적은 것이 남는다
   ───────────────────────────────────────────── */

test("a half-walked onboarding survives the app being taken away", async () => {
  const storage = createMemoryStorage();
  const now = Date.parse("2026-08-19T02:00:00.000Z");

  await draft.saveOnboardingDraft(storage, FILLED_DRAFT, now);
  // 앱이 죽었다 켜졌다 = 메모리에는 아무것도 없고 저장소만 남는다.
  const restored = await draft.loadOnboardingDraft(storage, now + 60_000);

  assert.equal(restored.step, 4);
  assert.equal(restored.role, "bride");
  assert.equal(restored.weddingDate, "2027-05-15");
  assert.equal(restored.venue, "어느 홀");
  assert.equal(restored.budget, "3000");
  assert.equal(restored.weddingStyle, "natural");
  assert.deepEqual(restored.priorities, ["venue", "sdm"]);
  assert.equal(restored.budgetTendency, "balanced");
  assert.equal(restored.preparationStage, "venue_hunting");
  assert.deepEqual(restored.categoryStatuses, { venue: "completed" });
  assert.equal(restored.stagePhase, "detail");
});

/* ─────────────────────────────────────────────
   (b) 초대 코드는 어디에도 남지 않는다
   ───────────────────────────────────────────── */

test("the invite code is never written and never read back", async () => {
  const storage = createMemoryStorage();
  const now = Date.parse("2026-08-19T02:00:00.000Z");

  await draft.saveOnboardingDraft(
    storage,
    { ...FILLED_DRAFT, inviteCode: "WH-A3F91B2C7D40", partnerInviteCode: "WH-A3F91B2C7D40" },
    now,
  );

  const written = storage.items.get(draft.ONBOARDING_DRAFT_KEY);
  assert.ok(!written.includes("WH-A3F91B2C7D40"), "초대 코드가 기기에 적혔습니다");
  assert.ok(!written.includes("nviteCode"), "초대 코드 필드가 기기에 적혔습니다");

  // 옛 판이 남긴 값이 있어도 읽는 쪽에서 버린다 — 웹도 merge에서 한 번 더 지운다.
  const legacy = JSON.stringify({
    savedAt: now,
    draft: { ...FILLED_DRAFT, inviteCode: "WH-A3F91B2C7D40" },
  });
  const restored = draft.parseOnboardingDraft(legacy, now);
  assert.equal(restored.inviteCode, undefined);

  // 화면도 초안에 코드를 넘기지 않는다.
  const saveCall = onboardingSource.slice(
    onboardingSource.indexOf("void saveOnboardingDraft(AsyncStorage, {"),
  ).slice(0, 700);
  assert.doesNotMatch(saveCall, /inviteCode/);
});

/* ─────────────────────────────────────────────
   (c) 저장소가 무엇을 돌려줘도 화면은 서 있는다
   ───────────────────────────────────────────── */

test("a broken, foreign or stale draft reads as no draft at all", () => {
  const now = Date.parse("2026-08-19T02:00:00.000Z");

  assert.equal(draft.parseOnboardingDraft(null, now), null);
  assert.equal(draft.parseOnboardingDraft("not json", now), null);
  assert.equal(draft.parseOnboardingDraft(JSON.stringify({}), now), null);
  assert.equal(draft.parseOnboardingDraft(JSON.stringify([1, 2]), now), null);
  // 7일보다 오래된 초안은 되살리지 않는다. 몇 달 전 입력이 설명 없이 되살아나면
  // 사람은 자기가 적은 적 없는 예산과 식장을 본다.
  assert.equal(
    draft.parseOnboardingDraft(
      JSON.stringify({
        savedAt: now - draft.ONBOARDING_DRAFT_MAX_AGE_MS - 1,
        draft: FILLED_DRAFT,
      }),
      now,
    ),
    null,
  );
  // 기기 시계가 뒤로 돌아가 저장 시각이 미래면 영영 만료되지 않는다.
  assert.equal(
    draft.parseOnboardingDraft(
      JSON.stringify({ savedAt: now + 60_000, draft: FILLED_DRAFT }),
      now,
    ),
    null,
  );
});

test("values the app does not know never come back as if the user chose them", () => {
  const now = Date.parse("2026-08-19T02:00:00.000Z");
  const restored = draft.parseOnboardingDraft(
    JSON.stringify({
      savedAt: now,
      draft: {
        step: 99,
        role: "witness",
        coupleAction: "steal",
        weddingStyle: "unknown_style",
        priorities: ["venue", "moon_base", "venue"],
        budgetTendency: "free",
        guestCount: "one_million",
        preparationStage: "already_married",
        // 19항목의 키·상태 어휘가 어긋나면 서버는 온보딩 요청 **전체**를 400으로 거절한다.
        categoryStatuses: { venue: "maybe", moon_base: "completed" },
        stagePhase: "elsewhere",
      },
    }),
    now,
  );

  assert.ok(restored.step <= draft.ONBOARDING_DRAFT_LAST_RESUMABLE_STEP);
  assert.ok(restored.step >= 1);
  assert.equal(restored.role, null);
  assert.equal(restored.coupleAction, "create");
  assert.equal(restored.weddingStyle, null);
  assert.deepEqual(restored.priorities, ["venue"]);
  assert.equal(restored.budgetTendency, null);
  assert.equal(restored.guestCount, null);
  assert.equal(restored.preparationStage, null);
  assert.deepEqual(restored.categoryStatuses, {});
  assert.equal(restored.stagePhase, "stage");
});

test("the completion screen is never restored — its invite code is gone", () => {
  const now = Date.parse("2026-08-19T02:00:00.000Z");
  const restored = draft.parseOnboardingDraft(
    JSON.stringify({ savedAt: now, draft: { ...FILLED_DRAFT, step: 6 } }),
    now,
  );
  // 6단계는 서버가 방금 발급한 코드를 보여주는 화면이라, 코드 없이 되돌아가면 빈 카드다.
  assert.equal(restored.step, draft.ONBOARDING_DRAFT_LAST_RESUMABLE_STEP);
  assert.equal(draft.ONBOARDING_DRAFT_LAST_RESUMABLE_STEP, 5);
});

test("a storage that throws never blocks the screen", async () => {
  const broken = {
    async getItem() {
      throw new Error("storage unavailable");
    },
    async setItem() {
      throw new Error("storage unavailable");
    },
    async removeItem() {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(await draft.loadOnboardingDraft(broken), null);
  await draft.saveOnboardingDraft(broken, FILLED_DRAFT);
  await draft.clearOnboardingDraft(broken);
  // 저장소가 아예 없는 기기도 같은 취급이다.
  assert.equal(await draft.loadOnboardingDraft(null), null);
  await draft.saveOnboardingDraft(null, FILLED_DRAFT);
  await draft.clearOnboardingDraft(null);
});

/* ─────────────────────────────────────────────
   (d) 마치면 지운다
   ───────────────────────────────────────────── */

test("finishing onboarding removes the draft from the device", async () => {
  const storage = createMemoryStorage();
  await draft.saveOnboardingDraft(storage, FILLED_DRAFT);
  assert.equal(storage.items.has(draft.ONBOARDING_DRAFT_KEY), true);
  await draft.clearOnboardingDraft(storage);
  assert.equal(storage.items.has(draft.ONBOARDING_DRAFT_KEY), false);

  // 화면은 서버 저장이 성공한 경로에서만 지운다.
  assert.match(
    onboardingSource,
    /const goOn = \(\) => \{[\s\S]{0,320}void clearOnboardingDraft\(AsyncStorage\);/,
  );
  // 지운 뒤에는 다시 적지 않는다. 완료 화면으로 넘어가는 것도 상태 변화라, 막지 않으면
  // 저장 타이머가 한 번 더 돌아 이미 끝난 온보딩의 초안이 되살아난다.
  assert.match(onboardingSource, /draftDoneRef\.current = true;\s*\n\s*void clearOnboardingDraft/);
  assert.match(
    onboardingSource,
    /if \(!draftRestoredRef\.current \|\| draftDoneRef\.current\) return;/,
  );
});

/* ─────────────────────────────────────────────
   (e) 화면 배선 — 복원이 저장보다 먼저, 링크가 초안보다 세다
   ───────────────────────────────────────────── */

test("the screen restores before it saves, and a link beats a stale choice", () => {
  // 복원 전에 저장하면 빈 초기 상태가 저장된 초안을 덮는다.
  assert.match(onboardingSource, /if \(!draftRestoredRef\.current \|\| draftDoneRef\.current\) return;/);
  assert.match(
    onboardingSource,
    /const draft = await loadOnboardingDraft\(AsyncStorage\);[\s\S]{0,1600}draftRestoredRef\.current = true;[\s\S]{0,400}consumePendingCoupleInviteCode/,
  );
  // 링크로 정해진 join이 초안의 예전 선택보다 뒤에 적용돼야 한다.
  const restoreIndex = onboardingSource.indexOf("setCoupleAction(draft.coupleAction)");
  const linkIndex = onboardingSource.indexOf('setCoupleAction("join")');
  assert.ok(restoreIndex > 0 && linkIndex > restoreIndex);
});

/* ─────────────────────────────────────────────
   (f) 이미 마친 사람은 온보딩에 서 있지 않는다
   ───────────────────────────────────────────── */

test("an already-onboarded person is sent back to the lounge by the root gate's judgment", () => {
  // 라운지의 제일 큰 버튼이 이 화면을 열던 시절, 역할을 처음과 다르게 고르면 서버가
  // 커플 구성이 어긋났다고 돌려주고 화면은 "고객 지원에 문의해주세요"로 끝났다.
  assert.match(onboardingSource, /profile\?\.onboarding_completed === true/);
  assert.match(onboardingSource, /router\.replace\("\/\(tabs\)\/lounge"\)/);

  // 루트 게이트와 같은 값 하나만 본다. 판정을 복제하면 두 곳이 다른 답을 하는 날이 온다.
  assert.match(rootGateSource, /onboarding_completed/);
  assert.match(onboardingSource, /\.select\("onboarding_completed"\)/);

  // 확인하는 동안 화면을 가리지 않는다 — 여기서 스피너를 세우면 연결이 느린 사람은
  // 가입 자체를 못 하고, 이 빗장이 막는 건 이미 계정이 있는 사람의 잘못된 재입장뿐이다.
  assert.doesNotMatch(onboardingSource, /gateChecking|checkingOnboardingGate/);
});
