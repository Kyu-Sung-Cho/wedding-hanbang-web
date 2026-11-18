// 앱 하단 메뉴(2026-11-13 파운더 결정은 `라운지 | 아모라` 둘이었다).
//
// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)가 그것을 뒤집는다:
// - 하단 메뉴는 아티팩트의 떠 있는 알약 넷이다: 홈 · 아모라와 대화 · 준비 순서 · 일정(`HOME_COPY.nav`).
// - 커뮤니티와 내 정보는 여전히 탭이 아니다. 뒤로 가기가 있는 화면이다.
// - 내 정보는 홈 오른쪽 위 머리글자에서 연다. 홈을 못 불러온 화면에서도 열 수 있어야 한다
//   (설정·로그아웃·탈퇴가 그 안에 있다).
// - 체크리스트·일정·예산·예절 가이드는 지우지 않는다. 홈의 준비 도구 격자는 없어졌고, 내 정보와
//   공유 할 일(아모라 대화 머리)이 그 화면들을 연다.
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

// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 메뉴 넷, 아티팩트의 순서와 이름 그대로.
test("the tab bar holds exactly the artifact's four destinations", () => {
  const screens = tabScreens();
  assert.deepEqual(screens.map((screen) => screen.name), ["lounge", "chat", "journey", "schedule"]);
  const [lounge, chat, journey, schedule] = screens;
  // 화면 제목은 아티팩트의 메뉴 이름(`HOME_COPY.nav`)을 그대로 읽는다. 화면 파일에 다시 적지 않는다.
  assert.match(lounge.options, /title: HOME_COPY\.nav\.home/u);
  assert.match(chat.options, /title: HOME_COPY\.nav\.chat/u);
  assert.match(journey.options, /title: HOME_COPY\.nav\.journey/u);
  assert.match(schedule.options, /title: HOME_COPY\.nav\.schedule/u);

  // 메뉴는 기본 탭바가 아니라 아티팩트의 떠 있는 알약이다(칸·아이콘·읽어 주는 이름은 InvitationTabBar 가 든다).
  const layout = read("app/(tabs)/_layout.tsx");
  assert.match(layout, /tabBar=\{\(props\) => \{/u);
  assert.match(layout, /<InvitationTabsBar\b/u);
  assert.match(layout, /onSelect=\{\(screen\) => props\.navigation\.navigate\(screen\)\}/u);
  // 탭 화면 이름 ↔ 메뉴 칸 표는 하나다.
  const routes = read("src/lib/invitationRoutes.mjs");
  assert.match(routes, /home: "lounge",\s*chat: "chat",\s*journey: "journey",\s*status: "schedule",/u);

  // Expo Router 는 (tabs) 폴더의 파일을 선언하지 않아도 탭으로 올린다. 폴더에 넷만 있어야 한다.
  const tabFiles = readdirSync(join(mobileRoot, "app/(tabs)"))
    .filter((file) => !file.startsWith("_"))
    .sort();
  assert.deepEqual(tabFiles, ["chat.tsx", "journey.tsx", "lounge.tsx", "schedule.tsx"]);
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

test("the home opens 내 정보 from its header, and also when the home could not load", () => {
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 홈 머리는 아티팩트의 워드마크와 두 사람
  // 머리글자다. 내 정보(설정·로그아웃·탈퇴)는 그 머리글자 묶음이 연다 — 모양은 바꾸지 않고 누를 수 있게만 한다.
  const lounge = read("app/(tabs)/lounge.tsx");
  assert.match(lounge, /label: "내 정보",/u);
  assert.match(lounge, /peopleAction=\{\{ \.\.\.PROFILE_ACTION, onPress: \(\) => router\.push\("\/profile"\) \}\}/u);
  const home = read("src/components/invitation/InvitationHome.tsx");
  assert.match(home, /accessibilityRole="button"\s*accessibilityLabel=\{peopleAction\.label\}/u);

  // 홈을 못 불러오면 머리글자도 그려지지 않는다. 설정·로그아웃으로 가는 길이 그 화면에도 있어야 한다.
  const errorBranch = loungeErrorBranch();
  assert.match(errorBranch, /<LoungeProfileButton \/>/u);
  const homeModelFailure = lounge.slice(lounge.indexOf('if (invitation.status === "failed"'), lounge.indexOf("if (loading || !data"));
  assert.match(homeModelFailure, /<LoungeProfileButton \/>/u, "홈 모델을 못 받은 화면에도 내 정보로 가는 길이 있다");
  const legacy = read("src/components/dashboard/WeddingHomeExperience.tsx");
  assert.match(legacy, /export function LoungeProfileButton/u);
  assert.match(legacy, /accessibilityLabel="내 정보"/u);
  assert.match(legacy, /router\.push\("\/profile"\)/u);
});

test("the screens that left the tab bar stay reachable behind 내 정보 and 공유 할 일", () => {
  // 2026-11-17: 홈의 준비 도구 격자(`HOME_SERVICES`)는 없어졌다. 화면은 지우지 않고 내 정보가 연다.
  const profile = read("app/profile.tsx");
  for (const pathname of ["/schedule", "/budget", "/etiquette", "/market-prices", "/settings"]) {
    assert.ok(profile.includes(`pathname: "${pathname}"`), `내 정보가 ${pathname} 를 열지 않는다`);
  }
  assert.match(profile, /pathname: "\/community\/my-posts"/u);
  // 체크리스트는 아모라 대화 머리의 「공유 할 일」(`/amora-preparation`)이 연다.
  assert.match(read("app/amora-preparation.tsx"), /router\.push\("\/checklist"\)/u);
  assert.match(read("src/lib/amoraChatHeader.ts"), /pathname: "\/amora-preparation"/u);
  // 일정 탭은 전체 일정 화면으로 가는 길을 늘 둔다.
  assert.match(read("src/components/invitationLive/LiveConsultation.tsx"), /const FULL_SCHEDULE = "\/schedule";/u);
  // 격자 목록 자체는 지우지 않았다(다시 걸 때를 위해).
  assert.ok(HOME_SERVICES.some((service) => service.route === "/community"));
});
