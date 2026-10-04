// 웨딩코드 4.0(v4.0-tendency) 소스가 **약속을 지키고 있는가** — 코드를 열지 않고 소스만 훑는 가드.
//
// ## 무엇을 막나 (설계 9절 12항, 14절 (7))
//
//   1. 글자는 대문자 여덟 개(V S W D U F H A)뿐이다. 상태 글자(B M N ?)나 소문자 변형이 글자처럼 보이지 않는다.
//   2. 화면 문구에 주장 낱말(검증된 정확 과학 진단 점수 등급 궁합 동물 캐릭터 스타일 MBTI 백분율)이 없다.
//   3. 줄표(긴 것, 짧은 것)와 「~인 답」이 없다.
//   4. v4 는 v3.1(과 옛 판) 모듈을 가져오지 않고, v3.1 은 v4 를 가져오지 않는다.
//   5. v4 는 네트워크 요청, 쿠키, 콘솔 호출을 하지 않고, 답이 서버로 갈 길(쿼리 문자열, 계산된 이동 주소, 오류 수집 SDK,
//      통계 SDK)을 열지 않으며, 브라우저 저장소는 storage.ts **한 곳**만 이름을 부른다(클라이언트는 browserStorage() 로 받는다).
//   6. 이용 통계 호출은 이미 고지한 이벤트와 속성만 쓴다(목록은 analyticsPrivacy.ts 를 검사 때 읽는다). 통계 함수는
//      `@/lib/analytics` 의 captureWeddingCodeEvent, captureEvent 로만 부른다(하위 모듈, 다른 이름, 재수출은 막는다).
//   7. 보이는 글자에 A/B, 가나다, 1. 2. 같은 라벨이나 번호가 없다. **부분 검사다**(아래 「한계」).
//   8. 판 이름표는 v4.0-tendency 이고 링크 상수(V40_LINK_KEYS)는 v, a, b 뿐이며, 해시에서 읽고 쓰는 키는 거기에 4.1 단계 2 의 ga, gb 를 더한 다섯이다(쿼리 키는 v 뿐).
//   9. 「검증을 마친 심리검사가 아니」 고지는 시작, 받는 사람, 결과, 두 사람 결과 묶음에 정확히 한 번씩만 있다.
//  10. v4 링크를 여는 앱 쪽 파일(v4 코덱, v4 짐작 코덱, v4 클라이언트를 가져오는 파일)이 생기면 Sentry 주소 꼬리 정제(#473)가 main 에 있어야 한다.
//
// ## 4.1 단계 2(서로 짐작하기, 결과 전 글자 고르기)가 더한 것 (빌드 계획 11.3)
//
//   5 (확장)  저장소 이름은 storage.ts 의 browserStorage 한 함수(localStorage) 안에서만 부른다(이 단계는 이 창의 임시 저장소 sessionStorage 를 쓰지 않는다). 글자 고르기 저장 키(letterGuessKey)는 storage.ts 만 안다.
//   8 (확장)  해시에서 읽고 쓰는 키는 v, a, ga, b, gb. 쿼리 키는 여전히 v 뿐이다. 짐작 코덱의 키 상수는 정확히 ga, gb 다.
//  10 (확장)  짐작 코덱(lib/weddingCode/v40/guess/guessLink)도 v4 링크를 여는 모듈이다.
//  11 (새)    새 단계 파일(guess, letterGuess 폴더와 클라이언트 단계 훅 WeddingCodeV40Client.stage2*)은 통계를 가져오지도 부르지도 않는다.
//  12         비어 있다. 선택 2부(part2)의 격리 규칙 자리이고 2부는 후속 PR 이라 이 단계에는 규칙도 폴더도 없다.
//  13 (새)    글자 고르기 폴더는 링크 코덱, 짐작 폴더, 입구를 가져오지 않는다(고른 글자는 링크에 가지 않는다).
//  14 (새)    새 컴포넌트 폴더는 규칙 7 의 한 글자 문자열 검사를 받는다. 새 lib 폴더와 생성 상수에는 골든 링크와 개발 메모 값이 없다.
//  15 (새)    새 폴더는 바렐(components/wedding-code/v40 의 index, lib 폴더의 ..)을 가져오지 않는다(순환을 막는다).
//  16 (새)    WeddingCodeV40Client.tsx 의 통계 호출은 정확히 열 개이고 이벤트 이름 집합은 고지한 여덟 개 그대로다.
//  17 (새)    새 폴더가 던지는 오류의 메시지에는 입력 글자(템플릿 치환, 이어 붙이기)가 없다.
//   그 밖   새 폴더와 생성 상수의 화면 글에 누가 맞혔는지, 점수, 개수 말이 없다. 엔진 열 개 파일은 4.1 단계 2 기준과 한 글자도 다르지 않다.
//
// ## 한계 (이 파일이 못 하는 것)
//
// 4.1 단계 2 규칙(11, 13, 15)은 **직접 가져오기 한 단계**만 본다: 새 폴더가 통계나 링크 코덱을 가져오는 다른 모듈을 거쳐 닿는 길은 못 본다(통계 쪽은 규칙 6 이
// 모든 v4 소스에서 따로 보지만 링크 코덱 쪽은 사람이 읽어야 한다). 규칙 16 은 클라이언트 본체 한 파일의 호출 식만 센다: 통계를 부르는 다른 파일을 본체가 새로 가져오는 길은 규칙 6 이 이름으로 막는다.
// 엔진 고정은 파일 내용 해시이고 기준 커밋 5ac9eda24 의 값을 옮겨 적은 표다. 이 가드와 표를 같은 사람이 썼다: 표의 해시가 맞는지는 `git show 5ac9eda24:<경로>` 로 다시 잴 수 있다.
//
// 이 파일은 소스 글자를 훑는다. 실행 값은 못 본다. 규칙 7 은 리터럴 모양과 흔한 계산 모양(`{i + 1}`, `{i}/{n}`, `번째` 템플릿,
// fromCharCode, "ABCD"[i], <ol>, list-decimal)만 잡는 **부분 검사**이고, 번호가 다른 함수를 거쳐 오면 못 본다. 규칙 5 의 이동 주소 검사도
// 정적 모양만 본다. 그래서 클라이언트 PR 은 페르소나 브라우저 실행으로 「320x568, 390x844 에서 질문 영역에 앞자리 숫자, n/N, A/B 가 없다」와
// 「완주하는 동안 우리 도메인 밖과 API 로 가는 요청이 없다」를 단언해야 병합한다(계약 문서 15절). 이 가드가 초록불이라는 것은 그 실행 검사를 대신하지 않는다.
//
// ## 어떻게 읽나 — 정규식 주석 제거기가 아니다
//
// 주석을 정규식으로 걷어내는 방식은 줄 끝 `//` 를 놓쳤다(문자열 안의 `https://` 를 주석으로 읽거나 그 반대).
// 여기서는 TypeScript 파서로 소스를 읽어 **문자열 리터럴, 템플릿 문자열, JSX 글자만** 뽑는다. 주석은 트리에 없다.
// 그래서 왜 없앴는지 적은 주석 속 낱말(예: 「검증된 표현은 쓰지 않는다」)은 걸리지 않고, 코드가 내보내는 문자열은
// 줄 끝 주석이 뒤에 붙어 있어도 걸린다. 마지막 시험 「검사기가 실제로 잡는다」가 그것을 표본으로 잰다.
//
// ## 허용하는 부정문 — 단 하나
//
// 설계 문서는 「진단」 「궁합」 「점수」 를 부정하는 문장(예: 성격을 진단하는 검사가 아니에요)을 **허용하지 않는다**.
// 9절 12항이 「자기 문구에서 실패하지 않게 예외 없이 문구를 고침」이라고 적었다. 허용되는 것은 고지 문장 하나,
// 「검증을 마친 심리검사가 아니」(copy.ts 의 V40_NOT_VALIDATED_PHRASE)뿐이다. 그 밖의 어떤 새 출현도 실패한다.
//
// ## 파일이 아직 없을 때
//
// 아직 없는 파일(WeddingCodeV40*.tsx, storage.ts 등)은 건너뛰고 이유를 진단으로 남긴다. 그러나 **있는 파일은 반드시 훑는다** —
// 파일이 있는데 문자열이 0개 뽑히면(파서가 깨졌거나 경로가 어긋남) 조용히 통과하지 않고 실패한다.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WEB_SRC = join(repoRoot, "apps/web/src");

const posix = (p) => p.split("\\").join("/");
const rel = (p) => posix(relative(repoRoot, p));

const PATHS = {
  lib: join(WEB_SRC, "lib/weddingCode/v40"),
  components: join(WEB_SRC, "components/wedding-code/v40"),
  constants: join(WEB_SRC, "constants"),
  app: join(WEB_SRC, "app/wedding-code"),
  legacyLib: join(WEB_SRC, "lib/weddingCode"),
  bankJson: join(repoRoot, "docs/wedding-code/2026-09-29_v40_items.json"),
  analyticsPrivacy: join(WEB_SRC, "lib/analyticsPrivacy.ts"),
  analytics: join(WEB_SRC, "lib/analytics"),
  constantsMain: join(WEB_SRC, "constants/weddingCodeV40.ts"),
  copy: join(WEB_SRC, "lib/weddingCode/v40/copy.ts"),
  codec: join(WEB_SRC, "lib/weddingCode/v40/codec.ts"),
  storage: join(WEB_SRC, "lib/weddingCode/v40/storage.ts"),
  // v3.1 과 v4 가 함께 쓰는 저장소 핸들 도우미. 저장소 이름(window.localStorage)은 이 파일의 realLocalStorage 한 함수 안에만 있다.
  storageHandle: join(WEB_SRC, "lib/weddingCode/browserStorageHandle.ts"),
  client: join(WEB_SRC, "app/wedding-code/WeddingCodeV40Client.tsx"),
  guessLink: join(WEB_SRC, "lib/weddingCode/v40/guess/guessLink.ts"),
  guessConstants: join(WEB_SRC, "constants/weddingCodeV40Guess.ts"),
  v31Progress: join(WEB_SRC, "lib/weddingCode/v31LocalProgress.ts"),
  v31Hook: join(WEB_SRC, "app/wedding-code/useV31LocalProgress.ts"),
  sentryScrub: join(repoRoot, "packages/shared/src/safety/sentryScrub.ts"),
};

// ---------------------------------------------------------------------------
// 고정 값 (설계 문서에서 옮겼다. 바꾸려면 판을 올릴지부터 정한다)
// ---------------------------------------------------------------------------

const VERSION_TAG = "v4.0-tendency";
const ALLOWED_LETTERS = ["V", "S", "W", "D", "U", "F", "H", "A"];
/** 링크 키 상수(V40_LINK_KEYS)의 값. 4.1 단계 2 도 이 상수는 바꾸지 않는다(짐작 키는 V40_GUESS_LINK_KEYS 가 따로 갖는다). */
const LINK_KEY_CONSTANT = ["a", "b", "v"];
/** 4.1 단계 2 가 더한 짐작 키. ga 는 a 옆, gb 는 b 옆이고 v4.0-tendency 해시에서만 쓴다. */
const GUESS_LINK_KEYS = ["ga", "gb"];
/** 해시에서 읽거나 쓰는 키 전부(링크 키 상수 + 짐작 키). 쿼리에는 이 가운데 어느 것도 싣지 않는다. */
const ALLOWED_HASH_KEYS = [...LINK_KEY_CONSTANT, ...GUESS_LINK_KEYS];
/** 허용하는 유일한 부정문(설계 6절, 9절 1항). copy.ts 의 V40_NOT_VALIDATED_PHRASE 와 같아야 한다. */
const NOT_VALIDATED_PHRASE = "검증을 마친 심리검사가 아니";
/** 고지가 정확히 한 번 있어야 하는 화면 묶음(copy.ts 의 V40_COPY 최상위 키)과 없어야 하는 묶음. */
const NOTICE_GROUPS_ONE = ["intro", "receive", "result", "couple"];
const PLACEHOLDER = "\uE000";
const HANGUL = /[가-힣]/u;

const cp = (...codes) => codes.map((code) => String.fromCodePoint(code)).join("");

// ---------------------------------------------------------------------------
// 파일 찾기
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", "__tests__", "__mocks__", ".next", "coverage"]);
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const isTestName = (name) => /\.(test|spec)\./u.test(name);
const isSourceName = (name) => CODE_EXT.test(name) && !/\.d\.ts$/u.test(name) && !isTestName(name);

function walk(dir, accept) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full, accept));
    } else if (accept(entry.name, full)) {
      out.push(full);
    }
  }
  return out.sort();
}

const fileInfo = (abs, group) => ({ abs, rel: rel(abs), base: basename(abs), group });

/** v4 소스(시험 파일 제외). group: lib, components, constants, app. */
function discoverV40() {
  const files = [];
  for (const abs of walk(PATHS.lib, isSourceName)) files.push(fileInfo(abs, "lib"));
  for (const abs of walk(PATHS.components, isSourceName)) files.push(fileInfo(abs, "components"));
  if (existsSync(PATHS.constants)) {
    for (const name of readdirSync(PATHS.constants).sort()) {
      if (/^weddingCodeV40/u.test(name) && isSourceName(name)) files.push(fileInfo(join(PATHS.constants, name), "constants"));
    }
  }
  const appHits = walk(PATHS.app, (name, full) => {
    if (!isSourceName(name)) return false;
    return posix(relative(PATHS.app, full)).split("/").some((segment) => /^WeddingCodeV40/u.test(segment));
  });
  for (const abs of appHits) files.push(fileInfo(abs, "app"));
  return files;
}

/** v3.1 소스(시험 파일 포함: v3.1 파일은 한 글자도 바꾸지 않는다). */
function discoverV31() {
  const all = (name) => CODE_EXT.test(name) && !/\.d\.ts$/u.test(name);
  const files = [];
  for (const abs of walk(PATHS.app, (name) => all(name) && /^(WeddingCodeV31|useV31)/u.test(name))) files.push(fileInfo(abs, "v31"));
  for (const abs of walk(PATHS.legacyLib, (name, full) => all(name) && /^(v31|useV31)/u.test(name) && dirname(full) === PATHS.legacyLib)) files.push(fileInfo(abs, "v31"));
  for (const abs of walk(join(PATHS.legacyLib, "v31"), all)) files.push(fileInfo(abs, "v31"));
  if (existsSync(PATHS.constants)) {
    for (const name of readdirSync(PATHS.constants).sort()) {
      if (/^weddingCodeV31/u.test(name) && all(name)) files.push(fileInfo(join(PATHS.constants, name), "v31"));
    }
  }
  return files;
}

const V40_FILES = discoverV40();
const V31_FILES = discoverV31();
const byBase = (name) => V40_FILES.filter((f) => f.base === name);
const COPY_FILE = V40_FILES.find((f) => f.abs === PATHS.copy) ?? null;
const CONSTANTS_FILE = V40_FILES.find((f) => f.abs === PATHS.constantsMain) ?? null;

// ---------------------------------------------------------------------------
// 4.1 단계 2 의 새 폴더 (규칙 11, 13에서 17과 단어 규칙이 보는 범위)
// ---------------------------------------------------------------------------

/**
 * 4.1 단계 2 가 더한 폴더 이름: guess(서로 짐작하기), letterGuess(결과 전 글자 고르기).
 * 선택 2부(part2)는 후속 PR 이라 폴더도 규칙도 없다. 2부를 더하는 PR 이 이 목록과 규칙 12 를 함께 더한다.
 */
const STAGE_FOLDERS = ["guess", "letterGuess"];
const GUESS_LIB_DIR = join(PATHS.lib, "guess");
const LETTER_LIB_DIR = join(PATHS.lib, "letterGuess");
const GUESS_COMPONENT_DIR = join(PATHS.components, "guess");
const LETTER_COMPONENT_DIR = join(PATHS.components, "letterGuess");
const STAGE_LIB_DIRS = STAGE_FOLDERS.map((name) => join(PATHS.lib, name));
const STAGE_COMPONENT_DIRS = STAGE_FOLDERS.map((name) => join(PATHS.components, name));
/** 통합자가 만드는 클라이언트 단계 훅(WeddingCodeV40Client.stage2.tsx 와 이름이 같은 길의 파일들). 아직 없으면 자리만 있다. */
const STAGE2_APP_FILE = /^WeddingCodeV40Client\.stage2/u;

const isUnderDir = (abs, dir) => posix(abs).startsWith(`${posix(dir)}/`);
const inAnyDir = (abs, dirs) => dirs.some((dir) => isUnderDir(abs, dir));

/** 새 단계 파일: 새 lib 폴더, 새 컴포넌트 폴더, 클라이언트 단계 훅. 시험 파일은 처음부터 V40_FILES 에 없다. */
const stageFiles = () => V40_FILES.filter((f) => inAnyDir(f.abs, [...STAGE_LIB_DIRS, ...STAGE_COMPONENT_DIRS]) || (f.group === "app" && STAGE2_APP_FILE.test(f.base)));
/** 결과 전 글자 고르기 폴더(lib와 컴포넌트). */
const letterGuessFiles = () => V40_FILES.filter((f) => inAnyDir(f.abs, [LETTER_LIB_DIR, LETTER_COMPONENT_DIR]));
/** 새 lib 폴더와 새 컴포넌트 폴더의 파일(훅은 뺀다). 바렐 순환과 오류 메시지 규칙이 본다. */
const stageFolderFiles = () => V40_FILES.filter((f) => inAnyDir(f.abs, [...STAGE_LIB_DIRS, ...STAGE_COMPONENT_DIRS]));

/**
 * 문자열 규칙에서 빼는 파일과 이유. 이유가 지금도 참이어야 빠질 수 있다(시험 「측정기가 살아 있다」가 확인한다).
 * bank.ts 는 문항 은행 검사기라서 금지어 목록과 검사 메시지 자체를 문자열로 갖는다.
 */
const STRING_RULE_EXEMPT = new Map([
  ["bank.ts", { needle: "BANK_BANNED_WORDS", why: "금지어 목록(BANK_BANNED_WORDS)과 검사 메시지를 담은 은행 검사기" }],
]);
const isExempt = (file) => file.group === "lib" && STRING_RULE_EXEMPT.has(file.base);

// ---------------------------------------------------------------------------
// 소스 읽기 (TypeScript 파서)
// ---------------------------------------------------------------------------

const TEXT_ATTRS = new Set([
  "aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder",
  "title", "alt", "placeholder", "label", "description", "caption", "heading", "helperText",
]);

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isStatementLike = (node) => ts.isSourceFile(node) || (node.kind >= ts.SyntaxKind.FirstStatement && node.kind <= ts.SyntaxKind.LastStatement);

/** 문자열이 **글**이 아닌 자리(모듈 경로, 속성 이름, 타입 자리, 배열 색인). */
function isNonTextPosition(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isImportAttribute?.(p)) return true;
  if (ts.isComputedPropertyName(p)) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
    || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isModuleDeclaration(p)) && p.name === node) return true;
  if ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isBindingElement(p)) && (p.propertyName === node || p.name === node)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === node
    && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === "require"))) return true;
  return false;
}

/** assert, invariant 로 가져온 이름들(node:assert, assert, tiny-invariant). 그 밖의 assert 라는 이름은 개발자 메시지의 표시가 아니다. */
const ASSERT_MODULES = /^(?:node:)?assert(?:\/strict)?$|^(?:tiny-)?invariant$/u;
function assertNamesOf(sf) {
  const names = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !ASSERT_MODULES.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) names.add(element.name.text);
  }
  return names;
}

/**
 * throw 문 안, 또는 node:assert 에서 가져온 assert 호출 안의 문자열인가(개발자에게만 보이는 메시지).
 *
 * **좁게 본다.** 예전에는 이름이 Error 로 끝나는 호출이면 무엇이든 개발자 메시지로 읽었는데, setError("…"), showError("…") 는
 * 화면에 글을 내보내는 호출이라 그 안의 금지어가 모든 문자열 규칙을 피해 갔다. 이제 화면으로 가는 길이 될 수 없는 두 자리만 뺀다.
 */
function isDevMessage(node) {
  let assertNames = null;
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isThrowStatement(n)) return true;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const head = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression : null;
      if (head) {
        assertNames ??= assertNamesOf(node.getSourceFile());
        if (assertNames.has(head.text)) return true;
      }
    }
    if (isStatementLike(n) || ts.isFunctionLike(n)) return false;
  }
  return false;
}

/** 문자열이 JSX 안에서 어떤 자리인가: { attr } 이면 속성 값, { child: true } 이면 글자로 그려지는 자리. */
function jsxContext(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) return { attr: ts.isIdentifier(n.name) ? n.name.text : n.name.getText() };
    if (ts.isJsxExpression(n) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) return { child: true };
    if (ts.isFunctionLike(n) || isStatementLike(n)) return null;
  }
  return null;
}

const isPlusConcat = (node) => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

