import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 공유 할 일 카드의 "연결된 화면 보기" 허용 목록. 아는 화면만 네이티브로 옮기고 나머지는 링크를
 * 그리지 않는다. 특히 `/chat/personal`(공유 카드에서 나만 상담으로 새는 길)과 보드 자신
 * (`/actions`), 외부 주소는 막는다.
 */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
function compile(relative, modules) {
  const code = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", code)(module.exports, module, (name) => {
    assert.ok(Object.hasOwn(modules, name), `unmocked dependency ${name}`); return modules[name];
  });
  return module.exports;
}
const planning = compile("../../../../packages/shared/src/constants/weddingPlanning.ts", {});
const checklistParam = compile("../lib/checklistCategoryParam.ts", { "@hanbang/shared/constants": planning });
const { sharedTaskLinkTarget } = compile("../lib/sharedTaskLinks.ts", { "@/lib/checklistCategoryParam": checklistParam });

test("예산·일정은 /wedding 접두사가 있어도 같은 앱 화면으로 간다", () => {
  assert.deepEqual(sharedTaskLinkTarget("/budget"), { kind: "push", route: "/budget" });
  assert.deepEqual(sharedTaskLinkTarget("/wedding/budget"), { kind: "push", route: "/budget" });
  assert.deepEqual(sharedTaskLinkTarget("/schedule"), { kind: "push", route: "/schedule" });
  assert.deepEqual(sharedTaskLinkTarget("/wedding/schedule"), { kind: "push", route: "/schedule" });
  // 화면 안 위치(#)는 버리고 화면만 연다.
  assert.deepEqual(sharedTaskLinkTarget("/wedding/schedule#today"), { kind: "push", route: "/schedule" });
});

test("체크리스트는 21개 분야 키만 분야 시트로 열고, 나머지는 목록으로 연다", () => {
  assert.deepEqual(sharedTaskLinkTarget("/checklist?category=venue"), { kind: "push", route: "/checklist?category=venue" });
  assert.deepEqual(sharedTaskLinkTarget("/wedding/checklist?category=invitation"), { kind: "push", route: "/checklist?category=invitation" });
  for (const href of ["/checklist?category=reserve", "/checklist?category=Venue", "/checklist?category=general", "/checklist?category=%E0%A4%A", "/checklist"]) {
    assert.deepEqual(sharedTaskLinkTarget(href), { kind: "push", route: "/checklist" }, href);
  }
});

test("채팅은 기존 채팅 탭으로 돌아가고, 견적 확인은 앱 화면으로 간다", () => {
  assert.deepEqual(sharedTaskLinkTarget("/chat"), { kind: "chat" });
  assert.deepEqual(sharedTaskLinkTarget("/wedding/chat"), { kind: "chat" });
  assert.deepEqual(sharedTaskLinkTarget("/wedding/community/quote-check"), { kind: "push", route: "/quote-check" });
  assert.deepEqual(sharedTaskLinkTarget("/community/quote-check"), { kind: "push", route: "/quote-check" });
});

test("나만 상담·보드 자신·라운지·업체·예약·모르는 경로·외부 주소에는 링크를 주지 않는다", () => {
  for (const href of [
    "/chat/personal", "/wedding/chat/personal", "/wedding/actions", "/actions", "/wedding/lounge", "/lounge",
    "/vendors", "/wedding/vendors", "/bookings", "/wedding/bookings", "/wedding", "/wedding/", "/", "/budget/extra",
    "/wedding/wedding/budget", "/unknown", "//evil", "//evil.example/budget", "https://x", "https://hanbang.ai/budget",
    "budget", "", "/bud get", "/budget\\..", "/chat\n", null, undefined, 42,
    // 웹 preparationActionHref 처럼 공백·제어문자·역슬래시는 주소 어디에 있어도 링크를 주지 않는다.
    "/budget?note=a b", `/checklist?category=venue${String.fromCharCode(9)}`, `/schedule#${String.fromCharCode(127)}`, "/chat?x=\\y",
  ]) {
    assert.equal(sharedTaskLinkTarget(href), null, JSON.stringify(href));
  }
});
