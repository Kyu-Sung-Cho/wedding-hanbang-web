import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/weddingSettings.ts", import.meta.url));

function loadHelpers() {
  const source = readFileSync(helperPath, "utf8");
  const compiled = ts.transpileModule(source.replace(/\bexport\s+/g, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    `${compiled.outputText}\nreturn { buildWeddingSettingsPatch, parseWeddingSettingsResponse, createLatestSettingsLoadGate, splitWeddingSettingsPatch };`,
  )();
}

const snapshot = {
  userId: "00000000-0000-4000-8000-000000000001",
  coupleId: "10000000-0000-4000-8000-000000000001",
  name: "기존 이름",
  communityNickname: "기존 별명",
  role: "bride",
  weddingDate: "2027-05-01",
  venue: "기존 예식장",
  totalBudget: 30_000_000,
};

const form = {
  userId: snapshot.userId,
  coupleId: snapshot.coupleId,
  nickname: snapshot.name,
  communityNickname: snapshot.communityNickname,
  role: snapshot.role,
  weddingDate: snapshot.weddingDate,
  venue: snapshot.venue,
  totalBudget: "3000",
};

test("the mobile patch contains only changed fields and their exact old values", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();
  const patch = buildWeddingSettingsPatch({
    ...form,
    nickname: "  새 이름  ",
    venue: "  새 예식장  ",
  }, snapshot);

  assert.deepEqual(patch, {
    expected_couple_id: snapshot.coupleId,
    changes: { name: "새 이름", venue: "새 예식장" },
    expected: { name: "기존 이름", venue: "기존 예식장" },
  });
});

test("zero won and an explicit empty budget remain distinct", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();

  assert.deepEqual(
    buildWeddingSettingsPatch({ ...form, totalBudget: "0" }, snapshot),
    {
      expected_couple_id: snapshot.coupleId,
      changes: { total_budget: 0 },
      expected: { total_budget: 30_000_000 },
    },
  );
  assert.deepEqual(
    buildWeddingSettingsPatch({ ...form, totalBudget: "" }, snapshot),
    {
      expected_couple_id: snapshot.coupleId,
      changes: { total_budget: null },
      expected: { total_budget: 30_000_000 },
    },
  );
});

test("budget parsing is exact in 만원 and never accepts parseInt prefixes", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();

  assert.throws(
    () => buildWeddingSettingsPatch({ ...form, totalBudget: "12abc" }, snapshot),
    /예산/,
  );
  assert.throws(
    () => buildWeddingSettingsPatch({ ...form, totalBudget: "100000.0001" }, snapshot),
    /예산/,
  );
  assert.throws(
    () => buildWeddingSettingsPatch({ ...form, totalBudget: "100001" }, snapshot),
    /10억/,
  );
});

test("an impossible ISO date is rejected before the request", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();

  assert.throws(
    () => buildWeddingSettingsPatch({ ...form, weddingDate: "2027-02-29" }, snapshot),
    /날짜/,
  );
  assert.throws(
    () => buildWeddingSettingsPatch({ ...form, weddingDate: "0000-01-01" }, snapshot),
    /날짜/,
  );
});

test("a journey-only patch remains possible for a legacy profile with missing names", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();
  const legacySnapshot = {
    ...snapshot,
    name: null,
    communityNickname: null,
  };

  assert.deepEqual(buildWeddingSettingsPatch({
    ...form,
    nickname: "",
    communityNickname: "",
    venue: "새 예식장",
  }, legacySnapshot), {
    expected_couple_id: snapshot.coupleId,
    changes: { venue: "새 예식장" },
    expected: { venue: "기존 예식장" },
  });
});

test("unchanged legacy values are never normalized or blocked as hidden writes", () => {
  const { buildWeddingSettingsPatch } = loadHelpers();
  const legacySnapshot = {
    ...snapshot,
    venue: "  레거시 예식장  ",
    totalBudget: 2_000_000_000,
  };

  assert.deepEqual(buildWeddingSettingsPatch({
    ...form,
    nickname: "새 이름",
    venue: "  레거시 예식장  ",
    totalBudget: "200000",
  }, legacySnapshot), {
    expected_couple_id: snapshot.coupleId,
    changes: { name: "새 이름" },
    expected: { name: "기존 이름" },
  });
});

