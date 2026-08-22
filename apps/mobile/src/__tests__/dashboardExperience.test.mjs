import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  HOME_SERVICES,
  applyDashboardActionOutcomeFeedback,
  buildCompanionHomeBrief,
  buildDashboardFocus,
  buildDashboardRecommendationDisclosure,
  calculateChecklistProgress,
  formatLocalDateKey,
  getWeddingMomentMessage,
  listDashboardOpenActions,
  parseDashboardOpenAction,
  resolveDashboardServiceRoute,
  selectDashboardOpenAction,
  selectDashboardReceiptAction,
} from "../lib/dashboardExperience.mjs";
import {
  consumeCompanionChatHandoff,
  readPrivateChatHandoffPromptFromUrl,
  stageCompanionChatHandoff,
} from "../lib/companionChatHandoff.mjs";

const nodeRequire = createRequire(import.meta.url);

function createDeepModuleStub() {
  const callable = function dashboardTestStub() {};
  return new Proxy(callable, {
    get(_target, property) {
      if (property === "__esModule") return true;
      if (property === Symbol.toPrimitive) return () => "stub";
      return createDeepModuleStub();
    },
  });
}

function loadDashboardModuleForTest() {
  const typescript = nodeRequire("typescript");
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      jsx: typescript.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const requireForDashboard = (specifier) => {
    if (specifier === "react-native") {
      return { StyleSheet: { create: (value) => value } };
    }
    if (specifier === "@/constants/checklists") {
      return { CATEGORY_CHECKLISTS: [] };
    }
    return createDeepModuleStub();
  };
  const evaluate = new Function("require", "module", "exports", compiled);
  evaluate(requireForDashboard, module, module.exports);
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** expo-router 경로가 가리키는 파일. 없으면 null. */
function resolveRoute(route) {
  const base = `../../app${route}`;
  for (const candidate of [`${base}.tsx`, `${base}/index.tsx`]) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  return null;
}

const emptyInput = {
  hasCouple: true,
  weddingDate: "2027-05-15",
  todayTasks: [],
  urgentTasks: [],
  bookingOutcomeTasks: [],
  openAction: null,
};

test("an A-to-B account switch rejects A's delayed core dashboard commit", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  assert.equal(typeof createDashboardLoadCoordinator, "function");

  const coordinator = createDashboardLoadCoordinator();
  const accountA = "11111111-1111-4111-8111-111111111111";
  const accountB = "22222222-2222-4222-8222-222222222222";
  const delayedActorRead = deferred();
  const accountATicket = coordinator.beginLoad();
  const accountAVerification = coordinator.verifyCurrentOwner(
    accountATicket,
    accountA,
    () => delayedActorRead.promise,
  );

  coordinator.invalidateSession();
  const accountBTicket = coordinator.beginLoad();
  assert.equal(
    await coordinator.verifyCurrentOwner(accountBTicket, accountB, async () => accountB),
    true,
  );

  delayedActorRead.resolve(accountB);
  assert.equal(await accountAVerification, false);
});

test("a same-owner couple switch rejects the old couple's delayed dashboard commit", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleA = "22222222-2222-4222-8222-222222222222";
  const coupleB = "33333333-3333-4333-8333-333333333333";
  const ticket = coordinator.beginLoad();

  assert.equal(
    await coordinator.verifyCurrentIdentity(
      ticket,
      { ownerUserId, coupleId: coupleA },
      async () => ({ ownerUserId, coupleId: coupleB }),
    ),
    false,
  );
  assert.equal(
    await coordinator.verifyCurrentIdentity(
      ticket,
      { ownerUserId, coupleId: coupleA },
      async () => ({ ownerUserId, coupleId: null }),
    ),
    false,
  );
  assert.equal(
    coordinator.mergeForIdentity(
      ticket,
      { ownerUserId, coupleId: coupleA },
      { ownerUserId, coupleId: coupleB, bookingOutcomeTasks: [] },
      { bookingOutcomeTasks: [{ id: "couple-a-booking" }] },
    ).bookingOutcomeTasks.length,
    0,
  );
});

test("a missed same-owner couple change is sealed on app resume and realtime reconnect", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleA = "22222222-2222-4222-8222-222222222222";
  const coupleB = "33333333-3333-4333-8333-333333333333";
  const delayedCoupleAPatch = deferred();
  const staleTicket = coordinator.beginLoad();
  let visibleData = {
    ownerUserId,
    coupleId: coupleA,
    bookingOutcomeTasks: [],
  };

  const staleCommit = (async () => {
    const patch = await delayedCoupleAPatch.promise;
    visibleData = coordinator.mergeForIdentity(
      staleTicket,
      { ownerUserId, coupleId: coupleA },
      visibleData,
      patch,
    );
    return visibleData;
  })();

  // Canonical identity가 실제로 달라진 경우에만 hard session 경계를
  // 적용하며, 그 경계는 이전 couple의 늦은 commit을 폐기한다.
  coordinator.invalidateSession();
  visibleData = null;
  assert.equal(visibleData, null);

  const currentTicket = coordinator.beginLoad();
  assert.equal(
    await coordinator.verifyCurrentIdentity(
      currentTicket,
      { ownerUserId, coupleId: coupleB },
      async () => ({ ownerUserId, coupleId: coupleB }),
    ),
    true,
  );

  delayedCoupleAPatch.resolve({
    bookingOutcomeTasks: [{ id: "couple-a-booking" }],
  });
  assert.equal(await staleCommit, null);

  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");
  assert.match(source, /AppState\.addEventListener\(\s*"change"/);
  assert.match(
    source,
    /previousAppState[\s\S]{0,300}nextAppState === "active"[\s\S]{0,420}scheduleDashboardIdentityReconciliation\([\s\S]{0,180}subscribedIdentity[\s\S]{0,180}getPinnedActionReceiptLease\(\)\?\.identity/,
  );
  assert.match(
    source,
    /\.subscribe\(\(status\)[\s\S]{0,500}status === "SUBSCRIBED"[\s\S]{0,500}scheduleDashboardIdentityReconciliation\(expectedIdentity\)/,
  );
  assert.match(
    source,
    /if \(!hasSubscribed\) \{\s*hasSubscribed = true;\s*return;\s*\}[\s\S]{0,260}scheduleDashboardIdentityReconciliation\(expectedIdentity\)/,
  );
});

test("A's delayed booking and partner data cannot merge into B's dashboard", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const accountA = "11111111-1111-4111-8111-111111111111";
  const accountB = "22222222-2222-4222-8222-222222222222";
  const accountATicket = coordinator.beginLoad();
  const accountAData = {
    ownerUserId: accountA,
    bookingOutcomeTasks: [],
    partnerActivity: null,
  };
  assert.equal(
    await coordinator.verifyCurrentOwner(accountATicket, accountA, async () => accountA),
    true,
  );

  const delayedAuxiliaryData = deferred();
  const accountAAuxiliaryCommit = (async () => {
    const patch = await delayedAuxiliaryData.promise;
    return coordinator.mergeForOwner(
      accountATicket,
      accountA,
      {
        ownerUserId: accountB,
        bookingOutcomeTasks: [],
        partnerActivity: null,
      },
      patch,
    );
  })();

  coordinator.invalidateSession();
  coordinator.beginLoad();
  delayedAuxiliaryData.resolve({
    bookingOutcomeTasks: [{ id: "account-a-booking" }],
    partnerActivity: { partnerName: "A partner" },
  });

  assert.deepEqual(await accountAAuxiliaryCommit, {
    ownerUserId: accountB,
    bookingOutcomeTasks: [],
    partnerActivity: null,
  });
  assert.equal(accountAData.ownerUserId, accountA);
});

test("an auth change invalidates stale realtime dashboard callbacks", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const subscribedSession = 0;

  assert.equal(coordinator.isSessionCurrent(subscribedSession), true);
  coordinator.invalidateSession();
  assert.equal(coordinator.isSessionCurrent(subscribedSession), false);
});

test("an initial auth interleaving leaves exactly one current-couple realtime channel", async () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const delayedInitialLoad = deferred();
  const activeChannels = [];

  const initialize = async (loadPromise, coupleId) => {
    const sessionGeneration = coordinator.currentSessionGeneration();
    await loadPromise;
    if (!coordinator.isSessionCurrent(sessionGeneration)) return;
    activeChannels.push({ sessionGeneration, coupleId });
  };

  const staleInitialization = initialize(delayedInitialLoad.promise, "couple-a");
  coordinator.invalidateSession();
  const currentInitialization = initialize(Promise.resolve(), "couple-b");
  delayedInitialLoad.resolve();
  await Promise.all([staleInitialization, currentInitialization]);

  assert.deepEqual(activeChannels, [{ sessionGeneration: 1, coupleId: "couple-b" }]);

  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");
  assert.match(source, /event === "INITIAL_SESSION"/);
  assert.match(source, /clearDashboardSession\(\)[\s\S]{0,300}scheduleInitialization\(\)/);
  assert.match(
    source,
    /dashboard:\$\{expectedIdentity\.ownerUserId\}:\$\{coupleId \?\? "unlinked"\}:\$\{subscriptionSessionGeneration\}/,
  );
  assert.match(source, /useFocusEffect\(/);
  assert.match(
    source,
    /table: "profiles",\s*filter: `id=eq\.\$\{expectedIdentity\.ownerUserId\}`/,
  );
  assert.match(source, /restartDashboardSession\(\)/);
  const initializationStart = source.indexOf("const initializeDashboardSession = async () =>");
  const initializationEnd = source.indexOf("const scheduleInitialization = () =>", initializationStart);
  assert.ok(initializationStart >= 0 && initializationEnd > initializationStart);
  const initializationSource = source.slice(initializationStart, initializationEnd);
  assert.doesNotMatch(initializationSource, /data\?\.ownerUserId\s*\?\?/);
});

test("a same-couple action receipt defers background home reload until acknowledgement", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };

  const leaseToken = coordinator.beginActionReceiptLease(
    identity,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");
  assert.equal(coordinator.getPinnedActionReceiptLease()?.phase, "provisional");
  assert.equal(coordinator.confirmActionReceiptLease(identity, leaseToken), true);
  assert.equal(coordinator.getPinnedActionReceiptLease()?.phase, "confirmed");
  assert.equal(coordinator.deferReloadForPinnedReceipt(identity), true);
  assert.equal(coordinator.hasPinnedActionReceipt(identity), true);
  assert.deepEqual(coordinator.releasePinnedActionReceipt(identity, leaseToken), {
    released: true,
    hadDeferredReload: true,
  });
  assert.equal(coordinator.hasPinnedActionReceipt(identity), false);
  assert.equal(coordinator.deferReloadForPinnedReceipt(identity), false);
});

