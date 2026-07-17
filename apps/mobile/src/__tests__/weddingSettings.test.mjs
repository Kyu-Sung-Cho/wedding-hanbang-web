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
    `${compiled.outputText}\nreturn { buildWeddingSettingsPatch, parseWeddingSettingsResponse, createLatestSettingsLoadGate };`,
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
