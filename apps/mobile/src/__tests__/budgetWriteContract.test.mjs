import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import ts from "typescript";
import { fileURLToPath, URL } from "node:url";

import { fetchMobileWebApiWithSession } from "../lib/mobileWebApiBridge.mjs";
import * as budgetRevision from "../lib/budgetRevision.mjs";
import { listBudgetCategories } from "../lib/budgetCategoryRegistry.mjs";
import * as budgetShare from "@hanbang/shared/budget-share";

const budgetPath = fileURLToPath(new URL("../../app/budget/index.tsx", import.meta.url));
const apiPath = fileURLToPath(new URL("../lib/api.ts", import.meta.url));
const budgetSource = readFileSync(budgetPath, "utf8");
const apiSource = readFileSync(apiPath, "utf8");

// 실제 화면의 조회·수명주기 콜백을 실행한다. DB/앱 상태만 합성으로 공급한다.
function budgetRefreshHarness() {
  const tree = ts.createSourceFile("budget.tsx", budgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = {};
  const helpers = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text !== "BudgetScreen").map(node => node.getText(tree)).join("\n");
  function visit(node) {
    if (ts.isImportSpecifier(node) && node.name.text === "formatWon") callbacks.formatBinding = node.propertyName?.text ?? node.name.text;
    if (ts.isFunctionDeclaration(node) && ["openEdit", "openTotalEdit", "getCatBudget", "getCatSpent", "getCatPayer"].includes(node.name?.text)) callbacks[node.name.text] = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "budgetCategories") callbacks.registry = node.initializer.getText(tree);
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") callbacks[node.name.getText(tree)] = node.initializer.arguments[0].getText(tree);
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useFocusEffect") callbacks.focus = node.arguments[0].arguments[0].getText(tree);
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect") {
      const body = node.arguments[0].getText(tree);
      if (body.includes("supabase.channel(`budget:")) callbacks.realtime = body;
      if (body.includes("onAuthStateChange")) callbacks.auth = body;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  callbacks.projection = "toBudgetProgress";
  callbacks.format = "formatWon";
  const ownerA = "10000000-0000-4000-8000-000000000001";
  const coupleA = "50000000-0000-4000-8000-000000000001";
  const identity = { userId: ownerA, coupleId: coupleA };
  const row = (revision, amount, coupleId = identity.coupleId) => ({ couple_id: coupleId, total_budget: amount, state_revision: revision, progress: { venue: { category: "venue", budget: amount, spent: 0 } } });
  let current = row(1, 20_000_000), reads = 0, authListener, focusCleanup;
  const queued = [], appListeners = new Set(), channels = [], view = {};
  const coordinator = budgetRevision.createBudgetRevisionCoordinator();
  const appState = { currentState: "active", addEventListener(_event, callback) { appListeners.add(callback); return { remove() { appListeners.delete(callback); } }; } };
  const env = { ...budgetRevision, revisionCoordinator: coordinator, AppState: appState, formatWon: budgetShare[callbacks.formatBinding],
    loadSequenceRef: { current: 0 }, pendingApprovalRef: { current: null }, totalEditBaseRef: { current: null }, categoryEditBaseRef: { current: null }, channelRef: { current: null },
    fetchActiveBudgetApprovalStatus: async () => null, Alert: { alert() {} }, console: { error() {} },
    apiFetchForExpectedUser: async () => { throw new Error("Unexpected mutation/status request"); },
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: identity.userId } }, error: null }), onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
      from(table) {
        const query = { select() { return query; }, eq() { return query; }, single: async () => {
          if (table === "profiles") return { data: { couple_id: identity.coupleId }, error: null };
          assert.equal(table, "wedding_journeys"); reads++;
          const response = queued.shift();
          return response ? await response() : { data: globalThis.structuredClone(current), error: null };
        } }; return query;
      },
      channel() { const channel = { on(_event, _filter, callback) { channel.change = callback; return channel; }, subscribe(callback) { channel.status = callback; return channel; } }; channels.push(channel); return channel; },
      removeChannel(channel) { channel.removed = true; },
    },
  };
  for (const field of ["TotalBudget", "Progress", "CoupleId", "EditingTotal", "EditingKey", "Saving", "SavingTotal", "PendingApproval", "Loading", "LoadError", "Refreshing", "TotalInput", "BudgetInput", "SpentInput", "PayerInput"]) {
    env[`set${field}`] = value => { view[field] = value; };
  }
  function actual(name, extra = {}) {
    assert.ok(callbacks[name], `actual ${name} callback exists`);
    const bindings = { ...env, ...extra };
    const code = ts.transpileModule(`${helpers}\nconst callback = ${callbacks[name]};`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), `${code}; return callback;`)(...Object.values(bindings));
  }
  env.clearIdentityBoundState = actual("clearIdentityBoundState");
  env.commitSnapshotToView = actual("commitSnapshotToView");
  env.loadData = actual("loadData");
  actual("auth")();
  return { identity, row, queued, view, coordinator, channels,
    displayedCategories() { return actual("registry", { listBudgetCategories, BUDGET_CATEGORIES: [{ key: "venue", label: "예식장" }, { key: "studio", label: "스튜디오" }], progress: actual("projection")(view.Progress), rawProgress: view.Progress }); },
    formatAmount(value) { return actual("format")(value); },
    openTotalEditor() { return actual("openTotalEdit", { totalBudget: view.TotalBudget })(); },
    openCategoryEditor(key) {
      return actual("openEdit", Object.fromEntries(["getCatBudget", "getCatSpent", "getCatPayer"].map(name => [name, actual(name, { progress: view.Progress })])))(key);
    },
    setJourney(value) { current = value; }, get reads() { return reads; },
    focus() { focusCleanup = actual("focus")(); }, blur() { focusCleanup?.(); focusCleanup = null; },
    connect() { return actual("realtime", { coupleId: identity.coupleId })(); },
    appState(value) { appState.currentState = value; for (const listener of appListeners) listener(value); },
    authChanged() { authListener("SIGNED_IN", { user: { id: identity.userId } }); },
    load: env.loadData,
    async flush() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("budget editing preserves every stored won when opening and saving unchanged money", async () => {
  for (const amount of [1, 5_000, 15_001, 123_456_789, 999_999_999, 1_000_000_000]) {
    const h = budgetRefreshHarness(); const row = h.row(2, amount);
    row.progress.venue.spent = amount;
    h.setJourney(row); h.focus(); await h.flush();
    h.openTotalEditor();
    assert.equal(h.view.TotalInput, String(amount / 10_000));
    assert.equal(budgetRevision.buildTotalBudgetMutation(h.coordinator.captureIdentity(), h.view.TotalInput).total_budget, amount);
    h.openCategoryEditor("venue");
    assert.equal(h.view.BudgetInput, String(amount / 10_000));
    assert.equal(h.view.SpentInput, String(amount / 10_000));
    const mutation = budgetRevision.buildCategoryBudgetMutation(h.coordinator.captureIdentity(), {
      categoryKey: "venue", budgetInput: h.view.BudgetInput, spentInput: h.view.SpentInput, payer: "groom_parents",
    });
    assert.equal(mutation.progress_patch.venue.budget, amount);
    assert.equal(mutation.progress_patch.venue.spent, amount);
    assert.equal(mutation.progress_patch.venue.payer, "groom_parents");
    h.blur();
  }
});

test("budget amount labels never round away saved won", () => {
  const h = budgetRefreshHarness();
  for (const [amount, label] of [[15_001, "15,001원"], [0, "0원"], [1, "1원"], [5_000, "5,000원"], [100_010_000, "10,001만원"], [123_456_789, "123,456,789원"]]) {
    assert.equal(h.formatAmount(amount), label);
  }
});

test("budget foreground recovery reads a missed confirmed allocation without replacing a dirty edit", async () => {
  const h = budgetRefreshHarness(); h.focus(); await h.flush();
  const editBase = h.coordinator.captureIdentity();
  h.view.EditingTotal = true; h.view.TotalInput = "3100";
  h.appState("background"); h.setJourney(h.row(2, 30_000_000)); h.appState("active"); await h.flush();
  assert.equal(h.view.TotalBudget, 30_000_000);
  assert.equal(h.view.Progress.venue.budget, 30_000_000);
  assert.equal(h.view.EditingTotal, true); assert.equal(h.view.TotalInput, "3100");
  assert.equal(budgetRevision.isBudgetEditBaseCurrent(editBase, h.coordinator.captureIdentity()), false);
  const reads = h.reads; h.appState("active"); await h.flush(); assert.equal(h.reads, reads);
  h.blur(); h.appState("background"); h.appState("active"); await h.flush(); assert.equal(h.reads, reads);
});

test("the actual budget load and category projection preserve hidden amounts without counting them", async () => {
  const h = budgetRefreshHarness(); const data = h.row(2, 10_500_000);
  data.progress = {
    venue: { category: "venue", budget: 10_000_000, spent: 2_000_000 },
    studio: { category: "studio", budget: 3_000_000, spent: 1_000_000 },
    custom_transport: { label: "교통", budget: 500_000, spent: 100_000 },
    __hidden: ["studio"],
  };
  h.setJourney(data); h.focus(); await h.flush();
  assert.deepEqual(h.view.Progress.__hidden, ["studio"]);
  const categories = h.displayedCategories();
  assert.equal(categories.reduce((sum, category) => sum + h.view.Progress[category.key].budget, 0), 10_500_000);
  assert.equal(categories.reduce((sum, category) => sum + h.view.Progress[category.key].spent, 0), 2_100_000);
  const snapshot = h.coordinator.captureIdentity();
  const patch = budgetRevision.buildCategoryBudgetMutation(snapshot, { categoryKey: "venue", budgetInput: "1100", spentInput: "", payer: "couple" });
  assert.deepEqual(Object.keys(patch.progress_patch), ["venue"]);
  assert.equal(patch.progress_patch.venue.spent, 2_000_000);
  assert.deepEqual(snapshot.progress.__hidden, ["studio"]);
  assert.deepEqual(snapshot.progress.studio, data.progress.studio);
});

test("budget realtime reconnection reloads missing changes and ignores a disposed channel", async () => {
  const h = budgetRefreshHarness(); h.focus(); await h.flush(); const dispose = h.connect();
  const channel = h.channels[0]; channel.status?.("SUBSCRIBED"); await h.flush();
  h.setJourney(h.row(2, 30_000_000)); channel.status?.("CHANNEL_ERROR"); channel.status?.("SUBSCRIBED"); await h.flush();
  assert.equal(h.view.TotalBudget, 30_000_000);
  h.setJourney(h.row(3, 32_000_000)); channel.change(); await h.flush(); assert.equal(h.view.TotalBudget, 32_000_000);
  dispose(); const reads = h.reads; channel.status?.("SUBSCRIBED"); channel.change(); await h.flush(); assert.equal(h.reads, reads);
});

test("budget forward and back focus keeps the newest snapshot when an old load finishes late", async () => {
  const h = budgetRefreshHarness(); h.focus(); await h.flush(); h.blur();
  let resolveOld; h.queued.push(() => new Promise(resolve => { resolveOld = resolve; })); h.focus(); await h.flush();
  h.blur(); h.setJourney(h.row(3, 35_000_000)); h.focus(); await h.flush();
  resolveOld({ data: h.row(2, 25_000_000), error: null }); await h.flush();
  assert.equal(h.view.TotalBudget, 35_000_000); assert.equal(h.coordinator.captureIdentity().stateRevision, 3);
});

test("budget recovery cannot merge an old account or couple response into the newly focused scope", async () => {
  for (const changeOwner of [false, true]) {
    const h = budgetRefreshHarness(); h.focus(); await h.flush();
    let resolveOld; const oldRow = h.row(2, 22_000_000);
    h.queued.push(() => new Promise(resolve => { resolveOld = resolve; })); h.load(); await h.flush();
    h.identity.coupleId = "50000000-0000-4000-8000-000000000002";
    if (changeOwner) { h.identity.userId = "10000000-0000-4000-8000-000000000002"; h.authChanged(); }
    h.setJourney(h.row(2, 40_000_000)); h.blur(); h.focus(); await h.flush();
    resolveOld({ data: oldRow, error: null }); await h.flush();
    assert.equal(h.view.CoupleId, h.identity.coupleId); assert.equal(h.view.TotalBudget, 40_000_000);
  }
});

test("budget recovery leaves an in-flight save token current and retries a failed refresh", async () => {
  const h = budgetRefreshHarness(); h.focus(); await h.flush(); const token = h.coordinator.beginMutation("total");
  const reads = h.reads; h.appState("background"); h.appState("active"); await h.flush();
  assert.equal(h.reads, reads); assert.equal(h.coordinator.isCurrent(token), true);
  h.coordinator.finishMutation(token);
  h.queued.push(async () => ({ data: null, error: { code: "offline" } })); h.appState("background"); h.appState("active"); await h.flush();
  assert.match(h.view.LoadError, /다시 불러와/u); assert.equal(h.view.TotalBudget, 20_000_000);
  h.setJourney(h.row(2, 30_000_000)); await h.load();
  assert.equal(h.view.LoadError, null); assert.equal(h.view.TotalBudget, 30_000_000);
});

test("the actual budget writer uses the captured couple even when the new couple has the same revision", async () => {
  const tree = ts.createSourceFile("budget.tsx", budgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let source;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submitBudgetMutation") source = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(source);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  let submitted, writes = 0;
  const stop = new Error("request captured");
  const send = async (_userId, _path, options) => {
    submitted = JSON.parse(options.body);
    if (!submitted.expected_couple_id || submitted.expected_couple_id === "new-couple") writes++;
    throw stop;
  };
  const writer = new Function("revisionCoordinator", "apiFetchForExpectedUser", `${code}; return submitBudgetMutation;`)({ isCurrent: () => true }, send);
  await assert.rejects(writer({ ownerId: "same-user", coupleId: "old-couple", stateRevision: 7 }, { expected_revision: 7, expected_couple_id: "new-couple", total_budget: 30000000 }), error => error === stop);
  assert.equal(submitted.expected_couple_id, "old-couple");
  assert.equal(submitted.expected_revision, 7);
  assert.equal(submitted.total_budget, 30000000);
  assert.equal(writes, 0);
});

test("budget loads one couple/revision identity and invalidates it on auth change", () => {
  assert.match(
    budgetSource,
    /select\("couple_id, total_budget, progress, state_revision"\)/,
  );
  assert.match(budgetSource, /onAuthStateChange/);
  assert.match(budgetSource, /beginLoad\(user\.id\)/);
  assert.match(budgetSource, /commitJourney\([\s\S]*profile\.couple_id/);
});

test("budget writes use owner-bound requests, revision helpers, and atomic per-kind locks", () => {
  assert.match(budgetSource, /apiFetchForExpectedUser\(/);
  assert.doesNotMatch(budgetSource, /\bapiFetch\(/);
  assert.match(budgetSource, /beginMutation\("total"\)/);
  assert.match(budgetSource, /beginMutation\("category"\)/);
  assert.match(budgetSource, /buildTotalBudgetMutation\(/);
  assert.match(budgetSource, /buildCategoryBudgetMutation\(/);
  assert.match(budgetSource, /isBudgetEditBaseCurrent\(totalEditBaseRef\.current, token\)/);
  assert.match(budgetSource, /isBudgetEditBaseCurrent\(categoryEditBaseRef\.current, token\)/);
  assert.doesNotMatch(budgetSource, /select\("progress"\)/);
  assert.doesNotMatch(budgetSource, /parseInt\(/);

  assert.match(apiSource, /initialSession\?\.userId\.toLowerCase\(\) !== expectedUserId\.toLowerCase\(\)/);
});

test("budget UI distinguishes partner approval from an applied save", () => {
  assert.match(budgetSource, /parseBudgetMutationResponse\(/);
  assert.match(budgetSource, /pending_partner/);
  assert.match(budgetSource, /파트너 확인 대기/);
  assert.match(budgetSource, /requestId/);
  assert.match(budgetSource, /\/api\/couple-plan-changes\/\$\{pending\.requestId\}/);
  assert.match(budgetSource, /verification: "unverified"/);
});

test("budget save controls say save, not request", () => {
  // 예산은 저장하면 바로 반영되고, 연결된 상대에게는 알림만 간다(2026-08-23).
  // 저장 버튼과 읽어 주는 이름이 "변경 요청" 이면 상대의 승인을 기다리는 것으로 읽힌다.
  // 웹의 같은 버튼은 「저장」이다(apps/web/src/components/app/budget/BudgetContent.tsx).
  assert.match(budgetSource, /accessibilityLabel="총 예산 저장"/);
  assert.match(budgetSource, /accessibilityLabel="카테고리 예산 저장"/);
  assert.match(budgetSource, /<Text style=\{s\.saveTxt\}>저장<\/Text>/);
  // 실패 안내도 같이 본다. 버튼만 고치고 "변경 요청에 실패했어요" 가 남으면 같은 오해가 돌아온다.
  assert.doesNotMatch(
    budgetSource,
    /변경 요청/u,
  );
});

test("a cold budget screen recovers only an owner-bound requester after exact status verification", () => {
  assert.match(budgetSource, /fetchActiveBudgetApprovalStatus/);
  assert.match(
    budgetSource,
    /pendingApprovalRef\.current === null[\s\S]*fetchActiveBudgetApprovalStatus\(/,
  );
  assert.match(
    budgetSource,
    /apiFetchForExpectedUser\(snapshot\.ownerId, path, options\)/,
  );
});

test("snapshot revision changes retain a bound pending request until its exact status is terminal", () => {
  assert.match(budgetSource, /isPendingBudgetApprovalBoundToIdentity/);
  assert.doesNotMatch(
    budgetSource,
    /snapshot\.stateRevision > pending\.expectedRevision/,
  );
  assert.doesNotMatch(
    budgetSource,
    /pending\.expectedRevision === snapshot\.stateRevision/,
  );
  assert.match(
    budgetSource,
    /pendingOutcome\.status === "applied"[\s\S]*pendingApprovalRef\.current = null/,
  );
  assert.match(
    budgetSource,
    /pendingOutcome\.status === "stale"\s*\|\|\s*pendingOutcome\.status === "rejected"/,
  );
});

test("a budget request sends zero network calls when its captured owner is no longer current", async () => {
  let networkCalls = 0;
  await assert.rejects(
    fetchMobileWebApiWithSession({
      expectedUserId: "user-a",
      initialSession: { userId: "user-b", accessToken: "token-b" },
      fetchWithAccessToken: async () => {
        networkCalls += 1;
        return { status: 200 };
      },
      refreshSession: async () => null,
    }),
    /MOBILE_WEB_API_SESSION_OWNER_MISMATCH/,
  );
  assert.equal(networkCalls, 0);
});
