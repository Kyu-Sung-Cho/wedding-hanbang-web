// 앱의 회원 탈퇴는 **접수가 열려 있는지부터** 확인하는가.
//
// `/api/auth/delete` 는 `ACCOUNT_DELETION_INTAKE_ENABLED` 가 "true" 가 아니면 인증보다 먼저
// 503 을 돌려준다. 웹 설정은 `/api/auth/me` 의 `capabilities.accountDeletionIntake` 를 먼저
// 읽어, 닫혀 있거나 모르면 삭제 확인을 아예 띄우지 않고 이메일 요청 안내만 보여준다.
// 앱은 그 값을 읽지 않고 곧장 「탈퇴하기 → 최종 확인」 두 번을 누르게 한 **다음에야**
// 503 오류를 보여줬다. 되돌릴 수 없는 행동 앞에서 헛수고를 시키는 모양이었다.
//
// 여기서 지키는 것:
//   1. 열림이 **확인된** 경우에만 삭제 확인(두 번 확인)이 뜬다.
//   2. 닫힘·모름(요청 실패, 모양이 다른 응답, 다른 계정의 응답, 그 사이 계정 전환)은
//      웹과 같은 안내와 같은 주소의 「이메일로 탈퇴 요청하기」만 준다.
//   3. 안내 문장은 웹과 앱이 **같은 상수**를 쓴다(`@hanbang/shared`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function compile(relative, deps = {}) {
  const compiled = ts.transpileModule(read(relative), {
    fileName: "module.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const policy = compile("../../../../packages/shared/src/constants/accountDeletionPolicy.ts");
const gate = compile("../lib/accountDeletionIntake.ts", { "@hanbang/shared/constants": policy });

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";

function meResponse(body, { ok = true } = {}) {
  return { ok, json: async () => body };
}

async function run({ owners = [OWNER], fetchMe }) {
  const calls = { confirm: 0, confirmedOwners: [], support: [], fetched: [] };
  let ownerRead = 0;
  const state = await gate.beginAccountDeletion({
    readOwnerId: async () => owners[Math.min(ownerRead++, owners.length - 1)],
    fetchMe: async (ownerId) => {
      calls.fetched.push(ownerId);
      return fetchMe(ownerId);
    },
    showConfirm: (ownerId) => { calls.confirm += 1; calls.confirmedOwners.push(ownerId); },
    showSupport: (notice, supportState) => { calls.support.push({ notice, state: supportState }); },
  });
  return { state, calls };
}

test("열림이 확인되면 삭제 확인만 띄운다", async () => {
  const { state, calls } = await run({
    fetchMe: () => meResponse({ user: { id: OWNER }, capabilities: { accountDeletionIntake: true } }),
  });
  assert.equal(state, "open");
  assert.equal(calls.confirm, 1);
  assert.deepEqual(calls.confirmedOwners, [OWNER]);
  assert.deepEqual(calls.support, []);
  assert.deepEqual(calls.fetched, [OWNER]);
});

test("닫혀 있으면 삭제 확인 없이 웹과 같은 닫힘 안내를 준다", async () => {
  const { state, calls } = await run({
    fetchMe: () => meResponse({ user: { id: OWNER }, capabilities: { accountDeletionIntake: false } }),
  });
  assert.equal(state, "closed");
  assert.equal(calls.confirm, 0);
  assert.deepEqual(calls.support, [{ notice: policy.ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE, state: "closed" }]);
});

test("값이 true 가 아니면 열린 것으로 읽지 않는다", async () => {
  for (const intake of ["true", 1, null, undefined]) {
    const { calls } = await run({
      fetchMe: () => meResponse({ user: { id: OWNER }, capabilities: { accountDeletionIntake: intake } }),
    });
    assert.equal(calls.confirm, 0, `accountDeletionIntake=${String(intake)} 로 삭제 확인이 떴다`);
    assert.equal(calls.support.length, 1);
  }
});

test("모르면 삭제 확인을 띄우지 않는다 — 요청 실패·응답 이상·다른 계정", async () => {
  const cases = {
    "요청이 던짐": () => { throw new Error("network"); },
    "503": () => meResponse({ error: "잠시 후" }, { ok: false }),
    "401": () => meResponse({ error: "인증이 필요합니다." }, { ok: false }),
    "JSON 아님": () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }),
    "capabilities 없음": () => meResponse({ user: { id: OWNER } }),
    "다른 계정의 응답": () => meResponse({ user: { id: OTHER }, capabilities: { accountDeletionIntake: true } }),
    "user 없음": () => meResponse({ capabilities: { accountDeletionIntake: true } }),
    "배열": () => meResponse([]),
  };
  for (const [name, fetchMe] of Object.entries(cases)) {
    const { state, calls } = await run({ fetchMe });
    assert.equal(calls.confirm, 0, `${name}: 모르는 상태에서 삭제 확인이 떴다`);
    assert.equal(state, "unknown", name);
    assert.deepEqual(calls.support, [{ notice: policy.ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE, state: "unknown" }], name);
  }
});

