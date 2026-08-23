import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  AMORA_ACTION_VISIBLE_LIMIT,
  buildCompleteActionBody,
  formatAmoraActionDueDate,
  parseAmoraActions,
  selectOpenAmoraActions,
} from "../lib/amoraActions.mjs";

const card = readFileSync(
  fileURLToPath(new URL("../components/lounge/AmoraActionsCard.tsx", import.meta.url)),
  "utf8",
);
const lounge = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/lounge.tsx", import.meta.url)),
  "utf8",
);
const experience = readFileSync(
  fileURLToPath(new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url)),
  "utf8",
);

const action = (over = {}) => ({
  id: "a1", title: "청첩장 문구 확정하기", status: "open", priority: "medium", dueDate: "", ...over,
});

test("서버 응답에서 그릴 수 있는 줄만 남긴다", () => {
  const parsed = parseAmoraActions({
    actions: [
      { id: "a1", title: "청첩장 문구 확정", status: "open", priority: "high", dueDate: "2026-10-01" },
      { id: "a2", title: "   ", status: "open" },
      { id: "", title: "제목은 있는데 id 가 없음", status: "open" },
      { title: "id 자체가 없음", status: "open" },
      null,
      "문자열",
    ],
  });
  // 제목이나 id 가 없으면 버린다 — 무엇을 완료하는지 모르는 줄에 완료 버튼을 주면
  // 확인하지 않은 변경이 된다.
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    id: "a1", title: "청첩장 문구 확정", status: "open", priority: "high", dueDate: "2026-10-01",
  });
});

test("응답이 이상해도 던지지 않는다", () => {
  for (const payload of [null, undefined, {}, { actions: null }, { actions: "x" }, []]) {
    assert.deepEqual(parseAmoraActions(payload), []);
  }
});

test("날짜 모양이 아닌 값은 날짜인 척하지 않는다", () => {
  const [row] = parseAmoraActions({
    actions: [{ id: "a1", title: "제목", status: "open", dueDate: "다음 주쯤" }],
  });
  assert.equal(row.dueDate, "");
  assert.equal(formatAmoraActionDueDate("다음 주쯤"), "");
  assert.equal(formatAmoraActionDueDate(undefined), "");
});

test("마감일은 사람이 읽는 말로 나온다", () => {
  assert.equal(formatAmoraActionDueDate("2026-10-01"), "2026년 10월 1일까지");
  // 한 자리 월·일에 0 을 붙이지 않는다.
  assert.equal(formatAmoraActionDueDate("2026-01-05"), "2026년 1월 5일까지");
});

test("끝난 것과 지운 것은 보여주지 않는다", () => {
  const picked = selectOpenAmoraActions([
    action({ id: "a1" }),
    action({ id: "a2", status: "done" }),
    action({ id: "a3", status: "dismissed" }),
  ]);
  assert.deepEqual(picked.visible.map((a) => a.id), ["a1"]);
  assert.equal(picked.openCount, 1);
});

test("마감일이 있는 것을 먼저, 이른 날짜부터 보여준다", () => {
  const picked = selectOpenAmoraActions([
    action({ id: "없음1" }),
    action({ id: "늦은", dueDate: "2026-12-01" }),
    action({ id: "이른", dueDate: "2026-09-01" }),
    action({ id: "없음2" }),
  ]);
  assert.deepEqual(picked.visible.map((a) => a.id), ["이른", "늦은", "없음1"]);
  // 날짜가 없는 것끼리는 서버가 준 순서를 지킨다.
  const noDates = selectOpenAmoraActions([action({ id: "b" }), action({ id: "a" })]);
  assert.deepEqual(noDates.visible.map((a) => a.id), ["b", "a"]);
});

test("넘치는 개수를 숨기지 않고 세어 준다", () => {
  const many = Array.from({ length: 7 }, (_, i) => action({ id: `a${i}` }));
  const picked = selectOpenAmoraActions(many);
  assert.equal(picked.visible.length, AMORA_ACTION_VISIBLE_LIMIT);
  assert.equal(picked.openCount, 7);
  assert.equal(picked.hiddenCount, 7 - AMORA_ACTION_VISIBLE_LIMIT);
});

test("완료 요청은 상태만 바꾼다", () => {
  // 제목·마감일을 함께 보내면 앱이 서버 문구를 덮어쓸 수 있다.
  assert.deepEqual(buildCompleteActionBody(), { status: "done" });
});

// 화면이 이 로직을 실제로 부르지 않으면 위 검사는 아무것도 지키지 않는다.
test("카드가 라운지에 실제로 걸려 있다", () => {
  assert.match(lounge, /import AmoraActionsCard from "@\/components\/lounge\/AmoraActionsCard";/u);
  assert.match(lounge, /amoraActions=\{<AmoraActionsCard refreshVersion=\{careRefreshVersion\} \/>\}/u);
  assert.match(experience, /amoraActions\?: ReactNode;/u);
  assert.match(experience, /\{amoraActions \? \(/u);
});

test("요청을 시작 시점 사용자에게 묶는다", () => {
  // 계정을 바꾼 뒤 늦게 도착한 응답이 다른 사람의 할 일을 그리면 안 된다.
  assert.match(card, /apiFetchForExpectedUser\(/u);
  assert.doesNotMatch(card, /(?<!apiFetchForExpectedUser\([^)]{0,200})\bfetch\(\s*["'`]http/u);
});

test("콜드 스타트에서 목록이 뜨도록 authGeneration 을 올린다", () => {
  // 이 줄이 없으면 구독 직후 첫 이벤트가 최초 적재를 끊고 끝난다 —
  // 앱을 켜고 라운지에 머무는 사람은 목록을 한 번도 못 본다(PR #163 에서 겪음).
  assert.match(card, /onAuthStateChange/u);
  assert.match(card, /setAuthGeneration\(\(generation\) => generation \+ 1\);/u);
  assert.match(card, /\[authGeneration, load, refreshVersion\]/u);
});

test("저장에 실패하면 줄을 지우지 않는다", () => {
  // 지우면 사용자는 끝난 줄 안다. 서버가 확인해 준 뒤에만 다시 읽는다.
  assert.match(card, /if \(!response\.ok\) return;\s*\n\s*await load\(\);/u);
});
