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

// ─────────────────────────────────────────────────────────────────────────────
// 라운지에서 바로 확인·거절
//
// `/dashboard` 표면 요청은 모바일에서 처리할 방법이 아예 없었다 — 배지만 뜨고
// 24시간 뒤 만료됐다. 순수 로직은 위 파일이 지키고, 여기서는 **화면이 그 로직을
// 실제로 부르는지**를 본다.
// ─────────────────────────────────────────────────────────────────────────────

test("결정 줄을 그리고 두 버튼을 붙인다", () => {
  assert.match(source, /state\.awaitingDecision\.map\(/u);
  assert.match(source, /확인하고 반영/u);
  assert.match(source, /이번 요청 거절/u);
});

test("서버 계약은 라이브러리가 만든 것만 쓴다 — 화면이 경로를 지어내지 않는다", () => {
  assert.match(source, /buildPlanChangeDecisionRequest\(/u);
  assert.ok(
    !/["'`]\/api\/couple-plan-changes/u.test(source),
    "화면이 승인 경로 문자열을 직접 쓰고 있다",
  );
  assert.match(source, /apiFetchForExpectedUser\(userId, plan\.path/u);
});

// 적대적 검토가 실제로 재현한 것: `method: plan.method` 를 `method: "POST"` 로
// 고정해도 이 스위트가 11/11 초록이었다. 그 상태에서 사용자가 "이번 요청 거절"을
// 누르면 서버는 accept_couple_plan_change 를 실행해 **변경이 반영된다.**
// 경로만 고정하고 메서드를 안 보면 거절이 조용히 승인으로 나간다.
/** `decide` 콜백 본문만. 읽음 처리(`markRead`)의 POST 와 섞이면 안 된다. */
function decideBody() {
  const start = source.indexOf("const decide = useCallback(");
  assert.ok(start > -1, "decide 콜백을 찾지 못했다");
  const end = source.indexOf("const open = useCallback(", start);
  assert.ok(end > start, "decide 콜백의 끝을 찾지 못했다");
  return source.slice(start, end);
}

test("어느 결정인지가 실제로 서버로 나간다", () => {
  const body = decideBody();
  assert.match(body, /method:\s*plan\.method/u);
  assert.match(body, /body:\s*plan\.body/u);
  assert.ok(
    !/method:\s*["'`](?:POST|DELETE)["'`]/u.test(body),
    "화면이 메서드를 고정하고 있다 — 거절이 승인으로 나간다",
  );
});

test("두 버튼이 서로 다른 결정을 넘긴다", () => {
  assert.match(source, /decide\(notification, "accept"\)/u);
  assert.match(source, /decide\(notification, "reject"\)/u);
  const calls = source.match(/decide\(notification, "(accept|reject)"\)/gu) ?? [];
  assert.equal(new Set(calls).size, 2, `두 결정이 모두 있어야 한다: ${calls}`);
});

// 되돌릴 수 없는 반영 버튼 바로 위에서 요약을 자르면 **못 본 변경까지 승인한다.**
// 서버 요약은 240자까지 오고 예식일·예식장·총예산이 한 요청에 함께 담긴다.
test("결정 줄의 요약은 자르지 않는다", () => {
  const block = source.slice(
    source.indexOf("{state.awaitingDecision.map("),
    source.indexOf("{state.visible.map("),
  );
  assert.ok(block.length > 0, "결정 줄 블록을 찾지 못했다");
  assert.match(block, /styles\.rowMessage/u);
  assert.ok(
    !/styles\.rowMessage[^>]*numberOfLines/u.test(block),
    "결정 줄이 요약을 잘라 놓고 그 아래에서 반영을 받고 있다",
  );
});

// iOS 에서 `accessible` 은 그 View 를 하나의 접근성 요소로 만들어 **안에 있는
// 버튼이 VoiceOver 초점을 못 받는다.** 라벨은 읽히는데 누를 수가 없다.
test("결정 줄이 버튼을 접근성으로 삼키지 않는다", () => {
  const block = source.slice(
    source.indexOf("{state.awaitingDecision.map("),
    source.indexOf("{state.visible.map("),
  );
  assert.ok(
    !/<View[^>]*\saccessible[\s/>]/u.test(block),
    "버튼이 든 줄에 accessible 이 붙어 VoiceOver 로 누를 수 없다",
  );
  assert.match(block, /accessibilityRole="button"/u);
});

// 거절을 눌렀는데 "확인하고 반영" 자리에서 스피너가 돌면, 사용자는 반대 결정이
// 진행 중이라고 읽는다. 되돌릴 수 없는 반대 결과라 오독 비용이 크다.
test("진행 표시가 누른 버튼에 붙는다", () => {
  assert.match(source, /deciding\?\.decision === "accept"/u);
  assert.match(source, /deciding\?\.decision === "reject"/u);
});

test("반영과 거절이 서로 다른 결과를 말한다", () => {
  // 말하지 않으면 상대가 거절한 화면과 내가 반영한 화면이 똑같다.
  assert.match(source, /outcome\.kind === "applied"/u);
  assert.match(source, /outcome\.kind === "rejected"/u);
  // 원문 그대로 비교하면 줄바꿈 차이로 같은 제목이 다른 것으로 세어진다
  // (적대적 검토가 실제로 그 통과를 재현했다). 제목만 뽑는다.
  const titles = [...source.matchAll(/Alert\.alert\(\s*"([^"]+)"/gu)].map((m) => m[1]);
  assert.ok(titles.length >= 4, `결과 안내가 너무 적다: ${titles.length}`);
  const success = titles.filter((t) => !t.includes("처리하지 못했어요"));
  assert.equal(
    new Set(success).size, success.length,
    `서로 다른 결과에 같은 제목을 쓰고 있다: ${success}`,
  );
});

test("실패 문구는 서버가 준 것을 쓴다", () => {
  assert.match(source, /outcome\.message/u);
});

test("결정한 뒤 서버를 다시 읽는다", () => {
  const decide = source.slice(source.indexOf("const decide = useCallback("));
  const body = decide.slice(0, decide.indexOf("const open = useCallback("));
  assert.match(body, /await load\(\)/u, "결정 뒤 재적재가 없다 — 줄이 그대로 남는다");
});

test("두 번 누르는 것을 막는다", () => {
  assert.match(source, /disabled=\{deciding !== null\}/u);
});


// 위 선택 규칙의 **전제**를 고정한다. 예산 화면 승인함이 reviewer 를 담게 되면
// 라운지 버튼은 중복이 되므로 그때 다시 판단해야 한다.
test("예산 승인함은 아직 내가 확인할 요청을 담지 않는다 — 라운지 버튼의 근거", () => {
  const budget = readFileSync(
    path.resolve(HERE, "../lib/budgetRevision.mjs"),
    "utf8",
  );
  assert.match(budget, /row\.role === "requester"/u);
  assert.ok(
    !/row\.role === "reviewer"/u.test(budget),
    "예산 승인함이 reviewer 를 담기 시작했다 — 라운지 결정 줄과 중복인지 다시 볼 것",
  );
});
