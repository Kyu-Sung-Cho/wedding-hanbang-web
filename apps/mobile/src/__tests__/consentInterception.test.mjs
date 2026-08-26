// 동의 관문이 **루트에만** 있어서 딥링크가 지나쳐 가던 것을 막는다.
//
// 확인한 것(2026-08-25):
//   - 알림 탭은 notifications.ts 에서 /community/post/[id] 로 곧장 push 한다.
//     콜드 스타트도 포함된다(getLastNotificationResponseAsync).
//   - app.json 에 scheme·associatedDomains·https intentFilters 가 있어 웹 주소가
//     앱의 라우트를 직접 연다.
//   - 도착 화면에 관문이 없다. (tabs)/_layout.tsx 는 세션만 보고,
//     community/post/[id].tsx 는 세션을 소유권 확인에만 쓴다.
//   - 서버도 안 막는다. 동의를 요구하는 API 는 /api/onboarding 뿐이고
//     /api/community/comments 는 요구하지 않는다.
//
// 합치면: **약관에 동의한 적 없는 계정이 커뮤니티에 글을 쓸 수 있었다.**
// 동의 수집은 2026-08-22 에 들어왔으므로 그 전 계정은 전부 여기 해당한다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const gatePath = fileURLToPath(new URL("../lib/consentInterception.ts", import.meta.url));
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
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
}

const compiled = ts.transpileModule(
  [declarationsOf(consentPath), declarationsOf(gatePath)].join("\n"),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
);
const gate = new Function(
  `${compiled.outputText}\nreturn { shouldInterceptForConsent, CONSENT_INTERCEPTION_EXEMPT_PATHS, MOBILE_CONSENT_ROUTE };`,
)();

const CONSENTED = { terms_agreed: true, privacy_agreed: true };
const sessionWith = (metadata) => ({ user: { id: "u1", user_metadata: metadata } });

test("동의 기록 없는 계정이 딥링크로 온 자리를 가로챈다", () => {
  // 이것이 실제로 뚫려 있던 경로다 — 알림을 눌러 곧장 도착하는 화면.
  for (const pathname of [
    "/community/post/abc",
    "/community",
    "/budget",
    "/schedule",
    "/checklist",
    "/settings",
    "/chat",
  ]) {
    assert.equal(
      gate.shouldInterceptForConsent({ pathname, session: sessionWith({}) }),
      true,
      `${pathname} 를 통과시켰다`,
    );
  }
});

test("동의한 계정은 어디로도 그대로 간다", () => {
  for (const pathname of ["/community/post/abc", "/budget", "/"]) {
    assert.equal(
      gate.shouldInterceptForConsent({ pathname, session: sessionWith(CONSENTED) }),
      false,
      pathname,
    );
  }
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
      gate.shouldInterceptForConsent({
        pathname: "/community/post/abc",
        session: sessionWith(metadata),
      }),
      true,
      JSON.stringify(metadata),
    );
  }
});

test("동의할 방법을 막지 않는다", () => {
  // 이 화면들을 가로채면 동의할 길이 사라지고 무한 루프가 된다.
  for (const pathname of ["/login", "/signup", "/forgot-password", "/consent"]) {
    assert.equal(
      gate.shouldInterceptForConsent({ pathname, session: sessionWith({}) }),
      false,
      `${pathname} 를 가로챘다 — 여기서 갇힌다`,
    );
  }
});

test("초대 착지는 지나보낸다", () => {
  // 이 화면은 코드만 꺼내 기억하고 곧바로 루트나 로그인으로 넘긴다. 여기서
  // 가로채면 초대 코드를 잃고, 어차피 다음 자리인 루트에서 관문에 걸린다.
  assert.equal(
    gate.shouldInterceptForConsent({ pathname: "/invite", session: sessionWith({}) }),
    false,
  );
  // 실제 초대 링크는 해시를 달고 온다: hanbang://invite#WH-XXXX
  assert.equal(
    gate.shouldInterceptForConsent({ pathname: "/invite#WH-ABCD", session: sessionWith({}) }),
    false,
  );
  assert.equal(
    gate.shouldInterceptForConsent({ pathname: "/invite?code=x", session: sessionWith({}) }),
    false,
  );
});

