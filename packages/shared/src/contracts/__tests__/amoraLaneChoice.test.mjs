// 아모라 대화를 처음 열 때 '함께 대화'와 '나만 (상담)' 중 하나를 고르게 하는 규칙.
//
// 2026-09-26 전까지 세 화면(웹 전체화면·웹 옆 패널·앱)이 모두 `useState("shared")` 로
// 시작했다. 이 검사는 그 기본값이 돌아오는 것과, 고를 수 없는 사람에게 카드가 뜨거나
// 쓸 수 없는 '나만'으로 열리는 것을 막는다.
//
// 모듈을 TypeScript 그대로 옮겨 돌린다. 런타임 의존성이 생기면 아래 require 가 던진다.
// 지금은 타입 하나만 가져오고, 그 import 는 옮길 때 지워진다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const modulePath = fileURLToPath(new URL("../amoraLaneChoice.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(modulePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  module.exports,
  module,
  (name) => {
    throw new Error(`런타임 의존성이 생겼다: ${name}`);
  },
);
const {
  AMORA_LANE_CHOICE_COPY,
  AMORA_LANE_STORAGE_KEY_PREFIX,
  amoraLaneStorageKey,
  parseStoredAmoraLane,
  resolveAmoraLaneEntryScope,
  resolveInitialAmoraLane,
} = module.exports;

/** 역할이 있고 체험이 아닌, 처음 여는 사람. 각 경우는 여기서 한 칸씩만 바꾼다. */
const firstTimer = Object.freeze({
  storedLane: null,
  privateAvailable: true,
  isDemo: false,
  explicitScope: null,
  roleKnown: true,
});
const resolve = (overrides = {}) => resolveInitialAmoraLane({ ...firstTimer, ...overrides });

const WAIT = { lane: null, needsChoice: false };
const CHOOSE = { lane: null, needsChoice: true };
const SHARED = { lane: "shared", needsChoice: false };
const PRIVATE = { lane: "private", needsChoice: false };

// ── 기억 키 ───────────────────────────────────────────────────────────

test("기억 키는 'hb:amora-lane:v1:' 뒤에 사용자 id 를 붙인다", () => {
  assert.equal(AMORA_LANE_STORAGE_KEY_PREFIX, "hb:amora-lane:v1:");
  assert.equal(
    amoraLaneStorageKey("6f1c2d3e-0000-4000-8000-000000000001"),
    "hb:amora-lane:v1:6f1c2d3e-0000-4000-8000-000000000001",
  );
});

test("한 기기를 두 사람이 써도 기억이 섞이지 않는다", () => {
  const bride = amoraLaneStorageKey("user-a");
  const groom = amoraLaneStorageKey("user-b");
  assert.notEqual(bride, groom);
  assert.ok(bride.endsWith("user-a"));
  assert.ok(groom.endsWith("user-b"));
});

test("사용자 id 가 없으면 키를 만들지 않는다(모두가 한 칸을 나눠 쓰게 된다)", () => {
  for (const missing of [null, undefined, "", " ", "\t\n", 42, {}, []]) {
    assert.equal(amoraLaneStorageKey(missing), null, `${JSON.stringify(missing)} 로 키를 만들었다`);
  }
});

// ── 저장값 파서 ─────────────────────────────────────────────────────────

test("저장값은 정확히 'shared' 와 'private' 만 받는다", () => {
  assert.equal(parseStoredAmoraLane("shared"), "shared");
  assert.equal(parseStoredAmoraLane("private"), "private");
});

test("모양이 조금이라도 다르면 버리고 다시 묻는다", () => {
  const junk = [
    null,
    undefined,
    "",
    " shared",
    "private ",
    "Shared",
    "PRIVATE",
    "\"shared\"",
    "bride_private",
    "groom_private",
    "shared_ai",
    "private_ai",
    "shared_partner",
    "null",
    "undefined",
    1,
    0,
    true,
    false,
    {},
    [],
    ["private"],
    { lane: "private" },
  ];
  for (const value of junk) {
    assert.equal(parseStoredAmoraLane(value), null, `${JSON.stringify(value)} 를 레인으로 읽었다`);
  }
});