test("a successful server snapshot preserves null and zero exactly", () => {
  const { parseWeddingSettingsResponse } = loadHelpers();
  const parsed = parseWeddingSettingsResponse({
    settings: {
      user_id: snapshot.userId,
      couple_id: snapshot.coupleId,
      name: "새 이름",
      community_nickname: null,
      role: "bride",
      wedding_date: null,
      venue: null,
      total_budget: 0,
      care_notifications_enabled: false,
      care_notifications_consented_at: null,
    },
    careAvailability: { outboundEnabled: true, emailVerified: true },
  });

  assert.equal(parsed.data.totalBudget, "0");
  assert.equal(parsed.data.weddingDate, "");
  assert.equal(parsed.snapshot.totalBudget, 0);
  assert.equal(parsed.snapshot.weddingDate, null);
});

test("a slow previous settings load cannot commit after a fast retry", async () => {
  const { createLatestSettingsLoadGate } = loadHelpers();
  const gate = createLatestSettingsLoadGate();
  const committed = [];
  let finishSlow;
  const slow = new Promise((resolve) => {
    finishSlow = resolve;
  });

  const slowToken = gate.begin();
  const slowWork = slow.then((value) => {
    if (slowToken.isCurrent()) committed.push(value);
  });

  const fastToken = gate.begin();
  if (fastToken.isCurrent()) committed.push("fast-retry");
  finishSlow("stale-first-load");
  await slowWork;

  assert.deepEqual(committed, ["fast-retry"]);
  fastToken.cancel();
  assert.equal(fastToken.isCurrent(), false);
});

// 결혼 예정일·식장·총 예산은 `wedding_journeys` 직접 쓰기가 트리거로 막혀 있어
// (20260731123000_couple_plan_change_write_boundary.sql) 옛 설정 경로로 보내면 **항상**
// 거절된다. 웹은 이 셋만 /api/journey 로 따로 보내서 살아 있었고 모바일만 한꺼번에
// 보내고 있었다 — 그래서 앱에서는 온보딩을 지난 뒤 결혼식 날짜를 바꿀 수 없었다.
test("계획 필드는 설정 경로가 아니라 승인 경로로 간다", () => {
  const { buildWeddingSettingsPatch, splitWeddingSettingsPatch } = loadHelpers();
  const patch = buildWeddingSettingsPatch(
    { ...form, nickname: "새이름", weddingDate: "2027-05-22", venue: "새 예식장", totalBudget: "4000" },
    snapshot,
  );
  const { profilePatch, planChanges } = splitWeddingSettingsPatch(patch);

  assert.deepEqual(planChanges, {
    wedding_date: "2027-05-22",
    venue: "새 예식장",
    total_budget: 40_000_000,
  });
  // 이름은 옛 경로로 그대로 가야 한다 — 셋 때문에 같이 거절되면 안 된다.
  assert.deepEqual(Object.keys(profilePatch.changes), ["name"]);
  assert.equal(profilePatch.expected_couple_id, patch.expected_couple_id);
  assert.ok(!("wedding_date" in profilePatch.changes));
  assert.ok(!("wedding_date" in profilePatch.expected));
});

test("바꾼 것이 계획 필드뿐이면 설정 경로는 아예 부르지 않는다", () => {
  const { buildWeddingSettingsPatch, splitWeddingSettingsPatch } = loadHelpers();
  const patch = buildWeddingSettingsPatch({ ...form, weddingDate: "2027-05-22" }, snapshot);
  const { profilePatch, planChanges } = splitWeddingSettingsPatch(patch);
  assert.equal(profilePatch, null);
  assert.deepEqual(planChanges, { wedding_date: "2027-05-22" });
});

test("바꾼 것이 프로필뿐이면 승인 경로는 부르지 않는다", () => {
  const { buildWeddingSettingsPatch, splitWeddingSettingsPatch } = loadHelpers();
  const patch = buildWeddingSettingsPatch({ ...form, nickname: "새이름" }, snapshot);
  const { profilePatch, planChanges } = splitWeddingSettingsPatch(patch);
  assert.equal(planChanges, null);
  assert.deepEqual(Object.keys(profilePatch.changes), ["name"]);
});