test("manual refresh never releases a provisional outcome before its canonical receipt", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };
  const leaseToken = coordinator.beginActionReceiptLease(
    identity,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");

  const provisionalLease = coordinator.getPinnedActionReceiptLease();
  assert.equal(provisionalLease?.phase, "provisional");
  assert.equal(coordinator.deferReloadForPinnedReceipt(identity), true);
  assert.equal(coordinator.hasPinnedActionReceipt(identity), true);

  assert.equal(coordinator.confirmActionReceiptLease(identity, leaseToken), true);
  const confirmedLease = coordinator.getPinnedActionReceiptLease();
  assert.equal(confirmedLease?.phase, "confirmed");
  assert.deepEqual(coordinator.releasePinnedActionReceipt(identity, leaseToken), {
    released: true,
    hadDeferredReload: true,
  });

  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");
  assert.match(
    source,
    /if \(pinnedLease\?\.phase === "provisional"\) \{\s*loadCoordinatorRef\.current\.deferReloadForPinnedReceipt\(pinnedLease\.identity\);\s*setRefreshing\(false\);\s*return;/,
  );
});

test("a provisional receipt lease invalidates an older home load before the outcome write", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };
  const oldLoad = coordinator.beginLoad();

  const leaseToken = coordinator.beginActionReceiptLease(
    identity,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");
  assert.equal(coordinator.isCurrent(oldLoad), false);
  assert.equal(coordinator.hasPinnedActionReceipt(identity), true);
  assert.deepEqual(coordinator.releasePinnedActionReceipt(identity, leaseToken), {
    released: true,
    hadDeferredReload: true,
  });
});

test("a new receipt lease also stops an explicit refresh that began first", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };
  const explicitRefresh = coordinator.beginLoad();

  const leaseToken = coordinator.beginActionReceiptLease(
    identity,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");
  assert.equal(coordinator.isCurrent(explicitRefresh), false);
  const firstRelease = coordinator.releasePinnedActionReceipt(identity, leaseToken);
  const replayedRelease = coordinator.releasePinnedActionReceipt(identity, leaseToken);
  assert.equal(firstRelease.released, true);
  assert.equal(firstRelease.hadDeferredReload, true);
  assert.equal(replayedRelease.released, false);
});

test("acknowledging a pinned receipt drains at most one latest home reload", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };
  let reloads = 0;

  const leaseToken = coordinator.beginActionReceiptLease(
    identity,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");
  if (!coordinator.deferReloadForPinnedReceipt(identity)) reloads += 1;
  const firstRelease = coordinator.releasePinnedActionReceipt(identity, leaseToken);
  if (firstRelease.released) reloads += 1;
  const replayedRelease = coordinator.releasePinnedActionReceipt(identity, leaseToken);
  if (replayedRelease.released) reloads += 1;

  assert.equal(firstRelease.hadDeferredReload, true);
  assert.equal(replayedRelease.released, false);
  assert.equal(reloads, 1);
});

test("an identity reset discards a pinned receipt without draining it into the next couple", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identityA = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };
  const identityB = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "33333333-3333-4333-8333-333333333333",
  };

  const leaseToken = coordinator.beginActionReceiptLease(
    identityA,
    coordinator.currentSessionGeneration(),
  );
  assert.equal(typeof leaseToken, "number");
  coordinator.deferReloadForPinnedReceipt(identityA);
  coordinator.invalidateSession();

  assert.deepEqual(coordinator.releasePinnedActionReceipt(identityB, leaseToken), {
    released: false,
    hadDeferredReload: false,
  });
  assert.equal(coordinator.hasPinnedActionReceipt(identityA), false);
  assert.equal(coordinator.hasPinnedActionReceipt(identityB), false);
});

test("a late ABA callback cannot confirm or release a newer same-couple receipt lease", () => {
  const { createDashboardLoadCoordinator } = loadDashboardModuleForTest();
  const coordinator = createDashboardLoadCoordinator();
  const identity = {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
  };

  const sessionA = coordinator.currentSessionGeneration();
  const leaseA = coordinator.beginActionReceiptLease(identity, sessionA);
  assert.equal(typeof leaseA, "number");
  coordinator.invalidateSession();
  assert.equal(coordinator.beginActionReceiptLease(identity, sessionA), null);
  const sessionB = coordinator.currentSessionGeneration();
  const leaseB = coordinator.beginActionReceiptLease(identity, sessionB);
  assert.equal(typeof leaseB, "number");
  assert.notEqual(leaseA, leaseB);

  assert.equal(coordinator.confirmActionReceiptLease(identity, leaseA), false);
  assert.deepEqual(coordinator.releasePinnedActionReceipt(identity, leaseA), {
    released: false,
    hadDeferredReload: false,
  });
  assert.equal(coordinator.hasPinnedActionReceipt(identity), true);
  assert.equal(coordinator.confirmActionReceiptLease(identity, leaseB), true);
  assert.deepEqual(coordinator.releasePinnedActionReceipt(identity, leaseB), {
    released: true,
    hadDeferredReload: true,
  });
});

test("dashboard binds receipt pin, deferred realtime, and explicit acknowledgement to one coordinator", () => {
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");

  assert.match(source, /onReceiptPinned=\{\(receiptIdentity, leaseToken\) =>[\s\S]{0,220}confirmActionReceiptLease\([\s\S]{0,120}leaseToken/);
  assert.match(source, /const scheduleReload = \(\) => \{[\s\S]{0,220}deferReloadForPinnedReceipt\(\)/);
  assert.match(source, /useFocusEffect\([\s\S]{0,900}getPinnedActionReceiptLease\(\)[\s\S]{0,900}deferReloadForPinnedReceipt\(pinnedLease\.identity\)/);
  assert.match(source, /deferReloadForPinnedReceipt\(expectedIdentity\)/);
  assert.match(source, /onReceiptSubmissionStarted=\{\(receiptIdentity\) =>[\s\S]{0,220}beginActionReceiptLease\([\s\S]{0,100}receiptLeaseSessionGeneration/);
  assert.match(source, /onReceiptSubmissionAborted=\{async \(receiptIdentity, leaseToken\) =>[\s\S]{0,420}releasePinnedActionReceipt\([\s\S]{0,120}leaseToken/);
  assert.match(
    source,
    /onReceiptAcknowledged=\{async \(_receipt, receiptIdentity, leaseToken\) => \{[\s\S]{0,320}releasePinnedActionReceipt\([\s\S]{0,180}leaseToken[\s\S]{0,180}loadData\(\)/,
  );
  assert.doesNotMatch(source, /allowPinnedReceiptCommit/);
});

test("same-identity resume, reconnect, and profile events reconcile before a hard reset", () => {
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");

  const reconciliationStart = source.indexOf("const scheduleDashboardIdentityReconciliation = (");
  const initializationStart = source.indexOf("const initializeDashboardSession = async () =>", reconciliationStart);
  assert.ok(reconciliationStart >= 0 && initializationStart > reconciliationStart);
  const reconciliationSource = source.slice(reconciliationStart, initializationStart);
  assert.match(reconciliationSource, /await readCurrentIdentity\(\)/);
  assert.match(reconciliationSource, /currentIdentity\?\.ownerUserId === expectedIdentity\.ownerUserId/);
  assert.match(reconciliationSource, /currentIdentity\?\.coupleId === expectedIdentity\.coupleId/);
  assert.match(reconciliationSource, /scheduleReload\(\)/);
  assert.match(reconciliationSource, /restartDashboardSession\(\)/);

  assert.match(
    source,
    /nextAppState === "active"[\s\S]{0,320}scheduleDashboardIdentityReconciliation\([\s\S]{0,180}subscribedIdentity[\s\S]{0,180}getPinnedActionReceiptLease\(\)\?\.identity/,
  );
  assert.match(source, /table: "profiles"[\s\S]{0,260}scheduleDashboardIdentityReconciliation\(expectedIdentity\)/);
  assert.match(source, /status === "SUBSCRIBED"[\s\S]{0,300}scheduleDashboardIdentityReconciliation\(expectedIdentity\)/);
});

test("a coupled member with no date starts from Amora's state review and keeps the direct date editor optional", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    weddingDate: null,
  });

  assert.equal(focus.kind, "setup");
  assert.equal(focus.route, "/(tabs)/chat");
  assert.match(focus.title, /준비 상태/);
  assert.match(focus.description, /정해진 게 없어도/);
  assert.match(focus.description, /이미 한 준비/);
  assert.equal(focus.ctaLabel, "내 준비 상태 확인하기");
  assert.deepEqual(focus.alternateAction, {
    label: "날짜만 바로 설정",
    route: "/settings",
    settingsFocus: "weddingDate",
  });

  const unlinkedFocus = buildDashboardFocus({
    ...emptyInput,
    hasCouple: false,
    weddingDate: null,
  });
  assert.equal(unlinkedFocus.route, "/onboarding");
  assert.equal(unlinkedFocus.alternateAction, undefined);

  const experienceSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");
  const settingsSource = readFileSync(fileURLToPath(new URL(
    "../../app/settings/index.tsx",
    import.meta.url,
  )), "utf8");
  assert.match(
    experienceSource,
    /openAlternateFocus[\s\S]*pathname:\s*"\/settings"[\s\S]*focus:\s*alternateAction\.settingsFocus/,
  );
  assert.match(settingsSource, /useLocalSearchParams<\{ focus\?: string \}>\(\)/);
  assert.match(settingsSource, /autoFocus=\{requestedFocus === "weddingDate"\}/);

  const brief = buildCompanionHomeBrief({ focus, partnerActivity: null });
  const handoffId = "44444444-4444-4444-8444-444444444444";
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    stageCompanionChatHandoff({ handoffId, ownerUserId, coupleId, brief }),
    handoffId,
  );
  const handoff = consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId);
  assert.match(handoff?.prompt ?? "", /무엇부터 물어봐야 할지 몰라도/);
  assert.match(handoff?.prompt ?? "", /준비 상태/);
  assert.match(handoff?.prompt ?? "", /한 번에 하나만/);
  assert.doesNotMatch(handoff?.prompt ?? "", /자동으로 저장|바로 공유/);
});

test("the date fix lands on a screen that can actually edit the wedding date", () => {
  const focus = buildDashboardFocus({ ...emptyInput, weddingDate: null });
  // 이 브랜치에서 날짜를 고치러 가는 곳은 주 동선이 아니라 대체 동선이다.
  // 주 동선은 준비 상태 확인(채팅)이고, 날짜만 고칠 사람을 위해 설정을 따로 연다.
  const dateFixRoute = focus.alternateAction.route;

  // 목적지 화면이 실재하고, 그 화면에 결혼 예정일 입력이 실제로 있어야 한다.
  // 없는 화면이나 못 고치는 화면으로 보내는 것은 버튼이 없는 것보다 나쁘다.
  const screen = resolveRoute(dateFixRoute);
  assert.ok(screen, `${dateFixRoute}에 해당하는 화면이 없습니다`);
  const source = readFileSync(screen, "utf8");
  assert.match(source, /결혼 예정일/);
  assert.match(source, /updateField\("weddingDate", v\)/);

  // 라운지 화면이 그 경로를 실제로 열 수 있어야 한다 — switch에 case가 없으면 버튼이
  // 아무 일도 하지 않는다.
  const homeExperience = readFileSync(
    fileURLToPath(new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url)),
    "utf8",
  );
  assert.ok(
    homeExperience.includes("openAlternateFocus(focus.alternateAction)"),
    "라운지 화면이 대체 동선을 열지 않습니다",
  );
});

test("an overdue preparation item takes priority over lower-risk work", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "청첩장 문구 정하기", categoryKey: "invitation" }],
    urgentTasks: [
      {
        categoryKey: "venue",
        categoryLabel: "결혼식장",
        remainingDays: -4,
        urgency: "overdue",
      },
    ],
    bookingOutcomeTasks: [
      {
        id: "booking-1",
        vendorName: "샘플 업체",
        categoryLabel: "스튜디오",
        bookingDate: "2026-07-29",
        isPast: true,
      },
    ],
  });

  assert.equal(focus.kind, "today");
  assert.equal(focus.route, "/schedule");
  assert.equal(focus.title, "청첩장 문구 정하기");
  assert.doesNotMatch(focus.description, /기본 확인 시점/);
});

test("home does not present checklist completion as overall wedding progress", () => {
  const homeSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");
  const dashboardSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/dashboard.tsx",
    import.meta.url,
  )), "utf8");

  assert.doesNotMatch(homeSource, /data\.progressPercent|준비 진행|contextProgressTrack/u);
  assert.doesNotMatch(dashboardSource, /calculateChecklistProgress|progressPercent/u);
  assert.match(homeSource, /buildPreparationHomeStatusModel/u);
  assert.match(homeSource, /preparationStatus\.boundaryLabel/u);
});

