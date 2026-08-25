import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

/**
 * 총예산을 아직 정하지 않은 커플이 첫 저장 카드에서 마이너스를 봤다.
 *
 * 신규 커플의 총예산은 0이다. 그 상태에서 예식장 예산을 잡으면 확인 카드가
 * "배분 후 남는 금액  0원 → -2,200만 원" 을 보여준다. 처음 저장해 보는
 * 사람이 자기 **첫 카드**에서 마이너스를 만난다.
 *
 * 웹은 2026-08-25 에 고쳤는데(`PendingAmoraActionCard.tsx` 의 `totalBudgetIsSet`)
 * **모바일은 같은 줄을 따로 갖고 있어서 그대로 남아 있었다.** 제품 계약상
 * 모바일이 소비자의 주 제품이다 — 웹만 고치면 주 제품이 계속 틀린 말을 한다.
 *
 * 계산값 자체는 서버가 그대로 둔다. 숨기는 것은 화면의 몫이다 —
 * 값을 바꾸면 총예산을 정한 커플의 **진짜** 초과 표시가 함께 죽는다.
 */

const source = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/(tabs)/chat.tsx",
  ),
  "utf8",
);

test("총예산을 정하기 전에는 남는 금액 줄을 감춘다", () => {
  assert.match(
    source,
    /const totalBudgetIsSet =\s*\n?\s*preview\.current\.totalBudget > 0 \|\| preview\.proposed\.totalBudget > 0/,
  );
  // 그 줄이 조건부여야 한다 — 무조건 들어가면 예전 상태다.
  assert.match(source, /\.\.\.\(totalBudgetIsSet[\s\S]{0,220}배분 후 남는 금액/);
});

test("대신 왜 계산하지 않았는지 알려준다", () => {
  // 줄만 사라지면 사용자는 무슨 일인지 모른다.
  assert.match(source, /총예산을 아직 정하지 않아 남는 금액은 계산하지 않았어요/);
  assert.match(source, /\{!totalBudgetIsSet && \(/);
});

test("총예산을 정한 커플에게는 그대로 보여준다", () => {
  // 조건이 뒤집히면(항상 감춤) 실제로 초과한 커플이 그 사실을 못 본다.
  assert.doesNotMatch(source, /\{totalBudgetIsSet && \([\s\S]{0,120}총예산을 아직 정하지 않아/);
});

/**
 * 아모라는 카드가 뜬 뒤 말로 승인하면 "화면의 **이대로 적용** 버튼을 눌러야
 * 반영됩니다" 라고 안내한다(`amoraPromptComposer.ts`). 그 문구는 화면이 실제로
 * 쓰는 버튼 이름이어야 한다 — 다르면 없는 버튼을 가리키는 셈이다.
 */
test("확인 버튼 이름이 아모라가 말하는 것과 같다", () => {
  assert.match(source, /"이대로 적용"/);
});
