import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 아모라 탭 머리의 「공유 할 일」 입구와 좁은 화면 배치 (2026-09-18).
 *
 * 웹은 아모라 화면 머리에 결정 보드 입구를 두는데(앱에는 아직 결정 기록이 없어 이름은 「공유 할 일」이다), 앱 아모라 탭 머리에는 그 목록으로 가는 길이 없었다.
 * 머리 오른쪽, 메시지 수 옆에 조용한 버튼 하나를 둔다.
 *
 * 지키는 것:
 * - 버튼은 ListChecks 아이콘과 「공유 할 일」, 읽어 주는 이름 「공유 할 일 보기」, 44pt 이상이다.
 * - 범위 줄의 세 번째 role=tab 이 아니다 — 범위 줄 밖, 머리 안에 있다. 함께 대화·나만 상담·상대에게 쓰는
 *   중 모두 보인다(범위·대상 조건 없이 그린다).
 * - 누르면 `/amora-preparation` 으로 한 번만 옮겨 간다. 답을 받는 중에는 누를 수 없다. 목록을 부르지 않는다.
 * - 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 머리는 가운데 오브 64px 와 "듣고 있어요"다.
 *   버튼 묶음은 오브 오른쪽에 떠 있고, 어느 폭에서도 오브에 닿지 않는다. 닿을 폭이면 글자를 빼고 아이콘만 둔다.
 *   노드 테스트는 폭을 어림할 뿐 실제 글꼴 렌더를 재지 않는다 — 어림이 쓰는 숫자가 실제 머리 스타일과 같은
 *   숫자인지를 함께 잰다.
 */
function compile(relative) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    throw new Error(`amoraChatHeader 는 의존성이 없어야 한다: ${specifier}`);
  });
  return module.exports;
}
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const header = compile("../lib/amoraChatHeader.ts");
const chat = read("../../app/(tabs)/chat.tsx");
const tree = ts.createSourceFile("chat.tsx", chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const LAYOUT = header.AMORA_CHAT_HEADER_LAYOUT;

function attribute(element, name) {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  const found = opening.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(tree) === name);
  return found?.initializer ? found.initializer.getText(tree) : undefined;
}
function tagName(element) {
  return (ts.isJsxElement(element) ? element.openingElement : element).tagName.getText(tree);
}
const jsxElements = [];
(function visit(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsxElements.push(node);
  ts.forEachChild(node, visit);
})(tree);
const boardButton = jsxElements.find((element) => tagName(element) === "Pressable" && attribute(element, "accessibilityLabel") === "{AMORA_BOARD_ENTRY.accessibilityLabel}");

test("입구의 이름·읽어 주는 이름·목적지", () => {
  assert.deepEqual({ ...header.AMORA_BOARD_ENTRY }, { label: "공유 할 일", accessibilityLabel: "공유 할 일 보기", pathname: "/amora-preparation" });
  assert.ok(boardButton, "머리에 공유 할 일 버튼이 없다");
  assert.equal(attribute(boardButton, "accessibilityRole"), '"button"');
  assert.equal(attribute(boardButton, "onPress"), "{openDecisionBoard}");
  assert.equal(attribute(boardButton, "disabled"), "{streaming}", "답을 받는 중에는 누를 수 없다");
  const inner = boardButton.getText(tree);
  assert.match(inner, /<ListChecks size=\{AMORA_CHAT_HEADER_LAYOUT\.boardIcon\}/);
  assert.match(inner, /\{showBoardLabel && <Text style=\{st\.headerBoardText\} numberOfLines=\{1\}>\{AMORA_BOARD_ENTRY\.label\}<\/Text>\}/);
  assert.match(chat, /import \{[^}]*\bListChecks\b[^}]*\} from "lucide-react-native"/);
});