test("a task saved for today becomes the focus when nothing is urgent", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "양가에 예식 시간 알리기", categoryKey: "family" }],
  });

  assert.equal(focus.kind, "today");
  assert.equal(focus.route, "/schedule");
  assert.equal(focus.title, "양가에 예식 시간 알리기");
});

test("a reviewed open Amora action continues on home immediately, even before the date is known", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const openAction = parseDashboardOpenAction({
    id: "act_first_step",
    couple_id: coupleId,
    title: "이번 주 가능한 예식 시기 두 개 적기",
    description: "정확한 날짜를 몰라도 다음 준비의 기준을 만들 수 있어요.",
    due_date: null,
    priority: "medium",
    source: "chat",
    status: "open",
    follow_up_revision: 3,
    created_at: "2026-08-14T02:00:00.000Z",
  }, coupleId);

  assert.ok(openAction);
  const focus = buildDashboardFocus({
    ...emptyInput,
    weddingDate: null,
    openAction,
  });

  assert.equal(focus.kind, "action");
  assert.equal(openAction.sourceRevision, 3);
  assert.match(focus.selectionReason, /저장|마감|행동/);
  assert.equal(focus.claimBeforeCare, false);
  assert.equal(focus.title, "이번 주 가능한 예식 시기 두 개 적기");
  assert.equal(focus.route, "/(tabs)/chat");
  assert.equal(focus.ctaLabel, "아모라와 이어서 보기");
  assert.match(focus.description, /공동 준비 기록에 저장된 다음 행동/);
  assert.doesNotMatch(focus.description, /마감일/);
});

test("home shows an exact confirmed action deadline without asking for it again", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    openAction: {
      id: "act_family_dates",
      title: "양가에 가능한 날짜 물어보기",
      description: "세 개의 후보만 받아요.",
      dueDate: "2028-02-29",
      categoryKey: null,
      priority: "medium",
      source: "chat",
      createdAt: "2026-08-14T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "action");
  assert.match(focus.description, /마감일은 2028년 2월 29일/);
  assert.match(focus.description, /세 개의 후보만 받아요/);
});

test("a checklist-bound home focus preserves the exact action identity and revision", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    openAction: {
      id: "act_exact_meeting_step",
      title: "양가에 가능한 날짜 물어보기",
      description: null,
      dueDate: "2026-08-20",
      categoryKey: "meeting",
      priority: "high",
      source: "chat",
      sourceRevision: 7,
      createdAt: "2026-08-14T02:00:00.000Z",
    },
  });

  assert.equal(focus.route, "/checklist");
  assert.equal(focus.categoryKey, "meeting");
  assert.equal(focus.actionId, "act_exact_meeting_step");
  assert.equal(focus.actionRevision, 7);
});

test("home explains an overdue action using only its confirmed date", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayYmd: "2026-08-15",
    openAction: {
      id: "act_overdue_family_reply",
      title: "양가 일정 답변 확인하기",
      description: null,
      dueDate: "2026-08-14",
      categoryKey: "meeting",
      priority: "low",
      source: "chat",
      createdAt: "2026-08-10T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "action");
  assert.equal(focus.claimBeforeCare, true);
  assert.match(focus.description, /저장한 마감일이 지나 먼저 확인할 일이에요/);
  assert.doesNotMatch(focus.description, /AI가 판단|가장 중요|성격/);
});

test("a confirmed overdue action outranks a heuristic checklist timing", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayYmd: "2026-08-15",
    urgentTasks: [{
      categoryKey: "venue",
      categoryLabel: "예식장",
      urgency: "soon",
      remainingDays: 3,
    }],
    openAction: {
      id: "act_confirmed_overdue",
      title: "양가 일정 답변 확인하기",
      description: null,
      dueDate: "2026-08-14",
      categoryKey: "meeting",
      priority: "low",
      source: "chat",
      createdAt: "2026-08-10T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "action");
  assert.equal(focus.title, "양가 일정 답변 확인하기");
  assert.match(focus.description, /저장한 마감일이 지나/);
  assert.doesNotMatch(focus.description, /기본 확인 시점/);
});

test("a user-confirmed high priority action outranks heuristic checklist timing", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayYmd: "2026-08-15",
    urgentTasks: [{
      categoryKey: "venue",
      categoryLabel: "예식장",
      urgency: "soon",
      remainingDays: 3,
    }],
    openAction: {
      id: "act_confirmed_high",
      title: "이번 주 가족 일정부터 맞추기",
      description: null,
      dueDate: null,
      categoryKey: "meeting",
      priority: "high",
      source: "chat",
      createdAt: "2026-08-15T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "action");
  assert.match(focus.description, /중요도를 ‘높음’으로 저장/);
});

test("an undated low priority action does not hide a heuristic checklist warning", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayYmd: "2026-08-15",
    urgentTasks: [
      {
        categoryKey: "meeting",
        categoryLabel: "부모님 첫 만남",
        urgency: "ontrack",
        remainingDays: 20,
      },
      {
        categoryKey: "venue",
        categoryLabel: "예식장",
        urgency: "soon",
        remainingDays: 3,
      },
    ],
    openAction: {
      id: "act_low_without_date",
      title: "언젠가 하객 아이디어 정리하기",
      description: null,
      dueDate: null,
      categoryKey: null,
      priority: "low",
      source: "chat",
      createdAt: "2026-08-15T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "urgent");
  assert.equal(focus.title, "예식장 준비를 먼저 확인해요");
  assert.equal(focus.categoryKey, "venue");
});

test("the next checklist recommendation preserves its exact preparation category", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [{
      categoryKey: "meeting",
      categoryLabel: "부모님 첫 만남",
      urgency: "ontrack",
      remainingDays: 20,
    }],
  });

  assert.equal(focus.kind, "next");
  assert.equal(focus.route, "/checklist");
  assert.equal(focus.categoryKey, "meeting");
});

test("a categorized Amora action opens the exact checklist instead of restarting chat", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const openAction = parseDashboardOpenAction({
    id: "act_dress_step",
    couple_id: coupleId,
    title: "드레스 투어 후보 두 곳 적기",
    description: "저장한 기준에 맞는 후보만 남겨요.",
    due_date: null,
    category_key: "dress",
    priority: "medium",
    source: "chat",
    status: "open",
    created_at: "2026-08-14T02:00:00.000Z",
  }, coupleId);

  assert.ok(openAction);
  const focus = buildDashboardFocus({
    ...emptyInput,
    openAction,
  });

  assert.equal(focus.kind, "action");
  assert.equal(focus.route, "/checklist");
  assert.equal(focus.categoryKey, "dress");
  assert.equal(focus.ctaLabel, "관련 체크리스트 보기");
});

test("budget and schedule actions continue in the planning surface that created them", () => {
  const baseAction = {
    id: "act_planning_step",
    title: "다음 준비 반영하기",
    description: null,
    dueDate: null,
    categoryKey: "meeting",
    priority: "medium",
    createdAt: "2026-08-14T02:00:00.000Z",
  };

  const budgetFocus = buildDashboardFocus({
    ...emptyInput,
    openAction: { ...baseAction, source: "budget" },
  });
  assert.equal(budgetFocus.route, "/budget");
  assert.equal(budgetFocus.categoryKey, "meeting");
  assert.equal(budgetFocus.ctaLabel, "예산에서 이어서 보기");

  const scheduleFocus = buildDashboardFocus({
    ...emptyInput,
    openAction: { ...baseAction, source: "schedule" },
  });
  assert.equal(scheduleFocus.route, "/schedule");
  assert.equal(scheduleFocus.ctaLabel, "일정에서 이어서 보기");
});

