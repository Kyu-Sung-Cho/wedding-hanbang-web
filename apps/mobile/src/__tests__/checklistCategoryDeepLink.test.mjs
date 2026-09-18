import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 앱 안 웹 화면의 링크가 네이티브 화면으로 넘어갈 때 **어디로** 가는가.
 *
 * 1. `/checklist?category=venue` 의 분야가 사라졌다. 예절 안내 편 끝의 「체크리스트에서
 *    확인하기」(`MannersPartView.tsx`)가 이 주소인데, 앱은 경로만 보고 `/checklist` 로 보내
 *    사용자가 분야를 다시 찾아야 했다. 웹은 같은 주소로 그 분야 시트를 바로 연다.
 * 2. `/wedding/lounge` 가 웹 로그인 벽으로 갔다. 2026-09-17 커밋 85e45aead 가 예절 안내
 *    사이드바 로고와 모바일 목록의 「홈」 버튼을 라운지로 보냈는데, 앱 웹뷰에는 세션이 없어
 *    **앱에 로그인한 사람이 웹 로그인 화면을 만났다.** 라운지는 앱의 첫 탭이다.
 */
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function transpile(relative, { jsx = false } = {}) {
  return ts.transpileModule(read(relative), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  }).outputText;
}

function load(code, requireFor, globals = {}) {
  const module = { exports: {} };
  const names = Object.keys(globals);
  new Function("exports", "module", "require", ...names, code)(
    module.exports,
    module,
    requireFor,
    ...names.map((name) => globals[name]),
  );
  return module.exports;
}

const planning = load(transpile("../../../../packages/shared/src/constants/weddingPlanning.ts"), () => {
  throw new Error("unexpected dependency");
});
const categoryParam = load(transpile("../lib/checklistCategoryParam.ts"), (specifier) => {
  if (specifier === "@hanbang/shared/constants") return planning;
  throw new Error(`unmocked dependency: ${specifier}`);
});

/**
 * `app/webview.tsx` 를 **통째로** 불러 실제로 내보내는 함수를 부른다. 화면 부품(웹뷰·아이콘 등)은
 * 무엇이든 받아 주는 빈 모듈로 채운다 — 이 검사가 보는 것은 주소를 바꾸는 함수 하나다.
 */
function anything() {
  const target = function () {};
  return new Proxy(target, {
    get: (_target, key) => (key === "__esModule" ? false : key === Symbol.toPrimitive ? () => "" : anything()),
    apply: () => anything(),
    construct: () => anything(),
  });
}
const webview = load(
  transpile("../../app/webview.tsx", { jsx: true }),
  (specifier) => (specifier === "@/lib/checklistCategoryParam" ? categoryParam : anything()),
  { __DEV__: false },
);
const route = (url) => {
  const parsed = new URL(url, "https://hanbang.ai");
  return webview.nativeRouteForWebPath(parsed.pathname, parsed.search);
};

test("체크리스트로 넘길 때 분야를 들고 간다", () => {
  assert.equal(route("/wedding/checklist?category=venue"), "/checklist?category=venue");
  assert.equal(route("/checklist?category=registration"), "/checklist?category=registration");
  // 분야 말고 다른 값은 옮기지 않는다.
  assert.equal(route("/wedding/checklist?category=dress&utm_source=x"), "/checklist?category=dress");
});

test("모르는 분야·이상한 값은 버리고 체크리스트만 연다", () => {
  for (const url of [
    "/wedding/checklist",
    "/wedding/checklist?category=",
    "/wedding/checklist?category=reserve",
    "/wedding/checklist?category=Venue",
    "/wedding/checklist?category=__proto__",
    "/wedding/checklist?category=venue%2F..%2Fsettings",
    "/wedding/checklist?category=%E0%A4%A",
  ]) {
    assert.equal(route(url), "/checklist", url);
  }
});

test("라운지는 웹 로그인 벽이 아니라 앱의 라운지 탭으로 간다", () => {
  assert.equal(route("/wedding/lounge"), "/lounge");
  assert.equal(route("/lounge"), "/lounge");
});

test("다른 로그인 필요 경로는 그대로, 공개 페이지는 웹뷰에 둔다", () => {
  assert.equal(route("/wedding/budget"), "/budget");
  assert.equal(route("/wedding/chat"), "/chat");
  for (const publicUrl of ["/wedding/manners", "/wedding/manners/cost-saving", "/price", "/price/venue", "/start-here", "/demo", "/wedding"]) {
    assert.equal(route(publicUrl), null, publicUrl);
  }
});

test("객체 원형의 이름을 경로로 착각하지 않는다", () => {
  for (const url of ["/constructor", "/wedding/toString", "/__proto__", "/wedding/hasOwnProperty"]) {
    assert.equal(route(url), null, url);
  }
});

test("분야 값 판정은 공유 체크리스트 분야만 받는다", () => {
  const { readChecklistCategoryParam } = categoryParam;
  for (const template of planning.CATEGORY_CHECKLISTS) {
    assert.equal(readChecklistCategoryParam(template.key), template.key);
  }
  assert.equal(readChecklistCategoryParam(["meeting", "venue"]), "meeting", "여러 값이면 첫 값만 본다");
  for (const bad of [undefined, null, "", "reserve", "general", "VENUE", " venue", 1, {}, ["nope"]]) {
    assert.equal(readChecklistCategoryParam(bad), null, JSON.stringify(bad));
  }
});

test("웹뷰가 경로와 쿼리를 함께 넘기고, 체크리스트 화면이 분야를 받아 시트를 연다", () => {
  const webviewSource = read("../../app/webview.tsx");
  assert.match(webviewSource, /nativeRouteForWebPath\(parsedNext\.pathname, parsedNext\.search\)/);
  assert.match(webviewSource, /lounge: "\/lounge"/);

  const schedule = read("../../app/schedule/index.tsx");
  assert.match(schedule, /useLocalSearchParams<\{ category\?: string \| string\[\] \}>\(\)/);
  assert.match(schedule, /readChecklistCategoryParam\(searchParams\.category\)/);
  // 불러온 분야 목록에 있는 분야만 연다. 같은 요청으로는 한 번만 연다(닫은 시트가 새로고침마다 다시 뜨지 않게).
  const effect = /useEffect\(\(\) => \{\n\s+if \(!requestedCategory\)[\s\S]*?\}, \[[^\]]*\]\);/.exec(schedule)?.[0] ?? "";
  assert.ok(effect, "분야 요청을 여는 효과를 찾지 못했다");
  assert.match(effect, /categories\.some\(\(category\) => category\.key === requestedCategory\)/);
  assert.match(effect, /openedCategoryRequestRef\.current === requestedCategory/);
  assert.match(effect, /setExpandedKey\(requestedCategory\)/);
});
