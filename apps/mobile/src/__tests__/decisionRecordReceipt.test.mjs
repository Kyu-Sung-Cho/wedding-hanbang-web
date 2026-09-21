import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}, { env = {}, isDevelopment = true } = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", "__DEV__", "process", code)(module, module.exports, key => {
    assert.ok(dependencies[key], `Unexpected dependency: ${key}`);
    return dependencies[key];
  }, isDevelopment, { env });
  return module.exports;
}
const shared = load("../../../../packages/shared/src/contracts/amoraDecisionReceipt.ts");
const models = load("../components/chat/toolResultCardModel.ts", { "@hanbang/shared": shared });
const receipt = () => ({
  toolName: "add_decision_record", success: true,
  toolInput: { title: "미리보기 제목", status: "decided" },
  toolOutput: { verified: true, decision: {
    id: "12345678-1234-4234-8234-123456789abc", title: "상견례 장소 후보 비교",
    status: "considering", memo: "양가 이동 거리를 먼저 확인하기로 했어요.", category_key: "meeting", created_at: "2026-09-20T01:00:00Z",
  } }, displayMessage: "저장했어요.",
});

const jsx = (type, props) => ({ type, props });
const site = load("../lib/siteUrl.mjs");
function createCard({ env = {}, isDevelopment = true, opened = [], alerts = [], openingFailure = false } = {}) {
  return load("../components/chat/ToolResultCard.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { View: "View", Pressable: "Pressable", StyleSheet: { create: value => value },
      Linking: { openURL: async url => { opened.push(url); if (openingFailure) throw new Error("offline"); } },
      Alert: { alert: (...values) => alerts.push(values) } },
    "@/components/ui/AppText": { Text: "Text" },
    "expo-router": { router: { push: path => { throw new Error(`Not a native decision screen: ${path}`); } } },
    "lucide-react-native": { CheckCircle2: "CheckCircle2", XCircle: "XCircle", Info: "Info" },
    "@hanbang/design-tokens": { colors: { noir: { 800: "black", soft: "gray" }, rose: { 700: "rose" } } },
    "@hanbang/shared": shared,
    "@/lib/siteUrl.mjs": site,
    "./toolResultCardModel": models,
  }, { env, isDevelopment });
}
const card = createCard();
const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes) : typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
const text = value => value == null ? "" : Array.isArray(value) ? value.map(text).join("") : typeof value === "object" ? text(value.props?.children) : String(value);

test("native receipt uses the saved title/status, not proposed input or a generic success", () => {
  const model = models.getToolResultCardModel(receipt());
  assert.ok(model, "결정 기록 결과 카드가 없다");
  assert.equal(model.tone, "success");
  assert.equal(model.title, "결정 기록 저장");
  assert.match(model.message, /상견례 장소 후보 비교/);
  assert.match(model.message, /논의 중/);
  assert.match(model.message, /양가 이동 거리를 먼저 확인/);
  assert.match(model.message, /두 사람의 합의를 뜻하지 않아요/);
  assert.doesNotMatch(model.message, /미리보기 제목|확정/);
});

for (const { name, env, isDevelopment, expectedUrl } of [
  { name: "unset development origin", env: {}, isDevelopment: true, expectedUrl: "http://localhost:3000/wedding/chat/board?view=decisions" },
  { name: "explicit local origin", env: { EXPO_PUBLIC_SITE_URL: "http://localhost:3000" }, isDevelopment: true, expectedUrl: "http://localhost:3000/wedding/chat/board?view=decisions" },
  { name: "production origin", env: { EXPO_PUBLIC_SITE_URL: "https://hanbang.ai" }, isDevelopment: false, expectedUrl: "https://hanbang.ai/wedding/chat/board?view=decisions" },
]) {
  test(`native receipt opens only the fixed web decision view on explicit press and explains separate web login: ${name}`, async () => {
    const opened = [];
    const card = createCard({ env, isDevelopment, opened });
    const result = receipt();
    result.toolOutput.href = "https://untrusted.example/steal";
    const tree = card.ToolResultCard({ model: models.getToolResultCardModel(result) });
    assert.equal(opened.length, 0);
    assert.match(text(tree), /웹 로그인이 필요할 수 있어요/);
    const link = nodes(tree).find(node => node.props?.accessibilityLabel === "웹에서 결정 기록 보기");
    assert.ok(link, "결정 기록으로 이동하는 접근 가능한 링크가 없다");
    assert.equal(link.props.accessibilityRole, "link");
    await link.props.onPress();
    assert.deepEqual(opened, [expectedUrl]);
  });
}