test("범위 줄의 세 번째 탭이 아니다 — 머리 안, 범위 줄 밖에 조건 없이 그린다", () => {
  // 범위 줄의 탭은 여전히 둘이다.
  assert.equal(chat.match(/accessibilityRole="tab"/g).length, 2);
  const scopeRow = jsxElements.find((element) => tagName(element) === "View" && attribute(element, "style") === "{st.scopeRow}");
  assert.ok(scopeRow);
  assert.ok(!scopeRow.getText(tree).includes("AMORA_BOARD_ENTRY"), "범위 줄 안에 있다");
  // 부모가 곧바로 머리의 버튼 묶음이다 — 사이에 `조건 && (` 같은 식이 없으니 두 범위와 상대에게 쓰는 중 모두 보인다.
  const actions = boardButton.parent;
  assert.ok(ts.isJsxElement(actions) && attribute(actions, "style") === "{st.headerActions}", "머리 버튼 묶음의 직접 자식이 아니다");
  assert.ok(ts.isJsxElement(actions.parent) && attribute(actions.parent, "style") === "{st.header}");
  assert.equal(attribute(boardButton, "accessibilityRole"), '"button"', "탭이 아니라 버튼이다");
});

test("누르면 공유 할 일로 한 번만 옮겨 가고, 답을 받는 중에는 옮겨 가지 않으며, 목록을 부르지 않는다", () => {
  let declaration;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openDecisionBoard") declaration = node.getText(tree);
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(declaration, "openDecisionBoard 가 없다");
  assert.doesNotMatch(declaration, /api\/|fetch|apiFetch/, "머리 버튼은 화면만 옮긴다");
  const run = (bindings) => {
    const code = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function("bindings", `with (bindings) { ${code}; return openDecisionBoard; }`)(bindings);
  };
  const pushes = [];
  const bindings = { streaming: false, boardNavigationRef: { current: false }, router: { push: (path) => pushes.push(path) }, AMORA_BOARD_ENTRY: header.AMORA_BOARD_ENTRY };
  const open = run(bindings);
  open();
  open();
  assert.deepEqual(pushes, ["/amora-preparation"], "두 번 눌러도 한 번만 옮겨 간다");
  // 탭으로 돌아오면(포커스) 다시 누를 수 있다.
  assert.match(chat, /useFocusEffect\(useCallback\(\(\) => \{\n\s*boardNavigationRef\.current = false;\n\s*\}, \[\]\)\);/);
  bindings.boardNavigationRef.current = false;
  open();
  assert.equal(pushes.length, 2);
  const streaming = { streaming: true, boardNavigationRef: { current: false }, router: { push: (path) => pushes.push(path) }, AMORA_BOARD_ENTRY: header.AMORA_BOARD_ENTRY };
  run(streaming)();
  assert.equal(pushes.length, 2, "답을 받는 중에는 옮겨 가지 않는다");
});

test("오브 옆 버튼 묶음은 좁은 화면에서 글자를 빼고, 어느 폭에서도 가운데 오브와 겹치지 않는다", () => {
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 머리는 가운데 오브 64px 와 "듣고 있어요"다
  // (`Chat.dc`). 공유 할 일·대화 화면 정리 버튼은 오브 오른쪽에 떠 있다. 메시지 수 알약은 아티팩트에 없어 뺐다.
  for (const width of [320, 360, 375, 390, 430]) {
    const show = header.shouldShowAmoraBoardLabel(width);
    const used = header.estimateAmoraChatHeaderActionsWidth({ showBoardLabel: show, showClear: true });
    assert.ok(used <= header.amoraChatHeaderActionsRoom(width), `${width}pt 에서 버튼 묶음이 ${used.toFixed(1)}pt 로 오브에 닿는다`);
  }
  assert.equal(header.shouldShowAmoraBoardLabel(320), false);
  assert.equal(header.shouldShowAmoraBoardLabel(375), false);
  assert.equal(header.shouldShowAmoraBoardLabel(430), true);
  // 아이콘만 둔 묶음은 가장 좁은 320pt 에서도 들어간다.
  assert.ok(header.estimateAmoraChatHeaderActionsWidth({ showBoardLabel: false, showClear: true }) <= header.amoraChatHeaderActionsRoom(320));
  assert.ok(header.estimateAmoraChatHeaderActionsWidth({ showBoardLabel: true, showClear: true }) > header.amoraChatHeaderActionsRoom(390), "글자를 넣은 채로는 390pt 에서 오브에 닿는다 — 그래서 뺀다");
  // 큰 글자(시스템 글자 크기 130%)에서는 430pt 에서도 아이콘만 두고, 그래도 넘치지 않는다.
  assert.equal(header.shouldShowAmoraBoardLabel(430, 1.3), false);
  assert.ok(header.estimateAmoraChatHeaderActionsWidth({ showBoardLabel: false, showClear: true, fontScale: 1.3 }) <= header.amoraChatHeaderActionsRoom(320));
  // 어림은 넉넉하다: 한글은 글자 크기만큼, 숫자는 0.62배.
  assert.equal(header.estimateTextWidth("결정", 10), 20);
  assert.equal(header.estimateTextWidth("12", 10), 12.4);
  assert.equal(header.estimateTextWidth("결 정", 10, 2), 47);
  assert.ok(LAYOUT.button >= 44, "누르는 자리는 44pt 이상이다");
});

