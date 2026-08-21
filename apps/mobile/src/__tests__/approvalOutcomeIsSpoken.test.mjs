// 파트너가 **거절한** 화면과 **승인한** 화면이 똑같으면 안 된다.
//
// 두 곳 다 같은 병이었다 — 능동 경로(사용자가 직접 승인·거절을 누른 흐름)는
// 결과를 구분해 말하는데, 수동 경로(새로고침·재조회)는 카드만 조용히 지웠다.
// 그러면 "두 사람이 확인해야 반영된다"는 경계가 "내 입력이 사라졌다"로 읽힌다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const budget = readFileSync(join(here, "../../app/budget/index.tsx"), "utf8");
const schedule = readFileSync(join(here, "../../app/schedule/index.tsx"), "utf8");
const inbox = readFileSync(join(here, "../lib/scheduleApprovalInbox.mjs"), "utf8");

test("예산: 재조회에서 거절·만료를 말한다", () => {
  // 상태를 비우는 분기 안에서 사용자에게 말해야 한다.
  const branch = budget.slice(
    budget.indexOf('pendingOutcome.status === "stale"'),
    budget.indexOf('pendingOutcome.status === "stale"') + 1400,
  );
  assert.match(branch, /Alert\.alert/u, "카드만 지우고 침묵하면 안 된다");
  assert.match(branch, /이번 변경은 반영되지 않았어요/u);
  assert.match(branch, /예산 기록이 바뀌었어요/u);
});

test("예산: 능동 경로와 같은 문구를 쓴다", () => {
  // 같은 결과를 두 경로가 다르게 말하면 사용자가 다른 일이 일어났다고 읽는다.
  for (const phrase of [
    "이번 변경은 반영되지 않았어요",
    "파트너가 동의하지 않았거나 요청이 이미 종료됐어요.",
    "예산 기록이 바뀌었어요",
  ]) {
    const count = budget.split(phrase).length - 1;
    assert.ok(count >= 2, `능동·수동 두 경로가 모두 써야 한다: ${phrase}`);
  }
});

test("일정: 받은편지함이 끝난 이유를 돌려준다", () => {
  assert.match(inbox, /resolvedOutcomes/u);
  assert.match(inbox, /resolvedOutcome:\s*\{/u);
  // 상태를 버리면 화면이 구분할 근거가 없다.
  assert.match(inbox, /status:\s*latest\.status/u);
});

test("일정: 사용자가 새로고침했을 때만 말한다", () => {
  const idx = schedule.indexOf("resolvedOutcomes");
  assert.ok(idx > 0, "화면이 resolvedOutcomes 를 읽어야 한다");
  const block = schedule.slice(idx - 400, idx + 900);
  // 백그라운드 폴링에서 모달을 띄우면 소음이다.
  assert.match(block, /!options\?\.silent/u);
  assert.match(block, /일정 변경을 반영하지 않았어요/u);
  assert.match(block, /일정 변경을 반영했어요/u);
});

test("일정: 능동 경로와 같은 문구를 쓴다", () => {
  for (const phrase of [
    "일정 변경을 반영하지 않았어요",
    "기존 일정은 그대로 유지돼요.",
    "일정 변경을 반영했어요",
  ]) {
    const count = schedule.split(phrase).length - 1;
    assert.ok(count >= 2, `능동·수동 두 경로가 모두 써야 한다: ${phrase}`);
  }
});
