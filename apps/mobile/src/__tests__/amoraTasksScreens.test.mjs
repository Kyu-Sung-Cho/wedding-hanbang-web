// 아모라가 맡은 일(D-84) 앱 화면의 배선. 이 저장소에는 RN 렌더 도구가 없어서 소스를 읽어 본다.
//
// 지키는 것:
//   1. 홈에는 한 줄이다(`LoungeNotices` 안, 오늘의 한 가지 뒤, 첫 도착 앞).
//   2. 결과 화면은 루트 Stack 에 `amora-task/[id]` 로 등록돼 있다(공유 계약의 앱 주소와 같은 모양).
//   3. 대화는 `offer_amora_task` 결과를 `AmoraTaskOfferCard` 로 그리고, 그린다고 서버에 알린다.
//   4. 새 카드의 화면 글자는 전부 `@hanbang/shared/amora-tasks` 에서 온다.
//   5. 「다음에 할 일」은 입력칸에 글을 넣어 둘 뿐 보내지 않는다. 출처 링크는 계약이 확인한 https 주소만 연다.
//   6. 홈 카드와 대화 카드는 401 에 로그아웃 알림을 띄우지 않는다. 새 파일은 네이티브 모듈을 더하지 않는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import { amoraTaskAppPath } from "@hanbang/shared/amora-tasks";

const mobile = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative) => readFileSync(mobile(relative), "utf8");
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const CARD = "src/components/amoraTasks/AmoraTasksCard.tsx";
const OFFER = "src/components/amoraTasks/AmoraTaskOfferCard.tsx";
const SCREEN = "app/amora-task/[id].tsx";
const LOUNGE = "app/(tabs)/lounge.tsx";
const CHAT = "app/(tabs)/chat.tsx";

