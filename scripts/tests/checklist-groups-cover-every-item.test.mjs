// 단계 묶음이 **모든 항목을 정확히 한 번씩** 담고 있는가.
//
// ## 왜 필요한가
//
// 항목의 정본은 `packages/shared/src/constants/weddingPlanning.ts` 이고, 단계 묶음은
// `checklistGroups.ts` 가 그 위에 id 로 얹는 층이다. 두 파일이 떨어져 있으므로
// **한쪽만 고치는 일이 반드시 생긴다.**
//
// 그때 화면에서 벌어지는 일:
//   정본에 항목을 더하고 묶음에 안 적으면 → 그 항목이 마지막 단계 끝에 조용히 붙는다
//   묶음에 없는 id 를 적으면            → 아무 데도 안 그려지고 아무도 모른다
//   같은 id 를 두 단계에 적으면          → 한 번만 그려지고 개수(2/3)가 어긋난다
//
// 런타임(`groupChecklistItems`)은 셋 다 조용히 흘려보낸다 — 사용자 화면에서 항목이
// 사라지는 것보다 낫기 때문이다. 그래서 **막는 일은 이 검사가 한다.**
//
// ## 문자열이 아니라 자료로 묻는다
//
// 정규식으로 파일을 훑지 않고 두 모듈을 실제로 불러와 대조한다. 이 저장소는
// "문자열이 있나" 로 물었다가 다른 곳에 남은 같은 문자열이 대신 답한 사고를 겪었다
// (2026-08-26). id 목록끼리 맞춰 보면 그런 우회가 없다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `.ts` 를 `node --test` 에서 바로 import 할 수 없어 소스에서 읽어낸다.
 *
 * 파싱이 실패하면 **0개를 읽고도 통과**할 수 있으므로, 아래 첫 검사가 개수 자체를
 * 못 박는다. 경로가 틀리거나 형식이 바뀌면 그 검사가 먼저 빨간불이 된다.
 */
function readItemIds() {
  const source = readFileSync(
    `${ROOT}packages/shared/src/constants/weddingPlanning.ts`,
    "utf8",
  );
  const block = source
    .split("export const CATEGORY_CHECKLISTS")[1]
    .split("\n];")[0];
  return [...block.matchAll(/id:\s*"([a-z_0-9]+)"/g)].map((match) => match[1]);
}

function readGroups() {
  const source = readFileSync(
    `${ROOT}packages/shared/src/constants/checklistGroups.ts`,
    "utf8",
  );
  const block = source
    .split("export const CHECKLIST_GROUPS")[1]
    .split("\n};")[0];
  const groups = [...block.matchAll(/title:\s*"([^"]+)",\s*itemIds:\s*\[([^\]]*)\]/g)];
  return groups.map(([, title, ids]) => ({
    title,
    itemIds: [...ids.matchAll(/"([a-z_0-9]+)"/g)].map((match) => match[1]),
  }));
}

function readTaggedIds() {
  const source = readFileSync(
    `${ROOT}packages/shared/src/constants/checklistGroups.ts`,
    "utf8",
  );
  const block = source
    .split("export const CHECKLIST_ITEM_TAGS")[1]
    .split("\n};")[0];
  return [...block.matchAll(/^\s*([a-z_0-9]+):\s*"([^"]+)"/gm)]
    .map(([, id, tag]) => ({ id, tag }));
}

const itemIds = readItemIds();
const groups = readGroups();
const groupedIds = groups.flatMap((group) => group.itemIds);

test("읽어낸 자료가 비어 있지 않다", () => {
  // 파싱이 조용히 실패하면 아래 검사들이 전부 빈 배열끼리 비교해 통과한다.
  assert.ok(itemIds.length > 150, `정본 항목을 ${itemIds.length}개만 읽었다`);
  assert.ok(groups.length > 50, `단계를 ${groups.length}개만 읽었다`);
});

test("모든 항목이 정확히 한 단계에 든다", () => {
  const counts = new Map();
  for (const id of groupedIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const missing = itemIds.filter((id) => !counts.has(id));
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);

  assert.deepEqual(missing, [], `단계에 안 든 항목: ${missing.join(", ")}`);
  assert.deepEqual(duplicated, [], `두 단계에 든 항목: ${duplicated.join(", ")}`);
});