test("missing verification never announces a completed save, even with a success-shaped AI result", () => {
  const result = receipt();
  delete result.toolOutput.verified;
  const model = models.getToolResultCardModel(result);
  assert.equal(model.tone, "unknown");
  const tree = card.ToolResultCard({ model });
  assert.match(tree.props.accessibilityLabel, /저장 확인 필요/);
  assert.match(text(tree), /저장 여부를 확인하지 못했어요/);
  assert.doesNotMatch(text(tree), /반영됐어요|저장했어요|상견례 장소 후보 비교/);
  assert.equal(nodes(tree).filter(node => node.type === "CheckCircle2").length, 0);
});

test("distinct saved decisions with the same words remain separate while a replay receipt is folded", () => {
  const first = models.getToolResultCardModel(receipt());
  const another = receipt();
  another.toolOutput.decision.id = "22345678-1234-4234-8234-123456789abc";
  const second = models.getToolResultCardModel(another);
  assert.equal(models.dedupeToolResultCards([first, second, { ...first }]).length, 2);
});

test("opening the web list can fail visibly without making another save request", async () => {
  const opened = [];
  const alerts = [];
  const card = createCard({ opened, alerts, openingFailure: true });
  const tree = card.ToolResultCard({ model: models.getToolResultCardModel(receipt()) });
  const link = nodes(tree).find(node => node.props?.accessibilityRole === "link");
  const before = opened.length;
  await link.props.onPress();
  assert.equal(opened.length, before + 1);
  assert.deepEqual(alerts.at(-1), ["결정 기록을 열지 못했어요", "연결 상태를 확인한 뒤 다시 눌러 주세요."]);
});

test("failed and malformed operations never become a successful native receipt", () => {
  const failed = { ...receipt(), success: false };
  const malformed = receipt();
  malformed.toolOutput.decision.status = "booked";
  for (const result of [failed, malformed]) {
    const tree = card.ToolResultCard({ model: models.getToolResultCardModel(result) });
    assert.doesNotMatch(text(tree), /반영됐어요|상태로 저장했어요/);
    assert.equal(nodes(tree).filter(node => node.type === "CheckCircle2").length, 0);
  }
});

for (const toolOutput of [{ error: "TOOL_EXECUTION_UNCERTAIN", requires_state_review: true }, { error: "TOOL_EXECUTION_UNCERTAIN" }, { requires_state_review: true }]) {
  test(`native uncertain commit stays unknown and leads to reconciliation: ${JSON.stringify(toolOutput)}`, () => {
    const model = models.getToolResultCardModel({ ...receipt(), success: false, toolOutput });
    assert.equal(model.tone, "unknown");
    const tree = card.ToolResultCard({ model });
    assert.match(text(tree), /저장 여부를 확인하지 못했어요/);
    assert.match(text(tree), /결정 기록에서 확인해 주세요/);
    assert.doesNotMatch(text(tree), /저장하지 못했어요|다시 시도|반영되지 않았어요|반영됐어요/);
    assert.match(tree.props.accessibilityLabel, /저장 확인 필요/);
    assert.equal(nodes(tree).filter(node => node.type === "CheckCircle2" || node.type === "XCircle").length, 0);
    assert.ok(nodes(tree).find(node => node.props?.accessibilityLabel === "웹에서 결정 기록 보기"));
  });
}

for (const error of ["TOOL_EXECUTION_IN_PROGRESS", "TOOL_LEDGER_RESULT_INVALID"]) {
  for (const success of [false, true]) {
    test(`native ${error} remains unknown with success=${success}, including a contradictory receipt`, () => {
      const toolOutput = success ? { ...receipt().toolOutput, error } : { error };
      const model = models.getToolResultCardModel({ ...receipt(), success, toolOutput });
      assert.equal(model.tone, "unknown");
      const tree = card.ToolResultCard({ model });
      assert.match(text(tree), /저장 여부를 확인하지 못했어요/);
      assert.doesNotMatch(text(tree), /저장하지 못했어요|다시 시도|반영되지 않았어요|반영됐어요|상견례 장소 후보 비교/);
      assert.match(tree.props.accessibilityLabel, /저장 확인 필요/);
      assert.equal(nodes(tree).filter(node => node.type === "CheckCircle2" || node.type === "XCircle").length, 0);
      assert.ok(nodes(tree).find(node => node.props?.accessibilityLabel === "웹에서 결정 기록 보기"));
    });
  }
}
