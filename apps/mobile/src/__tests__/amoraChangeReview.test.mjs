import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 아모라 변경 제안의 「내용 확인하기」 창 (2026-09-18).
 *
 * 앱 카드는 예산·일정·체크리스트·할 일을 바꾸는 제안을 **한 번 누르면 바로** 반영했다. 웹은 카드의
 * 「내용 확인하기」가 확인 창을 열고, 거기서 무엇이 바뀌는지·도구별 안내("예약을 대신 진행하지 않아요")·
 * 공개 범위를 읽은 뒤에야 「이대로 적용」을 누를 수 있다. 이제 앱도 같은 두 단계다.
 *
 * 이 파일이 지키는 것:
 * - 도구별 분야·안내 표는 `packages/shared` 한 곳에 있고 웹 확인 창과 앱 확인 시트가 그것을 읽는다.
 * - 앱 확인 시트가 무엇이 바뀌는지와 도구별 안내, 상대 알림 안내, 공개 범위를 보여 준다.
 * - 반영은 시트의 확인 버튼에서만 일어난다(카드 한 번 누르기로 반영되지 않는 것은
 *   `pendingAmoraAction.test.mjs` 가 실제 카드를 그려 잰다).
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

const review = compile("../../../../packages/shared/src/contracts/amoraChangeReview.ts");
const approval = compile("../../../../packages/shared/src/contracts/amoraActionApproval.ts");
const { colors } = compile("../../../../packages/design-tokens/src/colors.ts");
const { amoraIdentity } = compile("../../../../packages/design-tokens/src/amora.ts", { "./colors": { colors } });

test("표는 아모라가 확인받아 반영할 수 있는 도구를 빠짐없이, 그것만 담는다", () => {
  const applicable = [
    ...approval.SHARED_PLAN_TOOLS,
    "update_task_status", "toggle_checklist_item", "add_amora_action",
  ].filter((tool) => approval.getAmoraActionApprovalPolicy(tool) !== "blocked");
  assert.deepEqual(Object.keys(review.AMORA_CHANGE_DETAILS).sort(), [...new Set(applicable)].sort());
  for (const [tool, detail] of Object.entries(review.AMORA_CHANGE_DETAILS)) {
    assert.ok(detail.category.trim() && detail.effect.trim(), tool);
  }
});

test("아모라가 손대지 않는 범위를 누르기 전에 읽게 하는 도구별 안내가 남아 있다", () => {
  assert.match(review.AMORA_CHANGE_DETAILS.update_venue.effect, /예약을 대신 진행하지 않아요/);
  assert.match(review.AMORA_CHANGE_DETAILS.cancel_schedule_event.effect, /업체 예약을 취소하지 않아요/);
  assert.match(review.AMORA_CHANGE_DETAILS.add_amora_action.effect, /이미 끝낸 일로 표시하지 않아요/);
  assert.equal(review.AMORA_SHARED_PLAN_PARTNER_NOTICE, "확인하면 바로 반영되고, 상대에게 바뀐 내용이 알림으로 가요.");
});

test("표에 없는 도구는 반영할 수 없다고 말하고, 기존 맞춤 항목 금액 변경은 그렇게 부른다", () => {
  for (const tool of ["book_vendor", "delete_everything", "constructor", "toString", "__proto__"]) {
    assert.deepEqual(review.describeAmoraChange(tool, null), review.AMORA_UNKNOWN_CHANGE_DETAIL, tool);
  }
  const preview = (currentBudget) => ({
    categories: [{ key: "custom_flowers", label: "플라워", currentBudget, proposedBudget: currentBudget + 3_000_000, currentRecordedSpend: 0, proposedRecordedSpend: 0 }],
    delta: { totalBudget: 0, allocatedBudget: 3_000_000, recordedSpend: 0, unallocatedBudget: -3_000_000 },
  });
  assert.equal(review.describeAmoraChange("add_custom_category", preview(2_000_000)).effect, review.AMORA_EXISTING_CUSTOM_CATEGORY_EFFECT);
  // 0원 항목과 새 항목은 미리보기로 가를 수 없다 — 기존 항목이라고 단정하지 않는다.
  assert.equal(review.describeAmoraChange("add_custom_category", preview(0)).effect, review.AMORA_CHANGE_DETAILS.add_custom_category.effect);
  assert.equal(review.describeAmoraChange("add_custom_category", null).effect, review.AMORA_CHANGE_DETAILS.add_custom_category.effect);
});

