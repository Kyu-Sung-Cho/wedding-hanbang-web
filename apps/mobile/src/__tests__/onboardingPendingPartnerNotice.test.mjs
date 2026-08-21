// 서버가 200 안에서 "상대의 확인을 기다린다"고 말했는데 앱이 침묵하면,
// 나중에 합류한 사람은 결혼 날짜를 입력하고도 아무 말을 못 듣고 홈은 계속
// "결혼식 날짜를 알려주세요"라고 말한다. 두 사람이 확인해야 반영된다는
// 제품의 약속이 **데이터 유실로 읽힌다.**
//
// 웹은 이 값을 이미 읽어 안내하고 있었고 모바일만 버리고 있었다 — 정본이
// "주 제품"이라 부르는 쪽이 침묵한 상태였다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { describeOnboardingSubmitNotice } from "../lib/onboardingFlow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(here, "../../app/onboarding/index.tsx"), "utf8");
/**
 * 판정과 문구는 화면이 아니라 흐름 모듈에 있다(`describeOnboardingSubmitNotice`).
 *
 * 처음 이 테스트는 화면 파일만 읽었다. 그 뒤 같은 로직이 흐름 모듈로 옮겨가면서
 * 다섯 개가 전부 실패했는데, **동작이 바뀐 게 아니라 코드가 이사한 것**이었다
 * (제목 두 개·본문 줄·`\n\n` 결합·조건까지 글자 단위로 같다).
 *
 * 그래서 "모바일 온보딩 표면"을 두 파일의 합으로 본다. 어디에 적혀 있는지가 아니라
 * **모바일이 그 말을 하는지**가 이 테스트가 지키려는 것이다.
 */
const flow = readFileSync(join(here, "../lib/onboardingFlow.mjs"), "utf8");
const onboarding = `${screen}\n${flow}`;
const webOnboarding = readFileSync(
  join(here, "../../../web/src/app/(auth)/onboarding/page.tsx"),
  "utf8",
);

/**
 * 아래 둘은 원래 소스에서 `planChange.summary` 같은 글자를 찾았다. 판정이 흐름
 * 모듈로 옮겨가면서 그 글자가 사라졌는데(일반 필드 접근자로 읽는다) **동작은 그대로**라,
 * 글자 대신 **실제로 불러서** 본다. 이쪽이 원래 의도에 더 가깝고 더 세다 —
 * 글자만 맞고 값이 안 실려도 통과하던 것을 막는다.
 */
test("모바일이 planChange.status 를 읽는다", () => {
  const notice = describeOnboardingSubmitNotice({
    planChange: { status: "pending_partner", summary: "결혼 예정일을 2027-05-15로" },
  });
  assert.ok(notice, "승인 대기를 알려야 한다");
  assert.match(notice.message, /결혼 예정일을 2027-05-15로/u, "서버가 준 요약을 그대로 보여준다");

  // 반대편: 대기가 아니면 아무 말도 만들지 않는다.
  assert.equal(
    describeOnboardingSubmitNotice({ planChange: { status: "applied", summary: "무시" } }),
    null,
  );
});

test("모바일이 routineProgress 지연도 읽는다", () => {
  const notice = describeOnboardingSubmitNotice({
    routineProgress: { status: "deferred", message: "준비 현황은 나중에 저장할게요" },
  });
  assert.ok(notice, "미뤄진 입력을 알려야 한다");
  assert.match(notice.message, /준비 현황은 나중에 저장할게요/u);

  assert.equal(
    describeOnboardingSubmitNotice({ routineProgress: { status: "applied", message: "무시" } }),
    null,
  );
});

/**
 * `if (notice) { ... }` 안쪽만 정확히 떼어낸다.
 *
 * 처음에는 호출 지점부터 900자를 잘라 그 안에 `return;`이 있는지 봤다. **그 판은
 * `return;`을 지워도 통과했다** — 창이 넓어 뒤쪽 코드의 다른 `return;`을 집었기 때문이다.
 * 화면 소스를 글자로 검사할 때는 창을 넓게 잡는 순간 "본문"이 아니라 "주변"을 재게 된다.
 */
function noticeBranch(source) {
  const at = source.indexOf("describeOnboardingSubmitNotice(data)");
  if (at < 0) return null;
  const open = source.indexOf("{", source.indexOf("if (notice)", at));
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

test("안내를 본 뒤에만 다음 화면으로 넘어간다", () => {
  // 안내를 띄우고 곧바로 이동하면 사용자는 문구를 못 읽는다. 다음 화면으로 가는 일은
  // Alert 버튼의 onPress 에만 걸려 있어야 하고, 안내를 띄운 갈래는 거기서 멈춰야 한다.
  const branch = noticeBranch(screen);
  assert.ok(branch, "제출 응답을 읽어 안내를 띄우는 갈래가 있어야 한다");

  assert.match(branch, /Alert\.alert\(/u, "안내 Alert 가 있어야 한다");
  assert.match(
    branch,
    /onPress:\s*\w+/u,
    "다음 화면으로 가는 일은 확인 버튼에 걸려 있어야 한다",
  );
  assert.match(
    branch,
    /return;/u,
    "안내를 띄운 갈래는 멈춰야 한다 — 안 멈추면 문구를 읽기 전에 화면이 넘어간다",
  );
  // 확인을 누르지 않고 바깥을 눌러 닫으면 안내를 못 읽은 채 넘어간다.
  assert.match(branch, /cancelable:\s*false/u, "안내는 바깥을 눌러 닫을 수 없어야 한다");
});

test("승인 대기를 실패처럼 말하지 않는다", () => {
  // "오류"/"실패" 로 말하면 정상 동작인 승인 경계가 사고로 읽힌다.
  assert.match(onboarding, /파트너 확인을 요청했어요/u);
  assert.match(onboarding, /두 사람이 모두 확인하면 자동으로 반영됩니다/u);
  assert.ok(
    !/Alert\.alert\(\s*"오류",\s*[^)]*pending_partner/u.test(onboarding),
    "승인 대기를 오류로 띄우면 안 된다",
  );
});

test("웹과 같은 문구를 쓴다", () => {
  // 두 표면이 같은 상태를 다르게 말하면 커플이 서로 다른 것을 본다.
  for (const phrase of [
    "파트너 확인을 요청했어요",
    "아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.",
    "저장되지 않은 입력이 있어요",
  ]) {
    assert.ok(webOnboarding.includes(phrase), `웹에 없는 문구: ${phrase}`);
    assert.ok(onboarding.includes(phrase), `모바일에 없는 문구: ${phrase}`);
  }
});
