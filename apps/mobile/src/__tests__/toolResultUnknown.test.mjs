import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, mount } from "./helpers/nativeReact.mjs";
const load = createLoader({ "expo-router": { router: { push() {} } } });
const { getToolResultCardModel } = load("components/chat/toolResultCardModel.ts");
const { ToolResultCard } = load("components/chat/ToolResultCard.tsx");
test("uncertain budget outcome is neutral in the actual card with an accessible review action", async () => {
  const model = getToolResultCardModel({ toolName: "update_budget", success: false,
    toolOutput: { error: "TOOL_EXECUTION_UNCERTAIN" }, displayMessage: "저장했어요" });
  const ui = await mount(ToolResultCard, { model });
  try {
    assert.match(ui.container.textContent, /반영 여부를 확인하지 못했어요/);
    assert.doesNotMatch(ui.container.textContent, /저장했어요|반영되지|다시 시도/);
    assert.ok(ui.container.querySelector('[aria-label="예산 확인하기"]'));
    assert.equal(ui.container.querySelector('[data-icon="XCircle"]'), null);
  } finally { await ui.close(); }
});
for (const toolOutput of [{ error: "TOOL_EXECUTION_IN_PROGRESS" }, { error: "TOOL_LEDGER_RESULT_INVALID" }, { requires_state_review: true }]) {
  for (const success of [false, true]) test(`canonical unknown overrides success=${success}: ${JSON.stringify(toolOutput)}`, async () => {
    const model = getToolResultCardModel({ toolName: "add_schedule_event", success, toolOutput, displayMessage: "성공했어요" });
    const ui = await mount(ToolResultCard, { model });
    try {
      assert.match(ui.container.textContent, /반영 확인 필요/);
      assert.doesNotMatch(ui.container.textContent, /성공했어요|반영됐어요|반영되지/);
      assert.ok(ui.container.querySelector('[aria-label="일정 확인하기"]'));
    } finally { await ui.close(); }
  });
}
test("definite failure does not become unknown because arbitrary output asks for retry", async () => {
  const model = getToolResultCardModel({ toolName: "update_budget", success: false,
    toolOutput: { error: "AMORA_ATOMIC_INVALID", requires_state_review: "true" }, displayMessage: "변경할 수 없어요" });
  const ui = await mount(ToolResultCard, { model });
  try { assert.match(ui.container.textContent, /반영되지 않았어요/); } finally { await ui.close(); }
});
