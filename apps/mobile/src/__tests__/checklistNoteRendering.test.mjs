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

test("항목 타입을 복사하지 않고 공유 템플릿의 것을 쓴다", () => {
  assert.doesNotMatch(
    schedule,
    /interface ChecklistItem\s*\{/,
    "로컬 사본을 다시 만들면 공유 쪽 변경을 또 놓친다",
  );
  assert.match(schedule, /type ChecklistItem/, "공유 타입을 가져와야 한다");
});

test("안내를 항목 아래에 그린다", () => {
  assert.match(schedule, /item\.note \?/, "안내가 있을 때만 그려야 한다");
  assert.match(schedule, /styles\.itemNote/, "안내 전용 스타일이 있어야 한다");
});

test("안내를 이름이 아니라 힌트로 읽힌다", () => {
  // 이름에 붙이면 스크린 리더가 항목마다 두 문장을 이어 읽는다.
  assert.match(schedule, /accessibilityHint=\{item\.note\}/);
  assert.match(schedule, /accessibilityLabel=\{item\.label\}/);
});

test("안내가 붙어도 저장에는 실리지 않는다", () => {
  // DB는 항목을 {id, label, done} 정확히 세 키로만 받는다.
  const strips = schedule.match(/checklist: stripPlanningChecklistNotes\(/g) ?? [];
  assert.equal(strips.length, 2, "저장 경로 두 곳 모두 안내를 떼야 한다");
});
