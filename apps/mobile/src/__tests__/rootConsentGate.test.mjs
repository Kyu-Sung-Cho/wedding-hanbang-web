// 모바일은 웹과 다른 콜백(/auth/mobile-callback)을 써서, 웹의 동의 관문
// (/api/auth/callback · AuthenticatedAppShell)에 닿지 않는다.
//
// 그런데 /api/onboarding 은 모든 클라이언트에 동의를 요구한다. 이 관문이
// 없으면 모바일 소셜 사용자는 온보딩 제출에서 "동의해야 시작할 수 있어요"만
// 반복해서 보고 나갈 길이 없다 — 웹 관문을 붙이면서 내가 만든 함정이다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const gatePath = fileURLToPath(new URL("../lib/rootDestination.ts", import.meta.url));
// 동의 판정은 웹과 같은 공유 계약이다. 스텁을 끼우면 이 테스트가 지키는 것이
// 실제 판정이 아니라 스텁이 된다 — 계약 원문을 함께 컴파일해 넣는다.
const consentPath = fileURLToPath(
  new URL("../../../../packages/shared/src/contracts/signupConsent.ts", import.meta.url),
);

function declarationsOf(path) {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) =>
      statement.getFullText(sourceFile).replace(/\bexport\s+/g, "")
    )
    .join("\n");
}

function loadGate() {
  const declarations = [declarationsOf(consentPath), declarationsOf(gatePath)].join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    `${compiled.outputText}\nreturn { resolveRootDestination, rootGateNeedsProfile };`,
  )();
}

const gate = loadGate();

const CONSENTED = { terms_agreed: true, privacy_agreed: true };
const sessionWith = (metadata) => ({ user: { id: "u1", user_metadata: metadata } });

test("세션이 없으면 로그인으로", () => {
  assert.equal(
    gate.resolveRootDestination({ session: null, profile: null }),
    "login",
  );
});

test("동의 기록이 없으면 온보딩이 아니라 동의 화면으로", () => {
  // 온보딩으로 보내면 제출에서 400 을 맞고 나갈 길이 없다.
  assert.equal(
    gate.resolveRootDestination({ session: sessionWith({}), profile: null }),
    "consent",
  );
});

test("온보딩을 마친 계정이라도 동의 기록이 없으면 동의 화면으로", () => {
  // 동의 기록이 생기기 전에 만들어진 옛 계정이 여기 해당한다.
  assert.equal(
    gate.resolveRootDestination({
      session: sessionWith({ name: "소셜 사용자" }),
      profile: { onboarding_completed: true },
    }),
    "consent",
  );
});

test("한쪽만 동의한 기록은 동의로 치지 않는다", () => {
  for (const metadata of [
    { terms_agreed: true },
    { privacy_agreed: true },
    { terms_agreed: true, privacy_agreed: false },
    { terms_agreed: "true", privacy_agreed: "true" },
    { marketing_agreed: true },
  ]) {
    assert.equal(
      gate.resolveRootDestination({
        session: sessionWith(metadata),
        profile: { onboarding_completed: true },
      }),
      "consent",
      JSON.stringify(metadata),
    );
  }
});

test("동의한 계정은 온보딩 여부로 갈린다", () => {
  assert.equal(
    gate.resolveRootDestination({ session: sessionWith(CONSENTED), profile: null }),
    "onboarding",
  );
  assert.equal(
    gate.resolveRootDestination({
      session: sessionWith(CONSENTED),
      profile: { onboarding_completed: false },
    }),
    "onboarding",
  );
  assert.equal(
    gate.resolveRootDestination({
      session: sessionWith(CONSENTED),
      profile: { onboarding_completed: true },
    }),
    "dashboard",
  );
});

test("동의 전에는 프로필을 읽지 않는다", () => {
  // 어차피 동의 화면으로 가는데 조회하면 왕복이 늘고, 그 조회가 실패하면
  // 관문에 닿기도 전에 오류 화면으로 새어 나간다.
  assert.equal(gate.rootGateNeedsProfile(null), false);
  assert.equal(gate.rootGateNeedsProfile(sessionWith({})), false);
  assert.equal(gate.rootGateNeedsProfile(sessionWith({ terms_agreed: true })), false);
  assert.equal(gate.rootGateNeedsProfile(sessionWith(CONSENTED)), true);
});

// ── 동의 화면 자체의 계약 ─────────────────────────────────────────────
// React Native 화면은 node --test 로 렌더할 수 없다. 대신 이 화면이 반드시
// 지켜야 하는 세 가지를 원문에서 확인한다.

const screenSource = readFileSync(
  fileURLToPath(new URL("../../app/(auth)/consent.tsx", import.meta.url)),
  "utf8",
);

test("동의 화면이 payload 를 손으로 짓지 않고 공유 빌더를 쓴다", () => {
  assert.match(screenSource, /buildSignupConsentSubmission\(consent\)/);
  // 손으로 지으면 웹과 갈라져 서버가 못 읽는다.
  for (const handwritten of ["termsAgreed:", "privacyAgreed:"]) {
    assert.equal(
      screenSource.includes(handwritten),
      false,
      `${handwritten} 를 손으로 짓고 있다`,
    );
  }
});

test("항목 목록도 공유 계약에서 가져온다", () => {
  // 라벨을 여기 복제하면 웹과 다른 말을 하게 된다.
  assert.match(screenSource, /SIGNUP_CONSENT_ITEMS\.map/);
  assert.equal(screenSource.includes('label: "이용약관 동의"'), false);
});