/** 화면에 나갈 수 있는 글(문자열, 템플릿 조각, JSX 글자)에서 한글이나 줄표가 든 것을 모은다. 주석은 보지 않는다. */
function visibleLiterals(name, text, pattern) {
  const source = parse(name, text);
  const found = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
      || ts.isJsxText(node)
    ) {
      if (pattern.test(node.text)) {
        found.push({ text: node.text.trim(), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
const HANGUL = /[ㄱ-ㆎ가-힣]/u;
const DASH = /[—–]/u;

/** 최상위 `function name` 의 몸통. 못 찾으면 실패한다(이름이 바뀌면 이 검사도 옮겨야 한다). */
function functionBody(file, name) {
  const source = parse(file, read(file));
  let found = null;
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  assert.ok(found?.body, `${file} 에서 ${name} 을 찾지 못했다`);
  return found.body.getText(source);
}

/** `const name = useCallback(<함수>, deps)` 의 함수 본문. 못 찾으면 실패한다. */
function callbackBody(file, name) {
  const source = parse(file, read(file));
  let found = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found?.initializer && ts.isCallExpression(found.initializer), `${file} 에서 ${name} 을 찾지 못했다`);
  return found.initializer.arguments[0].getText(source);
}

/**
 * 파일 안의 `name(...)` 부름마다 「감싼 자리: 인자」를 소스 순서로 모은다. 자리는 `useEffect` 이거나 감싼 `const x = …` 의
 * 이름이다. 주석은 구문 나무에 없어서 세지 않는다.
 */
function callSites(file, name) {
  const source = parse(file, read(file));
  const placeOf = (node) => {
    for (let at = node.parent; at; at = at.parent) {
      if (ts.isCallExpression(at) && at.expression.getText(source) === "useEffect") return "useEffect";
      if (ts.isVariableDeclaration(at)) return at.name.getText(source);
    }
    return "top";
  };
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) {
      found.push(`${placeOf(node)}: ${node.arguments.map((argument) => argument.getText(source)).join(", ")}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function containsJsx(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, (child) => (containsJsx(child) ? true : undefined)) === true;
}

/** 화면에 글로 놓이는 JSX 중괄호 식(안에 JSX 를 품지 않은 것)을 모은다. 주석만 든 중괄호는 식이 없어서 빠진다. */
function jsxTextExpressions(file) {
  const source = parse(file, read(file));
  const found = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression && !containsJsx(node.expression)) found.push(node.expression.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 이름이나 문자열로 `text` 를 쓴 자리(`result.reply`, `{ reply }`, `result["reply"]`)를 모은다. 주석은 세지 않는다. */
function namesSpelled(file, text) {
  const source = parse(file, read(file));
  const found = [];
  const visit = (node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === text) {
      found.push(node.parent.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 보내는 길. 「다음에 할 일」 단추가 이 가운데 무엇이라도 부르면 입력칸에 넣는 것이 아니라 보내는 것이다. */
const SENDS = [/sendMessage/u, /handleSend/u, /requestAiMessageIngest/u, /\bfetch\(/u, /apiFetch/u, /apiJson/u, /postAmoraTaskAction/u, /\/api\//u];

test("the detectors catch what they are meant to catch", () => {
  // 정규식이 낡아 아무것도 못 잡으면서 초록불을 주는 일이 이 저장소에 있었다. 일부러 어긴 글로 먼저 본다.
  const planted = [
    "// 주석의 한글은 괜찮다",
    'const a = "맡기기";',
    "const b = `${x} 확인`;",
    "export const C = () => <Text>진행 보기</Text>;",
    'const d = "a — b";',
  ].join("\n");
  assert.deepEqual(visibleLiterals("planted.tsx", planted, HANGUL).map((hit) => hit.text), ["맡기기", "확인", "진행 보기"]);
  assert.equal(visibleLiterals("planted.tsx", planted, DASH).length, 1);
  const sending = "(prompt) => { handleSend(prompt); }";
  assert.ok(SENDS.some((pattern) => pattern.test(sending)));
});

test("the home renders the task card as one line inside LoungeNotices, after today's one and before the first arrival", () => {
  const lounge = read(LOUNGE);
  assert.match(lounge, /^import AmoraTasksCard from "@\/components\/amoraTasks\/AmoraTasksCard";$/mu);
  const notices = functionBody(LOUNGE, "LoungeNotices");
  const today = notices.indexOf("{todayOneCare}");
  const card = notices.indexOf("<AmoraTasksCard />");
  const arrival = notices.indexOf("{firstArrival}");
  assert.ok(today > -1 && card > today && arrival > card, "오늘의 한 가지 뒤, 첫 도착 앞에 있어야 한다");
  // 홈에는 한 줄이다. 다른 자리에서 다시 그리지 않고, 감싸지도 않는다.
  assert.equal(lounge.match(/<AmoraTasksCard\b/gu)?.length, 1);
  assert.match(notices, /\{todayOneCare\}\s*<AmoraTasksCard \/>\s*\{firstArrival\}/u);
});

test("the result screen is a root stack screen at the contract's app path", () => {
  assert.ok(existsSync(mobile(SCREEN)), `${SCREEN} 이 없다`);
  assert.match(read("app/_layout.tsx"), /<Stack\.Screen name="amora-task\/\[id\]" options=\{\{ headerShown: false \}\} \/>/u);
  assert.equal(read("app/_layout.tsx").match(/amora-task/gu)?.length, 1);
  // 탭 안 화면이 아니다. 뒤로 가기가 있고, 대화로는 dismissTo 로 돌아간다.
  assert.doesNotMatch(read("app/(tabs)/_layout.tsx"), /amora-task/u);
  assert.match(read(SCREEN), /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/\(tabs\)\/lounge"\)/u);
  // 공유 계약의 앱 주소가 이 파일을 가리킨다(알림의 deepLink 도 같은 모양이다).
  assert.match(amoraTaskAppPath("3f2b8c1e-5d4a-4b6c-9e8f-1a2b3c4d5e6f"), /^\/amora-task\/[0-9a-f-]{36}$/u);
});

test("the chat draws offer_amora_task results with AmoraTaskOfferCard in one branch and declares it to the server", () => {
  const chat = read(CHAT);
  assert.match(chat, /^import AmoraTaskOfferCard from "@\/components\/amoraTasks\/AmoraTaskOfferCard";$/mu);
  const source = parse(CHAT, chat);
  const branches = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.getText(source).includes('toolName === "offer_amora_task"')) {
      branches.push(node.getText(source));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(branches.length, 1, "대화 카드를 고르는 자리는 하나여야 한다");
  assert.match(branches[0], /^\{isAi && /u, "아모라의 말에만 그린다");
  assert.match(branches[0], /<AmoraTaskOfferCard key=\{`\$\{result\.toolName\}-\$\{index\}`\} toolOutput=\{result\.toolOutput\} \/>/u);
  assert.equal(chat.match(/<AmoraTaskOfferCard\b/gu)?.length, 1);
  // 그리는 카드는 서버에 알린다(renderedToolsAreDeclared.test.mjs 가 두 방향을 같이 잰다).
  const declared = chat.match(/const MOBILE_RENDERED_TOOLS = \[([^\]]*)\] as const;/u)?.[1] ?? "";
  assert.match(declared, /"offer_amora_task"/u);
});

test("the new cards take every visible word from @hanbang/shared/amora-tasks", () => {
  for (const file of [CARD, OFFER]) {
    const text = read(file);
    assert.deepEqual(visibleLiterals(file, text, HANGUL), [], `${file}: 화면 글자를 직접 적었다`);
    assert.deepEqual(visibleLiterals(file, text, DASH), [], `${file}: 줄표를 썼다`);
    assert.match(text, /from "@hanbang\/shared\/amora-tasks";/u);
    assert.match(text, /AMORA_TASK_COPY\./u);
  }
  // 결과 화면도 계약(`AMORA_TASK_COPY`) 밖 문장이 없다. 그만하기가 안 됐을 때는 `actionFailed`(웹과 같은 문장).
  const screen = read(SCREEN);
  const hits = visibleLiterals(SCREEN, screen, HANGUL);
  assert.deepEqual(hits, []);
  assert.match(screen, /AMORA_TASK_COPY\.actionFailed/u);
  assert.deepEqual(visibleLiterals(SCREEN, screen, DASH), []);
  assert.match(screen, /from "@hanbang\/shared\/amora-tasks";/u);
});

test("the next-step button only fills the chat input through the lounge ask door and never sends", () => {
  const body = callbackBody(SCREEN, "continueInChat");
  assert.match(body, /stageLoungeAmoraAskText\(\{ ownerId, text: prompt \}\)/u);
  // 루트 Stack 화면이다. push 는 (tabs) 를 두 벌 만든다(rootStackChatNavigation.test.mjs).
  assert.match(body, /router\.dismissTo\(buildLoungeAmoraAskHref\(askId\) as Href\)/u);
  assert.doesNotMatch(body, /router\.push/u);
  for (const send of SENDS) assert.doesNotMatch(body, send, `「다음에 할 일」이 ${send} 를 부른다`);
  const screen = read(SCREEN);
  assert.match(screen, /import \{ buildLoungeAmoraAskHref, stageLoungeAmoraAskText \} from "@\/lib\/loungeAmoraAsk";/u);
  assert.match(screen, /onPress=\{\(\) => onContinue\(action\.prompt\)\}/u);
  assert.match(screen, /onContinue=\{continueInChat\}/u);
  // 대화 화면은 그 번호를 받는 문을 그대로 가진다. 넣기만 하는지는 loungeAmoraAsk.test.mjs 가 본다.
  assert.match(read(CHAT), /takeLoungeAmoraAsk\(\{ ownerId: userId, id \}\)/u);
});

test("source links open only addresses the shared contract accepted as https, and the table is not re-ranked", () => {
  const screen = read(SCREEN);
  assert.deepEqual([...screen.matchAll(/Linking\.openURL\(([^)]*)\)/gu)].map((match) => match[1]), ["url"]);
  assert.match(screen, /const url = safeAmoraTaskSourceUrl\(source\.url\);/u);
  assert.match(screen, /\{url \? \(/u);
  for (const file of [CARD, OFFER]) assert.doesNotMatch(read(file), /Linking/u);
  // 표의 값은 서버가 저장한 글 그대로다. 화면이 순서를 바꾸거나 점수를 만들지 않는다(계약 I14).
  assert.doesNotMatch(screen, /\.sort\(|\.reverse\(/u);
  assert.match(screen, /result\.rows\.map\(/u);
});

test("the result screen shows stage, review reason, cancel and resume only as the detail allows", () => {
  const screen = read(SCREEN);
  assert.match(screen, /AMORA_TASK_STAGE_LABELS\[detail\.stage\]/u);
  assert.match(screen, /detail\.status === "needs_review" && detail\.reviewReason\s*\? AMORA_TASK_COPY\.reviewReasons\[detail\.reviewReason\]/u);
  assert.match(screen, /\{detail\.resumable \? \(\s*<InvitationButton\s+label=\{AMORA_TASK_COPY\.resume\}/u);
  assert.match(screen, /\{detail\.cancellable \? \(\s*<InvitationButton\s+label=\{AMORA_TASK_COPY\.cancel\}/u);
  assert.match(screen, /onPress=\{\(\) => void act\("resume"\)\}/u);
  assert.match(screen, /onPress=\{\(\) => void act\("cancel"\)\}/u);
  // 누른 뒤에는 다시 읽어 지금 상태를 그린다.
  assert.match(callbackBody(SCREEN, "act"), /await load\(\);/u);
  // 꺼졌으면 이 기능의 글을 그리지 않는다(뒤로 가기만 남는다).
  assert.match(screen, /if \(view\.status === "off" \|\| view\.status === "loading"\) \{[\s\S]*?<AppHeader title="" onBack=\{leave\} \/>/u);
});

test("the cards and the screen refresh on focus and poll only while a task is working", () => {
  const card = read(CARD);
  assert.match(card, /useFocusEffect\(/u);
  assert.match(card, /setInterval\(\(\) => \{\s*if \(workingRef\.current\) void load\(\);\s*\}, AMORA_TASK_HOME_POLL_MS\)/u);
  assert.match(card, /clearInterval\(timer\)/u);
  assert.match(card, /if \(tasks\.length === 0\) return null;/u);
  assert.match(card, /router\.push\(path as Href\)/u);

  const screen = read(SCREEN);
  assert.match(screen, /useFocusEffect\(/u);
  assert.match(screen, /setInterval\(\(\) => \{\s*if \(workingRef\.current\) void load\(\);\s*\}, AMORA_TASK_DETAIL_POLL_MS\)/u);
  assert.match(screen, /return \(\) => clearInterval\(timer\);/u);

  const offer = read(OFFER);
  assert.match(offer, /parseAmoraTaskOffer\(toolOutput\)/u);
  assert.match(offer, /useEffect\(\(\) => \{[\s\S]*?fetchAmoraTaskDetail\(/u);
  assert.match(offer, /if \(phase === "off"\) return null;/u);
});

test("the chat card starts the task only from its 맡기기 button and opens the result screen after", () => {
  const offer = read(OFFER);
  assert.equal(offer.match(/postAmoraTaskAction\(/gu)?.length, 1);
  assert.match(callbackBody(OFFER, "start"), /postAmoraTaskAction\([\s\S]*"start",\s*\)/u);
  assert.match(offer, /label=\{starting \? AMORA_TASK_COPY\.offerStarting : AMORA_TASK_COPY\.offerStart\}\s*onPress=\{\(\) => void start\(\)\}/u);
  assert.match(offer, /label=\{AMORA_TASK_COPY\.offerOpen\}\s*onPress=\{open\}/u);
  assert.match(callbackBody(OFFER, "open"), /router\.push\(path as Href\)/u);
});

test("a gate-blocked start shows the gate's own sentence only through amoraTaskGateReply, and the contract sentence otherwise", () => {
  // 문지기 담당 규칙: verdict 가 allow 가 아니면 맡은 일을 만들지 않고 reply 를 그대로 보인다. 문장 확인은 헬퍼가 한다
  // (헬퍼가 무엇을 버리는지는 amoraTasks.test.mjs 가 본다).
  assert.match(read(OFFER), /^import \{[^}]*\bamoraTaskGateReply,[^}]*\} from "@\/lib\/amoraTasks\.mjs";$/mu);
  // 새로 읽은 모습에서는 지우고(다른 계정의 문장이 남지 않는다), 맡기기 결과에서는 헬퍼를 지난 문장만 둔다.
  // 그 밖에서는 바꾸지 않는다.
  assert.deepEqual(callSites(OFFER, "setGateReply"), ["useEffect: null", "start: amoraTaskGateReply(result)"]);
  // 서버 문장은 맡을 수 없는 모습에서만, 문장이 있을 때만 계약 문장을 대신한다. 다른 자리에 그리지 않는다.
  const drawn = jsxTextExpressions(OFFER).filter((expression) => /\bgateReply\b|AMORA_TASK_COPY\[lineKey\]/u.test(expression));
  assert.deepEqual(drawn, ['phase === "unavailable" && gateReply ? gateReply : AMORA_TASK_COPY[lineKey]']);
  // 확인하지 않은 서버 문장(`result.reply`)을 카드가 바로 읽지 않는다.
  assert.deepEqual(namesSpelled(OFFER, "reply"), []);
});

test("the home and chat cards never trigger the session-expired sign-out", () => {
  for (const file of [CARD, OFFER]) {
    const text = read(file);
    assert.match(text, /apiFetchForExpectedUserQuiet\(ownerId, path/u);
    assert.doesNotMatch(text, /apiFetchForExpectedUser\(/u, `${file}: 401 에 로그아웃 알림을 띄우는 조회를 쓴다`);
    assert.doesNotMatch(text, /\bapiFetch\(|apiJson/u);
  }
  // 결과 화면: 15초마다 다시 읽는 조회는 조용하다. 사람이 누른 그만하기·이어서 하기만 로그인 만료를 알린다.
  const screen = read(SCREEN);
  assert.match(screen, /fetchAmoraTaskDetail\(\s*\(path, init\) => apiFetchForExpectedUserQuiet\(ownerId, path, init\)/u);
  assert.match(screen, /postAmoraTaskAction\(\s*\(path, init\) => apiFetchForExpectedUser\(ownerId, path, init\)/u);
});

test("the new task files add no native module, so they ship over the air", () => {
  const allowed = /^(react|react-native|react-native-safe-area-context|expo-router|@hanbang\/shared\/amora-tasks|@\/components\/(ui|invitation|amoraTasks)\/[A-Za-z]+|@\/lib\/[A-Za-z.]+)$/u;
  for (const file of [CARD, OFFER, SCREEN]) {
    for (const statement of parse(file, read(file)).statements.filter(ts.isImportDeclaration)) {
      assert.match(statement.moduleSpecifier.text, allowed, `${file}: ${statement.moduleSpecifier.text}`);
    }
  }
  // 헬퍼는 공유 계약만 가져온다. 네트워크는 부르는 쪽이 넘긴 fetcher 뿐이다.
  const helper = ts.createSourceFile("amoraTasks.mjs", read("src/lib/amoraTasks.mjs"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(helper.statements.filter(ts.isImportDeclaration).map((statement) => statement.moduleSpecifier.text), ["@hanbang/shared/amora-tasks"]);
  assert.doesNotMatch(read("src/lib/amoraTasks.mjs"), /\bfetch\(/u);
});