/** 문자열 리터럴만 +로 이은 식이면 이은 글, 아니면 null. 「검」 + 「증된」처럼 쪼개 쓴 말도 한 글로 읽는다. */
function literalConcat(node) {
  const e = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (isPlusConcat(e)) {
    const left = literalConcat(e.left);
    const right = literalConcat(e.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

/** 소스에서 문자열 리터럴, 템플릿, JSX 글자를 뽑는다. 주석은 트리에 없어서 나오지 않는다. */
function extractStrings(sf) {
  const out = [];
  const add = (node, text, kind, extra = {}) => {
    const ctx = kind === "jsxtext" ? { child: true } : jsxContext(node);
    const attr = ctx && ctx.attr ? ctx.attr : null;
    const visible = kind === "jsxtext" || Boolean(ctx && ctx.child) || (attr !== null && TEXT_ATTRS.has(attr));
    out.push({ text, kind, line: lineOf(sf, node), pos: node.getStart(sf), attr, visible, dev: kind === "jsxtext" ? false : isDevMessage(node), ...extra });
  };
  const visit = (node) => {
    if (isPlusConcat(node) && literalConcat(node) !== null) {
      add(node, literalConcat(node), "string");
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isNonTextPosition(node)) add(node, node.text, "string");
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join("");
      add(node, text, "template", { exprs: node.templateSpans.map((span) => span.expression.getText(sf)) });
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/gu, " ").trim();
      if (text !== "") add(node, text, "jsxtext");
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 모듈 경로: import, export from, require, 동적 import, import 타입. */
function extractImports(sf) {
  const out = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ spec: node.moduleSpecifier.text, line: lineOf(sf, node), kind: "static", node });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      out.push({ spec: node.moduleReference.expression.text, line: lineOf(sf, node), kind: "static", node });
    } else if (ts.isCallExpression(node)) {
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamic || isRequire) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) out.push({ spec: arg.text, line: lineOf(sf, node), kind: isDynamic ? "dynamic" : "require", node });
        else out.push({ spec: null, line: lineOf(sf, node), kind: isDynamic ? "dynamic" : "require", node });
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push({ spec: node.argument.literal.text, line: lineOf(sf, node), kind: "type", node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function scriptKindOf(fileName) {
  if (/\.(tsx|jsx)$/u.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.(js|mjs|cjs)$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function analyzeText(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const syntaxErrors = (sf.parseDiagnostics ?? []).map((d) => {
    const { line } = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0) : { line: 0 };
    return `${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  return { sf, text, fileName, syntaxErrors, strings: extractStrings(sf), imports: extractImports(sf) };
}

const analysisCache = new Map();
function load(file) {
  if (!analysisCache.has(file.abs)) analysisCache.set(file.abs, analyzeText(readFileSync(file.abs, "utf8"), file.abs));
  return analysisCache.get(file.abs);
}

function loadPath(abs) {
  return load({ abs, rel: rel(abs), base: basename(abs), group: "aux" });
}

// ---------------------------------------------------------------------------
// 정적 값 읽기 (상수 파일과 허용 목록)
// ---------------------------------------------------------------------------

function topLevelDecl(sf, name) {
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer;
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === name) return statement;
  }
  return null;
}

/** 리터럴로만 이뤄진 식의 값. as const, satisfies, 괄호는 벗긴다. 그 밖의 식은 던진다. */
function evalLiteral(node) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) return evalLiteral(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -evalLiteral(node.operand);
  if (ts.isBinaryExpression(node)) {
    // 30 * 24 * 60 * 60 * 1000 같은 숫자 식(저장 기간 상수).
    const left = evalLiteral(node.left);
    const right = evalLiteral(node.right);
    if (typeof left === "number" && typeof right === "number") {
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken: return left * right;
        case ts.SyntaxKind.PlusToken: return left + right;
        case ts.SyntaxKind.MinusToken: return left - right;
        case ts.SyntaxKind.SlashToken: return left / right;
        default: break;
      }
    }
    if (typeof left === "string" && typeof right === "string" && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        throw new Error(`정적으로 읽을 수 없는 속성: ${ts.SyntaxKind[prop.kind]}`);
      }
      out[prop.name.text] = evalLiteral(prop.initializer);
    }
    return out;
  }
  throw new Error(`정적으로 읽을 수 없는 식: ${ts.SyntaxKind[node.kind]}`);
}

function constValue(analysis, name) {
  const init = topLevelDecl(analysis.sf, name);
  assert.ok(init, `${rel(analysis.fileName)} 에서 ${name} 를 찾지 못했다 — 이름이 바뀌었으면 이 가드도 함께 고칠 것`);
  return evalLiteral(init);
}

// ---------------------------------------------------------------------------
// 규칙 본체: 순수 함수 (표본으로 자가 시험한다)
// ---------------------------------------------------------------------------

const userFacing = (rec) => rec.visible || HANGUL.test(rec.text);

// --- 규칙 1: 글자 ---------------------------------------------------------

const STANDALONE_CAPITAL = /(?<![A-Za-z])[A-Z](?![A-Za-z])/gu;
const STANDALONE_LOWER = /(?<![A-Za-z0-9_])[a-z](?![A-Za-z0-9_])/gu;
const LONE_QUESTION_MARK = /(?:^|[\s「『"'“‘(\[])\?(?:$|[\s」』"'”’)\].,])/u;

function letterHits(rec) {
  const hits = [];
  const text = rec.text;
  const trimmed = text.trim();
  // 글자 하나짜리 문자열은 어디에 있든 본다(상태 글자 B 를 영문 상수 파일에 숨길 수 없다).
  if (/^[A-Z]$/u.test(trimmed) && !ALLOWED_LETTERS.includes(trimmed)) hits.push(`글자 ${trimmed} 는 여덟 글자가 아니다`);
  if (trimmed === "?") hits.push("상태 글자 ? 가 글자처럼 쓰였다");
  // 문장 속 낱글자는 한국어 문구나 화면에 그려지는 글에서만 본다(클래스 이름, 키 이름은 글자가 아니다).
  if (!HANGUL.test(text) && !rec.visible) return hits;
  if (trimmed !== "?" && LONE_QUESTION_MARK.test(text)) hits.push("상태 글자 ? 가 글자처럼 보인다");
  for (const match of text.matchAll(STANDALONE_CAPITAL)) {
    if (!ALLOWED_LETTERS.includes(match[0]) && trimmed !== match[0]) hits.push(`글자 ${match[0]} 는 여덟 글자가 아니다`);
  }
  if (HANGUL.test(text)) {
    for (const match of text.matchAll(STANDALONE_LOWER)) hits.push(`소문자 ${match[0]} 가 글자처럼 보인다`);
  }
  return hits;
}

// --- 규칙 2: 주장 낱말 ---------------------------------------------------

/** 묶음 어디에서나 금지(문항 은행 포함). 부분 문자열로 찾는다. */
const CLAIM_WORDS = [
  ["검증", /검증/u], ["정확", /정확/u], ["과학", /과학/u], ["진단", /진단/u], ["점수", /점수/u], ["등급", /등급/u],
  ["궁합", /궁합/u], ["동물", /동물/u], ["캐릭터", /캐릭터/u], ["스타일", /스타일/u],
];
/**
 * 결과 문구와 화면 글에서만 금지(문항 은행의 자연스러운 말은 막지 않는다).
 * 4.1 단계 1(CLAUDE.md 2026-09-30 항목)이 더한 말: 본인도 모르는 속을 읽어 냈다고 주장하는 말(속마음, 무의식, 본모습, 숨은 성향·마음·이유)과
 * 사람을 단정하는 말(당신은, 모순, 일관성). 맨 「숨은」은 다른 뜻으로도 쓰여서(숨은 트이는 순간) 성향, 마음, 이유가 뒤따를 때만 잡는다.
 */
const CLAIM_WORDS_TEXT_ONLY = [
  ["성격", /성격/u], ["잘 맞음", /잘\s?맞/u],
  ["속마음", /속마음/u], ["무의식", /무의식/u], ["본모습", /본모습/u], ["모순", /모순/u], ["일관성", /일관성/u], ["당신은", /당신은/u],
  ["숨은 성향·마음·이유", /숨은\s?(?:성향|마음|이유)/u],
];
const PERCENT_WORDS = /퍼센트|백분율|퍼센티지/u;
const PERCENT_SIGN = /[%％﹪]/u;
const MBTI_WORD = /mbti|엠비티아이/iu;
/**
 * 같은 주장을 영어로 쓴 말.
 * ENGLISH_CLAIMS 는 모든 문자열에서 본다(이런 낱말이 키나 클래스 이름으로 쓸 일이 없다).
 * ENGLISH_CLAIMS_SHOWN 은 score, grade 처럼 코드 이름에도 쓰일 수 있는 말이라 화면에 보이는 글과 한국어가 섞인 글에서만 본다.
 */
const ENGLISH_CLAIMS = /\b(?:validated|scientific(?:ally)?|diagnos\w*|accurate(?:ly)?|accuracy|compatib\w*|personality|horoscope|zodiac)\b/iu;
const ENGLISH_CLAIMS_SHOWN = /\b(?:scores?|scoring|grades?|percent(?:age)?)\b/iu;

function claimHits(rec, set) {
  const hits = [];
  const text = rec.text.normalize("NFC");
  if (MBTI_WORD.test(text)) hits.push("MBTI");
  if (ENGLISH_CLAIMS.test(text)) hits.push("영어 주장 낱말");
  if (!userFacing(rec)) return hits;
  if (ENGLISH_CLAIMS_SHOWN.test(text)) hits.push("영어 주장 낱말");
  const stripped = text.split(NOT_VALIDATED_PHRASE).join("");
  for (const [id, re] of CLAIM_WORDS) if (re.test(stripped)) hits.push(id);
  if (set === "text") for (const [id, re] of CLAIM_WORDS_TEXT_ONLY) if (re.test(stripped)) hits.push(id);
  if (PERCENT_WORDS.test(text) || PERCENT_SIGN.test(text)) hits.push("백분율");
  return hits;
}

// --- 규칙 3: 줄표, ~인 답 -------------------------------------------------

const DASH_CHARS = new RegExp(`[${cp(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d)}]`, "u");
const SPACED_HYPHEN = /(?:^|\s)-{1,2}(?:\s|$)/u;

function styleHits(rec) {
  const hits = [];
  const text = rec.text;
  if (DASH_CHARS.test(text)) hits.push("줄표");
  if (userFacing(rec) && HANGUL.test(text) && SPACED_HYPHEN.test(text)) hits.push("줄표 대신 붙임표");
  if (userFacing(rec) && (/인\s?답(?![가-힣])/u.test(text) || /[~〜～]\s*인\s?답/u.test(text))) hits.push("~인 답");
  return hits;
}

// --- 규칙 7: 라벨과 번호 ---------------------------------------------------

/**
 * 한글 순서 라벨: 가 나 다 라 마 바 사 아 자 차 카 타 파 하.
 * 「가-하」 범위 전체를 쓰지 않는다. 그 범위는 흔한 음절 대부분을 덮어서 「칸」 「예」 같은 정상 글자를 잡는다.
 */
const HANGUL_ORDINALS = "가나다라마바사아자차카타파하";
const LABEL_CHAR = `[A-Z${HANGUL_ORDINALS}]`;
const LABEL_SINGLE = new RegExp(`^${LABEL_CHAR}$`, "u");
const LABEL_ONLY = new RegExp(`^(?:${LABEL_CHAR}|\\d{1,3})\\s*[.)．]?$`, "u");
const LABEL_PAREN = new RegExp(`^[(（]\\s*(?:[A-Za-z${HANGUL_ORDINALS}]|\\d{1,3})\\s*[)）]$`, "u");
const LABEL_PREFIX = new RegExp(`^\\s*[(（\\[]?\\s*(?:\\d{1,3}|[A-Za-z${HANGUL_ORDINALS}])\\s*[.)）\\]．]\\s*\\S`, "u");
const CAPTION_NUMBERING = [
  new RegExp(`^\\s*[(（\\[]?\\s*(?:\\d+|[A-Za-z${HANGUL_ORDINALS}]|[${cp(0x2460)}-${cp(0x2473)}${cp(0x2474)}-${cp(0x2487)}])\\s*[.)）\\]．:：、]`, "u"),
  /^\s*(?:Q|질문|문항|No)\.?\s*\d+/iu,
  /^\s*[0-9０-９]/u,
];
const TEMPLATE_NUMBERING = new RegExp("^[(（\\[]?" + PLACEHOLDER + "\\s*[.)）\\]．]\\s*", "u");
const OPTION_LABEL_NEAR_WORD = [/(?:카드|보기|선택지|항목)\s*[A-Z](?![A-Za-z])/u, /(?<![A-Za-z])[A-Z]\s*(?:카드|보기|선택지)/u];

/**
 * where.components: 화면 컴포넌트(글자 하나짜리 문자열, 보이는 번호)
 * where.bank: 문항 은행 글(앞에 붙은 라벨)
 * where.text: 상수와 문구 파일(앞에 붙은 라벨)
 */
function labelHits(rec, where) {
  const hits = [];
  const text = rec.text;
  const trimmed = text.trim();
  if (where.components && LABEL_SINGLE.test(trimmed)) hits.push("글자 하나짜리 문자열(옵션 라벨처럼 보인다)");
  if (where.components && rec.visible && (LABEL_ONLY.test(trimmed) || LABEL_PAREN.test(trimmed))) hits.push("보이는 라벨/번호");
  if (where.components && rec.kind === "template" && TEMPLATE_NUMBERING.test(text)) hits.push("번호를 붙이는 템플릿");
  const prefixScope = where.bank || where.text || (where.components && rec.visible);
  if (prefixScope && (HANGUL.test(text) || rec.visible) && LABEL_PREFIX.test(text)) hits.push("앞에 붙은 라벨/번호");
  if (HANGUL.test(text)) for (const re of OPTION_LABEL_NEAR_WORD) if (re.test(text)) hits.push("카드/보기 옆 알파벳 라벨");
  return hits;
}

/** JSX 에서 {식} 바로 뒤에 「. 글」이 붙은 번호 매기기 모양. */
function jsxNumberingHits(analysis) {
  const hits = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children;
      for (let i = 0; i + 1 < kids.length; i += 1) {
        if (ts.isJsxExpression(kids[i]) && ts.isJsxText(kids[i + 1]) && /^[.)．]\s+\S/u.test(kids[i + 1].text)) {
          hits.push({ line: lineOf(analysis.sf, kids[i]), what: "식 바로 뒤에 「. 글」(번호 매기기 모양)" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(analysis.sf);
  return hits;
}

/** 값을 그대로 번호로 그리는 이름. 세는 값(count, total)은 번호가 아니라서 넣지 않는다. */
const INDEX_NAME = /^(?:i|j|k|n|idx|index|num|number|no|step|position|pos|cursor|order|ordinal|\w+Index|\w+Idx|\w+Number|\w+Ordinal)$/u;
/** 알파벳이나 가나다 순서 문자열(선택지 라벨을 계산해 만드는 재료). */
const ALPHABET_RUN = /ABC|abc|가나다/u;
/** 목록 번호를 브라우저나 CSS 가 매기게 하는 클래스와 값. */
const LIST_NUMBERING_CLASS = /(?:^|[\s:"'`[])(?:list-decimal|list-(?:upper|lower)-(?:alpha|latin|roman)|list-\[[^\]]*\]|counter-(?:increment|reset|set)|\[counter-[a-z-]+:)/u;
const LIST_STYLE_KEYWORD = /^(?:decimal(?:-leading-zero)?|(?:upper|lower)-(?:alpha|latin|roman)|korean-hangul-formal|hangul|hangul-consonant|cjk-ideographic)$/u;
/** 템플릿 문자열이 번호를 붙이는 모양(값 + 번째, 값/값, 질문 값). 「질문 68개」처럼 세는 말은 뒤 낱말로 걸러낸다. */
const TEMPLATE_COUNTERS = [
  [new RegExp(`${PLACEHOLDER}\\s*번째`, "u"), "값 + 번째"],
  [new RegExp(`${PLACEHOLDER}\\s*[/／]\\s*${PLACEHOLDER}`, "u"), "값/값(n/N 진행 표시)"],
  [new RegExp(`(?:질문|문항|화면|카드|보기|선택지|단계|Q|No\\.?)\\s*${PLACEHOLDER}(?![가-힣]*[개칸가명줄장])`, "u"), "질문/카드 + 값"],
];

/** 표 색인에 쓸 수 있는 글자표: 문자열 리터럴이나 한 글자 문자열만 든 배열(const 한 단계까지). */
function labelTable(expr, depth = 0) {
  if (depth > 2) return null;
  const e = peel(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isArrayLiteralExpression(e) && e.elements.length > 1 && e.elements.every((x) => ts.isStringLiteral(x) && x.text.length === 1)) return e.elements.map((x) => x.text).join("");
  if (ts.isIdentifier(e)) {
    const init = findConstInit(e);
    if (init && !ts.isFunctionLike(init)) return labelTable(init, depth + 1);
  }
  return null;
}

/**
 * 계산해서 그리는 번호(파운더 노트 1: 질문 번호와 선택지 라벨이 화면에 없다). **부분 검사다**: 아래 모양만 본다.
 * `{i + 1}`, `{i}`(인덱스 이름), `{i}/{n}`, `{i}번째`, `${i}번째 질문`, `String.fromCharCode(…)`, `"ABCD"[i]`, 알파벳 순서 문자열, `<ol>`, list-decimal 계열.
 */
function numberingHits(analysis) {
  const hits = [];
  const sf = analysis.sf;
  const add = (node, what) => hits.push({ line: lineOf(sf, node), what });
  const isChildExpression = (node) => ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent));
  const isNumeric = (e) => ts.isNumericLiteral(peel(e));
  const visit = (node) => {
    if (isChildExpression(node)) {
      const e = peel(node.expression);
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken && isNumeric(e.left) !== isNumeric(e.right)) add(node, "식 + 숫자를 그대로 그림(번호 매기기 모양)");
      if ((ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) && (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) add(node, "증가한 값을 그대로 그림(번호 매기기 모양)");
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (name !== null && INDEX_NAME.test(name)) {
        // 「{n}개」 「{n}칸」 처럼 뒤에 세는 낱말이 붙으면 번호가 아니라 개수다.
        const siblings = node.parent.children;
        const next = siblings[siblings.indexOf(node) + 1];
        const counted = next && ts.isJsxText(next) && /^\s*[개칸가명줄장분곳초]/u.test(next.text);
        if (!counted) add(node, `인덱스처럼 보이는 값 ${name} 을 그대로 그림`);
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children;
      for (let i = 1; i < kids.length; i += 1) {
        const kid = kids[i];
        if (!ts.isJsxText(kid) || !isChildExpression(kids[i - 1])) continue;
        if (/^\s*번째/u.test(kid.text)) add(kid, "{값}번째(순서 번호)");
        if (/^\s*(?:[/／]|of|중)\s*$/iu.test(kid.text) && kids[i + 1] && isChildExpression(kids[i + 1])) add(kid, "{값}/{값}(n/N 진행 표시)");
      }
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === "ol") add(node, "<ol> 은 브라우저가 번호를 매긴다");
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^(?:fromCharCode|fromCodePoint)$/u.test(node.expression.name.text)) add(node, "코드 값에서 글자를 만든다(A/B 라벨을 계산하는 모양)");
    if (ts.isElementAccessExpression(node)) {
      const table = labelTable(node.expression);
      if (table !== null && /^[A-Za-z가나다라마바사아자차카타파하]{2,}$/u.test(table)) add(node, `글자표 「${table.slice(0, 12)}」 를 색인으로 읽는다(선택지 라벨)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const rec of analysis.strings) {
    if (rec.dev) continue;
    if (ALPHABET_RUN.test(rec.text)) hits.push({ line: rec.line, what: `알파벳/가나다 순서 문자열 「${rec.text.slice(0, 20)}」(선택지 라벨의 재료)` });
    if (LIST_NUMBERING_CLASS.test(rec.text) || LIST_STYLE_KEYWORD.test(rec.text.trim())) hits.push({ line: rec.line, what: `목록 번호를 매기는 스타일 「${rec.text.trim().slice(0, 30)}」` });
    if (rec.kind === "template" && userFacing(rec)) {
      for (const [re, what] of TEMPLATE_COUNTERS) if (re.test(rec.text)) hits.push({ line: rec.line, what: `번호를 붙이는 템플릿(${what})` });
    }
  }
  return hits;
}

// --- 규칙 4: 가져오기 ------------------------------------------------------

function resolveSpecifier(spec, fromAbs) {
  if (spec.startsWith("@/")) return join(WEB_SRC, spec.slice(2));
  if (spec.startsWith(".")) return resolve(dirname(fromAbs), spec);
  return null;
}
const relToWeb = (abs) => posix(relative(WEB_SRC, abs));

const V31_MODULES = [
  /^app\/wedding-code\/(weddingcodev31|usev31)/iu,
  /^lib\/weddingcode\/v31/iu,
  /^constants\/weddingcodev31/iu,
];
/** v3.1 보다 오래된 판. v40 은 (?!40) 으로 뺀다. */
const OLDER_MODULES = [
  /^app\/wedding-code\/weddingcodev(?!40)\d/iu,
  /^lib\/weddingcode\/v(?!40)\d/iu,
  /^constants\/weddingcodev(?!40)\d/iu,
];
const V40_MODULES = [
  /^app\/wedding-code\/weddingcodev40/iu,
  /^lib\/weddingcode\/v40/iu,
  /^components\/wedding-code\/v40/iu,
  /^constants\/weddingcodev40/iu,
];

function importHits(analysis, patterns) {
  const hits = [];
  for (const imp of analysis.imports) {
    if (imp.spec === null) {
      hits.push({ line: imp.line, what: `${imp.kind} 가져오기의 경로가 문자열 리터럴이 아니라서 검사할 수 없다` });
      continue;
    }
    const resolved = resolveSpecifier(imp.spec, analysis.fileName);
    if (resolved === null) continue;
    const target = relToWeb(resolved);
    const found = patterns.find(([, re]) => re.test(target));
    if (found) hits.push({ line: imp.line, what: `${found[0]}: ${imp.spec}` });
  }
  return hits;
}

// --- 규칙 5: 네트워크, 쿠키, 콘솔, 저장소 --------------------------------------

const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self", "global"]);
const NETWORK_IDENTIFIERS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
const STORAGE_IDENTIFIERS = new Set(["localStorage", "sessionStorage", "indexedDB"]);
/**
 * 요청을 보낼 수 있는 패키지. 오류 수집(Sentry)과 통계(PostHog 등) SDK 도 여기 든다: 답이나 글자를 breadcrumb, 컨텍스트, 이벤트로 실어
 * 보낼 수 있는 길이라서, v4 는 고지한 통계 호출(@/lib/analytics 의 captureWeddingCodeEvent, captureEvent) 밖에 이런 길을 열지 않는다.
 */
const NETWORK_PACKAGES = /^(axios|ky|got|node-fetch|undici|swr|@tanstack\/react-query|@supabase\/.+|@sentry\/.+|sentry|posthog|posthog-js|posthog-node|@posthog\/.+|@vercel\/analytics|@vercel\/speed-insights|mixpanel-browser|react-ga4?|amplitude-js|@amplitude\/.+|@datadog\/.+|logrocket|@microsoft\/clarity|firebase(\/.+)?|@firebase\/.+)$/u;
const NETWORK_PATHS = /(^|\/)(supabase|sentry\w*|posthog\w*)(\/|$)/iu;

/** 이 자리의 식별자가 값으로 쓰인 것인가(선언 이름, 속성 이름, 타입 이름은 아니다). */
function isValueReference(id) {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p)) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
    || ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isEnumMember(p) || ts.isImportClause(p)
    || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) && p.name === id) return false;
  // { fetch: f } = window 에서 fetch 는 꺼내는 속성 이름이다(꺼내는 쪽은 아래 구조 분해 검사가 본다).
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  return true;
}

/** 외부 주소 문자열(이미지, 링크, 스크립트로 요청이 나갈 수 있다). 처리방침 같은 내부 링크는 상대 경로로 적는다. */
const EXTERNAL_URL = /^(?:https?:)?\/\/\S/iu;
function externalUrlHits(analysis) {
  return analysis.strings
    .filter((s) => !s.dev && EXTERNAL_URL.test(s.text.trim()))
    .map((s) => ({ line: s.line, what: `외부 주소 문자열 「${s.text.trim().slice(0, 40)}」` }));
}

function apiHits(analysis, file) {
  const hits = [];
  const add = (node, api, what) => hits.push({ line: lineOf(analysis.sf, node), api, what });
  const shareAllowed = file.group === "components" && /(share|send)/iu.test(file.base);
  const visit = (node) => {
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const name = node.text;
      if (NETWORK_IDENTIFIERS.has(name)) add(node, "network", `${name} 사용`);
      if (STORAGE_IDENTIFIERS.has(name)) add(node, "storage", `${name} 사용`);
      if (name === "console") add(node, "console", "console 사용");
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const objectExpr = node.expression;
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
      const objectName = ts.isIdentifier(objectExpr) ? objectExpr.text : null;
      if (key !== null && objectName !== null && GLOBAL_OBJECTS.has(objectName)) {
        if (NETWORK_IDENTIFIERS.has(key)) add(node, "network", `${objectName}.${key} 사용`);
        if (STORAGE_IDENTIFIERS.has(key)) add(node, "storage", `${objectName}.${key} 사용`);
        if (key === "console") add(node, "console", `${objectName}.console 사용`);
      }
      if (key === "sendBeacon") add(node, "network", "sendBeacon 사용");
      if (key === "cookie" && (objectName === "document" || (ts.isPropertyAccessExpression(objectExpr) && objectExpr.name.text === "document"))) add(node, "cookie", "document.cookie 사용");
      if ((key === "share" || key === "canShare") && (objectName === "navigator" || (ts.isPropertyAccessExpression(objectExpr) && objectExpr.name.text === "navigator"))) {
        if (!shareAllowed) add(node, "share", `navigator.${key} 는 보내기 컴포넌트에서만 쓴다`);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const init = node.initializer;
      const initName = ts.isIdentifier(init) ? init.text : ts.isPropertyAccessExpression(init) ? init.name.text : null;
      for (const element of node.name.elements) {
        const picked = ts.isIdentifier(element.propertyName ?? element.name) ? (element.propertyName ?? element.name).text : null;
        if (picked === null) continue;
        if (GLOBAL_OBJECTS.has(initName ?? "")) {
          if (NETWORK_IDENTIFIERS.has(picked)) add(node, "network", `${picked} 를 ${initName} 에서 꺼냄`);
          if (STORAGE_IDENTIFIERS.has(picked)) add(node, "storage", `${picked} 를 ${initName} 에서 꺼냄`);
        }
        if (initName === "navigator" && (picked === "sendBeacon")) add(node, "network", "navigator 에서 sendBeacon 을 꺼냄");
        if (initName === "navigator" && (picked === "share" || picked === "canShare") && !shareAllowed) add(node, "share", `navigator 에서 ${picked} 를 꺼냄`);
        if (initName === "document" && picked === "cookie") add(node, "cookie", "document 에서 cookie 를 꺼냄");
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Image") add(node, "network", "new Image 는 요청을 만들 수 있다");
    ts.forEachChild(node, visit);
  };
  visit(analysis.sf);
  for (const imp of analysis.imports) {
    if (imp.spec === null) continue;
    if (NETWORK_PACKAGES.test(imp.spec) || NETWORK_PATHS.test(imp.spec)) hits.push({ line: imp.line, api: "network", what: `${imp.spec} 가져오기` });
  }
  return hits;
}

/**
 * storage.ts 밖에서는 저장소 메서드(getItem, setItem, removeItem, clear)를 부르지 않고 저장 키(V40_STORAGE 의 …Key)를 읽지 않는다.
 *
 * 왜: 저장소 이름(localStorage 등)을 부르는 곳이 storage.ts 한 곳이어도, 클라이언트가 storage.ts 에서 받은 핸들에 대고 자동 저장 키를
 * 직접 쓰면(setItem(V40_STORAGE.autosaveKey, "off")) 끄기의 지우기(writeAutosavePreference 가 하는 일)를 건너뛰고 방침이 약속한 삭제 없이
 * 꺼짐만 남는다. 그래서 핸들은 storage.ts 의 함수에 넘기기만 하고, 자동 저장 선호는 readAutosavePreference, writeAutosavePreference 로만 읽고 쓴다.
 */
const STORAGE_METHODS = /^(?:getItem|setItem|removeItem)$/u;
const STORAGE_KEY_NAMES = /^(?:progressKey|historyKey|letterGuessKey|autosaveKey|legacyV31ProgressKey|legacyV31AutosaveKey)$/u;
function storageBypassHits(analysis) {
  const hits = [];
  const sf = analysis.sf;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const owner = node.expression.expression;
      const ownerName = ts.isIdentifier(owner) ? owner.text : ts.isPropertyAccessExpression(owner) ? owner.name.text : "";
      // getItem, setItem, removeItem 은 Storage 만의 이름이다. clear 는 Map, Set 도 갖고 있어서 저장소로 보이는 이름의 것만 본다.
      if (STORAGE_METHODS.test(method) || (method === "clear" && /storage/iu.test(ownerName))) {
        hits.push({ line: lineOf(sf, node), what: `.${method}() 는 storage.ts 안에서만 부른다(자동 저장은 readAutosavePreference, writeAutosavePreference)` });
      }
    }
    if (ts.isPropertyAccessExpression(node) && STORAGE_KEY_NAMES.test(node.name.text)) {
      hits.push({ line: lineOf(sf, node), what: `저장 키 ${node.name.text} 는 storage.ts 만 안다` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * 저장소 핸들 도우미(lib/weddingCode/browserStorageHandle.ts)의 검사(계약 문서 9.3절). 저장소 이름은 v3.1 과 v4 가 함께 쓰는 이 파일의
 * export function realLocalStorage 한 함수 안에 한 번만 나와야 한다. 그 함수가 없으면 「저장소 핸들은 이 함수 한 곳에서 받는다」는 안내가 거짓이 되고,
 * 함수 밖(모듈 최상위나 다른 함수)에 이름이 있으면 핸들이 바깥으로 새는 다른 길이 생긴다. 문제 문장의 목록을 돌려준다(없으면 빈 배열).
 * (이 검사는 예전에 v4 의 storage.ts 안 browserStorage 함수를 보던 것을 판별이 이사한 자리로 옮긴 것이다. 강도는 그대로다.)
 */
const STORAGE_HANDLE_TARGET = { fn: "realLocalStorage", file: { group: "lib", base: "browserStorageHandle.ts", abs: PATHS.storageHandle }, where: "browserStorageHandle.ts" };
function storageHandleProblems(analysis, target = STORAGE_HANDLE_TARGET) {
  const sf = analysis.sf;
  const problems = [];
  const handle = sf.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === target.fn) ?? null;
  const exported = handle !== null && (handle.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) problems.push(`${target.where} 에 export function ${target.fn}() 가 없다(웨딩코드가 저장소 핸들을 받을 유일한 자리)`);
  const from = handle === null ? 0 : sf.getLineAndCharacterOfPosition(handle.getStart(sf)).line + 1;
  const to = handle === null ? -1 : sf.getLineAndCharacterOfPosition(handle.getEnd()).line + 1;
  const hits = apiHits(analysis, target.file).filter((hit) => hit.api === "storage");
  const inside = hits.filter((hit) => hit.line >= from && hit.line <= to);
  for (const hit of hits) {
    if (hit.line < from || hit.line > to) problems.push(`${target.where}:${hit.line} ${hit.what} (저장소 이름은 ${target.fn} 함수 안에서만 부른다)`);
  }
  if (exported && inside.length !== 1) problems.push(`${target.fn} 함수 안에 저장소 이름이 ${inside.length}번 나온다(정확히 한 번, 한 저장소만)`);
  return problems;
}

/**
 * storage.ts(v4)의 검사: 저장소 이름은 하나도 없어야 하고(이름은 위 도우미 한 곳뿐), export function browserStorage() 가 그 도우미의 realLocalStorage() 를
 * 불러 결과를 돌려줘야 한다. 이 함수가 없으면 「클라이언트는 storage.ts 의 browserStorage() 로 핸들을 받는다」는 안내가 거짓이 되고,
 * 판별을 거치지 않는 다른 길로 핸들을 만들면 막힌 브라우저가 메모리 저장소를 진짜로 믿게 된다. 문제 문장의 목록을 돌려준다(없으면 빈 배열).
 */
function storageDelegationProblems(analysis) {
  const sf = analysis.sf;
  const problems = [];
  const handle = sf.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === "browserStorage") ?? null;
  const exported = handle !== null && (handle.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) problems.push("storage.ts 에 export function browserStorage() 가 없다(클라이언트가 저장소 핸들을 받을 유일한 자리)");
  for (const hit of apiHits(analysis, { group: "lib", base: "storage.ts", abs: PATHS.storage }).filter((h) => h.api === "storage")) {
    problems.push(`storage.ts:${hit.line} ${hit.what} (저장소 이름은 lib/weddingCode/browserStorageHandle.ts 의 realLocalStorage 한 곳에만 있다)`);
  }
  let delegates = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "realLocalStorage") delegates = true;
    ts.forEachChild(node, visit);
  };
  if (handle !== null) visit(handle);
  if (exported && !delegates) problems.push("browserStorage() 가 realLocalStorage() 를 부르지 않는다(진짜 Storage 판별을 거치지 않는 핸들은 막힌 브라우저의 메모리 저장소를 진짜로 믿게 한다)");
  return problems;
}

/**
 * v4 소스가 가져오는 wedding-code 이름 공간(lib/weddingCode, app/wedding-code, components/wedding-code)의 이웃 파일 가운데 v4 묶음이 아닌 것.
 * 왜: 예전에는 클라이언트가 저장소 핸들을 울타리 밖 임시 파일(lib/weddingCode/browserStorageHandle.ts)에서 받았고, 그 파일은 어떤 규칙도 훑지 않아서
 * 「저장소 이름은 storage.ts 한 곳」이라는 약속이 소리 없이 거짓이었다. 이제 v4 가 직접 가져오는 이웃도 같은 저장소 규칙으로 훑는다.
 * v3.1 과 옛 판 모듈은 규칙 4 가 가져오기 자체를 막으므로 여기서는 뺀다(그 파일들은 자기 저장소를 쓴다). 시험 파일은 뺀다.
 */
const NEIGHBOR_TREES = [/^lib\/weddingcode\//iu, /^app\/wedding-code\//iu, /^components\/wedding-code\//iu];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolveToFile(base) {
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = resolve(base + suffix);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importedNeighbors() {
  const known = new Set(V40_FILES.map((f) => f.abs));
  const found = new Map();
  for (const file of V40_FILES) {
    for (const imp of load(file).imports) {
      if (imp.spec === null) continue;
      const base = resolveSpecifier(imp.spec, file.abs);
      if (base === null) continue;
      const abs = resolveToFile(base);
      if (abs === null || known.has(abs) || isTestName(basename(abs))) continue;
      const target = relToWeb(abs);
      if (!NEIGHBOR_TREES.some((re) => re.test(target))) continue;
      if ([...V31_MODULES, ...OLDER_MODULES].some((re) => re.test(target))) continue;
      found.set(abs, fileInfo(abs, "neighbor"));
    }
  }
  return [...found.values()].sort((a, b) => a.abs.localeCompare(b.abs));
}

// --- 규칙 5 (계속): 답이 서버로 가는 길 ---------------------------------------

/** 쿼리로 쓸 수 있는 키. 답이 든 링크는 # 뒤로만 가고(v, a, b) 쿼리는 판 이름 v 뿐이다(설계 13절). */
const QUERY_KEYS = ["v"];
/** 키 자리에 계산된 값이 들어가도 그 식이 상수 키(`V40_LINK_KEYS.version` = v)이면 허용 키로 읽는다. */
const QUERY_KEY_EXPRESSIONS = new Map([["V40_LINK_KEYS.version", "v"]]);
/**
 * 문자열이나 템플릿에 든 쿼리 문자열의 키들. 키를 알 수 없는 쿼리(`?` 바로 뒤가 계산된 값이거나 키 자리가 상수 키가 아닌 식)는 키 null.
 * exprs 는 템플릿의 자리 표시자에 들어간 식의 글자(없으면 빈 배열).
 */
function queryKeysOf(text, exprs = []) {
  const keys = [];
  const at = text.indexOf("?");
  if (at < 0) return keys;
  const hashAt = text.indexOf("#");
  if (hashAt >= 0 && hashAt < at) return keys;
  const query = text.slice(at, hashAt >= 0 ? hashAt : undefined);
  if (new RegExp(`^\\?${PLACEHOLDER}(?!=)`, "u").test(query)) keys.push(null);
  for (const match of query.matchAll(new RegExp(`[?&](${PLACEHOLDER}|[A-Za-z_][A-Za-z0-9_.-]*)=`, "gu"))) {
    if (match[1] === PLACEHOLDER) {
      const before = text.slice(0, at + match.index).split(PLACEHOLDER).length - 1;
      keys.push(QUERY_KEY_EXPRESSIONS.get(exprs[before] ?? "") ?? null);
    } else {
      keys.push(match[1]);
    }
  }
  return keys;
}

function queryKeyHits(rec) {
  return queryKeysOf(rec.text, rec.exprs ?? [])
    .filter((key) => key === null || !QUERY_KEYS.includes(key))
    .map((key) => (key === null ? "쿼리 전체가 계산된 값이다(어떤 키가 가는지 알 수 없다)" : `쿼리 키 「${key}」 (허용: ${QUERY_KEYS.join(", ")}). 답은 서버로 가는 쿼리에 싣지 않는다`));
}

const isLiteralUrl = (expr) => {
  const e = peel(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
  if (ts.isIdentifier(e)) {
    const init = findConstInit(e);
    return init !== null && !ts.isFunctionLike(init) && isLiteralUrl(init);
  }
  return false;
};

/**
 * 계산된 주소로 이동하거나 쿼리를 쓰는 길. 답이 든 링크의 주소를 만들어 이동하면 # 뒤가 아닌 부분이 서버로 간다.
 * 글자 그대로의 주소(“/privacy”)로 가는 것은 괜찮다. 계산한 주소로 가는 호출, location.search 에 쓰기, 알 수 없는 키의 searchParams 쓰기를 막는다.
 */
function navigationHits(analysis) {
  const hits = [];
  const sf = analysis.sf;
  const add = (node, what) => hits.push({ line: lineOf(sf, node), what });
  const nameOf = (expr) => (ts.isIdentifier(expr) ? expr.text : ts.isPropertyAccessExpression(expr) ? expr.name.text : "");
  const isLocationLike = (expr) => /^(?:location|window)$/u.test(nameOf(expr)) || (ts.isPropertyAccessExpression(expr) && expr.name.text === "location");
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const owner = callee.expression;
        const isRouter = /router/iu.test(nameOf(owner));
        const isWindow = ts.isIdentifier(owner) && GLOBAL_OBJECTS.has(owner.text);
        if ((isRouter && /^(?:push|replace|prefetch)$/u.test(method)) || (isWindow && method === "open") || (/^(?:assign|replace)$/u.test(method) && isLocationLike(owner))) {
          if (!arg || !isLiteralUrl(arg)) add(node, `${method}() 는 계산된 주소로 이동한다(글자 그대로의 주소만)`);
        }
        if (/^(?:set|append)$/u.test(method) && /searchParams$/iu.test(nameOf(owner))) {
          if (!arg || !(ts.isStringLiteral(peel(arg)) && QUERY_KEYS.includes(peel(arg).text))) add(node, `searchParams.${method}() 로 쿼리에 값을 싣는다(허용 키: ${QUERY_KEYS.join(", ")})`);
        }
      } else if (ts.isIdentifier(callee) && /^(?:redirect|permanentRedirect)$/u.test(callee.text)) {
        if (!arg || !isLiteralUrl(arg)) add(node, `${callee.text}() 는 계산된 주소로 이동한다`);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const key = node.left.name.text;
      if (key === "search") add(node, "location.search 나 url.search 에 값을 쓴다(쿼리로 실린다)");
      if ((key === "href" || key === "pathname") && isLocationLike(node.left.expression) && !isLiteralUrl(node.right)) add(node, `location.${key} 에 계산된 주소를 쓴다(글자 그대로의 주소만)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// --- 규칙 6: 이용 통계 -----------------------------------------------------

const CAPTURE_NAMES = new Set(["captureWeddingCodeEvent", "captureEvent"]);

function topLevelMap(sf) {
  const map = new Map();
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) map.set(d.name.text, d.initializer);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) map.set(statement.name.text, statement);
  }
  return map;
}

const peel = (expr) => (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)
  ? peel(expr.expression) : expr);

/** 식이 속한 함수와 그 안에서 이 식별자가 몇 번째 매개변수인지. */
function parameterOf(id) {
  for (let n = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const index = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
      if (index >= 0) return { fn: n, index, param: n.parameters[index] };
    }
  }
  return null;
}

function functionName(fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  // const track = useCallback((name, props) => …, []) 처럼 감싼 함수도 변수 이름을 이어받는다.
  let node = fn;
  while (node.parent && (ts.isParenthesizedExpression(node.parent) || (ts.isCallExpression(node.parent) && node.parent.arguments[0] === node))) node = node.parent;
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return null;
}

/** 이 식별자를 가리키는 가장 가까운 const 선언의 초기값(컴포넌트 안의 지역 const 도 본다). */
function findConstInit(id) {
  for (let n = id.parent; n; n = n.parent) {
    const statements = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) ? n.statements : null;
    if (!statements) continue;
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer) return d.initializer;
      }
    }
  }
  return null;
}

