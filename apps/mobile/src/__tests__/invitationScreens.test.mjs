// 청첩장 디자인 화면(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해) 1단계.
//
// 앱은 아티팩트 화면을 컴포넌트로 갖고(`src/components/invitation/`), 로그아웃 상태의 첫 화면을 '시작'
// 화면으로 바꾸고, 로그인 없이 보는 예시 커플 스택(`app/example/`)을 연다. 렌더러 없이 소스를 읽어 지킨다:
//   - 예시 스택은 `EXAMPLE_*` 만 쓰고 서버를 부르지 않는다.
//   - 화면 글자는 `@hanbang/shared/invitation` 에서만 온다(화면 파일에 한글을 다시 적지 않는다).
//   - 떠 있는 하단 메뉴는 아티팩트의 네 칸과 아이콘 좌표를 그대로 쓴다.
//   - 스위치·켜고 끄는 단추는 상태를 읽어 주고, 44pt 보다 낮은 알약은 누를 자리를 넓힌다.
//   - 새 네이티브 모듈 없이 OTA 로 나갈 수 있다.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(join(mobileRoot, relative), "utf8");

const COMPONENT_DIR = "src/components/invitation";
const COMPONENTS = readdirSync(join(mobileRoot, COMPONENT_DIR))
  .filter((name) => /\.tsx?$/u.test(name))
  .map((name) => `${COMPONENT_DIR}/${name}`);
const EXAMPLE_SCREENS = ["index", "chat", "journey", "halls", "letter", "consultation"].map((name) => `app/example/${name}.tsx`);
const EXAMPLE_FILES = ["app/example/_layout.tsx", ...EXAMPLE_SCREENS, `${COMPONENT_DIR}/ExampleCouple.tsx`];

