import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import {
  AMORA_PERSONALIZATION_FIELD_NAMES,
  AMORA_PERSONALIZATION_SECTIONS,
  DEFAULT_AMORA_PERSONALIZATION,
} from "@hanbang/shared/amora-personalization";
import {
  AMORA_PERSONALIZATION_PATH,
  AMORA_STYLE_COPY,
  buildAmoraStyleSections,
  createAmoraPersonalizationSession,
  formatAmoraPersonalizationDate,
  viewAmoraPersonalization,
} from "../lib/amoraPersonalizationSession.mjs";

/**
 * 앱 「아모라 도움 방식」 설정 (2026-09-18).
 *
 * 웹에서 저장한 도움 방식은 앱 채팅 답변에도 매 턴 들어간다(같은 /api/chat). 그런데 앱에는 그 값을
 * 보거나 바꾸거나 지울 곳이 없었다 — 개인정보 처리방침은 "설정에서 직접 확인·수정·삭제"라고 적어 두었다.
 *
 * 이 파일이 지키는 것:
 * - 칸·선택지 문구는 웹 페이지가 import 하는 공유 상수에서만 온다. 화면에 한글을 박으면 여기서 깨진다.
 * - 고르기는 화면 안 초안만 바꾸고 요청을 보내지 않는다. 저장·삭제 본문은 서버 계약 그대로다.
 * - 서버가 확인한 값만 "저장했어요/지웠어요" 라고 말한다. 409 세 갈래는 서버가 준 사실대로 처리한다.
 * - 계정이 바뀐 뒤 도착한 응답은 새 계정 화면에 한 글자도 반영하지 않는다(커플 조건 없음, 소유자만 본다).
 */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const screen = read("../../app/settings/amora-style.tsx");
const settingsIndex = read("../../app/settings/index.tsx");
const sessionSource = read("../lib/amoraPersonalizationSession.mjs");
const webPage = read("../../../web/src/app/(app)/settings/amora-style/page.tsx");
const webHook = read("../../../web/src/hooks/useAmoraPersonalization.ts");
const webSettings = read("../../../web/src/app/(app)/settings/page.tsx");
const squash = (value) => value.replace(/\s+/gu, " ");

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const response = (status, body) => new globalThis.Response(JSON.stringify(body), { status });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const profile = (preferences = {}, revision = 3, updatedAt = "2026-09-18T03:00:00.000Z") => ({
  preferences: { ...DEFAULT_AMORA_PERSONALIZATION, ...preferences },
  revision,
  confirmedAt: "2026-09-01T03:00:00.000Z",
  updatedAt,
});
const conflictCopy = "다른 화면에서 도움 방식이 바뀌었어요. 새 값을 확인해 주세요.";
const koreanDate = (iso) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));

function harness(replies) {
  const calls = [];
  let live = owner;
  const request = async (expectedOwner, path, init) => {
    calls.push({ expectedOwner, path, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  const session = createAmoraPersonalizationSession(request, { readSessionOwner: async () => live });
  session.setOwner(owner);
  return { session, calls, setLive: (value) => { live = value; }, view: () => viewAmoraPersonalization(session.getState()) };
}

async function loaded(saved, extraReplies = []) {
  const h = harness([response(200, { profile: saved }), ...extraReplies]);
  assert.equal(await h.session.load(), true);
  return h;
}

test("저장값이 없는 계정은 기본값이 골라진 채로 보이고, 지우기는 없다", async () => {
  const h = await loaded(null);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].expectedOwner, owner, "요청 전에 세션 소유자를 확인하는 헬퍼에 소유자를 넘긴다");
  assert.equal(h.calls[0].path, "/api/amora/personalization");
  assert.equal(h.calls[0].init.method, "GET");
  assert.equal(h.calls[0].init.headers["X-Amora-Expected-Owner"], owner);
  assert.equal(h.calls[0].init.body, undefined);

  const view = h.view();
  assert.equal(view.showChoices, true);
  assert.deepEqual({ ...view.selected }, { ...DEFAULT_AMORA_PERSONALIZATION });
  assert.equal(view.dirty, false);
  assert.equal(view.canSave, false);
  assert.equal(view.showReset, false);
  assert.equal(view.savedLine, "아직 저장한 도움 방식이 없어요");
  const picked = Object.fromEntries(buildAmoraStyleSections(view.selected).map((section) => [
    section.title,
    section.choices.filter((choice) => choice.selected).map((choice) => choice.label),
  ]));
  assert.deepEqual(picked, {
    "아모라 말투": ["상황에 맞게"],
    "결정을 시작할 때": ["그때 물어보기"],
    "설명 분량": ["상황에 맞게"],
    "힘들다고 말했을 때": ["그때 물어보기"],
    "둘이 준비하는 방식": ["그때 물어보기"],
    "가족·하객 의견이 있을 때": ["그때 물어보기"],
  });
});

test("고르기는 화면 안 초안만 바꾸고 요청을 보내지 않는다 — 변경 저장은 달라졌을 때만 켜진다", async () => {
  const h = await loaded(profile({ decisionStart: "compare_first" }));
  assert.equal(h.session.select("toneStyle", "warm"), true);
  assert.equal(h.calls.length, 1, "선택만으로는 네트워크 요청이 없다");
  assert.equal(h.view().selected.toneStyle, "warm");
  assert.equal(h.view().dirty, true);
  assert.equal(h.view().canSave, true);
  assert.equal(h.session.select("toneStyle", "adaptive"), true);
  assert.equal(h.view().dirty, false, "저장값으로 되돌리면 다시 꺼진다");
  assert.equal(h.view().canSave, false);
  for (const [key, value] of [["toneStyle", "banmal"], ["toneStyle", undefined], ["secretScore", "1"], ["workMode", "compare_first"]]) {
    assert.equal(h.session.select(key, value), false, `${key}=${value}`);
  }
  assert.equal(h.view().dirty, false);
  assert.equal(h.calls.length, 1);
});

test("저장은 6필드 전부를 정확한 본문으로 한 번만 보내고, 서버가 같은 값을 돌려줄 때만 저장했다고 말한다", async () => {
  const put = deferred();
  const h = await loaded(profile({ decisionStart: "compare_first" }, 3), [() => put.promise]);
  h.session.select("toneStyle", "warm");
  h.session.select("supportOrder", "listen_first");
  const draft = { ...h.view().selected };

  const first = h.session.save();
  assert.equal(await h.session.save(), false, "진행 중에는 두 번째 저장을 보내지 않는다");
  assert.equal(await h.session.reset(), false, "진행 중에는 삭제도 보내지 않는다");
  assert.equal(await h.session.load(), false, "진행 중에는 다시 불러오지 않는다");
  assert.equal(h.session.select("toneStyle", "calm_clear"), false, "진행 중에는 고르지 못한다");
  assert.equal(h.view().saveLabel, "저장 중...");
  assert.equal(h.view().canSave, false);
  await settle();
  assert.equal(h.calls.length, 2);

  const call = h.calls[1];
  assert.equal(call.expectedOwner, owner);
  assert.equal(call.path, AMORA_PERSONALIZATION_PATH);
  assert.equal(call.init.method, "PUT");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(call.body), ["expectedOwnerUserId", "expectedRevision", "preferences"]);
  assert.equal(call.body.expectedOwnerUserId, owner);
  assert.equal(call.body.expectedRevision, 3);
  assert.deepEqual(Object.keys(call.body.preferences), [...AMORA_PERSONALIZATION_FIELD_NAMES], "5필드 옛 경로를 타지 않는다");
  assert.deepEqual(call.body.preferences, draft);

  assert.equal(h.session.getState().notice, null, "응답 전에는 저장했다고 말하지 않는다");
  put.resolve(response(200, { profile: profile(draft, 4, "2026-09-18T03:00:00.000Z") }));
  assert.equal(await first, true);
  assert.equal(h.session.getState().notice, "내 도움 방식으로 저장했어요.");
  assert.equal(h.view().savedLine, `내 설정 · ${koreanDate("2026-09-18T03:00:00.000Z")}`);
  assert.equal(h.view().dirty, false);
  assert.equal(h.view().canSave, false, "저장에 성공하면 다시 꺼진다");
  assert.equal(h.view().saveLabel, "변경 저장");
  assert.equal(h.calls.length, 2);
});