function callSitesOf(sf, name) {
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 이벤트 이름 식이 가질 수 있는 문자열 값들. 확정할 수 없으면 ok: false. */
function resolveStrings(expr, ctx, depth = 0) {
  if (depth > 4) return { ok: false, why: "너무 깊게 이어진다" };
  const e = peel(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { ok: true, values: [e.text] };
  if (ts.isConditionalExpression(e)) {
    const a = resolveStrings(e.whenTrue, ctx, depth + 1);
    const b = resolveStrings(e.whenFalse, ctx, depth + 1);
    return a.ok && b.ok ? { ok: true, values: [...a.values, ...b.values] } : { ok: false, why: a.why ?? b.why };
  }
  if (ts.isIdentifier(e)) {
    const local = findConstInit(e);
    if (local && !ts.isFunctionLike(local)) return resolveStrings(local, ctx, depth + 1);
    const param = parameterOf(e);
    if (param) {
      if (param.param.type && /WeddingCodeFunnelEvent/u.test(param.param.type.getText(ctx.sf))) return { ok: true, values: [], typed: true };
      const name = functionName(param.fn);
      const sites = name ? callSitesOf(ctx.sf, name) : [];
      if (sites.length === 0) return { ok: false, why: `매개변수 ${e.text} 를 넘기는 호출을 같은 파일에서 찾지 못했다` };
      const values = [];
      for (const site of sites) {
        const arg = site.arguments[param.index];
        if (!arg) return { ok: false, why: "호출에서 이벤트 이름을 넘기지 않았다" };
        const r = resolveStrings(arg, ctx, depth + 1);
        if (!r.ok) return r;
        values.push(...r.values);
      }
      return { ok: true, values };
    }
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const holder = findConstInit(e.expression);
    if (holder && ts.isObjectLiteralExpression(peel(holder))) {
      try {
        const obj = evalLiteral(holder);
        if (typeof obj[e.name.text] === "string") return { ok: true, values: [obj[e.name.text]] };
      } catch { /* 아래에서 실패로 돌린다 */ }
    }
  }
  return { ok: false, why: `이벤트 이름을 문자열로 확정할 수 없다(${ts.SyntaxKind[e.kind]})` };
}

/** 속성 객체 식이 가질 수 있는 키들. 확정할 수 없으면 ok: false. entries 는 값 검사용. */
function resolveProps(expr, ctx, depth = 0) {
  if (depth > 4) return { ok: false, why: "너무 깊게 이어진다" };
  const e = peel(expr);
  if (ts.isObjectLiteralExpression(e)) {
    const entries = [];
    for (const prop of e.properties) {
      if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        entries.push({ key: prop.name.text, value: prop.initializer });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        entries.push({ key: prop.name.text, value: prop.name });
      } else if (ts.isSpreadAssignment(prop)) {
        const inner = resolveProps(prop.expression, ctx, depth + 1);
        if (!inner.ok) return inner;
        entries.push(...inner.entries);
      } else {
        return { ok: false, why: `속성을 확정할 수 없다(${ts.SyntaxKind[prop.kind]})` };
      }
    }
    return { ok: true, entries };
  }
  if (ts.isConditionalExpression(e)) {
    const a = resolveProps(e.whenTrue, ctx, depth + 1);
    const b = resolveProps(e.whenFalse, ctx, depth + 1);
    return a.ok && b.ok ? { ok: true, entries: [...a.entries, ...b.entries] } : { ok: false, why: a.why ?? b.why };
  }
  if (ts.isIdentifier(e)) {
    if (e.text === "undefined") return { ok: true, entries: [] };
    const local = findConstInit(e);
    if (local && !ts.isFunctionLike(local)) return resolveProps(local, ctx, depth + 1);
    const param = parameterOf(e);
    if (param) {
      const name = functionName(param.fn);
      const sites = name ? callSitesOf(ctx.sf, name) : [];
      if (sites.length === 0) return { ok: false, why: `매개변수 ${e.text} 를 넘기는 호출을 같은 파일에서 찾지 못했다` };
      const entries = [];
      for (const site of sites) {
        const arg = site.arguments[param.index];
        if (!arg) continue;
        const r = resolveProps(arg, ctx, depth + 1);
        if (!r.ok) return r;
        entries.push(...r.entries);
      }
      return { ok: true, entries };
    }
  }
  return { ok: false, why: `속성 객체를 정적으로 확정할 수 없다(${ts.SyntaxKind[e.kind]}). 속성을 객체 리터럴에 직접 적을 것` };
}

/** 통계나 오류 수집 호출로 보이는 이름. 이 이름으로 부르는 함수는 @/lib/analytics 의 두 함수이거나 이 파일 안에서 선언한 감싼 함수여야 한다. */
const STAT_CALL_NAME = /^(?:capture|capture[A-Z]\w*|track|track[A-Z]\w*|logEvent|sendEvent|gtag|fbq)$/u;
/** 객체에 대고 부르면 통계나 오류 수집으로 보이는 메서드(Sentry, PostHog 류). */
const STAT_METHOD = /^(?:captureMessage|captureException|track|trackEvent|logEvent|sendEvent|identify|setUser|setContext|setExtra|setTag|addBreadcrumb|startSpan|startTransaction|withScope)$/u;
/** 전역으로 붙는 통계, 오류 수집 객체. */
const STAT_GLOBALS = new Set(["Sentry", "posthog", "gtag", "dataLayer", "fbq", "amplitude", "mixpanel", "_paq"]);

/** 이 파일이 스스로 선언한 이름들(함수, 변수, 매개변수). 감싼 함수 이름이 통계 이름과 겹쳐도 선언이 있으면 감싼 함수로 본다. */
function declaredNamesOf(sf) {
  const names = new Set();
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** 가져온 경로가 통계 모듈인가: exact(@/lib/analytics 자체), under(그 아래 모듈), none. 확장자와 /index 는 같은 모듈로 본다. */
function analyticsKindOf(resolved) {
  const normalized = posix(resolved).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u, "").replace(/\/index$/u, "");
  const base = posix(PATHS.analytics);
  if (normalized === base) return "exact";
  if (normalized.startsWith(`${base}/`)) return "under";
  return "none";
}

function analyticsHits(analysis, allow) {
  const hits = [];
  const sf = analysis.sf;
  const ctx = { sf };
  const localNames = new Map();
  const namespaces = new Set();
  const declared = declaredNamesOf(sf);
  const add = (node, what) => hits.push({ line: lineOf(sf, node), what });

  for (const imp of analysis.imports) {
    if (imp.spec === null) continue;
    const resolved = resolveSpecifier(imp.spec, analysis.fileName);
    const kind = resolved === null ? "none" : analyticsKindOf(resolved);
    if (kind === "under") {
      add(imp.node, `analytics 하위 모듈 ${imp.spec} 를 가져온다(@/lib/analytics 에서 captureWeddingCodeEvent, captureEvent 만)`);
      continue;
    }
    if (kind === "exact") {
      if (imp.kind !== "static" || !ts.isImportDeclaration(imp.node)) {
        add(imp.node, "analytics 를 다시 내보내거나 동적으로(import(), require) 가져온다(정적 import 로 captureWeddingCodeEvent, captureEvent 만)");
        continue;
      }
      const clause = imp.node.importClause;
      if (!clause) continue;
      if (clause.name) add(imp.node, "analytics 모듈의 default 가져오기");
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (!CAPTURE_NAMES.has(imported)) add(element, `analytics 에서 ${imported} 를 가져옴(captureWeddingCodeEvent, captureEvent 만 쓴다)`);
          else localNames.set(element.name.text, imported);
        }
      }
      continue;
    }
    // 다른 모듈(재수출 통, 자체 감싼 모듈)에서 통계 이름을 가져오는 길: 이름으로 막는다.
    if (ts.isImportDeclaration(imp.node) && imp.node.importClause) {
      const clause = imp.node.importClause;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (STAT_CALL_NAME.test(imported) || STAT_CALL_NAME.test(element.name.text)) add(element, `${imported} 를 ${imp.spec} 에서 가져온다(통계 함수는 @/lib/analytics 에서만)`);
        }
      }
      const defaultOrNamespace = [clause.name, clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name : null].filter(Boolean);
      for (const id of defaultOrNamespace) if (/^(?:sentry|posthog|amplitude|mixpanel|analytics|telemetry)$/iu.test(id.text)) add(id, `${id.text} 를 ${imp.spec} 에서 가져온다(통계, 오류 수집 객체는 쓰지 않는다)`);
    }
  }

  const checkCall = (call, viaName) => {
    const [eventArg, propsArg] = call.arguments;
    if (!eventArg) return add(call, `${viaName}() 에 이벤트 이름이 없다`);
    const ev = resolveStrings(eventArg, ctx);
    if (!ev.ok) add(call, `${viaName}: ${ev.why}`);
    else for (const value of ev.values) if (!allow.events.has(value)) add(call, `${viaName}: 고지하지 않은 이벤트 「${value}」(목록: analyticsPrivacy.ts 의 WEDDING_CODE_FUNNEL_EVENTS)`);
    if (!propsArg) return undefined;
    const props = resolveProps(propsArg, ctx);
    if (!props.ok) return add(call, `${viaName}: ${props.why}`);
    for (const { key, value } of props.entries) {
      if (!allow.properties.has(key)) {
        add(call, `${viaName}: 고지하지 않은 속성 「${key}」(목록: WEDDING_CODE_FUNNEL_PROPERTIES)`);
        continue;
      }
      const v = peel(value);
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
        if (!allow.shortValue.test(v.text)) add(call, `${viaName}: 속성 ${key} 의 값 「${v.text}」이 짧은 식별자 모양이 아니다`);
        if (key === "version" && v.text !== VERSION_TAG) add(call, `${viaName}: version 값은 ${VERSION_TAG} 여야 한다`);
      }
    }
    return undefined;
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && localNames.has(callee.text)) checkCall(node, localNames.get(callee.text));
      else if (ts.isIdentifier(callee) && STAT_CALL_NAME.test(callee.text) && !declared.has(callee.text)) {
        add(node, `${callee.text}() 는 통계나 오류 수집 호출로 보이는데 @/lib/analytics 에서 가져온 함수가 아니다`);
      } else if (ts.isPropertyAccessExpression(callee) && CAPTURE_NAMES.has(callee.name.text)) {
        if (ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) checkCall(node, callee.name.text);
        else add(node, `${callee.name.text} 를 analytics 가져오기가 아닌 곳에서 부른다`);
      } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "capture") {
        add(node, ".capture() 직접 호출은 이벤트 이름을 검사할 수 없다");
      } else if (ts.isPropertyAccessExpression(callee) && STAT_METHOD.test(callee.name.text)) {
        add(node, `.${callee.name.text}() 는 통계나 오류 수집 호출로 보인다(고지한 통계는 captureWeddingCodeEvent, captureEvent 로만 보낸다)`);
      }
    }
    // 네임스페이스로 가져온 analytics 에서 두 함수 밖의 멤버를 읽는다.
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && !CAPTURE_NAMES.has(node.name.text)) {
      add(node, `analytics 의 ${node.name.text} 는 쓰지 않는다(captureWeddingCodeEvent, captureEvent 만)`);
    }
    // 전역 통계, 오류 수집 객체(window.posthog, Sentry 등).
    if (ts.isIdentifier(node) && STAT_GLOBALS.has(node.text) && isValueReference(node) && !declared.has(node.text)) add(node, `전역 ${node.text} 객체를 쓴다(통계, 오류 수집 SDK 를 직접 부르지 않는다)`);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text) && STAT_GLOBALS.has(node.name.text)) {
      add(node, `${node.expression.text}.${node.name.text} 객체를 쓴다(통계, 오류 수집 SDK 를 직접 부르지 않는다)`);
    }
    if (ts.isIdentifier(node) && localNames.has(node.text) && isValueReference(node)) {
      const p = node.parent;
      const isCallee = ts.isCallExpression(p) && p.expression === node;
      const isImportName = ts.isImportSpecifier(p);
      if (!isCallee && !isImportName) add(node, `${node.text} 를 부르지 않고 값으로 넘긴다(이벤트 이름을 검사할 수 없다)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// --- 규칙 8: 링크 키 -------------------------------------------------------

function hashKeyHits(rec) {
  const hits = [];
  const at = rec.text.indexOf("#");
  if (at < 0) return hits;
  for (const match of rec.text.slice(at).matchAll(/[#&]([A-Za-z_][A-Za-z0-9_-]*)=/gu)) {
    if (!ALLOWED_HASH_KEYS.includes(match[1])) hits.push(`해시 키 「${match[1]}」 (허용: ${ALLOWED_HASH_KEYS.join(", ")})`);
  }
  return hits;
}

/**
 * URLSearchParams 로 해시나 쿼리를 읽고 쓰는 자리의 키. 변수에 담은 URLSearchParams 의 get, set 등과 `new URLSearchParams({ … })` 객체의 키를 본다.
 * 해시를 읽는 코덱도 이 검사를 받는다(예전에는 codec.ts 만 봤다).
 */
function urlSearchParamKeyHits(analysis) {
  const hits = [];
  const sf = analysis.sf;
  const params = new Set();
  const isParamsNew = (e) => ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "URLSearchParams";
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isParamsNew(peel(node.initializer))) params.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const scan = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && params.has(node.expression.expression.text) && /^(get|getAll|has|set|append|delete)$/u.test(node.expression.name.text)) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && !ALLOWED_HASH_KEYS.includes(arg.text)) {
        hits.push({ line: lineOf(sf, node), what: `링크 해시 키 「${arg.text}」 (허용: ${ALLOWED_HASH_KEYS.join(", ")})` });
      }
    }
    if (isParamsNew(node) && node.arguments?.[0]) {
      const arg = peel(node.arguments[0]);
      if (ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          const key = (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;
          if (key === null || !ALLOWED_HASH_KEYS.includes(key)) hits.push({ line: lineOf(sf, prop), what: `URLSearchParams 객체의 키 ${key === null ? "(알 수 없음)" : `「${key}」`} (허용: ${ALLOWED_HASH_KEYS.join(", ")})` });
        }
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(sf);
  return hits;
}

// --- 규칙 9: 고지 문장 -----------------------------------------------------

const countOf = (text, needle) => text.split(needle).length - 1;

/** 노드 안(과 그 안에서 부르는 copy.ts 의 최상위 상수와 함수)의 고지 문장 수. */
function noticeCount(node, ctx, stack = []) {
  let total = 0;
  const visit = (n) => {
    if (isPlusConcat(n) && literalConcat(n) !== null) {
      total += countOf(literalConcat(n), NOT_VALIDATED_PHRASE);
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!isNonTextPosition(n)) total += countOf(n.text, NOT_VALIDATED_PHRASE);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      total += countOf(n.head.text + n.templateSpans.map((s) => PLACEHOLDER + s.literal.text).join(""), NOT_VALIDATED_PHRASE);
      for (const span of n.templateSpans) visit(span.expression);
      return;
    }
    // 같은 상수를 두 번 쓰면 두 번 센다. 스택은 순환만 막는다.
    if (ts.isIdentifier(n) && isValueReference(n) && ctx.tops.has(n.text) && n.text !== "V40_COPY" && !stack.includes(n.text)) {
      total += noticeCount(ctx.tops.get(n.text), ctx, [...stack, n.text]);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return total;
}

/** copy.ts 의 고지 문장 보고서: 묶음별 수, 화면별 수, 허용 자리 밖의 출현. */
function noticeReport(analysis) {
  const sf = analysis.sf;
  const tops = topLevelMap(sf);
  const ctx = { sf, tops };
  const copyNode = tops.get("V40_COPY");
  assert.ok(copyNode, "copy.ts 에서 V40_COPY 를 찾지 못했다 — 이름이 바뀌었으면 이 가드도 함께 고칠 것");
  const screens = constValue(analysis, "V40_COPY_SCREENS");
  const object = peel(copyNode);
  assert.ok(ts.isObjectLiteralExpression(object), "V40_COPY 가 객체 리터럴이 아니다");
  const groups = {};
  for (const prop of object.properties) {
    assert.ok(ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name), "V40_COPY 의 최상위 항목은 이름: 값 꼴이어야 한다");
    groups[prop.name.text] = noticeCount(prop.initializer, ctx);
  }
  const perScreen = {};
  for (const [screen, names] of Object.entries(screens)) {
    perScreen[screen] = names.reduce((sum, name) => sum + (groups[name] ?? Number.NaN), 0);
  }
  // 허용 자리: V40_COPY 안, 그리고 「const 이름 = 문자열」 꼴의 최상위 상수(공유 고지 문장).
  const allowedRanges = [[copyNode.getStart(sf), copyNode.getEnd()]];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const d of statement.declarationList.declarations) {
      if (!d.initializer) continue;
      const init = peel(d.initializer);
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) allowedRanges.push([statement.getStart(sf), statement.getEnd()]);
    }
  }
  const stray = analysis.strings
    .filter((s) => countOf(s.text, NOT_VALIDATED_PHRASE) > 0 && !allowedRanges.some(([from, to]) => s.pos >= from && s.pos < to))
    .map((s) => ({ line: s.line, what: "V40_COPY 밖(함수 안 등)에 고지 문장이 있다" }));
  return { groups, perScreen, screens, stray };
}

// --- 규칙 10: v4 링크를 여는 파일 ---------------------------------------------

/**
 * v4 링크(#v=v4.0-tendency&a=…[&ga=…])를 읽거나 여는 앱 쪽 모듈: v4 클라이언트, v4 코덱, v4 짐작 코덱(ga, gb).
 * 이 셋을 가져오는 v4 밖의 실서비스 파일(entry.ts, WeddingCodeEntryClient.tsx 등)이 생기는 순간 v4 링크가 실제로 쓰인다.
 * (v4 소스 안에서 서로 가져오는 것은 여기 들지 않는다. 문항 은행, 코어, 입력 컴포넌트는 링크를 열지 않는다.)
 */
const V40_LINK_OPENERS = [
  /^app\/wedding-code\/weddingcodev40/iu,
  /^lib\/weddingcode\/v40\/codec$/iu,
  /^lib\/weddingcode\/v40\/guess\/guesslink$/iu,
];

/** 가져온 경로를 웹 소스 기준 상대 경로로 바꾸고 확장자와 /index 를 뗀 것(같은 모듈은 같은 글자로 본다). 풀 수 없으면 null. */
function moduleTargetOf(spec, fromAbs) {
  if (spec === null) return null;
  const resolved = resolveSpecifier(spec, fromAbs);
  if (resolved === null) return null;
  return relToWeb(resolved).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u, "").replace(/\/index$/u, "");
}

/** analysis 가 v4 링크 열기 모듈을 가져오는 자리들(경로를 알 수 없는 동적 가져오기는 여기서는 세지 않는다). */
function linkOpenerImports(analysis) {
  const out = [];
  for (const imp of analysis.imports) {
    const target = moduleTargetOf(imp.spec, analysis.fileName);
    if (target === null) continue;
    if (V40_LINK_OPENERS.some((re) => re.test(target))) out.push({ line: imp.line, spec: imp.spec });
  }
  return out;
}

/** v4 소스 밖의 실서비스 파일(시험 제외) 가운데 v4 링크 열기 모듈을 가져오는 파일들. v40 이 글에 없는 파일은 파싱하지 않고 거른다. */
function findLinkOpeners() {
  const inScope = new Set(V40_FILES.map((f) => f.abs));
  const out = [];
  for (const abs of walk(WEB_SRC, (name) => isSourceName(name))) {
    if (inScope.has(abs) || !/v40|V40/u.test(readFileSync(abs, "utf8"))) continue;
    for (const hit of linkOpenerImports(loadPath(abs))) out.push(`${rel(abs)}:${hit.line} ${hit.spec}`);
  }
  return out;
}

/**
 * sentryScrub.ts 가 contexts 를 다루는가(#473: 브라우저 SDK 가 contexts.trace.data["url.full"] 에 주소 전체를 싣는다).
 * 속성 선언(`contexts?: unknown`)이 아니라 코드가 `.contexts` 를 읽거나 쓰는지 본다. 병합 전 파일에는 이 접근이 없다.
 */
function scrubHandlesContexts(text) {
  const sf = ts.createSourceFile("sentryScrub.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "contexts") found = true;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** 링크를 여는 파일이 있는데 주소 꼬리 정제가 없으면 그 파일들이 위반이다. */
function sentryGateHits(openers, handled) {
  return handled ? [] : openers.map((opener) => `${opener} — sentryScrub.ts 가 contexts 안 주소의 ?·# 꼬리를 자르지 않는다`);
}

// ---------------------------------------------------------------------------
// 4.1 단계 2 규칙 11, 13에서 17, 단어 규칙, 엔진 고정 (빌드 계획 11.3)
// ---------------------------------------------------------------------------

/**
 * 규칙 11: 새 단계 파일은 통계 모듈(@/lib/analytics 와 그 하위)을 가져오지 않고, captureWeddingCodeEvent, captureEvent 라는 이름을 어디에도 쓰지 않는다.
 * 규칙 6 은 v4 전체에서 「고지한 이벤트만」을 보고, 이 규칙은 새 단계에서 **이벤트가 하나도** 불리지 않게 한다(새 단계는 이용 통계 항목을 더하지 않는다).
 * 식별자 이름으로 보므로 가져오지 않고 부르는 호출, 별칭, 속성 접근도 걸린다.
 */
function statsFreeHits(analysis) {
  const hits = [];
  for (const imp of analysis.imports) {
    if (imp.spec === null) continue;
    const resolved = resolveSpecifier(imp.spec, analysis.fileName);
    if (resolved !== null && analyticsKindOf(resolved) !== "none") hits.push({ line: imp.line, what: `${imp.spec} 를 가져온다(새 단계는 이용 통계에 닿지 않는다)` });
  }
  const visit = (node) => {
    if (ts.isIdentifier(node) && CAPTURE_NAMES.has(node.text)) hits.push({ line: lineOf(analysis.sf, node), what: `${node.text} 를 쓴다(새 단계는 통계 이벤트를 부르지 않는다)` });
    ts.forEachChild(node, visit);
  };
  visit(analysis.sf);
  return hits;
}

/** 규칙 13: 결과 전 글자 고르기는 링크에 가지 않으므로 링크 코덱, 짐작 폴더(lib, 컴포넌트), 입구를 가져오지 않는다. */
const LETTER_GUESS_FORBIDDEN_IMPORTS = [
  ["링크 코덱(codec)", /^lib\/weddingcode\/v40\/codec$/iu],
  ["서로 짐작하기(guess)", /^(?:lib\/weddingcode|components\/wedding-code)\/v40\/guess(?:\/|$)/iu],
  ["입구(entry)", /^app\/wedding-code\/entry$/iu],
];

function letterGuessIsolationHits(analysis) {
  const hits = [];
  for (const imp of analysis.imports) {
    const target = moduleTargetOf(imp.spec, analysis.fileName);
    if (target === null) continue;
    const found = LETTER_GUESS_FORBIDDEN_IMPORTS.find(([, re]) => re.test(target));
    if (found) hits.push({ line: imp.line, what: `${found[0]}: ${imp.spec} (먼저 고른 글자는 링크에 가지 않는다)` });
  }
  return hits;
}

/**
 * 규칙 14(자료 쪽): 새 lib 폴더와 생성 상수는 골든 링크(https:// 이 든 글)와 한 글자 대문자 값을 두지 않는다. 규칙 1 이 v4 소스의 여덟 글자 밖 대문자 한 자를 이미 거절하는데,
 * 여기서는 여덟 글자도 한 글자 값으로 적지 않게 한다(글자는 상수에서 읽는다). 생성 상수에는 개발 메모 키도 없다(원천 JSON 의 dev, rules, status 와 그 안의 값이 번들로 나가지 않게).
 * 골든 값은 시험 파일에만 둔다.
 */
const GOLDEN_LINK = /https?:\/\//iu;
const SINGLE_CAPITAL = /^[A-Z]$/u;
const DEV_NOTE_KEYS = new Set(["dev", "lookSide", "whyItDiffers", "sides", "costKinds", "fit", "rules", "status"]);

function stageDataHits(analysis, { generated = false } = {}) {
  const hits = [];
  for (const rec of analysis.strings) {
    if (rec.dev) continue;
    if (GOLDEN_LINK.test(rec.text)) hits.push({ line: rec.line, what: `골든 링크가 든 글 「${rec.text.trim().slice(0, 40)}」(골든 값은 시험 파일에만 둔다)` });
    if (SINGLE_CAPITAL.test(rec.text.trim())) hits.push({ line: rec.line, what: `한 글자 대문자 값 「${rec.text.trim()}」(글자는 상수에서 읽는다)` });
  }
  if (generated) {
    const visit = (node) => {
      const named = (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isPropertySignature(node)) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name));
      if (named && DEV_NOTE_KEYS.has(node.name.text)) hits.push({ line: lineOf(analysis.sf, node), what: `개발 메모 키 「${node.name.text}」가 생성 상수에 있다(허용 필드만 내보낸다)` });
      ts.forEachChild(node, visit);
    };
    visit(analysis.sf);
  }
  return hits;
}

