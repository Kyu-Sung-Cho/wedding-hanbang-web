// 앱 메인은 웨딩 라운지와 아모라 둘이다(2026-11-13 파운더 결정, 앱 구성은 같은 날 파운더 확인).
//
// - 하단 탭은 `라운지 | 아모라` 둘뿐이다.
// - 커뮤니티는 라운지의 준비 도구 칸과 내 정보에서 연다. 뒤로 가기가 있는 화면이다.
// - 내 정보는 라운지 머리줄에서 연다. 라운지를 못 불러온 화면에서도 열 수 있어야 한다
//   (설정·로그아웃이 그 안에 있다).
// - 체크리스트·일정·예산·예절 가이드·웨딩코드는 지우지 않고 라운지가 연다.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import { HOME_SERVICES } from "../lib/dashboardExperience.mjs";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(join(mobileRoot, relative), "utf8");
const exists = (relative) => existsSync(join(mobileRoot, relative));

const BACK_TO_LOUNGE =
  /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/\(tabs\)\/lounge"\)/u;

/** `<Tabs.Screen name="…" options={…} />` 를 소스 순서대로. */
function tabScreens() {
  const source = read("app/(tabs)/_layout.tsx");
  const tree = ts.createSourceFile("_layout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screens = [];
  const visit = (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && opening.tagName.getText(tree) === "Tabs.Screen") {
      const attribute = (name) => opening.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(tree) === name,
      );
      const name = attribute("name")?.initializer;
      screens.push({
        name: name && ts.isStringLiteral(name) ? name.text : null,
        options: attribute("options")?.initializer?.getText(tree) ?? "",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return screens;
}

test("the tab bar holds exactly the two main surfaces", () => {
  const screens = tabScreens();
  assert.deepEqual(screens.map((screen) => screen.name), ["lounge", "chat"]);
  const [lounge, chat] = screens;
  // 탭에는 줄임말, 읽어 주는 이름은 "웨딩 라운지"(2026-08-19 결정 그대로).
  assert.match(lounge.options, /title: "라운지"/u);
  assert.match(lounge.options, /tabBarAccessibilityLabel: "웨딩 라운지"/u);
  assert.match(chat.options, /title: "아모라"/u);
  assert.match(chat.options, /tabBarAccessibilityLabel: "아모라"/u);

  // Expo Router 는 (tabs) 폴더의 파일을 선언하지 않아도 탭으로 올린다. 폴더에 둘만 있어야 한다.
  const tabFiles = readdirSync(join(mobileRoot, "app/(tabs)"))
    .filter((file) => !file.startsWith("_"))
    .sort();
  assert.deepEqual(tabFiles, ["chat.tsx", "lounge.tsx"]);
});

test("community and 내 정보 are their own screens with a way back, not tabs", () => {
  assert.equal(exists("app/(tabs)/community.tsx"), false);
  assert.equal(exists("app/(tabs)/profile.tsx"), false);
  assert.equal(exists("app/community/index.tsx"), true);
  assert.equal(exists("app/profile.tsx"), true);

  const root = read("app/_layout.tsx");
  assert.match(root, /<Stack\.Screen name="community"/u);
  assert.match(root, /<Stack\.Screen name="profile"/u);

  // 탭이 아니므로 화면이 스스로 돌아갈 길을 가진다. 알림이나 링크로 바로 들어와 뒤가 없으면 라운지로 간다.
  assert.match(read("app/community/index.tsx"), BACK_TO_LOUNGE);
  assert.match(read("app/profile.tsx"), BACK_TO_LOUNGE);
});

test("signed-out people never land inside the tabs", () => {
  const source = read("app/(tabs)/_layout.tsx");
  // 공개 탭(커뮤니티)이 빠졌으니 로그아웃 상태의 예외도, 탭을 숨기던 값도 없다.
  assert.doesNotMatch(source, /isPublicCommunity|protectedTabHref|usePathname/u);
  assert.match(source, /if \(authStatus === "guest"\) \{\s*return <Redirect href="\/\(auth\)\/login" \/>;/u);
  assert.match(source, /로그인 상태를 확인하지 못했어요/u);
});

test("the community feed still opens without login and sets up its own viewer", () => {
  const feed = read("app/community/index.tsx");
  // 예전에는 탭 틀이 보는 사람을 정하고 바뀌면 커뮤니티를 다시 그렸다. 이제 탭 밖이라 화면이 직접 한다
  // (글 상세 화면과 같은 방식). 그러지 않으면 바로 들어온 사람의 자료가 주인 없는 칸에 남는다.
  assert.match(feed, /setCommunityCacheViewer\(/u);
  assert.match(feed, /onAuthStateChange/u);
  assert.match(feed, /<CommunityScreen key=\{viewerKey\} \/>/u);
  // 로그인 없이 읽는 길은 그대로다.
  assert.match(feed, /optionalAuthGetJson/u);
  assert.doesNotMatch(feed, /<Redirect href="\/\(auth\)\/login"/u);
});

test("내 정보 sends a signed-out person to login, but not someone whose session could not be read", () => {
  const profile = read("app/profile.tsx");
  assert.match(profile, /if \(!session\) \{\s*router\.replace\("\/\(auth\)\/login"\);\s*return;\s*\}/u);
  // 오프라인에서 토큰을 새로 받지 못하면 세션은 비고 오류가 온다. 그건 로그아웃이 아니다(탭 틀도 따로 다뤘다).
  const readError = profile.indexOf("if (sessionError) return;");
  assert.ok(readError > 0, "세션을 읽지 못한 경우를 로그아웃으로 본다");
  assert.ok(readError < profile.indexOf("if (!session) {"), "세션 오류 확인이 로그인 이동보다 늦다");
});

test("내 정보 clears the previous account's details before showing another account", () => {
  // 탭이 아니라 쌓인 화면이라, 설정에서 로그아웃하고 다른 계정으로 들어온 뒤 뒤로 가기로 다시 나타날 수 있다.
  const profile = read("app/profile.tsx");
  assert.match(
    profile,
    /shownOwnerRef\.current === owner\) return;\s*setProfile\(null\);\s*setAvatar\(null\);\s*setStats\(EMPTY_STATS\);/u,
  );
  assert.match(profile, /shownOwnerRef\.current = profile\?\.userId \?\? null;/u);
});

function sourceFiles(relative) {
  const directory = join(mobileRoot, relative);
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      files.push(...sourceFiles(join(relative, name)));
    } else if (/\.(tsx?|mjs|js)$/u.test(name)) {
      files.push(join(relative, name));
    }
  }
  return files;
}

test("nothing still points at the old tab routes", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("src")];
  assert.ok(files.length > 100, "훑을 파일을 못 찾았다. 이 검사가 헛돈다");
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /\(tabs\)\/(community|profile)/u, file);
  }
});