// ── 처음 열 때: 이름 붙인 경우 ─────────────────────────────────────────────

test("처음 여는 사람에게는 고르게 한다(예전처럼 '함께'로 열지 않는다)", () => {
  assert.deepEqual(resolve(), CHOOSE);
  assert.deepEqual(resolve({ storedLane: undefined }), CHOOSE);
});

test("기억한 칸으로 연다", () => {
  assert.deepEqual(resolve({ storedLane: "shared" }), SHARED);
  assert.deepEqual(resolve({ storedLane: "private" }), PRIVATE);
});

test("기억을 읽지 못했거나 모양이 틀리면 카드를 다시 띄운다(안전한 쪽)", () => {
  for (const storedLane of ["", "Private", "bride_private", "hb:amora-lane:v1:private"]) {
    assert.deepEqual(resolve({ storedLane }), CHOOSE, `${storedLane} 로 칸을 골랐다`);
  }
});

test("역할 정보가 오기 전에는 카드도 탭도 정하지 않는다", () => {
  assert.deepEqual(resolve({ roleKnown: false }), WAIT);
  assert.deepEqual(resolve({ roleKnown: false, storedLane: "private" }), WAIT);
  assert.deepEqual(resolve({ roleKnown: false, explicitScope: "shared" }), WAIT);
  assert.deepEqual(resolve({ roleKnown: false, isDemo: true }), WAIT);
  assert.deepEqual(resolve({ roleKnown: false, privateAvailable: false }), WAIT);
});

test("체험이면 지금처럼 '함께'로 열고 카드를 띄우지 않는다", () => {
  assert.deepEqual(resolve({ isDemo: true }), SHARED);
  // 체험은 나만 레인을 못 쓴다. 기억이나 주소가 '나만'이어도 그 탭으로 열지 않는다.
  assert.deepEqual(resolve({ isDemo: true, storedLane: "private" }), SHARED);
  assert.deepEqual(resolve({ isDemo: true, explicitScope: "private" }), SHARED);
  assert.deepEqual(resolve({ isDemo: true, storedLaneLoaded: false }), SHARED);
});

test("역할이 없으면 지금처럼 '함께'로 열고 카드를 띄우지 않는다", () => {
  assert.deepEqual(resolve({ privateAvailable: false }), SHARED);
  assert.deepEqual(resolve({ privateAvailable: false, storedLane: "private" }), SHARED);
  assert.deepEqual(resolve({ privateAvailable: false, explicitScope: "private" }), SHARED);
  assert.deepEqual(resolve({ privateAvailable: false, storedLaneLoaded: false }), SHARED);
});

test("레인을 정해서 들어오면 기억보다 이기고 카드를 띄우지 않는다", () => {
  assert.deepEqual(resolve({ explicitScope: "shared" }), SHARED);
  assert.deepEqual(resolve({ explicitScope: "private" }), PRIVATE);
  assert.deepEqual(resolve({ explicitScope: "shared", storedLane: "private" }), SHARED);
  assert.deepEqual(resolve({ explicitScope: "private", storedLane: "shared" }), PRIVATE);
  // 기억을 읽는 중이어도 기다릴 필요가 없다. 들어온 경로가 이미 칸을 정했다.
  assert.deepEqual(resolve({ explicitScope: "shared", storedLaneLoaded: false }), SHARED);
});

test("모르는 ?scope= 값은 없는 것으로 본다", () => {
  for (const explicitScope of ["", "all", "Private", " shared", "bride_private", "partner"]) {
    assert.deepEqual(resolve({ explicitScope }), CHOOSE, `${explicitScope} 가 카드를 건너뛰었다`);
    assert.deepEqual(resolve({ explicitScope, storedLane: "private" }), PRIVATE);
  }
});

// ── 어떤 진입이 칸을 정하나(2026-09-27 검토) ─────────────────────────────
//
// 처음에는 웹이 `?prefill=`·가입 인계까지 '함께'를 명시한 진입으로 봤다. 웹에서 대화로 오는
// 주요 길 대부분이 `prefill` 을 싣기 때문에, 처음 온 사람은 카드를 못 보고 '함께'로 열렸다.