/** 규칙 15: 새 폴더는 바렐(components/wedding-code/v40 의 index 와 lib/weddingCode/v40 의 .., ../index)을 가져오지 않는다. useScreenFocus, SectionCard, styles 는 파일 경로로 직접 가져온다. */
const BARREL_TARGETS = [/^components\/wedding-code\/v40$/iu, /^lib\/weddingcode\/v40$/iu];

function barrelImportHits(analysis) {
  const hits = [];
  for (const imp of analysis.imports) {
    const target = moduleTargetOf(imp.spec, analysis.fileName);
    if (target !== null && BARREL_TARGETS.some((re) => re.test(target))) hits.push({ line: imp.line, what: `바렐 ${imp.spec} 를 가져온다(필요한 파일을 경로로 직접 가져올 것: 순환이 생긴다)` });
  }
  return hits;
}

/** 규칙 17: 새 폴더가 만드는 오류(Error, RangeError, TypeError …)의 메시지는 고정 문자열이다. 템플릿 치환이나 이어 붙이기로 입력 글자를 싣지 않는다. */
function errorMessageHits(analysis) {
  const hits = [];
  const isErrorName = (name) => name === "Error" || /Error$/u.test(name);
  const fixedMessage = (expr, depth = 0) => {
    if (depth > 3) return false;
    const e = peel(expr);
    if (literalConcat(e) !== null) return true;
    if (ts.isIdentifier(e)) {
      const init = findConstInit(e);
      return init !== null && !ts.isFunctionLike(init) && fixedMessage(init, depth + 1);
    }
    return false;
  };
  const visit = (node) => {
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && isErrorName(node.expression.text)) {
      const message = node.arguments?.[0];
      if (message !== undefined && !fixedMessage(message)) hits.push({ line: lineOf(analysis.sf, node), what: `${node.expression.text}() 의 메시지가 고정 문자열이 아니다(입력 글자를 싣지 않는다)` });
    }
    ts.forEachChild(node, visit);
  };
  visit(analysis.sf);
  return hits;
}

/**
 * 단어 규칙: 새 폴더의 화면 글과 생성 상수의 화면 글(V40_GUESS_TEXT)에 누가 맞혔는지(맞혔·틀렸·정답·오답·적중·득점·승패·등수·순위)와 점수, 비율(점수, 퍼센트, 백분율, % 기호)이 없고,
 * 문구 파일 둘과 V40_GUESS_TEXT 에는 개수 말(몇 개, 몇 가지, 여섯 가지, 개 중)과 숫자도 없다. 맞추다, 맞춰 같은 말은 일정을 맞춘다는 뜻으로도 쓰여서 걸지 않는다.
 * 장면 글(V40_GUESS_SET)은 화면 문구가 아니라 자료라서 이 규칙에서 뺀다(「정답이 없는」 같은 말이 장면 안에 자연스럽게 나올 수 있다).
 * 점수, 퍼센트, 백분율 기호는 규칙 2 가 v4 전체에서 이미 본다.
 */
const WHO_GUESSED_RIGHT_WORDS = /맞혔|맞혀|맞힌|맞히|틀렸|틀린|정답|오답|적중|득점|승패|등수|(?<!우선)순위|몇\s?점|점수|퍼센트|백분율|[%％﹪]/u;
const COUNT_PHRASES = /몇\s?(?:개|가지|번|장면|주제)|(?:여섯|네|다섯|세)\s?가지|개\s?중|[0-9]/u;
/** 개수 말 검사까지 받는 문구 파일(copy.ts 에 붙는 번들의 재료). */
const STAGE_COPY_FILES = new Set(["guessCopy.ts", "letterGuessCopy.ts"]);

/** 이 파일의 글 가운데 어느 것이 낱말 검사(who)와 개수 말 검사(count)를 받는가. 해당 없으면 둘 다 거짓. */
function wordScopeOf(file, analysis) {
  if (file.abs === PATHS.guessConstants) {
    const decl = topLevelDecl(analysis.sf, "V40_GUESS_TEXT");
    if (decl === null) return { who: () => false, count: () => false };
    const from = decl.getStart(analysis.sf);
    const to = decl.getEnd();
    const inText = (rec) => rec.pos >= from && rec.pos < to;
    return { who: inText, count: inText };
  }
  return { who: () => true, count: () => file.group === "lib" && STAGE_COPY_FILES.has(file.base) };
}

function stageWordHits(rec, scope) {
  const hits = [];
  if (rec.dev || !userFacing(rec)) return hits;
  if (scope.who(rec) && WHO_GUESSED_RIGHT_WORDS.test(rec.text)) hits.push("누가 맞혔는지나 점수, 비율을 말하는 낱말");
  if (scope.count(rec) && COUNT_PHRASES.test(rec.text)) hits.push("개수 말이나 숫자");
  return hits;
}

/**
 * 규칙 16: 클라이언트 본체의 통계 호출 자리를 센다. captureWeddingCodeEvent 호출 식의 수와 이벤트 이름 집합, captureEvent 호출 수.
 * 단계 배선이 고치는 본체 안에서 이벤트가 새로 불리는 길을 막는다(규칙 11 은 새 단계 파일만 본다).
 */
const FIXED_FUNNEL_EVENTS = [
  "wedding_code_comparison_viewed",
  "wedding_code_completed",
  "wedding_code_intro_viewed",
  "wedding_code_restarted",
  "wedding_code_scene_reached",
  "wedding_code_share_copied",
  "wedding_code_started",
  "wedding_code_taste_clicked",
];
/** 기준 커밋 5ac9eda24 에서 직접 센 값: restarted 가 세 곳이라 호출 열 개, 이벤트 이름은 여덟 개. */
const CLIENT_CAPTURE_CALLS = 10;

/**
 * 통계 함수를 부르는 호출 식들. 이름 그대로의 호출, 가져올 때 바꾼 이름(import { captureWeddingCodeEvent as cap })의 호출,
 * 네임스페이스 가져오기의 속성 호출(a.captureWeddingCodeEvent())을 모두 센다(별칭으로 열한 번째 호출을 숨기는 길을 막는다).
 */
function captureCallsOf(analysis, wanted) {
  const sf = analysis.sf;
  const aliases = new Set([wanted]);
  for (const imp of analysis.imports) {
    if (imp.spec === null || !ts.isImportDeclaration(imp.node) || !imp.node.importClause) continue;
    const resolved = resolveSpecifier(imp.spec, analysis.fileName);
    if (resolved === null || analyticsKindOf(resolved) === "none") continue;
    const bindings = imp.node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === wanted) aliases.add(element.name.text);
    }
  }
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && aliases.has(callee.text)) calls.push(node);
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === wanted) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function clientEventReport(analysis) {
  const ctx = { sf: analysis.sf };
  const calls = captureCallsOf(analysis, "captureWeddingCodeEvent");
  const problems = [];
  const names = new Set();
  for (const call of calls) {
    const [eventArg] = call.arguments;
    if (!eventArg) {
      problems.push(`${rel(analysis.fileName)}:${lineOf(analysis.sf, call)} 이벤트 이름이 없는 호출`);
      continue;
    }
    const resolved = resolveStrings(eventArg, ctx);
    if (!resolved.ok) problems.push(`${rel(analysis.fileName)}:${lineOf(analysis.sf, call)} ${resolved.why}`);
    else for (const value of resolved.values) names.add(value);
  }
  return { count: calls.length, otherCalls: captureCallsOf(analysis, "captureEvent").length, names: [...names].sort(), problems };
}

/**
 * 엔진 열 개 파일은 4.1 단계 2 기준 커밋(5ac9eda24)의 내용과 한 글자도 다르지 않다(줄 끝 문자는 같게 읽는다). 글자 엔진, 배치, 채점, 동점 사슬, 관문, 은행, 70자 코드의 뜻과 기준 계산기다.
 * 의도해서 바꿀 때(문항 뜻이 바뀌면 판 태그를 올린다, 설계 D8) 이 표의 해시를 새 값으로 고치고 이유를 PR 에 적는다. 조용히 바뀌는 길만 막는다.
 */
const ENGINE_FREEZE = [
  ["apps/web/src/lib/weddingCode/v40/flow.ts", "f30fc233f111f9a2f093f6b5779113cf51c8fe9579fdbdf6ec3c7593ce300b83"],
  // 2026-10-04 감사 A68: 답이 든 링크에 쿼리 \`?v=v4.0-tendency\` 를 더했다(assembleShareUrl 과 선택 인자 explicitVersion 만 바뀌었다. 코드 글자, 체크섬, 해시 읽기는 그대로다). 해시를 새 값으로 고쳤다. 판 태그는 올리지 않는다(해시 부분은 그대로고 쿼리가 없는 옛 링크도 그대로 열린다).
  ["apps/web/src/lib/weddingCode/v40/codec.ts", "71431e66e6106f09c10cf4aff8241d134ebe96a6bdaa0ce779572fc409191d95"],
  ["apps/web/src/lib/weddingCode/v40/score.ts", "03e756e9dc85356a26b8864346239ac5556ed0b125ba8fdf4c60863cf890aae4"],
  ["apps/web/src/lib/weddingCode/v40/gates.ts", "c130593b322e8d642151890866ef9344de649b1714faecdd30e9172694311596"],
  ["apps/web/src/lib/weddingCode/v40/value.ts", "11ae45166677b3af39f2a0b234f62cd4cd5513bf75f3810f1b23bd7ce12ccb80"],
  ["apps/web/src/lib/weddingCode/v40/states.ts", "8ddf7154bf03d6334cafdfefd2a5b9a0add561542610d8cca4278f9c00c8ced6"],
  ["apps/web/src/lib/weddingCode/v40/layout.ts", "182d744d747feb635467a6234e2280e5ad447e2258bbcd410b0bba91c27da03d"],
  ["apps/web/src/lib/weddingCode/v40/bank.ts", "efe582c81685449918c05e74ee1122f0a71aa310afb3288a71c7c0debddca3d2"],
  // 2026-10-04 문항 정비: 은행 68문항의 문구를 모두 다시 써서 해시를 새 값으로 고쳤다. 판 태그(v4.0-tendency)는 올리지 않는다(극, 세기, 키, 개수, 순서는 그대로이고 V4 링크가 나간 적이 없다).
  // 2026-10-04 처음 읽는 눈 점검 1회차: 칸 나누기 질문 문구 네 개, 한 질문의 보기 문구 둘, 회상 질문 하나, 이야기 인용 하나를 다시 썼다(구조 필드 불변). 해시를 새 값으로 고쳤다.
  ["apps/web/src/constants/weddingCodeV40Bank.ts", "6a61593eae38cdb7697b221a1d0b817c5b37819041c395a607c2d9904c0aebf5"],
  ["scripts/lib/wedding-code-v40-ref.mjs", "003a17b5d3260b8b850ab26bf88db23c2f0098de420a655a8d20d5abb6f14a62"],
];

const textHash = (text) => createHash("sha256").update(text.replace(/\r\n/gu, "\n")).digest("hex");

/** table 의 파일을 readText(저장소 상대 경로 -> 글 또는 null)로 읽어 해시가 다르거나 파일이 없는 것을 문장으로 돌려준다. */
function engineFreezeProblems(readText, table = ENGINE_FREEZE) {
  const problems = [];
  for (const [path, want] of table) {
    const text = readText(path);
    if (text === null) problems.push(`${path} 를 읽지 못했다(엔진 파일이 지워지거나 옮겨졌다)`);
    else if (textHash(text) !== want) problems.push(`${path} 가 4.1 단계 2 기준(5ac9eda24)과 다르다(내용 해시 ${textHash(text).slice(0, 12)}…). 엔진은 이 단계에서 한 줄도 바뀌지 않는다`);
  }
  return problems;
}