test("웹 확인 창과 카드가 표와 문구를 shared 에서 읽는다 — 웹에 따로 남은 표가 없다", () => {
  const sheet = read("../../../web/src/components/app/chat/AmoraSaveSheet.tsx");
  assert.doesNotMatch(sheet, /const CHANGE_DETAILS/);
  assert.match(sheet, /import \{[^}]*\bdescribeAmoraChange\b[^}]*\} from "@hanbang\/shared"/);
  assert.match(sheet, /\bAMORA_CHANGE_REVIEW_COPY\b/);
  for (const text of ["이 내용을 반영할까요?", "제안의 근거", "공개 범위 · 함께 보는 준비 정보", "예약을 대신 진행하지 않아요"]) {
    assert.ok(!sheet.includes(text), `웹 확인 창에 문구가 따로 남아 있다: ${text}`);
  }
  const frame = read("../../../web/src/components/app/chat/AmoraSheetFrame.tsx");
  assert.ok(frame.includes(review.AMORA_CHANGE_REVIEW_COPY.defer) && frame.includes(review.AMORA_CHANGE_REVIEW_COPY.close));
  const card = read("../../../web/src/components/app/chat/PendingAmoraActionCard.tsx");
  assert.match(card, /approvalCopy = AMORA_SHARED_PLAN_PARTNER_NOTICE/);
  assert.ok(card.includes(`"${review.AMORA_CHANGE_REVIEW_COPY.openLabel}"`) || /AMORA_CHANGE_REVIEW_COPY\.openLabel/.test(card));
});

function renderSheet(props = {}) {
  const jsx = (type, p) => ({ type, props: p ?? {} });
  const component = compile("../components/chat/AmoraChangeReviewSheet.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", View: "View",
      StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute" } },
    },
    "@/components/ui/AppText": { Text: "Text" },
    "lucide-react-native": { Check: "Check", CircleCheck: "CircleCheck", Info: "Info", X: "X" },
    "@hanbang/design-tokens": { colors, amoraIdentity },
    "@hanbang/shared": review,
  }, { jsx: true });
  const calls = [];
  const tree = component.AmoraChangeReviewSheet({
    visible: true,
    confirmation: "예식장을 더채플 청담으로 바꿀까요?",
    tool: "update_venue",
    impactPreview: null,
    carriedLabel: null,
    disabled: false,
    busy: false,
    applyLabel: "이대로 적용",
    applyAccessibilityLabel: "확인한 내용을 이대로 적용",
    notice: null,
    error: null,
    onConfirm: () => calls.push("confirm"),
    onClose: () => calls.push("close"),
    onDefer: () => calls.push("defer"),
    ...props,
  });
  const pressables = [];
  const texts = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  const byLabel = (label) => pressables.find((node) => node.props.accessibilityLabel === label);
  return { tree, calls, text: texts.join(" "), byLabel, pressables };
}

test("앱 확인 시트는 무엇이 바뀌는지, 도구별 안내, 공개 범위를 웹과 같은 말로 보여 준다", () => {
  const { text, tree } = renderSheet();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.visible, true);
  const copy = review.AMORA_CHANGE_REVIEW_COPY;
  for (const expected of [
    copy.title, copy.description, copy.confirmationLabel, "예식장을 더채플 청담으로 바꿀까요?", copy.reasonLabel, copy.reason,
    copy.categoryLabel, "예식 준비", "준비 정보의 예식장 정보를 바꿔요. 예약을 대신 진행하지 않아요.", copy.scopeTitle, copy.scopeBody,
    "이대로 적용", copy.defer,
  ]) {
    assert.ok(text.includes(expected), `시트에 없다: ${expected}`);
  }
});