test("로그인 사용자를 모르면 묻지도 않고 안내만 준다", async () => {
  const { state, calls } = await run({ owners: [null], fetchMe: () => { throw new Error("부르면 안 된다"); } });
  assert.equal(state, "unknown");
  assert.deepEqual(calls.fetched, []);
  assert.equal(calls.confirm, 0);
  assert.equal(calls.support.length, 1);
});

test("응답을 기다리는 사이 계정이 바뀌면 그 열림은 새 계정의 것이 아니다", async () => {
  const { state, calls } = await run({
    owners: [OWNER, OTHER],
    fetchMe: () => meResponse({ user: { id: OWNER }, capabilities: { accountDeletionIntake: true } }),
  });
  assert.equal(state, "unknown");
  assert.equal(calls.confirm, 0);
});

test("안내 문장은 공유 상수 한 곳에 있고, 주소를 문장에 중복하지 않는다", () => {
  assert.equal(policy.ACCOUNT_DELETION_INTAKE_CAPABILITY, "accountDeletionIntake");
  assert.equal(policy.ACCOUNT_DELETION_EMAIL_REQUEST_LABEL, "이메일로 탈퇴 요청하기");
  for (const notice of [policy.ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE, policy.ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE]) {
    assert.ok(typeof notice === "string" && notice.length > 10);
    assert.doesNotMatch(notice, /@/, "주소는 CONTACT 가 들고 있다");
  }
});

// ── 웹이 같은 상수를 쓰는가 ────────────────────────────────────────────────

const webIntake = read("../../../web/src/lib/account/deletionIntake.ts");
const webSettings = read("../../../web/src/app/(app)/settings/page.tsx");

test("웹도 같은 상수를 쓴다 — 두 앱이 각자 문장을 갖지 않는다", () => {
  assert.match(webIntake, /from "@hanbang\/shared\/constants"/);
  assert.doesNotMatch(webIntake, /ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE\s*=/, "웹이 닫힘 안내를 따로 정의한다");
  assert.doesNotMatch(webIntake, /function parseAccountDeletionIntakeCapability/, "웹이 판정을 따로 정의한다");
  assert.ok(webSettings.includes("{ACCOUNT_DELETION_EMAIL_REQUEST_LABEL}"), "웹 버튼이 공유 라벨을 쓰지 않는다");
  assert.ok(webSettings.includes("ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE"), "웹 모름 안내가 공유 상수를 쓰지 않는다");
  assert.doesNotMatch(webSettings, /자동 탈퇴 접수 상태를 확인하지 못했어요/, "웹에 문장 사본이 남아 있다");
});

// ── 앱 화면 배선 ────────────────────────────────────────────────────────────

const settings = read("../../app/settings/index.tsx");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 를 못 찾았다`);
  // 다음 최상위(두 칸 들여쓴) 함수 선언까지를 몸통으로 본다.
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}(?:async )?function \w+\(|\n {2}\/\/ 중립 준비 공간/);
  assert.ok(next > 0, `${name} 의 끝을 못 찾았다`);
  return source.slice(start, start + 1 + next);
}

test("탈퇴 버튼은 접수 확인부터 한다", () => {
  const entry = functionBody(settings, "handleDeleteAccount");
  assert.match(entry, /beginAccountDeletion\(/);
  assert.match(entry, /apiFetchForExpectedUserQuiet\(ownerId, "\/api\/auth\/me"\)/);
  assert.match(entry, /showConfirm: showDeletionConfirmation/);
  assert.match(entry, /showSupport: showDeletionSupportGuidance/);
  assert.doesNotMatch(entry, /\/api\/auth\/delete/, "접수 확인 전에 삭제 요청 경로가 있다");
  assert.doesNotMatch(entry, /Alert\.alert/, "접수 확인 전에 확인창을 띄운다");

  const button = settings.slice(settings.indexOf("{/* 회원 탈퇴 (위험 영역) */}"));
  assert.match(button.slice(0, 600), /onPress=\{\(\) => \{ void handleDeleteAccount\(\); \}\}/, "탈퇴 버튼이 확인 단계를 건너뛴다");
});

test("삭제 요청은 확인된 열림 뒤의 두 번 확인 안에만 있다", () => {
  const occurrences = settings.split('"/api/auth/delete"').length - 1;
  assert.equal(occurrences, 1, "삭제 요청 경로가 한 곳에만 있어야 한다");
  const confirm = functionBody(settings, "showDeletionConfirmation");
  assert.ok(confirm.includes('apiFetchForExpectedUser(deletionOwnerId, "/api/auth/delete"'), "삭제 요청이 확인창 밖에 있다");
  assert.ok(confirm.includes("최종 확인"));
});

test("닫힘·모름 안내는 웹과 같은 라벨과 주소로 메일만 연다", () => {
  const support = functionBody(settings, "showDeletionSupportGuidance");
  assert.match(support, /ACCOUNT_DELETION_EMAIL_REQUEST_LABEL/);
  assert.match(support, /mailto:\$\{CONTACT\.email\}/);
  assert.match(support, /ACCOUNT_DELETION_FACTS\.map/, "웹처럼 무엇이 지워지고 남는지도 함께 말한다");
  assert.doesNotMatch(support, /\/api\/auth\/delete|apiFetch/, "안내를 누르는 것으로 삭제가 접수되면 안 된다");
});