test("처음 저장할 때 expectedRevision 은 null 이다", async () => {
  const h = await loaded(null, [response(200, { profile: profile({ answerDetail: "brief" }, 1) })]);
  h.session.select("answerDetail", "brief");
  assert.equal(await h.session.save(), true);
  assert.equal(h.calls[1].body.expectedRevision, null);
  assert.equal(h.view().showReset, true);
});

test("서버가 돌려준 값이 초안과 다르거나 형식이 틀리면 저장했다고 말하지 않는다", async () => {
  for (const body of [
    { profile: profile({ toneStyle: "calm_clear" }, 4) },
    { profile: { ...profile({ toneStyle: "warm" }, 4), revision: 0 } },
    { profile: null },
    {},
  ]) {
    const h = await loaded(profile({}, 3), [response(200, body)]);
    h.session.select("toneStyle", "warm");
    assert.equal(await h.session.save(), false, JSON.stringify(body));
    const state = h.session.getState();
    assert.equal(state.notice, null);
    assert.equal(state.status, "error");
    assert.equal(state.error, "저장 결과를 안전하게 확인하지 못했어요.");
    assert.equal(h.view().showChoices, false, "모르는 저장 상태 위에 고를 수 있는 값을 보이지 않는다");
  }
});

test("409 수정 충돌은 서버가 준 현재 값을 저장 상태로 받고 초안을 버린다 — 다시 보내지 않는다", async () => {
  const latest = profile({ workMode: "hybrid", toneStyle: "calm_clear" }, 5, "2026-09-17T03:00:00.000Z");
  const h = await loaded(profile({}, 3), [response(409, { code: "PERSONALIZATION_REVISION_CONFLICT", error: conflictCopy, current: latest })]);
  h.session.select("toneStyle", "warm");
  assert.equal(await h.session.save(), false);
  await settle();
  assert.equal(h.calls.length, 2, "자동으로 다시 시도하지 않는다");
  const state = h.session.getState();
  assert.equal(state.status, "ready");
  assert.equal(state.error, conflictCopy);
  assert.equal(state.notice, null);
  assert.deepEqual({ ...h.view().selected }, latest.preferences, "초안은 버리고 서버의 현재 값을 보여 준다");
  assert.equal(h.view().dirty, false);
  assert.equal(h.view().savedLine, `내 설정 · ${koreanDate("2026-09-17T03:00:00.000Z")}`);
});

test("409 수정 충돌에서 current 가 null 이면 저장 없는 기본 상태로 둔다", async () => {
  const h = await loaded(profile({ familyOrder: "couple_first" }, 3), [response(409, { code: "PERSONALIZATION_REVISION_CONFLICT", error: conflictCopy, current: null })]);
  h.session.select("toneStyle", "warm");
  assert.equal(await h.session.save(), false);
  assert.equal(h.session.getState().status, "ready");
  assert.equal(h.session.getState().profile, null);
  assert.deepEqual({ ...h.view().selected }, { ...DEFAULT_AMORA_PERSONALIZATION });
  assert.equal(h.view().showReset, false);
  assert.equal(h.view().savedLine, "아직 저장한 도움 방식이 없어요");
  assert.equal(h.session.getState().error, conflictCopy);
});

