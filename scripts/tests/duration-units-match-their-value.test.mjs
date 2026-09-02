// 화면에 나가는 기간 라벨에서 **단위가 값과 따로 놀지 않는가.**
//
// ## 무엇이 있었나
//
// 이 저장소는 남은 기간을 언제나 **날짜 수**로 계산한다 — `dday - ddayDeadline`,
// `remainingDays`, `daysUntilDeadline`, `deadlineDaysLeft`. 그런데 단위는 화면마다
// 손으로 적어 붙였다(`${remainingDays}일`). 그러면 두 가지가 가능해진다.
//
//   1. 숫자에 상한이 없다 — 예식이 먼 커플은 「기본 확인 시점까지 255일」 을 본다.
//   2. 날짜 수를 **그대로 두고 단위만** 바꾸면 「255월」 이 그대로 화면에 나간다.
//
// 2번은 실제로 신고된 모양이다(「255월 후」). 고치는 방법은 라벨을 하나씩 잡는 것이
// 아니라 **단위를 값에서 나오게 하는 것**이고(`@hanbang/shared/korean-duration`),
// 이 검사는 그 규칙을 우회하는 조합이 다시 생기지 않게 막는다.
//
// ## 무엇을 잡고 무엇을 못 잡는가
//
// 잡는 것: 보간값 바로 뒤에 월 단위가 오는데 **그 보간값이 날짜 수**인 경우
// (`${remainingDays}개월`, `${daysUntilDeadline}월`).
//
// 못 잡는 것: 숫자와 단위가 서로 다른 요소로 갈라져 그려지는 경우
// (`<p>{dday}</p><p>개월</p>`). 정적으로는 두 요소가 붙어 보인다는 것을 알 수 없다.
// 그 자리는 사람이 봐야 한다 — 이 검사는 그 한계를 알고 있다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * 훑을 영역과 영역별 하한. 하한은 오늘 값의 55~70% 다 — 오늘에 붙여 놓으면 정상
 * 삭제 PR 이 걸리고, 사람은 숫자를 내린다.
 */
const AREAS = [
  { name: "apps/web/src", dir: resolve(repoRoot, "apps/web/src"), floor: 500 },
  { name: "apps/mobile", dir: resolve(repoRoot, "apps/mobile"), floor: 120 },
  { name: "packages/shared/src", dir: resolve(repoRoot, "packages/shared/src"), floor: 25 },
];

/**
 * 하한은 부분 손실에 눈이 멀어 있다. 기간 라벨을 실제로 그리는 파일이 목록에
 * 들어 있는지 따로 묻는다.
 */
const SENTINELS = [
  "apps/web/src/app/(app)/lounge/page.tsx",
  "apps/web/src/components/app/WeeklyCard.tsx",
  "apps/web/src/lib/amora/lifecycle.ts",
  "apps/mobile/src/components/dashboard/WeddingHomeExperience.tsx",
  "apps/mobile/src/lib/dashboardExperience.mjs",   // .mjs 가 빠지면 여기서 걸린다
];

const SKIP_DIRS = new Set([
  "node_modules", "__tests__", ".next", ".expo", ".turbo", "coverage",
  "ios", "android", "dist", "build",
]);

const EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

/** 주석은 걷어낸다. 왜 없앴는지 적은 기록까지 금지하면 다음 사람이 같은 실수를 한다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

// catch 를 두지 않는다. 경로가 어긋나면 조용히 0개를 돌려주는 것이 이 검사에서
// 가장 나쁜 실패다. ENOENT 로 죽어라.
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (
      EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      && !/\.(test|spec)\./u.test(entry.name)
    ) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 보간값 바로 뒤에 오는 월 단위.
 *
 * `월요일` 은 뺀다 — 요일 이름은 기간 단위가 아니다. `달러` 같은 낱말이 뒤에
 * 붙는 경우도 `달` 뒤 글자로 걸러진다.
 */
const MONTH_UNIT_AFTER_VALUE = /\$\{([^{}]{1,120})\}\s?(개월|달|월)(?![가-힣])/gu;

/**
 * 보간값 안에서 이미 달로 환산했는가.
 *
 * `${Math.round(days / 30)}개월` 은 **맞는 코드다.** 날짜 수가 이름에 남아 있어도
 * 화면에 나가는 숫자는 이미 달이다. 한 달로 나누는 것(28~31 또는 달을 뜻하는
 * 상수)과 이름에 달이 들어간 것을 환산으로 본다.
 */
function convertsToMonths(expression) {
  return /\/\s*(?:2[89]|3[01])(?:\.\d+)?\b/u.test(expression)
    || /\/\s*[A-Za-z_]*MONTH[A-Za-z_]*/iu.test(expression)
    || /month/iu.test(expression);
}

