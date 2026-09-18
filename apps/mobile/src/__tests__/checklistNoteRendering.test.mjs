import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/**
 * 앱이 항목 안내(note)를 화면에 그리는가.
 *
 * 안내는 `packages/shared`의 체크리스트 템플릿이 들고 있고 앱도 그 템플릿을 쓴다.
 * 그런데 2026-08-20까지 앱에서는 한 줄도 안 보였다. 원인은 이 화면이 항목 타입을
 * **복사해서 로컬로 다시 선언**해 둔 것이었다 — 공유 쪽에 `note`가 생겼는데 사본만
 * 뒤처져서, 그리려 해도 타입에 없는 필드였다. 같은 것을 두 벌 적어두면 한쪽이 낡는다.
 */
const source = (relative) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const schedule = source("app/schedule/index.tsx");

/**
 * 2026-09-04: 항목을 그리는 자리가 **옮겨갔다.**
 *
 * 그전에는 분야 카드가 그 자리에서 펼쳐졌고(아코디언) 마크업이 `app/schedule/index.tsx`
 * 안에 있었다. 시안대로 시트로 바꾸면서 항목 렌더가 이 컴포넌트로 나왔다.
 *
 * 그래서 이 검사도 **그리는 곳**을 본다. 화면 파일만 계속 보면, 안내를 잘 그리고
 * 있는데도 빨간불이 난다(실제로 그랬다). 반대로 여기서 검사를 지워 버리면 안내가
 * 사라져도 아무도 모른다 — 그것이 이 파일이 처음 생긴 이유다.
 *
 * 화면이 이 시트를 실제로 띄우는지도 함께 확인한다. 컴포넌트만 있고 아무도 안 쓰면
 * 안내는 여전히 화면에 없다.
 */
const sheet = source("src/components/checklist/CategoryChecklistSheet.tsx");

/**
 * 2026-09-18: 분야 카드도 **옮겨갔다.** 웹 카드와 같은 상태 줄·진행 막대를 넣으면서 카드가
 * `app/schedule/index.tsx` 에서 이 컴포넌트로 나왔다. 상태 이름을 어디서 읽는지는 그리는 곳을 본다.
 */
const card = source("src/components/checklist/ChecklistCategoryCard.tsx");

test("항목 타입을 복사하지 않고 공유 템플릿의 것을 쓴다", () => {
  for (const [name, code] of [["schedule", schedule], ["sheet", sheet]]) {
    assert.doesNotMatch(
      code,
      /interface ChecklistItem\s*\{/,
      `${name}: 로컬 사본을 다시 만들면 공유 쪽 변경을 또 놓친다`,
    );
  }
  assert.match(schedule, /type ChecklistItem/, "공유 타입을 가져와야 한다");
  assert.match(sheet, /type ChecklistItem/, "시트도 공유 타입을 써야 한다");
});

test("화면이 항목 시트를 실제로 띄운다", () => {
  assert.match(schedule, /CategoryChecklistSheet/, "시트를 부르는 곳이 없다");
  assert.match(schedule, /<CategoryChecklistSheet/, "시트를 마운트하지 않는다");
});

/**
 * 분야 카드와 시트가 상태 이름을 직접 적지 않는다.
 *
 * 2026-09-16까지 일정 화면 분야 카드는 「해당 없음 · 진행률에서 제외」, 시트 칩은 세어 본
 * 숫자로 「시작 전 · 진행 중」을 만들어 적었다. 사용자가 「안 해요」로 고른 분야가 화면마다
 * 다른 말로 보였다. 이름은 `PREPARATION_PROGRESS_STATUS_LABELS` 한 곳에서만 읽는다.
 */
test("상태 이름을 세어서 만들지 않고 공용 사전에서 읽는다", () => {
  assert.match(schedule, /<ChecklistCategoryCard/, "화면이 분야 카드를 그리지 않는다");
  assert.match(card, /PREPARATION_PROGRESS_STATUS_LABELS\[stats\.status\]/);
  assert.match(card, /PREPARATION_PROGRESS_STATUS_LABELS\.not_applicable/);
  for (const code of [schedule, card]) {
    assert.doesNotMatch(code, /"해당 없음 · 진행률에서 제외"/);
    assert.doesNotMatch(code, /stats\.done === 0 \? "시작 전"/);
  }

  assert.match(sheet, /PREPARATION_PROGRESS_STATUS_LABELS\[stats\.skipped \? "not_applicable" : stats\.status\]/);
  assert.doesNotMatch(sheet, /stats\.skipped \? "해당 없음"/);
  assert.doesNotMatch(sheet, /stats\.done === 0 \? "시작 전"/);

  // 사전을 쓰려면 상태 키가 시트까지 와야 한다 — 저장된 값을 그대로 넘기는 경로.
  assert.match(sheet, /status: PlanningChecklistStatus;/);
  // 카드가 읽는 상태는 저장된 분야 상태여야 한다. `const status:` 선언만 보면 이 파일의 다른
  // 선언(:650)에 걸려 초록불이 난다 — 실제로 prove-guard 가 그 구멍을 통과했다.
  assert.match(schedule, /categories\.find\(\(category\) => category\.key === key\)\?\.status \?\? "not_started"/);
});

test("안내를 항목 아래에 그린다", () => {
  assert.match(sheet, /item\.note \?/, "안내가 있을 때만 그려야 한다");
  assert.match(sheet, /s\.itemNote/, "안내 전용 스타일이 있어야 한다");
});

test("안내를 이름이 아니라 힌트로 읽힌다", () => {
  // 이름에 붙이면 스크린 리더가 항목마다 두 문장을 이어 읽는다.
  assert.match(sheet, /accessibilityHint=\{item\.note\}/);
  assert.match(sheet, /accessibilityLabel=\{item\.label\}/);
});

test("안내가 붙어도 저장에는 실리지 않는다", () => {
  // DB는 항목을 {id, label, done} 정확히 세 키로만 받는다.
  const strips = schedule.match(/checklist: stripPlanningChecklistNotes\(/g) ?? [];
  assert.equal(strips.length, 2, "저장 경로 두 곳 모두 안내를 떼야 한다");
});
