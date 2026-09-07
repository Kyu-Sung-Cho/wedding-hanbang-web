import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

const snapshot = {
  userId: "11111111-1111-4111-8111-111111111111",
  coupleId: "22222222-2222-4222-8222-222222222222",
  weddingDate: "2027-05-01",
  venue: "기존 예식장",
  totalBudget: 30_000_000,
};

function me() {
  return {
    profile: { id: snapshot.userId, couple_id: snapshot.coupleId },
    journey: { couple_id: snapshot.coupleId, state_revision: 17,
      wedding_date: snapshot.weddingDate, venue: snapshot.venue, total_budget: snapshot.totalBudget },
  };
}

// RN 렌더러 대신 화면의 실제 저장 함수를 실행하고 HTTP 경계만 대체한다.
function saveHarness(payload, baseline = snapshot) {
  const source = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submitWeddingPlanChange") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(declaration, "settings screen still routes saves through its plan-change boundary");
  const helpers = ts.transpileModule(readFileSync(new URL("../lib/weddingSettings.ts", import.meta.url), "utf8").replace(/\bexport\s+/g, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = ts.transpileModule(declaration.getText(file), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    return new globalThis.Response(JSON.stringify(path === "/api/auth/me" ? payload : { status: "applied" }));
  };
  const ownedRequest = async (owner, path, options) => {
    assert.equal(owner, baseline?.userId, "each request must remain bound to the form owner");
    return request(path, options);
  };
  const save = new Function("apiFetch", "apiFetchForExpectedUser", "settingsSnapshot", `${helpers}\n${compiled}\nreturn submitWeddingPlanChange;`)(request, ownedRequest, baseline);
  return { save, requests };
}

test("an old couple's dirty settings cannot be submitted to the newly connected couple", async () => {
  const current = me();
  current.profile.couple_id = "33333333-3333-4333-8333-333333333333";
  current.journey.couple_id = current.profile.couple_id;
  const { save, requests } = saveHarness(current);
  await assert.rejects(save({ venue: "이전 커플에서 입력한 예식장" }), /커플 연결/);
  assert.equal(requests.some(({ options }) => options?.method === "PATCH"), false);
});

test("a partner's change to an edited field is not overwritten using their newer revision", async () => {
  for (const [field, replacement, draft] of [
    ["venue", "파트너가 변경한 예식장", "내가 입력한 예식장"],
    ["wedding_date", "2027-06-01", "2027-07-01"],
    ["total_budget", 40_000_000, 50_000_000],
  ]) {
    const current = me();
    current.journey[field] = replacement;
    const { save, requests } = saveHarness(current);
    await assert.rejects(save({ [field]: draft }), /그 사이 결혼 정보가 바뀌었어요/);
    assert.equal(requests.some(({ options }) => options?.method === "PATCH"), false);
  }
});

test("missing owner or field baselines fail closed without a PATCH", async () => {
  const missingField = { ...snapshot };
  delete missingField.venue;
  const missingServerField = me();
  delete missingServerField.journey.venue;
  for (const [current, baseline] of [
    [me(), null], [me(), missingField], [missingServerField, snapshot],
    [{ journey: me().journey }, snapshot],
    [{ ...me(), journey: { state_revision: 17 } }, snapshot],
  ]) {
    const { save, requests } = saveHarness(current, baseline);
    await assert.rejects(save({ venue: "내 새 예식장" }));
    assert.equal(requests.some(({ options }) => options?.method === "PATCH"), false);
  }
});

test("an unrelated partner edit permits saving unchanged baseline fields at the latest revision", async () => {
  const current = me();
  current.journey.total_budget = 40_000_000;
  const { save, requests } = saveHarness(current);
  assert.equal(await save({ venue: "내 새 예식장" }), "applied");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    expected_couple_id: snapshot.coupleId,
    expected_revision: 17,
    venue: "내 새 예식장",
  });
});

