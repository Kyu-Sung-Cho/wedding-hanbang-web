// 안드로이드에서 초대 링크가 앱을 연다 — 매니페스트가 그 주소를 받겠다고 선언해야 한다.
//
// 파트너에게 보내는 링크와 QR은 `https://hanbang.ai/invite#WH-...` 하나다
// (`packages/shared/src/contracts/coupleInviteLink.ts`). iOS는 도메인 쪽 증명서
// (`apple-app-site-association`)의 `paths`가 `/invite`를 앱에 넘긴다. Android는 반대로
// **어떤 주소를 열지를 앱 매니페스트가** 정한다(`assetlinks.json`은 패키지만 증명한다).
//
// 그런데 `app.json`의 `intentFilters`에는 `/app`만 있었다. 그래서 안드로이드에서 초대 링크를
// 누르면 앱이 깔려 있어도 브라우저가 열렸고, iOS와 안드로이드가 같은 링크에 다르게 반응했다.
//
// 이 파일이 지키는 것:
//   1) 초대 착지 경로(공유 계약의 정본 값)를 https·hanbang.ai·autoVerify로 받는 필터가 있다.
//   2) iOS에 넘기는 경로는 안드로이드도 전부 받는다 — 두 플랫폼이 같은 링크에 같게 반응한다.
//   3) 그 필터가 초대 밖의 웹 주소까지 삼키지 않는다 — 넓은 prefix는 웹 페이지를 앱으로 빼앗는다.
//   4) 그 경로를 받을 화면이 앱에 실제로 있다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function compileCommonJs(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(module.exports, module, (name) => {
    throw new Error(`unexpected dependency: ${name}`);
  });
  return module.exports;
}

const appJson = JSON.parse(readSource("../../app.json")).expo;

/** 공유 계약이 정한 착지 경로. 값을 이 테스트에 베껴 적지 않는다. */
const landingPath = /export const COUPLE_INVITE_LANDING_PATH = "([^"]+)" as const;/.exec(
  readSource("../../../../packages/shared/src/contracts/coupleInviteLink.ts"),
)?.[1];

/** iOS 쪽 증명서가 앱에 넘기는 경로(웹이 서빙하는 AASA의 정본). */
const { APPLE_APP_LINK_PATHS, NATIVE_APP_ID } = compileCommonJs(
  readSource("../../../web/src/lib/appLinks/appLinkIdentity.ts"),
);

/** 검증되는(autoVerify) https 필터 중 hanbang.ai 를 받는 data 항목만. */
function verifiedHanbangData() {
  const filters = appJson.android?.intentFilters ?? [];
  return filters
    .filter((filter) =>
      filter.action === "VIEW"
      && filter.autoVerify === true
      && filter.category?.includes("BROWSABLE")
      && filter.category?.includes("DEFAULT"))
    .flatMap((filter) => filter.data ?? [])
    .filter((entry) => entry.scheme === "https" && entry.host === "hanbang.ai");
}

/** 안드로이드가 이 경로를 앱에 넘기는가. `path`는 완전일치, `pathPrefix`는 접두 일치다. */
function androidOpens(pathname) {
  return verifiedHanbangData().some((entry) =>
    (typeof entry.path === "string" && entry.path === pathname)
    || (typeof entry.pathPrefix === "string" && pathname.startsWith(entry.pathPrefix)));
}

test("the invite landing path is read from the shared contract", () => {
  assert.equal(landingPath, "/invite", "공유 계약에서 초대 착지 경로를 읽지 못했다");
  assert.ok(APPLE_APP_LINK_PATHS.includes(landingPath), "iOS가 넘기는 경로에 초대 착지가 없다");
});

test("Android hands the invite link to the app with a verified https filter", () => {
  assert.ok(
    androidOpens(landingPath),
    `app.json 의 intentFilters 가 https://hanbang.ai${landingPath} 를 받지 않는다 — 안드로이드에서 초대 링크가 브라우저로 열린다`,
  );
});

test("every path iOS gives the app, Android gives it too", () => {
  for (const pathname of APPLE_APP_LINK_PATHS) {
    assert.ok(androidOpens(pathname), `iOS는 ${pathname} 를 앱에 넘기는데 안드로이드는 넘기지 않는다`);
  }
});

test("the invite filter does not swallow other web pages", () => {
  // 초대 착지 밖의 주소가 앱으로 빨려 들어가면, 앱에 그 화면이 없어 빈 화면을 만난다.
  for (const pathname of ["/", "/landing", "/invitation", "/inviter", "/price", "/wedding/lounge"]) {
    assert.equal(androidOpens(pathname), false, `${pathname} 까지 앱이 가져간다`);
  }
  for (const entry of verifiedHanbangData()) {
    assert.ok(
      entry.pathPrefix !== "/" && entry.pathPrefix !== "" && entry.pathPattern === undefined,
      `너무 넓은 data 항목: ${JSON.stringify(entry)}`,
    );
  }
});

test("the release link filter for /app is kept", () => {
  // 출시 준비 점검(`scripts/mobile-release-readiness.mjs`)이 이 필터를 요구한다.
  assert.ok(androidOpens("/app"), "/app 필터가 사라졌다");
});

test("the app has a real screen for the invite path, and the package the domain certifies", () => {
  assert.ok(existsSync(fileURLToPath(new URL(`../../app${landingPath}.tsx`, import.meta.url))));
  // 매니페스트를 고쳐도 도메인 쪽 증명서가 다른 패키지를 증명하면 검증은 조용히 실패한다.
  assert.equal(NATIVE_APP_ID, appJson.android.package);
  assert.ok(appJson.ios.associatedDomains.includes("applinks:hanbang.ai"));
});