const readRepoText = (path) => {
  const abs = join(repoRoot, path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
};

// ---------------------------------------------------------------------------
// 허용 목록 읽기 (analyticsPrivacy.ts — 사본을 두지 않는다)
// ---------------------------------------------------------------------------

function readFunnelAllowlist() {
  assert.ok(existsSync(PATHS.analyticsPrivacy), `${rel(PATHS.analyticsPrivacy)} 가 없다 — 허용 목록을 읽을 수 없다`);
  const analysis = loadPath(PATHS.analyticsPrivacy);
  const events = constValue(analysis, "WEDDING_CODE_FUNNEL_EVENTS");
  const properties = constValue(analysis, "WEDDING_CODE_FUNNEL_PROPERTIES");
  assert.ok(Array.isArray(events) && events.length > 0 && events.every((e) => typeof e === "string"), "WEDDING_CODE_FUNNEL_EVENTS 를 읽지 못했다");
  assert.ok(Array.isArray(properties) && properties.length > 0 && properties.every((p) => typeof p === "string"), "WEDDING_CODE_FUNNEL_PROPERTIES 를 읽지 못했다");
  const regexNode = topLevelDecl(analysis.sf, "WEDDING_CODE_FUNNEL_SHORT_VALUE");
  assert.ok(regexNode && ts.isRegularExpressionLiteral(regexNode), "WEDDING_CODE_FUNNEL_SHORT_VALUE 정규식을 읽지 못했다");
  const source = regexNode.text;
  const last = source.lastIndexOf("/");
  const shortValue = new RegExp(source.slice(1, last), source.slice(last + 1));
  return { events: new Set(events), properties: new Set(properties), shortValue };
}

// ---------------------------------------------------------------------------
// 문항 은행 글 (JSON 원본 + 생성된 TS)
// ---------------------------------------------------------------------------

const BANK_STRUCTURAL_KEYS = new Set(["version", "note", "id", "axis", "facet", "fmt", "kind", "pole", "highPole", "key", "section", "screen", "placeholder"]);

function jsonStrings(value, path = "", out = []) {
  if (typeof value === "string") out.push({ text: value, path });
  else if (Array.isArray(value)) value.forEach((item, i) => jsonStrings(item, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (BANK_STRUCTURAL_KEYS.has(key)) continue;
      jsonStrings(item, path === "" ? key : `${path}.${key}`, out);
    }
  }
  return out;
}

function bankCaptionsOfJson(data) {
  return (Array.isArray(data.items) ? data.items : []).map((item, i) => ({ text: typeof item.caption === "string" ? item.caption : "", where: `items[${i}].caption` }));
}

function bankCaptionsOfTs(analysis) {
  const out = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "caption"
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      out.push({ text: node.initializer.text, where: `${rel(analysis.fileName)}:${lineOf(analysis.sf, node)}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(analysis.sf);
  return out;
}

function captionHits(caption) {
  const hits = [];
  if (CAPTION_NUMBERING.some((re) => re.test(caption.text))) hits.push("질문 제목이 번호나 라벨로 시작한다");
  return hits;
}

// ---------------------------------------------------------------------------
// 시험 공통 도우미
// ---------------------------------------------------------------------------

function textFilesOf() {
  return V40_FILES.filter((f) => !isExempt(f));
}

function recordsOf(files) {
  const out = [];
  for (const file of files) {
    for (const rec of load(file).strings) {
      if (rec.dev) continue;
      out.push({ ...rec, file });
    }
  }
  return out;
}

const bankJsonExists = existsSync(PATHS.bankJson);
function bankJson() {
  return JSON.parse(readFileSync(PATHS.bankJson, "utf8"));
}

function isBankFile(file) {
  return file.group === "constants" && /^weddingCodeV40Bank\./u.test(file.base);
}

const fmt = (list) => list.join("\n");
function assertNone(list, message) {
  assert.deepEqual(list, [], `${message}\n${fmt(list)}`);
}

/**
 * 파일이 있는데 훑은 글이 너무 적으면 통과가 아니라 실패다(파서나 경로가 깨져서 조용히 0건이 된 것이다).
 * 하한은 오늘 값(문자열 약 2400개, 한국어 약 1200개)의 55퍼센트 안팎이다. 오늘에 붙여 두면 정상 삭제가 걸린다.
 */
const SCAN_FLOOR = { strings: 1300, hangul: 650 };
function assertScanned(t, label, records) {
  const json = bankJsonExists ? jsonStrings(bankJson()) : [];
  const total = records.length + json.length;
  const hangul = records.filter((r) => HANGUL.test(r.text)).length + json.filter((r) => HANGUL.test(r.text)).length;
  t.diagnostic(`${label}: 문자열 ${total}개(그중 한국어 ${hangul}개)를 훑었다`);
  if (COPY_FILE && CONSTANTS_FILE && bankJsonExists) {
    assert.ok(total >= SCAN_FLOOR.strings, `${label}: 문자열 ${total}개만 훑었다(하한 ${SCAN_FLOOR.strings}) — 파서나 경로가 깨졌는지 볼 것`);
    assert.ok(hangul >= SCAN_FLOOR.hangul, `${label}: 한국어 문자열 ${hangul}개만 훑었다(하한 ${SCAN_FLOOR.hangul}) — 파서나 경로가 깨졌는지 볼 것`);
  }
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

test("측정기가 살아 있다 — 있는 파일은 전부 읽히고, 구문 오류가 없고, 문자열이 뽑힌다", (t) => {
  const groups = {};
  for (const f of V40_FILES) groups[f.group] = (groups[f.group] ?? 0) + 1;
  t.diagnostic(`v4 소스 ${V40_FILES.length}개 ${JSON.stringify(groups)}, v3.1 소스 ${V31_FILES.length}개, 은행 JSON ${bankJsonExists ? "있음" : "없음"}`);
  for (const group of ["components", "app"]) {
    if (!groups[group]) t.diagnostic(`(${group} 묶음에 v4 소스가 아직 없다. 생기면 자동으로 훑는다)`);
  }

  // 얼어 있는 인터페이스와 허용 목록은 지금 있다. 없으면 통과가 아니라 실패다.
  assert.ok(CONSTANTS_FILE, `${rel(PATHS.constantsMain)} 가 없다(얼어 있는 상수)`);
  assert.ok(existsSync(PATHS.analyticsPrivacy), `${rel(PATHS.analyticsPrivacy)} 가 없다(허용 목록의 출처)`);
  assert.ok(groups.lib >= 6, `lib/weddingCode/v40 에서 소스 ${groups.lib ?? 0}개만 찾았다 — 경로가 어긋났는지 볼 것`);
  assert.ok(V31_FILES.length >= 10, `v3.1 소스를 ${V31_FILES.length}개만 찾았다 — 방향 반대 검사가 눈이 멀었다`);

  const syntax = [];
  for (const file of V40_FILES) {
    const a = load(file);
    for (const err of a.syntaxErrors) syntax.push(`${file.rel}:${err}`);
  }
  assertNone(syntax, "구문 오류가 있는 파일은 훑을 수 없다(조용히 통과하지 않는다)");

  // 있는 파일이 문자열 0개로 읽히면 파서가 못 읽은 것이다.
  const constantsCount = load(CONSTANTS_FILE).strings.length;
  assert.ok(constantsCount >= 100, `constants/weddingCodeV40.ts 에서 문자열 ${constantsCount}개만 뽑혔다`);
  if (COPY_FILE) {
    const copyCount = load(COPY_FILE).strings.length;
    assert.ok(copyCount >= 150, `copy.ts 에서 문자열 ${copyCount}개만 뽑혔다`);
  }
  if (bankJsonExists) {
    const n = jsonStrings(bankJson()).length;
    assert.ok(n >= 300, `은행 JSON 에서 글 ${n}개만 뽑혔다`);
  }

  // 문자열 규칙에서 빼는 파일은 이유가 지금도 참일 때만 뺀다.
  for (const [name, { needle, why }] of STRING_RULE_EXEMPT) {
    for (const file of byBase(name)) {
      assert.ok(readFileSync(file.abs, "utf8").includes(needle), `${file.rel} 를 문자열 규칙에서 뺀 이유(${why})가 더는 참이 아니다 — 예외를 지울 것`);
    }
  }
});

test("규칙 1: 글자는 대문자 여덟 개(V S W D U F H A)이고 서로 다르다", (t) => {
  assert.ok(CONSTANTS_FILE, "상수 파일이 없다");
  const analysis = load(CONSTANTS_FILE);
  assert.deepEqual(constValue(analysis, "V40_LETTER_LIST"), ALLOWED_LETTERS, "V40_LETTER_LIST 가 V S W D U F H A 가 아니다");
  const letters = constValue(analysis, "V40_LETTERS");
  assert.equal(letters.length, 8);
  assert.deepEqual(letters.map((l) => l.letter), ALLOWED_LETTERS, "V40_LETTERS 의 글자 순서와 종류가 다르다");
  for (const l of letters) assert.match(l.letter, /^[A-Z]$/u, `글자 ${l.letter} 는 대문자 한 자가 아니다`);
  for (const field of ["name", "english", "meaning", "answerSentence", "readingPiece"]) {
    const values = letters.map((l) => l[field]);
    assert.equal(new Set(values).size, 8, `글자 여덟 개의 ${field} 가 서로 달라야 한다(글자 하나는 뜻 하나)`);
  }
  const axes = constValue(analysis, "V40_AXES");
  assert.deepEqual(axes.flatMap((a) => [a.front, a.back]), ALLOWED_LETTERS, "주제의 앞 글자와 뒤 글자가 여덟 글자와 다르다");
  t.diagnostic("여덟 글자 표를 상수에서 읽어 대조했다");
});

test("규칙 1: 상태 글자(B M N ?)와 소문자 변형이 글자처럼 보이지 않는다", (t) => {
  const files = textFilesOf();
  if (files.length === 0 && !bankJsonExists) return t.skip("v4 소스가 없다");
  const offenders = [];
  const records = recordsOf(files);
  assertScanned(t, "규칙 1", records);
  for (const rec of records) {
    for (const hit of letterHits(rec)) offenders.push(`${rec.file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 50)}`);
  }
  if (bankJsonExists) {
    for (const rec of jsonStrings(bankJson())) {
      for (const hit of letterHits({ text: rec.text, visible: true, kind: "string" })) offenders.push(`${rel(PATHS.bankJson)} ${rec.path} [${hit}] ${rec.text.slice(0, 50)}`);
    }
  }
  assertNone(offenders, "글자 여덟 개 밖의 대문자, ?, 소문자가 글자처럼 보인다:");
});

test("규칙 2: 주장 낱말이 화면 문구, 상수, 문항 은행에 없다", (t) => {
  const files = textFilesOf();
  if (files.length === 0 && !bankJsonExists) return t.skip("v4 소스가 없다");
  const offenders = [];
  const records = recordsOf(files);
  assertScanned(t, "규칙 2", records);
  for (const rec of records) {
    const set = isBankFile(rec.file) ? "bank" : "text";
    for (const hit of claimHits(rec, set)) offenders.push(`${rec.file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 60)}`);
  }
  if (bankJsonExists) {
    for (const rec of jsonStrings(bankJson())) {
      for (const hit of claimHits({ text: rec.text, visible: true, kind: "string" }, "bank")) offenders.push(`${rel(PATHS.bankJson)} ${rec.path} [${hit}] ${rec.text.slice(0, 60)}`);
    }
  }
  assertNone(
    offenders,
    `계속 쓰지 않는 말이 나왔다(설계 9절 1항). 허용되는 부정문은 「${NOT_VALIDATED_PHRASE}」 하나뿐이고 진단, 궁합, 점수를 부정하는 문장도 허용하지 않는다(9절 12항, 예외 없이 문구를 고친다):`,
  );
});

test("규칙 3: 줄표와 「~인 답」이 화면 문구에 없다", (t) => {
  const files = textFilesOf();
  if (files.length === 0 && !bankJsonExists) return t.skip("v4 소스가 없다");
  const offenders = [];
  const records = recordsOf(files);
  assertScanned(t, "규칙 3", records);
  for (const rec of records) {
    for (const hit of styleHits(rec)) offenders.push(`${rec.file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 60)}`);
  }
  if (bankJsonExists) {
    for (const rec of jsonStrings(bankJson())) {
      for (const hit of styleHits({ text: rec.text, visible: true, kind: "string" })) offenders.push(`${rel(PATHS.bankJson)} ${rec.path} [${hit}] ${rec.text.slice(0, 60)}`);
    }
  }
  assertNone(offenders, "긴 줄표, 짧은 줄표, 「~인 답」은 쓰지 않는다:");
});

test("규칙 4: v4 는 v3.1 모듈(과 옛 판 모듈)을 가져오지 않는다", (t) => {
  if (V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const patterns = [
    ...V31_MODULES.map((re) => ["v3.1 모듈", re]),
    ...OLDER_MODULES.map((re) => ["옛 판 모듈", re]),
  ];
  const offenders = [];
  for (const file of V40_FILES) {
    for (const hit of importHits(load(file), patterns)) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, "v4 가 옛 판 모듈에 기대고 있다(진행 저장 키 문자열만 읽고 모듈은 가져오지 않는다):");
});

test("규칙 4: v3.1 소스는 v4 를 가져오지 않는다", () => {
  assert.ok(V31_FILES.length >= 10, `v3.1 소스를 ${V31_FILES.length}개만 찾았다`);
  const offenders = [];
  for (const file of V31_FILES) {
    for (const hit of importHits(load(file), V40_MODULES.map((re) => ["v4 모듈", re]))) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, "v3.1 파일은 한 글자도 바꾸지 않는다(설계 9절 9항):");
});

test("규칙 4: 이전 판 진행 저장 키 문자열이 v3.1 의 값과 같다", (t) => {
  if (!CONSTANTS_FILE) return t.skip("상수 파일이 없다");
  const storage = constValue(load(CONSTANTS_FILE), "V40_STORAGE");
  const v31Key = constValue(loadPath(PATHS.v31Progress), "LOCAL_KEY");
  const v31Pref = constValue(loadPath(PATHS.v31Hook), "V31_SAVE_PREFERENCE_KEY");
  assert.equal(storage.legacyV31ProgressKey, v31Key, "v4 가 읽는 이전 판 진행 저장 키가 v3.1 의 LOCAL_KEY 와 다르다");
  assert.equal(storage.legacyV31AutosaveKey, v31Pref, "v4 가 읽는 이전 판 자동 저장 선호 키가 v3.1 의 V31_SAVE_PREFERENCE_KEY 와 다르다");
});

test("규칙 5: v4 는 네트워크 요청, 쿠키, 콘솔 호출을 하지 않는다", (t) => {
  if (V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const offenders = [];
  for (const file of V40_FILES) {
    const analysis = load(file);
    for (const hit of apiHits(analysis, file)) {
      if (hit.api === "network" || hit.api === "cookie" || hit.api === "console") offenders.push(`${file.rel}:${hit.line} [${hit.api}] ${hit.what}`);
    }
    for (const hit of externalUrlHits(analysis)) offenders.push(`${file.rel}:${hit.line} [network] ${hit.what}`);
    for (const hit of navigationHits(analysis)) offenders.push(`${file.rel}:${hit.line} [이동] ${hit.what}`);
  }
  assertNone(offenders, "답은 서버로 나가지 않는다(fetch, XMLHttpRequest, sendBeacon, 오류 수집, 통계 SDK 등 요청 없음, 외부 주소 없음, 계산된 주소로 이동 없음, document.cookie 없음, console 호출 없음):");
});

test("규칙 5: navigator.share 는 보내기 컴포넌트에서만 쓴다", (t) => {
  if (V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const offenders = [];
  for (const file of V40_FILES) {
    for (const hit of apiHits(load(file), file)) if (hit.api === "share") offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, "공유 창은 components/wedding-code/v40 의 Share*, Send* 컴포넌트에서만 연다:");
  if (!V40_FILES.some((f) => f.group === "components" && /(share|send)/iu.test(f.base))) t.diagnostic("(보내기 컴포넌트가 아직 없다. 생기면 그 파일만 navigator.share 를 쓸 수 있다)");
});

test("규칙 5: 브라우저 저장소는 storage.ts 한 곳만 이름을 부르고, 그 밖에서는 저장 키와 저장소 메서드를 쓰지 않는다", (t) => {
  if (V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const offenders = [];
  for (const file of V40_FILES) {
    if (file.abs === PATHS.storage) continue;
    const analysis = load(file);
    for (const hit of apiHits(analysis, file)) {
      if (hit.api === "storage") offenders.push(`${file.rel}:${hit.line} ${hit.what} (localStorage 등의 이름은 lib/weddingCode/v40/storage.ts 만 부른다. 클라이언트는 storage.ts 의 browserStorage() 로 핸들을 받는다)`);
    }
    for (const hit of storageBypassHits(analysis)) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  // v4 가 직접 가져오는 이웃 파일(v4 폴더 밖)도 울타리 안이다: 저장소 핸들을 밖의 임시 파일로 빼돌리는 길을 막는다.
  const neighbors = importedNeighbors();
  t.diagnostic(`v4 가 가져오는 wedding-code 이웃 파일 ${neighbors.length}개도 훑었다: ${neighbors.map((f) => f.rel).join(", ")}`);
  for (const file of neighbors) {
    const analysis = load(file);
    // 저장소 핸들 도우미는 저장소 이름이 realLocalStorage 한 함수 안에 한 번만 있는지를 아래에서 따로 본다(다른 이웃은 이름이 하나도 없어야 한다).
    for (const hit of file.abs === PATHS.storageHandle ? [] : apiHits(analysis, file)) {
      if (hit.api === "storage") offenders.push(`${file.rel}:${hit.line} ${hit.what} (v4 가 가져오는 이웃 파일이다. 저장소 이름은 lib/weddingCode/browserStorageHandle.ts 의 realLocalStorage() 만 부른다)`);
    }
    for (const hit of storageBypassHits(analysis)) offenders.push(`${file.rel}:${hit.line} ${hit.what} (v4 가 가져오는 이웃 파일)`);
  }
  // storage.ts 자신: 이름이 하나도 없고, browserStorage() 가 도우미의 realLocalStorage() 를 부른다.
  const storageFile = V40_FILES.find((f) => f.abs === PATHS.storage);
  if (storageFile) for (const problem of storageDelegationProblems(load(storageFile))) offenders.push(problem);
  // 저장소 핸들 도우미: 이름은 export function realLocalStorage 한 함수 안에 한 번만.
  if (existsSync(PATHS.storageHandle)) for (const problem of storageHandleProblems(loadPath(PATHS.storageHandle))) offenders.push(problem);
  else if (storageFile) offenders.push("lib/weddingCode/browserStorageHandle.ts 가 없다(v4 의 browserStorage() 가 의존하는 저장소 핸들 도우미)");
  assertNone(offenders, "브라우저 저장소를 browserStorageHandle.ts 의 realLocalStorage() 밖에서 만졌다(끄기의 지우기를 건너뛰는 길이 된다):");
  if (!existsSync(PATHS.storage)) t.diagnostic("(storage.ts 가 아직 없다. 생기면 그 파일의 browserStorage() 가 realLocalStorage() 를 불러 핸들을 받는다)");
});

test("규칙 6: 이용 통계 호출은 고지한 이벤트와 속성만 쓴다", (t) => {
  if (V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const allow = readFunnelAllowlist();
  t.diagnostic(`허용 이벤트 ${allow.events.size}개, 속성 ${allow.properties.size}개를 analyticsPrivacy.ts 에서 읽었다`);
  const offenders = [];
  let calls = 0;
  for (const file of V40_FILES) {
    const analysis = load(file);
    const hits = analyticsHits(analysis, allow);
    for (const hit of hits) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
    calls += (analysis.text.match(/captureWeddingCodeEvent|captureEvent/gu) ?? []).length;
  }
  assertNone(offenders, "고지하지 않은 통계 이벤트나 속성이 있다(처리방침 제3조, 설계 9절 8항):");
  if (calls === 0) t.diagnostic("(v4 소스에 통계 호출이 아직 없다)");
});

test("규칙 7: 보이는 글자에 A/B, 가나다, 번호 라벨이 없다", (t) => {
  const uiFiles = V40_FILES.filter((f) => f.group === "components" || f.group === "app");
  if (uiFiles.length === 0 && V40_FILES.length === 0) return t.skip("v4 소스가 없다");
  const offenders = [];
  // 화면 컴포넌트와 클라이언트: 글자 하나짜리 문자열, 보이는 번호와 라벨, 번호를 붙이는 템플릿.
  for (const file of uiFiles) {
    const analysis = load(file);
    for (const rec of analysis.strings) {
      if (rec.dev) continue;
      for (const hit of labelHits(rec, { components: true, bank: false, text: false })) offenders.push(`${file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 40)}`);
    }
    for (const hit of jsxNumberingHits(analysis)) offenders.push(`${file.rel}:${hit.line} [${hit.what}]`);
    for (const hit of numberingHits(analysis)) offenders.push(`${file.rel}:${hit.line} [계산한 번호: ${hit.what}]`);
  }
  // 문구, 상수, 문항 은행: 앞에 붙은 라벨과 번호, 카드 옆 알파벳 라벨, 은행 제목의 번호.
  for (const file of V40_FILES.filter((f) => f.group === "lib" || f.group === "constants")) {
    if (isExempt(file)) continue;
    const bank = isBankFile(file);
    const analysis = load(file);
    for (const rec of analysis.strings) {
      if (rec.dev) continue;
      for (const hit of labelHits(rec, { components: false, bank, text: !bank })) offenders.push(`${file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 40)}`);
    }
    if (bank) for (const caption of bankCaptionsOfTs(analysis)) for (const hit of captionHits(caption)) offenders.push(`${caption.where} [${hit}] ${caption.text}`);
  }
  if (bankJsonExists) {
    const data = bankJson();
    for (const rec of jsonStrings(data)) {
      for (const hit of labelHits({ text: rec.text, visible: true, kind: "string" }, { components: false, bank: true, text: false })) offenders.push(`${rel(PATHS.bankJson)} ${rec.path} [${hit}] ${rec.text.slice(0, 40)}`);
    }
    for (const caption of bankCaptionsOfJson(data)) for (const hit of captionHits(caption)) offenders.push(`${rel(PATHS.bankJson)} ${caption.where} [${hit}] ${caption.text}`);
  }
  assertNone(offenders, "질문 번호, 화면 번호, 선택지 번호, A/B 라벨은 화면에 없다(파운더 노트 1, 설계 6절 진행 표시). 이 검사는 부분 검사이고 실행 검사(페르소나 브라우저)가 병합 조건이다:");
  if (uiFiles.length === 0) t.diagnostic("(화면 컴포넌트가 아직 없다. 생기면 자동으로 훑는다)");
});

test("규칙 8: 판 이름표는 v4.0-tendency 이고 링크 키 상수는 v, a, b 뿐이며 해시 키는 거기에 ga, gb 를 더한 다섯이다", (t) => {
  assert.ok(CONSTANTS_FILE, "상수 파일이 없다");
  const constants = load(CONSTANTS_FILE);
  assert.equal(constValue(constants, "WEDDING_CODE_V40_VERSION"), VERSION_TAG, "WEDDING_CODE_V40_VERSION 이 v4.0-tendency 가 아니다");
  const linkKeys = constValue(constants, "V40_LINK_KEYS");
  assert.deepEqual(Object.values(linkKeys).sort(), LINK_KEY_CONSTANT, "링크 해시 키가 정확히 v, a, b 여야 한다(짐작 키 ga, gb 는 이 상수가 아니라 V40_GUESS_LINK_KEYS 가 갖는다)");
  assert.deepEqual(Object.keys(linkKeys).sort(), ["first", "second", "version"], "V40_LINK_KEYS 의 항목이 version, first, second 셋이 아니다");
  if (bankJsonExists) assert.equal(bankJson().version, VERSION_TAG, "문항 은행 JSON 의 version 이 판 이름표와 다르다");

  const offenders = [];
  for (const file of V40_FILES) {
    const analysis = load(file);
    for (const rec of analysis.strings) {
      if (rec.dev) continue;
      if (file !== CONSTANTS_FILE && rec.text.includes(VERSION_TAG)) offenders.push(`${file.rel}:${rec.line} 판 이름표를 문자열로 다시 적었다 — WEDDING_CODE_V40_VERSION 을 가져올 것`);
      if (file !== CONSTANTS_FILE) for (const hit of hashKeyHits(rec)) offenders.push(`${file.rel}:${rec.line} ${hit}`);
      for (const hit of queryKeyHits(rec)) offenders.push(`${file.rel}:${rec.line} ${hit}`);
    }
    for (const hit of urlSearchParamKeyHits(analysis)) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, `판 이름표는 상수 한 곳에서 가져오고, 링크 해시 키는 ${ALLOWED_HASH_KEYS.join(", ")} 뿐이며 쿼리 키는 v 뿐이다:`);
  t.diagnostic("판 이름표와 링크 키 상수를 읽어 대조했다");
});

test("규칙 8: 짐작 코덱의 해시 키 상수는 정확히 ga, gb 이다", () => {
  assert.ok(existsSync(PATHS.guessLink), `${rel(PATHS.guessLink)} 가 없다 — 짐작 링크 코덱의 자리가 바뀌었으면 이 가드도 함께 고칠 것`);
  const keys = constValue(loadPath(PATHS.guessLink), "V40_GUESS_LINK_KEYS");
  assert.deepEqual(keys, { first: "ga", second: "gb" }, "V40_GUESS_LINK_KEYS 가 정확히 ga(a 옆), gb(b 옆)가 아니다");
  assert.deepEqual(Object.values(keys), GUESS_LINK_KEYS, "가드가 아는 짐작 키와 코덱의 상수가 다르다");
  // 짐작 키가 링크 키 상수로 새어 들어가지 않았다(70자 a, b 의 뜻과 입구의 키 목록을 그대로 둔다는 약속).
  assert.equal(GUESS_LINK_KEYS.some((key) => LINK_KEY_CONSTANT.includes(key)), false, "짐작 키가 링크 키 상수와 겹친다");
});

test("규칙 9: 「검증을 마친 심리검사가 아니」 고지는 시작, 받는 사람, 결과, 두 사람 결과에 한 번씩만 있다", (t) => {
  if (!COPY_FILE) return t.skip("lib/weddingCode/v40/copy.ts 가 아직 없다");
  const analysis = load(COPY_FILE);
  assert.equal(constValue(analysis, "V40_NOT_VALIDATED_PHRASE"), NOT_VALIDATED_PHRASE, "copy.ts 의 V40_NOT_VALIDATED_PHRASE 가 가드가 세는 문장과 다르다");
  const report = noticeReport(analysis);

  const groupIssues = [];
  for (const [name, count] of Object.entries(report.groups)) {
    const want = NOTICE_GROUPS_ONE.includes(name) ? 1 : 0;
    if (count !== want) groupIssues.push(`묶음 ${name}: 고지 ${count}번 (있어야 하는 수 ${want})`);
  }
  for (const name of NOTICE_GROUPS_ONE) if (!(name in report.groups)) groupIssues.push(`묶음 ${name} 이 V40_COPY 에 없다`);
  assertNone(groupIssues, "고지 문장은 시작(intro), 받는 사람(receive), 결과(result), 두 사람 결과(couple) 묶음에 정확히 한 번씩, 그 밖의 묶음에는 없어야 한다:");

  const screenIssues = [];
  for (const [screen, count] of Object.entries(report.perScreen)) {
    const want = NOTICE_GROUPS_ONE.includes(screen) ? 1 : 0;
    if (count !== want) screenIssues.push(`화면 ${screen}: 고지 ${Number.isNaN(count) ? "(V40_COPY 에 없는 묶음을 씀)" : `${count}번`} (있어야 하는 수 ${want})`);
  }
  assertNone(screenIssues, "V40_COPY_SCREENS 로 합친 화면마다 고지는 한 번(시작, 받는 사람, 결과, 두 사람 결과)이거나 없어야 한다:");
  assertNone(report.stray.map((s) => `copy.ts:${s.line} ${s.what}`), "고지 문장이 V40_COPY 밖에 있으면 화면별 횟수를 셀 수 없다:");

  const elsewhere = [];
  for (const file of V40_FILES) {
    if (file === COPY_FILE) continue;
    for (const rec of load(file).strings) {
      if (/검증을\s*마친/u.test(rec.text)) elsewhere.push(`${file.rel}:${rec.line} 고지 문장은 copy.ts 에서만 쓴다`);
    }
  }
  if (bankJsonExists) for (const rec of jsonStrings(bankJson())) if (/검증을\s*마친/u.test(rec.text)) elsewhere.push(`${rel(PATHS.bankJson)} ${rec.path} 문항 글에 고지 문장이 있다`);
  assertNone(elsewhere, "고지 문장이 copy.ts 밖에 있다:");
});

test("규칙 10: v4 링크를 여는 앱 쪽 파일은 Sentry 주소 꼬리 정제(#473)가 main 에 있어야 생길 수 있다", (t) => {
  assert.ok(existsSync(PATHS.sentryScrub), `${rel(PATHS.sentryScrub)} 가 없다 — 경로가 바뀌었으면 이 가드도 함께 고칠 것`);
  const handled = scrubHandlesContexts(readFileSync(PATHS.sentryScrub, "utf8"));
  const openers = findLinkOpeners();
  t.diagnostic(`v4 링크를 여는 앱 쪽 파일 ${openers.length}개, sentryScrub.ts 가 contexts 를 다룸: ${handled ? "예" : "아니오"}`);
  if (openers.length === 0) t.diagnostic("(v4 코덱이나 v4 클라이언트를 가져오는 앱 쪽 파일이 아직 없다. 생기는 PR 이 이 순서 규칙의 대상이다)");
  assertNone(
    sentryGateHits(openers, handled),
    "답이 든 v4 링크(# 뒤)는 브라우저 SDK 가 성능 이벤트의 url.full 에 실어 오류 수집 도구로 보낸다. packages/shared 의 sentryScrub.ts 가 contexts 안 주소의 ?·# 꼬리를 자르는 수정(#473)이 main 에 들어오고 운영에서 확인된 뒤에 이 파일들을 병합한다(계약 문서 13절 순서 규칙):",
  );
});

// ---------------------------------------------------------------------------
// 4.1 단계 2 규칙 (서로 짐작하기, 결과 전 글자 고르기)
// ---------------------------------------------------------------------------

test("4.1 단계 2: 새 폴더(guess, letterGuess)와 생성 상수가 검사 대상에 들어 있고 컴포넌트 폴더는 화면 컴포넌트로 읽힌다", (t) => {
  const dirs = [
    ["lib/weddingCode/v40/guess", GUESS_LIB_DIR],
    ["lib/weddingCode/v40/letterGuess", LETTER_LIB_DIR],
    ["components/wedding-code/v40/guess", GUESS_COMPONENT_DIR],
    ["components/wedding-code/v40/letterGuess", LETTER_COMPONENT_DIR],
  ];
  const staged = new Set(stageFiles().map((f) => f.abs));
  for (const [label, dir] of dirs) {
    assert.ok(existsSync(dir), `${label} 폴더가 없다 — 새 단계의 폴더 이름이 바뀌었으면 STAGE_FOLDERS 와 이 가드를 함께 고칠 것`);
    const inside = V40_FILES.filter((f) => isUnderDir(f.abs, dir));
    assert.ok(inside.length >= 2, `${label} 에서 소스 ${inside.length}개만 찾았다(시험 파일은 뺀다) — 경로가 어긋났는지 볼 것`);
    // 규칙 5(새 단계), 11, 14, 17 이 훑는 묶음(stageFiles)이 이 폴더의 파일을 모두 담는다(STAGE_FOLDERS 가 폴더 이름과 어긋나면 규칙이 조용히 빈 손이 된다).
    for (const file of inside) assert.ok(staged.has(file.abs), `${file.rel} 가 새 단계 파일 묶음에 없다 — STAGE_FOLDERS 가 폴더 이름과 어긋났다`);
  }
  // 컴포넌트 폴더의 파일은 group 이 components 라서 규칙 7(한 글자 문자열, 보이는 번호와 라벨)의 화면 컴포넌트 묶음에 든다.
  for (const dir of STAGE_COMPONENT_DIRS) {
    for (const file of V40_FILES.filter((f) => isUnderDir(f.abs, dir))) {
      assert.equal(file.group, "components", `${file.rel} 가 화면 컴포넌트 묶음이 아니다(규칙 7 이 한 글자 문자열을 보지 못한다)`);
    }
  }
  assert.ok(V40_FILES.some((f) => f.abs === PATHS.guessConstants), `${rel(PATHS.guessConstants)} 가 v4 소스 묶음에 없다(생성 상수의 이름은 weddingCodeV40 로 시작해야 모든 규칙이 훑는다)`);
  const stage2 = V40_FILES.filter((f) => f.group === "app" && STAGE2_APP_FILE.test(f.base));
  t.diagnostic(`새 단계 소스 ${stageFiles().length}개, 클라이언트 단계 훅 ${stage2.length}개${stage2.length === 0 ? "(통합자가 WeddingCodeV40Client.stage2.tsx 를 더하면 규칙 11 이 자동으로 훑는다)" : ""}`);
});

test("규칙 5 (새 단계): 새 단계 파일은 저장소 이름, 저장소 메서드, 저장 키(글자 고르기 키 포함)를 쓰지 않는다", () => {
  const files = stageFiles();
  assert.ok(files.length > 0, "새 단계 파일을 하나도 찾지 못했다");
  const offenders = [];
  for (const file of files) {
    const analysis = load(file);
    for (const hit of apiHits(analysis, file)) if (hit.api === "storage") offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
    for (const hit of storageBypassHits(analysis)) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, "새 단계는 저장소를 직접 만지지 않는다(글자 고르기 보관본은 storage.ts 의 포트로, 서로 짐작하기는 저장하지 않는다):");
});

test("규칙 11: 새 단계 파일은 이용 통계를 가져오지도 부르지도 않는다", () => {
  const files = stageFiles();
  assert.ok(files.length > 0, "새 단계 파일을 하나도 찾지 못했다");
  const offenders = [];
  for (const file of files) for (const hit of statsFreeHits(load(file))) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  assertNone(offenders, "새 단계(서로 짐작하기, 결과 전 글자 고르기)는 이용 통계 항목을 더하지 않는다(처리방침 제3조):");
});

test("규칙 13: 글자 고르기 폴더는 링크 코덱, 짐작 폴더, 입구를 가져오지 않는다", () => {
  const files = letterGuessFiles();
  assert.ok(files.length >= 2, `글자 고르기 소스를 ${files.length}개만 찾았다`);
  const offenders = [];
  for (const file of files) for (const hit of letterGuessIsolationHits(load(file))) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  assertNone(offenders, "결과 전에 고른 글자는 링크에 가지 않는다(계약 문서 §23). 링크를 만들고 읽는 모듈과 이어지면 안 된다:");
});

test("규칙 14: 새 단계 파일과 생성 상수에는 골든 링크, 한 글자 대문자 값, 개발 메모가 없다", () => {
  const files = [...stageFiles(), ...V40_FILES.filter((f) => f.abs === PATHS.guessConstants)];
  assert.ok(files.length > 0, "대상 파일을 하나도 찾지 못했다");
  const offenders = [];
  for (const file of files) {
    for (const hit of stageDataHits(load(file), { generated: file.abs === PATHS.guessConstants })) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  }
  assertNone(offenders, "골든 값은 시험 파일에만 두고, 글자는 상수에서 읽고, 원천 자료의 개발 메모는 번들로 나가지 않는다(규칙 1 이 v4 소스의 여덟 글자 밖 대문자 한 자를 거절한다):");
});

test("규칙 15: 새 폴더는 바렐을 가져오지 않는다(useScreenFocus, SectionCard, styles 는 경로로 직접)", () => {
  const files = stageFolderFiles();
  assert.ok(files.length > 0, "새 폴더의 파일을 하나도 찾지 못했다");
  const offenders = [];
  for (const file of files) for (const hit of barrelImportHits(load(file))) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  assertNone(offenders, "바렐(components/wedding-code/v40 의 index)은 useScreenFocus 와 screenRootClass 를 다시 내보내서 새 컴포넌트가 바렐에서 가져오면 순환이 생긴다:");
});

test("규칙 16: 클라이언트 본체의 통계 호출은 열 개이고 이벤트 이름은 고지한 여덟 개 그대로다", () => {
  assert.ok(existsSync(PATHS.client), `${rel(PATHS.client)} 가 없다 — 경로가 바뀌었으면 이 가드도 함께 고칠 것`);
  const report = clientEventReport(loadPath(PATHS.client));
  assertNone(report.problems, "통계 이벤트 이름을 문자열로 확정하지 못했다(이름은 호출 자리에 글자 그대로 적는다):");
  assert.equal(report.count, CLIENT_CAPTURE_CALLS, `captureWeddingCodeEvent 호출이 ${report.count}개다(기준 ${CLIENT_CAPTURE_CALLS}개). 단계 배선이 본체에서 통계를 새로 부르면 안 된다`);
  assert.equal(report.otherCalls, 0, "클라이언트가 captureEvent 를 직접 부른다(통계는 captureWeddingCodeEvent 호출 열 개뿐이다)");
  assert.deepEqual(report.names, FIXED_FUNNEL_EVENTS, "클라이언트가 부르는 통계 이벤트가 고지한 여덟 개와 다르다");
  const allow = readFunnelAllowlist();
  assert.deepEqual([...allow.events].sort(), FIXED_FUNNEL_EVENTS, "analyticsPrivacy.ts 의 고지 이벤트 목록이 이 가드의 여덟 개와 다르다(바꿨다면 이 가드, 처리방침, 계약 문서 §14 를 함께 고칠 것)");
});

test("규칙 17: 새 단계 파일이 던지는 오류의 메시지에는 입력 글자가 없다", () => {
  const files = stageFiles();
  assert.ok(files.length > 0, "새 단계 파일을 하나도 찾지 못했다");
  const offenders = [];
  for (const file of files) for (const hit of errorMessageHits(load(file))) offenders.push(`${file.rel}:${hit.line} ${hit.what}`);
  assertNone(offenders, "오류 메시지는 고정 문자열이다(기존 checksumChar 는 쓸 수 없는 문자 한 글자를 메시지에 싣는데, 새 코덱은 싣지 않는다):");
});

test("새 단계의 화면 글에는 누가 맞혔는지, 점수, 개수 말이 없다", (t) => {
  const files = [...stageFiles(), ...V40_FILES.filter((f) => f.abs === PATHS.guessConstants)];
  assert.ok(files.length > 0, "대상 파일을 하나도 찾지 못했다");
  const offenders = [];
  let scanned = 0;
  for (const file of files) {
    const analysis = load(file);
    const scope = wordScopeOf(file, analysis);
    for (const rec of analysis.strings) {
      if (rec.dev || !userFacing(rec)) continue;
      scanned += 1;
      for (const hit of stageWordHits(rec, scope)) offenders.push(`${file.rel}:${rec.line} [${hit}] ${rec.text.slice(0, 50)}`);
    }
  }
  t.diagnostic(`새 단계의 화면 글 ${scanned}개를 훑었다`);
  assert.ok(scanned >= 40, `화면 글을 ${scanned}개만 훑었다 — 파서나 경로가 깨졌는지 볼 것`);
  assertNone(offenders, "짐작한 쪽과 고른 쪽은 사실로 나란히 놓을 뿐이다. 누가 맞혔는지, 점수, 개수를 말하지 않는다(계약 문서 §23):");
});

test("엔진 열 개 파일은 4.1 단계 2 기준(5ac9eda24)과 한 글자도 다르지 않다", () => {
  assert.equal(ENGINE_FREEZE.length, 10, "엔진 고정표가 열 개가 아니다");
  assert.equal(new Set(ENGINE_FREEZE.map(([path]) => path)).size, 10, "엔진 고정표에 같은 파일이 두 번 있다");
  assertNone(engineFreezeProblems(readRepoText), "글자 엔진, 배치, 채점, 동점 사슬, 관문, 은행, 70자 코드, 기준 계산기는 이 단계에서 한 줄도 바뀌지 않는다(바꾸려면 판 태그를 올릴지부터 정한다):");
});

// ---------------------------------------------------------------------------
// 검사기 자가 시험 — 답을 아는 표본으로 잰다
// ---------------------------------------------------------------------------

const recs = (source, fileName = "sample.tsx") => analyzeText(source, fileName).strings;
const has = (list, predicate) => list.some(predicate);

test("검사기가 실제로 잡는다: 줄 끝 주석과 문자열 안의 // 를 바르게 가른다", () => {
  // 정규식 주석 제거기가 틀리던 자리다: 문자열 안의 // 와, 코드 뒤에 붙은 줄 끝 주석.
  const source = [
    'const a = "지금은 정확해요"; // 검증된 결과라고 적었던 주석',
    'const url = "https://example.com/점수"; /* 궁합 */ const b = \'끝\';',
    "const c = `등급 ${a} 동물`; // 캐릭터",
  ].join("\n");
  const texts = recs(source, "sample.ts").map((r) => r.text);
  assert.ok(texts.includes("지금은 정확해요"), "줄 끝 주석 앞의 문자열을 잃었다");
  assert.ok(texts.includes("https://example.com/점수"), "문자열 안의 // 를 주석으로 읽었다");
  assert.ok(texts.includes("끝"), "블록 주석 뒤의 문자열을 잃었다");
  assert.ok(texts.some((t) => t.startsWith("등급 ")), "템플릿 문자열을 잃었다");
  assert.ok(!texts.some((t) => t.includes("검증된") || t.includes("캐릭터") || t === "궁합"), "주석 속 낱말이 문자열로 읽혔다");
  const claimSet = recs(source, "sample.ts").flatMap((r) => claimHits(r, "text"));
  for (const id of ["정확", "점수", "등급", "동물"]) assert.ok(claimSet.includes(id), `${id} 를 못 잡았다`);
  assert.ok(!claimSet.includes("검증") && !claimSet.includes("캐릭터") && !claimSet.includes("궁합"), "주석의 낱말을 잡았다");

  // 낱말을 두 조각으로 쪼개 이어 쓰거나 템플릿 조각에 나눠 써도 한 글로 읽는다.
  const split = recs('export const x = "이건 검" + "증된 결과예요";', "split.ts");
  assert.equal(split.length, 1, "이어 붙인 문자열을 한 글로 읽지 못했다");
  assert.ok(claimHits(split[0], "text").includes("검증"), "쪼개 쓴 검증된 을 못 잡았다");
  assert.equal(recs('export const y = prefix + "검증된";', "part.ts").flatMap((r) => claimHits(r, "text")).includes("검증"), true, "식과 섞어 이은 글의 리터럴 조각을 못 잡았다");
});

test("검사기가 실제로 잡는다: 낱말, 글자, 줄표, 라벨", () => {
  const hit = (source, fn, expected, name) => {
    const found = recs(source).flatMap((r) => fn(r));
    assert.ok(found.some((h) => (typeof h === "string" ? h.includes(expected) : h.what.includes(expected))), `${name}: 「${expected}」를 못 잡았다 (${JSON.stringify(found)})`);
  };
  const claim = (r) => claimHits(r, "text");
  hit('export const x = "검증된 결과예요";', claim, "검증", "검증된");
  hit('export const x = "성격을 진단하는 검사가 아니에요";', claim, "진단", "진단의 부정문도 잡는다");
  hit('export const x = "궁합이 잘 맞아요";', claim, "궁합", "궁합");
  hit('export const x = "이 결과는 MBTI 같아요";', claim, "MBTI", "MBTI");
  hit('export const x = "답이 90% 모였어요";', claim, "백분율", "% 기호");
  hit('export const x = "일하는 스타일이에요";', claim, "스타일", "스타일");
  hit('export const x = "잘 맞는 두 사람이에요";', claim, "잘 맞음", "잘 맞");
  hit('export const x = "성격이 급해요";', claim, "성격", "성격");
  // 4.1 단계 1이 더한 말. 속을 읽어 냈다는 주장과 사람을 단정하는 말이다.
  hit('export const x = "말하지 않은 속마음이 보여요";', claim, "속마음", "속마음");
  hit('export const x = "무의식이 드러나요";', claim, "무의식", "무의식");
  hit('export const x = "본모습을 알려 줘요";', claim, "본모습", "본모습");
  hit('export const x = "두 답이 모순돼요";', claim, "모순", "모순");
  hit('export const x = "답이 일관성 있게 모였어요";', claim, "일관성", "일관성");
  hit('export const x = "당신은 꼼꼼한 사람이에요";', claim, "당신은", "당신은");
  hit('export const x = "숨은 성향을 찾았어요";', claim, "숨은", "숨은 성향");
  hit('export const x = "숨은 마음이 있어요";', claim, "숨은", "숨은 마음");
  hit('export const x = <p>숨은 이유가 있어요</p>;', claim, "숨은", "JSX 글자의 숨은 이유");
  // 맨 「숨은」과 이 낱말들의 비슷한 말은 잡지 않는다. 문항 은행 글에서는 이 낱말들을 막지 않는다(자연스러운 말이다).
  assert.deepEqual(recs('export const x = "숨은 트이는 순간이에요";').flatMap(claim), [], "맨 숨은 을 잡았다");
  assert.deepEqual(recs('export const x = "숨은 곳을 찾아봐요";').flatMap(claim), [], "숨은 곳 을 잡았다");
  assert.deepEqual(recs('export const x = "마음은 쌓여도 일부터 덜고 싶어요";').flatMap(claim), [], "마음 을 잡았다");
  for (const word of ["속마음은 쌓여요", "무의식적으로 웃었어요", "본모습을 보여 줘서 놀랐어요", "말이 모순 같아 보였어요", "숨은 성향이 궁금했어요", "당신은 어디서 왔나요"]) {
    assert.deepEqual(recs(`export const x = "${word}";`).flatMap((r) => claimHits(r, "bank")), [], `문항 은행 글에서 ${word} 를 잡았다`);
  }
  assert.deepEqual(recs('export const x = "새로 만든 질문이에요. 검증을 마친 심리검사가 아니고, 바뀔 수 있어요.";').flatMap(claim), [], "허용된 고지 문장을 잡았다");
  assert.ok(recs('export const c = "w-[46%] flex";').flatMap(claim).length === 0, "클래스 이름의 % 를 잡았다");
  hit('export const x = <p>50%</p>;', claim, "백분율", "JSX 글자의 %");
  hit('export const x = "validated";', claim, "영어 주장", "글자 이름 자리의 영어 validated");
  assert.deepEqual(recs('export const cls = "score-card flex";').flatMap(claim), [], "클래스 이름의 score 를 잡았다");
  hit('export const x = <p>Accurate result</p>;', claim, "영어 주장", "영어 accurate");
  hit('export const x = <p aria-label="Your score">x</p>;', claim, "영어 주장", "영어 score");
  hit('export const x = "결과 validated 표시";', claim, "영어 주장", "한국어에 섞인 영어 validated");
  assert.deepEqual(recs('export const x = "Verify: 조건을 맞춰 봐요"; export const y = "upgrade";').flatMap(claim), [], "정상 영어 낱말을 잡았다");

  hit('export const x = "글자 B 는 둘 다예요";', letterHits, "B", "상태 글자 B");
  hit('export const x = "B";', letterHits, "B", "글자 하나짜리 B");
  hit('export const x = "「?」 는 모르는 자리예요";', letterHits, "?", "상태 글자 ?");
  hit('export const x = "링크의 a 와 b 를 봐요";', letterHits, "소문자", "소문자 글자");
  assert.deepEqual(recs('export const x = "V 조건 먼저와 S 장면 먼저예요";').flatMap(letterHits), [], "여덟 글자를 잡았다");
  assert.deepEqual(recs('export const x = "무엇을 먼저 붙잡나요? 총액인가요?";').flatMap(letterHits), [], "문장 끝 물음표를 잡았다");

  const em = cp(0x2014);
  const en = cp(0x2013);
  hit(`export const x = "돈${em}남을 장면";`, styleHits, "줄표", "긴 줄표");
  hit(`export const x = "돈${en}남을 장면";`, styleHits, "줄표", "짧은 줄표");
  hit('export const x = "돈 - 남을 장면";', styleHits, "붙임표", "띄어 쓴 붙임표");
  hit('export const x = "반반인 답";', styleHits, "~인 답", "~인 답");
  assert.deepEqual(recs('export const x = "반반인 답이에요";').flatMap(styleHits), [], "「인 답이에요」는 명사형 끝맺음이 아니다(기존 은행 검사와 같은 기준)");
  assert.deepEqual(recs('export const c = "-mt-2 -translate-x-1";').flatMap(styleHits), [], "클래스 이름의 음수 표기를 잡았다");

  const ui = { components: true, bank: false };
  hit('export const x = <span>A</span>;', (r) => labelHits(r, ui), "글자 하나", "JSX 글자 A");
  hit('export const x = <span>{"B"}</span>;', (r) => labelHits(r, ui), "글자 하나", "JSX 식 안의 B");
  hit('export const x = <button aria-label="가">a</button>;', (r) => labelHits(r, ui), "글자 하나", "가나다 라벨");
  hit('export const x = <li>1. 예산</li>;', (r) => labelHits(r, ui), "앞에 붙은", "번호 붙은 글");
  hit('export const x = <span>2</span>;', (r) => labelHits(r, ui), "보이는", "보이는 숫자");
  hit('export const f = (n: number) => `${n}. 예산`;', (r) => labelHits(r, ui), "번호를 붙이는 템플릿", "번호 템플릿");
  hit('export const x = "카드 A 를 골라요";', (r) => labelHits(r, ui), "알파벳 라벨", "카드 A");
  const numbering = analyzeText("export const x = <p>{index}. 제목</p>;", "n.tsx");
  assert.ok(jsxNumberingHits(numbering).length === 1, "JSX 번호 매기기를 못 잡았다");
  assert.deepEqual(recs('export const x = <span className="flex">6칸을 놓아요</span>;').flatMap((r) => labelHits(r, ui)), [], "정상 글을 잡았다");
  assert.equal(captionHits({ text: "1. 첫 주말" }).length, 1, "번호 붙은 제목을 못 잡았다");
  assert.equal(captionHits({ text: "가. 첫 주말" }).length, 1, "가나다 붙은 제목을 못 잡았다");
  assert.equal(captionHits({ text: "Q1 첫 주말" }).length, 1, "Q1 붙은 제목을 못 잡았다");
  assert.equal(captionHits({ text: "첫 주말의 대화" }).length, 0, "정상 제목을 잡았다");
});

test("검사기가 실제로 잡는다: 가져오기, 네트워크, 저장소, 통계", () => {
  const fake = { abs: join(PATHS.lib, "sample.ts") };
  const importsOf = (source) => importHits(analyzeText(source, fake.abs), [...V31_MODULES.map((re) => ["v3.1 모듈", re]), ...OLDER_MODULES.map((re) => ["옛 판 모듈", re])]);
  assert.equal(importsOf('import { A } from "@/constants/weddingCodeV31";').length, 1, "별칭 경로의 v3.1 상수를 못 잡았다");
  assert.equal(importsOf('import { A } from "../v31";').length, 1, "상대 경로의 v3.1 모듈을 못 잡았다");
  assert.equal(importsOf('import { A } from "@/app/wedding-code/WeddingCodeV31Results";').length, 1, "v3.1 화면을 못 잡았다");
  assert.equal(importsOf('export * from "@/lib/weddingCode/v31Flow";').length, 1, "export from 을 못 잡았다");
  assert.equal(importsOf('const m = await import("@/lib/weddingCode/v31StyleSummary");').length, 1, "동적 가져오기를 못 잡았다");
  assert.equal(importsOf('import { A } from "@/lib/weddingCode/v30";').length, 1, "옛 판 모듈을 못 잡았다");
  assert.equal(importsOf('import x from "@/constants/weddingCodeV40";').length, 0, "v4 상수를 잡았다");
  assert.equal(importsOf('import x from "./types";').length, 0, "형제 파일을 잡았다");
  assert.equal(importsOf("const m = await import(path);").length, 1, "경로를 알 수 없는 동적 가져오기를 못 잡았다");
  const reverse = importHits(analyzeText('import { a } from "@/lib/weddingCode/v40/score";', join(WEB_SRC, "lib/weddingCode/v31Flow.ts")), V40_MODULES.map((re) => ["v4 모듈", re]));
  assert.equal(reverse.length, 1, "v3.1 이 v4 를 가져오는 것을 못 잡았다");

  const api = (source, group = "lib", base = "sample.ts") => apiHits(analyzeText(source, join(PATHS.lib, base)), { group, base, abs: join(PATHS.lib, base) }).map((h) => h.api);
  assert.ok(api('fetch("/api/x");').includes("network"), "fetch 를 못 잡았다");
  assert.ok(api('window.fetch("/api/x");').includes("network"), "window.fetch 를 못 잡았다");
  assert.ok(api("const r = new XMLHttpRequest();").includes("network"), "XMLHttpRequest 를 못 잡았다");
  assert.ok(api('navigator.sendBeacon("/x", "y");').includes("network"), "sendBeacon 을 못 잡았다");
  assert.ok(api("new Image().src = u;").includes("network"), "new Image 를 못 잡았다");
  assert.ok(api('import axios from "axios";').includes("network"), "axios 를 못 잡았다");
  assert.ok(api('import { createClient } from "@/lib/supabase/client";').includes("network"), "supabase 를 못 잡았다");
  assert.ok(api("document.cookie = 'a=b';").includes("cookie"), "document.cookie 를 못 잡았다");
  assert.ok(api("console.log(1);").includes("console"), "console 을 못 잡았다");
  assert.ok(api("localStorage.setItem('a', 'b');").includes("storage"), "localStorage 를 못 잡았다");
  assert.ok(api("window.sessionStorage.clear();").includes("storage"), "window.sessionStorage 를 못 잡았다");
  assert.ok(api("const { fetch: f } = window;").includes("network"), "구조 분해로 꺼낸 fetch 를 못 잡았다");
  assert.ok(api("navigator.share({ title: 'x' });").includes("share"), "허용되지 않은 자리의 navigator.share 를 못 잡았다");
  assert.ok(!api("navigator.share({ title: 'x' });", "components", "ShareBlock.tsx").includes("share"), "보내기 컴포넌트의 navigator.share 를 막았다");
  assert.deepEqual(api("const x = obj.fetch; const fetchAll = 1; type T = XMLHttpRequest;"), [], "속성 이름, 긴 이름, 타입 이름을 잡았다");

  const urls = (source) => externalUrlHits(analyzeText(source, join(PATHS.components, "Sample.tsx"))).length;
  assert.equal(urls('export const a = <img src="https://cdn.example.com/a.png" alt="" />;'), 1, "외부 이미지 주소를 못 잡았다");
  assert.equal(urls('export const a = "//tracker.example.com/p";'), 1, "프로토콜 없는 외부 주소를 못 잡았다");
  assert.equal(urls('export const a = "/privacy"; export const b = "/wedding-code/taste"; export const c = "웹 https://x 안내";'), 0, "내부 링크나 문장 속 글을 잡았다");

  // 저장소: 이름을 부르는 곳은 storage.ts 한 곳이고, 클라이언트는 받은 핸들을 storage.ts 의 함수에 넘기기만 한다.
  const clientApi = (source) => apiHits(analyzeText(source, join(PATHS.app, "WeddingCodeV40Client.tsx")), { group: "app", base: "WeddingCodeV40Client.tsx", abs: join(PATHS.app, "WeddingCodeV40Client.tsx") }).filter((h) => h.api === "storage").length;
  const bypass = (source) => storageBypassHits(analyzeText(source, join(PATHS.app, "WeddingCodeV40Client.tsx"))).length;
  assert.equal(clientApi("const s = window.localStorage;"), 1, "클라이언트가 window.localStorage 를 부르는 것을 못 잡았다");
  assert.equal(clientApi("localStorage.setItem(V40_STORAGE.autosaveKey, 'off');"), 1, "클라이언트가 localStorage 로 자동 저장 키를 쓰는 것을 못 잡았다");
  assert.equal(clientApi("const ls = localStorage; ls.setItem('a', 'b');"), 1, "저장소를 별칭으로 옮기는 것을 못 잡았다");
  assert.equal(clientApi("sessionStorage.getItem('a');"), 1, "sessionStorage 를 못 잡았다");
  assert.equal(clientApi("const s = browserStorage(); readAutosavePreference(s);"), 0, "storage.ts 의 browserStorage() 로 받은 핸들을 잡았다");
  assert.ok(bypass("const s = browserStorage(); s.setItem(V40_STORAGE.autosaveKey, 'off');") >= 1, "받은 핸들에 자동 저장 키를 직접 쓰는 길(끄기의 지우기를 건너뛴다)을 못 잡았다");
  assert.ok(bypass("s.removeItem('x');") === 1 && bypass("s.getItem('x');") === 1 && bypass("storage.clear();") === 1, "저장소 메서드를 storage.ts 밖에서 부르는 것을 못 잡았다");
  assert.equal(bypass("const seen = new Set<string>(); seen.clear(); const m = new Map(); m.clear();"), 0, "Set, Map 의 clear 를 저장소 호출로 읽었다");
  assert.equal(bypass("const k = V40_STORAGE.progressKey;"), 1, "저장 키를 storage.ts 밖에서 읽는 것을 못 잡았다");
  assert.equal(bypass("const s = browserStorage(); const pref = readAutosavePreference(s); writeAutosavePreference(s, 'off'); const days = V40_STORAGE.ttlMs;"), 0, "storage.ts 의 함수를 부르거나 저장 기간을 읽는 것을 잡았다");
  assert.equal(bypass("const m = new Map(); m.set('a', 1); m.get('a');"), 0, "Map 의 set, get 을 잡았다");

  // 저장소 핸들 도우미: 이름은 export function realLocalStorage 한 함수 안에 한 번만.
  const handleProblems = (source) => storageHandleProblems(analyzeText(source, PATHS.storageHandle));
  const GOOD_HANDLE = "export function realLocalStorage() { if (typeof window === 'undefined') return null; try { return window.localStorage; } catch { return null; } }";
  assert.deepEqual(handleProblems(GOOD_HANDLE), [], "올바른 realLocalStorage 를 문제로 읽었다");
  assert.deepEqual(handleProblems(`${GOOD_HANDLE}\nexport function readX(s) { return s.getItem('k'); }`), [], "저장소 이름이 없는 다른 함수를 문제로 읽었다");
  assert.equal(handleProblems("export function readX() { return 1; }").length, 1, "realLocalStorage 가 없는 도우미 파일을 못 잡았다");
  assert.equal(handleProblems("function realLocalStorage() { return window.localStorage; }").length, 1, "export 가 없는 realLocalStorage 를 못 잡았다");
  assert.equal(handleProblems(`${GOOD_HANDLE}\nexport function other() { return window.sessionStorage; }`).length, 1, "realLocalStorage 밖의 저장소 이름을 못 잡았다");
  assert.equal(handleProblems(`${GOOD_HANDLE}\nconst top = window.localStorage;`).length, 1, "모듈 최상위의 저장소 이름을 못 잡았다");
  assert.equal(handleProblems("export function realLocalStorage() { return window.localStorage ?? window.sessionStorage; }").length, 1, "한 함수 안에서 저장소를 둘 부르는 것을 못 잡았다");
  assert.equal(handleProblems("export function realLocalStorage() { return null; }").length, 1, "저장소 이름이 없는 realLocalStorage 를 못 잡았다");
  // storage.ts(v4): 이름이 하나도 없고 browserStorage() 가 realLocalStorage() 를 부른다.
  const delegationProblems = (source) => storageDelegationProblems(analyzeText(source, PATHS.storage));
  const GOOD_DELEGATE = "import { realLocalStorage } from '../browserStorageHandle'; export function browserStorage() { return realLocalStorage(); }";
  assert.deepEqual(delegationProblems(GOOD_DELEGATE), [], "올바르게 도우미에 맡기는 browserStorage 를 문제로 읽었다");
  assert.deepEqual(delegationProblems(`${GOOD_DELEGATE}\nexport function readX(s) { return s.getItem('k'); }`), [], "저장소 이름이 없는 다른 함수를 문제로 읽었다");
  assert.equal(delegationProblems("export function readX() { return 1; }").length, 1, "browserStorage 가 없는 storage.ts 를 못 잡았다");
  assert.equal(delegationProblems("function browserStorage() { return realLocalStorage(); }").length, 1, "export 가 없는 browserStorage 를 못 잡았다");
  assert.ok(delegationProblems("export function browserStorage() { return window.localStorage; }").length >= 1, "도우미를 거치지 않고 localStorage 를 바로 부르는 browserStorage 를 못 잡았다");
  assert.equal(delegationProblems(`${GOOD_DELEGATE}\nexport function other() { return window.sessionStorage; }`).length, 1, "storage.ts 안의 저장소 이름을 못 잡았다");
  assert.equal(delegationProblems("export function browserStorage() { return null; }").length, 1, "도우미를 부르지 않는 browserStorage 를 못 잡았다");

  // 답이 서버로 가는 길: 쿼리, 계산된 이동 주소, searchParams 쓰기
  const qk = (source) => recs(source).flatMap((r) => queryKeyHits(r)).length;
  assert.equal(qk("export const u = `/wedding-code?letters=${letters}`;"), 1, "쿼리에 글자를 싣는 템플릿을 못 잡았다");
  assert.equal(qk("export const u = `/wedding-code?v=${VERSION}`;"), 0, "허용된 ?v= 를 잡았다");
  assert.equal(qk("export const u = `${base}?${V40_LINK_KEYS.version}=${WEDDING_CODE_V40_VERSION}`;"), 0, "상수 키(V40_LINK_KEYS.version)로 만든 ?v= 를 잡았다");
  assert.equal(qk("export const u = `${base}?${someKey}=${WEDDING_CODE_V40_VERSION}`;"), 1, "키 자리가 상수 키가 아닌 식인 쿼리를 못 잡았다");
  assert.equal(qk("export const u = `${base}?${V40_LINK_KEYS.first}=${a}`;"), 1, "첫 번째 답 키(a)를 쿼리에 싣는 것을 못 잡았다");
  assert.equal(qk('export const u = "/wedding-code?v=v4.0-tendency&pilot=x";'), 1, "쿼리의 허용 밖 키(pilot)를 못 잡았다");
  assert.equal(qk("export const u = `/wedding-code?${qs}`;"), 1, "쿼리 전체가 계산된 값인 템플릿을 못 잡았다");
  assert.equal(qk('export const u = "/api/x?a=" + code;'), 1, "쿼리에 답 코드를 잇는 문자열을 못 잡았다");
  assert.equal(qk("export const u = `${origin}/wedding-code#v=${VERSION}&a=${a}`;"), 0, "# 뒤 링크를 쿼리로 읽었다");
  assert.equal(qk('export const u = "무엇을 먼저 붙잡나요? 총액인가요?";'), 0, "문장 끝 물음표를 쿼리로 읽었다");
  const nav = (source) => navigationHits(analyzeText(source, join(PATHS.components, "Sample.tsx"))).length;
  assert.equal(nav("router.push(`/wedding-code?x=${a}`);"), 1, "계산된 주소로 router.push 하는 것을 못 잡았다");
  assert.equal(nav('router.push("/privacy");'), 0, "글자 그대로의 주소로 가는 것을 잡았다");
  assert.equal(nav("window.location.assign(url);"), 1, "location.assign 을 못 잡았다");
  assert.equal(nav("window.location.href = target;"), 1, "location.href 에 계산된 주소를 쓰는 것을 못 잡았다");
  assert.equal(nav("url.search = params.toString();"), 1, "search 에 쓰는 것을 못 잡았다");
  assert.equal(nav("window.open(link, '_blank');"), 1, "window.open 계산 주소를 못 잡았다");
  assert.equal(nav("redirect(`/x/${id}`);"), 1, "redirect 계산 주소를 못 잡았다");
  assert.equal(nav("url.searchParams.set('letters', letters);"), 1, "searchParams 로 글자를 싣는 것을 못 잡았다");
  assert.equal(nav("url.searchParams.set('v', 'v4.0-tendency');"), 0, "허용된 v 키를 잡았다");
  assert.equal(nav("history.replaceState(null, '', window.location.pathname);"), 0, "replaceState 로 # 뒤를 지우는 것을 잡았다");
  const sp = (source) => urlSearchParamKeyHits(analyzeText(source, join(PATHS.components, "Sample.tsx"))).length;
  assert.equal(sp("const p = new URLSearchParams(hash); p.get('a'); p.get('v');"), 0, "허용된 해시 키를 잡았다");
  assert.equal(sp("const p = new URLSearchParams(hash); p.get('letters');"), 1, "해시 키 letters 를 못 잡았다(코덱 밖 파일)");
  assert.equal(sp("const p = new URLSearchParams({ letters, a });"), 1, "URLSearchParams 객체의 허용 밖 키를 못 잡았다");

  const allow = { events: new Set(["wedding_code_started", "wedding_code_restarted"]), properties: new Set(["version", "scene_total", "placement"]), shortValue: /^[a-z0-9][a-z0-9._-]{0,15}$/u };
  const head = 'import { captureEvent, captureWeddingCodeEvent } from "@/lib/analytics";\n';
  const stats = (body) => analyticsHits(analyzeText(head + body, join(PATHS.lib, "sample.ts")), allow).length;
  assert.equal(stats('captureWeddingCodeEvent("wedding_code_started", { version: "v4.0-tendency", scene_total: 42 });'), 0, "고지된 호출을 잡았다");
  assert.equal(stats('captureEvent("wedding_code_answered", { version: "v4.0-tendency" });'), 1, "고지하지 않은 이벤트를 못 잡았다");
  assert.equal(stats('captureWeddingCodeEvent("wedding_code_started", { answers: "abc" });'), 1, "고지하지 않은 속성을 못 잡았다");
  assert.equal(stats('captureWeddingCodeEvent("wedding_code_started", { placement: "A1B2C3D4E5F6G7H8I9" });'), 1, "긴 값을 못 잡았다");
  assert.equal(stats('captureWeddingCodeEvent("wedding_code_started", { version: "v4.0" });'), 1, "틀린 version 값을 못 잡았다");
  assert.equal(stats("captureEvent(name);"), 1, "이름을 알 수 없는 호출을 못 잡았다");
  assert.equal(stats('captureEvent("wedding_code_started", { ...rest });'), 1, "알 수 없는 펼침을 못 잡았다");
  assert.equal(stats('const send = captureEvent; send("wedding_code_started");'), 1, "함수를 값으로 넘기는 것을 못 잡았다");
  assert.equal(stats('const NAME = "wedding_code_restarted"; captureEvent(NAME, { version: "v4.0-tendency" });'), 0, "상수 이벤트 이름을 잡았다");
  assert.equal(stats('function go(ev: string, p: Record<string, string>) { captureEvent(ev, p); } go("wedding_code_started", { version: "v4.0-tendency" });'), 0, "감싼 함수의 정상 호출을 잡았다");
  assert.equal(stats('function go(ev: string, p: Record<string, string>) { captureEvent(ev, p); } go("nope", { answers: "x" });'), 2, "감싼 함수의 나쁜 호출을 못 잡았다");
  assert.equal(
    stats('function Screen() { const track = useCallback((ev: string, p: Record<string, string>) => { captureEvent(ev, p); }, []); track("wedding_code_started", { placement: "intro" }); }'),
    0,
    "useCallback 으로 감싼 정상 호출을 잡았다",
  );
  assert.equal(
    stats('function Screen() { const track = useCallback((ev: string, p: Record<string, string>) => { captureEvent(ev, p); }, []); track("wedding_code_started", { answers: "x" }); }'),
    1,
    "useCallback 으로 감싼 나쁜 속성을 못 잡았다",
  );
  assert.equal(stats('function Screen() { const name = "wedding_code_restarted"; captureEvent(name, { version: VERSION }); }'), 0, "컴포넌트 안 지역 const 이벤트 이름을 잡았다");
  assert.equal(stats("function Screen({ ev }: { ev: string }) { captureEvent(ev); }"), 1, "구조 분해된 매개변수 이름을 못 잡았다");
  assert.equal(stats("function track(ev: WeddingCodeFunnelEvent) { captureWeddingCodeEvent(ev); }"), 0, "고지한 이벤트 타입으로 묶인 매개변수를 잡았다");
  assert.equal(stats('captureWeddingCodeEvent(cond ? "wedding_code_started" : "wedding_code_zzz");'), 1, "조건식 안의 미고지 이벤트를 못 잡았다");
  assert.equal(stats('captureWeddingCodeEvent("wedding_code_started", { version: VERSION, scene_total });'), 0, "약식 속성과 식 값을 잡았다");
  assert.equal(analyticsHits(analyzeText('import { capturePageview } from "@/lib/analytics";', join(PATHS.lib, "sample.ts")), allow).length, 1, "다른 analytics 함수를 못 잡았다");
  assert.ok(analyticsHits(analyzeText('posthog.capture("x");', join(PATHS.lib, "sample.ts")), allow).length >= 1, "posthog.capture 를 못 잡았다");

  // 우회로: 통계 함수를 다른 길로 가져오거나 오류 수집 SDK 로 글자를 실어 보내는 모양이 조용히 지나가지 않는다.
  const bypassStats = (source) => analyticsHits(analyzeText(source, join(PATHS.components, "Sample.tsx")), allow).length;
  assert.ok(bypassStats('import { track } from "@/lib/analytics/track"; track("wedding_code_letters", { letters });') >= 1, "analytics 하위 모듈 track 을 못 잡았다");
  assert.ok(bypassStats('import { captureEvent } from "@/lib/analytics.ts"; captureEvent("wedding_code_letters", { letters });') >= 1, "확장자를 붙여 가져온 analytics 를 못 잡았다");
  assert.ok(bypassStats('import { captureEvent } from "@/lib/analytics/index"; captureEvent("wedding_code_letters", { letters });') >= 1, "/index 를 붙여 가져온 analytics 를 못 잡았다");
  assert.ok(bypassStats('import { captureEvent } from "@/lib/wcBarrel"; captureEvent("wedding_code_started");') >= 1, "재수출 통에서 가져온 captureEvent 를 못 잡았다");
  assert.ok(bypassStats('export { captureEvent } from "@/lib/analytics";') >= 1, "analytics 를 다시 내보내는 것을 못 잡았다");
  assert.ok(bypassStats('const m = await import("@/lib/analytics"); m.captureEvent("wedding_code_letters");') >= 1, "analytics 를 동적으로 가져오는 것을 못 잡았다");
  assert.ok(bypassStats('import * as Sentry from "@sentry/nextjs"; Sentry.captureMessage(letters);') >= 1, "Sentry.captureMessage 로 글자를 싣는 것을 못 잡았다");
  assert.ok(bypassStats("window.Sentry.captureException(new Error(letters));") >= 1, "window.Sentry 를 못 잡았다");
  assert.ok(bypassStats("Sentry.addBreadcrumb({ message: letters });") >= 1, "전역 Sentry 를 못 잡았다");
  assert.ok(bypassStats('import * as a from "@/lib/analytics"; a.track("x");') >= 1, "analytics 네임스페이스의 두 함수 밖 멤버를 못 잡았다");
  assert.ok(bypassStats('gtag("event", "x");') >= 1, "gtag 를 못 잡았다");
  assert.ok(bypassStats("window.posthog.identify(id);") >= 1, "window.posthog 를 못 잡았다");
  assert.ok(apiHits(analyzeText('import * as Sentry from "@sentry/nextjs";', join(PATHS.lib, "sample.ts")), { group: "lib", base: "sample.ts" }).some((h) => h.api === "network"), "@sentry 패키지를 못 잡았다");
  assert.ok(apiHits(analyzeText('import posthog from "posthog-js";', join(PATHS.lib, "sample.ts")), { group: "lib", base: "sample.ts" }).some((h) => h.api === "network"), "posthog-js 를 못 잡았다");
  assert.ok(apiHits(analyzeText('import { init } from "@/lib/sentryClient";', join(PATHS.lib, "sample.ts")), { group: "lib", base: "sample.ts" }).some((h) => h.api === "network"), "자체 sentry 모듈 경로를 못 잡았다");
  assert.equal(bypassStats('import { captureWeddingCodeEvent } from "@/lib/analytics"; captureWeddingCodeEvent("wedding_code_started", { version: "v4.0-tendency" });'), 0, "고지된 정상 호출을 잡았다");
  assert.equal(bypassStats('import type { WeddingCodeFunnelEvent } from "@/lib/analyticsPrivacy"; export const ev: WeddingCodeFunnelEvent = "wedding_code_started";'), 0, "analyticsPrivacy 의 타입 가져오기를 잡았다");
});

