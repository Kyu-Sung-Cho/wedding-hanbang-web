// 웨딩 라운지 첫 도착 화면 — 언제 뜨고, 언제 사라지고, 어디로 보내는가.
//
// 이 파일이 지키는 것은 카드 모양이 아니라 **조건과 목적지**다. 첫 도착 화면이 실패하는
// 방식은 둘뿐이다: 데이터가 있는데도 계속 뜨거나(플래그가 어긋남), 눌렀더니 없는 화면이
// 열리거나(경로가 옮겨감). 둘 다 여기서 잡는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import ts from "typescript";

import {
  hasCoupleMadeData,
  readRecordedCategoryStatuses,
  readWeddingStyleValue,
} from "../lib/loungeFirstArrival.mjs";

function readSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function resolveRepoPath(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
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

const preparationStageModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/preparationStage.ts"),
);
const amoraFirstHelloModule = compileCommonJs(
  readSource("../../../../packages/shared/src/contracts/amoraFirstHello.ts"),
  (specifier) => {
    if (specifier === "../constants/preparationStage") {
      return preparationStageModule;
    }
    throw new Error(`unexpected dependency: ${specifier}`);
  },
);
const loungeFirstRunSource = readSource(
  "../../../../packages/shared/src/contracts/loungeFirstRun.ts",
);
const { buildLoungeFirstRunView, isOnlyStageSuggestion } = compileCommonJs(
  loungeFirstRunSource,
  (specifier) => {
    if (specifier === "../constants/preparationStage") {
      return preparationStageModule;
    }
    if (specifier === "./amoraFirstHello") return amoraFirstHelloModule;
    throw new Error(`unexpected dependency: ${specifier}`);
  },
);

const arrivalSource = readSource("../components/lounge/LoungeFirstArrival.tsx");
const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const homeExperienceSource = readSource(
  "../components/dashboard/WeddingHomeExperience.tsx",
);
const fabSource = readSource("../components/lounge/AmoraFab.tsx");
const firstRunTutorialContract = compileCommonJs(
  readSource("../../../../packages/shared/src/contracts/firstRunTutorial.ts"),
);
const chatEntryModule = compileCommonJs(readSource("../lib/amoraChatEntry.ts"));

/** 온보딩 직후의 progress. 말한 것만 있고 만든 것은 없다. */
const JUST_ONBOARDED_PROGRESS = {
  __stage: "venue_hunting",
  __preferences: { weddingStyle: "natural", priorities: ["venue"] },
};

/* ─────────────────────────────────────────────
   (a)(b) 데이터가 없으면 뜨고, 생기면 저절로 사라진다
   ───────────────────────────────────────────── */

test("a couple that has only spoken, not built, still counts as empty", () => {
  assert.equal(
    hasCoupleMadeData({
      progress: JUST_ONBOARDED_PROGRESS,
      bookingOutcomeTasks: [],
    }),
    false,
  );
  // 단계도 취향도 없는 예전 온보딩 커플, 그리고 progress 자체가 비었거나 망가진 경우.
  assert.equal(hasCoupleMadeData({ progress: {} }), false);
  assert.equal(hasCoupleMadeData({ progress: null }), false);
  assert.equal(hasCoupleMadeData(), false);
});

test("any real entry the couple made retires the first arrival screen", () => {
  // 체크리스트/예산은 19개 카테고리 키 안에 산다.
  assert.equal(
    hasCoupleMadeData({
      progress: { ...JUST_ONBOARDED_PROGRESS, venue: { status: "in_progress" } },
    }),
    true,
  );
  assert.equal(
    hasCoupleMadeData({
      progress: { ...JUST_ONBOARDED_PROGRESS, dress: { budget: 3000000 } },
    }),
    true,
  );
  // 일정.
  assert.equal(
    hasCoupleMadeData({
      progress: {
        ...JUST_ONBOARDED_PROGRESS,
        __events: [
          { id: "e1", title: "본식 상담", date: "2027-03-04", createdBy: null },
        ],
      },
    }),
    true,
  );
  // 상담 요청 기록.
  assert.equal(
    hasCoupleMadeData({
      progress: JUST_ONBOARDED_PROGRESS,
      bookingOutcomeTasks: [{ id: "b1" }],
    }),
    true,
  );
});