test("상대 알림 안내와 이월 라벨, 실패 이유를 시트 안에서 알린다", () => {
  const withNotice = renderSheet({ notice: review.AMORA_SHARED_PLAN_PARTNER_NOTICE, carriedLabel: "이전 제안 · 아직 확인하지 않았어요" });
  assert.ok(withNotice.text.includes("확인하면 바로 반영되고, 상대에게 바뀐 내용이 알림으로 가요."));
  assert.ok(withNotice.text.includes("이전 제안 · 아직 확인하지 않았어요"));
  const failed = renderSheet({ error: "변경 내용을 다시 확인해 주세요.", notice: review.AMORA_SHARED_PLAN_PARTNER_NOTICE });
  assert.ok(failed.text.includes("변경 내용을 다시 확인해 주세요."));
});

test("반영은 시트의 확인 버튼에서만, 나중에 정하기·닫기는 반영하지 않는다", () => {
  const sheet = renderSheet();
  const confirm = sheet.byLabel("확인한 내용을 이대로 적용");
  assert.ok(confirm, "확인 버튼이 없다");
  assert.equal(confirm.props.accessibilityRole, "button");
  sheet.byLabel(review.AMORA_CHANGE_REVIEW_COPY.defer).props.onPress();
  sheet.byLabel(review.AMORA_CHANGE_REVIEW_COPY.close).props.onPress();
  assert.deepEqual(sheet.calls, ["defer", "close"], "나중에 정하기·닫기가 반영을 부르면 안 된다");
  confirm.props.onPress();
  assert.deepEqual(sheet.calls, ["defer", "close", "confirm"]);
  // 안드로이드 뒤로 가기도 닫기일 뿐이다.
  sheet.tree.props.onRequestClose();
  assert.equal(sheet.calls.at(-1), "close");
});

test("막힌 제안은 시트 안에서도 반영할 수 없고, 반영 중에는 닫히지 않는다", () => {
  const blocked = renderSheet({ disabled: true });
  assert.equal(blocked.byLabel("확인한 내용을 이대로 적용").props.disabled, true);

  const busy = renderSheet({ busy: true, disabled: true });
  assert.equal(busy.byLabel(review.AMORA_CHANGE_REVIEW_COPY.defer).props.disabled, true);
  busy.tree.props.onRequestClose();
  busy.byLabel(review.AMORA_CHANGE_REVIEW_COPY.close).props.onPress?.();
  assert.deepEqual(busy.calls, [], "반영 요청 중에 닫으면 결과를 볼 곳이 사라진다");
});

test("카드의 「내용 확인하기」도 주 채움색 토큰을 쓴다 — 예전에 박혀 있던 초록 대신", () => {
  const chat = read("../../app/(tabs)/chat.tsx");
  const block = chat.match(/pendingActionButton: \{[^}]*\}/u)?.[0] ?? "";
  assert.match(block, /backgroundColor: colors\.rose\[600\]/u);
  assert.doesNotMatch(block, /#2F5F51/iu);
  assert.match(chat, /pendingActionButtonPressed: \{ backgroundColor: colors\.rose\[700\] \}/u);
  // 눌림을 투명도로 나타내지 않는다(DESIGN.md) — 눌림 색으로 바꾼다.
  assert.match(chat, /pressed && !pendingActionControlDisabled && st\.pendingActionButtonPressed/u);
});

test("확인 버튼은 디자인 토큰의 주 채움색(rose[600])이고 눌림은 rose[700], 높이는 44 이상이다", () => {
  const { byLabel } = renderSheet();
  const confirm = byLabel("확인한 내용을 이대로 적용");
  const styles = (pressed) => [confirm.props.style({ pressed })].flat(3).filter(Boolean);
  const resting = Object.assign({}, ...styles(false));
  const pressed = Object.assign({}, ...styles(true));
  assert.equal(resting.backgroundColor, colors.rose[600]);
  assert.equal(pressed.backgroundColor, colors.rose[700]);
  assert.ok(resting.minHeight >= 44);
  assert.doesNotMatch(read("../components/chat/AmoraChangeReviewSheet.tsx"), /#[0-9a-f]{3,8}\b/i, "새 hex 색을 박지 않는다");
});