test("검사기가 실제로 잡는다: 화면으로 가는 오류 호출 안의 낱말과 개발자용 메시지의 구분", () => {
  const found = (source) => recs(source, "sample.tsx").filter((r) => !r.dev).flatMap((r) => claimHits(r, "text"));
  // 이름이 Error 로 끝나는 함수 호출은 화면에 글을 내보내는 자리다. 예전에는 이 안의 낱말이 모든 문자열 규칙을 피해 갔다.
  assert.ok(found('export const f = () => { setError("이번 결과는 점수가 낮아요"); };').includes("점수"), "setError 안의 점수를 못 잡았다");
  assert.ok(found('export const f = () => { showError("정확한 결과가 아니에요"); };').includes("정확"), "showError 안의 정확을 못 잡았다");
  assert.ok(found('export const f = () => { reportError("궁합이 안 맞아요"); };').includes("궁합"), "reportError 안의 궁합을 못 잡았다");
  assert.ok(found('export const f = () => { setNotice(new ValidationError("점수가 낮아요")); };').includes("점수"), "화면으로 넘기는 오류 객체 안의 점수를 못 잡았다");
  assert.ok(found('export const f = () => { const e = new Error("점수가 낮아요"); return e; };').includes("점수"), "throw 가 아닌 곳의 Error 메시지를 개발자 메시지로 읽었다");
  // 던지는 오류와 node:assert 는 개발자에게만 보인다.
  assert.deepEqual(found('export const f = () => { throw new Error("점수 계산이 어긋났다"); };'), [], "던지는 오류 메시지를 화면 글로 읽었다");
  assert.deepEqual(found('import assert from "node:assert"; export const f = (x: number) => { assert.ok(x > 0, "점수 계산이 어긋났다"); };'), [], "node:assert 메시지를 화면 글로 읽었다");
  assert.ok(found('export const f = (x: number) => { assert(x > 0, "점수 계산이 어긋났다"); };').includes("점수"), "node:assert 에서 가져오지 않은 assert 를 개발자 메시지로 읽었다");
});

