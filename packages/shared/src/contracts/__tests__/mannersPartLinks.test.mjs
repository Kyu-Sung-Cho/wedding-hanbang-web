import test from "node:test";
import assert from "node:assert/strict";

import { MANNERS_PART_LINKS, mannersPartForCitation } from "../mannersPartLinks.mjs";

/**
 * 아모라 답의 `[etiquette:N]` 번호를 편으로 바꾸는 조회(2026-09-18). 정본과의 대조는
 * `scripts/tests/manners-guide-map-matches-parts.test.mjs` 가 한다 — 여기서는 조회 규칙만 본다.
 */

test("1..25 정수에만 편을 돌려준다", () => {
  assert.deepEqual(mannersPartForCitation(9), { slug: "gift-money", title: "축의금", subtitle: "형편에 맞게 마음을 전하고 기록하기" });
  assert.equal(mannersPartForCitation(1).slug, "first-family-visit");
  assert.equal(mannersPartForCitation(25).slug, "cost-saving");
  for (const value of [0, 26, 99, -1, 9.5, "9", NaN, Infinity, null, undefined, "__proto__", "constructor", "toString", {}, []]) {
    assert.equal(mannersPartForCitation(value), undefined, String(value));
  }
});

test("표는 25편이고 고칠 수 없다", () => {
  assert.equal(Object.keys(MANNERS_PART_LINKS).length, 25);
  assert.ok(Object.isFrozen(MANNERS_PART_LINKS));
  assert.ok(Object.isFrozen(MANNERS_PART_LINKS[9]));
  assert.throws(() => { "use strict"; MANNERS_PART_LINKS[9].title = "바뀐 제목"; });
});