test("nullable baseline values must match exactly and can be cleared", async () => {
  const baseline = { ...snapshot, venue: null };
  const current = me();
  current.journey.venue = null;
  const { save } = saveHarness(current, baseline);
  assert.equal(await save({ venue: "정한 예식장" }), "applied");
  const clear = saveHarness(me());
  await clear.save({ venue: null });
  assert.equal(JSON.parse(clear.requests[1].options.body).venue, null);
});

test("different account or mismatched journey ownership cannot use the fresh revision", async () => {
  for (const mutate of [
    (value) => { value.profile.id = "44444444-4444-4444-8444-444444444444"; },
    (value) => { value.journey.couple_id = "44444444-4444-4444-8444-444444444444"; },
  ]) {
    const current = me();
    mutate(current);
    const { save, requests } = saveHarness(current);
    await assert.rejects(save({ venue: "내 새 예식장" }), /커플 연결/);
    assert.equal(requests.length, 1);
  }
});

test("invalid revision values cannot authorize a settings write", async () => {
  for (const revision of [null, "17", -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const current = me();
    current.journey.state_revision = revision;
    const { save, requests } = saveHarness(current);
    await assert.rejects(save({ venue: "내 새 예식장" }), /결혼 정보를 불러오지 못했어요/);
    assert.equal(requests.length, 1);
  }
});

function mixedSaveHarness({ failProfile = true, beforeProfileResponse, beforeJourneyResponse, beforeSettingsResponse } = {}) {
  const source = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && ["handleSave", "submitWeddingPlanChange", "reloadAfterPlanChange"].includes(node.name?.text)) declarations.push(node.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(declarations.length, 3);
  const helpers = readFileSync(new URL("../lib/weddingSettings.ts", import.meta.url), "utf8").replace(/\bexport\s+/g, "");
  const compiled = ts.transpileModule(`${helpers}\n${declarations.join("\n")}`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  const original = { ...snapshot, name: "원래 이름", communityNickname: "원래 별명", role: "bride" };
  const server = me();
  server.settings = {
    user_id: original.userId, couple_id: original.coupleId, name: original.name,
    community_nickname: original.communityNickname, role: original.role,
    wedding_date: original.weddingDate, venue: original.venue, total_budget: original.totalBudget,
    care_notifications_enabled: false, care_notifications_consented_at: null,
  };
  let profileCalls = 0;
  const requests = [];
  const alerts = [];
  let harness;
  const request = async (owner, path, options) => {
    if (owner !== server.profile.id) throw new Error("API_SESSION_OWNER_MISMATCH");
    requests.push({ path, options });
    if (path === "/api/auth/me") return globalThis.Response.json(server);
    const body = options?.body ? JSON.parse(options.body) : null;
    if (path === "/api/journey") {
      if (body.expected_couple_id !== server.profile.couple_id) return globalThis.Response.json({ error: "커플 연결 변경" }, { status: 409 });
      for (const key of ["wedding_date", "venue", "total_budget"]) if (key in body) {
        server.journey[key] = body[key]; server.settings[key] = body[key];
      }
      server.journey.state_revision += 1;
      await beforeJourneyResponse?.({ harness, server });
      return globalThis.Response.json({ status: "applied" });
    }
    if (options?.method === "PATCH") {
      profileCalls += 1;
      if (body.expected_couple_id !== server.profile.couple_id) return globalThis.Response.json({ error: "커플 연결 변경" }, { status: 409 });
      if (failProfile && profileCalls === 1) return globalThis.Response.json({ error: "이름 저장 연결 실패" }, { status: 503 });
      Object.assign(server.settings, body.changes);
      await beforeProfileResponse?.({ harness, server });
    }
    await beforeSettingsResponse?.({ harness, server });
    return globalThis.Response.json({ settings: server.settings });
  };
  harness = new Function("baseline", "apiFetchForExpectedUser", "Alert", "Animated", `${compiled}
    let settingsSnapshot = baseline;
    let initialData = {userId: baseline.userId, coupleId: baseline.coupleId, nickname: baseline.name, communityNickname: baseline.communityNickname, role: baseline.role, weddingDate: baseline.weddingDate, venue: baseline.venue, totalBudget: String(baseline.totalBudget / 10000)};
    let data = {...initialData, nickname: '바꾼 이름', venue: '바꾼 식장'};
    let saved = false, saving = false;
    const saveInFlightRef = {current: false};
    const settingsDataRef = {get current() {return data}};
    const setData = value => {data = typeof value === 'function' ? value(data) : value};
    const setInitialData = value => {initialData = typeof value === 'function' ? value(initialData) : value};
    const setSettingsSnapshot = value => {settingsSnapshot = typeof value === 'function' ? value(settingsSnapshot) : value};
    const setSaving = value => {saving = value};
    const setSaved = value => {saved = value};
    const setLoadError = () => {};
    const clearCommunityCaches = () => {};
    const toKoreanErrorMessage = error => error.message;
    const checkScale = {};
    return { save: handleSave, edit: patch => {data = {...data, ...patch}}, replaceForm: (nextData, nextSnapshot) => {data = nextData; initialData = {...nextData}; settingsSnapshot = nextSnapshot}, state: () => ({data, initialData, settingsSnapshot, saved, saving}) };
  `)(original, request, { alert: (...args) => alerts.push(args) }, { sequence: () => ({ start: () => {} }), spring: () => ({}), timing: () => ({}) });
  return { ...harness, requests, alerts, server };
}

test("retry after the profile step fails saves only the unsaved profile draft", async () => {
  const harness = mixedSaveHarness();
  await harness.save();
  assert.equal(harness.server.journey.venue, "바꾼 식장");
  assert.equal(harness.state().data.nickname, "바꾼 이름");
  await harness.save();
  assert.equal(harness.server.settings.name, "바꾼 이름");
  assert.equal(harness.requests.filter(item => item.path === "/api/journey").length, 1);
  assert.equal(harness.state().saved, true);
});

test("edits made while the profile retry is in flight remain as an unsaved draft", async () => {
  const harness = mixedSaveHarness({ beforeProfileResponse: ({ harness }) => harness.edit({ nickname: "응답 전에 더 고친 이름", venue: "응답 전에 더 고친 식장" }) });
  await harness.save();
  await harness.save();
  assert.equal(harness.state().data.nickname, "응답 전에 더 고친 이름");
  assert.equal(harness.state().data.venue, "응답 전에 더 고친 식장");
  assert.equal(harness.state().settingsSnapshot.name, "바꾼 이름");
  assert.equal(harness.state().settingsSnapshot.venue, "바꾼 식장");
  assert.equal(harness.state().saved, false);
});

test("profile-only saves also preserve newer edits and do not announce those drafts as saved", async () => {
  const harness = mixedSaveHarness({ failProfile: false, beforeProfileResponse: ({ harness }) => harness.edit({ nickname: "추가로 편집한 이름" }) });
  harness.edit({ venue: snapshot.venue });
  await harness.save();
  assert.equal(harness.requests.some(item => item.path === "/api/journey"), false);
  assert.equal(harness.server.settings.name, "바꾼 이름");
  assert.equal(harness.state().data.nickname, "추가로 편집한 이름");
  assert.equal(harness.state().settingsSnapshot.name, "바꾼 이름");
  assert.equal(harness.state().saved, false);
});

test("an unrelated partner edit survives the profile-only retry after partial success", async () => {
  const harness = mixedSaveHarness();
  await harness.save();
  harness.server.journey.total_budget = 40_000_000;
  harness.server.settings.total_budget = 40_000_000;
  await harness.save();
  const retry = harness.requests.at(-1);
  assert.equal(retry.path, "/api/settings/wedding-profile");
  assert.deepEqual(JSON.parse(retry.options.body).changes, { name: "바꾼 이름" });
  assert.equal(harness.server.journey.total_budget, 40_000_000);
  assert.equal(harness.state().data.totalBudget, "4000");
});

test("a new budget edit still conflicts if a partner changed its original baseline", async () => {
  const harness = mixedSaveHarness();
  await harness.save();
  harness.server.journey.total_budget = 40_000_000;
  harness.server.settings.total_budget = 40_000_000;
  harness.edit({ totalBudget: "3500" });
  await harness.save();
  assert.equal(harness.requests.filter(item => item.path === "/api/journey").length, 1);
  assert.equal(harness.state().data.totalBudget, "3500");
  assert.equal(harness.server.journey.total_budget, 40_000_000);
  assert.match(harness.alerts.at(-1)[1], /그 사이 결혼 정보가 바뀌었어요/);
});

test("a couple change after the plan commit cannot replay the remaining profile draft into the new couple", async () => {
  const harness = mixedSaveHarness({ failProfile: false, beforeJourneyResponse: ({ server }) => {
    server.profile.couple_id = "33333333-3333-4333-8333-333333333333";
  } });
  await harness.save();
  assert.equal(harness.server.settings.name, "원래 이름");
  assert.equal(harness.state().data.nickname, "바꾼 이름");
  assert.equal(harness.state().settingsSnapshot.coupleId, snapshot.coupleId);
  assert.equal(harness.state().saved, false);
});

test("an account switch between plan and profile requests sends no old draft with the new account", async () => {
  const harness = mixedSaveHarness({ failProfile: false, beforeJourneyResponse: ({ server }) => {
    server.profile.id = "44444444-4444-4444-8444-444444444444";
  } });
  await harness.save();
  assert.equal(harness.requests.some(item => item.path === "/api/settings/wedding-profile"), false);
  assert.equal(harness.server.settings.name, "원래 이름");
  assert.equal(harness.state().saved, false);
});

test("late profile and plan-refresh responses do not replace a newer owner's form or baseline", async () => {
  for (const profileOnly of [false, true]) {
    let replacement;
    const harness = mixedSaveHarness({ failProfile: false, beforeSettingsResponse: ({ harness }) => {
      const previous = harness.state();
      const owner = "44444444-4444-4444-8444-444444444444";
      const couple = "55555555-5555-4555-8555-555555555555";
      replacement = {
        data: { ...previous.data, userId: owner, coupleId: couple, nickname: "새 계정 이름" },
        snapshot: { ...previous.settingsSnapshot, userId: owner, coupleId: couple, name: "새 계정 이름" },
      };
      harness.replaceForm(replacement.data, replacement.snapshot);
    } });
    harness.edit(profileOnly ? { venue: snapshot.venue } : { nickname: "원래 이름" });
    await harness.save();
    assert.deepEqual(harness.state().data, replacement.data);
    assert.deepEqual(harness.state().initialData, replacement.data);
    assert.deepEqual(harness.state().settingsSnapshot, replacement.snapshot);
    assert.equal(harness.state().saved, false);
  }
});

test("a lost plan response never advances a baseline or starts the profile write without confirmation", async () => {
  const harness = mixedSaveHarness({ beforeJourneyResponse: () => { throw new Error("합성 응답 연결 종료"); } });
  await harness.save();
  assert.equal(harness.server.journey.venue, "바꾼 식장");
  assert.equal(harness.state().settingsSnapshot.venue, snapshot.venue);
  assert.equal(harness.state().initialData.venue, snapshot.venue);
  assert.equal(harness.state().data.nickname, "바꾼 이름");
  assert.equal(harness.requests.some(item => item.path === "/api/settings/wedding-profile"), false);
  assert.equal(harness.state().saved, false);
});

test("a double save while the plan response is pending sends each mutation only once", async () => {
  let release;
  let started;
  const waiting = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const harness = mixedSaveHarness({ failProfile: false, beforeJourneyResponse: () => { started(); return waiting; } });
  const first = harness.save();
  await ready;
  await harness.save();
  release();
  await first;
  assert.equal(harness.requests.filter(item => item.path === "/api/journey").length, 1);
  assert.equal(harness.requests.filter(item => item.path === "/api/settings/wedding-profile").length, 1);
  assert.equal(harness.state().saving, false);
});
