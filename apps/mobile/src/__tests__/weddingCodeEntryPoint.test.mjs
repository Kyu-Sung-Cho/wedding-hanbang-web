import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { holdsUnsavedWork } from "../lib/webviewUnsavedWork.mjs";

/**
 * 앱에서 웨딩코드로 들어가는 문 — 있는가, 어디에 있는가, 살아 있는 주소를 여는가.
 *
 * 네 가지를 못박는다.
 *
 * 1. **자리.** 웨딩코드는 로그인 뒤 내비게이션에 넣지 않기로 했다(2026-08-27 결정,
 *    웹은 `mvpDirection.test.ts` 가 든다). 앱에서 그 결정에 해당하는 자리는 하단 탭이다.
 *    라운지 본문 카드와 로그인 화면 링크로만 두고, 탭에 올라오면 여기서 빨간불이 난다.
 *    로그인 화면에도 두는 이유는 웨딩코드가 계정 없이 끝나기 때문이다 — 웹 로그인
 *    화면과 같은 자리에 같은 문을 둔다.
 * 2. **목적지.** 앱에 사본을 만들지 않고 웹 화면을 웹뷰로 연다. 사이트 주소는 하드코딩
 *    하지 않고 `resolveMobileSiteOrigin` 을 거친다 — 개발 빌드가 운영 화면을 열지
 *    않도록. 예절 안내가 죽은 주소를 가리켜 404 웹뷰를 열었던 적이 있다.
 * 3. **되돌아오는 고리.** 웹뷰는 `WEB_TO_NATIVE` 에 있는 경로를 앱 화면으로 되돌린다.
 *    거기에 `wedding-code` 가 들어가면 웹뷰 → 앱 화면 → 웹뷰로 무한히 튄다.
 * 4. **답을 지키는 일.** 답은 화면 상태로만 있다. 문서를 다시 읽으면 사라진다.
 *
 * **소스 문자열로 묻는 것과 실제로 물어보는 것.** 4번은 처음에 "그런 함수가 있나" 로만
 * 물었는데, 판정 정규식을 `/wedding-code` → `/wedding-codes` 로 한 글자 바꿔 심으니
 * 이 파일의 10개가 전부 초록불이었다(2026-09-16). 그래서 판정은 `webviewUnsavedWork.mjs`
 * 로 옮겨 **불러다 실제 주소로 물어본다.** 나머지는 화면 파일이라 불러올 수 없어
 * 소스로 묻되, 묻는 창을 여는 곳과 닫는 곳 양쪽에 못을 박는다.
 */
const source = (relative) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

/**
 * 주석을 걷는다. **왜 그렇게 했는지 적은 글이 코드 대신 대답하면 안 된다.**
 *
 * 이 파일에서 양쪽으로 다 당했다. "accessibilityLabel 을 달지 않는다" 고 적은 주석
 * 때문에 "라벨이 없다" 는 검사가 빨간불이 났고, 줄 끝 주석은 걷히지 않아 같은 일이
 * 또 일어날 수 있었다. 반대 방향도 있다 — 지운 문구를 주석에 남겨두면 "아직 있다"
 * 로 읽힌다.
 *
 * 줄 끝 `//` 까지 걷되, 주소 안의 `//`(`https://`)는 건드리지 않는다.
 */
const withoutComments = (text) =>
  text
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ");

/**
 * 줄바꿈을 지운다. JSX 안의 한 문장은 줄 길이 때문에 두 줄로 접히는데, 화면에서는
 * 한 문장으로 읽힌다. 소스를 그대로 찾으면 접힌 자리에서 못 찾는다.
 */
const collapse = (text) => text.replace(/\s+/g, " ");

/**
 * 두 표식 **사이**만 잘라낸다. 양쪽 다 있어야 하고 순서도 맞아야 한다.
 *
 * 길이만 재면 한쪽만 잃었을 때를 못 본다. 끝 표식이 사라지면 `indexOf` 가 -1 이라
 * 파일 끝까지 훑게 되는데(807자 → 12,276자), 길이 검사는 오히려 더 통과한다.
 */