test("단계에 적힌 id 는 모두 실재한다", () => {
  const known = new Set(itemIds);
  const ghosts = [...new Set(groupedIds)].filter((id) => !known.has(id));
  assert.deepEqual(ghosts, [], `정본에 없는 id: ${ghosts.join(", ")}`);
});

test("단계 이름은 「01 · 이름」 꼴이다", () => {
  // 번호가 빠지면 화면에서 단계의 앞뒤를 읽을 수 없고, 가운뎃점이 빠지면
  // 다른 분야와 모양이 갈린다. 시안 8장이 예외 없이 이 꼴이다.
  const wrong = groups.map((g) => g.title).filter((t) => !/^\d{2} · .+/.test(t));
  assert.deepEqual(wrong, [], `이름 꼴이 다른 단계: ${wrong.join(" / ")}`);
});

test("표시가 붙은 항목은 모두 실재하고, 표시는 두 가지뿐이다", () => {
  // 없는 id 에 「필수」를 달아 두면 화면에는 아무 일도 안 일어나고, 정작 달렸어야 할
  // 항목은 표시가 없는 채로 나간다.
  const known = new Set(itemIds);
  const tagged = readTaggedIds();
  assert.ok(tagged.length > 0, "표시를 하나도 읽지 못했다");

  const ghosts = tagged.filter(({ id }) => !known.has(id)).map(({ id }) => id);
  assert.deepEqual(ghosts, [], `정본에 없는 id 에 표시가 달렸다: ${ghosts.join(", ")}`);

  const badTags = tagged
    .filter(({ tag }) => tag !== "중요 확인" && tag !== "해당 시")
    .map(({ id, tag }) => `${id}=${tag}`);
  assert.deepEqual(badTags, [], `모르는 표시: ${badTags.join(", ")}`);
});

test("조건 표현이 붙은 항목은 빠짐없이 「해당 시」다", () => {
  // 파운더 설계 문서의 규칙: 「`(필요한 경우)`·`(해당하는 경우)` 가 붙은 항목은 해당 시」.
  //
  // 이건 판단이 아니라 **읽기**라서 기계가 셀 수 있다. 라벨에 조건을 새로 붙이거나
  // 떼면 표시도 따라와야 하는데, 두 파일이 떨어져 있어 한쪽만 고치는 일이 생긴다.
  // 그러면 접미사는 있는데 표시가 없거나(라벨에 조건이 노출된 채 남는다), 표시는
  // 있는데 접미사가 없어(화면에서 조건이 두 번 사라진다) 어긋난다.
  const source = readFileSync(
    `${ROOT}packages/shared/src/constants/weddingPlanning.ts`,
    "utf8",
  );
  const block = source
    .split("export const CATEGORY_CHECKLISTS")[1]
    .split("\n];")[0];
  const labelled = [...block.matchAll(/id:\s*"([a-z_0-9]+)",\s*\n?\s*label:\s*"([^"]+)"/g)];
  assert.ok(labelled.length > 150, `라벨을 ${labelled.length}개만 읽었다`);

  const conditional = labelled
    .filter(([, , label]) => /\((?:해당하는|필요한)\s*경우\)\s*$/.test(label))
    .map(([, id]) => id);
  assert.ok(conditional.length > 5, `조건 항목을 ${conditional.length}개만 읽었다`);

  const tagged = new Map(readTaggedIds().map(({ id, tag }) => [id, tag]));
  const missing = conditional.filter((id) => tagged.get(id) !== "해당 시");
  assert.deepEqual(missing, [], `조건 표현이 있는데 「해당 시」가 없다: ${missing.join(", ")}`);

  const extra = [...tagged]
    .filter(([id, tag]) => tag === "해당 시" && !conditional.includes(id))
    .map(([id]) => id);
  assert.deepEqual(extra, [], `조건 표현이 없는데 「해당 시」가 붙었다: ${extra.join(", ")}`);
});

test("「중요 확인」은 아끼고 법적 의무로 표시하지 않는다", () => {
  // 강조가 절반에 붙으면 아무것도 강조하지 않는 것과 같다.
  const tagged = readTaggedIds();
  assert.ok(tagged.every(({ tag }) => tag !== "필수"));
  const required = tagged.filter(({ tag }) => tag === "중요 확인");
  assert.ok(
    required.length <= itemIds.length * 0.12,
    `「중요 확인」이 ${required.length}개다 — 전체 ${itemIds.length}개의 12% 를 넘는다`,
  );
});
