import assert from "node:assert/strict";
import test from "node:test";
import { parseAmoraActions, selectOpenAmoraActions, formatAmoraActionDueDate } from "../lib/amoraActions.mjs";
import { parseSharedAction } from "@hanbang/shared/amora-shared-actions";

/**
 * 라운지 미리보기의 해석기는 공용 계약(`@hanbang/shared/amora-shared-actions`)에 맡긴다.
 *
 * 예전 해석기는 id 를 100자에서 **잘랐다.** 잘린 id 로 완료를 보내면 없는 항목이나 다른 항목을
 * 고친다. 서버 수정 경로가 받는 모양(`^[A-Za-z0-9_-]{4,120}$`) 밖의 id 는 이제 버린다.
 * 미리보기의 정렬과 "…까지" 표기는 그대로 `YYYY-MM-DD` 만 쓴다.
 */

const entry = (over = {}) => ({ id: "act_0001", title: "청첩장 문구 확정", status: "open", priority: "medium", ...over });

test("미리보기는 id 를 자르지 않고 서버가 고칠 수 없는 id 를 버린다", () => {
  const long = "a".repeat(121);
  const parsed = parseAmoraActions({ actions: [entry({ id: long }), entry({ id: "act/0002" }), entry({ id: "b".repeat(101) })] });
  assert.deepEqual(parsed.map((action) => action.id), ["b".repeat(101)], "101자 id 는 그대로, 121자·'/' id 는 버린다");
  assert.equal(parseSharedAction(entry({ id: long })), null);
});

test("미리보기는 날짜 모양 예정일만 정렬·표기에 쓰고, 원문 예정일은 보드가 따로 읽는다", () => {
  const [plain, dated] = parseAmoraActions({ actions: [entry({ dueDate: "다음 주 중" }), entry({ id: "act_0002", dueDate: "2026-10-01" })] });
  assert.equal(plain.dueDate, "");
  assert.equal(dated.dueDate, "2026-10-01");
  assert.deepEqual(selectOpenAmoraActions([plain, dated]).visible.map((action) => action.id), ["act_0002", "act_0001"]);
  assert.equal(formatAmoraActionDueDate(dated.dueDate), "2026년 10월 1일까지");
  assert.equal(parseSharedAction(entry({ dueDate: "다음 주 중" })).dueDate, "다음 주 중");
});

test("미리보기 줄의 모양은 그대로다", () => {
  assert.deepEqual(parseAmoraActions({ actions: [entry({ description: "설명", categoryKey: "venue", dueDate: "2026-10-01" })] }), [
    { id: "act_0001", title: "청첩장 문구 확정", status: "open", priority: "medium", dueDate: "2026-10-01" },
  ]);
});