test("검사기가 실제로 잡는다: 계산한 번호와 라벨", () => {
  const num = (source) => numberingHits(analyzeText(source, join(PATHS.components, "Sample.tsx"))).map((h) => h.what);
  const flagged = (source, needle) => num(source).some((w) => w.includes(needle));
  assert.ok(flagged("export const x = <p>{i + 1}</p>;", "식 + 숫자"), "{i + 1} 을 못 잡았다");
  assert.ok(flagged("export const x = <p>{1 + index}</p>;", "식 + 숫자"), "{1 + index} 를 못 잡았다");
  assert.ok(flagged("export const x = <p>{index}</p>;", "인덱스"), "{index} 를 못 잡았다");
  assert.ok(flagged("export const x = <p>{screenIndex}</p>;", "인덱스"), "{screenIndex} 를 못 잡았다");
  assert.ok(flagged("export const x = <p>{state.cursor}</p>;", "인덱스"), "{state.cursor} 를 못 잡았다");
  assert.ok(flagged("export const x = <p>{i}/{n}</p>;", "n/N"), "{i}/{n} 을 못 잡았다");
  assert.ok(flagged("export const x = <p>{i} / {n}</p>;", "n/N"), "{i} / {n} 을 못 잡았다");
  assert.ok(flagged("export const x = <p>{i}번째 질문</p>;", "번째"), "{i}번째 를 못 잡았다");
  assert.ok(flagged("export const f = (i: number) => `${i}번째 질문`;", "값 + 번째"), "${i}번째 질문 템플릿을 못 잡았다");
  assert.ok(flagged("export const f = (i: number, n: number) => `${i}/${n} 진행`;", "n/N"), "${i}/${n} 템플릿을 못 잡았다");
  assert.ok(flagged("export const f = (i: number) => `질문 ${i}`;", "질문/카드"), "질문 ${i} 템플릿을 못 잡았다");
  assert.ok(flagged("export const f = (i: number) => String.fromCharCode(65 + i);", "글자를 만든다"), "fromCharCode 를 못 잡았다");
  assert.ok(flagged("export const f = (i: number) => String.fromCodePoint(0x41 + i);", "글자를 만든다"), "fromCodePoint 를 못 잡았다");
  assert.ok(flagged('export const f = (i: number) => "ABCD"[i];', "색인"), '"ABCD"[i] 를 못 잡았다');
  assert.ok(flagged('const LABELS = "가나다라"; export const f = (i: number) => LABELS[i];', "색인"), "가나다 표 색인을 못 잡았다");
  assert.ok(flagged('const L = ["A", "B", "C"]; export const f = (i: number) => L[i];', "색인"), "글자 배열 색인을 못 잡았다");
  assert.ok(flagged('export const f = () => [..."ABCDEF"];', "알파벳"), "알파벳 순서 문자열을 못 잡았다");
  assert.ok(flagged("export const x = <ol><li>a</li></ol>;", "<ol>"), "<ol> 을 못 잡았다");
  assert.ok(flagged('export const x = <ul className="list-decimal pl-4"><li>a</li></ul>;', "목록 번호"), "list-decimal 을 못 잡았다");
  assert.ok(flagged('export const x = <ul className="mt-2 list-[upper-roman]"><li>a</li></ul>;', "목록 번호"), "list-[upper-roman] 을 못 잡았다");
  assert.ok(flagged('export const x = <ul className="[counter-reset:q]"><li>a</li></ul>;', "목록 번호"), "counter-reset 을 못 잡았다");
  assert.ok(flagged('export const s = { listStyleType: "decimal" };', "목록 번호"), "listStyleType decimal 을 못 잡았다");
  // 정상: 세는 값, key 속성, 개수 문장, 목록 표시 없는 ul
  assert.deepEqual(num("export const x = <span key={index} className=\"list-none\">{count}칸</span>;"), [], "정상 JSX 를 잡았다");
  assert.deepEqual(num("export const x = <p>질문은 모두 {n}개예요</p>;"), [], "{n}개 처럼 세는 낱말이 붙은 개수를 번호로 읽었다");
  assert.ok(flagged("export const x = <p>{n} 질문</p>;", "인덱스"), "세는 낱말이 없는 {n} 을 못 잡았다");
  assert.deepEqual(num("export const f = (total: number) => `질문은 모두 ${total}개예요`;"), [], "개수 문장 템플릿을 잡았다");
  assert.deepEqual(num("export const f = (total: number) => `질문 ${total}개`;"), [], "「질문 N개」 세는 말을 잡았다");
  assert.deepEqual(num("export const f = (origin: string, path: string) => `${origin}/${path}`;"), [], "주소 템플릿의 값/값 을 잡았다");
  assert.deepEqual(num("export const x = <ul className=\"list-none\"><li>a</li></ul>;"), [], "list-none 을 잡았다");
});

test("검사기가 실제로 잡는다: v4 링크를 여는 파일과 Sentry 정제 표시", () => {
  const entry = (source) => linkOpenerImports(analyzeText(source, join(PATHS.app, "WeddingCodeEntryClient.tsx"))).length;
  assert.equal(entry('import dynamic from "next/dynamic"; const C = dynamic(() => import("./WeddingCodeV40Client"));'), 1, "v4 클라이언트를 동적으로 여는 입구를 못 잡았다");
  assert.equal(entry('import { WeddingCodeV40Client } from "./WeddingCodeV40Client";'), 1, "v4 클라이언트를 가져오는 입구를 못 잡았다");
  assert.equal(entry('import { decodeCode } from "@/lib/weddingCode/v40/codec";'), 1, "v4 코덱을 가져오는 입구를 못 잡았다");
  assert.equal(entry('import { decodeCode } from "@/lib/weddingCode/v40/codec.ts";'), 1, "확장자를 붙인 v4 코덱을 못 잡았다");
  assert.equal(entry('import { V40_COPY } from "@/lib/weddingCode/v40/copy";'), 0, "링크를 열지 않는 v4 문구 모듈을 잡았다");
  assert.equal(entry('import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";'), 0, "v4 상수를 잡았다");
  assert.equal(entry('import { A } from "./WeddingCodeV31Client";'), 0, "v3.1 클라이언트를 잡았다");

  assert.equal(scrubHandlesContexts("export interface ScrubbableEvent { contexts?: unknown; user?: unknown }"), false, "속성 선언만 있는 정제기를 contexts 를 다루는 것으로 읽었다");
  assert.equal(scrubHandlesContexts("export function clean(event) { event.user = undefined; event.request = undefined; return event; }"), false, "contexts 가 없는 정제기를 다루는 것으로 읽었다");
  assert.equal(scrubHandlesContexts("export function clean(event) { if (event.contexts !== undefined) event.contexts = strip(event.contexts); return event; }"), true, "contexts 를 다루는 정제기를 못 읽었다");
  assert.equal(sentryGateHits(["app/x.ts:1 ./WeddingCodeV40Client"], false).length, 1, "정제 없이 열리는 v4 입구를 못 잡았다");
  assert.equal(sentryGateHits(["app/x.ts:1 ./WeddingCodeV40Client"], true).length, 0, "정제가 있는데 입구를 잡았다");
  assert.equal(sentryGateHits([], false).length, 0, "입구가 없는데 잡았다");
});