test("home never promotes a completed, malformed, or other-couple action", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const base = {
    id: "act_first_step",
    couple_id: coupleId,
    title: "가족에게 가능한 날짜 물어보기",
    description: "가능한 날짜를 먼저 확인해요.",
    due_date: null,
    priority: "medium",
    source: "chat",
    status: "open",
    follow_up_revision: 2,
    created_at: "2026-08-14T02:00:00.000Z",
  };

  assert.equal(parseDashboardOpenAction({ ...base, status: "done" }, coupleId), null);
  assert.equal(
    parseDashboardOpenAction({ ...base, follow_up_revision: 0 }, coupleId),
    null,
  );
  assert.equal(
    parseDashboardOpenAction({ ...base, due_date: "2026-02-31" }, coupleId),
    null,
  );
  assert.equal(
    parseDashboardOpenAction({ ...base, due_date: "2028-02-29" }, coupleId)?.dueDate,
    "2028-02-29",
  );
  assert.equal(
    parseDashboardOpenAction({ ...base, category_key: "private_other" }, coupleId),
    null,
  );
  assert.equal(parseDashboardOpenAction({ ...base, title: "\u202e숨은 방향 제어" }, coupleId), null);
  assert.equal(
    parseDashboardOpenAction({ ...base, title: "👰‍♀️ 드레스 취향 한 줄 적기" }, coupleId)?.title,
    "👰‍♀️ 드레스 취향 한 줄 적기",
  );
  assert.equal(
    parseDashboardOpenAction(
      { ...base, couple_id: "33333333-3333-4333-8333-333333333333" },
      coupleId,
    ),
    null,
  );

  const generalAction = parseDashboardOpenAction(
    { ...base, category_key: "general" },
    coupleId,
  );
  assert.equal(generalAction?.categoryKey, null);
  assert.equal(
    buildDashboardFocus({ ...emptyInput, openAction: generalAction }).route,
    "/(tabs)/chat",
  );
});

test("an action exposes only an exact immutable couple-criterion context receipt", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const criterionDecisionId = "40000000-0000-4000-8000-000000000001";
  const sourceMessageId = "50000000-0000-4000-8000-000000000001";
  const base = {
    id: "act_venue_contract_check",
    couple_id: coupleId,
    title: "예식장 계약서 특약 확인",
    description: null,
    due_date: null,
    category_key: "venue",
    priority: "medium",
    source: "chat",
    status: "open",
    follow_up_revision: 1,
    created_at: "2026-08-17T01:00:00.000Z",
  };
  const receipt = {
    version: 1,
    scope: "couple",
    criterionDecisionId,
    topicKey: "venue",
    affects: "action",
    sourceMessageId,
    sourceJourneyRevision: 7,
    actionRevision: 1,
  };

  assert.deepEqual(parseDashboardOpenAction({
    ...base,
    metadata: { amora_topic_criterion_context_v1: receipt },
  }, coupleId)?.criterionContext, receipt);
  assert.equal(parseDashboardOpenAction({
    ...base,
    metadata: {
      amora_topic_criterion_context_v1: { ...receipt, actionRevision: 2 },
    },
  }, coupleId)?.criterionContext, null);
  assert.equal(parseDashboardOpenAction({
    ...base,
    metadata: {
      amora_topic_criterion_context_v1: { ...receipt, topicKey: "studio" },
    },
  }, coupleId)?.criterionContext, null);
  assert.equal(parseDashboardOpenAction({
    ...base,
    metadata: { ordinary_metadata: true },
  }, coupleId)?.criterionContext, null);
});

test("home selects the most time-sensitive confirmed action instead of the newest action", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const base = {
    couple_id: coupleId,
    description: null,
    category_key: "general",
    source: "chat",
    status: "open",
  };

  const selected = selectDashboardOpenAction([
    {
      ...base,
      id: "act_newest_without_deadline",
      title: "새로 적어 둔 아이디어 정리하기",
      due_date: null,
      priority: "medium",
      created_at: "2026-08-15T08:00:00.000Z",
    },
    {
      ...base,
      id: "act_due_this_week",
      title: "이번 주 가족 일정 확인하기",
      due_date: "2026-08-18",
      priority: "medium",
      created_at: "2026-08-12T08:00:00.000Z",
    },
    {
      ...base,
      id: "act_overdue",
      title: "지나간 마감 다시 확인하기",
      due_date: "2026-08-14",
      priority: "low",
      created_at: "2026-08-10T08:00:00.000Z",
    },
  ], coupleId, "2026-08-15");

  assert.equal(selected?.id, "act_overdue");
});

test("topic action candidates reuse the same deterministic priority order as home", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const base = {
    couple_id: coupleId,
    description: null,
    category_key: "meeting",
    source: "chat",
    status: "open",
    follow_up_revision: 1,
  };
  const values = [
    {
      ...base,
      id: "act_later",
      title: "나중에 장소 확인하기",
      due_date: "2026-08-25",
      priority: "high",
      created_at: "2026-08-15T08:00:00.000Z",
    },
    {
      ...base,
      id: "act_overdue",
      title: "지난 날짜 다시 확인하기",
      due_date: "2026-08-14",
      priority: "low",
      created_at: "2026-08-10T08:00:00.000Z",
    },
    {
      ...base,
      id: "act_due_soon",
      title: "이번 주 참석자 확인하기",
      due_date: "2026-08-18",
      priority: "medium",
      created_at: "2026-08-12T08:00:00.000Z",
    },
  ];

  const ordered = listDashboardOpenActions(values, coupleId, "2026-08-15");
  assert.deepEqual(ordered.map((action) => action.id), [
    "act_overdue",
    "act_due_soon",
    "act_later",
  ]);
  assert.equal(
    selectDashboardOpenAction(values, coupleId, "2026-08-15")?.id,
    ordered[0]?.id,
  );
});

test("a current blocked result turns the same action into one bounded recovery step", () => {
  const openAction = {
    id: "act_family_schedule",
    title: "가족 일정 확인하기",
    description: null,
    dueDate: "2026-08-18",
    priority: "medium",
    source: "chat",
    categoryKey: "meeting",
    sourceRevision: 4,
    createdAt: "2026-08-14T08:00:00.000Z",
  };
  const baseFocus = buildDashboardFocus({
    ...emptyInput,
    todayYmd: "2026-08-15",
    openAction,
  });

  const recovered = applyDashboardActionOutcomeFeedback({
    focus: baseFocus,
    openAction,
    feedback: {
      outcomeId: "11111111-1111-4111-8111-111111111111",
      actionId: openAction.id,
      actionTitle: openAction.title,
      sourceRevision: 4,
      actionRevision: 4,
      actionStatus: "open",
      outcome: "blocked",
      blockerCode: "partner_check",
      recordedAt: "2026-08-15T08:00:00.000Z",
      validUntil: "2026-08-16T08:00:00.000Z",
    },
  });

  assert.equal(baseFocus.kind, "action");
  assert.equal(recovered.kind, "action");
  assert.equal(recovered.title, openAction.title);
  assert.equal(recovered.route, "/(tabs)/chat");
  assert.equal(recovered.ctaLabel, "질문 한 가지 정리하기");
  assert.equal(recovered.suppressActionFollowUpClaim, true);
  assert.match(recovered.description, /두 사람이 먼저 확인/);
  assert.match(recovered.feedbackNotice, /방금 남긴 결과/);
  assert.equal(recovered.feedbackApplied, true);
  assert.equal(recovered.feedbackOutcome, "blocked");
  assert.equal(baseFocus.suppressActionFollowUpClaim, undefined);
});

test("changed and uncertain results change help without changing the canonical action", () => {
  const openAction = {
    id: "act_invitation",
    title: "초대 범위 정리하기",
    description: "초대할 분의 범위를 한 번 확인해요.",
    dueDate: null,
    priority: "high",
    source: "manual",
    categoryKey: "invitation",
    sourceRevision: 9,
    createdAt: "2026-08-14T08:00:00.000Z",
  };
  const focus = buildDashboardFocus({ ...emptyInput, openAction });
  const baseFeedback = {
    outcomeId: "11111111-1111-4111-8111-111111111111",
    actionId: openAction.id,
    actionTitle: openAction.title,
    sourceRevision: 9,
    actionRevision: 9,
    actionStatus: "open",
    recordedAt: "2026-08-15T08:00:00.000Z",
    validUntil: "2026-08-16T08:00:00.000Z",
  };

  const changed = applyDashboardActionOutcomeFeedback({
    focus,
    openAction,
    feedback: { ...baseFeedback, outcome: "changed" },
  });
  assert.equal(changed.title, openAction.title);
  assert.equal(changed.ctaLabel, "바뀐 내용 다시 맞추기");
  assert.match(changed.description, /계획이 바뀌었다고/);

  const uncertain = applyDashboardActionOutcomeFeedback({
    focus,
    openAction,
    feedback: { ...baseFeedback, outcome: "not_sure" },
  });
  assert.equal(uncertain.title, openAction.title);
  assert.equal(uncertain.ctaLabel, "확인할 사실 하나 보기");
  assert.match(uncertain.description, /완료로 단정하지 않고/);
});

test("feedback acknowledges another priority but never rewrites a newer revision", () => {
  const openAction = {
    id: "act_current",
    title: "현재 행동",
    description: null,
    dueDate: null,
    priority: "medium",
    source: "chat",
    categoryKey: null,
    sourceRevision: 7,
    createdAt: "2026-08-14T08:00:00.000Z",
  };
  const focus = buildDashboardFocus({ ...emptyInput, openAction });
  const feedback = {
    outcomeId: "11111111-1111-4111-8111-111111111111",
    actionId: "act_previous",
    actionTitle: "이전 행동",
    sourceRevision: 6,
    actionRevision: 6,
    actionStatus: "open",
    outcome: "not_sure",
    recordedAt: "2026-08-15T08:00:00.000Z",
    validUntil: "2026-08-16T08:00:00.000Z",
  };

  const acknowledged = applyDashboardActionOutcomeFeedback({ focus, openAction, feedback });
  assert.equal(acknowledged.kind, focus.kind);
  assert.equal(acknowledged.title, focus.title);
  assert.equal(acknowledged.route, focus.route);
  assert.match(acknowledged.feedbackNotice, /이전 행동/);
  assert.match(acknowledged.feedbackNotice, /다음 한 가지/);
  assert.equal(
    applyDashboardActionOutcomeFeedback({
      focus,
      openAction,
      feedback: { ...feedback, actionId: openAction.id, actionRevision: 6 },
    }),
    focus,
  );
});

