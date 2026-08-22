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
