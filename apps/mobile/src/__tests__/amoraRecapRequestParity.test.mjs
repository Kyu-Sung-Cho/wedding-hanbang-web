import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 「최근 대화 정리」가 웹과 앱에서 같은 부탁을 넣는가 (2026-09-18).
 *
 * 웹 정리 패널은 확정·검토 중·보류·실제 반영·미반영 제안을 나눠 달라는 긴 요청(`AMORA_RECAP_REQUEST`)을
 * 넣는데, 앱 시트는 "지금 대화에서 … 짧게 정리해 줘" 라는 다른 문장을 넣고 있었다. 같은 공유 대화를 두
 * 사람이 서로 다른 기기에서 정리하면 아모라가 받는 부탁이 달라져 정리 모양도 달라진다. 이제 문장은
 * `packages/shared` 한 곳에 있고 두 화면이 그것을 읽는다.
 *
 * 정리 아래에는 웹처럼 다음에 볼 곳을 둔다 — 함께 대화는 공유 할 일과 현재 예산, 나만 상담은 나만 보는 할 일.
 */
function compile(relative, deps = {}, { jsx = false } = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const shared = compile("../../../../packages/shared/src/contracts/amoraConversationRecap.ts", {
  "../utils/chatTimestamp": { compareChatTimestamps: () => 0 },
  "../utils/kstDay": { todayYmdInKst: () => "2026-09-18" },
  "./amoraPendingActionApplication": {
    buildAmoraActionConfirmationOutcomes: () => new Map(),
    getAmoraPendingActionApplicationState: () => "none",
  },
});

const recap = {
  day: "2026-09-17",
  messageCount: 3,
  lastQuestion: { messageId: "q", text: "식장 계약 전에 뭘 봐야 해?", createdAt: "2026-09-17T00:00:00Z" },
  actions: [],
};

function render({ scope, onPrefill = () => true, disabled = false }) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const pushes = [];
  const setters = [];
  const component = compile("../components/chat/AmoraConversationRecap.tsx", {
    react: { useState: (initial) => [initial, (value) => setters.push(value)] },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", View: "View",
      StyleSheet: { create: (value) => value },
    },
    "expo-router": { router: { push: (path) => pushes.push(path) } },
    "@/components/ui/AppText": { Text: "Text" },
    "@hanbang/design-tokens": {
      colors: new Proxy({}, { get: () => new Proxy({}, { get: () => "#000000" }) }),
      spacing: new Proxy({}, { get: () => 8 }),
      radius: new Proxy({}, { get: () => 12 }),
    },
    "@hanbang/shared": { AMORA_RECAP_REQUEST: shared.AMORA_RECAP_REQUEST },
  }, { jsx: true });
  const tree = component.AmoraConversationRecap({
    recap, scope, scopeLabel: scope === "private" ? "나만 상담" : "함께 대화", disabled, onPrefill,
  });
  const pressables = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  const textOf = (node) => {
    const out = [];
    (function walk(value) {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value === "string") return void out.push(value);
      if (value && typeof value === "object") walk(value.props.children);
    })(node);
    return out.join("");
  };
  const button = (label) => pressables.find((node) => textOf(node) === label);
  return { button, pushes, setters, labels: pressables.map(textOf) };
}

test("정리 요청 문장은 shared 한 곳에 있고 웹 패널이 그것을 읽는다", () => {
  assert.equal(typeof shared.AMORA_RECAP_REQUEST, "string");
  assert.match(shared.AMORA_RECAP_REQUEST, /확정된 결정, 아직 검토 중인 생각, 보류한 내용/);
  assert.match(shared.AMORA_RECAP_REQUEST, /추측하지 말고/);
  const web = read("../../../web/src/components/app/chat/panel/ConversationRecapPanel.tsx");
  assert.match(web, /import \{[^}]*\bAMORA_RECAP_REQUEST\b[^}]*\} from "@hanbang\/shared"/);
  assert.doesNotMatch(web, /AMORA_RECAP_REQUEST\s*=\s*"/, "웹이 자기 문장을 따로 들고 있으면 두 화면이 다시 갈라진다");
});

test("앱 정리 시트의 정리 요청은 웹과 같은 문장을 입력창에만 넣는다", () => {
  const calls = [];
  const { button } = render({ scope: "shared", onPrefill: (text) => { calls.push(text); return true; } });
  const request = button("아모라에게 정리 요청하기");
  assert.ok(request, "정리 요청 버튼이 없다");
  request.props.onPress();
  assert.deepEqual(calls, [shared.AMORA_RECAP_REQUEST]);
});

test("함께 대화 정리 아래에는 공유 할 일과 현재 예산으로 가는 길이 있다", () => {
  const { button, pushes, setters, labels } = render({ scope: "shared" });
  const board = button("공유 할 일");
  const budget = button("현재 예산");
  assert.ok(board && budget, labels.join(" / "));
  assert.equal(button("나만 보는 할 일"), undefined, "함께 대화에는 개인 할 일로 가는 길을 두지 않는다");
  for (const node of [board, budget]) {
    assert.equal(node.props.accessibilityRole, "link");
    node.props.onPress();
  }
  assert.deepEqual(pushes, ["/amora-preparation", "/budget"]);
  // 시트를 닫고 옮겨 간다 — 열린 모달 위에 새 화면이 쌓이지 않게.
  assert.ok(setters.filter((value) => value === false).length >= 2);
});

test("나만 상담 정리 아래에는 나만 보는 할 일로 가는 길만 있다", () => {
  const { button, pushes } = render({ scope: "private" });
  assert.equal(button("공유 할 일"), undefined);
  assert.equal(button("현재 예산"), undefined);
  const personal = button("나만 보는 할 일");
  assert.ok(personal);
  personal.props.onPress();
  assert.deepEqual(pushes, ["/amora-personal"]);
});
