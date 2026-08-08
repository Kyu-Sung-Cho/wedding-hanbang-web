import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { createOwnerCoupleSessionFence } from "../lib/ownerCoupleSessionFence.mjs";

// P0-4: 아모라 기억 화면은 요청 시작 시점의 사용자를 고정하지 않는다. 응답이 오면
// 현재 사용자가 누구든 무조건 state에 반영하므로, A의 느린 기억 응답이 계정 전환 뒤
// B 화면에 그대로 들어갈 수 있다. 예약·예산·일정·커뮤니티 8개 화면은 이미
// `createOwnerCoupleSessionFence` + `ForExpectedUser` 경로를 쓰는데 이 화면만 빠졌다.
//
// 근거: docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §8 P0-4 — `apps/mobile/app/settings/amora-memory.tsx:77-102`,
// `apps/mobile/src/lib/api.ts:122-152`, `:196-209`.
//
// 실제 사용자 기억 대신 synthetic marker만 쓴다.

const OWNER_A = "10000000-0000-4000-8000-0000000000a1";
const OWNER_B = "10000000-0000-4000-8000-0000000000b2";
const COUPLE_A = "50000000-0000-4000-8000-0000000000a1";
const COUPLE_B = "50000000-0000-4000-8000-0000000000b2";

/** A 계정의 기억 원문 자리. B 화면 state에 단 한 번도 나타나면 안 된다. */
const SYNTHETIC_A_MEMORY_MARKER = "SYNTHETIC-P04-ACCOUNT-A-MEMORY-DO-NOT-SHOW-TO-B";

const MEMORY_SCREEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/settings/amora-memory.tsx",
);

/**
 * 화면의 load 커밋 규칙을 최소 형태로 모사한다. 실제 화면은 여기에 sequence와
 * React state가 더 붙지만, 지켜야 하는 불변식은 "현재 identity가 아니면 어떤
 * 응답도 적용하지 않는다" 하나다.
 */
function createMemoryScreenState() {
  let applied = null;
  return {
    applyIfCurrent(fence, token, payload) {
      if (!fence.isCurrent(token)) return false;
      applied = payload;
      return true;
    },
    seal() {
      applied = null;
    },
    get current() {
      return applied;
    },
    containsMarker(marker) {
      return JSON.stringify(applied ?? null).includes(marker);
    },
  };
}

test("a late Amora memory response from account A never reaches account B's screen", async () => {
  const fence = createOwnerCoupleSessionFence();
  const screen = createMemoryScreenState();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const tokenA = fence.capture();
  assert.ok(tokenA);

  let releaseResponse;
  const pendingMemoryLoad = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const load = pendingMemoryLoad.then(() => screen.applyIfCurrent(fence, tokenA, {
    memories: [{ id: "m1", value: SYNTHETIC_A_MEMORY_MARKER }],
  }));

  // 응답이 도착하기 전에 B로 계정 전환.
  fence.setOwner(OWNER_B);
  fence.setIdentity(OWNER_B, COUPLE_B);
  releaseResponse();
  const committed = await load;

  assert.equal(committed, false);
  assert.equal(screen.current, null);
  assert.equal(screen.containsMarker(SYNTHETIC_A_MEMORY_MARKER), false);
});

test("signing out to guest also invalidates a pending Amora memory load", async () => {
  const fence = createOwnerCoupleSessionFence();
  const screen = createMemoryScreenState();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const tokenA = fence.capture();

  let releaseResponse;
  const pendingMemoryLoad = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const load = pendingMemoryLoad.then(() => screen.applyIfCurrent(fence, tokenA, {
    memories: [{ id: "m1", value: SYNTHETIC_A_MEMORY_MARKER }],
  }));

  fence.setOwner(null);
  releaseResponse();

  assert.equal(await load, false);
  assert.equal(screen.containsMarker(SYNTHETIC_A_MEMORY_MARKER), false);
});

test("a same-owner couple switch invalidates every captured memory identity", () => {
  const fence = createOwnerCoupleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const coupleAToken = fence.capture();
  assert.ok(coupleAToken);

  assert.equal(fence.setIdentity(OWNER_A, COUPLE_B), true);
  assert.equal(fence.isCurrent(coupleAToken), false);
  assert.deepEqual(fence.capture(), {
    generation: coupleAToken.generation + 1,
    ownerId: OWNER_A,
    coupleId: COUPLE_B,
  });
});

test("an unlinked couple leaves no committable memory identity", () => {
  const fence = createOwnerCoupleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const linkedToken = fence.capture();

  assert.equal(fence.clearCouple(OWNER_A), true);
  assert.equal(fence.isCurrent(linkedToken), false);
  assert.equal(fence.capture(), null);
});

/**
 * 실패할 때 화면 소스 전체를 덤프하지 않고 무엇이 빠졌는지만 알린다.
 * `assert.match`는 7,000자 넘는 파일을 그대로 출력해 원인을 덮어버린다.
 */
function assertScreenContract(source, { label, pattern, present = true }) {
  const found = pattern.test(source);
  assert.ok(
    found === present,
    present
      ? `아모라 기억 화면에 없음: ${label} (${pattern})`
      : `아모라 기억 화면에 남아 있으면 안 됨: ${label} (${pattern})`,
  );
}

test("the Amora memory screen fences its load and clears account-bound state on auth changes", () => {
  const source = readFileSync(MEMORY_SCREEN_PATH, "utf8");

  for (const requirement of [
    // 요청 시작 identity를 고정하고, 응답 커밋 직전에 다시 확인한다.
    { label: "요청 시작 identity 고정", pattern: /createOwnerCoupleSessionFence/ },
    { label: "응답 커밋 전 재확인", pattern: /isLoadCommitCurrent/ },
    // 계정 전환을 렌더 뒤가 아니라 구독으로 즉시 감지하고 화면을 봉인한다.
    { label: "계정 전환 즉시 감지", pattern: /onAuthStateChange/ },
    { label: "계정 전환 시 화면 봉인", pattern: /clearIdentityBoundState/ },
    // bearer 소유자가 다르면 네트워크 요청 자체를 보내지 않는다.
    { label: "expectedUser 결박 요청", pattern: /ForExpectedUser/ },
    // 로그아웃은 커밋 가능한 identity를 남기지 않는다.
    { label: "로그아웃 시 identity 폐기", pattern: /setOwner\(null\)/ },
    // 기억은 커플 범위이므로 커플 전환도 같은 fence로 무효화한다.
    { label: "커플 전환도 fence 대상", pattern: /couple_id/ },
    // expectedUser를 우회하는 맨 apiJson 호출이 남아 있으면 안 된다.
    { label: "결박 없는 apiJson 호출", pattern: /(?<![\w.])apiJson\s*[<(]/, present: false },
  ]) {
    assertScreenContract(source, requirement);
  }
});