/** 주석을 걷어낸 소스. 왜 그렇게 했는지 적은 주석이 검사에 걸리지 않게 한다. */
function code(relative) {
  return ts.transpileModule(read(relative), {
    fileName: relative.endsWith(".tsx") ? "screen.tsx" : "screen.ts",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}

/** import 문 목록: { from, values(값으로 가져온 이름), typeOnly }. */
function imports(relative) {
  const tree = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return tree.statements.filter(ts.isImportDeclaration).map((node) => {
    const clause = node.importClause;
    const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
    const values = clause?.isTypeOnly ? [] : named.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
    if (clause?.name && !clause.isTypeOnly) values.push(clause.name.text);
    return { from: node.moduleSpecifier.text, values };
  });
}

test("the example stack has its six screens and every screen shows the example line", () => {
  assert.ok(COMPONENTS.length >= 10, `청첩장 컴포넌트를 못 찾았다: ${COMPONENTS.length}`);
  for (const file of EXAMPLE_FILES) assert.ok(existsSync(join(mobileRoot, file)), `${file} 이 없다`);
  for (const file of EXAMPLE_SCREENS) {
    const source = code(file);
    assert.match(source, /<ExampleFrame>/u, `${file} 이 예시 줄 없이 그려진다`);
  }
  const frame = code(`${COMPONENT_DIR}/ExampleCouple.tsx`);
  assert.match(frame, /\{EXAMPLE_COPY\.banner\}/u);
  assert.match(frame, /label=\{EXAMPLE_COPY\.leave\}/u);
  // 편지는 아래에서 올라오는 시트다.
  assert.match(code("app/example/_layout.tsx"), /name="letter" options=\{\{ presentation: "fullScreenModal"/u);
});

test("the example stack reads only EXAMPLE_* data and never reaches a server", () => {
  for (const file of EXAMPLE_FILES) {
    for (const entry of imports(file)) {
      if (entry.from === "@hanbang/shared/invitation") {
        assert.deepEqual(entry.values.filter((name) => !name.startsWith("EXAMPLE_")), [], `${file}: 예시 데이터가 아닌 값을 가져온다`);
      }
    }
  }
  const network = /@\/lib\/(?:api|supabase|auth|mobileWebApiBridge|mobileWebRuntime)|@supabase\/|expo\/fetch|\bfetch\(|XMLHttpRequest|WebSocket|EventSource/u;
  for (const file of [...EXAMPLE_FILES, ...COMPONENTS]) {
    assert.doesNotMatch(code(file), network, `${file}: 예시·청첩장 화면이 서버에 닿는다`);
  }
});

test("invitation screens take every word from the shared copy module", () => {
  for (const file of [...COMPONENTS, ...EXAMPLE_FILES]) {
    const hangul = code(file).match(/[ㄱ-ㆎ가-힣]+/gu) ?? [];
    assert.deepEqual(hangul, [], `${file}: 화면 글자를 직접 적었다 — @hanbang/shared/invitation 에서 읽을 것`);
  }
  const start = code(`${COMPONENT_DIR}/InvitationStart.tsx`);
  for (const key of ["wordmark", "tagline", "headingLines", "body", "start", "example"]) {
    assert.match(start, new RegExp(`START_COPY\\.${key}\\b`, "u"), `시작 화면이 START_COPY.${key} 를 안 쓴다`);
  }
});

test("the floating tab bar has the artifact's four destinations and icons", () => {
  const bar = code(`${COMPONENT_DIR}/InvitationTabBar.tsx`);
  for (const [key, label] of [["home", "home"], ["chat", "chat"], ["journey", "journey"], ["status", "schedule"]]) {
    assert.match(bar, new RegExp(`key: "${key}", label: HOME_COPY\\.nav\\.${label}`, "u"), `${key} 칸`);
  }
  assert.match(bar, /accessibilityRole="tablist"/u);
  assert.match(bar, /accessibilityLabel=\{HOME_COPY\.nav\.label\}/u);
  assert.match(bar, /accessibilityRole="tab"/u);
  assert.match(bar, /accessibilityState=\{\{ selected \}\}/u);
  assert.match(bar, /height: INVITATION_TAB_BAR_HEIGHT/u);
  assert.match(bar, /item: \{ width: 52, height: 48, borderRadius: 24/u);
  // 아티팩트(`Home.dc` nav) SVG 좌표 그대로.
  const icons = code(`${COMPONENT_DIR}/InvitationIcons.tsx`);
  for (const geometry of [
    /x=\{3\.5\} y=\{6\} width=\{17\} height=\{13\} rx=\{1\.5\}/u,
    /d="M3\.5 7l8\.5 6 8\.5-6"/u,
    /cx=\{12\} cy=\{12\} r=\{8\.5\}/u,
    /cx=\{9\.5\} cy=\{9\.5\} r=\{2\.2\}/u,
    /d="M8 6h12M8 12h12M8 18h12"/u,
    /x=\{4\} y=\{5\} width=\{16\} height=\{15\} rx=\{2\.5\}/u,
    /d="M4 10h16M9 3v4M15 3v4"/u,
  ]) {
    assert.match(icons, geometry);
  }
  // 하단 메뉴 문구는 아티팩트 aria-label 그대로다.
  const copy = read("../../packages/shared/src/invitation/copy.ts");
  assert.match(copy, /home: "청첩장 홈",\s*chat: "아모라와 대화",\s*journey: "준비 순서",\s*schedule: "일정"/u);
});

test("switches and toggles announce their state, and short pills widen their touch area", () => {
  const letter = code(`${COMPONENT_DIR}/InvitationLetterSheet.tsx`);
  assert.match(letter, /accessibilityRole="switch"/u);
  assert.match(letter, /accessibilityState=\{\{ checked: share\.on \}\}/u);
  assert.match(letter, /accessibilityLabel=\{LETTER_COPY\.switchLabel\(share\.label\)\}/u);
  assert.match(letter, /hitSlop=\{hitSlopFor\(32\)\}/u);
  const compare = code(`${COMPONENT_DIR}/InvitationCompare.tsx`);
  assert.match(compare, /accessibilityLabel=\{COMPARE_COPY\.heartLabel\(hall\.name\)\}/u);
  assert.match(compare, /accessibilityState=\{\{ selected: hall\.picked \}\}/u);
  assert.match(compare, /hitSlop=\{hitSlopFor\(38\)\}/u);
  assert.match(code(`${COMPONENT_DIR}/InvitationFirstChat.tsx`), /hitSlop=\{hitSlopFor\(42\)\}/u);
  assert.match(code(`${COMPONENT_DIR}/InvitationHome.tsx`), /accessibilityState=\{\{ expanded: open \}\}/u);
  assert.match(code(`${COMPONENT_DIR}/InvitationButton.tsx`), /hitSlop=\{hitSlopFor\(height\)\}/u);
  const style = code(`${COMPONENT_DIR}/invitationStyle.ts`);
  assert.match(style, /Math\.ceil\(\(44 - height\) \/ 2\)/u);
});

test("the invitation screens add no native module, so they ship over the air", () => {
  const allowed = new Set([
    "react", "react-native", "react-native-svg", "react-native-safe-area-context", "expo-router",
    "@hanbang/shared/invitation", "@hanbang/design-tokens",
    "@/components/ui/AppText", "@/components/ui/AmoraOrb", "@/lib/appFonts",
  ]);
  for (const file of [...COMPONENTS, ...EXAMPLE_FILES]) {
    for (const entry of imports(file)) {
      if (entry.from.startsWith("./") || entry.from.startsWith("@/components/invitation/")) continue;
      assert.ok(allowed.has(entry.from), `${file}: ${entry.from} 를 가져온다`);
    }
  }
  const pkg = JSON.parse(read("package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const banned of ["expo-blur", "expo-linear-gradient", "expo-image", "@expo-google-fonts/noto-sans-kr"]) {
    assert.equal(deps[banned], undefined, `${banned} 는 새 네이티브 모듈이거나 무거운 글꼴 꾸러미다`);
  }
});

test("signed-out people land on the start screen; signing in still goes through the root gate", () => {
  const index = code("app/index.tsx");
  const loginCase = index.slice(index.indexOf('case "login":'), index.indexOf('case "consent":'));
  assert.match(loginCase, /<InvitationStart/u);
  assert.match(loginCase, /onStart=\{\(\) => router\.replace\("\/\(auth\)\/login"\)\}/u);
  assert.match(loginCase, /onExample=\{\(\) => router\.push\("\/example"\)\}/u);
  assert.doesNotMatch(loginCase, /<Redirect/u);
  // 나머지 갈래와 관문 순서는 그대로다.
  assert.match(index, /case "consent":\s*return <Redirect href="\/\(auth\)\/consent"\s*\/>/u);
  assert.match(index, /case "onboarding":\s*return <Redirect href="\/onboarding"\s*\/>/u);
  assert.match(index, /case "dashboard":\s*return <Redirect href="\/\(tabs\)\/lounge"\s*\/>/u);
  assert.ok(index.indexOf("await verifyMobileWebRuntime") < index.indexOf("supabase.auth.getSession"));
  assert.ok(index.indexOf("readMobileSignupConsentAccess(") < index.indexOf('.from("profiles")'));
  // 로그인 화면은 성공하면 루트로 돌아와 같은 판정을 다시 거친다.
  assert.match(read("app/(auth)/login.tsx"), /router\.replace\("\/"\)/u);
});

// ── 2026-11-17 리드 캡처(아티팩트와 같은 Chrome·같은 크기로 나란히)에서 찾은 것 ─────────────────────────

test("photos fill their box like CSS object-fit: cover, and the letter backdrop cannot widen the page", () => {
  // React Native 의 Image 는 require 한 사진의 원래 크기(900×640, 900×1400)를 기본 너비·높이로 쓴다.
  // absoluteFill 만 주자 사진이 원래 크기로 왼쪽 위에 붙어 크게 확대된 것처럼 잘렸고(상담·비교·홈·시작),
  // 웹에서는 편지 화면 문서가 900px 로 넓어졌다.
  const style = code(`${COMPONENT_DIR}/invitationStyle.ts`);
  assert.match(style, /photoFill = \{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" \}/u);
  let images = 0;
  for (const file of COMPONENTS) {
    for (const match of code(file).matchAll(/<Image\b[\s\S]*?\/>/gu)) {
      images += 1;
      assert.match(match[0], /resizeMode="cover"/u, file);
      assert.match(match[0], /style=\{\[?photoFill\b/u, `${file}: 사진이 상자를 채우지 않는다`);
    }
  }
  assert.ok(images >= 5, `사진을 ${images}개만 찾았다`);
  assert.match(code(`${COMPONENT_DIR}/InvitationLetterSheet.tsx`), /root: \{ flex: 1, overflow: "hidden"/u);
});

test("compare cards start flush at the left edge, as the founder saw them in Chrome", () => {
  // 아티팩트 목록은 왼쪽 여백 22px 이 있지만 scroll-snap 이 첫 카드를 스크롤 영역 끝에 맞춰 x=0 에 붙어 보인다.
  const compare = code(`${COMPONENT_DIR}/InvitationCompare.tsx`);
  assert.match(compare, /cards: \{ gap: CARD_GAP, paddingRight: 22, paddingBottom: 8 \}/u);
  assert.doesNotMatch(compare, /cards: \{[^}]*padding(?:Horizontal|Left)/u);
  assert.match(compare, /snapToInterval=\{CARD_WIDTH \+ CARD_GAP\}/u);
});

test("box sizes and colours the browser computed for the artifact are carried over", () => {
  // div 의 min-height 52px 는 내용 상자라 아래 1px 선이 더해져 한 줄이 53px 이다. RN minHeight 는 선을 포함한다.
  assert.match(code(`${COMPONENT_DIR}/InvitationLetterSheet.tsx`), /minHeight: 53,\s*borderBottomWidth: 1/u);
  // 아티팩트가 글자색을 적지 않은 단추 셋은 Chrome 단추 기본색(#000000)으로 그려졌다.
  assert.match(code(`${COMPONENT_DIR}/invitationStyle.ts`), /BROWSER_BUTTON_TEXT = "#000000"/u);
  const status = code(`${COMPONENT_DIR}/InvitationConsultation.tsx`);
  assert.equal((status.match(/color=\{BROWSER_BUTTON_TEXT\}/gu) ?? []).length, 2, "캘린더·공유 단추");
  assert.match(status, /color=\{action\.tone === "ink" \? undefined : BROWSER_BUTTON_TEXT\}/u);
});