test("409 수정 충돌의 current 를 읽을 수 없으면 오류와 다시 불러오기로 보낸다", async () => {
  for (const current of [{ ...profile(), preferences: { toneStyle: "banmal" } }, "latest", undefined]) {
    const body = { code: "PERSONALIZATION_REVISION_CONFLICT", error: conflictCopy };
    if (current !== undefined) body.current = current;
    const h = await loaded(profile({}, 3), [response(409, body)]);
    h.session.select("toneStyle", "warm");
    assert.equal(await h.session.save(), false);
    assert.equal(h.session.getState().status, "error", JSON.stringify(current));
    assert.equal(h.session.getState().error, conflictCopy);
    assert.equal(h.view().showChoices, false);
    assert.equal(h.calls.length, 2);
  }
});

test("409 계정 불일치는 오류 상태로, 409 프로필 필요는 서버 문구만 보여 준다", async () => {
  const mismatch = "로그인 계정이 바뀌었어요. 새로고침한 뒤 현재 계정을 확인해 주세요.";
  const a = await loaded(profile({}, 3), [response(409, { code: "PERSONALIZATION_OWNER_MISMATCH", error: mismatch })]);
  a.session.select("toneStyle", "warm");
  assert.equal(await a.session.save(), false);
  assert.equal(a.session.getState().status, "error");
  assert.equal(a.session.getState().profile, null);
  assert.equal(a.session.getState().error, mismatch);
  assert.equal(a.view().showChoices, false);

  const required = "프로필을 먼저 완료해 주세요.";
  const b = await loaded(null, [response(409, { code: "PERSONALIZATION_PROFILE_REQUIRED", error: required })]);
  b.session.select("toneStyle", "warm");
  assert.equal(await b.session.save(), false);
  assert.equal(b.session.getState().status, "ready");
  assert.equal(b.session.getState().error, required);
  assert.equal(b.session.getState().notice, null);
  await settle();
  assert.equal(b.calls.length, 2, "자동으로 다시 시도하지 않는다");
});

test("삭제는 확인한 뒤 정확한 본문으로 보내고, {deleted:true, profile:null} 일 때만 지웠다고 말한다", async () => {
  const none = await loaded(null);
  assert.equal(await none.session.reset(), false, "저장한 값이 없으면 지울 것도 없다");
  assert.equal(none.calls.length, 1);

  const h = await loaded(profile({ toneStyle: "warm" }, 2), [response(200, { deleted: true, profile: null })]);
  assert.equal(h.view().showReset, true);
  h.session.select("workMode", "together");
  assert.equal(await h.session.reset(), true);
  const call = h.calls[1];
  assert.equal(call.init.method, "DELETE");
  assert.equal(call.path, AMORA_PERSONALIZATION_PATH);
  assert.deepEqual(Object.keys(call.body), ["expectedRevision", "expectedOwnerUserId"]);
  assert.deepEqual(call.body, { expectedRevision: 2, expectedOwnerUserId: owner });
  assert.equal(h.session.getState().notice, "저장한 도움 방식을 모두 지웠어요.");
  assert.deepEqual({ ...h.view().selected }, { ...DEFAULT_AMORA_PERSONALIZATION });
  assert.equal(h.view().showReset, false);

  for (const body of [{ deleted: true }, { deleted: "true", profile: null }, { deleted: true, profile: profile() }, {}, null]) {
    const bad = await loaded(profile({}, 2), [response(200, body)]);
    assert.equal(await bad.session.reset(), false, JSON.stringify(body));
    assert.equal(bad.session.getState().notice, null);
    assert.equal(bad.session.getState().error, "초기화 결과를 확인하지 못했어요.");
    assert.equal(bad.session.getState().status, "error");
  }

  const conflict = await loaded(profile({}, 2), [response(409, { code: "PERSONALIZATION_REVISION_CONFLICT", error: conflictCopy, current: profile({ toneStyle: "warm" }, 3) })]);
  assert.equal(await conflict.session.reset(), false);
  assert.equal(conflict.session.getState().profile.revision, 3);
  assert.equal(conflict.session.getState().error, conflictCopy);
});

test("불러오기 실패·형식 오류는 오류와 다시 불러오기만 남기고 고를 수 있는 기본값을 보이지 않는다", async () => {
  for (const [reply, message] of [
    [new Error("Network request failed"), "도움 방식을 불러오지 못했어요."],
    [new Error("API_SESSION_OWNER_MISMATCH"), "도움 방식을 불러오지 못했어요."],
    [response(503, { error: "Service Unavailable" }), "도움 방식을 불러오지 못했어요."],
    [response(500, { error: "서버 오류" }), "도움 방식을 불러오지 못했어요."],
    [response(200, { profile: { ...profile(), revision: "3" } }), "저장된 도움 방식을 안전하게 읽지 못했어요."],
    [response(200, {}), "저장된 도움 방식을 안전하게 읽지 못했어요."],
    [() => new globalThis.Response("not json", { status: 200 }), "저장된 도움 방식을 안전하게 읽지 못했어요."],
  ]) {
    const h = harness([reply]);
    assert.equal(await h.session.load(), false);
    const state = h.session.getState();
    assert.equal(state.status, "error");
    assert.equal(state.error, message);
    assert.equal(h.view().showChoices, false);
    assert.equal(h.session.select("toneStyle", "warm"), false);
    assert.equal(await h.session.save(), false);
    assert.equal(h.calls.length, 1);
  }
});