test("모르면 가로채지 않는다", () => {
  // 세션을 못 읽었는데 가로채면 켤 때마다 동의 화면이 번쩍이고, 조회가
  // 실패하는 사람은 앱에서 나갈 길이 없다.
  assert.equal(
    gate.shouldInterceptForConsent({ pathname: "/community", session: null }),
    false,
  );
  // 로그아웃은 로그인 관문이 할 일이다.
  assert.equal(gate.shouldInterceptForConsent({ pathname: "/budget", session: null }), false);
  // 경로를 모르면 판단하지 않는다.
  for (const pathname of [null, "", undefined, 123]) {
    assert.equal(
      gate.shouldInterceptForConsent({ pathname, session: sessionWith({}) }),
      false,
      String(pathname),
    );
  }
});

test("면제 목록이 (auth) 라우트를 빠뜨리지 않는다", () => {
  // 새 인증 화면을 추가하고 목록을 잊으면 그 화면에서 갇힌다. 알려주는
  // 장치가 없으면 아무도 모른다.
  //
  // usePathname() 은 **그룹 세그먼트를 지운 값**을 준다 — (auth)/login.tsx 는
  // "/login" 이다((tabs)/_layout.tsx 가 "/community" 로 비교하는 것과 같다).
  const authDir = fileURLToPath(new URL("../../app/(auth)", import.meta.url));
  const screens = readdirSync(authDir)
    .filter((name) => name.endsWith(".tsx") && !name.startsWith("_"))
    .map((name) => `/${name.replace(/\.tsx$/u, "")}`);

  assert.ok(screens.length >= 4, `인증 화면을 못 찾았다: ${screens.length}`);
  for (const screen of screens) {
    assert.ok(
      gate.CONSENT_INTERCEPTION_EXEMPT_PATHS.includes(screen),
      `면제 목록에 ${screen} 이 없다 — 그 화면에서 갇힌다`,
    );
  }
});

// ── 배선 ─────────────────────────────────────────────────────────────
// 판정이 맞아도 붙어 있지 않으면 화면은 그대로다. 이 저장소에서 실제로
// 그런 일이 있었다(모바일에 알림 표면이 서버·API·웹까지 다 있는데 호출자가
// 0건이었다).

const layoutSource = readFileSync(
  fileURLToPath(new URL("../../app/_layout.tsx", import.meta.url)),
  "utf8",
);
const componentSource = readFileSync(
  fileURLToPath(new URL("../components/ConsentGate.tsx", import.meta.url)),
  "utf8",
);

test("루트 레이아웃이 Stack 전체를 감싼다", () => {
  assert.match(layoutSource, /import ConsentGate from "@\/components\/ConsentGate";/u);
  const opensAt = layoutSource.indexOf("<ConsentGate>");
  const stackAt = layoutSource.indexOf("<Stack");
  const stackEndsAt = layoutSource.indexOf("</Stack>");
  const closesAt = layoutSource.indexOf("</ConsentGate>");
  assert.ok(opensAt > -1, "ConsentGate 를 쓰지 않는다");
  assert.ok(opensAt < stackAt, "Stack 밖에서 감싸야 딥링크 라우트가 전부 들어온다");
  assert.ok(stackEndsAt < closesAt, "Stack 이 ConsentGate 안에 있지 않다");
});

test("화면을 막지 않고 옆으로 보낸다", () => {
  // 막으면 세션 조회가 느리거나 실패하는 사람에게 빈 화면이 남는다.
  assert.match(componentSource, /return <>\{children\}<\/>;/u);
  assert.match(componentSource, /router\.replace\(MOBILE_CONSENT_ROUTE\)/u);
});

test("내비게이터가 준비되기 전에는 보내지 않는다", () => {
  // 루트 레이아웃은 내비게이터보다 먼저 그려진다. 그 전에 replace 하면 조용히
  // 버려져 **가로채지 못한 채 통과한다.**
  assert.match(componentSource, /useRootNavigationState\(\)/u);
  assert.match(componentSource, /if \(!navigationState\?\.key\) return;/u);
});

test("세션 변화를 따라간다", () => {
  // 동의 화면은 저장한 뒤 refreshSession() 을 부르고 루트로 간다. 그 갱신을
  // 못 보면 관문이 계속 동의 화면으로 돌려보내 무한 루프가 된다.
  assert.match(componentSource, /onAuthStateChange/u);
  // INITIAL_SESSION 뒤에 도착한 getSession() 결과로 덮어쓰면 방금 갱신한 값이
  // 옛것으로 되돌아간다.
  assert.match(componentSource, /sawAuthEvent\.current/u);
  assert.match(componentSource, /subscription\.unsubscribe\(\)/u);
});