function between(text, startMark, endMark, what) {
  const start = text.indexOf(startMark);
  const end = text.indexOf(endMark, start + 1);
  assert.ok(start >= 0, `${what}: 시작 표식 "${startMark}" 을 못 찾았다 — 검사가 헛돈다`);
  assert.ok(end > start, `${what}: 끝 표식 "${endMark}" 을 못 찾았다 — 검사가 헛돈다`);
  return text.slice(start, end + endMark.length);
}

const screen = source("app/wedding-code/index.tsx");
const rootLayout = source("app/_layout.tsx");
const webview = source("app/webview.tsx");
const tabsLayout = source("app/(tabs)/_layout.tsx");
const lounge = source("src/components/dashboard/WeddingHomeExperience.tsx");
const login = source("app/(auth)/login.tsx");

/** 라운지 카드 JSX 전체. 여는 태그부터 닫는 태그까지 — 프롭 순서에 기대지 않는다. */
const loungeCard = () =>
  between(
    lounge,
    "<Pressable\n            style={({ pressed }) => [\n              styles.weddingCodeStrip,",
    "</Pressable>",
    "라운지 웨딩코드 카드",
  );

test("라운지 본문에 웨딩코드로 가는 카드가 있다", () => {
  const card = collapse(loungeCard());
  assert.match(card, /router\.push\("\/wedding-code"\)/);
  assert.match(card, /웨딩코드로 둘이 어디서 갈리는지 알아봐요/);
  // 웹 라운지 카드와 같은 선 긋기. 제품 계약이 점수·궁합 판정을 금지한다(CLAUDE.md).
  assert.match(card, /점수나 궁합은 매기지 않아요/);
});

test("선 긋기 문장이 잘려서 뜻이 뒤집히지 않는다", () => {
  // `numberOfLines` 를 걸면 글자 크기를 키워 쓰는 사람에게 "…매기지" 에서 끊기고
  // **"않아요" 가 사라진다.** 부정문이 잘리면 정반대로 읽힌다. 카드는 minHeight 라
  // 늘어나면 되므로 이 설명글에는 줄 수 제한을 두지 않는다.
  const card = collapse(withoutComments(loungeCard()));
  const description = between(
    card,
    "styles.partnerDescription",
    "</Text>",
    "웨딩코드 카드 설명글",
  );
  assert.match(description, /점수나 궁합은 매기지 않아요/);
  assert.doesNotMatch(
    description,
    /numberOfLines/,
    "줄 수를 제한하면 선 긋기 문장의 끝이 잘려 나간다",
  );
});

test("카드가 자기 글을 화면 낭독기에게서 숨기지 않는다", () => {
  const card = withoutComments(loungeCard());
  assert.doesNotMatch(
    card,
    /accessibilityLabel/,
    "Pressable 은 기본이 accessible 이라 라벨이 자식 글을 **대신** 읽힌다. 라벨을 달면 카드 본문이 영영 안 들린다",
  );
});

test("로그인 화면에서 계정 없이 먼저 해볼 수 있다", () => {
  assert.match(login, /로그인 없이 웨딩코드로 원하는 것 먼저 보기/);
  assert.match(login, /router\.push\(\{ pathname: "\/wedding-code" \}\)/);
});

test("하단 탭에는 올리지 않는다", () => {
  // expo-router 는 탭을 `_layout.tsx` 가 아니라 **파일 목록**에서 만든다
  // (`useSortedScreens` 가 `(tabs)/` 의 자식을 전부 등록한다). `_layout.tsx` 만
  // 보면 `app/(tabs)/wedding-code.tsx` 를 하나 만들어 다섯 번째 탭이 생겨도
  // 이 검사는 초록불이다. 그래서 디렉터리를 직접 읽는다.
  //
  // 세는 것은 **라우트가 되는 파일**뿐이다. macOS 가 남기는 `.DS_Store`, 스냅샷
  // 폴더, 같이 두는 도우미 파일까지 세면 탭이 늘지도 않았는데 빨간불이 난다.
  const tabFiles = readdirSync(
    fileURLToPath(new URL("../../app/(tabs)", import.meta.url)),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(tsx|jsx|ts|js)$/.test(name) && !name.startsWith("_"));

  assert.deepEqual(
    tabFiles.sort(),
    ["chat.tsx", "lounge.tsx"],
    "하단 탭은 라운지|아모라 둘이다(2026-11-13 파운더 결정, CLAUDE.md 제품 계약)",
  );
  assert.doesNotMatch(
    tabsLayout,
    /wedding-code/,
    "웨딩코드는 준비 흐름의 한 단계가 아니라 해도 되고 안 해도 되는 대화거리다",
  );
});

