// 예산 비중 계산이 **한 곳에만** 있는가.
//
// ## 무엇이 있었나
//
// 같은 예산 화면이 웹과 모바일 둘 다에 있고 둘 다 `wedding_journeys.progress` 를
// 읽는다. 이 저장소는 그 둘이 갈라지는 병을 여러 번 앓았다:
//
//   2026-08-24  표면마다 따로 세다가 **한 장의 카드 안에서 숫자가 둘로 갈렸다**
//   2026-08-26  표식을 걷어내는 함수를 웹만 고치고 모바일이 사흘 뒤까지 안 따라왔다
//
// 비중은 특히 갈라지기 쉽다. `Math.round` 한 줄이면 되는 것처럼 보이기 때문이다.
// 그런데 그렇게 하면 조각이 여럿일 때 합이 99나 101이 되고, 두 화면이 같은 커플에게
// 다른 숫자를 말한다.
//
// ## 무엇을 묻나
//
// "shared 를 쓰고 있나" 가 아니라 **"계산이 두 번 적혀 있지 않나"** 를 묻는다.
// 앞의 질문은 한 곳에서 import 하면서 옆에 사본을 둬도 통과한다.
//
// 찾는 낱말을 문자열로 적지 않고 조각내어 만든다. 그대로 적으면 **이 파일 자신이
// 그 낱말을 가진 파일로 세어져** 개수가 하나 늘고, 그 사실을 눈치채지 못한 채
// 기준을 2로 올리게 된다. 이 저장소는 "다른 곳에 남은 같은 문자열이 대신 답하는"
// 사고를 이미 겪었다(2026-08-26).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 여기 있어야 한다 — 유일한 구현. */
const HOME = join("packages", "shared", "src", "contracts", "budgetShare.mjs");

const SEARCH_ROOTS = [
  join("apps", "web", "src"),
  join("apps", "mobile"),
  join("packages", "shared", "src"),
  join("packages", "design-tokens", "src"),
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", "coverage"]);
const CODE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];

/** 정의만 찾는다. 부르는 곳은 셀 필요가 없다. */
const DEFINITION_NEEDLES = ["withPercents", "foldPayerSides"].map(
  (name) => ({ name, needle: `${"func"}${"tion "}${name}` }),
);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (CODE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

const files = SEARCH_ROOTS.flatMap((root) => walk(join(ROOT, root), []));

test("훑을 파일을 실제로 찾았다", () => {
  // 경로가 틀리면 0개를 훑고도 "구현이 하나뿐" 이라는 초록불이 나온다.
  assert.ok(files.length > 500, `훑은 파일이 너무 적다(${files.length}개) — 경로를 확인할 것`);
});

for (const { name, needle } of DEFINITION_NEEDLES) {
  test(`${name} 의 구현은 한 곳뿐이다`, () => {
    const owners = files
      .filter((file) => readFileSync(file, "utf8").includes(needle))
      .map((file) => relative(ROOT, file));

    assert.deepEqual(
      owners,
      [HOME.split(sep).join(sep)],
      `${name} 이 여러 곳에 적혀 있다: ${owners.join(" · ") || "(한 곳도 없다)"}`,
    );
  });
}

test("웹과 모바일 모두 shared 의 것을 불러 쓴다", () => {
  // 구현이 하나여도 한쪽이 안 부르면 그 화면에는 이 계산이 아예 없는 것이다.
  const importers = files
    .filter((file) => readFileSync(file, "utf8").includes("@hanbang/shared/budget-share"))
    .map((file) => relative(ROOT, file));

  const web = importers.filter((path) => path.startsWith(join("apps", "web")));
  const mobile = importers.filter((path) => path.startsWith(join("apps", "mobile")));

  assert.ok(web.length > 0, "웹에서 @hanbang/shared/budget-share 를 부르는 곳이 없다");
  assert.ok(mobile.length > 0, "모바일에서 @hanbang/shared/budget-share 를 부르는 곳이 없다");
});