test("a completed result annotates the next grounded focus without reviving the done action", () => {
  const nextFocus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "드레스 피팅", categoryKey: "dress" }],
  });
  const completed = applyDashboardActionOutcomeFeedback({
    focus: nextFocus,
    openAction: null,
    feedback: {
      outcomeId: "11111111-1111-4111-8111-111111111111",
      actionId: "act_done",
      actionTitle: "가족 일정 확인하기",
      sourceRevision: 4,
      actionRevision: 5,
      actionStatus: "done",
      outcome: "completed",
      recordedAt: "2026-08-15T08:00:00.000Z",
      validUntil: "2026-08-16T08:00:00.000Z",
    },
  });

  assert.equal(completed.kind, "today");
  assert.equal(completed.title, "드레스 피팅");
  assert.match(completed.feedbackNotice, /가족 일정 확인하기/);
  assert.match(completed.feedbackNotice, /완료 기록을 반영/);
  assert.equal(completed.feedbackOutcome, "completed");
  assert.equal(completed.suppressActionFollowUpClaim, undefined);

  const disclosure = buildDashboardRecommendationDisclosure({
    focus: completed,
    personalizationLabel: null,
    coreCriterionLabel: null,
    coupleCriterionLabel: null,
    coreCriterionLoaded: true,
    coupleCriterionLoaded: true,
  });
  const privateReceiptRow = disclosure.contextRows.find(
    (row) => row.label === "완료 결과 영수증",
  );
  const sharedStatusRow = disclosure.contextRows.find(
    (row) => row.label === "공동 행동 완료 상태",
  );
  assert.equal(privateReceiptRow?.scope, "나만 보기");
  assert.match(privateReceiptRow?.detail ?? "", /상세/);
  assert.equal(sharedStatusRow?.scope, "커플 공유");
  assert.match(sharedStatusRow?.detail ?? "", /완료 상태/);
});

test("the seven-day window beats an undated priority, but a later deadline does not", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const createAction = (overrides) => ({
    couple_id: coupleId,
    description: null,
    category_key: "general",
    source: "manual",
    status: "open",
    created_at: "2026-08-15T08:00:00.000Z",
    ...overrides,
  });
  const highWithoutDate = createAction({
    id: "act_high_without_date",
    title: "중요하게 표시한 준비 확인하기",
    due_date: null,
    priority: "high",
  });

  assert.equal(
    selectDashboardOpenAction([
      highWithoutDate,
      createAction({
        id: "act_due_in_seven_days",
        title: "이번 주 안에 가족 일정 확인하기",
        due_date: "2026-08-22",
        priority: "low",
      }),
    ], coupleId, "2026-08-15")?.id,
    "act_due_in_seven_days",
  );
  assert.equal(
    selectDashboardOpenAction([
      highWithoutDate,
      createAction({
        id: "act_due_after_window",
        title: "다음 달 준비 확인하기",
        due_date: "2026-08-23",
        priority: "medium",
      }),
    ], coupleId, "2026-08-15")?.id,
    "act_high_without_date",
  );
});

test("action selection fails closed on an invalid clock and ignores malformed or other-couple rows", () => {
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const valid = {
    id: "act_valid",
    couple_id: coupleId,
    title: "우리 일정 확인하기",
    description: null,
    due_date: null,
    category_key: "general",
    priority: "medium",
    source: "chat",
    status: "open",
    created_at: "2026-08-15T08:00:00.000Z",
  };

  assert.equal(selectDashboardOpenAction([valid], coupleId, "2026-02-31"), null);
  assert.equal(
    selectDashboardOpenAction([
      { ...valid, id: "act_bad_date", due_date: "2026-02-31" },
      { ...valid, id: "act_other", couple_id: "33333333-3333-4333-8333-333333333333" },
      valid,
    ], coupleId, "2026-08-15")?.id,
    "act_valid",
  );
});

test("a confirmed urgent item still outranks a newly saved open action", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [{
      categoryKey: "venue",
      categoryLabel: "결혼식장",
      remainingDays: 3,
      urgency: "soon",
    }],
    openAction: {
      id: "act_first_step",
      title: "드레스 취향 한 줄 적기",
      description: null,
      dueDate: null,
      priority: "medium",
      source: "chat",
      createdAt: "2026-08-14T02:00:00.000Z",
    },
  });

  assert.equal(focus.kind, "urgent");
});

test("an explicit saved-action receipt shows that exact verified action once without changing normal priority", () => {
  const openAction = {
    id: "act_first_step",
    title: "드레스 취향 한 줄 적기",
    description: null,
    dueDate: null,
    priority: "medium",
    source: "chat",
    createdAt: "2026-08-14T02:00:00.000Z",
  };
  const input = {
    ...emptyInput,
    urgentTasks: [{
      categoryKey: "venue",
      categoryLabel: "결혼식장",
      remainingDays: 3,
      urgency: "soon",
    }],
    openAction,
  };

  const explicitFocus = buildDashboardFocus({
    ...input,
    receiptActionId: openAction.id,
  });
  assert.equal(explicitFocus.kind, "action");
  assert.equal(explicitFocus.title, openAction.title);
  assert.equal(explicitFocus.claimBeforeCare, true);
  assert.equal(explicitFocus.eyebrow, "방금 저장한 행동");

  assert.equal(buildDashboardFocus({
    ...input,
    receiptActionId: "act_other",
  }).kind, "urgent");
  assert.equal(buildDashboardFocus(input).kind, "urgent");
});

test("a receipt can select only its exact current-couple open action", () => {
  const coupleId = "11111111-1111-4111-8111-111111111111";
  const rows = [
    {
      id: "act_urgent",
      couple_id: coupleId,
      title: "기존 긴급 행동",
      description: null,
      due_date: "2026-08-15",
      category_key: null,
      priority: "high",
      source: "chat",
      status: "open",
      follow_up_revision: 1,
      created_at: "2026-08-14T01:00:00.000Z",
    },
    {
      id: "act_first_step",
      couple_id: coupleId,
      title: "방금 저장한 행동",
      description: null,
      due_date: null,
      category_key: null,
      priority: "medium",
      source: "chat",
      status: "open",
      follow_up_revision: 1,
      created_at: "2026-08-14T02:00:00.000Z",
    },
  ];

  assert.equal(
    selectDashboardReceiptAction(rows, coupleId, "act_first_step")?.id,
    "act_first_step",
  );
  assert.equal(selectDashboardReceiptAction(rows, coupleId, "act_missing"), null);
  assert.equal(selectDashboardReceiptAction(rows, "22222222-2222-4222-8222-222222222222", "act_first_step"), null);
});

test("chat stages and dashboard resolves one owner-bound receipt before showing its exact canonical action", () => {
  const dashboardSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/dashboard.tsx",
    import.meta.url,
  )), "utf8");
  const chatSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/chat.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(chatSource, /stageActionReceiptHomeHandoff\(\{[\s\S]*ownerUserId:\s*userId,[\s\S]*coupleId,[\s\S]*actionId/u);
  assert.match(chatSource, /params:\s*\{ actionReceiptHandoff \}/u);
  assert.match(dashboardSource, /useLocalSearchParams<\{[\s\S]*actionReceiptHandoff/u);
  assert.match(
    dashboardSource,
    /resolveActionReceiptHomeHandoff\(\{[\s\S]{0,400}handoffId:\s*actionReceiptHandoffParam,[\s\S]{0,240}expectedOwnerUserId:\s*user\.id,[\s\S]{0,240}expectedCoupleId:\s*profile\.couple_id/u,
  );
  assert.match(dashboardSource, /readCurrentOpenAmoraAction/);
  assert.match(dashboardSource, /receiptResolution\.state === "retry"[\s\S]{0,180}setActionReceiptReadError\(true\)/u);
  assert.match(dashboardSource, /if \(actionReceiptReadError\)[\s\S]{0,500}<ErrorRetry/u);
  assert.match(dashboardSource, /receiptResolution\.state === "focused"/u);
  assert.match(dashboardSource, /receiptActionId:\s*openAction\?\.id === receiptActionId/u);
});

test("a rejected exact receipt handoff never falls back to a different current action", () => {
  const dashboardSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/dashboard.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(
    dashboardSource,
    /receiptResolution\.state === "rejected"[\s\S]{0,240}setActionReceiptUnavailable\(true\)[\s\S]{0,120}return/u,
  );
  assert.match(
    dashboardSource,
    /if \(actionReceiptUnavailable\)[\s\S]{0,700}이 행동은 지금 이어갈 수 없어요[\s\S]{0,700}router\.replace\("\/amora-notes" as never\)/u,
  );
  assert.match(
    dashboardSource,
    /receiptAction[\s\S]{0,180}\? Promise\.resolve\(receiptAction\)[\s\S]{0,180}: loadPreferredOpenAmoraAction/u,
  );
});

test("dashboard reads a bounded open-action set and selects one inside the verified couple fence", () => {
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");
  const loaderSource = source.slice(
    source.indexOf("async function loadPreferredOpenAmoraAction"),
    source.indexOf("async function readCurrentOpenAmoraAction"),
  );
  const receiptLoaderSource = source.slice(
    source.indexOf("async function readCurrentOpenAmoraAction"),
    source.indexOf("export interface DashboardLoadTicket"),
  );

  assert.match(loaderSource, /\.from\("amora_actions"\)/);
  assert.match(loaderSource, /category_key/);
  assert.match(loaderSource, /follow_up_revision/);
  assert.match(loaderSource, /\.eq\("couple_id", coupleId\)/);
  assert.match(loaderSource, /\.eq\("status", "open"\)/);
  assert.match(loaderSource, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(loaderSource, /\.limit\(DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT\)/);
  assert.match(
    loaderSource,
    /selectDashboardOpenAction\(data, coupleId, formatLocalDateKey\(\)\)/,
  );
  assert.doesNotMatch(loaderSource, /\.maybeSingle\(\)/);
  assert.match(receiptLoaderSource, /\.eq\("id", actionId\)/);
  assert.match(receiptLoaderSource, /\.eq\("couple_id", coupleId\)/);
  assert.match(receiptLoaderSource, /\.eq\("status", "open"\)/);
  assert.match(receiptLoaderSource, /\.maybeSingle\(\)/);
  assert.match(receiptLoaderSource, /error[\s\S]{0,100}\{ ok: false as const \}/);
  assert.match(source, /if \(!await verifyLoadIdentity\(expectedIdentity\)\) return;/);
});

test("dashboard binds recent action feedback to the verified owner and couple before rendering recovery", () => {
  const dashboardSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/dashboard.tsx",
    import.meta.url,
  )), "utf8");
  const homeSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(dashboardSource, /loadOwnerAmoraActionOutcomeFeedback\(\s*user\.id,\s*profile\.couple_id,\s*apiFetchForExpectedUser/);
  assert.match(dashboardSource, /actionFeedback,/);
  assert.match(dashboardSource, /if \(focus\.suppressActionFollowUpClaim\) return companionFallback/);
  assert.match(homeSource, /applyDashboardActionOutcomeFeedback\(\{\s*focus:\s*groundedFocus,\s*openAction:\s*data\.openAction,\s*feedback:\s*data\.actionFeedback/);
});

test("the home CTA preserves the personalized category when it opens checklist or budget", () => {
  const homeUrl = new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(homeUrl), "utf8");

  assert.match(source, /case "\/budget":/);
  assert.match(source, /pathname: "\/budget"/);
  assert.match(source, /pathname: "\/checklist"/);
  assert.match(source, /params: focus\.categoryKey \? \{ category: focus\.categoryKey \} : \{\}/);
});

test("Amora turns the grounded focus into one companion-led next step without inventing memory", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [
      {
        categoryKey: "venue",
        categoryLabel: "결혼식장",
        remainingDays: 8,
        urgency: "soon",
      },
    ],
  });

  const brief = buildCompanionHomeBrief({
    focus,
    partnerActivity: {
      partnerName: "민수",
      recentCategories: ["예산", "하객"],
    },
  });

  assert.equal(brief.identityLabel, "AI 결혼 준비 동반자");
  assert.equal(brief.priorityTitle, focus.title);
  assert.equal(brief.whyNow, focus.description);
  assert.match(brief.evidenceLabel, /저장된 결혼식 날짜와 체크리스트 기준/);
  assert.match(brief.continuity, /최근 저장된 기록/);
  assert.match(brief.continuity, /민수님/);
  assert.match(brief.continuity, /예산, 하객/);
  assert.equal(brief.chatActionLabel, "아모라와 이어보기");
  assert.doesNotMatch(
    `${brief.evidenceLabel} ${brief.continuity}`,
    /기억|마음|감정|분명히/,
  );
});