test("a cancelled schedule event does not count as something to show", () => {
  // 취소된 일정은 라운지에도 안 나온다. 그걸로 첫 도착 화면을 거두면 사람은
  // 설명 없는 빈 화면만 남는다.
  assert.equal(
    hasCoupleMadeData({
      progress: {
        ...JUST_ONBOARDED_PROGRESS,
        __events: [
          {
            id: "e1",
            title: "취소된 상담",
            date: "2027-03-04",
            status: "cancelled",
            updatedAt: "2026-08-20T09:00:00Z",
            cancellation: {
              cancelledAt: "2026-08-20T09:00:00Z",
              cancelledByProfileId: "6f1b1a0c-2c4e-4f7a-9b3d-8a2c1e5f0d77",
            },
          },
        ],
      },
    }),
    false,
  );
});

test("saving the stage's own suggestion still counts as having done nothing", () => {
  // 온보딩 마지막 화면은 고른 단계의 제안값으로 19항목을 미리 채우고, "저장하고
  // 시작하기"를 누르면 그대로 저장된다. 그걸 만든 데이터로 세면 just_started가 아닌
  // 단계를 고른 사람 — 5개 중 4개 — 이 첫 도착 화면도, 그 안에만 있는 초대 안내
  // 단계도 한 번도 못 본다.
  const stage = "venue_booked";
  const savedSuggestion = {
    __stage: stage,
    __preferences: { weddingStyle: "natural" },
    venue: { status: "completed" },
    meeting: { status: "completed" },
  };

  const recorded = readRecordedCategoryStatuses(savedSuggestion);
  assert.deepEqual(recorded, { venue: "completed", meeting: "completed" });
  assert.equal(isOnlyStageSuggestion(recorded, stage), true);
  assert.equal(
    hasCoupleMadeData({
      progress: savedSuggestion,
      ignoredCategoryKeys: Object.keys(recorded),
    }),
    false,
  );

  // 한 칸이라도 손으로 고쳤으면 진짜 입력이다 — 계약이 false를 주고, 그러면 무시할
  // 키가 없으므로 첫 도착 화면은 물러난다.
  const edited = {
    ...savedSuggestion,
    studio: { status: "in_progress" },
  };
  const editedRecorded = readRecordedCategoryStatuses(edited);
  assert.equal(isOnlyStageSuggestion(editedRecorded, stage), false);
  assert.equal(hasCoupleMadeData({ progress: edited, ignoredCategoryKeys: [] }), true);

  // 제안값과 같은 칸이라도 그 옆에 사람이 적은 것(예산)이 붙어 있으면 만든 데이터다.
  assert.equal(
    hasCoupleMadeData({
      progress: {
        ...savedSuggestion,
        venue: { status: "completed", budget: 30_000_000 },
      },
      ignoredCategoryKeys: ["venue", "meeting"],
    }),
    true,
  );

  // 일정과 상담 기록은 단계와 무관하게 언제나 만든 데이터다.
  assert.equal(
    hasCoupleMadeData({
      progress: {
        ...savedSuggestion,
        __events: [{ id: "e1", title: "본식 상담", date: "2027-03-04", createdBy: null }],
      },
      ignoredCategoryKeys: Object.keys(recorded),
    }),
    true,
  );
  assert.equal(
    hasCoupleMadeData({
      progress: savedSuggestion,
      bookingOutcomeTasks: [{ id: "b1" }],
      ignoredCategoryKeys: Object.keys(recorded),
    }),
    true,
  );
});

