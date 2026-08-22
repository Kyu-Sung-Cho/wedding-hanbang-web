import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 이 배선이 빠지면 **기능이 조용히 죽는다.** 순수 로직 테스트로는 잡히지 않아서
// 소스에 대고 확인한다.
//
// 적대적 검토가 실제 auth-js 로 재현한 것: 구독 직후 도착하는 첫 auth 이벤트는
// `sessionUserId.current` 가 아직 null 이라 **계정 전환으로 읽힌다.** 그 경로가
// 최초 적재를 abort 하고 화면을 비우는데, 다시 부를 트리거가 없으면 앱을 켜고
// 라운지에 머무는 사람 — 이 기능의 주 대상 — 은 알림을 한 번도 못 본다.
// (`TodayOneCareCard` 가 같은 이유로 `authGeneration` 을 쓴다.)

const HERE = path.dirname(fileURLToPath(import.meta.url));

const source = readFileSync(
  path.resolve(HERE, "../components/lounge/PartnerChangeNotice.tsx"),
  "utf8",
);

test("auth 이벤트 뒤에 다시 불러올 트리거가 있다", () => {
  assert.match(source, /setAuthGeneration\(\(generation\) => generation \+ 1\)/u);
});

/** useFocusEffect(useCallback(..., [ ... ])) 의 의존 목록. */
function focusEffectDeps() {
  // import 구문("useFocusEffect }")이 아니라 **호출부**를 잡아야 한다.
  const callSite = source.indexOf("useFocusEffect(");
  assert.ok(callSite > -1, "useFocusEffect 호출부가 없다");
  const after = source.slice(callSite);
  const start = after.indexOf("}, [");
  assert.ok(start > -1, "useFocusEffect 안에서 의존 목록을 찾지 못했다");
  const end = after.indexOf("]", start);
  return after.slice(start + 3, end + 1);
}

test("그 트리거가 실제로 재적재를 건다 — useFocusEffect 의존 목록에 있다", () => {
  assert.ok(
    focusEffectDeps().includes("authGeneration"),
    `의존 목록에 authGeneration 이 없다 — 첫 이벤트가 적재를 끊고 끝난다: ${focusEffectDeps()}`,
  );
});

test("라운지 새로고침이 이 카드에도 닿는다", () => {
  assert.ok(
    focusEffectDeps().includes("refreshVersion"),
    `의존 목록에 refreshVersion 이 없다 — 당겨서 새로고침이 이 카드만 건너뛴다: ${focusEffectDeps()}`,
  );
});

test("라운지가 그 값을 실제로 넘긴다", () => {
  const lounge = readFileSync(
    path.resolve(HERE, "../../app/(tabs)/lounge.tsx"),
    "utf8",
  );
  assert.match(lounge, /<PartnerChangeNotice\s+refreshVersion=\{[a-zA-Z]+\}\s*\/>/u);
});

test("요청이 시작 시점 사용자에게 묶인다", () => {
  // 계정을 바꾼 뒤 늦게 도착한 응답이 다른 사람의 알림을 그리면 안 된다.
  assert.match(source, /apiFetchForExpectedUser/u);
  assert.ok(
    !/[^r]\bapiFetch\(/u.test(source),
    "세션에 묶이지 않은 apiFetch 를 쓰고 있다",
  );
});