test("웹과 같은 화면을 웹뷰로 연다", () => {
  assert.match(screen, /buildMobileSiteUrl\(\s*"\/wedding-code"/);
  assert.match(screen, /pathname: "\/webview"/);
});

test("사이트 주소를 하드코딩하지 않는다", () => {
  assert.match(screen, /resolveMobileSiteOrigin/);
  assert.match(screen, /EXPO_PUBLIC_SITE_URL/);
  // 주석은 걷는다 — 설명으로 적은 예시 주소가 빨간불을 만들면 안 된다.
  // 따옴표 세 종류를 다 본다. `"…"` 만 보면 `'…'` 나 백틱으로 그냥 빠져나간다.
  assert.doesNotMatch(
    withoutComments(screen),
    /["'`]https?:\/\/[^"'`]+["'`]/,
    "환경변수를 건너뛰는 주소 문자열이 있으면 개발 빌드가 운영 화면을 연다",
  );
});

test("답하던 중에 당겨서 새로고침으로 답이 날아가지 않는다", () => {
  // 화면에 배선돼 있는가.
  assert.match(webview, /pullToRefreshEnabled=\{!holdsUnsavedWork\(currentUrl\)\}/);

  // 그리고 판정이 **실제로 맞는가.** 이쪽이 본론이다 — 배선만 보던 검사는
  // 정규식을 한 글자 바꾼 변형을 못 잡았다.
  for (const url of [
    "https://hanbang.ai/wedding-code",
    "https://hanbang.ai/wedding-code/",
    "https://hanbang.ai/wedding-code/taste",
    "https://hanbang.ai/wedding-code/c/MOFA",
    "https://hanbang.ai/wedding-code/result?x=1",
  ]) {
    assert.equal(holdsUnsavedWork(url), true, `${url} 에서는 새로고침을 막아야 한다`);
  }

  for (const url of [
    "https://hanbang.ai/price",
    "https://hanbang.ai/wedding/manners",
    "https://hanbang.ai/wedding/community/quote-check",
    // 이름만 비슷한 남의 경로까지 막으면, 멀쩡한 화면에서 새로고침이 사라진다.
    "https://hanbang.ai/wedding-code-research",
    "https://hanbang.ai/",
    "",
    "not a url",
  ]) {
    assert.equal(holdsUnsavedWork(url), false, `${url} 에서는 막을 이유가 없다`);
  }
});

test("루트 스택에 등록돼 있다", () => {
  assert.match(
    rootLayout,
    /<Stack\.Screen name="wedding-code" options=\{\{ headerShown: false \}\} \/>/,
    "등록하지 않으면 기본 헤더가 웹뷰 헤더 위에 하나 더 붙는다",
  );
});

test("웹뷰 헤더가 하위 경로에서도 화면 이름을 안다", () => {
  // `/wedding-code/taste` 처럼 안으로 들어가면 **마지막 조각**은 `taste` 다.
  // 조각으로 찾는 map 에만 넣으면 헤더가 "웨딩한방" 으로 바뀐다 — 예절 안내가
  // 똑같이 겪었고 그래서 prefix 로 본다.
  assert.ok(
    webview.includes(String.raw`/^\/wedding-code(\/|$)/.test(pathname)`),
    "하위 경로까지 잡으려면 조각이 아니라 prefix 로 봐야 한다",
  );
});

test("웹뷰가 웨딩코드를 앱 화면으로 되돌리지 않는다", () => {
  const table = between(
    webview,
    "const WEB_TO_NATIVE",
    "export function nativeRouteForWebPath",
    "WEB_TO_NATIVE 표",
  );
  assert.doesNotMatch(table, /wedding-code/, "여기 들어가면 웹뷰와 앱 화면이 무한히 튄다");
});