test("the lounge asks the shared contract, not a second copy of the rule", () => {
  // 웹은 이미 같은 계약(`isOnlyStageSuggestion`)으로 판정한다. 앱이 자기 규칙을 따로
  // 들면 같은 커플의 두 사람이 서로 다른 첫 화면을 본다.
  assert.match(loungeSource, /isOnlyStageSuggestion\(/);
  assert.match(loungeSource, /readRecordedCategoryStatuses\(data\.progress\)/);
  assert.match(loungeSource, /ignoredCategoryKeys:/);
  // 규칙을 앱 안에 베껴두지 않는다.
  assert.doesNotMatch(
    readSource("../lib/loungeFirstArrival.mjs"),
    /PREPARATION_STAGE_OPTIONS|suggested/,
  );
});

test("the lounge decides by data alone — there is no first-arrival flag", () => {
  assert.match(loungeSource, /hasCoupleMadeData\(\{/);
  // 플래그를 만들면 언젠가 데이터와 어긋난다. 저장소 어디에도 적지 않는다.
  assert.doesNotMatch(arrivalSource, /AsyncStorage|SecureStore/);
  assert.doesNotMatch(
    loungeSource,
    /firstArrival[A-Za-z]*(Seen|Shown|Dismissed|Completed)/,
  );
});

/* ─────────────────────────────────────────────
   (c) 말하지 않은 것은 화면에 줄이 없다
   ───────────────────────────────────────────── */

test("nothing the couple did not say gets a line", () => {
  const now = Date.UTC(2026, 7, 20);

  const silent = buildLoungeFirstRunView({
    weddingDate: null,
    preparationStage: null,
    weddingStyleLabel: null,
    partnerLinked: true,
    now,
  });
  const silentLabels = silent.echo.map((line) => line.label);
  assert.ok(!silentLabels.includes("지금"));
  assert.ok(!silentLabels.includes("원하는 분위기"));
  assert.equal(silent.invite, null);

  const spoken = buildLoungeFirstRunView({
    weddingDate: "2027-05-15",
    preparationStage: "venue_hunting",
    weddingStyleLabel: "편안한 분위기",
    partnerLinked: false,
    now,
  });
  assert.deepEqual(
    spoken.echo.map((line) => line.label),
    ["결혼식", "지금", "원하는 분위기"],
  );
  assert.ok(spoken.echo.some((line) => line.value === "편안한 분위기"));
  assert.ok(spoken.invite);
});

test("a style the couple never picked yields no value to label", () => {
  assert.equal(readWeddingStyleValue({}), null);
  assert.equal(readWeddingStyleValue({ __preferences: {} }), null);
  assert.equal(readWeddingStyleValue({ __preferences: { priorities: [] } }), null);
  assert.equal(readWeddingStyleValue(null), null);
  assert.equal(
    readWeddingStyleValue({ __preferences: { weddingStyle: "natural" } }),
    "natural",
  );
});

test("the lounge only labels a style it can name, and never invents one", () => {
  // 모르는 값이면 null이고, null이면 계약이 그 줄을 만들지 않는다.
  assert.match(
    loungeSource,
    /WEDDING_STYLE_OPTIONS\.find\(\(option\) => option\.value === value\)\?\.label\s*\?\?\s*null/,
  );
});

/* ─────────────────────────────────────────────
   (d) 앵커는 하나도 사라지지 않는다
   ───────────────────────────────────────────── */

test("every anchor the coach marks can point at is still in the tree", () => {
  const anchored = new Set(
    [...`${homeExperienceSource}\n${fabSource}\n${loungeSource}\n${arrivalSource}`.matchAll(
      /(?:FirstRunAnchor\s+id="([a-z-]+)"|anchorId = "([a-z-]+)")/g,
    )].map((match) => match[1] ?? match[2]),
  );

  // 첫 도착 화면이 들어오기 전부터 있던 앵커들. 하나라도 없어지면 그 안내 단계가
  // 조용히 건너뛰어진다 — 이 저장소가 이미 한 번 겪은 사고다.
  assert.ok(anchored.has("lounge-focus"));
  assert.ok(anchored.has("lounge-tools"));
  assert.ok(anchored.has("amora-fab"));
  // 첫 도착 화면이 새로 채워준 앵커. 초대 카드가 있는 사람에게만 생긴다.
  assert.ok(anchored.has("lounge-invite"));

  for (const step of firstRunTutorialContract.FIRST_RUN_TUTORIAL_STEPS) {
    assert.ok(
      anchored.has(step.id),
      `안내 단계 "${step.id}"를 가리킬 앵커가 라운지에 없습니다`,
    );
  }
});

test("the first arrival cards stay direct children of the scroll content", () => {
  // 앵커의 스크롤 위치는 onLayout y로 잡는데 그 y는 부모 기준이다. 카드들을 한 겹
  // 감싸면 초대 카드의 y가 어긋나고, 안내는 엉뚱한 데로 스크롤한 뒤 건너뛴다.
  assert.match(arrivalSource, /return \(\s*<Fragment>/);
  assert.match(homeExperienceSource, /\{firstArrival\}/);
  assert.match(homeExperienceSource, /\{emptyNote\}/);
});

/* ─────────────────────────────────────────────
   (e) 목적지는 전부 실재하는 화면이다
   ───────────────────────────────────────────── */

/**
 * expo-router 경로가 가리키는 파일. 없으면 null.
 *
 * 목적지에 `?entry=...`가 붙을 수 있다 — 아모라로 가는 문이 여럿이라, 어느 문에서 왔는지를
 * 대화 화면에 들려 보낸다. 화면이 실재하는지는 경로 부분만으로 판단한다.
 */
function resolveRoute(route) {
  const base = `../../app${route.split("?")[0]}`;
  for (const candidate of [`${base}.tsx`, `${base}/index.tsx`]) {
    const path = resolveRepoPath(candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

test("every destination in the contract is mapped to a screen that exists", () => {
  const union = /export type LoungeFirstRunDestination =([^;]+);/.exec(
    loungeFirstRunSource,
  );
  assert.ok(union, "계약에서 목적지 목록을 읽지 못했습니다");
  const destinations = [...union[1].matchAll(/"([a-z]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(destinations.sort(), [
    "amora",
    "budget",
    "checklist",
    "price",
    "schedule",
  ]);

  const mapped = new Map(
    [...arrivalSource.matchAll(
      /case "([a-z]+)":\s*router\.push\("([^"]+)"\);/g,
    )].map((match) => [match[1], match[2]]),
  );

  assert.deepEqual([...mapped.keys()].sort(), destinations);
  for (const [destination, route] of mapped) {
    assert.ok(
      resolveRoute(route),
      `목적지 "${destination}"의 경로 ${route}에 해당하는 화면이 없습니다`,
    );
  }

  // 아모라로 가는 문은 자기가 어느 문인지 들고 가야 한다. 파라미터가 빠지면 첫 도착
  // 카드를 누른 사람과 그냥 탭을 누른 사람이 완전히 같은 빈 대화를 만난다.
  const amoraRoute = mapped.get("amora");
  assert.match(amoraRoute, /\?entry=/);
  const entry = new URLSearchParams(amoraRoute.split("?")[1]).get("entry");
  assert.ok(
    chatEntryModule.AMORA_CHAT_ENTRY_VALUES.includes(entry),
    `대화 화면이 모르는 진입구 "${entry}"로 보냅니다`,
  );
  assert.ok(chatEntryModule.getAmoraChatEntryPrefill(entry));
});

test("the invite card opens the screen that actually shows our own code", () => {
  const invite = /function openInvite\(\) \{\s*router\.push\("([^"]+)"\);/.exec(
    arrivalSource,
  );
  assert.ok(invite, "초대 카드의 목적지를 읽지 못했습니다");
  assert.ok(resolveRoute(invite[1]));
  // `/invite`는 파트너가 보낸 링크의 착지 화면이라 내 코드를 보여주지 않는다.
  assert.notEqual(invite[1], "/invite");
  const inviteScreen = readFileSync(resolveRoute(invite[1]), "utf8");
  assert.match(inviteScreen, /InviteCodeCard/);
});

/* ─────────────────────────────────────────────
   (f) 새 네이티브 의존성이 없다
   ───────────────────────────────────────────── */

test("the first arrival screen adds no new dependency and no native config", () => {
  const packageJson = JSON.parse(readSource("../../package.json"));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);

  const specifiers = [
    ...arrivalSource.matchAll(/from "([^"]+)"/g),
    ...readSource("../lib/loungeFirstArrival.mjs").matchAll(/from "([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(specifiers.length > 0);

  for (const specifier of specifiers) {
    if (specifier.startsWith(".") || specifier.startsWith("@/")) continue;
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    assert.ok(
      declared.has(packageName),
      `첫 도착 화면이 package.json에 없는 "${packageName}"을 씁니다`,
    );
  }

  // 네이티브 설정은 손대지 않는다 — 첫 도착 화면은 순수 화면이라 그럴 이유가 없다.
  const appJson = JSON.parse(readSource("../../app.json"));
  assert.ok(Array.isArray(appJson.expo.plugins));
  assert.ok(!JSON.stringify(appJson).includes("firstArrival"));
});
