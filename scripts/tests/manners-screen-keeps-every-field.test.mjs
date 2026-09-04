// 예절 화면이 **자료의 모든 칸을 그리는가.**
//
// ## 왜 필요한가
//
// 2026-09-04 에 파운더 시안으로 화면을 통째로 바꿨다. 그때 두 칸이 조용히 사라졌다:
//
//   part.description   「이 글이 무엇을 다루는지」 한 줄. 부제를 `subtitle` 로
//                      바꾸면서 자리를 잃었다. 검색으로 들어온 사람에게는 이 문장이
//                      「읽어야 하나」를 가르는 유일한 신호다.
//   source.scope       「이 출처가 무엇을 덮는가」(예: 2025년 4월 전국 14개 지역 370곳
//                      조사 결과). 없으면 출처를 실제보다 넓게 읽는다.
//
// 둘 다 **화면이 깨지지 않았다.** 타입도 통과했고 테스트도 전부 초록이었다. 자료가
// 그냥 안 그려졌을 뿐이라 아무도 몰랐다 — 파운더가 「우리가 했던 거 다 녹인 거 맞아?」
// 라고 물어서 세어 보고 알았다.
//
// ## 무엇을 묻나
//
// 자료 계약(`types.ts`)에 적힌 칸 이름을 뽑아, 화면이 그중 하나라도 안 쓰면 실패한다.
// 「문자열이 있나」가 아니라 **두 목록을 맞춰 보는** 방식이다.
//
// 일부러 안 그리는 칸은 아래 목록에 이유와 함께 적는다. 목록에 없는 칸이 화면에서
// 사라지면 그때 빨간불이 난다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function read(path) {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

/**
 * 화면에 안 그려도 되는 칸과 그 이유.
 *
 * 여기에 줄을 더할 때는 **왜 안 그려도 되는지**를 적어라. 이유 없이 추가하면 이
 * 검사는 아무것도 안 지키는 목록이 된다.
 */
const NOT_RENDERED = {
  kind: "블록 종류를 고르는 판별자다. 그 자체가 화면에 나올 것이 아니다.",
  legacyNumber: "옛 25편 번호. 주소 호환용이고 화면에는 위치 번호를 쓴다.",
  slugs: "목차(MANNERS_CATEGORIES)가 쓰는 편 목록. 본문 화면의 칸이 아니다.",
  sourceRefs: "표가 가리키는 출처 번호. 번호가 아니라 그 출처의 이름을 그린다.",
  columns: "표 머리글. 넓은 화면에서는 th, 좁은 화면에서는 각 행의 이름표로 나간다.",
  rows: "표 본문. 셀 하나하나가 나간다.",
  items: "목록 항목. 점 목록으로 나간다.",
  lines: "대사 묶음. 카드 하나하나로 나간다.",
  blocks: "절의 내용물. 블록마다 그린다.",
  sections: "편의 절. 카드마다 그린다.",
  sources: "각주 목록. 항목마다 그린다.",
  text: "문단 본문. 그린다(TL;DR 또는 문단으로) — `lead.text` 와 `block.text` 둘 다.",
};

const view = read("apps/web/src/components/manners/MannersPartView.tsx");
const types = read("apps/web/src/lib/manners/types.ts");

/**
 * 자료 계약에 적힌 칸 이름.
 *
 * 들여쓰기를 고정하지 마라. 블록 유니온의 칸들은 6칸 들여쓰기라, 2칸만 보던 첫 판은
 * `columns`·`rows`·`items` 같은 칸을 통째로 놓치고도 초록불이었다.
 */
const fields = [...new Set([
  // 줄마다 하나씩 적힌 칸(인터페이스 안).
  ...[...types.matchAll(/^\s{2,}(\w+)\??:\s/gmu)].map((match) => match[1]),
  // 한 줄에 몰아 적은 유니온 멤버(`{ kind: "checklist"; title?: string; items: string[] }`).
  // 이걸 빼먹으면 `items`·`lines`·`text` 를 못 읽고도 초록불이 난다.
  ...[...types.matchAll(/[{;]\s*(\w+)\??:\s/gu)].map((match) => match[1]),
])];

test("자료 계약에서 칸 이름을 실제로 읽어냈다", () => {
  // 파싱이 조용히 실패하면 아래 검사가 빈 목록끼리 비교해 통과한다.
  assert.ok(fields.length > 10, `칸을 ${fields.length}개만 읽었다`);
  assert.ok(fields.includes("description"), "description 을 못 읽었다 — 파싱을 확인하라");
  assert.ok(fields.includes("scope"), "scope 를 못 읽었다 — 파싱을 확인하라");
});

test("화면이 자료의 모든 칸을 그린다", () => {
  const missing = fields
    .filter((field) => !(field in NOT_RENDERED))
    .filter((field) => !new RegExp(`\\.${field}\\b`, "u").test(view));

  assert.deepEqual(
    missing,
    [],
    `화면이 안 그리는 칸: ${missing.join(", ")} — 일부러라면 NOT_RENDERED 에 이유와 함께 적어라`,
  );
});

test("안 그린다고 적어 둔 칸에는 이유가 있다", () => {
  const empty = Object.entries(NOT_RENDERED)
    .filter(([, reason]) => reason.trim().length < 10)
    .map(([field]) => field);
  assert.deepEqual(empty, [], `이유가 없는 칸: ${empty.join(", ")}`);
});

test("목록에 죽은 칸이 없다", () => {
  // 자료에서 없어진 칸이 목록에 남아 있으면, 그 줄이 다음에 같은 이름으로 생기는
  // 진짜 칸을 조용히 면제해 준다.
  const stale = Object.keys(NOT_RENDERED).filter((field) => !fields.includes(field));
  assert.deepEqual(stale, [], `자료에 없는 칸이 목록에 남아 있다: ${stale.join(", ")}`);
});