test("어림이 쓰는 숫자가 실제 머리 스타일의 숫자이고, 머리 가운데는 아티팩트의 오브와 듣고 있어요다", () => {
  const style = (name) => chat.match(new RegExp(`\\n  ${name}: \\{[^\\n]*\\},`))?.[0] ?? "";
  assert.match(style("header"), /alignItems: "center", paddingTop: AMORA_CHAT_HEADER_LAYOUT\.paddingTop, paddingBottom: AMORA_CHAT_HEADER_LAYOUT\.paddingBottom, paddingHorizontal: AMORA_CHAT_HEADER_LAYOUT\.paddingX/);
  assert.match(style("headerActions"), /position: "absolute", right: AMORA_CHAT_HEADER_LAYOUT\.paddingX, top: AMORA_CHAT_HEADER_LAYOUT\.actionsTop,[^\n]*gap: AMORA_CHAT_HEADER_LAYOUT\.actionGap/);
  assert.match(style("headerBoardBtn"), /minWidth: 44, height: 44,[^\n]*gap: AMORA_CHAT_HEADER_LAYOUT\.boardIconGap, paddingHorizontal: AMORA_CHAT_HEADER_LAYOUT\.boardPaddingX/);
  assert.match(style("headerBoardBtnCompact"), /width: 44, paddingHorizontal: 0/);
  assert.match(style("headerBoardText"), /fontSize: AMORA_CHAT_HEADER_LAYOUT\.boardFontSize/);
  assert.match(style("headerIconBtn"), /width: 44, height: 44/);
  // 아티팩트(`Chat.dc` header): 위 16·아래 8, 오브 64px. 버튼(44pt)은 오브 가운데 높이에 맞춘다.
  assert.equal(LAYOUT.paddingTop, 16);
  assert.equal(LAYOUT.paddingBottom, 8);
  assert.equal(LAYOUT.orb, 64);
  assert.equal(LAYOUT.actionsTop, LAYOUT.paddingTop + (LAYOUT.orb - LAYOUT.button) / 2);
  // 가운데는 오브와 "듣고 있어요"다. 예전 얼굴·두 줄 제목·메시지 수 알약은 없다.
  assert.match(chat, /<View style=\{st\.header\}>\s*\{\/\*[^*]*\*\/\}\s*<InvitationListening \/>/);
  const listening = read("../components/invitation/InvitationListening.tsx");
  assert.match(listening, /<AmoraOrb size=\{64\} mood="calm" \/>/);
  assert.match(listening, /\{FIRST_CHAT_COPY\.listening\}/);
  assert.doesNotMatch(chat, /<StatusPill\b/);
  assert.doesNotMatch(chat, /결혼 준비 동반자/);
  // 화면 폭과 시스템 글자 크기로 정한다.
  assert.match(chat, /const \{ width: windowWidth, fontScale \} = useWindowDimensions\(\);\n\s*const showBoardLabel = shouldShowAmoraBoardLabel\(windowWidth, fontScale\);/);
  assert.match(attribute(boardButton, "style"), /!showBoardLabel && st\.headerBoardBtnCompact/);
});