test("검사기가 실제로 잡는다: 링크 키와 고지 문장", () => {
  assert.equal(hashKeyHits({ text: "/wedding-code#v=" + PLACEHOLDER + "&a=" + PLACEHOLDER }).length, 0, "정상 해시를 잡았다");
  assert.equal(hashKeyHits({ text: "/wedding-code#v=" + PLACEHOLDER + "&a=" + PLACEHOLDER + "&c=" + PLACEHOLDER }).length, 1, "넷째 해시 키를 못 잡았다");
  assert.equal(hashKeyHits({ text: "/wedding-code?pilot=x" }).length, 0, "쿼리를 잡았다");

  const sample = [
    'const NOTICE = "검증을 마친 심리검사가 아니에요";',
    "export const V40_COPY = {",
    "  intro: { notice: NOTICE },",
    '  question: { hint: "검증을 마친 심리검사가 아니에요" },',
    "  rest: { title: `${NOTICE} 한 번 더 ${NOTICE}` },",
    "} as const;",
    'export const V40_COPY_SCREENS = { intro: ["intro"], question: ["question"], rest: ["rest"] } as const;',
    'export function helper() { return "검증을 마친 심리검사가 아니에요"; }',
    'export function helper2() { return "검증을 마친 " + "심리검사가 아니에요"; }',
  ].join("\n");
  const report = noticeReport(analyzeText(sample, "copy-sample.ts"));
  assert.equal(report.groups.intro, 1, "상수를 거친 고지를 못 셌다");
  assert.equal(report.groups.question, 1, "질문 묶음의 고지를 못 셌다");
  assert.equal(report.groups.rest, 2, "한 묶음의 두 번 출현을 못 셌다");
  assert.equal(report.perScreen.rest, 2);
  assert.equal(report.stray.length, 2, "V40_COPY 밖 함수 안의 고지(쪼개 이은 것 포함)를 못 잡았다");
  const concatGroup = noticeReport(analyzeText([
    "export const V40_COPY = { intro: { notice: \"검증을 마친 \" + \"심리검사가 아니에요\" } } as const;",
    'export const V40_COPY_SCREENS = { intro: ["intro"] } as const;',
  ].join("\n"), "copy-concat.ts"));
  assert.equal(concatGroup.groups.intro, 1, "V40_COPY 안에서 쪼개 이은 고지를 못 셌다");
});

test("검사기가 실제로 잡는다: 은행 제목과 JSON 글", () => {
  const data = { version: VERSION_TAG, note: "정확 점수", items: [{ id: "a.b.1", caption: "1. 첫 주말", stem: "가장 정확한 답이에요", cards: [{ pole: "front", text: "A. 총액부터 그어요" }] }] };
  const strings = jsonStrings(data).map((s) => s.text);
  assert.ok(!strings.includes("정확 점수"), "note 를 문구로 읽었다");
  assert.ok(strings.includes("가장 정확한 답이에요") && strings.includes("A. 총액부터 그어요"), "문구를 잃었다");
  assert.equal(strings.filter((s) => claimHits({ text: s, visible: true, kind: "string" }, "bank").length > 0).length, 1, "JSON 글의 주장 낱말을 못 잡았다");
  assert.equal(labelHits({ text: "A. 총액부터 그어요", visible: true, kind: "string" }, { components: false, bank: true }).length, 1, "선택지 앞 라벨을 못 잡았다");
  assert.equal(bankCaptionsOfJson(data).flatMap(captionHits).length, 1, "JSON 제목의 번호를 못 잡았다");
  const bankTs = analyzeText('export const V40_BANK_DATA = { items: [{ caption: "1) 첫 주말", stem: "x" }] };', "weddingCodeV40Bank.ts");
  assert.equal(bankCaptionsOfTs(bankTs).flatMap(captionHits).length, 1, "생성된 은행 제목의 번호를 못 잡았다");
});

test("검사기가 실제로 잡는다: 구문 오류는 통과가 아니다", () => {
  const broken = analyzeText("export const x = ;\nconst y = {", "broken.ts");
  assert.ok(broken.syntaxErrors.length > 0, "구문 오류를 읽지 못했다 — 깨진 파일이 조용히 통과한다");
  assert.ok(analyzeText("export const x = 1;", "ok.ts").syntaxErrors.length === 0);
  assert.ok(has(recs("export const s = 'it\\'s';", "q.ts"), (r) => r.text === "it's"), "이스케이프된 따옴표를 잘못 읽었다");
});

// ---------------------------------------------------------------------------
// 검사기 자가 시험: 4.1 단계 2 규칙 (심은 위반을 잡고 깨끗한 표본을 잡지 않는다)
// ---------------------------------------------------------------------------

test("검사기가 실제로 잡는다: 짐작 해시 키 ga, gb 와 짐작 코덱이 링크를 여는 모듈이라는 것", () => {
  const hash = (text) => hashKeyHits({ text }).length;
  const P = PLACEHOLDER;
  assert.equal(hash(`/wedding-code#v=${P}&a=${P}&ga=${P}&b=${P}&gb=${P}`), 0, "정규 순서 v, a, ga, b, gb 의 정상 해시를 잡았다");
  assert.equal(hash(`/wedding-code#a=${P}&gc=${P}`), 1, "짐작 키 모양의 모르는 키 gc 를 못 잡았다");
  assert.equal(hash(`/wedding-code#a=${P}&g=${P}`), 1, "옛 설계의 한 글자 키 g 를 못 잡았다");
  assert.equal(hash(`/wedding-code#a=${P}&GA=${P}`), 1, "대문자 GA 를 못 잡았다");
  const params = (source) => urlSearchParamKeyHits(analyzeText(source, join(PATHS.components, "Sample.tsx"))).length;
  assert.equal(params("const p = new URLSearchParams(hash); p.get('ga'); p.get('gb'); p.get('a');"), 0, "허용된 짐작 키 읽기를 잡았다");
  assert.equal(params("const p = new URLSearchParams(hash); p.get('gc');"), 1, "허용 밖 키 gc 읽기를 못 잡았다");
  assert.equal(params("const p = new URLSearchParams({ v, a, ga, b, gb });"), 0, "허용된 키 다섯의 객체를 잡았다");
  assert.equal(params("const p = new URLSearchParams({ a, g });"), 1, "허용 밖 키 g 의 객체를 못 잡았다");
  // 쿼리에는 짐작 키도 싣지 않는다(서버가 본다).
  const query = (source) => recs(source).flatMap((r) => queryKeyHits(r)).length;
  assert.equal(query("export const u = `/wedding-code?ga=${g}`;"), 1, "쿼리에 짐작 키 ga 를 싣는 템플릿을 못 잡았다");
  assert.equal(query('export const u = "/wedding-code?v=x&gb=" + g;'), 1, "쿼리에 짐작 키 gb 를 잇는 문자열을 못 잡았다");
  assert.equal(query("export const u = `${origin}/wedding-code#v=${VERSION}&a=${a}&ga=${g}`;"), 0, "# 뒤의 짐작 키를 쿼리로 읽었다");

  // 짐작 코덱은 v4 링크를 여는 모듈이다(규칙 10).
  const opens = (source) => linkOpenerImports(analyzeText(source, join(PATHS.app, "entry.ts"))).length;
  assert.equal(opens('import { decodeGuessedShareParams } from "@/lib/weddingCode/v40/guess/guessLink";'), 1, "짐작 코덱을 가져오는 입구를 못 잡았다");
  assert.equal(opens('import { decodeGuessedShareParams } from "@/lib/weddingCode/v40/guess/guessLink.ts";'), 1, "확장자를 붙인 짐작 코덱을 못 잡았다");
  assert.equal(opens('import { x } from "../../lib/weddingCode/v40/guess/guessLink";'), 1, "상대 경로의 짐작 코덱을 못 잡았다");
  assert.equal(opens('import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";'), 0, "링크를 열지 않는 짐작 문구 모듈을 잡았다");
  assert.equal(opens('import type { GuessAnswers } from "@/lib/weddingCode/v40/guess/types";'), 0, "타입 모듈을 잡았다");
  assert.equal(sentryGateHits(["app/x.ts:1 @/lib/weddingCode/v40/guess/guessLink"], false).length, 1, "정제 없이 짐작 코덱을 여는 입구를 못 잡았다");
});

test("검사기가 실제로 잡는다: 저장소 이름은 realLocalStorage(localStorage) 한 함수 안에서만 부른다. 이 창의 임시 저장소(sessionStorage)는 이 단계에 없다", () => {
  const problems = (source) => storageHandleProblems(analyzeText(source, PATHS.storageHandle));
  const GOOD = "export function realLocalStorage() { try { return window.localStorage; } catch { return null; } }";
  assert.deepEqual(problems(GOOD), [], "지금의 realLocalStorage 하나뿐인 도우미 파일을 문제로 읽었다");
  assert.ok(problems(GOOD.replace("window.localStorage", "window.localStorage ?? window.sessionStorage")).length >= 1, "realLocalStorage 안에서 저장소 이름을 둘 부르는 것을 못 잡았다");
  assert.ok(problems(`${GOOD}
export function browserSessionStorage() { return window.sessionStorage; }`).length >= 1, "이 단계에 없는 임시 저장소 함수(browserSessionStorage)를 못 잡았다: 선택 2부를 더하는 후속 PR 이 이 규칙을 함께 고친다");
  assert.ok(problems(`${GOOD}
export const s = window.sessionStorage;`).length >= 1, "모듈 최상위의 sessionStorage 를 못 잡았다");
  assert.ok(problems(`${GOOD}
export function readX() { return window.localStorage; }`).length >= 1, "realLocalStorage 밖에서 부르는 localStorage 를 못 잡았다");
  // 글자 고르기 저장 키는 storage.ts 만 안다.
  const bypass = (source) => storageBypassHits(analyzeText(source, join(PATHS.components, "letterGuess", "Sample.tsx"))).length;
  assert.equal(bypass("const k = V40_STORAGE.letterGuessKey;"), 1, "글자 고르기 저장 키를 storage.ts 밖에서 읽는 것을 못 잡았다");
  assert.equal(bypass("port.write(raw); port.remove(); const r = port.read();"), 0, "저장 포트의 read, write, remove 를 저장소 메서드로 읽었다");
});

test("검사기가 실제로 잡는다: 규칙 11(통계 없음), 13(글자 고르기는 링크에 안 간다), 15(바렐 순환 금지)", () => {
  const at = (dir, source, name = "Sample.ts") => analyzeText(source, join(dir, name));

  // 규칙 11
  const stats = (source, dir = GUESS_LIB_DIR) => statsFreeHits(at(dir, source)).length;
  assert.ok(stats('import { captureWeddingCodeEvent } from "@/lib/analytics"; captureWeddingCodeEvent("wedding_code_started", { version: V });') >= 2, "고지된 이벤트여도 통계 가져오기와 호출을 못 잡았다(규칙 6 이 허용하는 호출이다)");
  assert.equal(stats('import { x } from "@/lib/analytics/track";'), 1, "analytics 하위 모듈 가져오기를 못 잡았다");
  assert.ok(stats('import { captureEvent } from "@/lib/analytics.ts";') >= 1, "확장자를 붙인 analytics 를 못 잡았다");
  assert.equal(stats("export const f = (client) => client.captureEvent('x');"), 1, "객체에 대고 부르는 captureEvent 를 못 잡았다");
  assert.equal(stats("export const f = () => captureWeddingCodeEvent('x');", PATHS.app), 1, "가져오지 않고 부르는 captureWeddingCodeEvent 를 못 잡았다");
  assert.equal(stats('import type { Axis } from "../types"; export const a = 1;'), 0, "통계와 무관한 가져오기를 잡았다");
  assert.equal(stats('import type { WeddingCodeFunnelEvent } from "@/lib/analyticsPrivacy";'), 0, "analyticsPrivacy 의 타입 가져오기를 잡았다(analytics 모듈이 아니다)");

  // 규칙 13
  const letter = (source, dir = LETTER_LIB_DIR) => letterGuessIsolationHits(at(dir, source)).length;
  assert.equal(letter('import { decodeCode } from "../codec";'), 1, "링크 코덱 가져오기를 못 잡았다");
  assert.equal(letter('import { decodeCode } from "@/lib/weddingCode/v40/codec";'), 1, "별칭 경로의 링크 코덱을 못 잡았다");
  assert.equal(letter('import { x } from "../guess/guessLink";'), 1, "짐작 폴더의 링크 코덱을 못 잡았다");
  assert.equal(letter('import { x } from "@/components/wedding-code/v40/guess";'), 1, "짐작 컴포넌트 폴더를 못 잡았다");
  assert.equal(letter('import { x } from "@/app/wedding-code/entry";'), 1, "입구를 못 잡았다");
  assert.equal(letter('const m = await import("../codec");'), 1, "동적 가져오기의 링크 코덱을 못 잡았다");
  assert.equal(letter('import type { Axis, Letter } from "../types"; import { V40_AXES } from "@/constants/weddingCodeV40"; import { x } from "../score";'), 0, "글자 고르기가 쓸 수 있는 가져오기를 잡았다");
  assert.equal(letter('import { x } from "../guessLike";'), 0, "이름이 guess 로 시작할 뿐인 다른 모듈을 잡았다");
  assert.equal(letter('import { x } from "../codecs";'), 0, "이름이 codec 으로 시작할 뿐인 다른 모듈을 잡았다");

  // 규칙 15
  const barrel = (source, dir = GUESS_COMPONENT_DIR) => barrelImportHits(at(dir, source, "Sample.tsx")).length;
  assert.equal(barrel('import { screenRootClass } from "@/components/wedding-code/v40";'), 1, "바렐 가져오기를 못 잡았다");
  assert.equal(barrel('import { x } from "@/components/wedding-code/v40/index";'), 1, "/index 를 붙인 바렐을 못 잡았다");
  assert.equal(barrel('import { x } from "..";'), 1, "상대 경로 .. 바렐을 못 잡았다");
  assert.equal(barrel('import { x } from "../index";'), 1, "상대 경로 ../index 바렐을 못 잡았다");
  assert.equal(barrel('import { x } from "../";'), 1, "끝에 /를 붙인 .. 바렐을 못 잡았다");
  assert.equal(barrel('import { x } from "..";', LETTER_LIB_DIR), 1, "lib 폴더에서 .. (lib/weddingCode/v40 의 index 자리)를 못 잡았다");
  assert.equal(barrel('import { useScreenFocus } from "../useScreenFocus"; import { SectionCard } from "../SectionCard"; import { x } from "../styles"; import { y } from "@/components/wedding-code/v40/styles";'), 0, "경로로 직접 가져오는 정상 가져오기를 잡았다");
  assert.equal(barrel('import { z } from "./GuessSetFlow"; import type { T } from "../../../lib/weddingCode/v40/types";'), 0, "형제 파일이나 lib 의 types 를 잡았다");
});

test("검사기가 실제로 잡는다: 규칙 14(자료), 17(오류 메시지), 단어 규칙", () => {
  const at = (source, name = "Sample.ts", dir = GUESS_LIB_DIR) => analyzeText(source, join(dir, name));

  // 규칙 14
  const data = (source, options) => stageDataHits(at(source), options).length;
  assert.equal(data('export const L = "링크 https://hanbang.ai/wedding-code#a=x&ga=y";'), 1, "문장 속 골든 링크를 못 잡았다(외부 주소 규칙은 글이 https 로 시작할 때만 본다)");
  assert.equal(data('export const L = "http://example.com";'), 1, "http 링크를 못 잡았다");
  assert.equal(data('export const B = "B";'), 1, "한 글자 대문자 값 B 를 못 잡았다");
  assert.equal(data('export const V = " V ";'), 1, "여덟 글자 중 하나여도 한 글자 값으로 적는 것을 못 잡았다");
  assert.equal(data('export const T = "V 조건 먼저"; export const k = "0148056W";'), 0, "정상 글과 코드 모양의 값을 잡았다");
  assert.equal(data('export const D = { title: "t", dev: { lookSide: "x" } };', { generated: true }), 2, "생성 상수의 개발 메모 키 dev, lookSide 를 못 잡았다");
  assert.equal(data('export const D = { rules: { a: 1 }, status: "x", whyItDiffers: "y" };', { generated: true }), 3, "rules, status, whyItDiffers 를 못 잡았다");
  assert.equal(data('export const D = { "dev": 1 };', { generated: true }), 1, "따옴표 친 키 dev 를 못 잡았다");
  assert.equal(data('export const D = { title: "t", cards: [{ act: "a", cost: "c" }], humanReviewed: false };', { generated: true }), 0, "허용 필드만 든 생성 상수를 잡았다");
  assert.equal(data("export type R = { readonly status: string }; export const D = { status: 1 };"), 0, "생성 상수가 아닌 파일의 status 키를 잡았다(타입 이름으로 쓸 수 있다)");

  // 규칙 17
  const err = (source) => errorMessageHits(at(source)).length;
  assert.equal(err("export const f = (code: string) => { throw new RangeError(`쓸 수 없는 문자 ${code}`); };"), 1, "템플릿 치환 메시지를 못 잡았다");
  assert.equal(err('export const f = (code: string) => { throw new Error("쓸 수 없는 문자 " + code); };'), 1, "이어 붙인 메시지를 못 잡았다");
  assert.equal(err("export const f = (code: string) => { throw new TypeError(code); };"), 1, "입력을 그대로 메시지로 쓰는 것을 못 잡았다");
  assert.equal(err("export const f = (code: string) => { throw Error(`bad ${code}`); };"), 1, "new 없이 부르는 Error 를 못 잡았다");
  assert.equal(err("export const f = (m: string) => new RangeError(m);"), 1, "던지지 않고 만들기만 하는 오류도 본다");
  assert.equal(err('export const f = () => { throw new RangeError("고정 메시지"); };'), 0, "고정 메시지를 잡았다");
  assert.equal(err('const MSG = "고정 메시지"; export const f = () => { throw new Error(MSG); };'), 0, "고정 문자열 상수를 잡았다");
  assert.equal(err('export const f = () => { throw new Error("앞 " + "뒤"); };'), 0, "리터럴만 이은 메시지를 잡았다");
  assert.equal(err('export const f = (e: unknown) => { throw new Error("고정", { cause: e }); };'), 0, "원인 객체를 넘기는 두 번째 인자를 잡았다");
  assert.equal(err("export const f = () => { throw new Error(); };"), 0, "메시지가 없는 오류를 잡았다");
  assert.equal(err("export const f = (x: unknown) => { if (x === undefined) return new Map(); return new Set(); };"), 0, "오류가 아닌 생성식을 잡았다");

  // 단어 규칙
  const scopeAll = { who: () => true, count: () => false };
  const scopeCopy = { who: () => true, count: () => true };
  const words = (text, scope = scopeAll) => stageWordHits({ text, visible: true, dev: false }, scope);
  for (const text of ["상대가 맞혔어요", "짐작을 맞힌 장면이에요", "틀렸어요", "정답이에요", "오답이에요", "적중했어요", "순위가 나와요", "득점이 있어요", "승패를 가려요", "몇 점이에요", "점수가 나와요", "일치가 퍼센트로 나와요", "백분율로 보여요", "절반은 50% 같아요"]) {
    assert.ok(words(text).length === 1, `누가 맞혔는지를 말하는 「${text}」를 못 잡았다`);
  }
  for (const text of ["일정을 맞춰 보세요", "서로 맞추게 되는 때가 있어요", "우선순위를 정해요", "고른 쪽을 나란히 놓았어요", "짐작한 쪽과 고른 쪽"]) {
    assert.deepEqual(words(text), [], `정상 문장 「${text}」를 잡았다`);
  }
  assert.deepEqual(words("몇 가지를 골라요"), [], "개수 말 검사 범위 밖인 글에서 개수 말을 잡았다");
  for (const text of ["몇 개를 골랐어요", "몇 가지예요", "여섯 가지 장면이에요", "세 개 중에서 골라요", "장면 6개", "3번 눌러요"]) {
    assert.ok(words(text, scopeCopy).length === 1, `개수 말이나 숫자 「${text}」를 못 잡았다`);
  }
  assert.deepEqual(stageWordHits({ text: "정답이에요", visible: true, dev: true }, scopeAll), [], "개발자용 메시지를 화면 글로 읽었다");
  assert.deepEqual(stageWordHits({ text: "key", visible: false, dev: false }, scopeAll), [], "한글이 없고 보이지도 않는 글을 잡았다");
  // 생성 상수에서는 V40_GUESS_TEXT 안의 글만 이 규칙을 받고, 장면 자료(V40_GUESS_SET)는 받지 않는다.
  const constantsSample = analyzeText('export const V40_GUESS_SET = [{ stem: "정답이 없는 일이에요", act: "몇 가지를 정해요" }];\nexport const V40_GUESS_TEXT = { tail: "상대가 맞혔어요", note: "여섯 가지예요" };', PATHS.guessConstants);
  const scope = wordScopeOf({ abs: PATHS.guessConstants, group: "constants", base: "weddingCodeV40Guess.ts" }, constantsSample);
  const flagged = constantsSample.strings.filter((rec) => stageWordHits(rec, scope).length > 0).map((rec) => rec.text);
  assert.deepEqual(flagged, ["상대가 맞혔어요", "여섯 가지예요"], "생성 상수의 화면 글 범위(V40_GUESS_TEXT)가 어긋났다");
  // 문구 파일은 개수 말 검사까지, 컴포넌트 파일은 낱말 검사만 받는다.
  const copyScope = wordScopeOf({ abs: join(GUESS_LIB_DIR, "guessCopy.ts"), group: "lib", base: "guessCopy.ts" }, constantsSample);
  assert.equal(copyScope.count({}), true, "문구 파일이 개수 말 검사를 받지 않는다");
  const componentScope = wordScopeOf({ abs: join(GUESS_COMPONENT_DIR, "GuessSetFlow.tsx"), group: "components", base: "GuessSetFlow.tsx" }, constantsSample);
  assert.equal(componentScope.who({}), true);
  assert.equal(componentScope.count({}), false, "컴포넌트 파일이 개수 말 검사를 받는다(숫자 속성이 글로 읽힐 수 있다)");
});

test("검사기가 실제로 잡는다: 규칙 16(클라이언트 통계 호출 자리)과 엔진 고정", () => {
  const report = (source) => clientEventReport(analyzeText(source, PATHS.client));
  const head = 'import { captureWeddingCodeEvent } from "@/lib/analytics";\n';
  const ten = Array.from({ length: 10 }, (_, i) => `captureWeddingCodeEvent("${FIXED_FUNNEL_EVENTS[i % FIXED_FUNNEL_EVENTS.length]}", { version: V });`).join("\n");
  const base = report(head + ten);
  assert.equal(base.count, 10, "호출 열 개를 열 개로 세지 못했다");
  assert.deepEqual(base.names, FIXED_FUNNEL_EVENTS, "여덟 이벤트 이름을 모으지 못했다");
  assert.deepEqual(base.problems, [], "정상 호출을 문제로 읽었다");
  assert.equal(report(`${head + ten}\ncaptureWeddingCodeEvent("wedding_code_started", { version: V });`).count, 11, "열한 번째 호출을 못 셌다");
  assert.ok(report(`${head + ten}\ncaptureWeddingCodeEvent("wedding_code_answered", { version: V });`).names.includes("wedding_code_answered"), "고지하지 않은 이벤트 이름을 모으지 못했다");
  assert.equal(report(`${head}captureEvent("wedding_code_started");`).otherCalls, 1, "captureEvent 직접 호출을 못 셌다");
  assert.equal(report(`${head}function go(name: string) { captureWeddingCodeEvent(name); }`).problems.length, 1, "이름을 확정할 수 없는 호출을 못 잡았다");
  assert.equal(report(`${head}captureWeddingCodeEvent();`).problems.length, 1, "이름이 없는 호출을 못 잡았다");
  assert.equal(report(`${head}const m = { captureWeddingCodeEvent: 1 }; const n = m.captureWeddingCodeEvent;`).count, 0, "호출이 아닌 속성 이름을 호출로 셌다");
  // 별칭과 네임스페이스로 부르는 호출도 센다(열한 번째 호출을 별칭으로 숨기지 못한다).
  const alias = report('import { captureWeddingCodeEvent as cap, captureEvent as other } from "@/lib/analytics";\ncap("wedding_code_started", { version: V });\nother("wedding_code_started");\ncap("wedding_code_intro_viewed");');
  assert.equal(alias.count, 2, "가져올 때 바꾼 이름의 호출을 못 셌다");
  assert.equal(alias.otherCalls, 1, "captureEvent 의 별칭 호출을 못 셌다");
  const namespaced = report('import * as analytics from "@/lib/analytics";\nanalytics.captureWeddingCodeEvent("wedding_code_started", { version: V });');
  assert.equal(namespaced.count, 1, "네임스페이스 가져오기의 속성 호출을 못 셌다");
  assert.equal(report('import { cap as captureWeddingCodeEvent } from "./other";\ncaptureWeddingCodeEvent("wedding_code_started");').count, 1, "이름 그대로의 호출은 어디서 가져왔어도 센다(통계 이름을 다른 모듈에서 가져오는 것은 규칙 6 이 따로 막는다)");

  const table = [["a.ts", textHash("one\ntwo\n")], ["b.ts", textHash("three\n")]];
  const reader = (files) => (path) => (path in files ? files[path] : null);
  assert.deepEqual(engineFreezeProblems(reader({ "a.ts": "one\ntwo\n", "b.ts": "three\n" }), table), [], "그대로인 엔진 파일을 문제로 읽었다");
  assert.deepEqual(engineFreezeProblems(reader({ "a.ts": "one\r\ntwo\r\n", "b.ts": "three\r\n" }), table), [], "줄 끝 문자만 다른 파일을 문제로 읽었다");
  assert.equal(engineFreezeProblems(reader({ "a.ts": "one\ntwo \n", "b.ts": "three\n" }), table).length, 1, "공백 하나가 바뀐 엔진 파일을 못 잡았다");
  assert.equal(engineFreezeProblems(reader({ "a.ts": "one\ntwo\n" }), table).length, 1, "지워진 엔진 파일을 못 잡았다");
  assert.equal(engineFreezeProblems(reader({}), table).length, 2, "엔진 파일이 전부 없는 것을 못 잡았다");
  assert.equal(engineFreezeProblems(reader({ "a.ts": "other", "b.ts": "other" }), table).length, 2, "내용이 모두 바뀐 것을 못 잡았다");
});