test("칸을 정하는 진입은 셋뿐이다 — ?scope=, 준비 안내 질문, 파트너 합류 직후 계획 점검", () => {
  assert.equal(resolveAmoraLaneEntryScope({ scope: "private" }), "private");
  assert.equal(resolveAmoraLaneEntryScope({ scope: "shared" }), "shared");
  assert.equal(resolveAmoraLaneEntryScope({ preparationSource: true }), "shared");
  assert.equal(resolveAmoraLaneEntryScope({ joinedPlanReview: true }), "shared");
  // 주소가 칸을 적었으면 그것이 먼저다.
  assert.equal(resolveAmoraLaneEntryScope({ scope: "private", preparationSource: true }), "private");
  assert.equal(resolveAmoraLaneEntryScope({ scope: "private", joinedPlanReview: true }), "private");
});

test("일반 초안(prefill·가입 인계·라운지 버튼)은 칸을 정하지 않는다 — 기억이나 카드를 따른다", () => {
  assert.equal(resolveAmoraLaneEntryScope({}), null);
  assert.equal(resolveAmoraLaneEntryScope({ preparationSource: false, joinedPlanReview: false }), null);
  for (const scope of [null, undefined, "", "Private", " shared", "both", 1, true]) {
    assert.equal(resolveAmoraLaneEntryScope({ scope }), null, JSON.stringify(scope));
  }
  // 참(true)이 아니면 정하지 않는다. 주소에서 온 문자열이 그대로 흘러들어도 '함께'로 열지 않는다.
  for (const flag of ["true", 1, "shared"]) {
    assert.equal(resolveAmoraLaneEntryScope({ preparationSource: flag }), null, JSON.stringify(flag));
    assert.equal(resolveAmoraLaneEntryScope({ joinedPlanReview: flag }), null, JSON.stringify(flag));
  }
  // 이어 붙이면: 처음 온 사람은 카드, '나만'을 기억한 사람은 '나만'.
  const general = resolveAmoraLaneEntryScope({});
  assert.deepEqual(resolve({ explicitScope: general }), CHOOSE);
  assert.deepEqual(resolve({ explicitScope: general, storedLane: "private" }), PRIVATE);
  // 합류 직후 계획 점검은 '나만'을 기억한 사람도 '함께'로 연다.
  assert.deepEqual(resolve({ explicitScope: resolveAmoraLaneEntryScope({ joinedPlanReview: true }), storedLane: "private" }), SHARED);
});

test("앱처럼 기억을 비동기로 읽는 동안에는 카드를 먼저 띄우지 않는다", () => {
  assert.deepEqual(resolve({ storedLaneLoaded: false }), WAIT);
  assert.deepEqual(resolve({ storedLaneLoaded: false, storedLane: "private" }), WAIT);
  assert.deepEqual(resolve({ storedLaneLoaded: true }), CHOOSE);
  assert.deepEqual(resolve({ storedLaneLoaded: true, storedLane: "private" }), PRIVATE);
});

// ── 처음 열 때: 모든 조합 ──────────────────────────────────────────────
//
// 위 경우들은 내가 고른 것이다. 고르지 않은 조합에서도 깨지면 안 되는 성질을 전부 돈다.

const STORED = [null, undefined, "shared", "private", "bride_private", ""];
const LOADED = [undefined, true, false];
const EXPLICIT = [null, undefined, "shared", "private", "all", ""];
const BOOL = [true, false];

function* everyInput() {
  for (const storedLane of STORED)
    for (const storedLaneLoaded of LOADED)
      for (const privateAvailable of BOOL)
        for (const isDemo of BOOL)
          for (const explicitScope of EXPLICIT)
            for (const roleKnown of BOOL) {
              const input = { storedLane, privateAvailable, isDemo, explicitScope, roleKnown };
              if (storedLaneLoaded !== undefined) input.storedLaneLoaded = storedLaneLoaded;
              yield input;
            }
}

