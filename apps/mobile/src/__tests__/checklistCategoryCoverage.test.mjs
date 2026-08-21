import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/**
 * 모바일이 체크리스트 분야를 **정본에서 가져오는가.**
 *
 * 제품 계약은 모바일 앱이 소비자의 주 제품이라고 못박는데, 2026-08-21에 분야를 열아홉에서
 * 스물하나로 늘리는 동안 모바일 쪽을 지키는 검사는 하나도 없었다. 웹에는 화면마다
 * 공용 컴포넌트를 쓰는지 보는 구조 검사가 있는데 모바일은 비어 있었다.
 *
 * 실제로 그날 여섯 자리가 정본을 안 따라왔고 그중 둘이 모바일이었다(예산 화면과 예산
 * 저장 허용 목록). 화면은 템플릿으로 그리니 분야는 보이는데 저장·집계에서만 빠지는
 * 모양이라 눈으로는 알아채기 어렵다.
 *
 * 그래서 여기서 본다 — 분야 목록을 **손으로 다시 적지 않았는가**, 그리고 손으로 적은
 * 자리가 있다면 빠짐없이 담았는가.
 */
const source = (relative) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const shared = readFileSync(
  fileURLToPath(new URL("../../../../packages/shared/src/constants/weddingPlanning.ts", import.meta.url)),
  "utf8",
);

/** 정본의 분야 키. 예산 전용 칸(`reserve`)은 체크리스트 분야가 아니라 따로 둔다. */
const CATEGORY_KEYS = [...shared.matchAll(/^ {4}key: "(\w+)",/gm)].map((m) => m[1]);

test("정본에서 분야를 실제로 읽어낸다", () => {
  // 못 읽으면 아래 검사들이 빈 목록끼리 비교해 늘 통과한다. 먼저 읽었는지 본다.
  assert.ok(
    CATEGORY_KEYS.length > 15,
    `정본에서 분야를 ${CATEGORY_KEYS.length}개밖에 못 읽었다 — 정규식이 낡았을 수 있다`,
  );
  assert.ok(CATEGORY_KEYS.includes("meeting"));
});

test("체크리스트·일정 화면이 분야 목록을 손으로 다시 적지 않는다", () => {
  // 체크리스트 화면은 일정 화면을 그대로 재사용한다(`export { default } from`).
  const checklist = source("app/checklist/index.tsx");
  assert.match(
    checklist,
    /export \{ default \} from "\.\.\/schedule\/index"/,
    "체크리스트 화면이 일정 화면 재사용을 그만뒀다면 이 검사가 무엇을 봐야 할지 다시 정해야 한다",
  );

  const schedule = source("app/schedule/index.tsx");
  assert.match(
    schedule,
    /import \{[^}]*CATEGORY_CHECKLISTS[^}]*\} from "@\/constants\/checklists"/,
    "일정 화면이 정본 템플릿을 안 쓴다",
  );

  // 분야 키를 여럿 문자열로 늘어놓았다면 손으로 적은 목록이다.
  const quoted = CATEGORY_KEYS.filter((key) => schedule.includes(`"${key}"`));
  assert.ok(
    quoted.length < 5,
    `일정 화면이 분야 키를 ${quoted.length}개 문자열로 담고 있다 — 손으로 적은 목록으로 보인다: ${quoted.join(", ")}`,
  );
});

/**
 * 첫 화면 파일. 예전에는 `dashboard.tsx` 였는데 2026-08-19 파운더 결정으로
 * **웨딩 라운지**가 되면서 파일도 `lounge.tsx` 로 바뀌었다(#147).
 *
 * 이름을 여기 한 곳에만 적고, 아래에서 **파일이 실제로 있는지 먼저 단언한다.**
 * 그냥 읽으면 이름이 또 바뀌었을 때 ENOENT 로 죽는데, 그건 "정본을 안 쓴다"는
 * 이 검사의 실패 메시지와 아무 상관이 없어서 다음 사람이 헤맨다.
 */
const FIRST_SCREEN = "app/(tabs)/lounge.tsx";

/**
 * 화면이 정본 템플릿(`CATEGORY_CHECKLISTS`)을 **그 이름 그대로** 쓰는가.
 *
 * 정규식을 안 쓴다. 처음에는 `/\bCATEGORY_CHECKLISTS\b/` 로 쓰려 했는데, 스크립트로
 * 파일을 쓰면서 `\b` 가 **실제 백스페이스 문자(0x08)로 박혔다** — 파일에는
 * `/^HCATEGORY_CHECKLISTS^H/` 가 들어갔고, 그러면 영원히 매칭 실패한다.
 * 이 저장소에서 전에도 같은 사고가 있었다.
 *
 * 낱말 경계가 필요한 이유는 따로 있다: 그냥 부분 문자열로 찾으면
 * `CATEGORY_CHECKLISTS_X` 같은 **다른 이름**도 통과한다(뮤테이션으로 확인했다).
 * 그래서 앞뒤 글자가 식별자 문자가 아닌지를 손으로 본다.
 */
function firstScreenUsesTemplate(source) {
  const name = "CATEGORY_CHECKLISTS";
  const isIdentifierChar = (ch) => ch !== undefined && /[A-Za-z0-9_$]/u.test(ch);

  for (let at = source.indexOf(name); at !== -1; at = source.indexOf(name, at + 1)) {
    const before = source[at - 1];
    const after = source[at + name.length];
    if (!isIdentifierChar(before) && !isIdentifierChar(after)) return true;
  }
  return false;
}

test("첫 화면이 분야를 정본에서 가져온다", () => {
  let firstScreen = "";
  assert.doesNotThrow(
    () => { firstScreen = source(FIRST_SCREEN); },
    `첫 화면 파일이 없습니다: ${FIRST_SCREEN}. 화면 이름이 또 바뀌었다면 `
      + "이 파일의 FIRST_SCREEN 을 옮기세요 — 검사를 지우지는 마세요.",
  );

  // 낱말 경계를 건다. `/CATEGORY_CHECKLISTS/` 만 쓰면 `CATEGORY_CHECKLISTS_X` 같은
  // **다른 이름**도 통과한다 — 뮤테이션으로 실제로 확인했다(이름을 바꿔도 초록이었다).
  assert.ok(
    firstScreenUsesTemplate(firstScreen),
    "첫 화면이 정본 템플릿을 안 쓴다",
  );
  const quoted = CATEGORY_KEYS.filter((key) => firstScreen.includes(`"${key}"`));
  assert.ok(
    quoted.length < 5,
    `첫 화면이 분야 키를 ${quoted.length}개 문자열로 담고 있다: ${quoted.join(", ")}`,
  );
});

/**
 * 예산 쪽은 손으로 적을 수밖에 없는 자리가 있다 — 예산 전용 칸(`reserve`)이 체크리스트에
 * 없어서다. 그래서 "적지 마라"가 아니라 **"적었으면 빠짐없이 적어라"**로 본다.
 */
test("예산 쪽 손목록이 분야를 빠짐없이 담는다", () => {
  for (const relative of ["app/budget/index.tsx", "src/lib/budgetRevision.mjs"]) {
    const text = source(relative);
    const missing = CATEGORY_KEYS.filter((key) => !text.includes(`"${key}"`));
    assert.deepEqual(
      missing,
      [],
      `${relative} 에서 빠진 분야: ${missing.join(", ")}`,
    );
  }
});
