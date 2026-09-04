// shared 에 둔 「분야 → 예절 편」 지도가 **웹의 정본과 같은가.**
//
// ## 지도는 하나다 — 제목만 사본이다
//
// 예절 25편의 내용은 웹에만 있다(`apps/web/src/lib/manners/data.ts`). 모바일은 그것을
// 웹뷰로 열 뿐이라 필요한 것은 내용이 아니라 **어느 편으로 가는가와 그 편의 제목**뿐이다.
// 25편 전체를 shared 로 옮기면 모바일 번들에 안 읽는 본문이 실린다.
//
// 그래서 **분야 → slug 지도는 shared 한 곳**에 두고 웹이 그것을 불러 쓴다
// (`apps/web/src/lib/manners/categoryMap.ts`). 사본이 아니므로 어긋날 수 없다.
//
// 어긋날 수 있는 것은 **제목**이다. shared 는 버튼에 쓸 제목 문자열을 들고 있는데
// 정본은 `data.ts` 다. 편 제목을 웹에서 고치면 모바일 버튼만 옛 이름을 말한다.
//
// ## 무엇을 묻나
//
//   1. 웹이 정말 shared 지도를 쓰는가 (사본을 다시 만들지 않았는가)
//   2. shared 의 제목이 그 편의 실제 제목과 같은가
//   3. shared 가 가리키는 slug 가 25편 안에 실재하는가
//
// "문자열이 있나" 가 아니라 **두 목록을 맞춰 보는** 방식이다. 이 저장소는 문자열
// 존재만 물었다가 다른 곳에 남은 같은 문자열이 대신 답한 사고를 겪었다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function read(path) {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

const webCategoryMap = read("apps/web/src/lib/manners/categoryMap.ts");

/** 웹 정본: slug → 편 제목. */
function webPartTitles() {
  const source = read("apps/web/src/lib/manners/data.ts");
  const titles = {};
  for (const match of source.matchAll(/slug:\s*"([a-z0-9-]+)"[\s\S]{0,400}?title:\s*"([^"]+)"/g)) {
    if (!(match[1] in titles)) titles[match[1]] = match[2];
  }
  return titles;
}

/** shared 사본: 분야 → { slug, title }. */
function sharedGuideMap() {
  const block = read("packages/shared/src/constants/mannersGuideMap.ts")
    .split("MANNERS_GUIDE_BY_CATEGORY: Readonly<Record<string, MannersGuideTarget>> = {")[1]
    .split("\n};")[0];
  return Object.fromEntries(
    [...block.matchAll(/(\w+):\s*\{\s*slug:\s*"([a-z0-9-]+)",\s*title:\s*"([^"]+)"\s*\}/g)]
      .map((m) => [m[1], { slug: m[2], title: m[3] }]),
  );
}

const titles = webPartTitles();
const shared = sharedGuideMap();

test("두 목록을 실제로 읽어냈다", () => {
  // 파싱이 조용히 실패하면 아래 검사들이 빈 것끼리 비교해 전부 통과한다.
  assert.ok(Object.keys(titles).length >= 20, `편 제목을 ${Object.keys(titles).length}개만 읽었다`);
  assert.ok(Object.keys(shared).length >= 20, `shared 지도를 ${Object.keys(shared).length}개만 읽었다`);
});

test("웹이 지도를 다시 적지 않고 shared 것을 쓴다", () => {
  // 사본을 되살리면 모바일과 웹이 다른 편을 열게 되고, 그것이 이 지도를 shared 로
  // 올린 이유다. 손으로 적은 목록이 돌아오면 여기서 막는다.
  assert.match(
    webCategoryMap,
    /MANNERS_GUIDE_BY_CATEGORY/,
    "웹이 shared 지도를 안 쓴다",
  );
  assert.doesNotMatch(
    webCategoryMap,
    /greeting:\s*"first-family-visit"/,
    "웹에 손으로 적은 지도가 되살아났다",
  );
});

test("shared 의 제목이 그 편의 실제 제목과 같다", () => {
  const wrong = Object.entries(shared)
    .filter(([, target]) => titles[target.slug] !== target.title)
    .map(([key, target]) => `${key}: shared="${target.title}" 정본="${titles[target.slug]}"`);
  assert.deepEqual(wrong, [], `제목이 어긋났다 — ${wrong.join(" / ")}`);
});

test("shared 가 가리키는 편이 실재한다", () => {
  const ghosts = Object.entries(shared)
    .filter(([, target]) => !(target.slug in titles))
    .map(([key, target]) => `${key}→${target.slug}`);
  assert.deepEqual(ghosts, [], `없는 편을 가리킨다 — ${ghosts.join(", ")}`);
});

test("체크리스트 분야가 모두 지도에 있다", () => {
  // 지도에 없는 분야는 시트 바닥의 「…예절 보기」 버튼이 아예 안 그려진다.
  // 조용히 사라지므로 분야를 추가할 때 눈치채기 어렵다.
  const block = read("packages/shared/src/constants/weddingPlanning.ts")
    .split("export const CATEGORY_CHECKLISTS")[1]
    .split("\n];")[0];
  const categoryKeys = [...block.matchAll(/\bkey:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(categoryKeys.length >= 20, `분야를 ${categoryKeys.length}개만 읽었다`);

  const missing = categoryKeys.filter((key) => !(key in shared));
  assert.deepEqual(missing, [], `지도에 없는 분야: ${missing.join(", ")}`);
});