test("explicit preferences change how Amora opens the same grounded task without changing its priority", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [
      {
        categoryKey: "venue",
        categoryLabel: "예식 장소",
        remainingDays: 8,
        urgency: "soon",
      },
    ],
  });

  const brief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    personalization: {
      decisionStart: "compare_first",
      answerDetail: "brief",
      supportOrder: "listen_first",
      workMode: "hybrid",
      familyOrder: "couple_first",
      toneStyle: "calm_clear",
    },
  });

  assert.equal(brief.priorityTitle, focus.title);
  assert.equal(brief.whyNow, focus.description);
  assert.equal(brief.chatActionLabel, "다른 선택도 비교하기");
  assert.equal(
    brief.personalizationLabel,
    "내 방식: 선택지 비교부터 · 핵심만 · 중요한 건 함께",
  );
});

test("recommendation disclosure separates grounded priority from private and shared context", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    openAction: {
      id: "act_meeting",
      title: "가족 일정 확인하기",
      description: null,
      dueDate: "2026-08-18",
      priority: "medium",
      source: "chat",
      categoryKey: "meeting",
      sourceRevision: 3,
      createdAt: "2026-08-14T08:00:00.000Z",
    },
  });
  const disclosure = buildDashboardRecommendationDisclosure({
    focus,
    asOfDate: "2026-08-18",
    personalizationLabel: "내 방식: 선택지 비교부터 · 핵심만",
    coreCriterionLabel: "내 기준: 둘이 편안한 일정",
    coupleCriterionLabel: "우리 기준: 감당 가능한 범위 먼저",
    coreCriterionLoaded: true,
    coupleCriterionLoaded: true,
  });

  assert.match(disclosure.prioritySource, /공동 준비 행동/);
  assert.equal(disclosure.sourceDisclosure.sourceType, "canonical_record");
  assert.equal(disclosure.sourceDisclosure.stateEffect, "already_recorded");
  assert.equal(disclosure.sourceDisclosure.rankingPolicy, "disclosure_only");
  assert.equal(disclosure.priorityReason, focus.description);
  assert.deepEqual(
    disclosure.contextRows.map((row) => row.scope),
    ["나만 보기", "나만 보기", "커플 공유"],
  );
  assert.match(disclosure.contextRows[0].detail, /내 방식/);
  assert.match(disclosure.contextRows[0].detail, /답변의 시작·분량·도움 순서/);
  assert.match(disclosure.contextRows[0].detail, /홈의 준비 순서는 바꾸지 않고/);
  assert.match(disclosure.contextRows[1].detail, /관련 있는 후보가 비슷할 때만/);
  assert.match(disclosure.contextRows[1].detail, /홈의 마감·일정 순서는 바꾸지 않고/);
  assert.match(disclosure.contextRows[2].detail, /관련 있는 후보가 비슷할 때만/);
  assert.match(disclosure.contextRows[2].detail, /홈의 마감·일정 순서는 바꾸지 않고/);
  assert.match(disclosure.memoryNotice, /우선순위를 정하는 데 사용하지 않았어요/);
  assert.doesNotMatch(JSON.stringify(disclosure), /실제로 사용|마음을 파악|성격/);
});

test("recommendation disclosure identifies every active action feedback result as recipient-private", () => {
  const openAction = {
    id: "act_family_schedule",
    title: "가족 일정 확인하기",
    description: null,
    dueDate: "2026-08-18",
    priority: "medium",
    source: "chat",
    categoryKey: "meeting",
    sourceRevision: 4,
    createdAt: "2026-08-14T08:00:00.000Z",
  };
  const baseFeedback = {
    outcomeId: "11111111-1111-4111-8111-111111111111",
    actionId: openAction.id,
    actionTitle: openAction.title,
    sourceRevision: 4,
    actionRevision: 4,
    actionStatus: "open",
    recordedAt: "2026-08-15T08:00:00.000Z",
    validUntil: "2026-08-16T08:00:00.000Z",
  };

  for (const outcome of ["blocked", "changed", "not_sure"]) {
    const focus = applyDashboardActionOutcomeFeedback({
      focus: buildDashboardFocus({ ...emptyInput, openAction }),
      openAction,
      feedback: {
        ...baseFeedback,
        outcome,
        ...(outcome === "blocked" ? { blockerCode: "partner_check" } : {}),
      },
    });
    const disclosure = buildDashboardRecommendationDisclosure({
      focus,
      personalizationLabel: null,
      coreCriterionLabel: null,
      coupleCriterionLabel: null,
      coreCriterionLoaded: true,
      coupleCriterionLoaded: true,
    });
    const feedbackRow = disclosure.contextRows.find(
      (row) => row.label === "방금 남긴 행동 결과",
    );

    assert.equal(feedbackRow?.scope, "나만 보기", outcome);
    assert.match(feedbackRow?.detail ?? "", /이 제안과 도움 방식/, outcome);
    assert.doesNotMatch(
      feedbackRow?.detail ?? "",
      /공동 결과|파트너가 남긴|커플 합의/,
      outcome,
    );
  }
});

test("recommendation disclosure never describes a failed criterion read as no criterion", () => {
  const disclosure = buildDashboardRecommendationDisclosure({
    focus: buildDashboardFocus(emptyInput),
    asOfDate: "2026-08-18",
    personalizationLabel: null,
    coreCriterionLabel: null,
    coupleCriterionLabel: null,
    coreCriterionLoaded: false,
    coupleCriterionLoaded: false,
  });

  assert.match(disclosure.contextRows[1].detail, /확인하지 못했어요/);
  assert.match(disclosure.contextRows[2].detail, /확인하지 못했어요/);
  assert.doesNotMatch(disclosure.contextRows[1].detail, /없어요/);
  assert.doesNotMatch(disclosure.contextRows[2].detail, /없어요/);
  assert.equal(disclosure.sourceDisclosure.sourceType, "amora_proposal");
  assert.equal(
    disclosure.sourceDisclosure.stateEffect,
    "requires_user_confirmation",
  );
});

test("home exposes recommendation provenance and clears the sheet across identity changes", () => {
  const homeSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");
  const sheetSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/AmoraRecommendationWhySheet.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(homeSource, /왜 이 제안인가요\?/);
  assert.match(homeSource, /아모라가 맞춰 돕는 방식/);
  assert.match(homeSource, /buildDashboardRecommendationDisclosure/);
  assert.match(
    homeSource,
    /setWhySheetVisible\(false\);\s*\}, \[data\?\.ownerUserId, data\?\.coupleId\]\)/,
  );
  assert.match(homeSource, /router\.push\("\/settings\/amora-style"\)/);
  assert.match(homeSource, /router\.push\("\/settings\/amora-memory"\)/);
  assert.match(sheetSource, /accessibilityViewIsModal/);
  assert.match(sheetSource, /minHeight:\s*48/);
  assert.match(sheetSource, /row\.scope === "커플 공유"/);
  assert.match(sheetSource, /추천 순서를 정한 준비 기록/);
  assert.match(sheetSource, /AmoraSourceDisclosureView/);
  assert.match(homeSource, /asOfDate:\s*formatLocalDateKey\(\)/);
  assert.match(sheetSource, /설명을 맞추기 위해 전달된 설정과 기준/);
  assert.doesNotMatch(sheetSource, /이번 답변에 사용한 기억/);
});