test("계정이 바뀐 뒤 도착한 응답은 버린다 — 새 계정 화면에 이전 계정 값이 뜨지 않는다", async () => {
  const get = deferred();
  const h = harness([() => get.promise]);
  const loading = h.session.load();
  await settle();
  assert.equal(h.session.setOwner(other), true);
  get.resolve(response(200, { profile: profile({ toneStyle: "warm" }) }));
  assert.equal(await loading, false);
  assert.equal(h.session.getState().ownerId, other);
  assert.equal(h.session.getState().profile, null);
  assert.equal(h.session.getState().status, "idle");

  const put = deferred();
  const s = await loaded(profile({}, 3), [() => put.promise]);
  s.session.select("toneStyle", "warm");
  const saving = s.session.save();
  await settle();
  s.session.setOwner(other);
  put.resolve(response(200, { profile: profile({ toneStyle: "warm" }, 4) }));
  assert.equal(await saving, false);
  assert.equal(s.session.getState().notice, null);
  assert.equal(s.session.getState().profile, null);
  assert.equal(s.session.getState().pending, null);

  // 이벤트가 오기 전이라도 세션의 실제 소유자가 바뀌었으면 반영하지 않는다.
  const live = harness([response(200, { profile: profile({ toneStyle: "warm" }) })]);
  live.setLive(other);
  assert.equal(await live.session.load(), false);
  assert.equal(live.session.getState().profile, null);
  assert.equal(live.session.getState().status, "error");

  // 토큰 갱신처럼 같은 소유자로 다시 알려도 고르던 초안을 지우지 않는다.
  const same = await loaded(profile({}, 3));
  same.session.select("toneStyle", "warm");
  assert.equal(same.session.setOwner(owner), false);
  assert.equal(same.view().selected.toneStyle, "warm");

  // 화면을 떠난 뒤 온 응답도 버리고, 다시 붙으면 같은 계정이라도 처음부터 불러온다.
  const leaving = deferred();
  const d = harness([() => leaving.promise]);
  const pendingLoad = d.session.load();
  await settle();
  d.session.dispose();
  leaving.resolve(response(200, { profile: profile({ toneStyle: "warm" }) }));
  assert.equal(await pendingLoad, false);
  assert.equal(d.session.getState().profile, null);
  assert.equal(d.session.setOwner(owner), true);

  const nobody = harness([]);
  nobody.session.setOwner(null);
  assert.equal(await nobody.session.load(), false);
  assert.equal(nobody.calls.length, 0, "소유자가 없으면 요청을 보내지 않는다");
  assert.equal(nobody.session.getState().status, "error");
});

