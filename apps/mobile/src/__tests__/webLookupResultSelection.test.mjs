// 찾아보기 카드 접기(2026-11-22). 방금 끝난 턴의 말풍선에는 실시간 결과와 done 의 저장본이 함께 온다.
// 저장된 페이지 카드는 업체 주소가 없어(파운더 결정 4) 주소로는 같은 읽기인지 맞출 수 없으므로
// `storedCopy` 표시로 접는다. 다시 열었을 때(저장본만 있을 때)는 저장본을 그린다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../components/chat/webLookupResultSelection.ts", import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("module", "exports", compiled.outputText)(module, module.exports);
const { selectWebLookupResultsToRender } = module.exports;

const chatSource = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);

const liveSearch = {
  toolName: "search_web",
  toolOutput: { query: "강남 웨딩홀", hits: [{ ref: "a1", name: "가상 웨딩홀" }] },
  success: true,
};
const searchPlaceholder = {
  toolName: "search_web",
  toolOutput: { query: "강남 웨딩홀", resultCount: 1, displayOnlyPlaceholder: true },
  success: true,
};
const livePage = {
  toolName: "read_page",
  toolOutput: { url: "https://hall.example/price", domain: "hall.example", title: "대관 안내", prices: [] },
  success: true,
};
const storedPage = {
  toolName: "read_page",
  toolOutput: { title: "대관 안내", prices: [], storedCopy: true },
  success: true,
};
const otherTool = { toolName: "update_budget", toolOutput: {}, success: true };

test("방금 받은 검색과 페이지 읽기가 있으면 같은 턴의 자리표시·저장본은 그리지 않는다", () => {
  assert.deepEqual(
    selectWebLookupResultsToRender([liveSearch, livePage, searchPlaceholder, storedPage]),
    [liveSearch, livePage],
  );
});

test("다시 열면 저장본만 있으므로 자리표시와 주소 없는 페이지 카드를 그린다", () => {
  assert.deepEqual(selectWebLookupResultsToRender([searchPlaceholder, storedPage]), [searchPlaceholder, storedPage]);
});

test("방금 읽기에 실패한 페이지는 그대로 그린다(실패는 저장하지 않는다)", () => {
  const failedPage = { toolName: "read_page", toolOutput: { error: "blocked_by_robots" }, success: false };
  assert.deepEqual(selectWebLookupResultsToRender([failedPage]), [failedPage]);
});

test("찾아보기가 아닌 도구는 고르지 않는다", () => {
  assert.deepEqual(selectWebLookupResultsToRender([otherTool, storedPage]), [storedPage]);
});

test("화면이 이 함수로 찾아보기 카드를 고른다", () => {
  assert.match(chatSource, /import \{ selectWebLookupResultsToRender \} from "@\/components\/chat\/webLookupResultSelection";/);
  assert.match(chatSource, /selectWebLookupResultsToRender\(item\.metadata\?\.toolResults \?\? \[\]\)/);
});