test("one explicit criterion personalizes the decision lens without changing the grounded priority", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [
      {
        categoryKey: "venue",
        categoryLabel: "예식 장소",
        remainingDays: 8,
        urgency: "soon",
      },
    ],
  });
  const criterion = {
    id: "11111111-1111-4111-8111-111111111111",
    value: "하객 수보다 우리 둘이 편안한 하루",
    updatedAt: "2026-08-14T04:00:00.000Z",
  };

  const brief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    coreCriterionLoaded: true,
    coreCriterion: criterion,
  });

  assert.equal(brief.priorityTitle, focus.title);
  assert.equal(brief.whyNow, focus.description);
  assert.equal(brief.coreCriterion, criterion.value);
  assert.equal(
    brief.coreCriterionLabel,
    "내 기준: 하객 수보다 우리 둘이 편안한 하루",
  );
  assert.equal(brief.criterionAction, null);
});

test("home distinguishes a confirmed shared criterion from a private one and surfaces a partner review", () => {
  const focus = buildDashboardFocus(emptyInput);
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const partnerUserId = "22222222-2222-4222-8222-222222222222";
  const brief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    ownerUserId,
    coupleCriterionLoaded: true,
    coupleCriterion: {
      version: 1,
      coupleId: "33333333-3333-4333-8333-333333333333",
      linked: true,
      current: {
        decisionId: "44444444-4444-4444-8444-444444444444",
        value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
        confirmedAt: "2026-08-14T10:00:00.000Z",
      },
      proposal: {
        id: "55555555-5555-4555-8555-555555555555",
        value: "가족 요청은 우리 둘이 먼저 이야기한 뒤 답하기",
        revision: 1,
        proposerUserId: partnerUserId,
        brideUserId: ownerUserId,
        groomUserId: partnerUserId,
        acceptedUserIds: [partnerUserId],
        createdAt: "2026-08-14T11:00:00.000Z",
        updatedAt: "2026-08-14T11:00:00.000Z",
      },
    },
  });

  assert.equal(
    brief.coupleCriterionLabel,
    "우리 기준: 우리 둘이 감당할 수 있는 범위 먼저 보기",
  );
  assert.deepEqual(brief.criterionAction, {
    label: "우리 기준 확인하기",
    route: "/settings/amora-style",
  });
});

test("a confirmed shared criterion turns the quiet-home handoff into one criterion-aware next action", () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "33333333-3333-4333-8333-333333333333";
  const handoffId = "66666666-6666-4666-8666-666666666666";
  const criterionValue = "우리 둘이 감당할 수 있는 범위 먼저 보기";
  const brief = buildCompanionHomeBrief({
    focus: buildDashboardFocus(emptyInput),
    partnerActivity: null,
    ownerUserId,
    coupleCriterionLoaded: true,
    coupleCriterion: {
      version: 1,
      coupleId,
      linked: true,
      current: {
        decisionId: "44444444-4444-4444-8444-444444444444",
        value: criterionValue,
        confirmedAt: "2026-08-14T10:00:00.000Z",
      },
      proposal: null,
    },
  });

  assert.equal(brief.chatActionLabel, "우리 기준으로 다음 한 가지");
  assert.equal(brief.criterionAction, null);
  assert.equal(
    stageCompanionChatHandoff({ handoffId, ownerUserId, coupleId, brief }),
    handoffId,
  );
  const staged = consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId);
  assert.match(staged?.prompt ?? "", /서버에서 현재 우리 기준이 확인되면/);
  assert.match(staged?.prompt ?? "", /저장된 준비 기록과 함께 대조/);
  assert.match(staged?.prompt ?? "", /기준과 무관하면 억지로 맞추지 말/);
  assert.match(staged?.prompt ?? "", /날짜·금액·마감은.*추측하지 마/);
  assert.doesNotMatch(staged?.prompt ?? "", new RegExp(criterionValue, "u"));
});

test("a verified empty quiet home offers one optional criterion setup without treating errors as empty", () => {
  const focus = buildDashboardFocus(emptyInput);
  const emptyBrief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    coreCriterionLoaded: true,
    coreCriterion: null,
  });
  const unavailableBrief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    coreCriterionLoaded: false,
    coreCriterion: null,
  });

  assert.deepEqual(emptyBrief.criterionAction, {
    label: "내 기준 하나 알려주기",
    route: "/settings/amora-style",
  });
  assert.equal(unavailableBrief.criterionAction, null);
});

test("home loads owner-private personalization after grounded data and renders it without blocking the base action", () => {
  const dashboardSource = readFileSync(fileURLToPath(new URL(
    "../../app/(tabs)/dashboard.tsx",
    import.meta.url,
  )), "utf8");
  const experienceSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(dashboardSource, /loadOwnerAmoraPersonalization\(\s*user\.id,\s*apiFetchForExpectedUser/);
  assert.match(dashboardSource, /loadOwnerAmoraCoreCriterion\(\s*user\.id,\s*apiFetchForExpectedUser/);
  assert.match(
    dashboardSource,
    /mergeForIdentity\([\s\S]{0,520}coreCriterionLoaded:\s*coreCriterionResult\.loaded/,
  );
  assert.match(experienceSource, /personalization:\s*data\?\.personalization \?\? null/);
  assert.match(experienceSource, /coreCriterionLoaded:\s*data\?\.coreCriterionLoaded \?\? false/);
  assert.match(experienceSource, /coreCriterion:\s*data\?\.coreCriterion \?\? null/);
  assert.match(experienceSource, /companionBrief\.personalizationLabel/);
  assert.match(experienceSource, /companionBrief\.coreCriterionLabel/);
});

test("Amora stays useful when there is no partner update to continue", () => {
  const focus = buildDashboardFocus(emptyInput);
  const brief = buildCompanionHomeBrief({ focus, partnerActivity: null });

  assert.equal(brief.continuity, null);
  assert.match(brief.evidenceLabel, /현재 저장된 일정과 체크리스트 기준/);
});

test("a quiet home starts from the user's nearest concern without forcing a prompt", () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "44444444-4444-4444-8444-444444444444";
  const focus = buildDashboardFocus(emptyInput);
  const brief = buildCompanionHomeBrief({ focus, partnerActivity: null });

  assert.equal(brief.chatActionLabel, "뭐부터 할지 같이 정하기");
  assert.equal(brief.chatIntent, "intake");
  assert.equal(
    stageCompanionChatHandoff({ handoffId, ownerUserId, coupleId, brief }),
    handoffId,
  );

  const staged = consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId);
  assert.match(staged?.prompt ?? "", /무엇부터 물어봐야 할지 몰라도/);
  assert.match(staged?.prompt ?? "", /현재 저장된 일정과 체크리스트 기준/);
  assert.match(staged?.prompt ?? "", /확인된 내용/);
  assert.match(staged?.prompt ?? "", /아직 모르는 내용/);
  assert.match(staged?.prompt ?? "", /한 번에 하나만/);
  assert.match(staged?.prompt ?? "", /확인하기 전에는 어떤 기록도 바꾸거나 상대에게 공유하지 마/);
  assert.doesNotMatch(staged?.prompt ?? "", /견적|계약|위약금|해지|환불|법률/);
});

test("the confirmed private criterion reaches Amora as a decision lens, never as couple consensus", () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "55555555-5555-4555-8555-555555555555";
  const focus = buildDashboardFocus(emptyInput);
  const brief = buildCompanionHomeBrief({
    focus,
    partnerActivity: null,
    coreCriterionLoaded: true,
    coreCriterion: {
      id: "33333333-3333-4333-8333-333333333333",
      value: "사진보다 대화가 편한 하루",
      updatedAt: "2026-08-14T04:00:00.000Z",
    },
  });

  assert.equal(
    stageCompanionChatHandoff({ handoffId, ownerUserId, coupleId, brief }),
    handoffId,
  );
  const staged = consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId);
  assert.match(staged?.prompt ?? "", /사진보다 대화가 편한 하루/);
  assert.match(staged?.prompt ?? "", /내가 직접 확인한 비공개 기준/);
  assert.match(staged?.prompt ?? "", /두 사람의 합의로 단정하지 마/);
});

test("Amora carries the grounded home priority into a private owner-bound draft", () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "33333333-3333-4333-8333-333333333333";
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "양가에 예식 시간 알리기", categoryKey: "family" }],
  });
  const brief = buildCompanionHomeBrief({ focus, partnerActivity: null });
  const stagedId = stageCompanionChatHandoff({
    handoffId,
    ownerUserId,
    coupleId,
    brief,
  });

  assert.equal(stagedId, handoffId);
  const parsed = consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId);
  assert.match(parsed?.prompt ?? "", /양가에 예식 시간 알리기/);
  assert.match(parsed?.prompt ?? "", /오늘로 저장된 일정 기준/);
  assert.match(parsed?.prompt ?? "", /한 번에 하나만/);
  assert.doesNotMatch(parsed?.prompt ?? "", /파트너.*마음|분명히 원/);
  assert.equal(consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId), null);

  stageCompanionChatHandoff({ handoffId, ownerUserId, coupleId, brief });
  assert.equal(
    consumeCompanionChatHandoff(
      handoffId,
      "22222222-2222-4222-8222-222222222222",
      coupleId,
    ),
    null,
  );
  assert.equal(consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId), null);
});