test("어떤 조합에서도 결과는 네 모양 중 하나다", () => {
  let count = 0;
  for (const input of everyInput()) {
    count += 1;
    const out = resolveInitialAmoraLane(input);
    assert.deepEqual(Object.keys(out).sort(), ["lane", "needsChoice"]);
    const shape = JSON.stringify(out);
    assert.ok(
      [WAIT, CHOOSE, SHARED, PRIVATE].some((allowed) => JSON.stringify(allowed) === shape),
      `${JSON.stringify(input)} → ${shape}`,
    );
  }
  // 조합을 만드는 쪽이 고장 나 0개를 돌면 아래 성질이 전부 조용히 통과한다. 먼저 막는다.
  assert.equal(count, STORED.length * LOADED.length * 2 * 2 * EXPLICIT.length * 2);
});

test("쓸 수 없는 사람은 절대 '나만'으로 열리지 않는다", () => {
  for (const input of everyInput()) {
    const out = resolveInitialAmoraLane(input);
    if (out.lane !== "private") continue;
    assert.ok(input.roleKnown && !input.isDemo && input.privateAvailable, JSON.stringify(input));
  }
});

test("카드는 고를 수 있는 사람에게, 정할 근거가 없을 때만 뜬다", () => {
  for (const input of everyInput()) {
    const out = resolveInitialAmoraLane(input);
    const canChoose = input.roleKnown && !input.isDemo && input.privateAvailable;
    const hasExplicit = input.explicitScope === "shared" || input.explicitScope === "private";
    const hasStored = input.storedLane === "shared" || input.storedLane === "private";
    const stillReading = input.storedLaneLoaded === false;
    assert.equal(
      out.needsChoice,
      canChoose && !hasExplicit && !stillReading && !hasStored,
      JSON.stringify(input),
    );
    if (out.needsChoice) assert.equal(out.lane, null, "카드를 띄우면서 탭을 정했다");
  }
});

test("역할 정보가 오기 전에는 어떤 조합이든 기다린다", () => {
  for (const input of everyInput()) {
    if (input.roleKnown) continue;
    assert.deepEqual(resolveInitialAmoraLane(input), WAIT, JSON.stringify(input));
  }
});

test("체험·무역할은 역할 정보가 오면 언제나 '함께'다", () => {
  for (const input of everyInput()) {
    if (!input.roleKnown || (input.privateAvailable && !input.isDemo)) continue;
    assert.deepEqual(resolveInitialAmoraLane(input), SHARED, JSON.stringify(input));
  }
});

// ── 문구 ──────────────────────────────────────────────────────────────

test("선택 카드 문구는 파운더가 정한 문장 그대로다", () => {
  assert.equal(AMORA_LANE_CHOICE_COPY.title, "이 대화, 누구랑 볼까요?");
  assert.equal(AMORA_LANE_CHOICE_COPY.shared.label, "함께 대화");
  assert.equal(
    AMORA_LANE_CHOICE_COPY.shared.description,
    "파트너도 이 대화를 볼 수 있어요. 아모라와 정한 예산이나 일정이 반영되고, 바뀐 건 서로 알림이 가요.",
  );
  assert.equal(
    AMORA_LANE_CHOICE_COPY.shared.unlinkedPartnerNote,
    "파트너를 연결하면 지금까지 나눈 대화도 같이 보게 돼요.",
  );
  assert.equal(AMORA_LANE_CHOICE_COPY.private.label, "나만 (상담)");
  assert.equal(
    AMORA_LANE_CHOICE_COPY.private.description,
    "나만 볼 수 있어요. 예산이나 일정 반영은 함께 대화에서 할 수 있어요.",
  );
  assert.equal(AMORA_LANE_CHOICE_COPY.footnote, "위에서 언제든 바꿀 수 있어요.");
  assert.equal(AMORA_LANE_CHOICE_COPY.composerBlockedPlaceholder, "먼저 누구랑 볼지 골라 주세요.");
});

test("문구는 호출부가 바꿔 쓸 수 없다", () => {
  assert.ok(Object.isFrozen(AMORA_LANE_CHOICE_COPY));
  assert.ok(Object.isFrozen(AMORA_LANE_CHOICE_COPY.shared));
  assert.ok(Object.isFrozen(AMORA_LANE_CHOICE_COPY.private));
});