test("저장한 뒤 세션을 갱신하고 나서 이동한다", () => {
  // 로컬 세션이 옛 메타데이터를 들고 있으면 루트 게이트가 이 화면으로 다시
  // 돌려보내 **무한 루프**가 된다.
  const refreshAt = screenSource.indexOf("refreshSession()");
  const navigateAt = screenSource.indexOf('router.replace("/")');
  assert.ok(refreshAt > -1, "refreshSession 호출이 없다");
  assert.ok(navigateAt > -1, 'router.replace("/") 호출이 없다');
  assert.ok(refreshAt < navigateAt, "갱신보다 이동이 먼저다 — 무한 루프가 된다");
});

test("동의하지 않고 나갈 길이 있다", () => {
  // 거절할 수 있어야 동의가 동의다.
  assert.match(screenSource, /동의하지 않고 로그아웃/);
  assert.match(screenSource, /signOut\(/);
});

// ── 동의를 **받지 않는** 화면 ─────────────────────────────────────────
// 2026-08-25 파운더 지적: "동의 얻는거 왜 로그인 전에 나와?"
//
// 로그인 화면에 "계속하면 이용약관과 개인정보처리방침에 동의하는 것으로
// 간주됩니다"가 있었다. 두 가지가 잘못됐다.
//
//   1. 받는 자리가 아니다. 이 화면에 선 사람은 아직 로그인하지 않았다.
//   2. 곧 거짓이 된다. 소셜로 계정이 막 만들어진 사람은 바로 다음 화면에서
//      (auth)/consent 를 만나 항목별로 체크한다 — 위 테스트들이 고정하는
//      바로 그 관문이다. 앱이 두 말을 하는 셈이고, 기록이 없으므로 관문
//      쪽이 진실이다.
//
// 동의는 **가입 화면**과 **동의 관문** 두 곳에서만 받는다.

const loginSource = readFileSync(
  fileURLToPath(new URL("../../app/(auth)/login.tsx", import.meta.url)),
  "utf8",
);

/**
 * 주석을 걷어낸 소스.
 *
 * 아래 검사는 **사용자가 읽는 문구**를 보는데, 원문을 그대로 보면 "왜 이
 * 문장을 쓰지 않는가"를 설명하는 주석이 금지어에 걸려 잘못된 빨간불이 난다.
 * 실제로 이 저장소에서 2026-08-23 에 그렇게 났다.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

test("로그인 화면은 동의를 받지도, 받았다고 말하지도 않는다", () => {
  const visible = withoutComments(loginSource);
  for (const claim of ["간주", "동의하는 것으로", "동의한 것으로", "동의로 봅니다"]) {
    assert.equal(
      visible.includes(claim),
      false,
      `로그인 화면이 동의를 주장한다: ${claim}`,
    );
  }
  // 체크박스를 옮겨 오는 것도 답이 아니다 — 여기서 받으면 계정이 없다.
  assert.equal(visible.includes("SIGNUP_CONSENT_ITEMS"), false);
  assert.equal(visible.includes("buildSignupConsentSubmission"), false);
});

test("대신 약관·처리방침을 읽을 수는 있다", () => {
  // 주장하지 않는 것과 감추는 것은 다르다. 로그인을 결정하기 전에 무엇에
  // 묶이는지 확인하려는 사람에게는 이 링크가 필요하다.
  const visible = withoutComments(loginSource);
  assert.match(visible, /<Text style=\{styles\.policyLink\}>이용약관<\/Text>/u);
  assert.match(visible, /<Text style=\{styles\.policyLink\}>개인정보 처리방침<\/Text>/u);

  // 주소를 손으로 짓지 않는다. siteUrl 헬퍼는 운영에서 EXPO_PUBLIC_SITE_URL
  // 이 없거나 안전하지 않으면 던진다 — 하드코딩하면 그 보호가 사라진다.
  assert.match(loginSource, /buildMobileSiteUrl\("\/terms", siteOrigin\)/u);
  assert.match(loginSource, /buildMobileSiteUrl\("\/privacy", siteOrigin\)/u);
  assert.equal(loginSource.includes('"https://hanbang.ai/terms"'), false);
});

test("링크를 감싼 View 가 스크린리더에서 버튼을 삼키지 않는다", () => {
  // 이 저장소에서 실제로 있었던 일이다 — accessible 한 단어가 자식 Pressable 을
  // 삼켜 VoiceOver 로는 누를 수 없게 됐다.
  // 구간을 "styles.policyLinks" 에서 시작하면 닮는다 — accessible 은 그보다
  // **앞**인 여는 태그 안에 붙기 때문이다. 실제로 이 검사를 처음 썼을 때
  // 그랬고, 변형(<View accessible style={styles.policyLinks}>)을 심었는데
  // 초록불이었다. 여는 태그부터 잎는다.
  const at = loginSource.indexOf("styles.policyLinks");
  assert.ok(at > -1, "policyLinks 블록이 없다");
  const opensAt = loginSource.lastIndexOf("<View", at);
  assert.ok(opensAt > -1, "여는 태그를 못 찾았다");
  const block = loginSource.slice(opensAt, at + 900);
  assert.equal(/\baccessible\b(?!\w)/u.test(block), false, "accessible 이 자식을 삼킨다");
  assert.equal((block.match(/accessibilityRole="link"/gu) ?? []).length, 2);
});