test("화면의 칸·선택지 문구는 웹이 import 하는 공유 상수에서만 온다", () => {
  const built = buildAmoraStyleSections(DEFAULT_AMORA_PERSONALIZATION);
  assert.deepEqual(
    built.map((section) => [section.key, section.title, section.description, section.choices.map((choice) => [choice.value, choice.label, choice.description])]),
    AMORA_PERSONALIZATION_SECTIONS.map((section) => [section.key, section.title, section.description, section.choices.map((choice) => [choice.value, choice.label, choice.description])]),
  );
  assert.match(sessionSource, /from ["']@hanbang\/shared\/amora-personalization["']/u);
  assert.match(webPage, /import \{ AMORA_PERSONALIZATION_SECTIONS \} from "@hanbang\/shared\/amora-personalization";/u, "웹 페이지도 같은 상수를 그린다");

  // 화면 파일의 문자열·JSX 글자에 한글이 한 글자라도 있으면 박은 문구다. 주석은 보지 않는다.
  const file = ts.createSourceFile("amora-style.tsx", screen, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hardcoded = [];
  const visit = (node) => {
    if ((ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /[가-힣]/u.test(node.text)) hardcoded.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(hardcoded, [], "화면 문구는 공유 상수나 AMORA_STYLE_COPY 에서 가져온다");
  for (const expression of ["section.title", "section.description", "choice.label", "choice.description"]) {
    assert.ok(screen.includes(`{${expression}}`), `${expression} 를 그린다`);
  }
  assert.match(screen, /buildAmoraStyleSections\(/u);
});

test("화면 고정 문구는 웹 설정 화면·웹 훅이 쓰는 문장 그대로다", () => {
  const web = squash(`${webPage}\n${webHook}`);
  for (const [key, text] of Object.entries(AMORA_STYLE_COPY)) {
    assert.ok(web.includes(text), `${key}: 웹에 없는 문구 ${JSON.stringify(text)}`);
  }
  assert.match(webPage, /`내 설정 · \$\{updatedAt \?\? "직접 확인됨"\}`/u);
  assert.equal(AMORA_STYLE_COPY.savedProfilePrefix, "내 설정 · ");
  assert.equal(AMORA_STYLE_COPY.savedDateFallback, "직접 확인됨");
  assert.ok(Object.isFrozen(AMORA_STYLE_COPY));
  for (const forbidden of [/플래너/u, /파트너/u, /베타/u, /미리 체험하기/u]) {
    assert.doesNotMatch(Object.values(AMORA_STYLE_COPY).join("\n"), forbidden);
  }
});

test("날짜는 웹의 ko-KR 표기와 같게 쓰고, 읽을 수 없으면 비운다", () => {
  for (const iso of ["2026-09-18T03:00:00.000Z", "2026-01-01T12:00:00.000Z", "2027-12-31T10:30:00+09:00"]) {
    assert.equal(formatAmoraPersonalizationDate(iso), koreanDate(iso), iso);
  }
  for (const value of ["", "not-a-date", null, undefined]) assert.equal(formatAmoraPersonalizationDate(value), null);
  const h = harness([]);
  assert.equal(viewAmoraPersonalization({ ...h.session.getState(), status: "ready", profile: profile({}, 1, "bad") }).savedLine, "내 설정 · 직접 확인됨");
});

test("화면은 소유자만 보는 헬퍼로 요청하고, 계정이 바뀌면 상태를 비운다", () => {
  assert.match(screen, /createAmoraPersonalizationSession\(\s*apiFetchForExpectedUser/u, "세션 소유자가 다르면 요청 자체를 보내지 않는 헬퍼");
  assert.doesNotMatch(screen, /apiJsonForExpectedUser|ownerCoupleSessionFence|couple_id|coupleId/u, "409 본문을 버리는 헬퍼나 커플 조건을 쓰지 않는다");
  assert.match(screen, /supabase\.auth\.onAuthStateChange\(/u);
  assert.match(screen, /session\.setOwner\(/u);
  assert.match(screen, /readSessionOwner:/u);
  assert.doesNotMatch(`${screen}\n${sessionSource}`, /console\./u, "고른 값이 로그로 새지 않는다");
  assert.doesNotMatch(screen, /router\.(?:push|replace|navigate|setParams)\(/u, "고른 값이 주소·라우터 파라미터로 새지 않는다");
  assert.doesNotMatch(`${screen}\n${sessionSource}`, /track|analytics|logEvent/iu, "분석 이벤트를 더하지 않는다");
});

test("화면은 라디오 역할·44pt 이상 누르는 영역·두 단계 삭제 확인을 갖는다", () => {
  assert.match(screen, /accessibilityRole="radiogroup"/u);
  assert.match(screen, /accessibilityRole="radio"/u);
  assert.match(screen, /accessibilityState=\{\{\s*checked: choice\.selected/u);
  const minHeights = [...screen.matchAll(/minHeight:\s*(\d+)/gu)].map((match) => Number(match[1]));
  assert.ok(minHeights.length >= 2 && minHeights.every((height) => height >= 44), `minHeight ${minHeights}`);
  assert.match(screen, /choice:\s*\{[^}]*minHeight:\s*(\d+)/u);

  const alert = screen.match(/Alert\.alert\(([\s\S]*?)\);/u)?.[1] ?? "";
  assert.match(alert, /AMORA_STYLE_COPY\.resetTrigger/u);
  assert.match(alert, /AMORA_STYLE_COPY\.resetConfirmBody/u);
  assert.match(alert, /text: AMORA_STYLE_COPY\.resetCancel, style: "cancel"/u);
  assert.match(alert, /text: AMORA_STYLE_COPY\.resetConfirm, style: "destructive", onPress/u);
  assert.equal((screen.match(/session\.reset\(/gu) ?? []).length, 1, "삭제는 확인 창의 버튼에서만 보낸다");
  assert.ok(alert.includes("session.reset("), "삭제 요청은 확인 창 안에 있다");
  assert.match(screen, /view\.showReset \?/u, "저장된 값이 있을 때만 지우기를 보인다");
  assert.match(screen, /LoadingState label=\{AMORA_STYLE_COPY\.loading\}/u);
  assert.match(screen, /AMORA_STYLE_COPY\.retry/u);
});

/**
 * 화면 파일을 그대로 컴파일해 한 번 그린다. 훅은 세션을 붙잡아 두는 최소한의 가짜다.
 * 효과(useEffect)는 모아만 두고 `mount()` 를 부를 때만 한 번 돌린다 — 인증 구독·첫 불러오기를
 * 보는 테스트만 그 경로를 탄다. `emitAuth()` 는 supabase 가 보내는 계정 알림을 흉내 낸다.
 */
async function renderScreen(replies) {
  const path = fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: "amora-style.tsx",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  const sessionModule = await import("../lib/amoraPersonalizationSession.mjs");
  const holder = {
    session: null,
    calls: [],
    alerts: [],
    effects: [],
    cleanups: [],
    authListeners: [],
    unsubscribed: 0,
    // 지금 로그인된 계정. getSession 은 이 값을 읽는다(ownerReads 에 쌓인 늦은 읽기가 먼저다).
    liveOwner: owner,
    ownerReads: [],
  };
  const tokens = new Proxy(() => tokens, { get: () => tokens });
  const request = async (expectedOwner, requestPath, init) => {
    holder.calls.push({ expectedOwner, path: requestPath, init });
    const next = replies.shift();
    return typeof next === "function" ? next() : next;
  };
  const deps = {
    react: {
      useState: (init) => {
        if (!holder.session) holder.session = typeof init === "function" ? init() : init;
        return [holder.session, () => {}];
      },
      useSyncExternalStore: (_subscribe, getState) => getState(),
      useEffect: (effect) => { holder.effects.push(effect); },
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props: props ?? {} }), jsxs: (type, props) => ({ type, props: props ?? {} }), Fragment: "Fragment" },
    "react-native": { Alert: { alert: (...args) => holder.alerts.push(args) }, Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (value) => value }, View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { router: { back: () => {} } },
    "lucide-react-native": { Check: "Check", RotateCcw: "RotateCcw", ShieldCheck: "ShieldCheck", SlidersHorizontal: "SlidersHorizontal" },
    "@hanbang/design-tokens": { colors: tokens, radius: tokens, spacing: tokens },
    "@/lib/api": { apiFetchForExpectedUser: request },
    "@/lib/supabase": { supabase: { auth: {
      getSession: async () => {
        const pending = holder.ownerReads.shift();
        const id = pending ? await pending : holder.liveOwner;
        return { data: { session: id ? { user: { id } } : null } };
      },
      onAuthStateChange: (listener) => {
        holder.authListeners.push(listener);
        return { data: { subscription: { unsubscribe() { holder.unsubscribed += 1; } } } };
      },
    } } },
    "@/components/ui/AppUI": { AppHeader: "AppHeader", AppText: "AppText", LoadingState: "LoadingState", PrimaryButton: "PrimaryButton", Surface: "Surface" },
    "@/lib/amoraPersonalizationSession.mjs": sessionModule,
  };
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  const Screen = module.exports.default;
  const nodes = (tree) => {
    const out = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      out.push(node);
      walk(node.props.children);
    };
    walk(tree);
    return out;
  };
  const texts = (tree) => {
    const out = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === "string") return out.push(node);
      if (node && typeof node === "object") walk(node.props.children);
    };
    walk(tree);
    return out;
  };
  // 처음 그릴 때 등록된 효과만 한 번 돌린다(의존성이 [session] 이라 React 도 한 번이다).
  const mount = () => {
    const tree = Screen();
    holder.cleanups = holder.effects.splice(0).map((effect) => effect());
    return tree;
  };
  const unmount = () => holder.cleanups.splice(0).forEach((cleanup) => cleanup?.());
  const emitAuth = (event, id) => {
    holder.liveOwner = id;
    holder.authListeners.forEach((listener) => listener(event, id ? { user: { id } } : null));
  };
  return { holder, render: () => Screen(), mount, unmount, emitAuth, nodes, texts };
}

test("그려진 화면: 6칸·4/3/3/3/4/4 라디오, 글자는 전부 공유 상수·웹 문장에서 온다", async () => {
  const r = await renderScreen([response(200, { profile: null })]);
  const loading = r.render();
  assert.ok(r.nodes(loading).some((node) => node.type === "LoadingState" && node.props.label === "도움 방식을 불러오는 중..."));
  assert.equal(r.nodes(loading).filter((node) => node.props.accessibilityRole === "radio").length, 0);

  r.holder.session.setOwner(owner);
  assert.equal(await r.holder.session.load(), true);
  const ready = r.render();
  const groups = r.nodes(ready).filter((node) => node.props.accessibilityRole === "radiogroup");
  assert.deepEqual(groups.map((group) => group.props.accessibilityLabel), AMORA_PERSONALIZATION_SECTIONS.map((section) => section.title));
  assert.deepEqual(groups.map((group) => r.nodes(group.props.children).filter((node) => node.props.accessibilityRole === "radio").length), [4, 3, 3, 3, 4, 4]);
  const checked = groups.map((group) => r.nodes(group.props.children)
    .filter((node) => node.props.accessibilityRole === "radio" && node.props.accessibilityState.checked)
    .map((node) => r.texts(node)[0]));
  assert.deepEqual(checked, [["상황에 맞게"], ["그때 물어보기"], ["상황에 맞게"], ["그때 물어보기"], ["그때 물어보기"], ["그때 물어보기"]]);

  const allowed = new Set([
    ...AMORA_PERSONALIZATION_SECTIONS.flatMap((section) => [section.title, section.description, ...section.choices.flatMap((choice) => [choice.label, choice.description])]),
    ...Object.values(AMORA_STYLE_COPY),
  ]);
  const rendered = r.texts(ready);
  assert.ok(rendered.length > 40, `그린 글자가 ${rendered.length}개뿐이다`);
  assert.deepEqual(rendered.filter((text) => !allowed.has(text)), [], "공유 상수·웹 문장 밖의 글자를 그렸다");
  assert.ok(rendered.includes("아직 저장한 도움 방식이 없어요"));
  assert.ok(rendered.includes("현재 질문이 저장값과 다르면 방금 한 말이 우선해요."));
  assert.ok(!rendered.includes(AMORA_STYLE_COPY.resetTrigger), "저장값이 없으면 지우기 버튼이 없다");
  const saveButton = () => r.nodes(r.render()).find((node) => node.type === "PrimaryButton" && r.texts(node)[0] === "변경 저장");
  assert.equal(saveButton().props.disabled, true);

  const warm = r.nodes(ready).find((node) => node.props.accessibilityRole === "radio" && r.texts(node).includes("다정하고 편안하게"));
  warm.props.onPress();
  assert.equal(r.holder.calls.length, 1, "선택지를 눌러도 요청이 없다");
  assert.equal(saveButton().props.disabled, false);
});

test("그려진 화면: 불러오기 실패면 오류와 다시 불러오기만, 지우기는 확인 창을 거친다", async () => {
  const failed = await renderScreen([response(503, { error: "Service Unavailable" })]);
  failed.render();
  failed.holder.session.setOwner(owner);
  await failed.holder.session.load();
  const errorTree = failed.render();
  assert.equal(failed.nodes(errorTree).filter((node) => node.props.accessibilityRole === "radio").length, 0);
  assert.ok(failed.texts(errorTree).includes("도움 방식을 불러오지 못했어요."));
  assert.ok(failed.nodes(errorTree).some((node) => node.type === "PrimaryButton" && failed.texts(node)[0] === "다시 불러오기"));
  assert.ok(!failed.nodes(errorTree).some((node) => node.type === "PrimaryButton" && failed.texts(node)[0] === "변경 저장"));

  const saved = await renderScreen([response(200, { profile: profile({ toneStyle: "warm" }, 2) }), response(200, { deleted: true, profile: null })]);
  saved.render();
  saved.holder.session.setOwner(owner);
  await saved.holder.session.load();
  const tree = saved.render();
  const trigger = saved.nodes(tree).find((node) => node.type === "Pressable" && saved.texts(node).includes("저장한 도움 방식 모두 지우기"));
  assert.ok(trigger, "저장값이 있으면 지우기가 보인다");
  trigger.props.onPress();
  assert.equal(saved.holder.calls.length, 1, "누르기만으로는 지우지 않는다");
  assert.equal(saved.holder.alerts.length, 1);
  const [title, body, buttons] = saved.holder.alerts[0];
  assert.equal(title, "저장한 도움 방식 모두 지우기");
  assert.equal(body, "저장한 값만 삭제하고 대화·예산·일정은 그대로 유지해요.");
  assert.deepEqual(buttons.map((button) => [button.text, button.style]), [["취소", "cancel"], ["모두 지우기", "destructive"]]);
  assert.equal(buttons[0].onPress, undefined, "취소는 아무 요청도 하지 않는다");
  buttons[1].onPress();
  await settle();
  await settle();
  assert.equal(saved.holder.calls.length, 2);
  assert.equal(saved.holder.calls[1].init.method, "DELETE");
  assert.ok(saved.texts(saved.render()).includes("저장한 도움 방식을 모두 지웠어요."));
});

// ── 계정 전환: 화면의 useEffect 를 실제로 돌려 인증 알림 → 비우기 → 미뤄 둔 불러오기를 본다 ──
// 화면은 알림을 받은 즉시 이전 계정 값을 비우고, 불러오기는 인증 콜백이 끝난 다음 차례(setTimeout 0)에
// 보낸다 — 콜백 안에서 세션을 다시 읽으면 인증 잠금을 기다리며 멈출 수 있다.
/** 인증 콜백이 미뤄 둔 불러오기(setTimeout 0)가 돌 차례를 한 번 준다. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** 응답 본문 읽기·세션 소유자 재확인까지 끝날 만큼 차례를 넘긴다. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await settle();
};
const sectionOf = (key) => AMORA_PERSONALIZATION_SECTIONS.find((section) => section.key === key);
const choiceLabel = (key, value) => sectionOf(key).choices.find((choice) => choice.value === value).label;
const radiosIn = (r, tree) => r.nodes(tree).filter((node) => node.props.accessibilityRole === "radio");
const radiosOf = (r, tree, key) => {
  const group = r.nodes(tree).find((node) => node.props.accessibilityRole === "radiogroup" && node.props.accessibilityLabel === sectionOf(key).title);
  return group ? radiosIn(r, group.props.children) : [];
};
const checkedLabels = (r, tree, key) => radiosOf(r, tree, key)
  .filter((node) => node.props.accessibilityState.checked)
  .map((node) => r.texts(node)[0]);
const pressChoice = (r, key, value) => {
  const radio = radiosOf(r, r.render(), key).find((node) => r.texts(node)[0] === choiceLabel(key, value));
  assert.ok(radio, `${key}=${value} 선택지를 찾지 못했다`);
  radio.props.onPress();
};

test("그려진 화면: 계정이 바뀌면 이전 계정 값을 바로 비우고, 인증 콜백 밖에서 새 계정으로 다시 불러온다", async () => {
  const r = await renderScreen([
    response(200, { profile: profile({ toneStyle: "warm" }, 2, "2026-09-18T03:00:00.000Z") }),
    response(200, { profile: profile({ toneStyle: "calm_clear" }, 7, "2026-09-10T03:00:00.000Z") }),
  ]);
  assert.equal(radiosIn(r, r.mount()).length, 0, "불러오기 전에는 고를 수 있는 값이 없다");
  assert.equal(r.holder.authListeners.length, 1, "계정 알림을 구독한다");
  await flush();
  assert.equal(r.holder.calls.length, 1);
  assert.equal(r.holder.calls[0].expectedOwner, owner);
  assert.deepEqual(checkedLabels(r, r.render(), "toneStyle"), [choiceLabel("toneStyle", "warm")]);

  // 같은 계정으로 다시 알려도(토큰 갱신) 다시 불러오지 않고, 고르던 초안도 지우지 않는다.
  pressChoice(r, "familyOrder", "couple_first");
  r.emitAuth("TOKEN_REFRESHED", owner);
  await tick();
  await flush();
  assert.equal(r.holder.calls.length, 1, "같은 계정 알림은 다시 불러오지 않는다");
  assert.equal(r.holder.session.getState().draft?.familyOrder, "couple_first", "고르던 초안을 지우지 않는다");
  assert.deepEqual(checkedLabels(r, r.render(), "familyOrder"), [choiceLabel("familyOrder", "couple_first")]);

  // 다른 계정 알림: 그 자리에서 이전 계정의 값·초안을 비운다.
  r.emitAuth("SIGNED_IN", other);
  const cleared = r.holder.session.getState();
  assert.equal(cleared.ownerId, other);
  assert.equal(cleared.profile, null, "이전 계정의 저장값이 남지 않는다");
  assert.equal(cleared.draft, null, "이전 계정에서 고르던 초안이 남지 않는다");
  const clearedTree = r.render();
  assert.equal(radiosIn(r, clearedTree).length, 0, "이전 계정의 선택지가 한 칸도 남지 않는다");
  assert.ok(!r.texts(clearedTree).some((text) => text.startsWith(AMORA_STYLE_COPY.savedProfilePrefix)), "이전 계정의 저장 날짜가 남지 않는다");
  assert.ok(r.nodes(clearedTree).some((node) => node.type === "LoadingState"));

  // 불러오기는 인증 콜백 안에서 바로 보내지 않고, 다음 차례에 새 계정으로 보낸다.
  assert.equal(r.holder.calls.length, 1, "인증 콜백 안에서는 요청을 보내지 않는다");
  await tick();
  assert.equal(r.holder.calls.length, 2, "콜백이 끝난 다음 차례에 새 계정으로 불러온다");
  assert.equal(r.holder.calls[1].expectedOwner, other);
  assert.equal(r.holder.calls[1].init.method, "GET");
  assert.equal(r.holder.calls[1].init.headers["X-Amora-Expected-Owner"], other);
  await flush();
  const next = r.render();
  assert.deepEqual(checkedLabels(r, next, "toneStyle"), [choiceLabel("toneStyle", "calm_clear")]);
  assert.deepEqual(checkedLabels(r, next, "familyOrder"), [choiceLabel("familyOrder", DEFAULT_AMORA_PERSONALIZATION.familyOrder)]);
  assert.ok(r.texts(next).includes(`${AMORA_STYLE_COPY.savedProfilePrefix}${koreanDate("2026-09-10T03:00:00.000Z")}`));
  r.unmount();
});

test("그려진 화면: 계정을 바꾸기 전에 보낸 이전 계정의 늦은 응답은 새 계정 화면에 뜨지 않는다", async () => {
  const lateA = deferred();
  const getB = deferred();
  const r = await renderScreen([() => lateA.promise, () => getB.promise]);
  r.mount();
  await flush();
  assert.equal(r.holder.calls.length, 1);
  assert.equal(r.holder.calls[0].expectedOwner, owner);

  r.emitAuth("SIGNED_IN", other);
  await tick();
  assert.equal(r.holder.calls.length, 2);
  assert.equal(r.holder.calls[1].expectedOwner, other);

  lateA.resolve(response(200, { profile: profile({ toneStyle: "warm" }, 2) }));
  await flush();
  const waiting = r.holder.session.getState();
  assert.equal(waiting.ownerId, other);
  assert.equal(waiting.status, "loading", "새 계정 응답을 기다리는 상태 그대로다");
  assert.equal(waiting.profile, null, "이전 계정 응답을 새 계정 상태에 올리지 않는다");
  assert.equal(waiting.error, null);
  assert.equal(radiosIn(r, r.render()).length, 0);

  getB.resolve(response(200, { profile: null }));
  await flush();
  const tree = r.render();
  assert.equal(radiosIn(r, tree).length, 21);
  assert.deepEqual(checkedLabels(r, tree, "toneStyle"), [choiceLabel("toneStyle", DEFAULT_AMORA_PERSONALIZATION.toneStyle)], "이전 계정의 '다정하고 편안하게'가 아니다");
  assert.ok(r.texts(tree).includes(AMORA_STYLE_COPY.noSavedProfile));
  assert.equal(r.holder.calls.length, 2);
  r.unmount();
});

test("그려진 화면: 첫 소유자 읽기가 계정 알림보다 늦게 끝나도 그 옛 계정으로 되돌리지 않는다", async () => {
  const firstRead = deferred();
  const r = await renderScreen([response(200, { profile: profile({ toneStyle: "calm_clear" }, 7) })]);
  r.holder.ownerReads.push(firstRead.promise);
  r.mount();
  r.emitAuth("SIGNED_IN", other);
  await tick();
  await flush();
  assert.equal(r.holder.calls.length, 1);
  assert.equal(r.holder.calls[0].expectedOwner, other);
  assert.equal(r.holder.session.getState().status, "ready");

  firstRead.resolve(owner);
  await tick();
  await flush();
  assert.equal(r.holder.session.getState().ownerId, other, "알림 전에 읽기 시작한 옛 소유자는 버린다");
  assert.equal(r.holder.calls.length, 1, "옛 계정으로 다시 불러오지 않는다");
  assert.deepEqual(checkedLabels(r, r.render(), "toneStyle"), [choiceLabel("toneStyle", "calm_clear")]);
  r.unmount();
});

test("그려진 화면: 로그아웃하면 값을 비우고 요청하지 않으며, 떠난 뒤에는 구독을 풀고 아무것도 바꾸지 않는다", async () => {
  const r = await renderScreen([response(200, { profile: profile({ toneStyle: "warm" }, 2) })]);
  r.mount();
  await flush();
  assert.equal(r.holder.session.getState().status, "ready");
  r.emitAuth("SIGNED_OUT", null);
  assert.equal(r.holder.session.getState().profile, null);
  assert.equal(radiosIn(r, r.render()).length, 0, "로그아웃하면 선택지를 바로 내린다");
  await tick();
  await flush();
  assert.equal(r.holder.calls.length, 1, "소유자가 없으면 요청을 보내지 않는다");
  assert.equal(radiosIn(r, r.render()).length, 0);
  r.unmount();

  const pending = deferred();
  const s = await renderScreen([() => pending.promise]);
  s.mount();
  await flush();
  assert.equal(s.holder.calls.length, 1);
  s.emitAuth("SIGNED_IN", other);
  s.unmount();
  assert.equal(s.holder.unsubscribed, 1, "떠나면 계정 알림 구독을 푼다");
  assert.equal(s.holder.session.getState().ownerId, null, "떠나면 세션 상태를 비운다");
  pending.resolve(response(200, { profile: profile({ toneStyle: "warm" }) }));
  await tick();
  await flush();
  assert.equal(s.holder.calls.length, 1, "떠난 뒤에는 미뤄 둔 불러오기도 보내지 않는다");
  assert.equal(s.holder.session.getState().status, "idle", "떠난 뒤 온 응답·예약은 상태를 바꾸지 않는다");
  assert.equal(s.holder.session.getState().profile, null);
});

test("초기화 확인은 열린 계정 세대와 설정 버전에만 유효하다", async () => {
  for (const change of ["A→B", "A→B→A", "revision"]) {
    const r = await renderScreen([
      response(200, { profile: profile({ toneStyle: "warm" }, 2) }),
      response(200, { profile: profile({ toneStyle: "calm_clear" }, change === "revision" ? 3 : 2) }),
      response(200, { profile: profile({ toneStyle: "warm" }, 2) }),
      response(200, { deleted: true, profile: null }),
    ]);
    r.mount();
    await flush();
    const trigger = r.nodes(r.render()).find((node) => node.type === "Pressable" && r.texts(node).includes(AMORA_STYLE_COPY.resetTrigger));
    trigger.props.onPress();
    const staleConfirm = r.holder.alerts[0][2][1].onPress;
    if (change === "revision") {
      await r.holder.session.load();
    } else {
      r.emitAuth("SIGNED_IN", other);
      await tick();
      await flush();
      if (change === "A→B→A") {
        r.emitAuth("SIGNED_IN", owner);
        await tick();
        await flush();
      }
    }
    staleConfirm();
    await flush();
    const writes = r.holder.calls.filter((call) => call.init.method === "DELETE");
    r.unmount();
    assert.equal(writes.length, 0, `${change}: 오래된 확인창은 새 상태를 지우지 않는다`);
  }
});

test("설정 > 아모라 칸에서 '아모라가 기억하는 것' 위에 '아모라 도움 방식' 줄이 있다", () => {
  const style = settingsIndex.indexOf('title="아모라 도움 방식"');
  const memory = settingsIndex.indexOf('title="아모라가 기억하는 것"');
  assert.ok(style > 0 && memory > style, "도움 방식 줄이 기억 줄 위에 있다");
  const row = settingsIndex.slice(style, memory);
  const description = "추천·비교·공감·실행 중 내가 편한 순서를 직접 정해요";
  assert.ok(row.includes(`description="${description}"`));
  assert.ok(webSettings.includes(description), "웹 설정 줄과 같은 설명이다");
  assert.match(row, /router\.push\("\/settings\/amora-style" as const\)/u);
});