/** 라운지 화면에서 `if (error && !data) {` 로 시작하는 블록. */
function loungeErrorBranch() {
  const lounge = read("app/(tabs)/lounge.tsx");
  const start = lounge.indexOf("if (error && !data) {");
  assert.ok(start >= 0, "라운지 오류 화면을 찾지 못했다");
  const end = lounge.indexOf("\n  return (", start);
  assert.ok(end > start, "라운지 오류 화면의 끝을 찾지 못했다");
  return lounge.slice(start, end);
}

test("the lounge opens 내 정보 from its header, and also when the lounge could not load", () => {
  const home = read("src/components/dashboard/WeddingHomeExperience.tsx");
  assert.match(home, /accessibilityLabel="내 정보"/u);
  assert.match(home, /router\.push\("\/profile"\)/u);

  // 라운지를 못 불러오면 머리줄도 그려지지 않는다. 설정·로그아웃으로 가는 길이 그 화면에도 있어야 한다.
  const errorBranch = loungeErrorBranch();
  assert.match(errorBranch, /<LoungeProfileButton \/>/u);
  assert.match(home, /export function LoungeProfileButton/u);
});

test("the lounge opens every screen that left the tab bar or moved behind 내 정보", () => {
  const routes = HOME_SERVICES.map((service) => service.route);
  for (const route of ["/checklist", "/schedule", "/budget", "/etiquette", "/community"]) {
    assert.ok(routes.includes(route), `라운지 준비 도구 칸에 ${route} 가 없다`);
  }
  const home = read("src/components/dashboard/WeddingHomeExperience.tsx");
  assert.match(home, /case "\/etiquette":\s*router\.push\("\/etiquette"\);/u);
  assert.match(home, /case "\/community":\s*router\.push\("\/community"\);/u);
  assert.match(home, /router\.push\("\/wedding-code"\)/u);
});