test("home-to-chat handoff is private, never auto-sent, and cannot overwrite another account", () => {
  const experienceUrl = new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  );
  const chatUrl = new URL("../../app/(tabs)/chat.tsx", import.meta.url);
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const experienceSource = readFileSync(fileURLToPath(experienceUrl), "utf8");
  const chatSource = readFileSync(fileURLToPath(chatUrl), "utf8");
  const dashboardSource = readFileSync(fileURLToPath(dashboardUrl), "utf8");

  assert.match(experienceSource, /stageCompanionChatHandoff/);
  assert.match(experienceSource, /companionHandoff/);
  assert.match(
    experienceSource,
    /case "\/\(tabs\)\/chat":[\s\S]{0,260}openCompanionChat\(ownerUserId, coupleId/,
  );
  assert.doesNotMatch(
    experienceSource,
    /case "\/\(tabs\)\/chat":[\s\S]{0,160}router\.push\("\/\(tabs\)\/chat"\)/,
  );
  assert.match(
    chatSource,
    /consumeCompanionChatHandoff\(\s*companionHandoffParam,\s*userId,\s*coupleId/,
  );
  assert.match(chatSource, /!userRole/);
  assert.match(chatSource, /!coupleId/);
  assert.match(
    chatSource,
    /updateAmoraChatLaneRecord\(\s*inputByLaneRef\.current,\s*"private_ai",\s*handoff\.prompt/,
  );
  assert.match(chatSource, /setActiveScope\("private"\)/);
  assert.match(chatSource, /setTarget\("ai"\)/);
  assert.doesNotMatch(chatSource, /parseCompanionChatHandoff[\s\S]{0,800}handleSend\(/);
  assert.match(dashboardSource, /ownerUserId: user\.id/);
  assert.match(dashboardSource, /coupleId: profile\.couple_id/);
});

test("a home without a canonical couple never exposes a dead Amora handoff", () => {
  const experienceUrl = new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  );
  const source = readFileSync(fileURLToPath(experienceUrl), "utf8");

  assert.match(
    source,
    /if \(!coupleId\) \{\s*router\.push\("\/onboarding"\);\s*return;\s*\}/,
  );
});

test("partner continuity requires a real recent timestamp", () => {
  const dashboardUrl = new URL("../../app/(tabs)/dashboard.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(dashboardUrl), "utf8");

  assert.match(source, /if \(!categoryProgress\.updated_at\) \{\s*continue;\s*\}/);
  assert.doesNotMatch(
    source,
    /if \(!categoryProgress\.updated_at\) \{\s*recentCategories\.push/,
  );
});

test("a completed visit asks for the factual booking outcome before generic planning", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    bookingOutcomeTasks: [
      {
        id: "booking-7",
        vendorName: "라온 스튜디오",
        categoryLabel: "스튜디오",
        bookingDate: "2026-07-29",
        isPast: true,
      },
    ],
  });

  assert.equal(focus.kind, "booking");
  assert.equal(focus.route, "/bookings");
  assert.equal(focus.bookingId, "booking-7");
  assert.match(focus.title, /라온 스튜디오/);
  assert.match(focus.description, /실제 진행 여부를 직접 확인/);
  assert.match(focus.description, /사용자가 입력한 기록 지출/);
  assert.match(focus.description, /결제 증빙이 아니에요/);
  assert.doesNotMatch(focus.description, /실제 결제금액/);
});

test("the wedding moment copy celebrates the day without hiding the practical next step", () => {
  assert.match(getWeddingMomentMessage(null), /오늘부터/);
  assert.match(getWeddingMomentMessage(120), /한 걸음/);
  assert.match(getWeddingMomentMessage(0), /축하/);
  assert.match(getWeddingMomentMessage(-10), /그날 이후/);
});

test("today uses the device calendar date instead of a UTC date slice", () => {
  const localHalfPastMidnight = new Date(2026, 6, 30, 0, 30, 0);
  assert.equal(formatLocalDateKey(localHalfPastMidnight), "2026-07-30");
});

test("home progress follows canonical checklist arrays and legacy booleans", () => {
  const categories = [
    { key: "venue", items: [{ id: "visit" }, { id: "contract" }] },
    { key: "photo", items: [{ id: "shoot" }] },
  ];
  const progress = {
    venue: {
      status: "in_progress",
      checklist: [
        { id: "visit", done: true },
        { id: "contract", done: false },
      ],
    },
    photo: { shoot: true },
    __events: [{ date: "2026-07-30", title: "ignored metadata" }],
  };

  assert.equal(calculateChecklistProgress(progress, categories), 67);
});

test("home progress excludes categories marked not applicable", () => {
  const categories = [
    { key: "venue", items: [{ id: "visit" }, { id: "contract" }] },
    { key: "pyebaek", items: [{ id: "greet" }] },
  ];
  const progress = {
    venue: { checklist: [{ id: "visit", done: true }, { id: "contract", done: false }] },
    pyebaek: { status: "not_applicable", checklist: [{ id: "greet", done: false }] },
  };

  assert.equal(calculateChecklistProgress(progress, categories), 50);
});

test("the home service map keeps every live consumer workflow within reach", () => {
  assert.deepEqual(
    HOME_SERVICES.map((service) => service.route),
    [
      "/checklist",
      "/schedule",
      "/budget",
      "/market-prices",
      "/quote-check",
      "/bookings",
      "/(tabs)/community",
    ],
  );
  assert.equal(new Set(HOME_SERVICES.map((service) => service.key)).size, 7);
});

test("an unlinked member is guided through setup before opening couple-bound planning tools", () => {
  const byKey = Object.fromEntries(HOME_SERVICES.map((service) => [service.key, service]));

  for (const key of ["checklist", "schedule", "budget"]) {
    assert.equal(resolveDashboardServiceRoute(byKey[key], false), "/onboarding");
    assert.equal(resolveDashboardServiceRoute(byKey[key], true), byKey[key].route);
  }

  assert.equal(resolveDashboardServiceRoute(byKey.prices, false), "/market-prices");
  assert.equal(resolveDashboardServiceRoute(byKey.quote, false), "/quote-check");
  assert.equal(resolveDashboardServiceRoute(byKey.community, false), "/(tabs)/community");
});

test("the quote check service opens the current non-storing consumer workflow", () => {
  const routeUrl = new URL("../../app/quote-check/index.tsx", import.meta.url);
  assert.equal(existsSync(routeUrl), true);

  const source = readFileSync(fileURLToPath(routeUrl), "utf8");
  assert.match(
    source,
    /buildMobileSiteUrl\(\s*"\/wedding\/community\/quote-check",\s*siteOrigin,\s*\)/,
  );
  assert.match(source, /pathname:\s*"\/webview"/);
});

test("the quote-check continuation becomes a bounded native private draft", () => {
  const siteOrigin = "https://hanbang.ai";
  const prompt = "확인 필요 항목을 아모라와 이어서 정리해줘.";
  const url = `${siteOrigin}/wedding/chat?prefill=${encodeURIComponent(prompt)}`;

  assert.equal(readPrivateChatHandoffPromptFromUrl(url, siteOrigin), prompt);
  assert.equal(
    readPrivateChatHandoffPromptFromUrl(
      `https://attacker.example/wedding/chat?prefill=${encodeURIComponent(prompt)}`,
      siteOrigin,
    ),
    null,
  );
  assert.equal(
    readPrivateChatHandoffPromptFromUrl(
      `${siteOrigin}/wedding/chat?prefill=${encodeURIComponent(prompt)}&prefill=forged`,
      siteOrigin,
    ),
    null,
  );
  assert.equal(
    readPrivateChatHandoffPromptFromUrl(
      `${siteOrigin}/wedding/community?prefill=${encodeURIComponent(prompt)}`,
      siteOrigin,
    ),
    null,
  );

  const webviewUrl = new URL("../../app/webview.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(webviewUrl), "utf8");
  assert.match(source, /readPrivateChatHandoffPromptFromUrl/);
  assert.match(source, /stagePrivateChatHandoff/);
  assert.match(source, /supabase\.auth\.getSession\(\)/);
  assert.match(source, /select\("couple_id"\)/);
  assert.match(source, /coupleId,/);
  assert.match(source, /pathname:\s*"\/\(tabs\)\/chat"/);
  assert.doesNotMatch(
    source,
    /readPrivateChatHandoffPromptFromUrl[\s\S]{0,1500}(?:handleSend|requestChatStream)\(/,
  );
});

test("login returns through the shared onboarding gate before opening home", () => {
  const loginUrl = new URL("../../app/(auth)/login.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(loginUrl), "utf8");

  assert.equal(
    source.includes('router.replace("/(tabs)/lounge")'),
    false,
  );
  assert.ok(
    source.match(/router\.replace\("\/"\)/g)?.length >= 2,
    "email and social login should both return through app/index.tsx",
  );
});

test("community prefetch waits until the home transition has finished", () => {
  const tabsUrl = new URL("../../app/(tabs)/_layout.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(tabsUrl), "utf8");

  assert.match(source, /InteractionManager\.runAfterInteractions/);
  assert.match(source, /warmTask\.cancel\(\)/);
});

test("the documented mobile dev command resolves Expo from the direct dependency", () => {
  const scriptUrl = new URL("../../scripts/start-expo-dev.mjs", import.meta.url);
  const source = readFileSync(fileURLToPath(scriptUrl), "utf8");

  assert.match(source, /require\.resolve\("expo\/bin\/cli"\)/);
  assert.doesNotMatch(source, /require\.resolve\("@expo\/cli/);
});

test("the Expo launcher selects the SDK 54 runtime and cleans up its child", () => {
  const scriptUrl = new URL("../../scripts/start-expo-dev.mjs", import.meta.url);
  const source = readFileSync(fileURLToPath(scriptUrl), "utf8");

  assert.match(source, /HANBANG_MOBILE_NODE/);
  assert.match(source, /node-v20\.19\.6-win-x64/);
  assert.match(source, /SIGINT/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /\.once\("error"/);
});

test("mobile dev commands preserve the Metro cache between launches", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  for (const scriptName of ["dev", "dev:ios", "dev:android"]) {
    assert.doesNotMatch(
      packageJson.scripts[scriptName],
      /(?:^|\s)--clear(?:\s|$)/,
      `${scriptName} must not force a full monorepo cache rebuild`,
    );
  }
});

test("mobile development has a reproducible tunnel fallback", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  assert.match(packageJson.scripts["dev:tunnel"], /--tunnel/);
  assert.match(packageJson.devDependencies["@expo/ngrok"], /^\^?4\.1\./);
});

test("Expo automatic monorepo discovery owns Metro watch folders", () => {
  const metroConfigUrl = new URL("../../metro.config.js", import.meta.url);
  const source = readFileSync(fileURLToPath(metroConfigUrl), "utf8");

  assert.doesNotMatch(source, /config\.watchFolders\s*=/);
  assert.doesNotMatch(source, /config\.resolver\.nodeModulesPaths\s*=/);
  assert.doesNotMatch(source, /workspaceRoot/);
  assert.match(source, /getSentryExpoConfig/);
});

test("the mobile workspace exposes Expo's Babel preset to Metro", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  assert.match(
    packageJson.devDependencies["babel-preset-expo"],
    /^54\./,
    "pnpm strict resolution requires the SDK 54 preset at the mobile boundary",
  );
});