/**
 * 보간값이 환산 없는 **날짜 수**인가.
 *
 * `getMonth()`·`Number(month)` 처럼 달을 가리키는 이름은 걸리지 않는다 — 그 값에
 * 월 단위를 붙이는 것은 맞는 일이다.
 */
function looksLikeDayCount(expression) {
  if (convertsToMonths(expression)) return false;
  const lowered = expression.toLowerCase();
  return /\bd?days?\b|\bdday\b|daysuntil|daysleft|dayscount|remainingdays|deadlinedays|일수/u.test(
    lowered.replace(/[^a-z0-9가-힣]/gu, " "),
  ) || /diffdays|daycount/u.test(lowered);
}

function findOffenders(source, label) {
  const offenders = [];
  stripComments(source).split("\n").forEach((line, index) => {
    for (const match of line.matchAll(MONTH_UNIT_AFTER_VALUE)) {
      if (!looksLikeDayCount(match[1])) continue;
      offenders.push(`${label}:${index + 1} [${match[0].trim()}] — ${line.trim().slice(0, 80)}`);
    }
  });
  return offenders;
}

test("측정기가 살아 있다", () => {
  const scanned = new Set();
  for (const area of AREAS) {
    const found = walk(area.dir, []);
    assert.ok(
      found.length >= area.floor,
      `${area.name} 에서 ${found.length}개만 찾았다(하한 ${area.floor}) — 걷기가 깨졌는지 보라`,
    );
    for (const file of found) scanned.add(relative(repoRoot, file).split("\\").join("/"));
  }

  const missing = SENTINELS.filter((file) => !scanned.has(file));
  assert.deepEqual(
    missing,
    [],
    `표식 파일이 스캔 목록에 없다 — 확장자 목록이나 영역이 좁아졌다: ${missing.join(" · ")}`,
  );
});

test("날짜 수에 월 단위를 붙인 라벨이 없다", () => {
  const offenders = [];
  for (const area of AREAS) {
    for (const file of walk(area.dir, [])) {
      offenders.push(...findOffenders(readFileSync(file, "utf8"), relative(repoRoot, file)));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "날짜 수에 월 단위를 붙였습니다 — 「255월」 이 이렇게 나옵니다. 단위를 손으로 "
      + "적지 말고 `formatKoreanDayCount`(@hanbang/shared/korean-duration)를 쓰세요.\n"
      + offenders.join("\n"),
  );
});

test("검사기가 실제로 잡는다", () => {
  // 위 검사가 0건이라 "잡을 수 있는가"를 증명하지 못한다. 답을 아는 표본으로 잰다.
  for (const planted of [
    "const label = `${remainingDays}월 후`;",
    "const label = `기본 확인 시점까지 ${daysUntilDeadline}개월`;",
    "return `${Math.abs(deadlineDaysLeft)} 개월 전`;",
    "return `${dday}월`;",
  ]) {
    assert.ok(
      findOffenders(planted, "planted").length > 0,
      `심어 둔 조합을 못 잡았다: ${planted}`,
    );
  }
});

test("맞는 조합은 잡지 않는다", () => {
  for (const fine of [
    // 달을 가리키는 값에 월 단위를 붙이는 것은 맞다.
    "return `${d.getMonth() + 1}월 ${d.getDate()}일`;",
    "return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일까지`;",
    "return `${month[1]}년 ${Number(month[2])}월`;",
    // 날짜 수에 날짜 단위를 붙이는 것도 맞다.
    "return `${remainingDays}일 남음`;",
    "return `기본 확인 시점까지 ${daysUntilDeadline}일`;",
    // 보간값 안에서 이미 달로 환산했으면 화면에 나가는 숫자는 달이다.
    "return `${Math.round(days / 30)}개월 전`;",
    "return `${Math.floor(days / 30)}달 전`;",
    "return `약 ${Math.round(magnitude / DAYS_PER_MONTH)}개월`;",
    // 요일 이름은 기간 단위가 아니다.
    "return `${weekdays[d.getDay()]}요일`;",
    // 공유 포맷터를 쓰면 단위가 값에서 나온다 — 여기서 막을 것이 없다.
    "return `기본 확인 시점까지 ${formatKoreanDayCount(daysUntilDeadline)}`;",
  ]) {
    assert.deepEqual(
      findOffenders(fine, "fine"),
      [],
      `멀쩡한 조합을 잡았다: ${fine}`,
    );
  }

  // 주석에 남긴 기록은 걸리지 않아야 한다.
  const note = "// 예전에는 `${remainingDays}월` 이 나갔다\nconst ok = `${days}일`;";
  assert.deepEqual(findOffenders(note, "note"), [], "주석의 기록까지 금지하고 있다");
});
